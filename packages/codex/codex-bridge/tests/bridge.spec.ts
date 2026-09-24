import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { buildRollout } from '../src/port.ts'
import { packArtifact, readArtifact, scanFrames, unpackArtifact } from '../src/dsh-store.ts'
import { foldThread } from '../src/fold.ts'
import { mergeThreadLines, parseRolloutName } from '../src/codex-rollout.ts'
import { readIndex, toExtendedPath, upsertThreadRow } from '../src/codex-store.ts'
import type { CodexRolloutLine } from '../src/types.ts'

/** Build one Codex envelope line with a given ordinal and payload. */
function line(ordinal: number, type: string, payload: Record<string, unknown>, timestamp = '2026-09-22T07:08:36.533Z'): CodexRolloutLine {
  return { timestamp, ordinal, type, payload }
}

/** Wrap lines as rollout text, matching the on-disk one-object-per-line layout. */
function rolloutText(lines: readonly CodexRolloutLine[]): string {
  return lines.map(entry => JSON.stringify(entry)).join('\n') + '\n'
}

describe('parseRolloutName', () => {
  it('resolves a base rollout to its thread with no shard', () => {
    expect(parseRolloutName('rollout-2026-08-28T10-05-28-01a0461d-6bf5-7732-a21b-13b8d6640ac6.jsonl'))
      .toEqual({ threadId: '01a0461d-6bf5-7732-a21b-13b8d6640ac6' })
  })

  it('resolves a continuation shard to its thread and shard id', () => {
    const parsed = parseRolloutName('rollout-2026-08-31T09-38-50-01a0461d-6bf5-7732-a21b-13b8d6640ac6_01a05578-1d37-7d02-8918-5c9377c136e2.jsonl')
    expect(parsed).toEqual({
      threadId: '01a0461d-6bf5-7732-a21b-13b8d6640ac6',
      shardId: '01a05578-1d37-7d02-8918-5c9377c136e2',
    })
  })

  it('rejects a non-rollout filename', () => {
    expect(parseRolloutName('session.jsonl')).toBeUndefined()
  })
})

describe('mergeThreadLines', () => {
  it('orders by ordinal and drops ordinals an earlier shard already supplied', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-merge-'))
    const base = join(dir, 'rollout-2026-01-01T00-00-00-t.jsonl')
    const shard = join(dir, 'rollout-2026-01-02T00-00-00-t_s.jsonl')
    // The shard overlaps the base at ordinals 1 and 2, then continues at 3.
    await writeFile(base, rolloutText([
      line(0, 'session_meta', { cwd: '/work' }),
      line(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'one' }] }),
      line(2, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'two' }] }),
    ]))
    await writeFile(shard, rolloutText([
      line(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'one' }] }),
      line(2, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'two' }] }),
      line(3, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'three' }] }),
    ]))
    const { lines, duplicateOrdinals } = await mergeThreadLines({
      id: 't',
      shards: [
        { path: base, bytes: 0, firstOrdinal: 0, lastOrdinal: 2, lineCount: 3 },
        { path: shard, bytes: 0, firstOrdinal: 1, lastOrdinal: 3, lineCount: 3 },
      ],
    })
    expect(lines.map(entry => entry.ordinal)).toEqual([0, 1, 2, 3])
    expect(duplicateOrdinals).toBe(2)
  })
})

describe('foldThread', () => {
  it('maps Codex messages into DSH surface events and drops duplicates', () => {
    const folded = foldThread([
      line(0, 'session_meta', { id: 't', cwd: 'D:\\work' }),
      line(1, 'event_msg', { type: 'task_started', turn_id: 'turn-1' }),
      line(2, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }),
      line(3, 'event_msg', { type: 'item_completed', item: { type: 'UserMessage' } }),
      line(4, 'response_item', { type: 'reasoning', encrypted_content: 'opaque' }),
      line(5, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }),
      line(6, 'event_msg', { type: 'task_complete' }),
    ])
    const types = folded.events.map(event => event.type)
    expect(types).toEqual([
      'turn/start',
      'step/start', 'user/message', 'step/end',
      'step/start', 'assistant/message', 'step/end',
      'turn/end',
    ])
    // Contiguous seq from zero is a replay requirement.
    expect(folded.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // Reasoning and the duplicated event_msg view are reported, never silently dropped.
    expect(folded.skipped.map(skip => skip.reason)).toContain('Codex reasoning is an opaque encrypted blob')
    expect(folded.skipped.map(skip => skip.reason)).toContain('duplicate view of a response_item')
    expect(folded.cwd).toBe('D:\\work')
  })

  it('drops harness-injected user context blocks', () => {
    const folded = foldThread([
      line(0, 'response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>...</environment_context>' }],
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['environments.environment_context'] },
      }),
    ])
    expect(folded.events).toEqual([])
    expect(folded.skipped[0]?.reason).toBe('harness-injected context block')
  })

  it('keeps a direct prompt that carries the plain instructions marker', () => {
    const folded = foldThread([
      line(0, 'response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'real prompt' }],
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.instructions'] },
      }),
    ])
    expect(folded.events.some(event => event.type === 'user/message')).toBe(true)
  })
})

describe('artifact framing', () => {
  it('writes a header frame plus event frames that decode back identically', async () => {
    const folded = foldThread([
      line(0, 'session_meta', { cwd: 'D:\\work' }),
      line(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }),
    ])
    const artifact = packArtifact({ id: 'session-x', createdAt: 1000, cwd: 'D:\\work' }, folded.events, 1)
    const { frames } = scanFrames(artifact)
    // One header frame plus one frame per event.
    expect(frames.length).toBe(folded.events.length + 1)
    // Frames tile the artifact with no gap and no overlap.
    let cursor = 0
    for (const frame of frames) {
      expect(frame.start).toBe(cursor)
      cursor = frame.end
    }
    expect(cursor).toBe(artifact.length)

    const back = unpackArtifact(artifact)
    expect(back.header['id']).toBe('session-x')
    expect(back.header['version']).toBe(0)
    expect(back.events).toEqual(folded.events)
  })

  it('decodes a header-only artifact to zero events', () => {
    // A header frame with no event frames is the minimal valid artifact.
    const artifact = packArtifact({ id: 'a', createdAt: 1 }, [])
    expect(scanFrames(artifact).frames.length).toBe(1)
    expect(unpackArtifact(artifact).events).toEqual([])
  })
})

describe('readArtifact', () => {
  it('round-trips a written artifact through disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-artifact-'))
    const path = join(dir, 'session.jsonl.zstd')
    const folded = foldThread([
      line(0, 'session_meta', { cwd: '/w' }),
      line(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'disk' }] }),
    ])
    const artifact = packArtifact({ id: 'session-d', createdAt: 5, cwd: '/w' }, folded.events)
    const { writeArtifact } = await import('../src/dsh-store.ts')
    await writeArtifact(path, artifact)
    const back = await readArtifact(path)
    expect(back.header['id']).toBe('session-d')
    expect(back.events).toEqual(folded.events)
  })
})

describe('buildRollout', () => {
  it('emits a session_meta line then one line per exportable event', async () => {
    const folded = foldThread([
      line(0, 'session_meta', { cwd: 'D:\\work' }),
      line(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'question' }] }),
      line(2, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] }),
    ])
    const artifact = packArtifact({ id: 'session-e', createdAt: 2000, cwd: 'D:\\work' }, folded.events)
    const built = buildRollout(artifact, 'thread-1')
    const first = JSON.parse(built.lines[0]!) as Record<string, unknown>
    expect(first['type']).toBe('session_meta')
    expect((first['payload'] as Record<string, unknown>)['session_id']).toBe('thread-1')
    // Turn/step boundaries have no Codex equivalent, so they are skipped and counted.
    expect(built.skipped).toBeGreaterThan(0)
    expect(built.cwd).toBe('D:\\work')
    expect(built.firstUserMessage).toBe('question')
  })
})

describe('codex registry', () => {
  it('reads an append-only index with later lines winning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-index-'))
    const path = join(dir, 'session_index.jsonl')
    await writeFile(path, [
      JSON.stringify({ id: 'a', thread_name: 'first', updated_at: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ id: 'a', thread_name: 'second', updated_at: '2026-02-01T00:00:00Z' }),
      JSON.stringify({ id: 'b', thread_name: 'other', updated_at: '2026-02-02T00:00:00Z' }),
    ].join('\n') + '\n')
    const index = await readIndex(path)
    expect(index.get('a')?.thread_name).toBe('second')
    expect(index.size).toBe(2)
  })

  it('renders the extended-length path form Codex stores', () => {
    expect(toExtendedPath('C:\\Users\\x')).toBe('\\\\?\\C:\\Users\\x')
    // Already-prefixed input is left alone rather than double-prefixed.
    expect(toExtendedPath('\\\\?\\C:\\Users\\x')).toBe('\\\\?\\C:\\Users\\x')
  })

  it('writes a thread row the real schema accepts and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-sqlite-'))
    const path = join(dir, 'state_5.sqlite')
    // Recreate the columns the bridge writes, copied from the shipped schema.
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      first_user_message TEXT NOT NULL DEFAULT '',
      history_mode TEXT NOT NULL DEFAULT 'legacy',
      recency_at_ms INTEGER NOT NULL DEFAULT 0
    )`)
    db.close()
    upsertThreadRow(path, {
      id: 'thread-1',
      rollout_path: toExtendedPath('C:\\r.jsonl'),
      created_at: 10,
      updated_at: 10,
      source: 'cli',
      model_provider: 'openai',
      cwd: 'D:\\work',
      title: 'imported',
      sandbox_policy: '{"type":"disabled"}',
      approval_mode: 'never',
      history_mode: 'legacy',
      first_user_message: 'hello',
      recency_at_ms: 10000,
    })
    const db2 = new DatabaseSync(path, { readOnly: true })
    const row = db2.prepare('SELECT * FROM threads WHERE id = ?').get('thread-1') as Record<string, unknown>
    db2.close()
    expect(row['title']).toBe('imported')
    expect(row['history_mode']).toBe('legacy')
    expect(row['cwd']).toBe('D:\\work')
  })
})
