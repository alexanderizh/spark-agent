/**
 * @module typed-ipc
 *
 * 类型安全的 IPC Handler 封装
 *
 * 核心功能：
 *   1. 基于 @spark/protocol 的 IpcChannelMap 实现类型安全的 invoke/handle
 *   2. 使用 IpcSchemaRegistry 中的 zod schema 自动校验 request payload
 *   3. 统一的错误处理：SparkError → 安全的错误响应
 *
 * 使用方式：
 *   // 主进程注册 handler
 *   typedIpcHandle('session:create', async (req) => {
 *     // req 的类型自动推断为 SessionCreateRequest
 *     return { sessionId: '...', createdAt: '...' }  // 返回类型自动推断为 SessionCreateResponse
 *   })
 *
 *   // 渲染进程调用（通过 preload 暴露的 window.spark.invoke）
 *   const res = await window.spark.invoke('session:create', { providerProfileId: 'xxx' })
 *   // res 的类型自动推断为 SessionCreateResponse
 */

import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IpcSchemaRegistry } from '@spark/protocol'
import type { IpcChannel, IpcRequest, IpcResponse } from '@spark/protocol'
import { isSparkError } from '@spark/shared'
import { ZodError } from 'zod'
import { createLogger } from '@spark/shared'
import { sendToMainWindow } from '../windows/index.js'

const log = createLogger('ipc')

/**
 * IPC 调用结果的统一格式
 *
 * 成功时：{ ok: true, data: Response }
 * 失败时：{ ok: false, error: { code, message } }
 *
 * 这样设计的好处：
 *   - Renderer 可以统一处理成功和失败
 *   - 错误信息经过脱敏处理，不暴露内部细节
 *   - 避免 ipcRenderer.invoke 直接 throw 序列化问题
 */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

/**
 * 类型安全的 IPC Handler 注册
 *
 * @param channel - IpcChannelMap 中定义的 channel 名称
 * @param handler - 异步处理函数，接收校验后的 request，返回 response
 *
 * 自动处理：
 *   - Request payload 的 zod schema 校验
 *   - 错误的统一捕获和安全响应
 *   - 日志记录（请求/响应/错误）
 */
export function typedIpcHandle<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>, event: IpcMainInvokeEvent) => Promise<IpcResponse<C>>,
): void {
  // 开发态热重载会重复注册同一 channel；先移除旧 handler，避免新 channel 无法挂上。
  if (ipcMain.removeHandler != null) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle(channel, async (event, rawRequest: unknown): Promise<IpcResult<IpcResponse<C>>> => {
    log.debug(`← ${channel}`, maskSensitiveData(rawRequest))

    try {
      // 1. Schema 校验（如果 channel 在注册表中有对应的 schema）
      const schema = IpcSchemaRegistry[channel as keyof typeof IpcSchemaRegistry]
      const validatedRequest = schema != null ? schema.parse(rawRequest) : rawRequest

      // 2. 调用业务 handler
      const response = await handler(validatedRequest as IpcRequest<C>, event)

      log.debug(`→ ${channel}: ok`)
      return { ok: true, data: response }
    } catch (err: unknown) {
      const errorResponse = handleIpcError(channel, err)
      log.warn(`→ ${channel}: error [${errorResponse.error.code}]`)
      return { ok: false, error: errorResponse.error }
    }
  })

  log.info(`Registered IPC handler: ${channel}`)
}

/**
 * 统一的 IPC 错误处理
 *
 * 将不同类型的错误转换为安全的、面向用户的错误响应
 */
function handleIpcError(
  channel: string,
  err: unknown,
): { error: { code: string; message: string } } {
  if (isSparkError(err)) {
    // SparkError：已知业务错误，直接使用
    return {
      error: {
        code: err.code,
        message: err.message,
      },
    }
  }

  if (err instanceof ZodError) {
    // Zod 校验错误：payload 不符合 schema
    log.error(`Validation failed for ${channel}: ${err.message}`)
    return {
      error: {
        code: 'IPC_INVALID_PAYLOAD',
        message: `Request validation failed: ${err.issues.map((i) => i.message).join(', ')}`,
      },
    }
  }

  if (err instanceof Error) {
    // 未知错误：不暴露内部细节给渲染进程
    log.error(`Unhandled error in ${channel}: ${err.message}`)
    return {
      error: {
        code: 'UNKNOWN',
        message: 'An internal error occurred',
      },
    }
  }

  // 完全未知的错误
  log.error(`Unknown error in ${channel}: ${String(err)}`)
  return {
    error: {
      code: 'UNKNOWN',
      message: 'An unknown error occurred',
    },
  }
}

/**
 * 脱敏处理请求数据中的敏感/超长字段。
 *
 *   - apiKey：截断掩码，只保留前 4 位（避免日志泄露密钥）
 *   - dataUrl / previewDataUrl / thumbnailUrl / base64 等 base64 字段、以及任何
 *     `data:` 开头的字符串：只保留前 50 个字符。画布里图片/语音常以 base64 透传，
 *     一张图就能产出几万字符的 dataUrl，整段打印会淹没日志、拖慢排查。
 *
 * 递归处理嵌套对象与数组，返回新对象（不改入参）；用 WeakSet 防循环引用。
 */
const SENSITIVE_TRUNCATABLE_KEYS = new Set([
  'dataUrl',
  'previewDataUrl',
  'thumbnailUrl',
  'base64',
  'b64Json',
  'b64_json',
  'content',
])
const LOG_TRUNCATE_MAX = 50

function truncateForLog(value: string): string {
  if (value.length <= LOG_TRUNCATE_MAX) return value
  return `${value.slice(0, LOG_TRUNCATE_MAX)}…<truncated, len=${value.length}>`
}

function maskSensitiveData(data: unknown): unknown {
  return sanitizeForLog(data)
}

function sanitizeForLog(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    // 形如 data:image/png;base64,xxxx 的 data URL 整体截断
    return value.startsWith('data:') ? truncateForLog(value) : value
  }
  if (typeof value !== 'object') return value
  // 防循环引用
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, seen))
  }

  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'apiKey' && typeof val === 'string') {
      out[key] = val.length > 0 ? `${val.slice(0, 4)}****` : val
    } else if (typeof val === 'string' && (SENSITIVE_TRUNCATABLE_KEYS.has(key) || val.startsWith('data:'))) {
      out[key] = truncateForLog(val)
    } else {
      out[key] = sanitizeForLog(val, seen)
    }
  }
  return out
}

// ─── 流式事件推送 ───────────────────────────────────────────────────────

/**
 * 向渲染进程推送流式事件
 *
 * @param channel - IpcStreamChannel 中定义的 stream channel
 * @param payload - 对应 channel 的 payload
 *
 * 使用方式：
 *   pushStreamEvent('stream:session:agent-event', agentEvent)
 */
export function pushStreamEvent(channel: string, payload: unknown): void {
  sendToMainWindow(channel, payload)
}
