# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The desktop application hosts the existing `dsh web` product in Electron. It starts the shipped `@deepseek-ai/dsh` launcher on an OS-assigned loopback port, waits for its readiness line, and loads that URL in a sandboxed window. Model providers, Agent presets, plugins, sessions, and settings remain owned by the Harness profile; the desktop process adds native window lifecycle and presentation only.

## Development

Build the repository once, then start the desktop application:

```sh
pnpm run build
pnpm desktop
```

The Electron process uses the user's Documents directory as the default Harness workspace. Set `backend.workspace` in the desktop configuration to pin another directory.

The General settings page includes theme selection, a custom background image, and a deployment-wide personalized prompt. The desktop window, tray, installer, and uninstaller use the checked-in black DeepSeek icon assets.

With the native frame enabled, Electron places the operating-system window controls over a transparent 36-pixel draggable strip. The strip only reserves title-bar space; it adds no fill, blur, shadow, or component styling.

Build a Windows installer with `pnpm desktop:dist`. The command stages the complete production dependency closure from `apps/desktop/runtime-package`, assembles the standalone layout, and writes the installer under `apps/desktop/release/`. The generated `package/`, `runtime/`, and `release/` directories are build products and are ignored by Git.

## Desktop configuration

The first launch writes `%APPDATA%/DeepSeek Harness Desktop/desktop-config.json`. Use **应用 → 打开桌面配置所在文件夹** to locate it and **应用 → 重新加载桌面配置** after editing.

| Field | Behavior |
|---|---|
| `window.width`, `height`, `minWidth`, `minHeight` | Initial and minimum window size. |
| `window.frame`, `transparent`, `alwaysOnTop`, `autoHideMenuBar`, `backgroundColor` | Native window presentation. `frame: true` uses the integrated transparent title bar; `false` is fully frameless. |
| `behavior.closeToTray`, `startMinimized` | Close and startup behavior. |
| `shortcuts.toggleWindow`, `reload` | Electron accelerators; set either value to `null` to disable it. |
| `appearance.customCss` | UTF-8 CSS file injected after the Web UI loads. Relative paths resolve beside `desktop-config.json`. |
| `backend.port` | Loopback port; `0` lets the OS choose an available port. |
| `backend.workspace` | Harness working directory; an empty value uses the user's Documents directory. |

Invalid field types, ranges, colors, shortcut registrations, and unreadable custom CSS fail with a desktop diagnostic instead of silently falling back.

## Security and limitations

The renderer has Node integration disabled, context isolation and Chromium sandboxing enabled, and permission requests denied. Navigation remains on the selected loopback origin; HTTP and HTTPS links open in the default browser.

The desktop application currently reuses the browser HTTP/WebSocket carrier rather than adding a second IPC implementation. This keeps every client plugin on the same tested transport and limits the desktop process to lifecycle and presentation. The [desktop-host decision](../../.agents/notes/implemented/feature/2026-08-17-configurable-electron-desktop-host.md) owns that trade-off.

Packaging currently targets unsigned Windows x64 installers. Code signing, automatic updates, and macOS or Linux artifacts are separate release concerns; development remains cross-platform where Electron and the bundled Node package support the host.
