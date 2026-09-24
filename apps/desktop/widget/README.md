# Desktop task widget

[中文](README.zh.md) | English

A frameless always-on-top whale that reports the current session's progress: turn phase, running tools, todo progress, goal rounds, and token and elapsed-time totals.

The widget is a self-contained feature of `apps/desktop`. It changes no harness code under `packages/`: it consumes the same loopback backend the main window already talks to, and the one plugin it contributes is installed into the user's own profile rather than the repository.

## Layout

| File | Role |
|---|---|
| `window.mjs` | Electron host: opens the window, owns geometry persistence and click-through, and stops everything. |
| `host.mjs` | Data plane: folds the session stream into per-session progress records and serves the widget's HTTP surface. |
| `view.mjs` | Presentation logic: artwork choice, labels, sound cues, retraction. No DOM, so it is tested directly. |
| `renderer.js` | Paints the DOM from the newest snapshot and drives the pointer hit-test. |
| `preload.cjs` | Bridges the renderer's pointer hit-test and sound commands to the host. |
| `index.html`, `widget.css` | The rendered surface's markup and styling. |
| `install.mjs` | Wires the settings panel into a profile: the plugin package and its loader row. |
| `home.mjs` | Resolves the harness home the same way the spawned backend does. |
| `plugin/` | The settings panel: a node half registering the `desktop-widget` namespace, and a browser half rendering the switch. |
| `assets/` | Upstream artwork and sound effects; see `PROVENANCE.md` for their license and per-file roles. |

The working artwork draws a thought balloon, and the bubble is positioned inside it as transparent centred text rather than as a panel of its own: a panel would stack a second bubble on the drawn one. Only that artwork has a balloon, so the closing states — celebration and failure — place the text on a dark surface of its own instead. Geometry therefore lives in `.bubble[data-art="…"]` rules and never in the base rule, which only one artwork could satisfy. That places two constraints in `widget.css` that nothing else enforces — the bubble needs a higher `z-index` than the artwork, which follows it in the DOM, and `[hidden]` needs `!important` to beat the `display` each hidden element's own class sets. Both are asserted in `widget.test.mjs`.

`assets/DSH2.png` and `assets/rua.gif` are currently unreferenced: the banner backed the earlier dark panel, and `rua.gif` duplicates the petting animation `bubble-petpet.gif` already provides. They ship anyway, so a future state can use them without another trip upstream.

The logic lives in `view.mjs` so the decisions that are easy to get wrong can be asserted without a window: which artwork a phase maps to, which sound a transition earns, when the bubble retracts, which session to show. `renderer.js` owns only the DOM; `apps/desktop/tests/widget-view.test.mjs` covers the logic.

## Data flow

The host subscribes to `/api/events.mux` on the backend origin and folds two frame families into one record per session:

- `session/event` — `turn/start`, `step/start`, `tool/call`, `tool/result`, `assistant/message`, `turn/end`. These drive the phase, the running-tool rows, and elapsed time.
- `session/projection` — `todos`, `goal`, `sessionStats`, `title`, `tokenUsage`.

Projection frames carry the whole current value and are last-wins, so folding them is assignment rather than accumulation. Token totals come from the `tokenUsage` projection alone: folding per-step `assistant/message` usage as well would double-count the same tokens.

The stream pushes changes only, so a widget opened mid-task would start blank. `seedBaseline` reads `session.list` once and replays each session's projection block into the records.

The renderer polls `GET /widget/state`; the host serves that route plus the widget's own assets, and the window loads both from a loopback socket bound to an OS-assigned port. The route is read-only: it exposes progress derived from the session log and grants no write path. Paths outside the widget directory are refused with 403.

## Interaction

The window is larger than its artwork and starts click-through: the renderer hit-tests the whale and bubble rectangles and reports pointer crossings through the preload bridge, so only drawn parts take clicks. Dragging any part of the window moves it; the position is saved on move and again on close.

Double-clicking the bubble toggles sound, marked by a muted badge in the header. A single click is not used because it would mute the widget during an ordinary drag.

Right-clicking anywhere drawn opens a menu with hide, mute, and quit. The window is frameless and skips the taskbar, so without it there is no way to put the widget away or close it. Dragging is driven from pointer deltas through the preload bridge rather than by `-webkit-app-region: drag`, because Windows treats a drag region as a title bar and consumes right-clicks inside it before the page sees them.

## Settings

The enable switch lives in the main window's Settings panel, under 桌面挂件. Toggling it starts or stops the widget within a couple of seconds — no restart, and no backend restart either.

That panel is a client plugin, which is why `install.mjs` and `plugin/` exist. A client plugin's browser half is served at `/plugins/<package>/client.js`, and the client-modules scanner discovers it only through a loader row whose `name` is a package resolvable from `profiles/node_modules`. So the panel needs the package copied into the user's profile plus one row naming it, and the desktop host does both before it spawns the backend — the backend only sees the plugin while it is starting up.

Three details in `plugin/` are load-bearing and not obvious:

- The bundle registers itself under the **package name**, not the loader row's `id`. Registering under anything else fails the whole plugin tree with "loaded without registering".
- The settings schema is **schemastery**, not zod, and it has no `.shape` — field names come from `.dict`.
- The panel talks to `/desktop-widget/config` rather than the generic settings RPC, because `dsh-host-apiproxy` gates that RPC behind a namespace allowlist a plugin cannot extend.

The stored setting is authoritative at startup, and the local `widget.enabled` config is the fallback for when the panel is not installed at all. A manual quit from the tray or the right-click menu stays quit: the watcher acts only on a *change* of the stored value, so it never overrides a deliberate close.

## Adding a metric

Add a case to `applyProjection` (or `applyEvent` for a log-shaped value), include it in `snapshotOf`, and render it. Unknown projection keys are ignored rather than approximated, so a deployment without the owning plugin leaves that part of the bubble empty.

The one non-obvious constraint: projection keys are the session-projection seam's own vocabulary. Check the key the owning plugin declares rather than guessing a name — this widget originally looked for `sessionTitle` where the seam publishes `title`, and silently showed nothing.

## Removing the widget

The feature is confined to this directory plus a few touchpoints elsewhere. Delete them to take it out completely:

1. Delete `apps/desktop/widget/`.
2. Delete `apps/desktop/tests/widget.test.mjs`, `apps/desktop/tests/widget-view.test.mjs`, and `apps/desktop/tests/widget-settings.test.mjs`.
3. Remove the three `import` lines for `./widget/window.mjs`, `./widget/install.mjs`, and `./widget/home.mjs` from `apps/desktop/main.mjs`, along with `widgetOptions`, `readWidgetSettings`, `watchWidgetSettings`, the `startWidget` block, the `widget` variable, and the `widget?.close()` line in the `will-quit` handler.
4. Remove the `widget` group from `defaultConfig` and `normalizeConfig` in `apps/desktop/config.mjs`.
5. Remove `"widget"` from `files` in `apps/desktop/package.json`, and revert the expected directory list in `apps/desktop/tests/package-staging.test.mjs`.

If the app has already run, the plugin package and its loader row are in the user's profile as well. `install.mjs` exports an `uninstall` that removes exactly what it added and restores the patch file byte for byte; run it once, or delete `<DSH_HOME>/profiles/node_modules/dsh-plugin-desktop-widget` and the fenced `desktop widget` block in `<DSH_HOME>/profiles/web/cordis.patch.yml`.

Because the artwork is not MIT-licensed, step 1 is also what keeps it out of an open-source release — see `PROVENANCE.md` before publishing.
