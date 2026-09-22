/**
 * @module in-process-tool-result-governance
 *
 * M4 in-process MCP 工具结果治理（方案 §4.4「in-process MCP 治理空洞」）：
 * 团队工具（agent_dispatch / workflow_run 等，in-process 与 HTTP 桥两形态）和
 * `type:'sdk'` MCP server 的工具结果不经 stdio 治理代理
 * （tool-result-mcp-governance.ts 的 shouldWrapStdioServer 显式排除 sdk 类型），
 * 超大结果会全量进入宿主 LLM 上下文——正是事故根因 #6。
 *
 * 本模块把既有 stdio 治理设施（tool-result-artifact-store 的 envelope 化 +
 * 内容寻址 artifact + spark_tool_results 读回链）以可配阈值
 * （toolResult.inProcessMaxChars，默认 32768，方案 §六「工具结果」组）复用到
 * 这些路径：超限即 envelope 化，未超限原样返回（逐字节不变）。
 */

import {
  governMcpToolResult,
  type ToolResultEnvelope,
} from '../tools/tool-result-artifact-store.mjs'
import type { TeamToolDefinition } from './team-mcp-http-bridge.js'

/** 与 MCP tool result 对齐的 in-process handler 返回结构。 */
export interface InProcessToolResultLike {
  content?: unknown
  structuredContent?: unknown
  isError?: boolean
  [key: string]: unknown
}

export interface InProcessToolResultGovernanceConfig {
  inProcessMaxChars: number
}

export const DEFAULT_IN_PROCESS_TOOL_RESULT_GOVERNANCE: InProcessToolResultGovernanceConfig = {
  inProcessMaxChars: 32_768,
}

/** 方案 §六「工具结果」组：toolResult.inProcessMaxChars 范围 4096–262144。 */
export const IN_PROCESS_TOOL_RESULT_RANGES = { min: 4_096, max: 262_144 } as const

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** 把任意输入（settings JSON 局部）归一为合法配置；缺省回落默认值。 */
export function normalizeInProcessToolResultGovernance(
  raw: unknown,
): InProcessToolResultGovernanceConfig {
  const source =
    raw != null && typeof raw === 'object'
      ? (raw as { inProcessMaxChars?: unknown; toolResult?: { inProcessMaxChars?: unknown } })
      : {}
  const nested =
    source.toolResult != null && typeof source.toolResult === 'object'
      ? (source.toolResult as { inProcessMaxChars?: unknown })
      : {}
  return {
    inProcessMaxChars: clampInt(
      source.inProcessMaxChars ?? nested.inProcessMaxChars,
      IN_PROCESS_TOOL_RESULT_RANGES.min,
      IN_PROCESS_TOOL_RESULT_RANGES.max,
      DEFAULT_IN_PROCESS_TOOL_RESULT_GOVERNANCE.inProcessMaxChars,
    ),
  }
}

export interface GovernInProcessToolResultOptions {
  workspaceRootPath: string
  /** envelope 元数据与 error-focused preview 策略用（如 mcp__spark_memory__recall_memory）。 */
  toolName?: string
  toolCallId?: string
  maxChars: number
}

/**
 * 治理单个 in-process 工具结果：序列化长度不超过 maxChars 时原样返回
 * （同一引用，逐字节不变）；超限时 envelope 化（完整内容写内容寻址 artifact，
 * 返回 preview + artifactId + continuation 指引，可经 spark_tool_results 读回）。
 */
export function governInProcessToolResult<T extends InProcessToolResultLike>(
  result: T,
  options: GovernInProcessToolResultOptions,
): T {
  return governMcpToolResult(result as unknown as Record<string, unknown>, {
    workspaceRoot: options.workspaceRootPath,
    ...(options.toolName != null ? { toolName: options.toolName } : {}),
    ...(options.toolCallId != null ? { toolCallId: options.toolCallId } : {}),
    inlineCharLimit: options.maxChars,
  }) as T
}

/** 结果是否已被治理为 envelope（供调用方/测试判断形态）。 */
export function isInProcessToolResultEnvelope(
  result: InProcessToolResultLike,
): result is InProcessToolResultLike & { structuredContent: ToolResultEnvelope } {
  const structured = result.structuredContent
  return (
    structured != null &&
    typeof structured === 'object' &&
    (structured as Record<string, unknown>).kind === 'spark.tool_result_envelope'
  )
}

export interface WrapTeamToolDefinitionsOptions {
  workspaceRootPath: string
  maxChars: number
}

/**
 * 给团队工具定义（agent_dispatch / workflow_run 等）统一包一层结果治理：
 * in-process SDK server 与 HTTP 桥接（codex 消费者）共用同一份 defs，包装在
 * defs 层即同时覆盖两种消费形态。schema / name / description 原样透传。
 */
export function wrapTeamToolDefinitionsWithGovernance(
  defs: readonly TeamToolDefinition[],
  options: WrapTeamToolDefinitionsOptions,
): TeamToolDefinition[] {
  if (defs.length === 0) return []
  const maxChars = options.maxChars
  const workspaceRootPath = options.workspaceRootPath
  return defs.map((def) => ({
    ...def,
    handler: async (args: Record<string, unknown>) => {
      const result = await def.handler(args)
      return governInProcessToolResult(result, {
        workspaceRootPath,
        toolName: def.name,
        maxChars,
      })
    },
  }))
}
