/**
 * 非 process 运行时执行器（方案 V3 §5）
 *
 * - remote-http：把一条 schema 合法的 `invoke` 协议帧 POST 给远端工具包服务，
 *   响应必须是同一协议的 result/error 子帧且 requestId/invocationId 回显一致。
 *   远端本身就是「一个工具包服务」，与旧版 HTTP 自定义工具的 REST 适配定位不同。
 * - mcp-import：manifest 工具名经 runtime.toolNameOverrides 映射到 MCP 服务器
 *   真实工具名（缺省同名），输入按 manifest.inputSchema 先行校验后代理调用；
 *   结果保持 MCP content 结构，isError 抛错。
 */

import { randomUUID } from 'node:crypto'
import type { ToolPackageManifest } from '@spark/protocol'
import { TOOL_PROCESS_PROTOCOL_VERSION, ToolProcessChildFrameSchema } from '@spark/protocol'
import { fetch as undiciFetch } from 'undici'
import { z } from 'zod'
import type { McpToolResult } from '../../mcp/index.js'

const DEFAULT_REMOTE_INVOKE_TIMEOUT_MS = 120_000
const MAX_REMOTE_RESPONSE_BYTES = 4 * 1024 * 1024
const PLACEHOLDER_PATTERN = /\$\{([A-Z_][A-Z0-9_]{0,127})\}/g

/** 与 McpService.callTool 同形，服务层注入实现，测试注入 fake。 */
export interface McpToolInvoker {
  callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult>
}

export interface RemoteHttpInvokeRequest {
  manifest: ToolPackageManifest
  toolName: string
  input: unknown
  /** 已解析环境（含 Keychain 密钥），用于渲染 header 模板。 */
  environment: Record<string, string>
  /** 调用级超时覆盖；缺省用 manifest runtime.timeoutMs 或默认值。 */
  timeoutMs?: number
}

export interface McpImportInvokeRequest {
  manifest: ToolPackageManifest
  toolName: string
  input: unknown
  invoker: McpToolInvoker
}

/** manifest 级工具查找 + 输入校验，process/remote/mcp-import 三个适配器共用语义。 */
function findToolAndValidateInput(
  manifest: ToolPackageManifest,
  toolName: string,
  input: unknown,
): Record<string, unknown> {
  const tool = manifest.tools.find((candidate) => candidate.name === toolName)
  if (tool == null) throw new Error(`Tool package does not define tool: ${toolName}`)
  const parsed = z.fromJSONSchema(tool.inputSchema).safeParse(input)
  if (!parsed.success) {
    throw new Error(`Invalid Tool Package input for ${toolName}: ${z.prettifyError(parsed.error)}`)
  }
  if (parsed.data == null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error(`Invalid Tool Package input for ${toolName}: expected an object`)
  }
  return parsed.data as Record<string, unknown>
}

function renderHeaderTemplates(
  value: string,
  headerName: string,
  environment: Record<string, string>,
): string {
  return value.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const resolved = environment[name]
    if (resolved == null || resolved.length === 0) {
      throw new Error(
        `Remote tool package header ${headerName} references unconfigured environment variable ${name}`,
      )
    }
    return resolved
  })
}

/** 只保留 protocol//host/path 骨架用于错误信息，查询参数不落错误文本。 */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return '<invalid-url>'
  }
}

async function readBodyWithCap(
  response: Response,
  capBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (reader == null) {
    const text = await response.text()
    if (text.length <= capBytes) return { text, truncated: false }
    return { text: text.slice(0, capBytes), truncated: true }
  }
  const decoder = new TextDecoder()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value == null) continue
      total += value.byteLength
      if (total > capBytes) {
        const overshoot = total - capBytes
        chunks.push(value.slice(0, value.byteLength - overshoot))
        truncated = true
        await reader.cancel('remote tool package response size limit reached')
        break
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(Math.min(total, capBytes))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: decoder.decode(merged, { stream: false }) + decoder.decode(), truncated }
}

export async function invokeRemoteHttpTool(request: RemoteHttpInvokeRequest): Promise<unknown> {
  const runtime = request.manifest.runtime
  if (runtime.adapter !== 'remote-http') {
    throw new Error(`Remote HTTP executor cannot execute ${runtime.adapter} adapter`)
  }
  const input = findToolAndValidateInput(request.manifest, request.toolName, request.input)

  const requestId = randomUUID()
  const invocationId = randomUUID()
  const frame = {
    type: 'invoke',
    protocolVersion: TOOL_PROCESS_PROTOCOL_VERSION,
    requestId,
    sequence: 0,
    invocationId,
    toolName: request.toolName,
    input,
    context: {},
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  for (const [name, template] of Object.entries(runtime.headers ?? {})) {
    headers[name] = renderHeaderTemplates(template, name, request.environment)
  }

  const timeoutMs = request.timeoutMs ?? runtime.timeoutMs ?? DEFAULT_REMOTE_INVOKE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)

  try {
    const response = await undiciFetch(runtime.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(frame),
      signal: controller.signal,
    })
    const { text, truncated } = await readBodyWithCap(response, MAX_REMOTE_RESPONSE_BYTES)

    if (!response.ok) {
      throw new Error(
        `Remote tool package HTTP ${String(response.status)} ${response.statusText}` +
          (text.trim() !== '' ? `: ${text.slice(0, 500)}` : ''),
      )
    }

    let parsedFrame: unknown
    try {
      parsedFrame = JSON.parse(text) as unknown
    } catch {
      throw new Error(
        `Remote tool package response is not valid JSON: ${redactUrl(runtime.baseUrl)}`,
      )
    }
    const frameResult = ToolProcessChildFrameSchema.safeParse(parsedFrame)
    if (!frameResult.success) {
      throw new Error(
        `Remote tool package response is not a ${TOOL_PROCESS_PROTOCOL_VERSION} frame: ${redactUrl(runtime.baseUrl)}`,
      )
    }
    const childFrame = frameResult.data
    if (childFrame.type !== 'result' && childFrame.type !== 'error') {
      throw new Error(
        `Remote tool package responded with unexpected frame type "${childFrame.type}" (expected result/error)`,
      )
    }
    if (childFrame.requestId !== requestId) {
      throw new Error('Remote tool package response requestId does not match its request')
    }
    if (childFrame.type === 'result') {
      if (childFrame.invocationId !== invocationId) {
        throw new Error('Remote tool package response invocationId does not match its request')
      }
      if (truncated) {
        // 4 MB 截断后 result JSON 可能已残缺，不能把半截结构当合法结果交给模型。
        throw new Error(
          'Remote tool package response exceeded the 4 MB protocol frame limit and was truncated',
        )
      }
      return childFrame.result
    }
    throw new Error(`${childFrame.code}: ${childFrame.message}`)
  } catch (error) {
    // undici 在连接阶段被 abort 时抛出的是 reason 字符串而非 Error，不能依赖 instanceof。
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      throw new Error(
        `Remote tool package request timed out after ${String(timeoutMs)}ms: ${redactUrl(runtime.baseUrl)}`,
        { cause: error },
      )
    }
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 响应体在 4 MB 上限处被截断时，result JSON 结构可能已残缺——invokeRemoteHttpTool
 * 直接抛错而不是把半截 JSON 当作合法结果交给模型。
 */

export async function invokeMcpImportTool(request: McpImportInvokeRequest): Promise<unknown> {
  const runtime = request.manifest.runtime
  if (runtime.adapter !== 'mcp-import') {
    throw new Error(`MCP import executor cannot execute ${runtime.adapter} adapter`)
  }
  const input = findToolAndValidateInput(request.manifest, request.toolName, request.input)
  const mcpToolName = runtime.toolNameOverrides?.[request.toolName] ?? request.toolName
  const result = await request.invoker.callTool(runtime.serverId, mcpToolName, input)
  if (result.isError === true) {
    const message = result.content
      .map((item) => (item.type === 'text' && item.text != null ? item.text : ''))
      .filter((text) => text.length > 0)
      .join('\n')
    throw new Error(
      message.trim() !== ''
        ? `MCP tool ${mcpToolName} failed: ${message}`
        : `MCP tool ${mcpToolName} failed`,
    )
  }
  // 保留 MCP content 结构（text/image/resource），由目录层的结果限额统一约束大小。
  return { content: result.content }
}
