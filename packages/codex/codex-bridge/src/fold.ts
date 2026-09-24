/**
 * Fold a Codex rollout line stream into the DSH session-event vocabulary.
 *
 * The mapping is deliberately lossy, and every loss is reported rather than
 * hidden. Codex writes each conversational fact twice — once as a
 * `response_item` (the provider transcript) and once as an `event_msg`
 * (the app-level projection) — so the fold reads `response_item` only and
 * treats `event_msg` as a duplicate view. Reasoning is dropped: Codex stores
 * it as an opaque encrypted blob that no other system can interpret, and
 * emitting it as DSH reasoning text would invent content the model never
 * produced.
 *
 * Turn and step boundaries are synthesized: Codex has no equivalent marker, so
 * one DSH turn is opened per Codex `task_started` and one step per user or
 * assistant message. `seq` values are assigned densely from zero over the
 * produced event list, because DSH replay refuses a non-contiguous log.
 *
 * @module @deepseek-ai/dsh-codex-bridge/fold
 */

import type { CodexRolloutLine, CodexSkip, FoldedEvent, FoldResult } from './types.ts'

/** DSH content block for plain text. */
interface TextBlock { type: 'text'; text: string }

/** Roles Codex stamps on a `response_item` message. */
const ROLE_USER = 'user'
const ROLE_ASSISTANT = 'assistant'

/** Codex content-item kinds this fold understands. */
const CONTENT_INPUT = 'input_text'
const CONTENT_OUTPUT = 'output_text'

/**
 * Whether a Codex message is harness-injected context rather than human or
 * model speech. Codex marks these with `content_item_kinds`, and the markers
 * distinguish an actual prompt from the environment, skill, and collaboration
 * blocks every turn carries.
 */
function isInjectedContext(payload: Record<string, unknown>): boolean {
  const meta = payload['internal_chat_message_metadata_passthrough']
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return false
  const kinds = (meta as Record<string, unknown>)['content_item_kinds']
  if (!Array.isArray(kinds) || kinds.length === 0) return false
  return kinds.every(kind => typeof kind === 'string' && kind !== 'user.instructions')
}

/** Extract the plain-text blocks of one Codex message payload. */
function messageText(payload: Record<string, unknown>, role: string): string | undefined {
  const content = payload['content']
  if (!Array.isArray(content)) return undefined
  const want = role === ROLE_ASSISTANT ? CONTENT_OUTPUT : CONTENT_INPUT
  const parts: string[] = []
  for (const item of content) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (record['type'] !== want) continue
    const text = record['text']
    if (typeof text === 'string') parts.push(text)
  }
  const joined = parts.join('\n')
  return joined.length === 0 ? undefined : joined
}

/** Read the raw JSON string a Codex tool call carried. */
function callArguments(payload: Record<string, unknown>): string {
  const input = payload['input']
  if (typeof input === 'string') return JSON.stringify({ input })
  const args = payload['arguments']
  if (typeof args === 'string') return args
  if (args !== undefined) return JSON.stringify(args)
  return '{}'
}

/** Flatten a Codex tool output payload into one text result. */
function outputText(payload: Record<string, unknown>): string {
  const output = payload['output']
  if (typeof output === 'string') return output
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (typeof item === 'string') { parts.push(item); continue }
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const text = (item as Record<string, unknown>)['text']
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

/** Parse an RFC 3339 timestamp to Unix milliseconds, falling back to a previous value. */
function timeOf(timestamp: string, fallback: number): number {
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? fallback : parsed
}

/**
 * Fold one thread's merged lines into DSH events.
 *
 * @param lines - merged, ordinal-ordered Codex lines for one thread.
 * @param cwdOverride - working directory to force, overriding the recorded one.
 * @returns the produced events, the skips, and recovered session metadata.
 */
export function foldThread(lines: readonly CodexRolloutLine[], cwdOverride?: string): FoldResult {
  const events: FoldedEvent[] = []
  const skipped: CodexSkip[] = []
  let createdAt = 0
  let cwd = cwdOverride
  let turn = 0
  let step = 0

  const push = (type: string, time: number, data: Record<string, unknown>, surface: boolean): void => {
    events.push({
      type,
      seq: events.length,
      time,
      data,
      ...surface ? { surfaceOp: 'append' as const } : {},
    })
  }

  let clock = 0
  for (const line of lines) {
    const at = timeOf(line.timestamp, clock)
    clock = at
    if (createdAt === 0) createdAt = at
    const payload = line.payload
    const kind = typeof payload['type'] === 'string' ? payload['type'] : ''

    if (line.type === 'session_meta') {
      const metaCwd = payload['cwd']
      if (cwd === undefined && typeof metaCwd === 'string') cwd = metaCwd
      const metaTime = typeof payload['timestamp'] === 'string' ? Date.parse(payload['timestamp']) : Number.NaN
      if (!Number.isNaN(metaTime)) createdAt = metaTime
      skipped.push({ ordinal: line.ordinal, type: 'session_meta', reason: 'session metadata is folded into the header' })
      continue
    }

    if (line.type === 'event_msg') {
      if (kind === 'task_started') {
        turn += 1
        step = 0
        push('turn/start', at, { turn }, false)
        continue
      }
      if (kind === 'task_complete') {
        push('turn/end', at, { turn, reason: { kind: 'completed' } }, false)
        continue
      }
      skipped.push({ ordinal: line.ordinal, type: kind || line.type, reason: 'duplicate view of a response_item' })
      continue
    }

    if (line.type !== 'response_item') {
      skipped.push({ ordinal: line.ordinal, type: kind || line.type, reason: 'envelope carries no model-visible content' })
      continue
    }

    if (kind === 'reasoning') {
      skipped.push({ ordinal: line.ordinal, type: 'reasoning', reason: 'Codex reasoning is an opaque encrypted blob' })
      continue
    }

    if (kind === 'message') {
      const role = typeof payload['role'] === 'string' ? payload['role'] : ''
      if (role !== ROLE_USER && role !== ROLE_ASSISTANT) {
        skipped.push({ ordinal: line.ordinal, type: `message:${role}`, reason: 'developer instructions are not conversation' })
        continue
      }
      if (role === ROLE_USER && isInjectedContext(payload)) {
        skipped.push({ ordinal: line.ordinal, type: 'message:user', reason: 'harness-injected context block' })
        continue
      }
      const text = messageText(payload, role)
      if (text === undefined) {
        skipped.push({ ordinal: line.ordinal, type: `message:${role}`, reason: 'message carried no text block' })
        continue
      }
      step += 1
      push('step/start', at, { turn, step }, false)
      const content: TextBlock[] = [{ type: 'text', text }]
      if (role === ROLE_USER) {
        push('user/message', at, {
          content,
          source: { kind: 'user' },
          role: 'user',
          id: crypto.randomUUID(),
        }, true)
      } else {
        push('assistant/message', at, {
          turn,
          step,
          message: {
            role: 'assistant',
            content,
            source: { kind: 'model', provider: 'codex', model: typeof payload['model'] === 'string' ? payload['model'] : 'codex' },
            id: crypto.randomUUID(),
          },
        }, true)
      }
      push('step/end', at, { turn, step }, false)
      continue
    }

    if (kind === 'custom_tool_call' || kind === 'function_call') {
      const callId = typeof payload['call_id'] === 'string'
        ? payload['call_id']
        : typeof payload['id'] === 'string' ? payload['id'] : crypto.randomUUID()
      const name = typeof payload['name'] === 'string' ? payload['name'] : 'codex'
      step += 1
      push('step/start', at, { turn, step }, false)
      push('tool/call', at, { turn, step, callId, name, arguments: callArguments(payload) }, false)
      push('step/end', at, { turn, step }, false)
      continue
    }

    if (kind === 'custom_tool_call_output' || kind === 'function_call_output') {
      const callId = typeof payload['call_id'] === 'string' ? payload['call_id'] : crypto.randomUUID()
      const text = outputText(payload)
      step += 1
      push('step/start', at, { turn, step }, false)
      push('tool/result', at, {
        turn,
        step,
        message: {
          role: 'user',
          source: { kind: 'tool', callId },
          content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError: false }],
          id: crypto.randomUUID(),
        },
      }, true)
      push('step/end', at, { turn, step }, false)
      continue
    }

    skipped.push({ ordinal: line.ordinal, type: kind || line.type, reason: 'no DSH equivalent' })
  }

  return { events, skipped, createdAt: createdAt === 0 ? Date.now() : createdAt, cwd }
}
