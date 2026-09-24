# Agent Note: Codex rollout bridge

Status: implemented

English | [中文](2026-09-22-codex-rollout-bridge.zh.md)

## Problem

Work started in Codex and work in the harness lived in two disconnected stores. A developer who wanted to keep going on a Codex thread had to copy context by hand, and could not hand a harness session back to Codex at all. Codex keeps a thread as an append-only JSONL rollout plus two registry rows; the harness keeps a session as a concatenated-frame artifact plus the session log's own event vocabulary. Neither format knows about the other.

## Decision

`@deepseek-ai/dsh-codex-bridge` converts between the two stores as a plain file transformation, in both directions.

An **import** merges a thread's shard chain, folds Codex rollout lines into DSH session events, and writes one artifact where the ordinary backend would look for it. An **export** folds a DSH session back into a `legacy` Codex thread — one rollout, one `session_index.jsonl` line, one `threads` row in `state_5.sqlite` — because a rollout file alone is an orphan the Codex UI will not list.

The package registers no tool and no service. It is a library plus a CLI; a deployment that wants model-facing commands binds the exported functions itself. This keeps the bridge out of every composition that does not ask for it and keeps the conversion testable without booting an agent.

### The fold

Codex records most turns twice: once as a `response_item` and once as an `event_msg` carrying the same content. The fold reads the `response_item` view and drops the other. This roughly halves the raw line count, so the fold reports every dropped view under `ImportReport.skipped` rather than dropping silently.

Codex reasoning items carry only an opaque `encrypted_content` blob. There is no readable content to fold and no representation to emit on export, so the fold drops them and reports each one. An imported session therefore has the conversation but not the original reasoning trace. This is the round trip's one deliberate loss, and it is documented as such rather than hidden.

Harness-injected context blocks — environment context and the like — are filtered by their `internal_chat_message_metadata_passthrough.content_item_kinds` marker, while a direct prompt carrying the plain instructions marker is kept. Filtering by marker rather than by text keeps the fold from discarding a user's own message that happens to look like injected context.

### The shard merge

A Codex continuation shard resumes its parent's thread-global `ordinal` numbering and *overlaps* it: the same turn can appear in two shards under the same ordinal. The merge de-duplicates by ordinal, keeping the first shard's copy in filename order and appending ordinal-less lines last. This is derived from the observed structure of a real six-shard chain, not from a documented contract, so the live suite asserts the merged ordinals are monotonic and counts every duplicate rather than assuming the shape.

### The export target

Export always writes `history_mode = 'legacy'`. A `paginated` thread splits events across shards and the registry byte offsets must stay consistent with the rollout that holds them; `legacy` keeps every event in one file and needs none of that bookkeeping. Choosing the mode the bridge can write correctly, rather than the one that mirrors what it read, means an export cannot desynchronize a paginated chain.

### Zstandard framing

A DSH artifact is a concatenation of independently decodable, checksummed Zstandard frames: one header frame holding exactly the header line, then one frame per batch of event lines. The bridge reproduces this framing directly instead of calling into `dsh-session-persistence-jsonl`, which owns its frames as an implementation detail and exports no framing entry point. The framing is small and the artifact format has no compatibility promise (`SESSION_FORMAT_VERSION` stays `0`), so the duplication is bounded and the reader validates what it wrote. The container itself is owned by [the Zstandard JSONL session logs note](../architecture/2026-07-19-zstandard-jsonl-session-logs.md); this note records only that the bridge reproduces it rather than sharing it.

## Alternatives considered

**Reading and writing through the persistence service instead of raw files.** Rejected: the service is built around a live `Session`, and an import creates a new session id rather than appending to a running one. Going through the service would require booting an agent to move bytes between two files, and would couple a migration tool to live-session lifecycle.

**Exporting `paginated` threads.** Rejected: it adds byte-offset bookkeeping across a shard chain for no capability the `legacy` form lacks. Codex continues a legacy thread by appending, which is exactly what the bridge produces.

**Folding the `event_msg` view and synthesizing `response_item` on export.** Rejected: the two views are not equivalent. `event_msg` wraps content in a UI shape, so folding it would make the round trip lossier in the common case to gain nothing in the rare one.

**Reconstructing reasoning from the encrypted blob.** Not possible: the blob has no readable content and no key available to the bridge. Documented as a limitation instead.

## Consequences

The bridge carries a small reimplementation of DSH's frame container. It must move with the format, and the artifact reader re-validates the framing on read rather than trusting the writer, so a drift shows up as a read failure in tests rather than a silently unreadable session.

An imported session is a new session with a new id under the project directory of its recorded `cwd`. It never appends to the session that provoked the import, so it cannot disturb a live agent's context or KV cache.

The round trip carries the conversation and the tool calls in it: each Codex `function_call` becomes a DSH `tool/call` and each `function_call_output` a `tool/result`, so a real six-shard thread round-trips with its 2851 tool calls and outputs intact. Turn and step boundaries are synthesized on import and re-emitted as `event_msg` on export, so their counts survive though the original step numbers are re-derived.
