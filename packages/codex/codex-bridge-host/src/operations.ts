/**
 * Progress-reporting import, export, and listing for the browser panel.
 *
 * These operations wrap the pure bridge in {@link importThread} and
 * {@link exportSession} with the accounting a human watching a long import
 * needs: which shards were merged, how many lines the fold dropped and why, and
 * how large the artifact grew. The bridge itself stays a library; this module
 * is the Consumer that turns it into observable work.
 *
 * @module @deepseek-ai/dsh-codex-bridge-host/operations
 */

import { readdir, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  defaultCodexHome, defaultSessionRoot, exportSession, importThread,
  parseRolloutName, readThread,
} from '@deepseek-ai/dsh-codex-bridge'
import type { CodexSkip } from '@deepseek-ai/dsh-codex-bridge'
import type {
  CodexThreadSummary, DshSessionSummary, ListSessionsResponse, ListThreadsResponse,
  StartExportRequest, StartImportBatchRequest, StartImportRequest,
} from './types.ts'
import type { RunReporter } from './runs.ts'

/** Convert an RFC 3339 stamp from Codex's index into epoch milliseconds. */
function updatedAtMs(stamp: string | undefined): number | undefined {
  if (stamp === undefined) return undefined
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** Render a byte count in the units a person reads. */
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Normalize Codex's extended-length Windows path for display and grouping. */
function normalizeCwd(cwd: string): string {
  return cwd.length >= 4 && cwd[0] === '\\' && cwd[1] === '\\' && cwd[2] === '?' && cwd[3] === '\\' ? cwd.slice(4) : cwd
}

/** Use the final working-directory segment as the Codex project label. */
function projectName(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd.length === 0) return undefined
  const normalized = normalizeCwd(cwd).replace(/[\\/]+$/u, '')
  return normalized.split(/[\\/]/u).filter(Boolean).at(-1)
}

/** Read thread working directories from Codex's optional SQLite registry. */
function readThreadMetadata(databasePath: string): Map<string, { cwd: string; project?: string }> {
  const result = new Map<string, { cwd: string; project?: string }>()
  try {
    const db = new DatabaseSync(databasePath, { readOnly: true })
    try {
      for (const row of db.prepare('SELECT id, cwd FROM threads').all() as { id?: unknown; cwd?: unknown }[]) {
        if (typeof row.id !== 'string' || typeof row.cwd !== 'string' || row.cwd.length === 0) continue
        const project = projectName(row.cwd)
        result.set(row.id, project === undefined ? { cwd: row.cwd } : { cwd: row.cwd, project })
      }
    } finally { db.close() }
  } catch {
    // A missing or older Codex registry does not make rollout discovery fail.
  }
  return result
}

/**
 * Group the fold's skip list by reason for the log and result card.
 * @param skipped - the fold's per-line skip accounting.
 * @returns one entry per distinct reason, with its count, in first-seen order.
 */
export function summarizeSkips(skipped: readonly CodexSkip[]): { reason: string; count: number }[] {
  const byReason = new Map<string, number>()
  for (const skip of skipped) {
    byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1)
  }
  return [...byReason].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
}

/**
 * List the Codex threads on disk, newest first.
 *
 * A thread is discovered from its rollout files, and its title is joined from
 * Codex's session index when one is present. Threads the index does not
 * mention still appear, with no title: the rollout is the authority on what
 * exists, and the index is only a naming convenience.
 *
 * @param codexHome - Codex home to scan; defaults to `~/.codex`.
 * @returns the scanned home and its threads, newest first.
 */
export async function listThreads(codexHome?: string): Promise<ListThreadsResponse> {
  const root = codexHome ?? defaultCodexHome()
  const sessionsRoot = join(root, 'sessions')
  const { readIndex } = await import('@deepseek-ai/dsh-codex-bridge')
  const index = await readIndex(join(root, 'session_index.jsonl'))
  const metadata = readThreadMetadata(join(root, 'state_5.sqlite'))
  const byThread = new Map<string, { shards: number }>()
  async function walk(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(directory, entry.name)
      if (entry.isDirectory()) { await walk(child); continue }
      const parsed = parseRolloutName(entry.name)
      if (parsed === undefined) continue
      const current = byThread.get(parsed.threadId)
      byThread.set(parsed.threadId, { shards: (current?.shards ?? 0) + 1 })
    }
  }
  await walk(sessionsRoot)
  const threads: CodexThreadSummary[] = [...byThread].map(([id, info]) => {
    const named = index.get(id)
    const meta = metadata.get(id)
    const updatedAt = updatedAtMs(named?.updated_at)
    return {
      id,
      shards: info.shards,
      ...named?.thread_name !== undefined ? { title: named.thread_name } : {},
      ...meta?.cwd !== undefined ? { cwd: meta.cwd } : {},
      ...meta?.project !== undefined ? { project: meta.project } : {},
      ...updatedAt !== undefined ? { updatedAt } : {},
    }
  })
  threads.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return { codexHome: root, threads }
}

/**
 * List the DSH session artifacts under a session root, newest first.
 * @param sessionRoot - session root to scan; defaults to `$DSH_HOME/sessions`.
 * @returns the scanned root and its sessions, newest first.
 */
export async function listSessions(sessionRoot?: string): Promise<ListSessionsResponse> {
  const root = sessionRoot ?? defaultSessionRoot()
  const sessions: DshSessionSummary[] = []
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch {
    return { sessionRoot: root, sessions }
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = join(root, project.name)
    let children
    try {
      children = await readdir(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      if (!child.isDirectory()) continue
      const artifact = join(projectDir, child.name, 'session.jsonl.zstd')
      try {
        const info = await stat(artifact)
        sessions.push({
          id: child.name,
          project: project.name,
          bytes: info.size,
          updatedAt: info.mtimeMs,
        })
      } catch {
        continue
      }
    }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return { sessionRoot: root, sessions }
}

/**
 * Import one Codex thread, reporting progress through a run reporter.
 *
 * The reported stages follow the work: locate the rollout, merge its shard
 * chain, fold its lines, then write the artifact. Progress is assigned per
 * stage rather than per line, because the fold is synchronous and a browser
 * polling every few hundred milliseconds would never see intra-fold movement.
 *
 * @param request - thread selection and root overrides.
 * @param reporter - the run this operation reports through.
 * @returns the terminal run result, already settled on the reporter.
 */
export async function runImport(request: StartImportRequest, reporter: RunReporter): Promise<void> {
  const codexHome = request.codexHome ?? defaultCodexHome()
  const sessionRoot = request.sessionRoot ?? defaultSessionRoot()
  try {
    reporter.stage('locating rollout')
    reporter.progress(0.05)
    reporter.log('info', `Codex home: ${codexHome}`)
    reporter.log('info', `Session root: ${sessionRoot}`)
    const found = await readThread(join(codexHome, 'sessions'), request.threadId)
    if (found === undefined) {
      throw new Error(`no Codex rollout found for thread ${request.threadId}`)
    }
    reporter.progress(0.2)
    reporter.log('info', `found ${String(found.thread.shards.length)} rollout shard(s)`)
    for (const shard of found.thread.shards) reporter.log('info', `  shard ${shard.path}`)
    if (found.duplicateOrdinals > 0) {
      reporter.log('warn', `de-duplicated ${String(found.duplicateOrdinals)} ordinal(s) shared across shards`)
    }

    reporter.stage('folding events')
    reporter.progress(0.35)
    const report = await importThread({
      codexHome,
      sessionRoot,
      threadId: request.threadId,
      ...request.cwd !== undefined ? { cwd: request.cwd } : {},
    })
    reporter.progress(0.85)

    reporter.stage('writing artifact')
    for (const group of summarizeSkips(report.skipped)) {
      reporter.log('info', `skipped ${String(group.count)} — ${group.reason}`)
    }
    reporter.log('info', `wrote ${humanBytes(report.artifactBytes)} across ${String(report.eventCount)} event(s)`)
    reporter.progress(1)
    reporter.settle({
      ok: true,
      summary: `Imported thread ${request.threadId} as ${report.sessionId}`,
      facts: [
        { label: 'session id', value: report.sessionId },
        { label: 'artifact', value: report.artifactPath },
        { label: 'events', value: String(report.eventCount) },
        { label: 'shards', value: String(report.shards.length) },
        { label: 'artifact size', value: humanBytes(report.artifactBytes) },
        { label: 'lines skipped', value: String(report.skipped.length) },
      ],
    })
  } catch (error) {
    reporter.log('error', error instanceof Error ? error.message : String(error))
    reporter.settle({ ok: false, summary: 'Import failed', facts: [] })
  }
}

/**
 * Import a group of Codex threads sequentially and report one aggregate result.
 * @param request - thread ids and root overrides.
 * @param reporter - the aggregate run reporter.
 */
export async function runImportBatch(request: StartImportBatchRequest, reporter: RunReporter): Promise<void> {
  const codexHome = request.codexHome ?? defaultCodexHome()
  const sessionRoot = request.sessionRoot ?? defaultSessionRoot()
  let succeeded = 0
  let failed = 0
  reporter.stage('importing project')
  reporter.log('info', `importing ${String(request.threadIds.length)} thread(s)`)
  for (const [index, threadId] of request.threadIds.entries()) {
    const start = index / request.threadIds.length
    const end = (index + 1) / request.threadIds.length
    try {
      reporter.stage(`importing thread ${String(index + 1)} of ${String(request.threadIds.length)}`)
      reporter.progress(start + 0.05 * (end - start))
      const report = await importThread({ codexHome, sessionRoot, threadId })
      succeeded += 1
      reporter.log('info', `imported ${threadId} as ${report.sessionId}`)
      reporter.progress(end)
    } catch (error) {
      failed += 1
      reporter.log('error', `${threadId}: ${error instanceof Error ? error.message : String(error)}`)
      reporter.progress(end)
    }
  }
  reporter.settle({
    ok: failed === 0,
    summary: `Imported ${String(succeeded)} of ${String(request.threadIds.length)} thread(s)`,
    facts: [
      { label: 'successful', value: String(succeeded) },
      { label: 'failed', value: String(failed) },
      { label: 'total', value: String(request.threadIds.length) },
      { label: 'session root', value: sessionRoot },
    ],
  })
}

/**
 * Export one DSH session as a Codex thread, reporting progress.
 * @param request - session selection, destination, and dry-run flag.
 * @param reporter - the run this operation reports through.
 * @returns the terminal run result, already settled on the reporter.
 */
export async function runExport(request: StartExportRequest, reporter: RunReporter): Promise<void> {
  const sessionRoot = request.sessionRoot ?? defaultSessionRoot()
  const codexHome = request.codexHome ?? defaultCodexHome()
  try {
    reporter.stage('reading session')
    reporter.progress(0.1)
    reporter.log('info', `session root: ${sessionRoot}`)
    reporter.log('info', `Codex home: ${codexHome}`)
    if (request.dryRun) reporter.log('warn', 'dry run: nothing will be written')

    const stamp = new Date()
    const outDir = join(
      codexHome, 'sessions',
      String(stamp.getFullYear()),
      String(stamp.getMonth() + 1).padStart(2, '0'),
      String(stamp.getDate()).padStart(2, '0'),
    )
    const report = await exportSession({
      sessionRoot,
      sessionId: request.sessionId,
      codexHome,
      outDir,
      dryRun: request.dryRun,
    })
    reporter.progress(0.9)
    reporter.stage('writing rollout')
    reporter.log('info', `rendered ${String(report.lineCount)} rollout line(s)`)
    reporter.log('info', `skipped ${String(report.skippedEvents)} non-representable event(s)`)
    if (report.written) {
      reporter.log('info', `rollout: ${report.rolloutPath}`)
      reporter.log('info', 'registered index entry and threads row')
    }
    reporter.progress(1)
    reporter.settle({
      ok: true,
      summary: request.dryRun
        ? `Dry run: would export ${request.sessionId} as ${report.threadId}`
        : `Exported ${request.sessionId} as thread ${report.threadId}`,
      facts: [
        { label: 'thread id', value: report.threadId },
        { label: 'rollout', value: report.rolloutPath },
        { label: 'lines', value: String(report.lineCount) },
        { label: 'skipped events', value: String(report.skippedEvents) },
        { label: 'rollout size', value: humanBytes(report.rolloutBytes) },
        { label: 'written', value: report.written ? 'yes' : 'no (dry run)' },
      ],
    })
  } catch (error) {
    reporter.log('error', error instanceof Error ? error.message : String(error))
    reporter.settle({ ok: false, summary: 'Export failed', facts: [] })
  }
}
