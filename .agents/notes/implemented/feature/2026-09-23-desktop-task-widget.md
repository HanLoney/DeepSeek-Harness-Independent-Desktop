# Agent Note: Desktop task widget over the loopback session stream

Status: implemented

English | [中文](2026-09-23-desktop-task-widget.zh.md)

## Problem

The desktop application showed a session's progress only inside the main window, which is often hidden behind other work. A user who wanted to know whether a long task was still running, which tool it was in, how far its todo list had come, or what it had cost in tokens had to switch windows and read the conversation. Nothing in the desktop process reported any of it.

The upstream `dsh-whale-widget` project solves the "glanceable" half of this — a whale that floats over the desktop — but it is a Web client plugin with its own balance-accounting purpose, and it contributes to the Harness client roster. Adopting it as-is would have added an accounting feature nobody asked for and coupled the floating window to the Web bundle build.

## Decision

`apps/desktop/widget/` is a self-contained floating window: a frameless always-on-top Electron `BrowserWindow` that reports the active session's turn phase, running tools, todo progress, goal rounds, and token and elapsed-time totals.

The widget changes no code under `packages/`. It reads the same loopback `dsh web` backend the main window already uses, through the existing `/api/events.mux` WebSocket stream plus one `session.list` call for a baseline.

The one plugin it contributes — the settings panel described below — is installed into the user's own profile rather than the repository, so it adds no package to the workspace and no row to a shipped bundle.

### Why the desktop consumes the client API rather than a host plugin

A host-side plugin could have derived progress in-process and pushed it over IPC. It was rejected because it would have placed the widget in the harness package graph: a new package, a bundle row, a tsconfig reference, and a client-plugin roster entry — four registration surfaces that must be updated together and each of which fails at a different, later point when missed. The user's requirement that the feature be removable by deleting a directory is incompatible with that coupling.

Consuming the client API keeps the widget on a boundary that already exists and is already tested. The cost is that the widget sees what a browser client sees: it must subscribe and fold rather than read derived state directly, and it depends on the session-projection vocabulary of whichever plugins the deployment has mounted.

The settings panel is the exception that proves the boundary: it *is* a client plugin, but it is installed at runtime into `$DSH_HOME/profiles/` by the desktop host rather than declared in the repository's composition. Nothing in `packages/` names it.

### Folding rules that real data forced

Two rules are non-obvious and were both found by folding a real 2,534-event session rather than by inspection:

**Projection frames are whole values, not deltas.** `session/projection` carries the complete current value for a key and is last-wins, so folding is assignment. The widget's first implementation accumulated token fields, which would have reported a multiple of the true count as frames arrived.

**Token totals come from the `tokenUsage` projection alone.** Both `assistant/message` and the `tokenUsage` projection describe the same tokens, and the projection covers the whole log. Folding both double-counted. The widget now reads per-step usage only for `reasoningTokens`, which the projection does not carry.

A third rule is a naming hazard worth recording: projection keys are the owning seam's vocabulary. The widget originally looked for `sessionTitle` where the session seam publishes `title`, and silently displayed nothing. Unknown keys are ignored rather than approximated, which is the right behavior for an optional deployment but also means a wrong key fails silently — `widget/README.md` names this as the thing to check when adding a metric.

### Decisions the renderer owns

The renderer's display decisions live in `view.mjs`, which has no DOM and is covered by `apps/desktop/tests/widget-view.test.mjs`. That split exists because these decisions are where the widget was actually wrong, and none of them were visible by watching a window:

- **Cross-session comparison.** The transition tracker compares poll-over-poll counters, so a switched session must reset it. Without the reset the widget read another run's finished todos as this one's progress and fired a completion cue the user never earned. The idle clock resets with it, because inheriting it retracted the new session's bubble immediately.
- **Sentinel values.** The idle clock uses `null`, not `0`: a millisecond timestamp legitimately reads zero, and a sentinel sharing a value with real data makes "never idle" and "idle at epoch" indistinguishable.
- **Duplicate cues.** A turn that finishes with its list already complete satisfies both the turn and the todo condition, so one event earned two completion sounds.
- **Unknown vocabulary.** An unrecognized phase or outcome is displayed verbatim rather than replaced by a default, because a guessed label would claim a failed turn succeeded.

### Window behavior

The window is larger than its artwork and starts click-through, with the renderer hit-testing the whale and bubble rectangles and reporting pointer state through a preload bridge. Without this the transparent margin would swallow clicks meant for the desktop below.

Geometry is saved beside the desktop configuration and restored on the next launch, pulled back inside a connected display's work area rather than merely rejected: rejecting a still-mostly-valid position would discard the corner because a few pixels hang off an edge. Saves happen on move and again on close, so a drag followed by a quit keeps its position.

The renderer polls `GET /widget/state` under a single-flight guard. Without it a backend slower than the poll interval accumulates one request per tick, each painting a snapshot already superseded by the next.

The route serves `.mjs` as `text/javascript`. A module served as `application/octet-stream` is refused by the browser before its code runs, which blanks the window — the first live run after the split caught this, and a test now asserts every module's content type.

Sound is a double-click on the bubble, because a single click would mute the widget during an ordinary drag.

### Commands that need a menu, and why the drag is not a CSS region

The window is frameless and skips the taskbar, so without a menu there is no way to hide or close it. Right-clicking anywhere drawn opens hide, mute, and quit; the same three sit on the tray icon.

The hit region is the union of the drawn whale and bubble rectangles recomputed per event, not a fixed box and no longer a per-node test. The first implementation tested each node, which meant a right-click in the gutter between the two — inside the window, visually part of the widget — fell through to a transparent margin.

Dragging moved from `-webkit-app-region: drag` to pointer deltas through the preload bridge. The region-based drag does not coexist with a context menu: Windows treats a drag region as a title bar and consumes right-clicks inside it before the page sees them, so the menu opened everywhere except on the whale. This is invisible in a devtools console, and only a real right-click on the running window exposed it. `-webkit-app-region: no-drag` on a descendant does *not* carve it out of an ancestor's region — the value must be set on the region itself.

The window also opens click-through, and the renderer's interactive flag starts `false` to match. Starting it `true` made the first hover a no-op, leaving the window click-through until the pointer left and came back.

### The settings switch

The enable switch lives in the main window's Settings panel. Toggling it starts or stops the widget within a couple of seconds, without restarting the app or the backend.

That panel is a client plugin, and a client plugin's browser half is discovered only through a loader row whose `name` resolves as a package: the client-modules scanner reads `<name>/package.json` and serves `exports["./client"]`. So the panel needs the package copied into the profile's own `node_modules` plus one row naming it, and `widget/install.mjs` does both before the backend is spawned — the backend only sees the plugin while it is starting up. The row is fenced between marker comments so a hand-edited profile keeps every line of it, and `uninstall` restores the patch file byte for byte.

Two placement rules are load-bearing. The package goes in the profile's own `node_modules`, never the sibling `profiles/node_modules`: that sibling is the harness's flat module fallback, one symlink per package in the installation's dependency closure, and its heal step throws on a real directory at one of those names — a name outside the closure is only accidentally safe there. And an absent patch file is seeded with the harness's own template rather than an empty list, because the harness writes that template only when the file is absent, so creating it first would permanently deny the profile its header.

Three details are load-bearing, and each fails the whole plugin tree rather than the panel:

- The bundle registers itself under the *package* name. Registering under the loader row's `id` fails with "loaded without registering".
- The row needs an explicit `config: {}`. The loader validates it against the plugin's schema, and an absent config is not a default.
- The settings schema is schemastery, not zod, and has no `.shape`; field names come from `.dict`.

The panel does not use the generic settings RPC. `dsh-host-apiproxy` gates that RPC behind a namespace allowlist a plugin cannot extend, so the plugin registers its own `/desktop-widget/config` route and writes through the same settings service. The document, its schema, and the desktop host's view of it are shared; only the transport differs.

The stored setting is authoritative at startup, with the local `widget.enabled` config as the fallback for a deployment where the panel is not installed. The watcher acts only on a *change* of the stored value, so a deliberate quit from the tray or the menu stays quit instead of being undone by the next poll.

### The balloon is the artwork's, not the widget's

The working artwork draws a thought balloon. The bubble is positioned inside it as transparent centred text rather than as a surface of its own, because a panel with its own background stacks a second bubble on the drawn one and reads as pasted over the character. Text colours are therefore chosen against the balloon's white interior, and every running phase maps to the balloon artwork — a face-only artwork under a visible bubble would leave the text floating beside the whale.

That places two constraints in `widget.css` that nothing else enforces. The bubble needs a higher `z-index` than the artwork, which follows it in the DOM and would otherwise cover it; and `[hidden]` needs `!important`, because each hidden element's own class sets a `display` that outranks the user agent's `[hidden]` rule. Both failures are invisible — the renderer sets the property, the attribute lands, and nothing changes on screen — so `widget.test.mjs` asserts them.

### Decoupling

The feature is one directory plus a handful of touchpoints: the `widget` group in `config.mjs`, three imports and the `widgetOptions`/`readWidgetSettings`/`watchWidgetSettings`/`startWidget` block in `main.mjs`, the `widget` entry in the packaged `files` list, and its test files. `widget/README.md` lists the exact removal steps, including the two runtime artifacts in `$DSH_HOME/profiles/` for an app that has already run. Deleting the directory removes every asset with it.

That last point matters for licensing: the upstream artwork and sound effects are not MIT-licensed, and `widget/PROVENANCE.md` records that they must not ship in an open-source release.

## Alternatives considered

**Adopt `dsh-whale-widget` as a Web client plugin.** It already draws a whale overlay with drag, snap, and press sounds, so the presentation work would have been mostly free. Rejected because its purpose is balance accounting rather than task progress, and because a Web client plugin lives in the browser page — it would have floated over the Harness window, not the desktop, and would not have been visible at all when that window was hidden. The artwork was reused; the architecture was not.

**A host plugin deriving progress in-process.** Rejected above: it puts the feature in the harness package graph and defeats directory-level removal.

**An SSE or plain-GET channel for live updates.** A GET on `/api/events.mux` returns 426 upgrade required — the only live carrier is a WebSocket upgrade or the POST plus SSE path in the fetch handler. Rejected because the plain HTTP surface would have needed a new endpoint added to the harness, which is the coupling this design avoids.

**A renderer-side WebSocket from the widget window directly to the backend.** Would have removed the host's folding layer. Rejected because the fold would then run per window and be lost on reload, and because the widget window would need its own reconnect and baseline logic with no place to put it.

## Consequences

The widget is a view of a stream, so it shows only what the mounted plugins project. In a deployment without the todo or goal plugins, that part of the bubble is empty rather than wrong — the intended degradation, and the reason unknown projection keys are ignored.

Progress is reported per session, and the widget shows one: the newest session whose phase is not idle, falling back to the newest session overall. A user running parallel sessions sees whichever is most recently active, not a list.

There is no background-job panel. The user chose turn status, todo progress, stats, and goal progress; jobs were offered and deliberately not selected, so the widget has no code path for them.

The host keeps one record per session with no eviction. Sessions accumulate until the widget window closes, bounded by how many sessions a single desktop run touches.

The upstream assets carry no license, which limits the feature to personal use until they are replaced or cleared. `widget/PROVENANCE.md` states the boundary.

## Testing

`apps/desktop/tests/widget.test.mjs` covers the fold in isolation: phase mapping, tool lifetime including the drop on `turn/end`, turn outcome recording, the whole-value projection rules, snapshot projection, and the HTTP surface including traversal refusal.

It also cross-checks the wiring that fails silently in a live window: the options `startWidget` reads against those `widgetOptions` passes, the element ids `renderer.js` looks up against those `index.html` declares, and every asset referenced by `renderer.js`, `widget.css` and `index.html` against the files that ship. Each of the three has been wrong — a missing preload path, a misnamed projection key, a module served as `application/octet-stream` — and none of them raise an error where a user would see it.

`apps/desktop/tests/widget-settings.test.mjs` covers the profile wiring against a throwaway harness home: that the package and row are written, that the template's empty `[]` is replaced rather than joined by a second YAML document, that a second install reports no change, that `uninstall` restores the file byte for byte, that a hand-written row survives, that the bundle's loader id is the package name, and that `DSH_HOME` resolution matches the spawned backend's. Each assertion corresponds to a failure observed live or caught by the loader's own error — the second YAML document, the missing `config: {}`, and the wrong bundle id all failed the backend boot before they were tests.

The widget was additionally verified against a live `dsh web` backend: `session.list` baselines for 36 sessions, a real `/api/events.mux` subscription, and a fold over a real 2,534-event session that agreed with the `sessionStats` projection. Both the working and completed surfaces were rendered from live session data.

Under Electron the widget was booted against a live backend and reported a created window at the expected bounds, a loaded whale image, a present preload bridge, a working `Audio` constructor, and 22 sessions from the backend's state route before closing cleanly. The option-consistency test exists because that first live run was the only thing that could have caught the missing `preloadPath`: every other check passed while the window was permanently click-through.
