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
import { useCallback, useEffect, useRef, useState } from 'react'
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
  'canvas_get_available_actions',
  'canvas_get_production_plan',
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
async function runWriteInProjectQueue<T>(projectId: string, task: () => Promise<T>): Promise<T> {
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

export type CanvasToolHostConnectionStatus = 'detached' | 'attaching' | 'attached' | 'error'

export interface CanvasToolHostController {
  status: CanvasToolHostConnectionStatus
  error: string | null
  /** 确保指定 session 已完成主进程绑定；首轮 submit 前必须 await。 */
  ensureAttached: (sessionId: string) => Promise<void>
  /** 重新绑定当前 session。 */
  reconnect: () => Promise<void>
}

type ActiveCanvasBinding = {
  sessionId: string
  projectId: string
  phase: 'attaching' | 'attached' | 'error'
  promise: Promise<void>
}

/**
 * 把当前画布上下文 attach 到指定 session，并监听 agent 工具调用。
 * 卸载时自动 detach。
 */
export function useCanvasToolHost(opts: CanvasToolHostOptions): CanvasToolHostController {
  // 用 ref 持有最新的 ctx，监听函数闭包里读取，避免每次 ctx 变化重新订阅
  const ctxRef = useRef<CanvasToolContext>({
    projectId: opts.projectId,
    getSnapshot: opts.getSnapshot,
    workspace: opts.workspace,
  })
  const bindingRef = useRef<ActiveCanvasBinding | null>(null)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<CanvasToolHostConnectionStatus>('detached')
  const [error, setError] = useState<string | null>(null)

  // 同步最新 ctx
  useEffect(() => {
    ctxRef.current = {
      projectId: opts.projectId,
      getSnapshot: opts.getSnapshot,
      workspace: opts.workspace,
    }
  }, [opts.projectId, opts.getSnapshot, opts.workspace])

  const detachBinding = useCallback((binding: ActiveCanvasBinding) => {
    void binding.promise
      .catch(() => undefined)
      .then(() => window.spark.invoke('canvas:host-detach', { sessionId: binding.sessionId }))
      .catch((detachError) => {
        console.warn('解除画布 Agent 绑定失败', detachError)
      })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const binding = bindingRef.current
      bindingRef.current = null
      if (binding != null) detachBinding(binding)
    }
  }, [detachBinding])

  const attachSession = useCallback(
    (sessionId: string, force = false): Promise<void> => {
      const projectId = opts.projectId
      const current = bindingRef.current
      if (
        !force &&
        current != null &&
        current.sessionId === sessionId &&
        current.projectId === projectId &&
        current.phase !== 'error'
      ) {
        return current.promise
      }

      if (current != null && (current.sessionId !== sessionId || current.projectId !== projectId)) {
        detachBinding(current)
      }

      if (mountedRef.current) {
        setStatus('attaching')
        setError(null)
      }

      const binding: ActiveCanvasBinding = {
        sessionId,
        projectId,
        phase: 'attaching',
        promise: Promise.resolve(),
      }
      const promise = window.spark
        .invoke('canvas:host-attach', {
          sessionId,
          projectId,
          toolSchemas: getCanvasToolSchemas(),
        })
        .then(() => {
          if (bindingRef.current !== binding) return
          binding.phase = 'attached'
          if (mountedRef.current) {
            setStatus('attached')
            setError(null)
          }
        })
        .catch((attachError) => {
          const message = attachError instanceof Error ? attachError.message : String(attachError)
          if (bindingRef.current === binding) {
            binding.phase = 'error'
            if (mountedRef.current) {
              setStatus('error')
              setError(message)
            }
          }
          throw attachError
        })
      binding.promise = promise
      bindingRef.current = binding
      return promise
    },
    [detachBinding, opts.projectId],
  )

  const ensureAttached = useCallback(
    (sessionId: string) => attachSession(sessionId),
    [attachSession],
  )

  const reconnect = useCallback(async () => {
    if (opts.sessionId == null) throw new Error('尚未选择画布 Agent 会话')
    await attachSession(opts.sessionId, true)
  }, [attachSession, opts.sessionId])

  // 监听主进程工具调用事件。订阅始终保活，首轮 ensureAttached 后无需等待 React effect。
  useEffect(() => {
    const unsubscribe = window.spark.on('stream:canvas:tool-call', (event: CanvasToolCallEvent) => {
      const binding = bindingRef.current
      if (
        binding == null ||
        binding.phase !== 'attached' ||
        event.sessionId !== binding.sessionId
      ) {
        return
      }
      // 立即 ACK：通知主进程「已收到，即将执行」。
      // 主进程据此启动 60s 执行超时，不再把队列等待时间计入预算，消除级联超时。
      void window.spark.invoke('canvas:tool-ack', { requestId: event.requestId })
      void (async () => {
        // 只读工具并行执行，写工具按项目串行排队
        const isReadonly = READONLY_TOOL_NAMES.has(event.toolName)
        const runner = isReadonly
          ? runReadonly
          : (task: () => Promise<unknown>) => runWriteInProjectQueue(ctxRef.current.projectId, task)
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
    })
    return unsubscribe
  }, [])

  // attach / detach
  useEffect(() => {
    if (opts.sessionId == null) {
      if (bindingRef.current == null && mountedRef.current) {
        setStatus('detached')
        setError(null)
      }
      return
    }
    const sessionId = opts.sessionId
    void ensureAttached(sessionId).catch(() => undefined)
    return () => {
      const binding = bindingRef.current
      if (binding == null || binding.sessionId !== sessionId) return
      bindingRef.current = null
      detachBinding(binding)
    }
  }, [detachBinding, ensureAttached, opts.sessionId])

  return { status, error, ensureAttached, reconnect }
}
