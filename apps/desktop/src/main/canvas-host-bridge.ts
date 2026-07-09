/**
 * 主进程画布 Agent 桥（Phase 2）
 *
 * 维护 sessionId → webContents 的绑定（由渲染端 canvas:host-attach 调用建立），
 * 把 SDK 触发的工具调用以 stream:canvas:tool-call 事件转发到对应渲染端窗口，
 * 渲染端用 canvas:tool-result 回报，主进程 resolve 对应的 pending Promise。
 *
 * 同时也是 SessionService 使用的 CanvasMcpProvider 实现：当 session 被 attach 时
 * 才返回非空，让 spark_canvas MCP server 上线；未 attach 则透明跳过，避免给
 * 普通 session 暴露画布工具。
 */
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  createCanvasMcpServer,
  canvasAllowedToolNames as toolNamesHelper,
  type CanvasToolCallBridge,
  type CanvasToolSchema,
  type CanvasMcpProvider,
} from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'

const log = createLogger('canvas-host-bridge')

interface Attachment {
  webContents: WebContents
  projectId: string
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

const TOOL_CALL_TIMEOUT_MS = 60_000

export class CanvasHostBridge implements CanvasToolCallBridge {
  /** sessionId → 渲染端窗口 + 画布项目 id */
  private attachments = new Map<string, Attachment>()
  /** requestId → 待 resolve 的 promise（工具调用回包等待） */
  private pendingCalls = new Map<string, PendingCall>()
  /** 画布工具 schema 集（由渲染端透传）。所有画布 session 共享同一份 schema。 */
  private toolSchemas: ReadonlyArray<CanvasToolSchema> = []

  /** 设置工具 schema 列表（一次性，渲染端启动时同步） */
  setToolSchemas(schemas: ReadonlyArray<CanvasToolSchema>): void {
    this.toolSchemas = schemas
    log.info(`canvas tools registered: ${schemas.length}`)
  }

  /** 渲染端 attach 一个画布 session（来自 canvas:host-attach IPC） */
  attach(sessionId: string, webContents: WebContents, projectId: string): void {
    // 之前 attach 过同 sessionId 则覆盖（弹窗重开场景）
    this.attachments.set(sessionId, { webContents, projectId })
    log.info(`session ${sessionId} attached to canvas project ${projectId}`)

    // 渲染端窗口关闭时自动 detach，避免残留映射
    const cleanup = () => this.detach(sessionId)
    webContents.once('destroyed', cleanup)
  }

  detach(sessionId: string): void {
    if (this.attachments.delete(sessionId)) {
      log.info(`session ${sessionId} detached from canvas`)
    }
  }

  isAttached(sessionId: string): boolean {
    return this.attachments.has(sessionId)
  }

  /** SDK 工具回调 → 通过 IPC 转发到渲染端等待结果 */
  async callTool(sessionId: string, toolName: string, args: unknown): Promise<unknown> {
    const attachment = this.attachments.get(sessionId)
    if (attachment == null) {
      log.warn(
        `canvas tool call refused (no attachment): sessionId=${sessionId} tool=${toolName}`,
      )
      throw new Error(
        `画布 session ${sessionId} 已 detach 或从未 attach，无法执行工具 ${toolName}`,
      )
    }
    if (attachment.webContents.isDestroyed()) {
      this.attachments.delete(sessionId)
      log.warn(
        `canvas tool call refused (window destroyed): sessionId=${sessionId} tool=${toolName}`,
      )
      throw new Error(`画布窗口已关闭，无法执行工具 ${toolName}`)
    }

    const requestId = randomUUID()
    log.info(
      `canvas tool call dispatch: sessionId=${sessionId} projectId=${attachment.projectId} tool=${toolName} requestId=${requestId}`,
    )
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCalls.delete(requestId)) {
          log.warn(
            `canvas tool call timeout: sessionId=${sessionId} tool=${toolName} requestId=${requestId} timeoutMs=${TOOL_CALL_TIMEOUT_MS}`,
          )
          reject(new Error(`画布工具 ${toolName} 超时未响应（${TOOL_CALL_TIMEOUT_MS}ms）`))
        }
      }, TOOL_CALL_TIMEOUT_MS)
      this.pendingCalls.set(requestId, { resolve, reject, timer })
    })

    attachment.webContents.send('stream:canvas:tool-call', {
      requestId,
      sessionId,
      toolName,
      args,
    })

    return promise
  }

  /** 渲染端通过 canvas:tool-result IPC 回报结果 */
  handleToolResult(payload: {
    requestId: string
    ok: boolean
    result?: unknown
    error?: string
  }): void {
    const pending = this.pendingCalls.get(payload.requestId)
    if (pending == null) {
      log.warn(`canvas tool result ignored (no pending call): requestId=${payload.requestId}`)
      return
    }
    this.pendingCalls.delete(payload.requestId)
    clearTimeout(pending.timer)
    if (payload.ok) {
      log.info(`canvas tool call ok: requestId=${payload.requestId}`)
      pending.resolve(payload.result)
    } else {
      log.warn(
        `canvas tool call failed: requestId=${payload.requestId} error=${payload.error ?? '(none)'}`,
      )
      pending.reject(new Error(payload.error ?? '画布工具执行失败'))
    }
  }

  /** 给 SessionService 用的 provider：当 session 已 attach 时返回 MCP server 配置 */
  asMcpProvider(): CanvasMcpProvider {
    return async (sessionId: string) => {
      if (!this.isAttached(sessionId)) return null
      if (this.toolSchemas.length === 0) {
        log.warn(`canvas attached but no tool schemas registered; sessionId=${sessionId}`)
        return null
      }
      const server = await createCanvasMcpServer({
        sessionId,
        bridge: this,
        toolSchemas: this.toolSchemas,
      })
      if (server == null) {
        log.warn('createCanvasMcpServer returned null (SDK unavailable)')
      }
      return {
        ...(server != null ? { server } : {}),
        allowedTools: toolNamesHelper(this.toolSchemas),
        toolSchemas: this.toolSchemas,
        callTool: (sid: string, toolName: string, args: unknown) =>
          this.callTool(sid, toolName, args),
      }
    }
  }
}

/** 全局单例（每个主进程一个） */
let _bridge: CanvasHostBridge | null = null
export function getCanvasHostBridge(): CanvasHostBridge {
  if (_bridge == null) _bridge = new CanvasHostBridge()
  return _bridge
}
