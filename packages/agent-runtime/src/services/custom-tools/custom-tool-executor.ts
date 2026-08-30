/**
 * 执行器接口（方案 §5.1）：test-run 与桥内 call_tool 走同一执行入口
 */

import type { CustomToolRecord } from '@spark/protocol'
import { CustomToolError } from './custom-tool-errors.js'
import { executeHttpTool } from './http-executor.js'
import { executeProviderVisionTool } from './provider-vision-executor.js'
import type { SparkDatabase } from '@spark/storage'

export interface ExecutorContext {
  signal: AbortSignal
  resolveSecret: (name: string) => Promise<string>
  sessionId?: string
  database?: SparkDatabase
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
  if (record.type === 'provider-vision') {
    if (ctx.database == null) {
      throw new CustomToolError('EXECUTION_FAILED', '图像理解工具缺少 Provider 运行时上下文')
    }
    return executeProviderVisionTool(record, input, { ...ctx, database: ctx.database })
  }
  // sql/command 为 M2、prompt 为 M3；协议层已定义契约，执行器按期落地
  throw new CustomToolError(
    'NOT_IMPLEMENTED',
    `「${record.type}」类型工具的执行器尚未启用（当前版本仅支持 http）`,
  )
}
