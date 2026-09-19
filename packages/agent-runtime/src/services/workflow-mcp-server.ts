/**
 * 工作流 Agent in-process MCP server 工厂（E2-1）
 *
 * 对称复刻 canvas-mcp-server.ts：结构对称、JSON Schema→Zod 转换器直接复用画布导出件，
 * 待两处实现稳定后再向上游提统一抽象 issue（Rule of Three）。SessionService 在
 * sendTurn 时，如果 session 已经被工作流编辑器 Agent 面板"attach"过，就调用这里的
 * createWorkflowMcpServer 构造一个 in-process MCP server，注册名为 spark_workflow，
 * 工具列表由渲染端 workflow.tools.ts 透传过来。
 *
 * 工具调用流程（与 spark_canvas 一致）：
 *   SDK → mcp__spark_workflow__<toolName>(args)
 *     → bridge.callTool(sessionId, toolName, args)
 *       → 主进程 webContents.send('stream:workflow:tool-call', { requestId, sessionId, toolName, args })
 *         → 渲染端 executeWorkflowTool(ctx, toolName, args)
 *           → ipcRenderer.invoke('workflow:tool-result', { requestId, ok, result })
 *             → 主进程 resolve pending request
 *       ← Promise resolves with result
 *     ← tool 返回 { content, structuredContent }
 *   ← SDK 拿到结果继续推理
 */
import { z } from 'zod'
import { loadSdkMcpFactory } from '../sdk/claude-sdk-executor.js'
import type { SDKMcpServerConfig } from '../sdk/types.js'
import {
  canvasJsonSchemaToZodShape,
  type CanvasToolSchema,
  type CanvasToolCallBridge,
} from './canvas-mcp-server.js'

/** 工作流工具 schema：与画布工具 schema 同构（对称复刻期直接别名复用，避免结构漂移） */
export type WorkflowToolSchema = CanvasToolSchema
/** 跨进程工具调用桥：与画布桥接口同构 */
export type WorkflowToolCallBridge = CanvasToolCallBridge

/**
 * Shape 缓存：同 canvas-mcp-server 的 getOrComputeShape——jsonSchemaToShape 是纯函数，
 * 同一 inputSchema 的转换结果在会话内几乎不变，缓存可避免每个 turn 重复构造 Zod schema。
 *
 * key = schema JSON 的稳定序列化串；value = 转换后的 shape map。
 */
const shapeCache = new Map<string, Record<string, z.ZodTypeAny>>()
const SHAPE_CACHE_MAX = 64

function getOrComputeShape(inputSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  // 用 JSON 序列化做稳定 key；schema 来自 workflow.tools.ts 静态定义，内容稳定
  let key: string
  try {
    key = JSON.stringify(inputSchema)
  } catch {
    // 含不可序列化内容时回退为每次计算（极罕见）
    return canvasJsonSchemaToZodShape(inputSchema)
  }
  const hit = shapeCache.get(key)
  if (hit != null) return hit
  const shape = canvasJsonSchemaToZodShape(inputSchema)
  if (shapeCache.size >= SHAPE_CACHE_MAX) {
    // LRU 粗略淘汰：删最早的 key
    const firstKey = shapeCache.keys().next().value
    if (firstKey != null) shapeCache.delete(firstKey)
  }
  shapeCache.set(key, shape)
  return shape
}

export interface CreateWorkflowMcpServerOptions {
  sessionId: string
  bridge: WorkflowToolCallBridge
  toolSchemas: ReadonlyArray<WorkflowToolSchema>
}

/**
 * 构造 spark_workflow in-process MCP server。SDK 不可用时返回 null。
 *
 * 性能优化同 canvas：Zod shape 转换结果被 getOrComputeShape 缓存，
 * 同一组 toolSchemas 在后续 turn 中不再重复做 schema 转换。
 */
export async function createWorkflowMcpServer(
  opts: CreateWorkflowMcpServerOptions,
): Promise<SDKMcpServerConfig | null> {
  const factory = await loadSdkMcpFactory()
  if (factory == null) return null
  const { createSdkMcpServer, tool } = factory

  const tools = opts.toolSchemas.map((schema) => {
    const shape = getOrComputeShape(schema.inputSchema)
    return tool(
      schema.name,
      schema.description,
      shape as Record<string, unknown>,
      async (args: Record<string, unknown>) => {
        try {
          const rawResult = await opts.bridge.callTool(opts.sessionId, schema.name, args)
          const result = rawResult === undefined ? { ok: true } : rawResult
          const text =
            rawResult === undefined
              ? `工作流工具 ${schema.name} 执行完成。`
              : typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2)
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent: result as unknown,
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text' as const, text: `工作流工具调用失败: ${message}` }],
            isError: true,
          }
        }
      },
    )
  })

  return createSdkMcpServer({
    name: 'spark_workflow',
    version: '0.1.0',
    tools,
  }) as SDKMcpServerConfig
}

/** 把工具 schema 名映射成 SDK allowedTools 里的全名（mcp__spark_workflow__<name>） */
export function workflowAllowedToolNames(toolSchemas: ReadonlyArray<WorkflowToolSchema>): string[] {
  return toolSchemas.map((s) => `mcp__spark_workflow__${s.name}`)
}
