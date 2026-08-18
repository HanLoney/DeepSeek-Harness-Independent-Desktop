# `@deepseek-ai/dsh-desktop`

中文 | [English](README.md)

桌面应用通过 Electron 承载现有的 `dsh web` 产品。它让随附的 `@deepseek-ai/dsh` 启动器监听由操作系统分配的回环端口，等到启动器输出就绪地址后，再在沙箱窗口中加载该地址。模型提供方、Agent preset、插件、会话和设置仍由 Harness profile 管理；桌面进程只增加原生窗口生命周期与呈现。

## 开发

先构建一次仓库，再启动桌面应用：

```sh
pnpm run build
pnpm desktop
```

Electron 进程默认使用用户的“文档”目录作为 Harness workspace。要固定其他目录，请设置桌面配置中的 `backend.workspace`。

“常规”设置页提供主题选择、自定义背景图片和部署级个性化提示词。桌面窗口、托盘、安装程序和卸载程序统一使用仓库内的黑色 DeepSeek 图标资源。

启用原生边框时，Electron 会把操作系统窗口按钮覆盖在 36 像素高的透明可拖动区域上。会话页头从该区域下方开始，其操作按钮不会再与窗口按钮处于同一行；两条规则都不增加填充、模糊、阴影或组件样式。

运行 `pnpm desktop:dist` 可生成 Windows 安装程序。该命令会从 `apps/desktop/runtime-package` 暂存完整的生产依赖闭包，组装可独立运行的目录，再把安装程序写入 `apps/desktop/release/`。生成的 `package/`、`runtime/` 和 `release/` 都是构建产物，Git 会忽略它们。

## 桌面配置

首次启动会写入 `%APPDATA%/DeepSeek Harness Desktop/desktop-config.json`。通过**应用 → 打开桌面配置所在文件夹**可定位该文件；编辑后选择**应用 → 重新加载桌面配置**即可生效。

| 字段 | 行为 |
|---|---|
| `window.width`、`height`、`minWidth`、`minHeight` | 初始窗口尺寸和最小尺寸。 |
| `window.frame`、`transparent`、`alwaysOnTop`、`autoHideMenuBar`、`backgroundColor` | 原生窗口外观。`frame: true` 使用融合式透明标题栏；`false` 为完全无边框。 |
| `behavior.closeToTray`、`startMinimized` | 关闭和启动行为。 |
| `shortcuts.toggleWindow`、`reload` | Electron 快捷键；设为 `null` 可停用对应快捷键。 |
| `appearance.customCss` | Web UI 加载后注入的 UTF-8 CSS 文件；相对路径以 `desktop-config.json` 所在目录为基准。 |
| `backend.port` | 回环端口；`0` 表示由操作系统选择可用端口。 |
| `backend.workspace` | Harness 工作目录；空值使用用户的“文档”目录。 |

字段类型、范围、颜色或快捷键注册无效，以及自定义 CSS 无法读取时，桌面端会显示明确诊断，不会静默回退。

## 安全性与限制

渲染器关闭 Node 集成，并启用上下文隔离和 Chromium 沙箱。只有选定回环源中的主框架可以向系统剪贴板写入净化后的文本；剪贴板读取、子框架写入和其他权限请求一律拒绝。页面只能留在该源；HTTP 和 HTTPS 链接会交给默认浏览器打开。

桌面应用目前复用浏览器的 HTTP／WebSocket 载体，不另建一套 IPC 实现。这样所有 client 插件继续使用同一条已验证的传输链，桌面进程只负责生命周期与呈现。[桌面宿主决策](../../.agents/notes/implemented/feature/2026-08-17-configurable-electron-desktop-host.md)记录了这一取舍。

当前打包目标是未签名的 Windows x64 安装程序。代码签名、自动更新以及 macOS 或 Linux 产物属于独立发布事项；只要 Electron 与随附 Node 包支持当前主机，开发模式仍可跨平台运行。
