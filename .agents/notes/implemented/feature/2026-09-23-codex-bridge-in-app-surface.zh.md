# Agent Note: Codex 桥接的应用内界面

Status: implemented

[English](2026-09-23-codex-bridge-in-app-surface.md) | 中文

## Problem

[`dsh-codex-bridge`](../../../../packages/codex/codex-bridge/README.md) 能在 Codex 与 harness 之间搬运工作，但只是以库和 CLI 的形式。想接着写一个 Codex 线程的开发者必须离开应用、跑一条命令，并且祈祷线程 id 没搞错。

在库与可用的应用内界面之间隔着三件事，而且没有一件是渲染问题。没有可搬运对象的列表，因此人得事先知道线程 id。一个大线程折叠起来要花肉眼可见的几秒，所以一个不报告任何东西的操作看起来像卡死了。而现有的后台任务注册表无法承载这类进度：`JobStart` 只有五个字段，`JobOutcome.detail` 只在结算时写入，因此任务在运行中既不显示百分比也不显示阶段标签。

## Decision

桥接获得两个成对的包，而这一对就是整个特性。`@deepseek-ai/dsh-codex-bridge-host` 注册一条仅限回环的 RPC 通道 `/codex-bridge`，含五个端点。`@deepseek-ai/dsh-client-ui-codex-bridge` 渲染一个 `settings.section` 条目来调用它。

### 用运行，而不是任务

启动端点立即返回运行 id，并分离执行折叠，因为折叠一个大线程会超出一请求的时长。进度存放在调用方通过轮询 `runs/read` 读取的 `RunRegistry` 里。

这个注册表是刻意另起的一个东西，而不是对 `ctx.jobs` 的使用。任务的结果只在结算时写入一次；没有运行中的标签更新，也根本不存在浏览器发起的 `jobs.start` RPC，因为任务的产生者只有工具。复用该注册表意味着为一个消费者拓宽 `JobStart` 与 `JobOutcome`，而且仍然没有让页面启动工作的办法。

运行一旦结算，reporter 即失效，因此迟到的进度调用无法让已结束的运行复活。进度是单调且被钳制的，因为一个操作的各阶段并不总按读者以为的顺序发生，而一条会倒退的进度条读起来像 bug，而不像重新测量。已结算的运行与日志行在各自的上限下保留，并按最旧优先淘汰。

### 轮询而非推送

Host 不持定时器、不推送任何东西；页面在运行进行中每 500 ms 轮询一次 `runs/read`，并在结算的瞬间停止。推送需要一个转发事件端口，这比该特性所需的范围更大，而在一段运行在途的时间里，这个间隔不花任何代价。

通道以 `authority: 'loopback'` 注册。每个端点都读写用户自己的主目录，因此远程调用方绝不能触达它。

### 库保留自己的策略

两个包都不折叠任何东西。搬运的每个字节都走库已有的 `importThread` 与 `exportSession`，因此跳过统计、分片合并与 `legacy` 导出目标都留在一处。Host 包列出线程、会话与分离运行，并提供顺序批量导入端点；浏览器按项目分组线程，并可一次启动整组导入。每个线程仍生成独立 DSH 会话；单个线程失败会写入日志，不会阻止后续导入。项目标签取自 Codex `state_5.sqlite` 的 `threads.cwd` 最后一段；没有该行元数据的线程仍会显示在明确的未归类项目下。

## Alternatives considered

**复用 `ctx.jobs` 承载进度。** 拒绝：`JobOutcome.detail` 只在结算时写入，因此任何任务都无法显示实时阶段或百分比，也不存在浏览器发起的启动 RPC。为一个消费者拓宽任务注册表会把一个界面关注点放进模型可见的界面里。

**像 `dsh-goal` 那样使用带 `@Remote` 装饰器的 `TypertRemoteService`。** 拒绝：五个端点需要一份生成的远程契约。通用的 `connection.rpc.handle` 通道以零代码生成承载同样的流量。

**通过转发事件端口推送进度。** 拒绝：它需要一个该特性原本不用的端口，而换来的只是一个人已在注视的操作上更短的间隔。

**把 CLI 自身的输出当作进度来源。** 拒绝：页面无法读取进程的 stdout，而且 CLI 报告的是整段阶段而非持续的过程记录。

## Consequences

现在导入与导出无需离开应用即可完成，一次缓慢的折叠也能看得出来在工作，而不是看起来像挂住了。代价是在 `ctx.jobs` 旁边多了第二套进度机制，这一点由 Host 包的 [Known Limitations](../../../../packages/codex/codex-bridge-host/README.md#known-limitations-and-deferred-work) 界定：运行自身的失败是文本，因此调用方能显示原因却无法按其种类分支，而且没有取消。
