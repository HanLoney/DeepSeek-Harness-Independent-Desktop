# @deepseek-ai/dsh-tool-image-gen

English | [中文](README.zh.md)

Optional image-generation tool for a Harness profile. The host plugin registers `generate_image`, serves generated attachments through a same-origin `/image-gen` route, and supports edits from explicit image tokens or images in the current user message. The browser entry renders generated images and exposes the plugin settings panel.

## Profile installation

This plugin is opt-in and is not mounted by the shipped `dsh-base` or `dsh-web-app` bundles. Build the workspace, pack this package, install the resulting archive into the target profile with `dsh plugin --profile <name> add <tarball>`, and add a Cordis row for `@deepseek-ai/dsh-tool-image-gen` to that profile's `cordis.patch.yml`. Profile loading is described in the [plugin publishing guide](../../../docs/user/develop/basic/publish.md).

From the repository root, `pnpm build` compiles this package (tsc copies the checked-in upstream JavaScript and tsdown bundles it), then `pnpm --dir packages/tools/image-gen pack` produces the installable tarball.

## Configuration

The package settings panel owns the `image-gen` namespace. The composition config uses `apiKeyEnv`, `baseURL`, `model`, `size`, and `saveToWorkspace`. The default API credential reference is `TEST_API_KEY`; provision that credential in the Harness credential store before making a request. The credential value is stored separately from the ordinary settings document.

`generate_image` sends a generation request by default and uses the edits endpoint when image references are supplied. Generated raster bytes are stored as durable attachments; workspace copies are written when enabled and the calling session provides a working directory. Image bytes are returned to the model only when the active model route accepts image input.

## Model Experience

### generate_image tool

#### What the model sees

One model-facing tool, `generate_image`, with `prompt` (required), `size`, `filename`, and `images` parameters; the schema description instructs English prompts, forbids inventing attachment metadata, and points reference-based edits at the image edits endpoint.

#### Token effect

Fixed schema cost on every request while the plugin is mounted.

#### KV Cache effect

Prefix-stable while the plugin stays mounted and the schema is unchanged.

### Generation result

#### What the model sees

A successful call returns `prompt`, `model`, `size`, `modelSeesImage`, the opaque `image` token, and an `attachment` envelope (`attachmentId`, `mediaType`, `bytes`, `width`, `height`), plus `file` when a workspace copy was written. When the routed model declares image input, the raster itself rides the next request as an image block beside the text envelope; on a text-only route the model receives the envelope without the image bytes.

#### Token effect

The result envelope is resent until compaction; on an image-capable route, the generated image is billed on every later request until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The runtime ships as checked-in upstream JavaScript** — the upstream source tree contains no TypeScript implementation, so `src/runtime.js` and `src/client.js` stay as delivered; the workspace build bundles them without re-typing their logic.
- **The provider uses an OpenAI-compatible image API at a configured endpoint** — the plugin does not validate whether the configured endpoint is trusted, and the default endpoint is a placeholder gateway that a deployment must replace.
