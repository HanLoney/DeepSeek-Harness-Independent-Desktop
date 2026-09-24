# @deepseek-ai/dsh-client-ui-codex-bridge

[English](README.md) | 中文

应用内 Codex 桥接的浏览器半边：`settings.section` 里的一个条目，把 Codex 线程导入为 DSH 会话，也把 DSH 会话导回 Codex，并让每次运行的进度与日志在工作过程中可见。数据完全来自 [`dsh-codex-bridge-host`](../../codex/codex-bridge-host/README.md) 注册的六个端点，因此本包只负责呈现与轮询，别的什么都不管。

## 页面

两个方向标签位于列表之上。**导入** 按 Codex 记录的工作目录最后一段分组显示本机线程，再展示标题、分片数与最后更新时间；缺少这份元数据的线程归入“未归类项目”。**导出** 列出所有 DSH 会话及其项目与大小。每个项目组都有“导入整个项目”操作，会按顺序把其中线程分别导入为独立 DSH 会话；单个线程失败会记入日志，但不会中止其余导入。刷新按钮重新读取当前列表。导入单个线程、整个项目或导出一个会话，都会启动一次运行并把日志面板切到它。

日志面板正是这个页面存在的理由：一个大线程的折叠会占用肉眼可见的时间，而带有操作自身阶段标签的进度条（`locating rollout`、`folding events`、`writing artifact`），加上下方的过程记录，就是"在等"与"在猜"之间的区别。日志行按级别着色，面板随着新行滚动，结算后结果的摘要与事实列表取代进度条。已结束的运行保持可读，直到下一次运行开始。

导出提供 **dry run** 复选框：勾选后，运行只报告它会写什么，不触碰 Codex。该复选框只适用于导出，因此在导入标签下是隐藏的，而不是显示为无效控件。

运行进行中时启动按钮会拒绝第二次启动，因此双击不会把同一线程排两次折叠。这里没有取消：Host 侧既不持定时器也没有取消接缝，而一个已经开始折叠的运行也没有值得保留的中间结果。

## 轮询

页面在运行进行中时每 500 ms 轮询一次 `runs/read`，并在运行结算的那一刻自行停止，或在它所监视的运行 id 被更新的运行取代时停止。页面空闲时不做任何轮询。卸载会释放控制器，从而停掉任何在途轮询——这也正是 fiber 拆除走的同一条路径，因此热重载不会留下一个对着已被替换的 store 运行的定时器。

## 组合

```yaml
- id: ui-codex-bridge
  name: '@deepseek-ai/dsh-client-ui-codex-bridge'
```

本包声明 `dsh.client` 的 `platform: 'web'`，并依赖 `slots`、`locale` 与 `connection`。它注册一个 `settings.section` 条目以及自己的 `settings.codexBridge` 词典对；两者都是 fiber 所有的 effect，因此释放即移除。文案走该命名空间，样式只用 `--dsw-*` 令牌。

## 测试

`tests/browser-plugin.client.spec.ts` 在真实 slot 树上启动浏览器半边：断言设置区条目出现且 fiber 拆除将其移除（HMR 安全）、两本词典通过 `ctx.locale.bind` 注册与撤回、英文词典与中文源保持键完全一致、node 半边的 `apply` 是惰性的，以及 invariant 伴生包保留自己的归属。

## Model Experience

None, as the section renders a browser configuration UI; nothing here reaches a model request.

#### KV Cache effect

None; this package never assembles or sends a provider request.

## Known Limitations and Deferred Work

- **进度按固定间隔轮询。** 500 ms 是实现常量而非部署可调项；恰好在两次轮询之间结束的运行会显示一帧滞后状态。推送通道能去掉这个间隔，但 Host 半边并未开启。
- **日志面板只显示最新一次运行。** 开始另一次运行会取代面板内容，因此已结算运行的记录只能读到下一次启动为止。Host 保留其近期运行；本页面没有历史视图。
- **没有取消，也没有按线程过滤。** 取消需要通道未暴露的 Host 侧取消接缝；而在几百个线程的规模下，列表靠滚动而非搜索。
