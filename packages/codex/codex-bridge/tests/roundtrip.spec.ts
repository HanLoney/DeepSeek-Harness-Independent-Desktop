import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { importThread, exportSession, defaultCodexHome } from '../src/port.ts'
import { readArtifact } from '../src/dsh-store.ts'
import { findThread } from '../src/codex-rollout.ts'

/** Create a throwaway Codex home with the shipped threads schema. */
async function fakeCodexHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'fake-codex-'))
  await mkdir(join(home, 'sessions'), { recursive: true })
  const db = new DatabaseSync(join(home, 'state_5.sqlite'))
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL,
    cwd TEXT NOT NULL, title TEXT NOT NULL, sandbox_policy TEXT NOT NULL,
    approval_mode TEXT NOT NULL, first_user_message TEXT NOT NULL DEFAULT '',
    history_mode TEXT NOT NULL DEFAULT 'legacy', recency_at_ms INTEGER NOT NULL DEFAULT 0)`)
  db.close()
  return home
}

describe('full round trip through a throwaway Codex home', () => {
  it('imports, exports, registers, and re-imports the same conversation', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'dsh-src-'))
    const real = await importThread({
      codexHome: defaultCodexHome(),
      sessionRoot,
      threadId: '01a0461d-6bf5-7732-a21b-13b8d6640ac6',
    })
    expect(real.eventCount).toBeGreaterThan(0)

    const source = await readArtifact(real.artifactPath)
    const sourceMessages = source.events.filter(event =>
      event.type === 'user/message' || event.type === 'assistant/message').length

    const fakeHome = await fakeCodexHome()
    const outDir = join(fakeHome, 'sessions', '2026', '01', '01')
    const exported = await exportSession({
      sessionRoot,
      sessionId: real.sessionId,
      codexHome: fakeHome,
      outDir,
      dryRun: false,
    })
    expect(exported.written).toBe(true)
    expect(exported.lineCount).toBeGreaterThan(1)

    // The rollout is JSONL whose ordinals are contiguous from zero.
    const text = await readFile(exported.rolloutPath, 'utf8')
    const lines = text.split('\n').filter(line => line.length > 0)
    const parsedLines = lines.map(line => JSON.parse(line) as { ordinal: number; type: string })
    expect(parsedLines.map(entry => entry.ordinal)).toEqual(parsedLines.map((_, index) => index))
    expect(parsedLines[0]?.type).toBe('session_meta')

    // Both registry stores were updated.
    const index = await readFile(join(fakeHome, 'session_index.jsonl'), 'utf8')
    expect(index).toContain(exported.threadId)
    const db = new DatabaseSync(join(fakeHome, 'state_5.sqlite'), { readOnly: true })
    const row = db.prepare('SELECT id, history_mode FROM threads WHERE id = ?').get(exported.threadId) as Record<string, unknown>
    db.close()
    expect(row['history_mode']).toBe('legacy')

    // The exported thread is discoverable and re-imports to the same messages.
    const found = await findThread(join(fakeHome, 'sessions'), exported.threadId)
    expect(found?.shards.length).toBe(1)
    const back = await importThread({
      codexHome: fakeHome,
      sessionRoot: await mkdtemp(join(tmpdir(), 'dsh-back-')),
      threadId: exported.threadId,
    })
    const roundTripped = await readArtifact(back.artifactPath)
    // Every event type survives the round trip with the same count: messages,
    // tool calls and their outputs, and the turn and step boundaries.
    const countByType = (events: { type: string }[]): Record<string, number> => {
      const counts: Record<string, number> = {}
      for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
      return counts
    }
    expect(countByType(roundTripped.events)).toEqual(countByType(source.events))
    const roundTripMessages = roundTripped.events.filter(event =>
      event.type === 'user/message' || event.type === 'assistant/message').length
    expect(roundTripMessages).toBe(sourceMessages)

    const skipSummary: Record<string, number> = {}
    for (const skip of real.skipped) skipSummary[skip.reason] = (skipSummary[skip.reason] ?? 0) + 1
    console.log(`IMPORT events=${real.eventCount} shards=${real.shards.length} artifact=${real.artifactBytes}B`)
    for (const [reason, count] of Object.entries(skipSummary)) console.log(`  ${count}  ${reason}`)
    console.log(`EXPORT lines=${exported.lineCount} bytes=${exported.rolloutBytes} skippedEvents=${exported.skippedEvents}`)
    console.log(`MESSAGES source=${sourceMessages} roundTrip=${roundTripMessages}`)
  }, 120000)
})
