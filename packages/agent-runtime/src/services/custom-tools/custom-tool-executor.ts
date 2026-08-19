/**
 * 执行器接口（方案 §5.1）：test-run 与桥内 call_tool 走同一执行入口
 */

import type { CustomToolRecord } from '@spark/protocol'
import { CustomToolError } from './custom-tool-errors.js'
import { executeHttpTool } from './http-executor.js'

export interface ExecutorContext {
  signal: AbortSignal
  resolveSecret: (name: string) => Promise<string>
  sessionId?: string
}

export interface ExecutorResult {
  /** markdown 文本，已截断 */
  text: string
  meta: { durationMs: number; bytes: number; truncated: boolean }
}

export async function executeCustomTool(
  record: CustomToolRecord,
  input: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  if (record.type === 'http') {
    return executeHttpTool(record, input, ctx)
  }
  // sql/command 为 M2、prompt 为 M3；协议层已定义契约，执行器按期落地
  throw new CustomToolError(
    'NOT_IMPLEMENTED',
    `「${record.type}」类型工具的执行器尚未启用（当前版本仅支持 http）`,
  )
}
