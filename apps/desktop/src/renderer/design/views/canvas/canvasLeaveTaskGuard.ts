import { selectRunningCanvasTasks } from './canvasTaskActivity'
import type { CanvasTask } from './canvas.types'

type CanvasLeaveTaskGuardInput = {
  readLatestTasks: () => Promise<CanvasTask[]>
  confirmLeave: (runningCount: number) => Promise<boolean>
  cancelTask: (taskId: string) => Promise<unknown>
}

/**
 * 离开动作发生时直接读取任务热存储，不使用 React 上一次 render 捕获的快照。
 * 用户确认后再读一次：弹窗打开期间已经结束的任务不再被误取消或继续计为运行中。
 */
export async function confirmCanvasLeaveWithRunningTasks(
  input: CanvasLeaveTaskGuardInput,
): Promise<boolean> {
  const runningBeforeConfirm = selectRunningCanvasTasks(await input.readLatestTasks())
  if (runningBeforeConfirm.length === 0) return true

  const confirmed = await input.confirmLeave(runningBeforeConfirm.length)
  if (!confirmed) return false

  const runningAfterConfirm = selectRunningCanvasTasks(await input.readLatestTasks())
  for (const task of runningAfterConfirm) {
    try {
      await input.cancelTask(task.id)
    } catch {
      // 单个 runtime 取消失败不阻塞退出；canvasApi.cancelTask 已负责本地终态兜底。
    }
  }
  return true
}
