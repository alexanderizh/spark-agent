import type { CanvasTask } from './canvas.types'

/**
 * CanvasTask 是任务生命周期的唯一权威状态；节点 data.status 仅用于节点视觉投影。
 * 所有任务队列、批量操作与退出守卫必须复用这里的判定，避免各处状态集合漂移。
 */
export function isCanvasTaskActive(task: Pick<CanvasTask, 'status'>): boolean {
  return task.status === 'pending' || task.status === 'running'
}

export function isCanvasTaskRunning(task: Pick<CanvasTask, 'status'>): boolean {
  return task.status === 'running'
}

export function selectRunningCanvasTasks(tasks: CanvasTask[]): CanvasTask[] {
  return tasks.filter(isCanvasTaskRunning)
}
