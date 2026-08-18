# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

本仓库同时提供 **DeepSeek Harness Desktop**：一个可高度配置的 Electron 桌面宿主，用于承载 Harness Web UI。桌面版保留 Harness 的插件与运行时架构，并增加原生 Windows 窗口、托盘生命周期、自定义背景与透明度、个性化提示词、思考强度滑条以及黑色 DeepSeek 图标资源。桌面版作为独立的社区发行仓库维护于 [HanLoney/Deepseek-harness-desktop](https://github.com/HanLoney/Deepseek-harness-desktop)，上游项目仍是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

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

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### 运行桌面应用

桌面宿主目前处于开发预览阶段，打包目标为 Windows x64：

```sh
pnpm install
pnpm run build
pnpm desktop
```

首次启动会在 `%APPDATA%/DeepSeek Harness Desktop/` 下创建桌面配置文件。可通过**应用**菜单打开配置所在文件夹或重新加载配置。桌面宿主支持自定义 CSS、窗口与托盘行为、键盘快捷键、带实时透明度预览的自定义背景图片，以及部署级个性化提示词。完整配置字段请参阅[桌面端说明](apps/desktop/README.md)和[中文说明](apps/desktop/README.zh.md)。

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
