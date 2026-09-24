# @deepseek-ai/dsh-tool-image-gen

[English](README.md) | 中文

供 Harness profile 按需安装的图片生成工具。Host 插件注册 `generate_image`，通过同源 `/image-gen` 路由提供生成后的附件，并支持使用显式图片 token 或当前用户消息中的图片进行编辑。浏览器入口负责渲染生成图片并提供插件设置面板。

## 安装到 Profile

此插件为 opt-in，不随附 `dsh-base` 或 `dsh-web-app` bundle 挂载。构建 workspace、打包本包、用 `dsh plugin --profile <名称> add <tarball>` 将归档安装到目标 profile，并在该 profile 的 `cordis.patch.yml` 中为 `@deepseek-ai/dsh-tool-image-gen` 添加 Cordis row。Profile 加载方式见[插件发布指南](../../../docs/user/develop/basic/publish.md)。

在仓库根目录运行 `pnpm build` 会编译本包（tsc 复制仓库内保存的上游 JavaScript，tsdown 打包），随后 `pnpm --dir packages/tools/image-gen pack` 生成可安装的 tarball。

## 配置

插件设置面板使用 `image-gen` 命名空间。组合配置包括 `apiKeyEnv`、`baseURL`、`model`、`size` 和 `saveToWorkspace`。默认凭据引用为 `TEST_API_KEY`；发起请求前，请先在 Harness 凭据库中配置对应凭据。凭据值与普通设置文档分开保存。

`generate_image` 默认发送生成请求；传入图片引用时使用编辑接口。生成的栅格图像保存为持久化附件；启用工作区副本且调用 session 提供了工作目录时，也会写入工作区。仅当当前模型路由接受图片输入时，图像字节才会回传给模型。

## Model Experience

### generate_image tool

#### What the model sees

一个模型可见工具 `generate_image`，参数为 `prompt`（必填）、`size`、`filename` 和 `images`；schema 描述要求使用英文提示词、禁止编造附件元数据，并让基于参考图的编辑走图片编辑接口。

#### Token effect

插件挂载期间，每个请求都有固定的 schema 开销。

#### KV Cache effect

插件保持挂载且 schema 不变时，前缀稳定。

### Generation result

#### What the model sees

成功调用返回 `prompt`、`model`、`size`、`modelSeesImage`、不透明 `image` token 和 `attachment` 信封（`attachmentId`、`mediaType`、`bytes`、`width`、`height`）；写入了工作区副本时还包含 `file`。当所选模型声明支持图片输入时，栅格图像本身会作为 image block 随文本信封进入下一轮请求；纯文本路由下，模型只收到不含图像字节的信封。

#### Token effect

结果信封在压缩前会随历史重发；支持图片的路由上，生成图像在压缩前按每次请求计费。

#### KV Cache effect

仅追加；新可见内容位于可复用的请求前缀之后，不会使已有的 KV-cache 条目失效。

## Known Limitations and Deferred Work

- **运行时以仓库内保存的上游 JavaScript 交付**——上游源码树没有 TypeScript 实现，因此 `src/runtime.js` 与 `src/client.js` 保持原样；workspace 构建只打包它们，不重新推导其逻辑。
- **Provider 使用配置 endpoint 上的 OpenAI-compatible 图片 API**——插件不校验配置的 endpoint 是否可信，默认 endpoint 是部署方必须替换的占位网关。
