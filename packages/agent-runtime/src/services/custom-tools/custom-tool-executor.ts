/**
 * 执行器接口（方案 §5.1）：test-run 与桥内 call_tool 走同一执行入口
 */

import type { CustomToolRecord } from '@spark/protocol'
import { CustomToolError } from './custom-tool-errors.js'
import { executeHttpTool } from './http-executor.js'
import { executeProviderVisionTool } from './provider-vision-executor.js'
import { executeCodeTool } from './code-tool-executor.js'
import type { SparkDatabase } from '@spark/storage'

export interface ExecutorContext {
  signal: AbortSignal
  resolveSecret: (name: string) => Promise<string>
  sessionId?: string
  database?: SparkDatabase
  /** Native capability broker used by code tools for explicitly allow-listed composition. */
  invokeTool?: (toolId: string, input: Record<string, unknown>) => Promise<unknown>
}

export interface ExecutorResult {
  /** markdown 文本，已截断 */
  text: string
  meta: {
    durationMs: number
    bytes: number
    truncated: boolean
    targetOrigin?: string
    model?: string
  }
  /** 本地调用记录 ID；Trace 写入失败时缺省且不阻断工具结果。 */
  traceId?: number
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
  if (record.type === 'code') {
    return executeCodeTool(record, input, ctx)
  }
  // sql/command/prompt remain separate adapters; code tools already provide
  // native composition without turning every user tool into an MCP project.
  throw new CustomToolError(
    'NOT_IMPLEMENTED',
    `「${record.type}」类型工具的执行器尚未启用（当前版本仅支持 http）`,
  )
}
