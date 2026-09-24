# @deepseek-ai/dsh-client-ui-codex-bridge

English | [中文](README.zh.md)

The browser half of the in-app Codex bridge: one entry in `settings.section` that imports Codex threads as DSH sessions and exports DSH sessions back to Codex, with each run's progress and log visible as it works. The data comes entirely from the six endpoints [`dsh-codex-bridge-host`](../../codex/codex-bridge-host/README.md) registers, so this package owns presentation and polling and nothing else.

## The page

Two direction tabs sit above the lists. **Import** groups every Codex thread on this machine by the final segment of its recorded working directory, then shows its title, shard count, and last update; threads without that metadata appear under `No project`. **Export** lists every DSH session with its project and size. Each project group has an **Import project** action that imports its threads sequentially as separate DSH sessions; a failed thread is logged without stopping the rest. A Refresh button re-reads the active list. Importing a thread or project, or exporting a session, starts a run and switches the log panel to it.

The log panel is the reason the page exists: a large thread takes visible time to fold, and a progress bar over the operation's own stage label (`locating rollout`, `folding events`, `writing artifact`) with its running commentary underneath is the difference between waiting and wondering. Log lines are tinted by level, the panel scrolls as lines arrive, and on settlement the result's summary and fact list replace the bar. A finished run stays readable until the next one starts.

Export offers a **dry run** checkbox: with it ticked, the run reports what it would write without touching Codex. The checkbox applies to export only, so it is hidden on the import tab rather than shown inert.

While a run is live the start buttons refuse a second start, so a double click cannot queue two folds of the same thread. There is no cancel: the host side holds no timer and no cancellation seam, and a run that is already folding has no partial result worth keeping.

## Polling

The page polls `runs/read` every 500 ms while a run is live and stops on its own the moment the run settles, or when the run id it was watching has been replaced by a newer one. Nothing polls while the page is idle. Unmounting disposes the controller, which stops any poll in flight — the same path the fiber teardown takes, so a hot reload cannot leave a timer running against a replaced store.

## Composition

```yaml
- id: ui-codex-bridge
  name: '@deepseek-ai/dsh-client-ui-codex-bridge'
```

The package declares `dsh.client` with `platform: 'web'` and depends on `slots`, `locale`, and `connection`. It registers one `settings.section` entry and its own `settings.codexBridge` dictionary pair; both are fiber-owned effects, so disposal removes them. Copy goes through that namespace, and styling uses `--dsw-*` tokens only.

## Testing

`tests/browser-plugin.client.spec.ts` boots the browser half over a real slot tree: it asserts the settings-section entry appears and that fiber teardown removes it (HMR safety), that both dictionaries register and withdraw through `ctx.locale.bind`, that the English dictionary stays key-identical to the Chinese source of truth, that the node half's `apply` is inert, and that the invariant companion reserves its ownership.

## Model Experience

None, as the section renders a browser configuration UI; nothing here reaches a model request.

#### KV Cache effect

None; this package never assembles or sends a provider request.

## Known Limitations and Deferred Work

- **Progress is polled at a fixed interval.** 500 ms is an implementation constant, not a deployment tunable; a run that finishes between two polls shows one stale frame. A push channel would remove the interval, which the host half does not open.
- **The log panel shows the newest run only.** Starting another run replaces the panel's content, so a settled run's commentary is readable only until the next start. The host keeps its recent runs; this page has no history view.
- **No cancel and no per-thread filter.** Cancel needs a host-side cancellation seam the channel does not expose, and with a few hundred threads the list is scrolled rather than searched.
