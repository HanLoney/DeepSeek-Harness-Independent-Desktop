/**
 * Wire contract for the browser-facing Codex bridge.
 *
 * Every value crossing the RPC channel is plain JSON: a browser cannot receive
 * a live object, and the panel renders from a snapshot it polls. Keeping the
 * contract in one module lets the host half and the browser half name the same
 * fields without either importing the other's runtime code.
 *
 * @module @deepseek-ai/dsh-codex-bridge-host/types
 */

/** One Codex thread offered for import, as the panel lists it. */
export interface CodexThreadSummary {
  /** Codex thread id, stable across the thread's shard chain. */
  readonly id: string
  /** Sidebar title from Codex's session index, when the index carries one. */
  readonly title?: string
  /** Working directory recorded for the thread, when Codex's registry has one. */
  readonly cwd?: string
  /** Display project label derived from the working directory. */
  readonly project?: string
  /** Last update time in epoch milliseconds, when the index carries one. */
  readonly updatedAt?: number
  /** Rollout shard count; more than one means a continuation chain. */
  readonly shards: number
}

/** One DSH session offered for export, as the panel lists it. */
export interface DshSessionSummary {
  /** DSH session id, the `session-<uuid>` form the artifact directory is named for. */
  readonly id: string
  /** Project directory the artifact sits under, derived from its project key. */
  readonly project: string
  /** Artifact size in bytes. */
  readonly bytes: number
  /** Artifact modification time in epoch milliseconds. */
  readonly updatedAt: number
}

/** A single progress line the panel appends to its log. */
export interface BridgeLogLine {
  /** Milliseconds since the Unix epoch, when the line was produced. */
  readonly at: number
  /** Severity, which the panel colours. */
  readonly level: 'info' | 'warn' | 'error'
  /** Human-readable text. */
  readonly text: string
}

/** Lifecycle state of the one operation a bridge run performs. */
export type BridgeRunStatus = 'running' | 'completed' | 'failed'

/**
 * One import or export run.
 *
 * A run is a single unit of work the panel observes by polling; it is not a
 * job-registry entry, because the jobs registry reports a free-text `detail`
 * only at settlement and carries no progress, which is exactly what the panel
 * needs while an import is still folding.
 */
export interface BridgeRun {
  /** Opaque run id the panel polls with. */
  readonly id: string
  /** Direction this run performs. */
  readonly direction: 'import' | 'export'
  /** The thread id (import) or session id (export) the run was started for. */
  readonly target: string
  /** Current lifecycle state. */
  readonly status: BridgeRunStatus
  /** Monotonic progress fraction in `[0, 1]`, or `undefined` while indeterminate. */
  readonly progress?: number
  /** Short stage label for the current phase. */
  readonly stage: string
  /** Every log line produced so far, oldest first. */
  readonly log: readonly BridgeLogLine[]
  /** Terminal summary, present once the run settles. */
  readonly result?: BridgeRunResult
}

/** Terminal summary of a finished run, rendered by the panel as a result card. */
export interface BridgeRunResult {
  /** Whether the operation completed its writes. */
  readonly ok: boolean
  /** One-line outcome for the panel's heading. */
  readonly summary: string
  /** Key/value facts the panel lists, in display order. */
  readonly facts: readonly { readonly label: string; readonly value: string }[]
}

/** Request payload for starting an import run. */
export interface StartImportRequest {
  /** Codex thread id to import. */
  readonly threadId: string
  /** Overrides the Codex home; defaults to `~/.codex`. */
  readonly codexHome?: string
  /** Overrides the DSH session root; defaults to `$DSH_HOME/sessions`. */
  readonly sessionRoot?: string
  /** Project directory to file the session under, instead of the rollout's own. */
  readonly cwd?: string
}

/** Request payload for importing all threads in one displayed project. */
export interface StartImportBatchRequest {
  /** Codex thread ids to import sequentially. */
  readonly threadIds: readonly string[]
  /** Overrides the Codex home; defaults to ~/.codex. */
  readonly codexHome?: string
  /** Overrides the DSH session root; defaults to $DSH_HOME/sessions. */
  readonly sessionRoot?: string
}

/** Request payload for starting an export run. */
export interface StartExportRequest {
  /** DSH session id to export. */
  readonly sessionId: string
  /** Overrides the DSH session root; defaults to `$DSH_HOME/sessions`. */
  readonly sessionRoot?: string
  /** Overrides the Codex home; defaults to `~/.codex`. */
  readonly codexHome?: string
  /** Computes the full plan and writes nothing. */
  readonly dryRun: boolean
}

/** Response of the thread-listing endpoint. */
export interface ListThreadsResponse {
  /** Codex home the listing was read from. */
  readonly codexHome: string
  /** One entry per thread, newest first. */
  readonly threads: readonly CodexThreadSummary[]
}

/** Response of the session-listing endpoint. */
export interface ListSessionsResponse {
  /** Session root the listing was read from. */
  readonly sessionRoot: string
  /** One entry per session artifact, newest first. */
  readonly sessions: readonly DshSessionSummary[]
}
