/**
 * Terminal IPC 注册 — 把 terminal:* 通道接到 TerminalService。
 *
 * 由 registerAllIpcHandlers() 末尾调用一次。
 */
import { typedIpcHandle } from './typed-ipc.js'
import { getTerminalService } from '../services/TerminalService.js'
import type { TerminalSessionInfo } from '@spark/protocol'

/**
 * 把 TerminalSessionInfo 注入 stream:terminal:event 的 helper。
 * 由 TerminalService 内部调用 —— 这里只是把类型补全。
 */
export type TerminalEventPayload =
  | { type: 'created'; terminal: TerminalSessionInfo }
  | { type: 'data'; terminalId: string; sessionId: string; data: string }
  | {
      type: 'exit'
      terminalId: string
      sessionId: string
      exitCode?: number
      signal?: number
    }
  | { type: 'updated'; terminal: TerminalSessionInfo }
  | { type: 'removed'; terminalId: string; sessionId: string }
  | { type: 'error'; terminalId?: string; sessionId?: string; message: string }

export function registerTerminalIpc(): void {
  const svc = getTerminalService()

  typedIpcHandle('terminal:list', async (req) => ({
    terminals: svc.list(req.sessionId),
  }))

  typedIpcHandle('terminal:list-active', async () => ({
    sessions: svc.listActiveSessions(),
  }))

  typedIpcHandle('terminal:create', async (req) => svc.create(req))

  typedIpcHandle('terminal:input', async (req) => ({
    accepted: svc.input(req.terminalId, req.data),
  }))

  typedIpcHandle('terminal:resize', async (req) => ({
    resized: svc.resize(req.terminalId, req.cols, req.rows),
  }))

  typedIpcHandle('terminal:kill', async (req) => ({
    killed: svc.kill(req.terminalId),
  }))

  typedIpcHandle('terminal:rename', async (req) => {
    const terminal = svc.rename(req.terminalId, req.title)
    if (terminal == null) {
      throw new Error(`Terminal not found: ${req.terminalId}`)
    }
    return { terminal }
  })

  typedIpcHandle('terminal:get-buffer', async (req) => ({
    output: svc.getBuffer(req.terminalId),
  }))
}
