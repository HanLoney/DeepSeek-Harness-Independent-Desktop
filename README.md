# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

This repository also ships **DeepSeek Harness Desktop**, a configurable Electron host for the Harness Web UI. The desktop edition keeps the Harness plugin/runtime architecture intact while adding a native Windows window, tray lifecycle, custom backgrounds and opacity, personalized prompts, a thinking-intensity slider, and black DeepSeek icon assets. It is maintained as an independent community distribution at [HanLoney/Deepseek-harness-desktop](https://github.com/HanLoney/Deepseek-harness-desktop), while the upstream project remains [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

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

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### Run the desktop application

The desktop host is a development preview and currently targets Windows x64 for packaging:

```sh
pnpm install
pnpm run build
pnpm desktop
```

The first launch creates a desktop configuration file under `%APPDATA%/DeepSeek Harness Desktop/`. Use the **应用** menu to open that folder or reload the configuration. The desktop host supports a custom CSS file, window/tray behavior, keyboard shortcuts, a custom background image with live opacity, and a deployment-wide personalized prompt. See the [desktop guide](apps/desktop/README.md) for the complete configuration reference and [中文说明](apps/desktop/README.zh.md).

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
