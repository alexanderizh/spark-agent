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

/**
 * 只读工具白名单：这些工具只读快照、不产生任何写副作用（不调 workspace mutation）。
 * 它们可以安全并行执行，无需进入写串行队列。
 *
 * 命名约定：get_ / list_ / find_ / search_ 前缀的工具默认只读。
 * 显式列出而非前缀匹配，避免新增工具时误判。
 */
const READONLY_TOOL_NAMES = new Set<string>([
  'canvas_get_project_summary',
  'canvas_get_node',
  'canvas_get_operation_config',
  'canvas_get_asset',
  'canvas_list_nodes',
  'canvas_list_group_members',
  'canvas_list_assets',
  'canvas_list_capabilities',
  'canvas_list_media_models',
  'canvas_list_shot_groups',
  'canvas_list_tasks',
  'canvas_find_nodes',
  'canvas_search_assets',
  'canvas_query_nodes',
])

/** 写串行队列：按 projectId 排队，保证同一项目的写操作不并发。 */
const projectWriteQueues = new Map<string, Promise<void>>()

/**
 * 把写任务排入项目的串行队列（保证写-写不并发）。
 * 失败不阻塞后续任务（catch 吞掉 rejection）。
 */
async function runWriteInProjectQueue<T>(
  projectId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = projectWriteQueues.get(projectId) ?? Promise.resolve()
  const queuedTask = previous.catch(() => undefined).then(task)
  const lock = queuedTask.then(
    () => undefined,
    () => undefined,
  )
  projectWriteQueues.set(projectId, lock)
  try {
    return await queuedTask
  } finally {
    if (projectWriteQueues.get(projectId) === lock) {
      projectWriteQueues.delete(projectId)
    }
  }
}

/** 只读任务直接执行，不排队（并行安全）。 */
function runReadonly<T>(task: () => Promise<T>): Promise<T> {
  return task()
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
        // 立即 ACK：通知主进程「已收到，即将执行」。
        // 主进程据此启动 60s 执行超时，不再把队列等待时间计入预算，消除级联超时。
        void window.spark.invoke('canvas:tool-ack', { requestId: event.requestId })
        void (async () => {
          // 只读工具并行执行，写工具按项目串行排队
          const isReadonly = READONLY_TOOL_NAMES.has(event.toolName)
          const runner = isReadonly
            ? runReadonly
            : (task: () => Promise<unknown>) =>
                runWriteInProjectQueue(ctxRef.current.projectId, task)
          try {
            const result = await runner(() =>
              executeCanvasTool(ctxRef.current, event.toolName, event.args),
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
