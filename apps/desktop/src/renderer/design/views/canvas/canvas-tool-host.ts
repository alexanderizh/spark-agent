/**
 * 画布 Agent 工具桥（渲染端，Phase 2）
 *
 * 把 CanvasToolContext（projectId + workspace actions + getSnapshot）注册到主进程，
 * 监听主进程 stream:canvas:tool-call 事件，调 executeCanvasTool 执行，
 * 通过 canvas:tool-result IPC 把结果送回去。
 *
 * 用法（在 CanvasAgentModal 内）：
 *   useCanvasToolHost({ sessionId, projectId, getSnapshot, workspace })
 * 自动负责 attach/detach 生命周期。
 */
import { useEffect, useRef } from 'react'
import type { CanvasToolCallEvent } from '@spark/protocol'
import {
  executeCanvasTool,
  getCanvasToolSchemas,
  type CanvasToolContext,
  type CanvasWorkspaceActions,
} from './canvas.tools'
import type { CanvasSnapshot } from './canvas.types'

const projectToolQueues = new Map<string, Promise<void>>()

async function runCanvasToolInProjectQueue<T>(
  projectId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = projectToolQueues.get(projectId) ?? Promise.resolve()
  const queuedTask = previous.catch(() => undefined).then(task)
  const lock = queuedTask.then(
    () => undefined,
    () => undefined,
  )
  projectToolQueues.set(projectId, lock)
  try {
    return await queuedTask
  } finally {
    if (projectToolQueues.get(projectId) === lock) {
      projectToolQueues.delete(projectId)
    }
  }
}

export interface CanvasToolHostOptions {
  /** 已 create 的 session id；为 null 时 hook 不做任何事 */
  sessionId: string | null
  projectId: string
  getSnapshot: () => CanvasSnapshot | null
  workspace: CanvasWorkspaceActions
}

/**
 * 把当前画布上下文 attach 到指定 session，并监听 agent 工具调用。
 * 卸载时自动 detach。
 */
export function useCanvasToolHost(opts: CanvasToolHostOptions): void {
  // 用 ref 持有最新的 ctx，监听函数闭包里读取，避免每次 ctx 变化重新订阅
  const ctxRef = useRef<CanvasToolContext>({
    projectId: opts.projectId,
    getSnapshot: opts.getSnapshot,
    workspace: opts.workspace,
  })

  // 同步最新 ctx
  useEffect(() => {
    ctxRef.current = {
      projectId: opts.projectId,
      getSnapshot: opts.getSnapshot,
      workspace: opts.workspace,
    }
  }, [opts.projectId, opts.getSnapshot, opts.workspace])

  // 监听主进程工具调用事件
  useEffect(() => {
    if (opts.sessionId == null) return
    const sessionId = opts.sessionId
    const unsubscribe = window.spark.on(
      'stream:canvas:tool-call',
      (event: CanvasToolCallEvent) => {
        if (event.sessionId !== sessionId) return
        void (async () => {
          try {
            const result = await runCanvasToolInProjectQueue(
              ctxRef.current.projectId,
              () =>
                executeCanvasTool(
                  ctxRef.current,
                  event.toolName,
                  event.args,
                ),
            )
            await window.spark.invoke('canvas:tool-result', {
              requestId: event.requestId,
              ok: true,
              result,
            })
          } catch (err) {
            await window.spark.invoke('canvas:tool-result', {
              requestId: event.requestId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })()
      },
    )
    return unsubscribe
  }, [opts.sessionId])

  // attach / detach
  useEffect(() => {
    if (opts.sessionId == null) return
    const sessionId = opts.sessionId
    void window.spark.invoke('canvas:host-attach', {
      sessionId,
      projectId: opts.projectId,
      toolSchemas: getCanvasToolSchemas(),
    })
    return () => {
      void window.spark.invoke('canvas:host-detach', { sessionId })
    }
  }, [opts.sessionId, opts.projectId])
}
