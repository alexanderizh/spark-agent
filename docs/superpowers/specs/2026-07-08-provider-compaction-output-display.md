# Provider Compaction Output Display

> 状态: 已落地 | 最后核对: 2026-07-08

## 目标

在对话流中展示 Claude Code / Codex 运行时真实上报的上下文压缩信息，避免用 Spark 自己的 token 估算或文案伪造“压缩输出”。

## 实现约束

- Claude Code：仅消费 Agent SDK 真实 `system/status` 与 `system/compact_boundary` 消息。
  - `status: compacting` 显示为压缩开始。
  - `compact_result` 显示压缩完成或失败。
  - `compact_boundary.compact_metadata` 显示 `trigger`、`pre_tokens`、`post_tokens`、`duration_ms`。
- Codex SDK / Codex CLI：当前公开类型没有稳定的压缩事件；只有当真实事件 `type`、`hook_event_name` 或字段名明确包含 `compact` / `compaction` 时，才透传为压缩事件。
- `summary` 只展示 provider / CLI 原始事件携带的 `compact_summary`、`compaction_summary` 或同一 compact 事件里的 `summary`，Spark 不合成摘要正文。

## 事件协议

新增 `context_compaction` 事件：

```ts
{
  type: 'context_compaction'
  provider: 'claude' | 'codex'
  source: 'claude_code' | 'codex_cli' | 'codex_sdk'
  phase: 'started' | 'completed' | 'failed' | 'boundary'
  trigger?: 'manual' | 'auto' | string
  preTokens?: number
  postTokens?: number
  durationMs?: number
  summary?: string
  message?: string
  rawType?: string
}
```

## UI 行为

`MessageBuilder` 将 `context_compaction` 归约为 `context_compaction` block；ChatView 用轻量卡片展示来源、阶段、真实 token 前后值、耗时、原始事件类型，以及真实 summary / error message。
