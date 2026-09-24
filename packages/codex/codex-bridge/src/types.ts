/**
 * Public data types for the Codex rollout bridge: the decoded Codex side, the
 * resolved thread index, and the reported outcome of an import or export.
 * Runtime validation lives at the file/JSON boundaries themselves
 * (`codex-rollout.ts`, `dsh-store.ts`); these declarations describe values
 * that already crossed one.
 *
 * @module @deepseek-ai/dsh-codex-bridge/types
 */

/** One decoded Codex rollout line, before any interpretation of its payload. */
export interface CodexRolloutLine {
  /** RFC 3339 timestamp the writer stamped on the line, verbatim. */
  timestamp: string
  /**
   * Monotonic sequence number shared across every shard of one thread. The
   * base rollout starts at 0; a continuation shard resumes the parent thread's
   * numbering, which is why shards can overlap and must be de-duplicated.
   */
  ordinal: number
  /** Top-level envelope discriminant: `session_meta`, `response_item`, `event_msg`, … */
  type: string
  /** Envelope payload; its own `type` field discriminates within `type`. */
  payload: Record<string, unknown>
  /** Present only on some result envelopes (e.g. `custom_tool_call_output`). */
  metadata?: Record<string, unknown>
}

/** One rollout artifact on disk, with the ordinal span it actually covers. */
export interface CodexRolloutShard {
  /** Absolute path of the shard file. */
  path: string
  /** Size in bytes at observation time. */
  bytes: number
  /** Lowest ordinal found in the file, or `undefined` when it holds no parseable line. */
  firstOrdinal: number | undefined
  /** Highest ordinal found in the file, or `undefined` when it holds no parseable line. */
  lastOrdinal: number | undefined
  /** Number of non-empty lines read. */
  lineCount: number
}

/**
 * One thread as the Codex index and filesystem describe it. A thread is
 * identified by its session id and owns an ordered, de-duplicated shard chain.
 */
export interface CodexThread {
  /** Thread/session identity; the `<id>` infix of the base rollout filename. */
  id: string
  /** Working directory the thread was created in, when the index reported one. */
  cwd?: string
  /** Display title from the index, when present. */
  title?: string
  /** Model provider the thread was created under, when the index reported one. */
  modelProvider?: string
  /** `legacy` or `paginated`; paginated threads own continuation shards. */
  historyMode?: string
  /** Last update time in Unix milliseconds, when the index reported it. */
  updatedAtMs?: number
  /** Every shard of this thread, ordered by the first ordinal each shard carries. */
  shards: CodexRolloutShard[]
}

/** A reason one Codex line could not become a DSH event, retained for reporting. */
export interface CodexSkip {
  /** Ordinal of the skipped line, or `undefined` when the line was unparseable. */
  ordinal: number | undefined
  /** Envelope type of the skipped line, or `undefined` when unparseable. */
  type: string | undefined
  /** Stable machine-readable reason. */
  reason: string
}

/** Result of folding one Codex thread into the DSH session event vocabulary. */
export interface FoldResult {
  /** Ordered DSH events, with contiguous `seq` starting at zero. */
  events: FoldedEvent[]
  /** Lines deliberately not represented in the DSH log, with their reasons. */
  skipped: CodexSkip[]
  /** Wall-clock creation time in Unix milliseconds, from the earliest Codex line. */
  createdAt: number
  /** Working directory recovered from `session_meta`, when it carried one. */
  cwd: string | undefined
}

/**
 * One DSH session-log record ready for serialization. The bridge writes these
 * objects directly rather than routing through a live `Session`, so the type
 * stays a plain structural description of the on-disk line.
 */
export interface FoldedEvent {
  /** Session event type, e.g. `user/message`. */
  type: string
  /** Contiguous sequence number within the produced log. */
  seq: number
  /** Unix epoch milliseconds. */
  time: number
  /** Event payload. */
  data: Record<string, unknown>
  /** Present only on surface events; `append` for every event this bridge writes. */
  surfaceOp?: 'append'
}

/** Options accepted by an import. */
export interface ImportOptions {
  /** Codex home directory; defaults to `~/.codex`. */
  codexHome: string
  /** DSH session root; defaults to `~/.dsh/sessions`. */
  sessionRoot: string
  /** Thread id to import. */
  threadId: string
  /** When set, overrides the cwd recovered from the thread. */
  cwd?: string
}

/** What one completed import produced. */
export interface ImportReport {
  /** Thread id that was imported. */
  threadId: string
  /** Generated DSH session id. */
  sessionId: string
  /** Absolute path of the written session artifact. */
  artifactPath: string
  /** Shards that contributed to the import, in chain order. */
  shards: string[]
  /** Ordinals dropped because another shard already supplied them. */
  duplicateOrdinals: number
  /** Total DSH events written. */
  eventCount: number
  /** Lines that produced no DSH event. */
  skipped: CodexSkip[]
  /** Logical bytes of the uncompressed log. */
  plaintextBytes: number
  /** Bytes of the written compressed artifact. */
  artifactBytes: number
}

/** One line of the Codex sidebar index. */
export interface CodexIndexEntry {
  /** Thread id. */
  id: string
  /** Display name shown in the sidebar. */
  thread_name: string
  /** RFC 3339 last-update time. */
  updated_at: string
}

/**
 * The `threads` columns an export supplies explicitly. Every other column has
 * a SQL default, so listing only these keeps the bridge from silently pinning
 * a value the app is free to change.
 */
export interface CodexThreadRow {
  /** Thread id; the rollout filename's `<id>` infix. */
  id: string
  /** Rollout path in the extended-length Windows form Codex itself writes. */
  rollout_path: string
  /** Creation time in Unix seconds. */
  created_at: number
  /** Last-update time in Unix seconds. */
  updated_at: number
  /** Originating surface, e.g. `vscode` or `cli`. */
  source: string
  /** Model provider id, e.g. `openai`. */
  model_provider: string
  /** Working directory. */
  cwd: string
  /** Display title. */
  title: string
  /** Sandbox policy as a JSON object literal. */
  sandbox_policy: string
  /** Approval mode, e.g. `never` or `on-request`. */
  approval_mode: string
  /** Imported threads keep every event in the single rollout file. */
  history_mode: 'legacy'
  /** First human message, used as the sidebar preview. */
  first_user_message: string
  /** Recency timestamp in Unix milliseconds. */
  recency_at_ms: number
}

/** Options for writing one rollout artifact plus its registry rows. */
export interface WriteThreadOptions {
  /** Codex home directory. */
  codexHome: string
  /** The thread id to register. */
  threadId: string
  /** Rollout bytes. */
  rollout: Buffer
  /** Absolute rollout path the caller already resolved. */
  rolloutPath: string
  /** Registry columns to write. */
  row: CodexThreadRow
  /** When true, write no file and no row. */
  dryRun: boolean
}

/** Options accepted by an export back to a Codex rollout. */
export interface ExportOptions {
  /** DSH session root the artifact is read from. */
  sessionRoot: string
  /** DSH session id to export. */
  sessionId: string
  /** Codex home the registry entries are written to. */
  codexHome: string
  /** Directory the rollout artifact is written under. */
  outDir: string
  /**
   * Exact artifact path to read. Bypasses the search under `sessionRoot`,
   * which is the only way to export a session whose project directory has moved.
   */
  artifactPath?: string
  /** When true, compute the full plan and write nothing. */
  dryRun: boolean
}

/** What one export produced, or would produce under `dryRun`. */
export interface ExportReport {
  /** DSH session id that was exported. */
  sessionId: string
  /** Codex thread id the export registered, or would register. */
  threadId: string
  /** Absolute path of the rollout file, written or planned. */
  rolloutPath: string
  /** Rollout lines the export emits. */
  lineCount: number
  /** Bytes the rollout file occupies, or would occupy. */
  rolloutBytes: number
  /** Wall-clock creation time in Unix milliseconds recorded in `session_meta`. */
  createdAt: number
  /** Working directory recorded in `session_meta`. */
  cwd: string
  /** Number of DSH events that produced no rollout line. */
  skippedEvents: number
  /** Whether the caller's `dryRun` suppressed every write. */
  written: boolean
}
