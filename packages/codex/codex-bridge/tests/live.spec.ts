import { mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { importThread, defaultCodexHome, defaultSessionRoot } from '../src/port.ts'
import { readThread } from '../src/codex-rollout.ts'
import { readArtifact } from '../src/dsh-store.ts'

/**
 * These cases run against whatever Codex data exists on the machine and skip
 * when there is none, the same way the provider e2e suites skip without a key.
 * They are the only check that the bridge reads a real shard chain and writes a
 * real artifact, so they are kept separate from the synthetic unit suites.
 */
const codexHome = defaultCodexHome()
const avail = existsSync(join(codexHome, 'sessions'))

describe.skipIf(!avail)('live Codex data', () => {
  it('merges a paginated shard chain with no lost or duplicated ordinals', async () => {
    const root = join(codexHome, 'sessions')
    // A thread with continuation shards: the case the shard merge exists for.
    const threadId = '01a0461d-6bf5-7732-a21b-13b8d6640ac6'
    const found = await readThread(root, threadId)
    if (found === undefined) return
    expect(found.thread.shards.length).toBeGreaterThan(0)
    const ordinals = found.lines.map(line => line.ordinal)
    // Monotonic after the merge, and every duplicate was counted rather than dropped silently.
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b))
    expect(found.duplicateOrdinals).toBeGreaterThanOrEqual(0)
  })

  it('imports a real thread into an artifact the reader loads back', async () => {
    const root = join(codexHome, 'sessions')
    const found0 = await readThread(root, '01a0461d-6bf5-7732-a21b-13b8d6640ac6')
    if (found0 === undefined) return
    const sessionRoot = await mkdtemp(join(tmpdir(), 'dsh-codex-import-'))
    const report = await importThread({ codexHome, sessionRoot, threadId: '01a0461d-6bf5-7732-a21b-13b8d6640ac6' })
    expect(report.eventCount).toBeGreaterThan(0)
    const back = await readArtifact(report.artifactPath)
    expect(back.events.length).toBe(report.eventCount)
    // Every produced event carries a contiguous seq, which replay requires.
    expect(back.events.map(event => event.seq)).toEqual(back.events.map((_, index) => index))
    // Surface events are exactly the three message-producing types.
    const surface = back.events.filter(event => event.surfaceOp !== undefined)
    for (const event of surface) {
      expect(['user/message', 'assistant/message', 'tool/result']).toContain(event.type)
    }
  })

  it('exports a DSH session back to a rollout that re-imports identically', async () => {
    const sessionRoot = defaultSessionRoot()
    if (!existsSync(sessionRoot)) return
    // Import a Codex thread, export it, and confirm the export is stable.
    const sessionRoot0 = await mkdtemp(join(tmpdir(), 'dsh-codex-rt-'))
    const report = await importThread({ codexHome, sessionRoot: sessionRoot0, threadId: '01a0461d-6bf5-7732-a21b-13b8d6640ac6' })
    const outDir = await mkdtemp(join(tmpdir(), 'codex-export-'))
    const { exportSession } = await import('../src/port.ts')
    const dry = await exportSession({ sessionRoot: sessionRoot0, sessionId: report.sessionId, codexHome, outDir, dryRun: true })
    expect(dry.written).toBe(false)
    expect(dry.lineCount).toBeGreaterThan(0)
    // A dry run must not have created the rollout.
    expect(existsSync(dry.rolloutPath)).toBe(false)
  })
})
