# Agent Note: Codex rollout bridge

Status: implemented

[English](2026-09-22-codex-rollout-bridge.md) | 中文

## Problem

在 Codex 中开始的工作与 harness 中的工作分处两个互不相连的存储。想接着推进某个 Codex 线程的开发者只能手工搬运上下文，而且完全无法把 harness 会话交回 Codex。Codex 把一个线程保存为追加式 JSONL rollout 外加两行注册表记录；harness 则把一个会话保存为拼接 frame 的 artifact，外加会话日志自身的事件词汇。两种格式互不知晓对方。

## Decision

`@deepseek-ai/dsh-codex-bridge` 以纯文件变换的方式在两个存储之间双向转换。

**导入**会合并线程的分片链、把 Codex 的 rollout 行折叠为 DSH 会话事件，并写入一个 artifact，放在普通后端会去查找的位置。**导出**会把一个 DSH 会话折回为一个 `legacy` Codex 线程——单个 rollout、一行 `session_index.jsonl`、`state_5.sqlite` 中的一行 `threads`——因为只有 rollout 文件会成为 Codex 界面不予列出的孤儿。

此包不注册任何工具或服务。它是一个库加一个 CLI；需要面向模型命令的部署自行绑定导出的函数。这让 bridge 不进入任何未主动要求它的组合，也让转换可以在不启动 agent 的情况下被测试。

### 折叠

Codex 把大多数轮次记录两次：一次作为 `response_item`，一次作为携带相同内容的 `event_msg`。折叠读取 `response_item` 视图并丢弃另一个。这大约把原始行数减半，因此折叠会把每个被丢弃的视图记入 `ImportReport.skipped`，而不是静默丢弃。

Codex 的推理项只携带一个不透明的 `encrypted_content` blob。既没有可折叠的可读内容，也没有可在导出时输出的表示形式，因此折叠会丢弃它们并逐个报告。导入的会话因此拥有对话，但没有原始推理轨迹。这是往返中唯一的有意损失，并且被明确记录，而不是隐藏。

harness 注入的上下文块——环境上下文之类——通过其 `internal_chat_message_metadata_passthrough.content_item_kinds` 标记过滤，而携带普通 instructions 标记的直接提示会被保留。按标记而非按文本过滤，可避免折叠丢弃用户自己的、恰好看起来像注入上下文的消息。

### 分片合并

Codex 的续写分片会延续父线程的线程全局 `ordinal` 编号并与之*重叠*：同一个轮次可能以相同 ordinal 出现在两个分片里。合并按 ordinal 去重，按文件名顺序保留靠前分片的副本，并把没有 ordinal 的行追加在最后。这是从一条真实的六分片链的观察结构中推导出来的，而非来自某个有文档的契约，因此 live 套件断言合并后的 ordinal 单调，并统计每一个重复项，而不是假设其形状。

### 导出目标

导出总是写 `history_mode = 'legacy'`。`paginated` 线程会把事件分散到分片中，注册表的字节偏移必须与持有它们的 rollout 保持一致；`legacy` 把每个事件放在一个文件里，不需要这些簿记。选择 bridge 能正确写入的模式，而不是镜像它读到的模式，意味着导出不会让一条分片链失去一致性。

### Zstandard frame

DSH 的 artifact 是若干可独立解码、带校验和的 Zstandard frame 的拼接：一个恰好只放头行的 frame，随后每批事件行一个 frame。bridge 直接复现这一 frame 结构，而不调用 `dsh-session-persistence-jsonl`——后者把 frame 作为实现细节持有，并不导出 frame 入口。该容器由 [Zstandard JSONL 会话日志笔记](../architecture/2026-07-19-zstandard-jsonl-session-logs.md)持有；本笔记只记录 bridge 选择复现它而非共享它。frame 结构很小，且 artifact 格式没有兼容性承诺（`SESSION_FORMAT_VERSION` 保持 `0`），因此这份重复是有界的，且读取器会校验它写入的内容。

## Alternatives considered

**经由持久化服务而非原始文件读写。** 拒绝：该服务围绕 live `Session` 构建，而导入会创建一个新的会话 id，而不是追加到正在运行的会话。经由服务意味着要通过启动一个 agent 来在两个文件之间搬运字节，并把一个迁移工具耦合到 live 会话生命周期。

**导出 `paginated` 线程。** 拒绝：它为一条分片链增加字节偏移簿记，却换不到 `legacy` 形式不具备的任何能力。Codex 通过追加来继续 legacy 线程，而这正是 bridge 所产生的。

**折叠 `event_msg` 视图并在导出时合成 `response_item`。** 拒绝：两个视图并不等价。`event_msg` 把内容包在一种 UI 形状里，因此折叠它会在常见情形中让往返更有损，却在罕见情形中一无所获。

**从加密 blob 重建推理。** 不可行：该 blob 没有可读内容，bridge 也没有可用的密钥。改为记录为一项限制。

## Consequences

bridge 携带一份对 DSH frame 容器的小型复现实现。它必须随该格式一起变动，而 artifact 读取器在读取时会重新校验 frame 结构，而不是信任写入器，因此一旦出现漂移，会表现为测试中的读取失败，而不是一个静默无法读取的会话。

导入的会话是一个带新 id 的新会话，位于其记录的 `cwd` 的项目目录下。它绝不追加到触发导入的那个会话，因此不会扰乱 live agent 的上下文或 KV cache。

往返会保留对话及其中的工具调用：每个 Codex `function_call` 成为一个 DSH `tool/call`，每个 `function_call_output` 成为一个 `tool/result`，因此一条真实的六分片线程能带着它的 2851 个工具调用与输出完好往返。轮次与步骤边界在导入时合成，并在导出时作为 `event_msg` 重新发出，因此它们的数量得以保留，尽管原始步骤编号是重新推导的。
