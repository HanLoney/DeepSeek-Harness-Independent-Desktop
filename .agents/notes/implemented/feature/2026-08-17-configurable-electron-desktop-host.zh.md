# Agent Note: 可配置的 Electron 桌面宿主

Status: implemented

[English](2026-08-17-configurable-electron-desktop-host.md) | 中文

## Problem

Web 产品已经提供完整的 Harness client，但没有可安装的桌面生命周期。在原生专属能力真正需要独立传输之前，为桌面产品重写 UI 或传输会拆分 client 插件清单、设置行为和验证路径。

## Decision

`apps/desktop` 是一个 Electron 应用；它通过操作系统选择的回环端口，使用随附的 `@deepseek-ai/dsh` CLI 启动 Web profile。主进程等待现有的 `dsh web:` 就绪行，再让沙箱化的 `BrowserWindow` 加载该行给出的准确源。应用携带仓库支持的 Node.js 运行时，因此打包后的执行既不依赖系统安装，也不使用 Electron 内嵌的不同 Node.js 版本。

`apps/desktop/runtime-package` 是打包使用的零代码部署根。它把桌面 Web 产品可达的每个 workspace 包（包括必需 peer）都列为直接依赖，因为 pnpm legacy deploy 否则可能把提升后的 workspace 包留在目标目录之外。构建会验证 peer 闭包，部署仅含生产依赖的平坦目录，恢复被遗漏的直接包，并实体化所有链接。随后 Electron 只接收最小应用归档和这棵外置运行时目录；NSIS 使用已经组装并可独立运行的 `win-unpacked` 目录，不再遍历开发 workspace。

桌面进程负责窗口和进程生命周期、托盘行为、全局快捷键、外部链接交接与 CSS 注入。Electron `userData` 目录中的 JSON 文档配置这些值和 Harness workspace。模型提供方、Agent preset、插件、设置与持久会话数据仍由未改动的 Web profile 管理。

启用原生边框时，应用使用 Electron 隐藏标题栏与窗口控件覆盖层。内置样式表会在 Web 根节点上方预留 36 像素高的透明可拖动区域，但不增加填充、模糊、阴影或组件级呈现覆盖；最小化、最大化、还原、关闭、贴靠和无障碍行为仍由操作系统负责。

一套检入仓库的黑色 DeepSeek PNG／ICO 资产统一用于窗口、托盘、打包后的可执行文件、安装程序和卸载程序。Windows 预打包步骤会先编辑重命名后的 Electron 可执行文件资源，再把该目录交给 NSIS。

共享的 `ui-theme` 设置行保存内置配色偏好、受大小限制的可选图片数据 URL、背景显示透明度和可选个性化提示词。它接受受支持的背景源时不限制输入字节数；能直接装入的数据会原样保留，更大的图片则会在持久化前于本地缩小并编码为 WebP。透明度滑块会通过现有主题快照发布每次输入，让缩略图和客户端 presenter 的半透明应用表面在持久化该值前同步更新。Host 把个性化文本注册为顺序为 10 的系统提示词段落，因此下一次组装的请求会包含它，现有 `request/header` 事件也会记录模型实际看到的精确值。

渲染器没有 Node 集成或 preload 桥。上下文隔离和 Chromium 沙箱保持启用，权限请求会被拒绝，顶层导航仅限于选定的回环源。因此，现有 API 信任检查保留与回环浏览器相同的请求和下行行为。

该决策取代了 [GUI 分层决策](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md)中假设的 Electron IPC 载体。只有原生专属能力确实需要渲染器到主进程的协议时，IPC 载体才值得替换现有方案；它必须替换传输，而不能分叉 client 插件。

## Alternatives considered

**使用新 IPC 载体的 `file://` 渲染器。** 它能移除回环监听，但在产生桌面用户价值之前，必须先实现一元请求、两条下行流、client 插件 bundle 加载、就绪、重连和信任语义。现有载体已经提供并验证这些行为。

**独立桌面渲染器。** 第二套 UI 可以针对原生呈现优化，但会复制 Web 产品的插件 slot、设置、会话视图和模型交互。自定义 CSS 与现有 client 插件清单无需这种拆分即可提供所需的呈现和产品定制。

**使用应用自有窗口按钮的完全无边框窗口。** 重新实现原生窗口操作、贴靠和无障碍行为需要一条 renderer 到主进程的控制桥。窗口控件覆盖层无需增加该协议即可融合标题区域。

**要求用户自行启动 `dsh web` 的薄启动器。** 它减少主进程代码，却不是自包含的桌面应用，并把后端关闭、端口选择和失败报告留在产品生命周期之外。

## Consequences

桌面端和浏览器端共享同一套 Web 构建产物与 HTTP／WebSocket 行为。启用原生边框时，桌面 Web 根节点会为融合标题区域预留 36 像素；浏览器几何尺寸不变。安装程序包含 Electron、Node.js 和生产环境 `@deepseek-ai/dsh` 的完整依赖，因此体积会大于系统 WebView 外壳。回环绑定仍是桌面启动的一部分；Web server 现有的 host 校验和信任检查继续承担关键安全责任。

配置解析器使用无需密钥的 Node 测试覆盖默认值、允许的定制和无效值。桌面验证还会让真实 Electron 窗口连接真实 Web profile。Windows 打包会验证 194 个 workspace 包组成的闭包和必需原生模块。发布验证会启动生成的可执行文件，确认其内置后端能通过回环地址提供 Harness 页面，再从同一目录构建安装程序。
