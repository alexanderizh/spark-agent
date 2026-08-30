/**
 * @module recall-memory.tool
 *
 * recall_memory 内置工具 — 让 agent 在需要时读取记忆的完整正文
 *
 * 注册到 agent runtime 的 tool schema，当 agent 判断 system prompt
 * 中的摘要不足以决策时，主动调用来获取完整上下文。
 *
 * 每次调用会同步更新 hit_count 和 last_hit_at。
 */

export const RECALL_MEMORY_TOOL_NAME = 'recall_memory'

export const recallMemoryToolSchema = {
  name: RECALL_MEMORY_TOOL_NAME,
  description:
    '读取一条长期记忆的完整正文（含 Why / How to apply）。当 system prompt 中的记忆摘要不足以判断时调用。',
  input_schema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string' as const,
        description: 'memory id，例如 usr_a1b2c3d4',
      },
    },
    required: ['id'] as string[],
  },
}
