# @deepseek-ai/dsh-codex-bridge-host

English | [中文](README.zh.md)

The Host half of the in-app Codex bridge: it registers one loopback-only RPC channel, `/codex-bridge`, that the browser settings page calls. The channel exposes what a page needs to drive [`dsh-codex-bridge`](../codex-bridge/README.md) interactively 鈥?list the Codex threads and DSH sessions on this machine, start an import or export, and read its progress.

The library alone is a one-shot call per direction. An in-app surface needs three things it does not provide: a list of what can be moved, a run that reports progress while it works, and a place to read that report from a second request. This package adds exactly those, and no policy of its own — every file it moves goes through the library's own fold and writers.

## Endpoints

All five endpoints answer a `ClientRequest` envelope over the channel and return an `RpcResult`.

| Method | Payload | Returns |
| --- | --- | --- |
| `threads/list` | `{ codexHome? }` | `{ codexHome, threads: CodexThreadSummary[] }` |
| `sessions/list` | `{ sessionRoot? }` | `{ sessionRoot, sessions: DshSessionSummary[] }` |
| `runs/start-import` | `{ threadId, codexHome?, sessionRoot?, cwd? }` | `{ id }` |
| `runs/start-import-batch` | `{ threadIds, codexHome?, sessionRoot? }` | `{ id }` |
| `runs/start-import-batch` | `{ threadIds, codexHome?, sessionRoot? }` | `{ id }` |
| `runs/start-export` | `{ sessionId, sessionRoot?, codexHome?, dryRun }` | `{ id }` |
| `runs/read` | `{ id }` | `{ run: BridgeRun \| null }` |

Both list endpoints default to `$CODEX_HOME`/`~/.codex` and `$DSH_HOME/sessions`. `threads/list` walks the rollout tree and joins `session_index.jsonl` for titles, because a thread directory name is an id and the sidebar line is the only place its name lives. It also reads `threads.cwd` from `state_5.sqlite` and uses the final working-directory segment as the project label. A thread with no index or database row is listed by id and counted, not dropped. `sessions/list` reports each session's project, byte size, and last write.

## Runs

A start endpoint returns its run id immediately and performs the work detached, because folding a large thread outlasts a request. The caller then polls `runs/read` for a `BridgeRun`:

- `status` is `running`, `completed`, or `failed`.
- `stage` is the operation's own label for its current phase (`locating rollout`, `folding events`, `writing artifact`, and so on), not a generic state word.
- `progress` is a fraction in `[0, 1]`, and it never moves backward: a reporter that reports a lower value is ignored.
- `log` is the operation's running commentary — the shard paths it read, the skip groups it dropped and why, the artifact it wrote — as `{ at, level, text }` lines.
- `result` appears on settlement with a one-line `summary` and a `facts` list of label/value pairs.

A reporter is inert once its run settles, so a late progress call cannot resurrect a finished run's state. Settled runs are retained for reading and evicted oldest-first once the table passes its bound; log lines are retained newest-first under their own bound. Both bounds are implementation constants, not deployment tunables.

The poll is the caller's, not the server's: this package holds no timer and pushes nothing, so a page that stops polling simply stops observing.

## Composition

The row below is the whole registration; the browser half is [`dsh-client-ui-codex-bridge`](../../client/ui-codex-bridge/README.md), and the two belong together.

```yaml
- id: codex-bridge-host
  name: '@deepseek-ai/dsh-codex-bridge-host'
```

The channel is registered with `authority: 'loopback'`: every endpoint reads and writes the user's own home directories, so a remote caller must not reach it. A deployment that wants a different authority or a different endpoint set writes its own plugin over the exported `RunRegistry`, `listThreads`, `listSessions`, `runImport`, and `runExport`.

## Testing

`tests/runs.spec.ts` covers the run registry directly: progress monotonicity and clamping, log bounding, eviction order, and the freeze that settlement puts on further reports.

`tests/channel.spec.ts` boots the real plugin over a real Connection host on a live loopback server, so the whole request path — client envelope, Connection decode, endpoint handler, response envelope — is exercised rather than simulated. It lists this machine's threads and sessions, and drives an import of a nonexistent thread to its recorded failure.

## Known Limitations and Deferred Work

- **Progress is polled, not pushed.** The channel holds no timer and emits no stream, so a page learns a run's state only as often as it asks. A push would need a forwarded-event port this package does not open.
- **Listing reads the whole rollout tree per call.** `threads/list` stats every shard under `~/.codex/sessions` on each request. That is a few hundred files on a typical home; a deployment with a very large tree would want a cached scan, which the library does not yet offer.
- **A run's own failure is text.** A failed import or export reports through `stage` and `log` lines rather than typed error data, so a caller can display the reason but cannot branch on its kind.
