# @deepseek-ai/dsh-codex-bridge

[English](README.md) | 中文

在 Codex 与 DeepSeek Harness 之间搬运工作：**导入**会读取磁盘上的 Codex 线程，写入为一个 DSH 会话，harness 像打开其他会话一样打开它；**导出**会读取一个 DSH 会话，写回为一个 Codex 线程，Codex 界面会列出并继续它。两个方向都是针对双方磁盘格式的纯文件操作，都不需要停止对方工具。

## 组合

此包是一个库，也是一个 CLI。它不注册任何工具或服务，因此需要面向模型命令的部署要在导出的函数之上编写自己的插件：

```ts
import { importThread } from '@deepseek-ai/dsh-codex-bridge'

declare const codexHome: string
declare const sessionRoot: string
declare const threadId: string

const report = await importThread({ codexHome, sessionRoot, threadId })
console.log(report.sessionId, report.artifactPath, report.eventCount)
```

## 用法

```sh
# list threads Codex has on disk
dsh-codex-bridge list

# import one thread; prints the new session id and artifact path
dsh-codex-bridge import 01a0461d-6bf5-7732-a21b-13b8d6640ac6

# preview an export without writing anything
dsh-codex-bridge export session-7fa34b11-5af3-4ead-bd5c-32123c6f5efa --dry-run

# write the export back into Codex
dsh-codex-bridge export session-7fa34b11-5af3-4ead-bd5c-32123c6f5efa --out-dir "C:\\Users\\me\\.codex\\sessions\\2026\\09\\22"
```

用 `--codex-home` 与 `--session-root` 可以把任一方向指向非默认目录树。导入时加 `--cwd <dir>` 可把会话放到你选择的项目目录下，而不是 rollout 中记录的那个。导出时用 `--artifact <path>` 可以读取项目目录已经迁移的会话。

## 格式

**Codex 一侧。** 一个线程是 `<codex-home>/sessions/YYYY/MM/DD/rollout-<stamp>-<threadId>.jsonl` 下的 rollout 文件，每行一个 JSON 对象，各携带一个线程全局的 `ordinal`。长线程会溢出为续写分片，其文件名追加 `_<shardId>`；分片会延续父线程的 ordinal 编号并与之重叠，因此读取器按 ordinal 合并，并在两个分片共享同一 ordinal 时保留靠前分片的副本。Codex 还通过另外两个存储发现线程——`session_index.jsonl` 中的侧栏行与 `state_5.sqlite` 中的 `threads` 行——导出会三者一起写入，因为只有 rollout 文件会成为界面不显示的孤儿。

**DSH 一侧。** 一个会话 artifact 是若干可独立解码、带校验和的 Zstandard frame 的拼接。第一个 frame 恰好只放会话头那一行；其后每个 frame 放一批事件行。每个事件携带密集且连续的 `seq`，这是回放所要求的。

## 往返

导入会合并分片链、把 Codex 的 item 折叠为 DSH 事件，并写入一个 artifact。导出反向执行这次折叠，产出一个 `legacy` 线程：单个自包含 rollout、一行索引、一行 `threads`。因为导出总是写 `legacy`，导出的线程不需要分片链，也不会让 `paginated` 线程的字节偏移失去一致性。

这次折叠特意只在一个方向上损失信息。把线程导入再导出会保留对话及其中的工具调用——消息文本与顺序、每个 `function_call` 连同其 `call_id` 与参数、以及每个 `function_call_output`——但不会保留推理项：它们既没有可折叠的可读内容，也没有可导出的表示形式。`ImportReport.skipped` 与 `ExportReport.skippedEvents` 会记录每一行被丢弃的内容；不会有任何内容被静默丢弃。

## 测试

`tests/bridge.spec.ts` 用合成 rollout 覆盖格式契约：文件名解析、分片合并与去重、折叠的事件映射及其跳过原因、frame 打包与解包、rollout 构造，以及针对随附 `threads` schema 的注册表写入器。

`tests/live.spec.ts` 与 `tests/roundtrip.spec.ts` 针对机器上现有的 Codex 数据运行，没有数据时跳过。往返测试会导入一个真实的多分片线程，把它导出到一个一次性的 Codex home，验证两个注册表存储，再重新导入该导出，以确认两个方向上的消息数量都没有变化。

## Known Limitations and Deferred Work

- **推理无法在往返中保留。** Codex 的推理项是无可读内容的加密 blob，因此 bridge 无法把它们折叠为 DSH 事件，也无法在导出时重建。导入的会话会显示对话，但不含原始推理轨迹，折叠会报告每个被丢弃的项。
- **轮次与步骤边界是重建的，不是逐字还原的。** 折叠从 Codex 的 task 与 item 标记合成 `turn/start`、`step/start` 与 `step/end`，导出则把轮次标记作为 `event_msg` 重新发出。对话、工具调用及其输出、轮次与步骤数量都能在往返中保留；原始步骤编号是重新推导的，而非原样携带。
- **导出总是写 `legacy`。** 写一个 `paginated` 线程需要让 rollout、索引与 `threads` 行在分片链上保持字节偏移一致。`legacy` 不需要这些簿记，因此 bridge 不尝试它。
- **bridge 不持有 live `Session`。** 它直接读写 artifact，而不经由持久化服务，因此在会话打开时执行的导入或导出不会与该会话自身的写入协调。请对已关闭的会话运行它。
- **Windows 路径形式。** `toExtendedPath` 会输出 Codex 自己写入的 `\\\\?\\` 设备命名空间前缀。在非 Windows 主机上，导出会写 POSIX 路径，这一点未针对真实 Codex 安装做过测试。
