/**
 * Codex rollout bridge: import a Codex thread as a DSH session and export a DSH
 * session back as a Codex thread.
 *
 * This package registers no tools and no services. It is a library the harness
 * binds from a composition, plus the `./invariant` companion that keeps an
 * imported session readable under the invariants the rest of the harness
 * asserts. Tools, if a deployment wants them, belong to that deployment's
 * plugin rather than here.
 *
 * @module @deepseek-ai/dsh-codex-bridge
 */

export type {
  CodexIndexEntry, CodexRolloutLine, CodexRolloutShard, CodexSkip,
  CodexThread, CodexThreadRow, ExportOptions, ExportReport, FoldedEvent,
  FoldResult, ImportOptions, ImportReport, WriteThreadOptions,
} from './types.ts'

export {
  findThread, formatRolloutStamp, mergeThreadLines, parseRolloutName,
  readShard, readThread, rolloutFilename,
} from './codex-rollout.ts'
export { foldThread } from './fold.ts'
export {
  artifactPath, encodeSegment, packArtifact, projectKey, readArtifact,
  scanFrames, unpackArtifact, writeArtifact, type WrittenHeader,
} from './dsh-store.ts'
export {
  appendIndexEntry, readIndex, readThreadRow, toExtendedPath, upsertThreadRow, writeThread,
} from './codex-store.ts'
export {
  buildRollout, defaultCodexHome, defaultSessionRoot, exportSession, importThread,
} from './port.ts'
