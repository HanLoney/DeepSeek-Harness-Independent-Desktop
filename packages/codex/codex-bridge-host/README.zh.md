# @deepseek-ai/dsh-codex-bridge-host

[English](README.md) | 中文

应用内 Codex 桥接的 Host 半边：它只注册一条仅限回环的 RPC 通道 `/codex-bridge`，供浏览器设置页调用。这条通道把"在页面上交互式驱动 [`dsh-codex-bridge`](../codex-bridge/README.md)"所需的东西暴露出来——列出本机的 Codex 线程与 DSH 会话、启动一次导入或导出、读取它的进度。

库本身每个方向只有一次性的调用。而应用内界面还需要三样它不提供的东西：可移动对象的列表、工作时能报告进度的运行、以及能从第二个请求读到这份报告的地方。本包恰好补上这三样，并且不夹带自己的策略——它搬运的每个文件都走库自己的折叠与写入器。

## 端点

五个方法都接通道上的 `ClientRequest` 信封，返回 `RpcResult`。

| 方法 | 载荷 | 返回 |
| --- | --- | --- |
| `threads/list` | `{ codexHome? }` | `{ codexHome, threads: CodexThreadSummary[] }` |
| `sessions/list` | `{ sessionRoot? }` | `{ sessionRoot, sessions: DshSessionSummary[] }` |
| `runs/start-import` | `{ threadId, codexHome?, sessionRoot?, cwd? }` | `{ id }` |
| `runs/start-import-batch` | `{ threadIds, codexHome?, sessionRoot? }` | `{ id }` |
| `runs/start-import-batch` | `{ threadIds, codexHome?, sessionRoot? }` | `{ id }` |
| `runs/start-export` | `{ sessionId, sessionRoot?, codexHome?, dryRun }` | `{ id }` |
| `runs/read` | `{ id }` | `{ run: BridgeRun \| null }` |

两个列表端点默认指向 `$CODEX_HOME`/`~/.codex` 与 `$DSH_HOME/sessions`。`threads/list` 遍历 rollout 目录树，并连接 `session_index.jsonl` 取标题，因为线程目录名是 id，侧栏那一行才是它名字唯一的所在；同时读取 `state_5.sqlite` 的 `threads.cwd`，把工作目录最后一段作为项目标签；没有索引行或数据库行的线程仍按 id 列出并计数，不会被丢掉。`sessions/list` 报告每个会话的项目、字节数与最后写入时间。

## 运行

启动端点立即返回运行 id，实际工作分离执行，因为折叠一个大线程会超出一次请求的时长。调用方随后轮询 `runs/read` 读取 `BridgeRun`：

- `status` 为 `running`、`completed` 或 `failed`。
- `stage` 是操作对自己当前阶段的标签（`locating rollout`、`folding events`、`writing artifact` 等），不是通用的状态词。
- `progress` 是 `[0, 1]` 区间内的比例，且从不后退：报告更小值的 reporter 会被忽略。
- `log` 是操作的过程记录——它读过的分片路径、丢弃的跳过分组及原因、写出的产物——形如 `{ at, level, text }` 的行。
- `result` 在结算时出现，带一行 `summary` 和一个 `facts` 标签/值列表。

运行一旦结算，reporter 即失效，因此迟到的进度调用无法让已结束的运行状态复活。已结算的运行保留供读取，表超过上限后按最旧优先淘汰；日志行在自己的上限内按最新优先保留。两个上限都是实现常量，不是部署可调项。

轮询属于调用方而不属于服务端：本包不持有定时器、不推送任何东西，因此停止轮询的页面只是停止观察而已。

## 组合

下面这一行就是全部注册；浏览器半边是 [`dsh-client-ui-codex-bridge`](../../client/ui-codex-bridge/README.md)，两者成对使用。

```yaml
- id: codex-bridge-host
  name: '@deepseek-ai/dsh-codex-bridge-host'
```

通道以 `authority: 'loopback'` 注册：每个端点都会读写用户自己的主目录，因此远程调用方绝不能触达它。若某个部署想要不同的权限或不同的端点集合，就在导出的 `RunRegistry`、`listThreads`、`listSessions`、`runImport`、`runExport` 之上写自己的插件。

## 测试

`tests/runs.spec.ts` 直接覆盖运行注册表：进度单调性与钳制、日志上限、淘汰顺序，以及结算对后续报告施加的冻结。

`tests/channel.spec.ts` 在真实的回环服务器上、以真实的 Connection host 启动真实插件，因此整条请求路径——客户端信封、Connection 解码、端点处理器、响应信封——都被真实走过而非模拟。它列出本机的线程与会话，并把一次针对不存在线程的导入驱动到记录下来的失败。

## Known Limitations and Deferred Work

- **进度是轮询而非推送。** 通道不持定时器、不发流，因此页面了解运行状态只能按它询问的频率。要推送就需要一个本包未开启的转发事件端口。
- **每次列都会读整棵 rollout 目录树。** `threads/list` 在每次请求时 stat `~/.codex/sessions` 下的每个分片。典型主目录上是几百个文件；目录树极大的部署会想要缓存扫描，而库目前不提供。
- **运行自身的失败是文本。** 导入或导出失败时通过 `stage` 与 `log` 行报告而非类型化错误数据，因此调用方能显示原因，却无法按其种类分支。
