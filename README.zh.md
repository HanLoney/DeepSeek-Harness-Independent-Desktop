# DeepSeek Harness 独立桌面版

中文 | [English](README.md)

**DeepSeek Harness 独立桌面版**是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的开源独立 Electron 发行版，面向 Windows 桌面使用场景。

它直接承载 Harness 原有的 Web UI，保留插件化 Agent 运行时、模型提供方、Agent preset、会话与设置；桌面进程只负责原生窗口生命周期、托盘和呈现。桌面版代码位于 [`apps/desktop`](apps/desktop/)，发行仓库为 [HanLoney/DeepSeek-Harness-Independent-Desktop](https://github.com/HanLoney/DeepSeek-Harness-Independent-Desktop)。

## 桌面版特性

- 原生 Electron 窗口、透明标题栏、无边框模式、置顶和最小化启动。
- 托盘驻留、关闭到托盘、显示/隐藏窗口与重新加载快捷键。
- 主题选择、自定义背景图片、背景透明度和部署级个性化提示词。
- 会话内模型选择与思考强度调节继续由 Harness Web UI 提供。
- 独立桌面配置文件、可选自定义 CSS，以及默认使用用户“文档”目录的 Harness workspace。
- 黑色 DeepSeek 图标、桌面快捷方式、开始菜单入口和未签名 Windows x64 安装程序。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从本仓库源码运行：

```sh
git clone https://github.com/HanLoney/DeepSeek-Harness-Independent-Desktop.git
cd DeepSeek-Harness-Independent-Desktop
pnpm install
pnpm run build
pnpm dsh web
```

如果只需要上游项目，不需要桌面宿主，请使用 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

### 运行桌面应用

桌面宿主目前处于开发预览阶段，打包目标为 Windows x64：

```sh
pnpm install
pnpm run build
pnpm desktop
```

首次启动会在 `%APPDATA%/DeepSeek Harness Desktop/` 下创建桌面配置文件。可通过**应用**菜单打开配置所在文件夹或重新加载配置。完整配置字段请参阅[桌面端中文说明](apps/desktop/README.zh.md)。

运行 `pnpm desktop:dist` 可组装未签名的 Windows 安装程序。构建产物写入 `apps/desktop/release/`，并且已由 Git 忽略。当前预览版不包含代码签名、自动更新以及 macOS/Linux 安装程序。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
