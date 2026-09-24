# Agent Note: Codex bridge in-app surface

Status: implemented

English | [中文](2026-09-23-codex-bridge-in-app-surface.zh.md)

## Problem

[`dsh-codex-bridge`](../../../../packages/codex/codex-bridge/README.md) moves work between Codex and the harness, but only as a library and a CLI. A developer who wants to continue a Codex thread had to leave the app, run a command, and hope the thread id was right.

Three things stood between the library and a usable in-app surface, and none of them was a rendering problem. There was no list of what could be moved, so a person had to know a thread id in advance. A large thread takes visible seconds to fold, so an operation that reports nothing looks hung. And the existing background-job registry could not carry that progress: `JobStart` carries five fields and `JobOutcome.detail` is written only at settlement, so a job shows no percentage and no stage label while it runs.

## Decision

The bridge gains two packages that pair, and the pair is the whole feature. `@deepseek-ai/dsh-codex-bridge-host` registers one loopback-only RPC channel `/codex-bridge` with five endpoints. `@deepseek-ai/dsh-client-ui-codex-bridge` renders one `settings.section` entry that calls it.

### Runs, not jobs

A start endpoint returns a run id immediately and performs the fold detached, because folding a large thread outlasts a request. Progress lives in a `RunRegistry` the caller reads by polling `runs/read`.

The registry is deliberately a second thing rather than a use of `ctx.jobs`. A job's outcome is written once, at settlement; there is no mid-run label update, and no browser-initiated `jobs.start` RPC exists at all, because job producers are tools. Reusing the registry would have meant widening `JobStart` and `JobOutcome` for one consumer, and would still have left no way for a page to start the work.

A reporter is inert once its run settles, so a late progress call cannot resurrect a finished run. Progress is monotonic and clamped, because an operation's phases are not always ordered the way a reader assumes, and a bar that jumps backward reads as a bug rather than as a re-measure. Settled runs and log lines are retained under separate bounds and evicted oldest-first.

### Polling rather than a push

The host holds no timer and pushes nothing; the page polls `runs/read` every 500 ms while a run is live and stops the moment it settles. A push would need a forwarded-event port, which is a wider change than the feature needs, and the interval costs nothing while a run is in flight.

The channel is registered with `authority: 'loopback'`. Every endpoint reads and writes the user's own home directories, so a remote caller must not reach it.

### The library keeps its own policy

Neither package folds anything. Every byte moved goes through the library's existing `importThread` and `exportSession`, so the skip accounting, the shard merge, and the `legacy` export target stay in one place. The host package lists threads, sessions, and detached runs, including a sequential batch-import endpoint; the browser package groups threads by project and starts one batch for a whole group. Each thread becomes an independent DSH session, and a failed thread is logged without stopping later imports. Project labels come from the final segment of `threads.cwd` in Codex's `state_5.sqlite`; threads without that row remain visible under an explicit no-project group.

## Alternatives considered

**Reusing `ctx.jobs` for progress.** Rejected: `JobOutcome.detail` is written only at settlement, so no job can show a live stage or percentage, and no browser-initiated start RPC exists. Widening the job registry for one consumer would put a UI concern into a model-facing surface.

**A `TypertRemoteService` with `@Remote` decorators, as `dsh-goal` does.** Rejected: it needs a generated remote contract for five endpoints. The generic `connection.rpc.handle` channel carries the same traffic with no codegen.

**Pushing progress over a forwarded-event port.** Rejected: it needs a port the feature does not otherwise use, and buys only a shorter interval on an operation a person is already watching.

**Making the CLI's own output the progress source.** Rejected: a page cannot read a process's stdout, and the CLI reports whole stages rather than a running commentary.

## Consequences

Importing and exporting are now reachable without leaving the app, and a slow fold is visibly working rather than apparently hung. The cost is a second progress mechanism beside `ctx.jobs`, which the [Known Limitations](../../../../packages/codex/codex-bridge-host/README.md#known-limitations-and-deferred-work) of the host package bound: a run's own failure is text, so a caller can display a reason but cannot branch on its kind, and there is no cancel.
