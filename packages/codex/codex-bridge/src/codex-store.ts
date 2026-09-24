/**
 * Read and write the Codex thread registry: the `session_index.jsonl` sidebar
 * index and the `state_5.sqlite` `threads` table.
 *
 * Codex discovers threads through both stores, and they are not redundant. The
 * index drives the recent-thread list; the `threads` row carries the metadata
 * the app reads to open a thread — cwd, provider, sandbox policy, history
 * mode. A rollout file present without either is an orphan the UI does not
 * show, so an export writes all three together or reports that it wrote none.
 *
 * `history_mode` decides whether the single rollout is the whole thread. A
 * `legacy` thread keeps every event in one file. A `paginated` thread splits
 * events across continuation shards whose filenames carry the parent thread id
 * plus a shard id. The bridge always writes `legacy`, so an exported thread
 * is self-contained and Codex can continue it without resolving a shard chain.
 *
 * @module @deepseek-ai/dsh-codex-bridge/codex-store
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import type { CodexIndexEntry, CodexThreadRow, WriteThreadOptions } from './types.ts'

/**
 * Render a working directory in the extended-length Windows form Codex stores.
 *
 * @param cwd - an absolute path.
 * @returns the path prefixed with the `\\?\` device namespace when it is absolute.
 */
export function toExtendedPath(cwd: string): string {
  if (cwd.startsWith('\\\\?\\')) return cwd
  return `\\\\?\\${cwd}`
}

/**
 * Append one entry to the Codex sidebar index.
 *
 * @param indexPath - absolute path of `session_index.jsonl`.
 * @param entry - the entry to append.
 */
export async function appendIndexEntry(indexPath: string, entry: CodexIndexEntry): Promise<void> {
  const line = JSON.stringify(entry) + '\n'
  await appendFile(indexPath, line, 'utf8')
}

/** Quote one SQL identifier for interpolation into a statement this module owns. */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Insert one `threads` row, replacing an existing row for the same id.
 *
 * @param databasePath - absolute path of `state_5.sqlite`.
 * @param row - the complete set of required columns.
 */
export function upsertThreadRow(databasePath: string, row: CodexThreadRow): void {
  const db = new DatabaseSync(databasePath)
  try {
    const columns = Object.keys(row) as (keyof CodexThreadRow)[]
    const placeholders = columns.map(() => '?').join(', ')
    const statement = db.prepare(
      `INSERT OR REPLACE INTO threads (${columns.map(column => quoteIdent(column)).join(', ')})
       VALUES (${placeholders})`,
    )
    statement.run(...columns.map(column => row[column]))
  } finally {
    db.close()
  }
}

/**
 * Read one thread row by id.
 *
 * @param databasePath - absolute path of `state_5.sqlite`.
 * @param id - thread id to look up.
 * @returns the row as a column map, or `undefined` when absent.
 */
export function readThreadRow(databasePath: string, id: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const row = db.prepare('SELECT * FROM threads WHERE id = ?').get(id)
    return row === undefined ? undefined : row
  } finally {
    db.close()
  }
}

/**
 * Read the sidebar index into an id-keyed lookup. Later lines win, matching the
 * append-only file's last-write-wins reading.
 *
 * @param indexPath - absolute path of `session_index.jsonl`.
 * @returns every entry by thread id.
 */
export async function readIndex(indexPath: string): Promise<Map<string, CodexIndexEntry>> {
  const { readFile } = await import('node:fs/promises')
  let text: string
  try {
    text = await readFile(indexPath, 'utf8')
  } catch {
    return new Map()
  }
  const entries = new Map<string, CodexIndexEntry>()
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
    const record = parsed as Record<string, unknown>
    if (typeof record['id'] !== 'string' || typeof record['thread_name'] !== 'string') continue
    entries.set(record['id'], {
      id: record['id'],
      thread_name: record['thread_name'],
      updated_at: typeof record['updated_at'] === 'string' ? record['updated_at'] : '',
    })
  }
  return entries
}

/**
 * Write a rollout artifact and register it in both Codex stores.
 *
 * @param options - the artifact bytes, its destination, and its registry row.
 * @returns the rollout path, whether anything was written, and the stores touched.
 */
export async function writeThread(options: WriteThreadOptions): Promise<{ written: boolean; stores: string[] }> {
  if (options.dryRun) return { written: false, stores: [] }
  const stores: string[] = []
  await mkdir(dirname(options.rolloutPath), { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(options.rolloutPath, options.rollout)
  stores.push(options.rolloutPath)

  const indexPath = join(options.codexHome, 'session_index.jsonl')
  await appendIndexEntry(indexPath, {
    id: options.threadId,
    thread_name: options.row.title,
    updated_at: new Date(options.row.recency_at_ms).toISOString(),
  })
  stores.push(indexPath)

  const databasePath = join(options.codexHome, 'state_5.sqlite')
  upsertThreadRow(databasePath, options.row)
  stores.push(databasePath)

  return { written: true, stores }
}
