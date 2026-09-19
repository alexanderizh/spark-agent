/**
 * 工作流 Agent 工具桥（渲染端，E2-2，对称 canvas-tool-host.ts）
 *
 * 把 WorkflowToolContext（编辑器状态只读视图 + 落库封装）注册到主进程，
 * 监听主进程 stream:workflow:tool-call 事件，调 executeWorkflowTool 执行，
 * 通过 workflow:tool-result IPC 把结果送回去。
 *
 * 用法（在 WorkflowAgentPanel 内）：
 *   useWorkflowToolHost({ sessionId, context })
 * 自动负责 attach/detach 生命周期。
 *
 * 与画布宿主的差异：无 projectId 维度——工作流 Agent 绑定的是「编辑器当前
 * 打开的图」，写串行队列按 sessionId 隔离（一个面板一个图）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkflowToolCallEvent } from '@spark/protocol'
import {
  executeWorkflowTool,
  getWorkflowToolSchemas,
  READONLY_WORKFLOW_TOOL_NAMES,
  type WorkflowToolContext,
} from './workflow.tools'

/** 写串行队列：按 sessionId 排队，保证同一会话的写操作不并发。 */
const sessionWriteQueues = new Map<string, Promise<void>>()

/**
 * 把写任务排入会话的串行队列（保证写-写不并发）。
 * 失败不阻塞后续任务（catch 吞掉 rejection）。
 */
async function runWriteInSessionQueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionWriteQueues.get(sessionId) ?? Promise.resolve()
  const queuedTask = previous.catch(() => undefined).then(task)
  const lock = queuedTask.then(
    () => undefined,
    () => undefined,
  )
  sessionWriteQueues.set(sessionId, lock)
  try {
    return await queuedTask
  } finally {
    if (sessionWriteQueues.get(sessionId) === lock) {
      sessionWriteQueues.delete(sessionId)
    }
  }
}

/** 只读任务直接执行，不排队（并行安全）。 */
function runReadonly<T>(task: () => Promise<T>): Promise<T> {
  return task()
}

export interface WorkflowToolHostOptions {
  /** 已 create 的 session id；为 null 时 hook 不做任何事 */
  sessionId: string | null
  /** 渲染端工具上下文（getEditorState + 落库封装）；hook 用 ref 持有最新引用 */
  context: WorkflowToolContext
}

export type WorkflowToolHostConnectionStatus = 'detached' | 'attaching' | 'attached' | 'error'

export interface WorkflowToolHostController {
  status: WorkflowToolHostConnectionStatus
  error: string | null
  /** 确保指定 session 已完成主进程绑定；首轮 submit 前必须 await。 */
  ensureAttached: (sessionId: string) => Promise<void>
  /** 重新绑定当前 session。 */
  reconnect: () => Promise<void>
}

type ActiveWorkflowBinding = {
  sessionId: string
  phase: 'attaching' | 'attached' | 'error'
  promise: Promise<void>
}

/**
 * 把当前工作流编辑器上下文 attach 到指定 session，并监听 Agent 工具调用。
 * 卸载时自动 detach。
 */
export function useWorkflowToolHost(opts: WorkflowToolHostOptions): WorkflowToolHostController {
  // 用 ref 持有最新的 ctx，监听函数闭包里读取，避免每次 ctx 变化重新订阅
  const ctxRef = useRef<WorkflowToolContext>(opts.context)
  const bindingRef = useRef<ActiveWorkflowBinding | null>(null)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<WorkflowToolHostConnectionStatus>('detached')
  const [error, setError] = useState<string | null>(null)

  // 同步最新 ctx
  useEffect(() => {
    ctxRef.current = opts.context
  }, [opts.context])

  const detachBinding = useCallback((binding: ActiveWorkflowBinding) => {
    void binding.promise
      .catch(() => undefined)
      .then(() => window.spark.invoke('workflow:host-detach', { sessionId: binding.sessionId }))
      .catch((detachError) => {
        console.warn('解除工作流 Agent 绑定失败', detachError)
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
      const current = bindingRef.current
      if (
        !force &&
        current != null &&
        current.sessionId === sessionId &&
        current.phase !== 'error'
      ) {
        return current.promise
      }

      if (current != null && current.sessionId !== sessionId) {
        detachBinding(current)
      }

      if (mountedRef.current) {
        setStatus('attaching')
        setError(null)
      }

      const binding: ActiveWorkflowBinding = {
        sessionId,
        phase: 'attaching',
        promise: Promise.resolve(),
      }
      const promise = window.spark
        .invoke('workflow:host-attach', {
          sessionId,
          toolSchemas: getWorkflowToolSchemas(),
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
    [detachBinding],
  )

  const ensureAttached = useCallback(
    (sessionId: string) => attachSession(sessionId),
    [attachSession],
  )

  const reconnect = useCallback(async () => {
    if (opts.sessionId == null) throw new Error('尚未选择工作流 Agent 会话')
    await attachSession(opts.sessionId, true)
  }, [attachSession, opts.sessionId])

  // 监听主进程工具调用事件。订阅始终保活，首轮 ensureAttached 后无需等待 React effect。
  useEffect(() => {
    const unsubscribe = window.spark.on(
      'stream:workflow:tool-call',
      (event: WorkflowToolCallEvent) => {
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
        void window.spark.invoke('workflow:tool-ack', { requestId: event.requestId })
        void (async () => {
          // 只读工具并行执行，写工具按会话串行排队
          const isReadonly = READONLY_WORKFLOW_TOOL_NAMES.has(event.toolName)
          const runner = isReadonly
            ? runReadonly
            : (task: () => Promise<unknown>) => runWriteInSessionQueue(event.sessionId, task)
          try {
            const result = await runner(() =>
              executeWorkflowTool(ctxRef.current, event.toolName, event.args),
            )
            await window.spark.invoke('workflow:tool-result', {
              requestId: event.requestId,
              ok: true,
              result,
            })
          } catch (err) {
            await window.spark.invoke('workflow:tool-result', {
              requestId: event.requestId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })()
      },
    )
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
