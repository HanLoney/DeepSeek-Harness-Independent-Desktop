# @deepseek-ai/dsh-codex-bridge

English | [中文](README.zh.md)

Move work between Codex and DeepSeek Harness. An **import** reads a Codex thread off disk and writes it as a DSH session the harness opens like any other. An **export** reads a DSH session and writes it back as a Codex thread the Codex UI lists and continues. Both directions are plain file operations against the two tools' on-disk formats; neither needs the other tool stopped.

## Composition

The package is a library and a CLI. It registers no tool and no service, so a deployment that wants model-facing commands writes its own plugin over the exported functions:

```ts
import { importThread } from '@deepseek-ai/dsh-codex-bridge'

declare const codexHome: string
declare const sessionRoot: string
declare const threadId: string

const report = await importThread({ codexHome, sessionRoot, threadId })
console.log(report.sessionId, report.artifactPath, report.eventCount)
```

## Usage

```sh
# list threads Codex has on disk
dsh-codex-bridge list

# import one thread; prints the new session id and artifact path
dsh-codex-bridge import 01a0461d-6bf5-7732-a21b-13b8d6640ac6

# preview an export without writing anything
dsh-codex-bridge export session-7fa34b11-5af3-4ead-bd5c-32123c6f5efa --dry-run

# write the export back into Codex
dsh-codex-bridge export session-7fa34b11-5af3-4ead-bd5c-32123c6f5efa --out-dir "C:\\Users\\me\\.codex\\sessions\\2026\\09\\22"
```

Point either direction at a non-default tree with `--codex-home` and `--session-root`. Add `--cwd <dir>` on import to place the session under a project directory of your choosing instead of the one recorded in the rollout. Use `--artifact <path>` on export to read a session whose project directory has moved.

## Formats

**Codex side.** A thread is a rollout file under `<codex-home>/sessions/YYYY/MM/DD/rollout-<stamp>-<threadId>.jsonl`, one JSON object per line, each carrying a thread-global `ordinal`. A long thread spills into continuation shards whose filenames append `_<shardId>`; a shard resumes the parent's ordinal numbering and overlaps it, so the reader merges by ordinal and keeps the first shard's copy of any ordinal two shards share. Codex discovers a thread through two further stores — a `session_index.jsonl` sidebar line and a `threads` row in `state_5.sqlite` — and an export writes all three together, because a rollout file alone is an orphan the UI will not show.

**DSH side.** A session artifact is a concatenation of independently decodable, checksummed Zstandard frames. The first frame holds exactly the session header line; every later frame holds a batch of event lines. Each event carries a dense, contiguous `seq`, which replay requires.

## Round trip

Import merges the shard chain, folds Codex's items into DSH events, and writes one artifact. Export reverses the fold, emitting a `legacy` thread: a single self-contained rollout, one index line, one `threads` row. Because export always writes `legacy`, an exported thread needs no shard chain and cannot leave a `paginated` thread's byte offsets inconsistent.

The fold is deliberately lossy in one direction only. Importing a thread and exporting it back preserves the conversation and the tool calls in it — message text and order, each `function_call` with its `call_id` and arguments, and each `function_call_output` — but not the reasoning items, which have no readable content to fold and no representation to emit. `ImportReport.skipped` and `ExportReport.skippedEvents` account for every dropped line; nothing is dropped silently.

## Testing

`tests/bridge.spec.ts` covers the format contracts with synthetic rollouts: filename parsing, shard merge and de-duplication, the fold's event mapping and its skip reasons, frame packing and unpacking, rollout building, and the registry writers against the shipped `threads` schema.

`tests/live.spec.ts` and `tests/roundtrip.spec.ts` run against whatever Codex data is present on the machine and skip when there is none. The round trip imports a real multi-shard thread, exports it into a throwaway Codex home, verifies both registry stores, and re-imports the export to confirm the message count is unchanged in both directions.

## Known Limitations and Deferred Work

- **Reasoning does not survive a round trip.** Codex reasoning items are encrypted blobs with no readable content, so the bridge cannot fold them into DSH events or reconstruct them on export. An imported session shows the conversation without the original reasoning trace, and the fold reports each dropped item.
- **Turn and step boundaries are reconstructed, not restored verbatim.** The fold synthesizes `turn/start`, `step/start`, and `step/end` from Codex's task and item markers, and export re-emits the turn markers as `event_msg`. The conversation, tool calls and outputs, and turn and step counts survive the round trip; the original step numbers are re-derived rather than carried.
- **Export always writes `legacy`.** Writing a `paginated` thread would require keeping the rollout, the index, and the `threads` row byte-offset consistent across a shard chain. `legacy` needs none of that bookkeeping, so the bridge does not attempt it.
- **The bridge takes no live `Session`.** It reads and writes artifacts directly rather than through the persistence service, so an import or export performed while a session is open is not coordinated with that session's own writes. Run it against closed sessions.
- **Windows path forms.** `toExtendedPath` emits the `\\\\?\\` device-namespace prefix Codex itself writes. On non-Windows hosts the export writes a POSIX path, which is untested against a real Codex install.
