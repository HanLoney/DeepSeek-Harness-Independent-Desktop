/**
 * Browser face of the Codex bridge RPC channel.
 *
 * The channel is owned by the Host package `@deepseek-ai/dsh-codex-bridge-host`
 * and carried by Connection's generic RPC registry, so this module only names
 * the endpoints and unwraps the transport's success/error result. Every value
 * here is plain JSON, mirroring that package's wire contract.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

/** The absolute RPC channel the Host half owns. */
const CHANNEL = '/codex-bridge'

/** One Codex thread offered for import. */
export interface CodexThreadSummary {
  /** Codex thread id. */
  id: string
  /** Sidebar title from Codex's session index, when present. */
  title?: string
  /** Working directory recorded by Codex, when present. */
  cwd?: string
  /** Project label derived from the working directory. */
  project?: string
  /** Last update time in epoch milliseconds, when present. */
  updatedAt?: number
  /** Rollout shard count. */
  shards: number
}

/** One DSH session offered for export. */
export interface DshSessionSummary {
  /** DSH session id. */
  id: string
  /** Project directory the artifact sits under. */
  project: string
  /** Artifact size in bytes. */
  bytes: number
  /** Artifact modification time in epoch milliseconds. */
  updatedAt: number
}

/** One progress line. */
export interface BridgeLogLine {
  /** Milliseconds since the Unix epoch. */
  at: number
  /** Severity the panel colours. */
  level: 'info' | 'warn' | 'error'
  /** The text. */
  text: string
}

/** Terminal summary of a finished run. */
export interface BridgeRunResult {
  /** Whether the operation completed its writes. */
  ok: boolean
  /** One-line outcome. */
  summary: string
  /** Key/value facts in display order. */
  facts: { label: string; value: string }[]
}

/** One import or export run, as the panel observes it. */
export interface BridgeRun {
  /** Opaque run id. */
  id: string
  /** Direction this run performs. */
  direction: 'import' | 'export'
  /** Thread id (import) or session id (export). */
  target: string
  /** Current lifecycle state. */
  status: 'running' | 'completed' | 'failed'
  /** Progress fraction in `[0, 1]` while known. */
  progress?: number
  /** Short stage label. */
  stage: string
  /** Every log line produced so far. */
  log: BridgeLogLine[]
  /** Terminal summary once the run settles. */
  result?: BridgeRunResult
}

/** Unwrap the transport's result envelope, throwing the Host's message on failure. */
async function call(connection: ConnectionHandle, endpoint: string, payload: unknown): Promise<unknown> {
  const result = await connection.rpc.call(CHANNEL, endpoint, payload)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * List the Codex threads on the Host's disk.
 * @param connection - the browser connection handle.
 * @returns the scanned Codex home and its threads, newest first.
 */
export async function listThreads(connection: ConnectionHandle): Promise<{ codexHome: string; threads: CodexThreadSummary[] }> {
  return await call(connection, 'threads/list', {}) as { codexHome: string; threads: CodexThreadSummary[] }
}

/**
 * List the DSH sessions under the Host's session root.
 * @param connection - the browser connection handle.
 * @returns the scanned session root and its sessions, newest first.
 */
export async function listSessions(connection: ConnectionHandle): Promise<{ sessionRoot: string; sessions: DshSessionSummary[] }> {
  return await call(connection, 'sessions/list', {}) as { sessionRoot: string; sessions: DshSessionSummary[] }
}

/**
 * Start an import run; it proceeds on the Host after this resolves.
 * @param connection - the browser connection handle.
 * @param threadId - the Codex thread to import.
 * @returns the new run's id, which the panel polls.
 */
export async function startImport(connection: ConnectionHandle, threadId: string): Promise<string> {
  const value = await call(connection, 'runs/start-import', { threadId }) as { id: string }
  return value.id
}

/**
 * Start a batch import for one project.
 * @param connection - the browser connection handle.
 * @param threadIds - Codex threads to import sequentially.
 * @returns the new run id, which the panel polls.
 */
export async function startImportBatch(connection: ConnectionHandle, threadIds: string[]): Promise<string> {
  const value = await call(connection, 'runs/start-import-batch', { threadIds }) as { id: string }
  return value.id
}

/**
 * Start an export run; it proceeds on the Host after this resolves.
 * @param connection - the browser connection handle.
 * @param sessionId - the DSH session to export.
 * @param dryRun - when true, the Host computes the plan and writes nothing.
 * @returns the new run's id, which the panel polls.
 */
export async function startExport(connection: ConnectionHandle, sessionId: string, dryRun: boolean): Promise<string> {
  const value = await call(connection, 'runs/start-export', { sessionId, dryRun }) as { id: string }
  return value.id
}

/**
 * Read one run's current state.
 * @param connection - the browser connection handle.
 * @param id - the run id to read.
 * @returns the run snapshot, or `undefined` once the Host has evicted it.
 */
export async function readRun(connection: ConnectionHandle, id: string): Promise<BridgeRun | undefined> {
  const value = await call(connection, 'runs/read', { id }) as { run: BridgeRun | null }
  return value.run ?? undefined
}
