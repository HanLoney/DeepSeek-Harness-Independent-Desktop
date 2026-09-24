/**
 * Command-line entry for the Codex bridge.
 *
 * `dsh-codex-bridge list|import|export` — the operations a developer runs by
 * hand when moving work between Codex and the harness. The module is also a
 * library (`./index.ts`); this file only parses arguments, calls one operation,
 * and prints a report.
 *
 * @module @deepseek-ai/dsh-codex-bridge/cli
 */

import { join } from 'node:path'
import { readIndex } from './codex-store.ts'
import { parseRolloutName } from './codex-rollout.ts'
import { defaultCodexHome, defaultSessionRoot, exportSession, importThread } from './port.ts'
import { readdir } from 'node:fs/promises'

/** Print usage and exit non-zero. */
function usage(message?: string): never {
  if (message !== undefined) console.error(message)
  console.error([
    'usage:',
    '  codex-bridge list [--codex-home <dir>]',
    '  codex-bridge import <threadId> [--session-root <dir>] [--codex-home <dir>] [--cwd <dir>]',
    '  codex-bridge export <sessionId> [--out-dir <dir>] [--artifact <path>] [--dry-run] [--codex-home <dir>]',
  ].join('\n'))
  process.exit(2)
}

/** Read one `--flag value` pair, consuming the flag from the argument list. */
function takeFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  const value = args[index + 1]
  args.splice(index, value === undefined ? 1 : 2)
  return value
}

/**
 * Run one bridge command.
 *
 * @param argv - the process arguments after the script name.
 */
export async function main(argv: readonly string[]): Promise<void> {
  const args = [...argv]
  const command = args.shift()
  if (command === undefined) usage()
  const codexHome = takeFlag(args, '--codex-home') ?? defaultCodexHome()

  if (command === 'list') {
    const index = await readIndex(join(codexHome, 'session_index.jsonl'))
    const sessionsRoot = join(codexHome, 'sessions')
    const seen = new Set<string>()
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) { await walk(child); continue }
        const parsed = parseRolloutName(entry.name)
        if (parsed !== undefined) seen.add(parsed.threadId)
      }
    }
    try { await walk(sessionsRoot) } catch { /* no sessions tree yet */ }
    for (const id of [...seen].sort()) {
      const entry = index.get(id)
      console.log(`${id}  ${entry?.thread_name ?? '(untitled)'}`)
    }
    console.log(`\n${seen.size} thread(s); ${index.size} in the sidebar index`)
    return
  }

  if (command === 'import') {
    const threadId = args.shift()
    if (threadId === undefined) usage('import requires a thread id')
    const sessionRoot = takeFlag(args, '--session-root') ?? defaultSessionRoot()
    const cwd = takeFlag(args, '--cwd')
    const report = await importThread({
      codexHome,
      sessionRoot,
      threadId,
      ...cwd !== undefined ? { cwd } : {},
    })
    console.log(`session   ${report.sessionId}`)
    console.log(`artifact  ${report.artifactPath}`)
    console.log(`shards    ${report.shards.length} (${report.duplicateOrdinals} duplicate ordinals dropped)`)
    console.log(`events    ${report.eventCount}`)
    console.log(`bytes     ${report.artifactBytes}`)
    const reasons: Record<string, number> = {}
    for (const skip of report.skipped) reasons[skip.reason] = (reasons[skip.reason] ?? 0) + 1
    console.log('skipped:')
    for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(6)}  ${reason}`)
    }
    return
  }

  if (command === 'export') {
    const sessionId = args.shift()
    if (sessionId === undefined) usage('export requires a session id')
    const outDir = takeFlag(args, '--out-dir') ?? join(codexHome, 'sessions')
    const artifactPath = takeFlag(args, '--artifact')
    const dryRun = args.includes('--dry-run')
    const report = await exportSession({
      sessionRoot: takeFlag(args, '--session-root') ?? defaultSessionRoot(),
      sessionId,
      codexHome,
      outDir,
      ...artifactPath !== undefined ? { artifactPath } : {},
      dryRun,
    })
    console.log(`thread    ${report.threadId}${report.written ? '' : '  (dry run — nothing written)'}`)
    console.log(`rollout   ${report.rolloutPath}`)
    console.log(`lines     ${report.lineCount}`)
    console.log(`bytes     ${report.rolloutBytes}`)
    console.log(`skipped   ${report.skippedEvents} events with no Codex equivalent`)
    return
  }

  usage(`unknown command: ${command}`)
}

await main(process.argv.slice(2))
