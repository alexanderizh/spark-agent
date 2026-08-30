import { DEFAULT_VIDEO_POLL_TIMEOUT_MS } from '@spark/protocol'
import type { CanvasSnapshot, CanvasTask } from './canvas.types'

export interface WaitForCanvasWorkflowTaskOptions {
  projectId: string
  taskId: string
  readSnapshot: (projectId: string) => Promise<CanvasSnapshot>
  signal?: AbortSignal
  pollIntervalMs?: number
  timeoutMs?: number
}

function abortError(): DOMException {
  return new DOMException('画布工作流运行已取消', 'AbortError')
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  if (ms === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(abortError())
      },
      { once: true },
    )
  })
}

export async function waitForCanvasWorkflowTask(
  options: WaitForCanvasWorkflowTaskOptions,
): Promise<CanvasTask> {
  const startedAt = Date.now()
  const pollIntervalMs = options.pollIntervalMs ?? 750
  // 媒体任务可能在 Provider 侧长时间排队；默认等待上限与统一视频轮询上限一致。
  const timeoutMs = options.timeoutMs ?? DEFAULT_VIDEO_POLL_TIMEOUT_MS

  for (;;) {
    if (options.signal?.aborted) throw abortError()
    const snapshot = await options.readSnapshot(options.projectId)
    const task = snapshot.tasks.find((item) => item.id === options.taskId)
    if (!task) throw new Error('画布任务不存在或已被清理')
    if (task.status === 'completed') return task
    if (task.status === 'failed') {
      throw new Error(task.errorMsg || task.errorDetail || '画布任务执行失败')
    }
    if (task.status === 'cancelled') throw abortError()
    if (Date.now() - startedAt >= timeoutMs)
      throw new Error('画布任务等待超时，可稍后从运行记录恢复')
    await wait(pollIntervalMs, options.signal)
  }
}
