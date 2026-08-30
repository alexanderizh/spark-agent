import type { CanvasOperationOutputView, CanvasOperationRunView } from './canvasOperationRuns'

type DeleteCanvasOperationRunInput = {
  operationNodeId: string
  run: CanvasOperationRunView
  cancelTask: (taskId: string) => Promise<void>
  flushTaskRuntimeWrites: () => Promise<void>
  deleteOperationOutputs: (input: {
    operationNodeId: string
    outputs: CanvasOperationOutputView[]
  }) => Promise<unknown>
  deleteTasks: (
    taskIds: string[],
  ) => Promise<{ tasks: Array<{ id: string }> } | null | undefined | void>
}

export type DeleteCanvasOperationRunResult = 'deleted' | 'preserved'

/**
 * 删除整次运行的统一顺序：活动任务必须先通知 runtime 取消；已有部分产物先走
 * 产物删除管线清理血缘与引用；最后删除已经为空的任务记录并修复节点当前任务回指。
 */
export async function deleteCanvasOperationRun(
  input: DeleteCanvasOperationRunInput,
): Promise<DeleteCanvasOperationRunResult> {
  const {
    operationNodeId,
    run,
    cancelTask,
    flushTaskRuntimeWrites,
    deleteOperationOutputs,
    deleteTasks,
  } = input
  if (run.status === 'pending' || run.status === 'running') {
    await cancelTask(run.taskId)
  }
  // 取消/失败/完成终态先进入持久化基线，再执行可放弃的记录删除。否则 dirty 项目放弃
  // 修改时可能从旧磁盘快照把已取消任务恢复成 running。
  await flushTaskRuntimeWrites()
  if (run.outputs.length > 0) {
    await deleteOperationOutputs({ operationNodeId, outputs: run.outputs })
  }
  const snapshot = await deleteTasks([run.taskId])
  return snapshot?.tasks.some((task) => task.id === run.taskId) ? 'preserved' : 'deleted'
}
