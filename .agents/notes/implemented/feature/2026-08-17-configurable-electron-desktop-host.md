# Agent Note: Configurable Electron desktop host

Status: implemented

English | [中文](2026-08-17-configurable-electron-desktop-host.zh.md)

## Problem

The Web product exposes the complete Harness client but has no installable desktop lifecycle. Reimplementing its UI or transport for a desktop-only product would split the client-plugin roster, settings behavior, and verification paths before a native-only capability requires that split.

## Decision

`apps/desktop` is an Electron application that starts the shipped `@deepseek-ai/dsh` CLI with the Web profile on a loopback port selected by the OS. The main process waits for the existing `dsh web:` readiness line and loads that exact origin in a sandboxed `BrowserWindow`. The application carries the repository's supported Node.js runtime, so packaged execution does not depend on a system installation or Electron's different embedded Node.js version.

`apps/desktop/runtime-package` is the zero-code deployment root for packaging. It lists every workspace package reachable from the desktop Web product as a direct dependency, including required peers, because pnpm's legacy deploy can otherwise leave a hoisted workspace package outside the target. The build verifies that peer closure, deploys a production-only flat tree, restores omitted direct packages, and materializes every link. Electron then receives a minimal app archive plus that external runtime tree; NSIS consumes the already assembled and independently runnable `win-unpacked` directory instead of traversing the development workspace.

The desktop process owns window and process lifecycle, tray behavior, global shortcuts, external-link handoff, and CSS injection. Its JSON document under Electron's `userData` directory configures those values and the Harness workspace. Model providers, Agent presets, plugins, settings, and durable session data remain owned by the unchanged Web profile.

An enabled native frame uses Electron's hidden title bar and Window Controls Overlay. A built-in stylesheet reserves a transparent 36-pixel draggable strip above the Web root without adding a fill, blur, shadow, or component-level presentation override; the operating system continues to own minimize, maximize, restore, close, snapping, and accessibility behavior.

One checked-in black DeepSeek PNG/ICO asset set supplies the window, tray, packaged executable, installer, and uninstaller. The Windows prepackaging step edits the renamed Electron executable's resources before NSIS consumes the directory.

The shared `ui-theme` settings row stores the built-in palette preference, an optional bounded image data URL, its visible opacity, and an optional personalized prompt. It accepts supported background sources without an input byte limit, preserves files that already fit, and locally downscales and encodes larger images as WebP before persistence. The opacity slider publishes every input through the existing theme snapshot, so its thumbnail and the client presenter's translucent application surfaces update before the value is persisted. The Host registers the personalized text as an order-10 system-prompt section, so the next assembled request includes it and the existing `request/header` event records the exact model-visible value.

The renderer has no Node integration or preload bridge. Context isolation and Chromium sandboxing stay enabled, permission requests are denied, and top-level navigation is restricted to the selected loopback origin. The existing API trust fence therefore retains the same request and downlink behavior as a loopback browser.

This decision supersedes the hypothetical Electron IPC carrier in the [GUI layering decision](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md). An IPC carrier remains a valid replacement only when a native-only capability requires a renderer-to-main protocol; it must replace the transport without forking the client plugins.

## Alternatives considered

**A `file://` renderer with a new IPC carrier.** It removes the loopback listener but must implement unary requests, both downlink streams, client-plugin bundle loading, readiness, reconnect, and trust semantics before adding user-visible desktop value. The existing carrier already supplies and verifies those behaviors.

**A separate desktop renderer.** A second UI could optimize native presentation, but it would duplicate the Web product's plugin slots, settings, session views, and model interaction. Custom CSS and the existing client-plugin roster provide the requested presentation and product customization without that split.

**A fully frameless window with application-owned controls.** Reimplementing native window actions, snapping, and accessibility requires a renderer-to-main control bridge. Window Controls Overlay integrates the title region without adding that protocol.

**A thin launcher that requires the user to start `dsh web`.** It reduces main-process code but is not a self-contained desktop application and leaves backend shutdown, port selection, and failure reporting outside the product lifecycle.

## Consequences

Desktop and browser clients share the same Web build and HTTP/WebSocket behavior. The desktop Web root reserves 36 pixels for the integrated title region when the native frame is enabled; browser geometry is unchanged. The installer carries Electron, Node.js, and the production `@deepseek-ai/dsh` dependency closure, so it is larger than a system-WebView shell. Loopback binding remains part of desktop startup; the Web server's existing host validation and trust fence remain security-critical.

The configuration parser has a keyless Node test for defaults, accepted customization, and invalid values. Desktop verification additionally launches the real Electron window against the real Web profile. Windows packaging verifies the 194-package workspace closure and required native modules. Release verification launches the resulting executable, checks that its bundled backend serves the Harness page over loopback, and builds the installer from that same directory.
