/**
 * Import one Codex thread into a DSH session artifact, and export one back.
 *
 * An import is a pure transformation followed by one write: Codex shards are
 * merged, folded into the DSH event vocabulary, framed, and written under the
 * project directory the ordinary backend would choose. Nothing subscribes to a
 * live `Session`, so an import cannot disturb a running agent; the artifact
 * simply appears where the next open looks for it.
 *
 * An export is the same shape in reverse and always writes a `legacy` thread:
 * one self-contained rollout, one index entry, one `threads` row. Codex
 * continues a legacy thread by appending, so an exported thread needs no shard
 * chain and cannot desynchronize a paginated one.
 *
 * @module @deepseek-ai/dsh-codex-bridge/port
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CodexRolloutLine, CodexSkip, ExportOptions, ExportReport, FoldedEvent,
  ImportOptions, ImportReport,
} from './types.ts'
import { readThread, rolloutFilename } from './codex-rollout.ts'
import { foldThread } from './fold.ts'
import { artifactPath, packArtifact, unpackArtifact, writeArtifact } from './dsh-store.ts'
import type { CodexThreadRow } from './types.ts'
import { toExtendedPath, writeThread } from './codex-store.ts'

/**
 * Resolve the default Codex home directory for the current user.
 * @returns the `.codex` directory under `USERPROFILE` or `HOME`.
 */
export function defaultCodexHome(): string {
  const home = process.env['USERPROFILE'] ?? process.env['HOME']
  if (home === undefined) throw new Error('cannot resolve a Codex home directory: no USERPROFILE or HOME')
  return join(home, '.codex')
}

/**
 * Resolve the default DSH session root for the current user.
 * @returns the sessions directory under `DSH_HOME`, or `~/.dsh/sessions`.
 */
export function defaultSessionRoot(): string {
  const home = process.env['DSH_HOME'] ?? join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', '.dsh')
  return join(home, 'sessions')
}

/**
 * Import one Codex thread as a DSH session artifact.
 *
 * @param options - thread selection and destination roots.
 * @returns the generated session id, artifact path, and fold accounting.
 */
export async function importThread(options: ImportOptions): Promise<ImportReport> {
  const sessionsRoot = join(options.codexHome, 'sessions')
  const found = await readThread(sessionsRoot, options.threadId)
  if (found === undefined) {
    throw new Error(`no Codex rollout found for thread ${options.threadId} under ${sessionsRoot}`)
  }
  const folded = foldThread(found.lines, options.cwd)
  const cwd = options.cwd ?? folded.cwd
  const sessionId = `session-${crypto.randomUUID()}`
  const header = {
    id: sessionId,
    createdAt: folded.createdAt,
    ...cwd !== undefined ? { cwd } : {},
  }
  const artifact = packArtifact(header, folded.events)
  const path = artifactPath(options.sessionRoot, cwd, sessionId)
  await writeArtifact(path, artifact)
  return {
    threadId: options.threadId,
    sessionId,
    artifactPath: path,
    shards: found.thread.shards.map(s => s.path),
    duplicateOrdinals: found.duplicateOrdinals,
    eventCount: folded.events.length,
    skipped: folded.skipped,
    plaintextBytes: folded.events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0),
    artifactBytes: artifact.length,
  }
}

/** Render one DSH session event as a Codex rollout line, or skip it. */
function toRolloutLine(event: FoldedEvent, ordinal: number, threadId: string): { line: CodexRolloutLine; timestamp: string } | undefined {
  const timestamp = new Date(event.time).toISOString()
  const data = event.data
  const withTimes = (payload: Record<string, unknown>): CodexRolloutLine => ({
    timestamp,
    ordinal,
    type: 'response_item',
    payload,
  })

  if (event.type === 'user/message') {
    const content = Array.isArray(data['content']) ? data['content'] as { type: string; text?: string }[] : []
    const text = content.map(block => block.text ?? '').join('')
    return {
      timestamp,
      line: {
        timestamp,
        ordinal,
        type: 'response_item',
        payload: {
          type: 'message',
          id: `msg_${crypto.randomUUID()}`,
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      },
    }
  }

  if (event.type === 'assistant/message') {
    const message = data['message'] as Record<string, unknown> | undefined
    const content = Array.isArray(message?.['content']) ? message['content'] as { type: string; text?: string }[] : []
    const text = content.map(block => block.text ?? '').join('')
    return {
      timestamp,
      line: withTimes({
        type: 'message',
        id: `msg_${crypto.randomUUID()}`,
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      }),
    }
  }

  // Turn boundaries live in Codex's event_msg view, so an exported turn must
  // reappear as event_msg for a re-import to rebuild the same turn numbers.
  if (event.type === 'turn/start') {
    return {
      timestamp,
      line: { timestamp, ordinal, type: 'event_msg', payload: { type: 'task_started', turn_id: String(data['turn']) } },
    }
  }

  if (event.type === 'turn/end') {
    return {
      timestamp,
      line: { timestamp, ordinal, type: 'event_msg', payload: { type: 'task_complete', turn_id: String(data['turn']) } },
    }
  }

  if (event.type === 'tool/call') {
    const callId = typeof data['callId'] === 'string' ? data['callId'] : `call_${crypto.randomUUID()}`
    const name = typeof data['name'] === 'string' ? data['name'] : 'unknown'
    const args = typeof data['arguments'] === 'string' ? data['arguments'] : '{}'
    return { timestamp, line: withTimes({ type: 'function_call', call_id: callId, name, arguments: args }) }
  }

  if (event.type === 'tool/result') {
    const message = data['message'] as Record<string, unknown> | undefined
    const content = Array.isArray(message?.['content']) ? message['content'] as Record<string, unknown>[] : []
    const block = content.find(entry => entry['type'] === 'tool-result')
    const callId = typeof block?.['toolCallId'] === 'string' ? block['toolCallId'] : crypto.randomUUID()
    const inner = Array.isArray(block?.['content']) ? block['content'] as { text?: string }[] : []
    const output = inner.map(part => part.text ?? '').join('')
    return { timestamp, line: withTimes({ type: 'function_call_output', call_id: callId, output }) }
  }

  void threadId
  return undefined
}

/**
 * Build the rollout text for one DSH session artifact.
 *
 * @param buffer - the session artifact bytes.
 * @param threadId - thread id the rollout registers under.
 * @returns the rollout lines, the skipped-event count, the creation time, and the cwd.
 */
export function buildRollout(buffer: Buffer, threadId: string): {
  lines: string[]
  skipped: number
  createdAt: number
  cwd: string
  firstUserMessage: string
} {
  const { header, events } = unpackArtifact(buffer)
  const createdAt = typeof header['createdAt'] === 'number' ? header['createdAt'] : Date.now()
  const cwd = typeof header['cwd'] === 'string' ? header['cwd'] : ''
  const lines: string[] = []
  let skipped = 0
  let ordinal = 0
  let firstUserMessage = ''

  const meta = {
    timestamp: new Date(createdAt).toISOString(),
    ordinal: ordinal++,
    type: 'session_meta',
    payload: {
      session_id: threadId,
      id: threadId,
      timestamp: new Date(createdAt).toISOString(),
      cwd,
      originator: 'dsh-codex-bridge',
      source: 'cli',
      model_provider: 'openai',
      history_mode: 'legacy',
    },
  }
  lines.push(JSON.stringify(meta))

  for (const event of events) {
    const rendered = toRolloutLine(event, ordinal, threadId)
    if (rendered === undefined) { skipped += 1; continue }
    ordinal += 1
    lines.push(JSON.stringify(rendered.line))
    if (firstUserMessage.length === 0 && event.type === 'user/message') {
      const content = event.data['content'] as { text?: string }[] | undefined
      firstUserMessage = (content ?? []).map(block => block.text ?? '').join('').slice(0, 400)
    }
  }

  return { lines, skipped, createdAt, cwd, firstUserMessage }
}

/**
 * Export one DSH session as a Codex rollout plus its registry rows.
 *
 * @param options - session selection, destination, and dry-run flag.
 * @returns the rollout path, byte and line counts, and whether anything was written.
 */
export async function exportSession(options: ExportOptions): Promise<ExportReport> {
  const path = options.artifactPath ?? await findArtifact(options.sessionRoot, options.sessionId)
  const buffer = await readFile(path)
  const threadId = crypto.randomUUID()
  const built = buildRollout(buffer, threadId)
  const rollout = Buffer.from(built.lines.join('\n') + '\n', 'utf8')
  const createdAtMs = built.createdAt
  const rolloutPath = join(options.outDir, rolloutFilename(createdAtMs, threadId))

  if (!options.dryRun) {
    const row: CodexThreadRow = {
      id: threadId,
      rollout_path: toExtendedPath(rolloutPath),
      created_at: Math.floor(createdAtMs / 1000),
      updated_at: Math.floor(createdAtMs / 1000),
      source: 'cli',
      model_provider: 'openai',
      cwd: built.cwd,
      title: built.firstUserMessage.length > 0 ? built.firstUserMessage : 'Imported from DeepSeek Harness',
      sandbox_policy: JSON.stringify({ type: 'disabled' }),
      approval_mode: 'never',
      history_mode: 'legacy',
      first_user_message: built.firstUserMessage,
      recency_at_ms: createdAtMs,
    }
    await writeThread({
      codexHome: options.codexHome,
      threadId,
      rollout,
      rolloutPath,
      row,
      dryRun: false,
    })
  }

  return {
    sessionId: options.sessionId,
    threadId,
    rolloutPath,
    lineCount: built.lines.length,
    skippedEvents: built.skipped,
    rolloutBytes: rollout.length,
    createdAt: createdAtMs,
    cwd: built.cwd,
    written: !options.dryRun,
  }
}

/** Locate one session artifact beneath a session root by id. */
async function findArtifact(root: string, sessionId: string): Promise<string> {
  const { readdir } = await import('node:fs/promises')
  const projects = await readdir(root, { withFileTypes: true })
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = join(root, project.name, sessionId, 'session.jsonl.zstd')
    try {
      await readFile(candidate)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(`no session artifact found for ${sessionId} under ${root}`)
}

/** Re-export the fold and read surfaces this module's callers use together. */
export { foldThread } from './fold.ts'
export { packArtifact, unpackArtifact } from './dsh-store.ts'
export type { FoldedEvent, CodexSkip }
