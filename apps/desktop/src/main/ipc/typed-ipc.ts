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
import { broadcastToAppWindows } from '../windows/index.js'
import { ipcPerformanceTracker } from './ipc-performance.js'

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

  ipcMain.handle(
    channel,
    async (event, rawRequest: unknown): Promise<IpcResult<IpcResponse<C>>> => {
      const startedAt = performance.now()
      let outcome: 'ok' | 'error' = 'error'
      log.debug(`← ${channel}`)

      try {
        // 1. Schema 校验（如果 channel 在注册表中有对应的 schema）
        const schema = IpcSchemaRegistry[channel as keyof typeof IpcSchemaRegistry]
        const validatedRequest = schema != null ? schema.parse(rawRequest) : rawRequest

        // 2. 调用业务 handler
        const response = await handler(validatedRequest as IpcRequest<C>, event)

        outcome = 'ok'
        log.debug(`→ ${channel}: ok`)
        return { ok: true, data: response }
      } catch (err: unknown) {
        const errorResponse = handleIpcError(channel, err)
        log.warn(`→ ${channel}: error [${errorResponse.error.code}]`)
        return { ok: false, error: errorResponse.error }
      } finally {
        const measurement = ipcPerformanceTracker.record(
          channel,
          performance.now() - startedAt,
          outcome,
        )
        if (measurement.slow) {
          log.warn('Slow interaction IPC', {
            channel,
            durationMs: measurement.durationMs,
            budgetMs: measurement.budgetMs,
            outcome,
          })
        }
        if (measurement.report != null) {
          log.info('IPC rolling performance summary', { channels: measurement.report })
        }
      }
    },
  )

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
        message: '操作未完成，请稍后重试或查看详情。',
      },
    }
  }

  // 完全未知的错误
  log.error(`Unknown error in ${channel}: ${String(err)}`)
  return {
    error: {
      code: 'UNKNOWN',
      message: '操作未完成，请稍后重试或查看详情。',
    },
  }
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
  broadcastToAppWindows(channel, payload)
}
