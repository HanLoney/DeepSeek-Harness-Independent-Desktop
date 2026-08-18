# DeepSeek Harness Independent Desktop

[中文](README.zh.md) | English

**DeepSeek Harness Independent Desktop** is an open-source, standalone Electron distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for Windows desktop use.

It hosts the existing Harness Web UI directly, keeping the plugin-based Agent runtime, model providers, Agent presets, sessions, and settings intact. The desktop process owns only native window lifecycle, tray behavior, and presentation. Desktop code lives in [`apps/desktop`](apps/desktop/), and the distribution is maintained at [HanLoney/DeepSeek-Harness-Independent-Desktop](https://github.com/HanLoney/DeepSeek-Harness-Independent-Desktop).

## Desktop edition

- Native Electron window, transparent title bar, frameless mode, always-on-top mode, and start-minimized behavior.
- Tray residency, close-to-tray behavior, window toggle, and reload shortcuts.
- Theme selection, custom background images, background opacity, and a deployment-wide personalized prompt.
- Model selection and the conversation-level reasoning-effort control remain part of the Harness Web UI.
- A separate desktop configuration file, optional custom CSS, and the user's Documents directory as the default Harness workspace.
- Black DeepSeek icons, desktop and Start menu shortcuts, and unsigned Windows x64 installers.

The runtime uses an architecture where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run this distribution from source:

```sh
git clone https://github.com/HanLoney/DeepSeek-Harness-Independent-Desktop.git
cd DeepSeek-Harness-Independent-Desktop
pnpm install
pnpm run build
pnpm dsh web
```

For the upstream project without the desktop host, use [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

### Run the desktop application

The desktop host is a development preview and currently targets Windows x64 for packaging:

```sh
pnpm install
pnpm run build
pnpm desktop
```

The first launch creates a desktop configuration file under `%APPDATA%/DeepSeek Harness Desktop/`. Use the **应用** menu to open that folder or reload the configuration. See the [Chinese desktop guide](apps/desktop/README.zh.md) for the complete configuration reference.

To assemble an unsigned Windows installer, run `pnpm desktop:dist`. Build products are written below `apps/desktop/release/` and are intentionally ignored by Git. Code signing, automatic updates, and macOS/Linux installers are not included in this preview.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
