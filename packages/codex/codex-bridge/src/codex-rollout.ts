/**
 * Read Codex rollout artifacts: locate the shards belonging to one thread,
 * order them, and yield their lines de-duplicated by `ordinal`.
 *
 * A Codex rollout filename encodes its thread: `rollout-<ts>-<threadId>.jsonl`
 * is the base shard, and `rollout-<ts>-<threadId>_<shardId>.jsonl` is a
 * continuation. Continuation shards resume the parent thread's `ordinal`
 * numbering rather than restarting it, and a shard may begin before the
 * previous shard ends, so consecutive shards overlap. Unioning by `ordinal`
 * — lowest-first among equal ordinals in filename order — reconstructs the
 * thread exactly once.
 *
 * @module @deepseek-ai/dsh-codex-bridge/codex-rollout
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexRolloutLine, CodexRolloutShard, CodexThread } from './types.ts'

/** Filename infix that separates a base thread id from a continuation shard id. */
const SHARD_SEPARATOR = '_'

/** One parsed rollout line paired with the position it occupied in its shard. */
interface RawLine {
  /** The decoded line, or `undefined` when the line was not valid JSON. */
  value: CodexRolloutLine | undefined
  /** Ordinal when readable, else `undefined`. */
  ordinal: number | undefined
}

/**
 * Resolve one rollout filename to its thread id and shard id.
 *
 * @param filename - basename of a `rollout-*.jsonl` artifact.
 * @returns the thread id, the optional shard id, and any encoded timestamp.
 */
export function parseRolloutName(filename: string): {
  threadId: string
  shardId?: string
} | undefined {
  const stem = filename.endsWith('.jsonl') ? filename.slice(0, -'.jsonl'.length) : filename
  if (!stem.startsWith('rollout-')) return undefined
  const body = stem.slice('rollout-'.length)
  const segments = body.split('-')
  // rollout-<YYYY>-<MM>-<DD>T<hh>-<mm>-<ss>-<id>[ _<shardId>]
  // The leading timestamp occupies five segments (the date carries no
  // separator before its time), then the id's own hyphenated groups follow.
  const TIMESTAMP_SEGMENTS = 5
  if (segments.length <= TIMESTAMP_SEGMENTS) return undefined
  const tail = segments.slice(TIMESTAMP_SEGMENTS).join('-')
  const separator = tail.indexOf(SHARD_SEPARATOR)
  if (separator === -1) return { threadId: tail }
  return { threadId: tail.slice(0, separator), shardId: tail.slice(separator + 1) }
}

/** Parse one raw line into its envelope, tolerating an unparseable line. */
function parseLine(raw: string): RawLine {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { value: undefined, ordinal: undefined }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { value: undefined, ordinal: undefined }
  }
  const record = parsed as Record<string, unknown>
  const ordinal = typeof record['ordinal'] === 'number' && Number.isSafeInteger(record['ordinal'])
    ? record['ordinal']
    : undefined
  const type = record['type']
  const payload = record['payload']
  if (typeof type !== 'string' || typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { value: undefined, ordinal }
  }
  const value: CodexRolloutLine = {
    timestamp: typeof record['timestamp'] === 'string' ? record['timestamp'] : '',
    ordinal: ordinal ?? -1,
    type,
    payload: payload as Record<string, unknown>,
    ...typeof record['metadata'] === 'object' && record['metadata'] !== null && !Array.isArray(record['metadata'])
      ? { metadata: record['metadata'] as Record<string, unknown> }
      : {},
  }
  return { value, ordinal }
}

/**
 * Read one shard file and report the ordinal span it covers.
 *
 * @param path - absolute path of the shard.
 * @returns the shard descriptor; a file with no parseable line reports undefined ordinals.
 */
export async function readShard(path: string): Promise<{ shard: CodexRolloutShard; lines: RawLine[] }> {
  const text = await readFile(path, 'utf8')
  const lines: RawLine[] = []
  let first: number | undefined
  let last: number | undefined
  let count = 0
  for (const raw of text.split('\n')) {
    if (raw.length === 0) continue
    count += 1
    const parsed = parseLine(raw)
    lines.push(parsed)
    if (parsed.ordinal !== undefined) {
      if (first === undefined) first = parsed.ordinal
      last = parsed.ordinal
    }
  }
  const info = await stat(path)
  return {
    shard: { path, bytes: info.size, firstOrdinal: first, lastOrdinal: last, lineCount: count },
    lines,
  }
}

/**
 * Locate every shard belonging to one thread beneath a Codex sessions root.
 *
 * @param sessionsRoot - the `~/.codex/sessions` directory.
 * @param threadId - thread id whose shards are collected.
 * @returns the thread descriptor with its shards ordered by first ordinal.
 */
export async function findThread(sessionsRoot: string, threadId: string): Promise<CodexThread | undefined> {
  const matches: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(child); continue }
      if (!entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) continue
      const parsed = parseRolloutName(entry.name)
      if (parsed?.threadId === threadId) matches.push(child)
    }
  }
  await walk(sessionsRoot)
  if (matches.length === 0) return undefined

  const shards: CodexRolloutShard[] = []
  for (const path of matches.sort()) {
    const { shard } = await readShard(path)
    shards.push(shard)
  }
  shards.sort((a, b) => (a.firstOrdinal ?? Number.MAX_SAFE_INTEGER) - (b.firstOrdinal ?? Number.MAX_SAFE_INTEGER))
  return { id: threadId, shards }
}

/**
 * Yield one thread's lines in ordinal order, dropping every ordinal already
 * emitted by an earlier shard.
 *
 * @param thread - thread whose shard chain is merged.
 * @returns the merged lines in ordinal order and the count of duplicates dropped.
 */
export async function mergeThreadLines(thread: CodexThread): Promise<{ lines: CodexRolloutLine[]; duplicateOrdinals: number }> {
  const byOrdinal = new Map<number, CodexRolloutLine>()
  const unplaced: CodexRolloutLine[] = []
  let duplicates = 0
  for (const { shard, lines } of await Promise.all(thread.shards.map(s => readShard(s.path)))) {
    void shard
    for (const { value, ordinal } of lines) {
      if (value === undefined) continue
      if (ordinal === undefined) { unplaced.push(value); continue }
      if (byOrdinal.has(ordinal)) { duplicates += 1; continue }
      byOrdinal.set(ordinal, value)
    }
  }
  const ordered = [...byOrdinal.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value)
  return { lines: [...ordered, ...unplaced], duplicateOrdinals: duplicates }
}

/**
 * Render one timestamp in the Codex rollout filename form:
 * `YYYY-MM-DDTHH-MM-SS` in UTC, with no milliseconds and no trailing zone.
 * {@link parseRolloutName} reads this back, so the two must move together.
 *
 * @param timeMs - Unix epoch milliseconds.
 * @returns the filename timestamp segment.
 */
export function formatRolloutStamp(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 19).replace(/:/g, '-')
}

/**
 * Build the Codex rollout filename for one thread.
 *
 * @param timeMs - creation time in Unix epoch milliseconds.
 * @param threadId - thread id the filename encodes.
 * @returns the `rollout-<stamp>-<threadId>.jsonl` basename.
 */
export function rolloutFilename(timeMs: number, threadId: string): string {
  return `rollout-${formatRolloutStamp(timeMs)}-${threadId}.jsonl`
}

/**
 * Read one thread's complete, de-duplicated line stream.
 *
 * @param sessionsRoot - the `~/.codex/sessions` directory.
 * @param threadId - thread id to read.
 * @returns the thread descriptor and merged lines, or `undefined` when no shard matched.
 */
export async function readThread(
  sessionsRoot: string,
  threadId: string,
): Promise<{ thread: CodexThread; lines: CodexRolloutLine[]; duplicateOrdinals: number } | undefined> {
  const thread = await findThread(sessionsRoot, threadId)
  if (thread === undefined) return undefined
  const { lines, duplicateOrdinals } = await mergeThreadLines(thread)
  return { thread, lines, duplicateOrdinals }
}
