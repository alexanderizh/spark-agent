/**
 * 画布 Agent in-process MCP server 工厂（Phase 2）
 *
 * SessionService 在 sendTurn 时，如果 session 已经被画布弹窗"attach"过，
 * 就调用这里的 createCanvasMcpServer 构造一个 in-process MCP server，
 * 注册名为 spark_canvas，工具列表由渲染端 canvas.tools.ts 透传过来。
 *
 * 工具调用流程：
 *   SDK → mcp__spark_canvas__<toolName>(args)
 *     → bridge.callTool(sessionId, toolName, args)
 *       → 主进程 webContents.send('stream:canvas:tool-call', { requestId, sessionId, toolName, args })
 *         → 渲染端 executeCanvasTool(ctx, toolName, args)
 *           → ipcRenderer.invoke('canvas:tool-result', { requestId, ok, result })
 *             → 主进程 resolve pending request
 *       ← Promise resolves with result
 *     ← tool 返回 { content, structuredContent }
 *   ← SDK 拿到结果继续推理
 */
import { z } from 'zod'
import { loadSdkMcpFactory } from '../sdk/claude-sdk-executor.js'
import type { SDKMcpServerConfig } from '../sdk/types.js'

/** 渲染端注册的工具 schema（JSON Schema 7 子集） */
export interface CanvasToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** 跨进程工具调用桥（由主进程实现） */
export interface CanvasToolCallBridge {
  /** 执行画布工具，返回渲染端的 JSON 结果 */
  callTool(sessionId: string, toolName: string, args: unknown): Promise<unknown>
}

/** 把简单 JSON Schema 节点转成 Zod 类型（仅支持 canvas.tools.ts 里用到的子集） */
function jsonPropToZod(prop: unknown): z.ZodTypeAny {
  if (prop == null || typeof prop !== 'object') return z.unknown()
  const p = prop as Record<string, unknown>

  if (Array.isArray(p.enum) && p.enum.every((v) => typeof v === 'string')) {
    const arr = p.enum as string[]
    if (arr.length === 0) return z.string()
    const result = z.enum([arr[0]!, ...arr.slice(1)] as [string, ...string[]])
    return typeof p.description === 'string' ? result.describe(p.description) : result
  }

  if (p.oneOf != null || p.anyOf != null) return z.unknown()

  const desc = typeof p.description === 'string' ? p.description : undefined
  const withDesc = <T extends z.ZodTypeAny>(s: T): z.ZodTypeAny => (desc ? s.describe(desc) : s)

  switch (p.type) {
    case 'string':
      return withDesc(z.string())
    case 'number':
    case 'integer':
      return withDesc(z.number())
    case 'boolean':
      return withDesc(z.boolean())
    case 'array': {
      const items = p.items != null ? jsonPropToZod(p.items) : z.unknown()
      return withDesc(z.array(items))
    }
    case 'object': {
      if (p.properties != null && typeof p.properties === 'object') {
        const props = p.properties as Record<string, unknown>
        const required = new Set(Array.isArray(p.required) ? (p.required as string[]) : [])
        const shape: Record<string, z.ZodTypeAny> = {}
        for (const [k, v] of Object.entries(props)) {
          let inner = jsonPropToZod(v)
          if (!required.has(k)) inner = inner.optional()
          shape[k] = inner
        }
        const obj = z.object(shape)
        return withDesc(p.additionalProperties != null ? obj.passthrough() : obj)
      }
      return withDesc(z.record(z.unknown()))
    }
    default:
      return z.unknown()
  }
}

/** 把顶层 JSON Schema (type=object) 转成 SDK tool() 需要的 shape map */
function jsonSchemaToShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  if (schema.type !== 'object' || schema.properties == null) return {}
  const props = schema.properties as Record<string, unknown>
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [k, v] of Object.entries(props)) {
    let inner = jsonPropToZod(v)
    if (!required.has(k)) inner = inner.optional()
    shape[k] = inner
  }
  return shape
}

export interface CreateCanvasMcpServerOptions {
  sessionId: string
  bridge: CanvasToolCallBridge
  toolSchemas: ReadonlyArray<CanvasToolSchema>
}

/**
 * Shape 缓存：jsonSchemaToShape 是纯函数，相同 inputSchema 产出相同 Zod shape。
 * 画布工具集在一次会话内几乎不变（除非 attach 时重新 setToolSchemas），
 * 因此缓存 shape 转换结果可避免每个 turn 重复构造 40 个工具的 Zod schema。
 *
 * key = schema JSON 的稳定序列化串；value = 转换后的 shape map。
 */
const shapeCache = new Map<string, Record<string, z.ZodTypeAny>>()
const SHAPE_CACHE_MAX = 64

function getOrComputeShape(inputSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  // 用 JSON 序列化做稳定 key；schema 来自 canvas.tools.ts 静态定义，内容稳定
  let key: string
  try {
    key = JSON.stringify(inputSchema)
  } catch {
    // 含不可序列化内容时回退为每次计算（极罕见）
    return jsonSchemaToShape(inputSchema)
  }
  const hit = shapeCache.get(key)
  if (hit != null) return hit
  const shape = jsonSchemaToShape(inputSchema)
  if (shapeCache.size >= SHAPE_CACHE_MAX) {
    // LRU 粗略淘汰：删最早的 key
    const firstKey = shapeCache.keys().next().value
    if (firstKey != null) shapeCache.delete(firstKey)
  }
  shapeCache.set(key, shape)
  return shape
}

/**
 * 构造 spark_canvas in-process MCP server。SDK 不可用时返回 null。
 *
 * 性能优化：工具的 Zod shape 转换结果会被 getOrComputeShape 缓存，
 * 因此同一组 toolSchemas 在后续 turn 中不再重复做 40 次 jsonSchemaToShape。
 * tool() 闭包仍需每次构造（绑定 sessionId），但那只是函数包装，成本远低于 Zod 解析。
 */
export async function createCanvasMcpServer(
  opts: CreateCanvasMcpServerOptions,
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
          const result = await opts.bridge.callTool(opts.sessionId, schema.name, args)
          const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent: result as unknown,
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text' as const, text: `画布工具调用失败: ${message}` }],
            isError: true,
          }
        }
      },
    )
  })

  return createSdkMcpServer({
    name: 'spark_canvas',
    version: '0.1.0',
    tools,
  }) as SDKMcpServerConfig
}

/** 把工具 schema 名映射成 SDK allowedTools 里的全名（mcp__spark_canvas__<name>） */
export function canvasAllowedToolNames(
  toolSchemas: ReadonlyArray<CanvasToolSchema>,
): string[] {
  return toolSchemas.map((s) => `mcp__spark_canvas__${s.name}`)
}
