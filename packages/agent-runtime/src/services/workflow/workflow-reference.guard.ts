import {
  SessionWorkflowBindingRepository,
  WorkflowRunRepository,
  type SparkDatabase,
} from '@spark/storage'

/**
 * 删除工作流定义前的引用守卫（方案 §8/阶段 5）。
 *
 * 数据库层已有 `session_workflow_bindings.workflow_id → workflows(id) ON DELETE
 * RESTRICT` 兜底，但裸 FK 错误对 UI 不可解释。守卫在删除入口前给出结构化
 * 阻断原因，保证「无悬空 Binding、所有删除入口策略一致」：
 *
 * - `workflow_referenced_by_bindings`：仍有会话显式挂载该工作流。必须先在
 *   这些会话中解除/切换挂载，否则会留下指向已删除定义的 Binding 配置。
 * - `workflow_run_working`：该工作流仍有运行中的 Run。删除定义会让执行中的
 *   executor 立即失去可解释的图，先取消运行再删除。
 */
export type WorkflowReferenceBlocker =
  | { code: 'workflow_referenced_by_bindings'; sessionIds: string[] }
  | { code: 'workflow_run_working'; runIds: string[] }

export function inspectWorkflowReferences(
  db: SparkDatabase,
  workflowId: string,
): WorkflowReferenceBlocker[] {
  const blockers: WorkflowReferenceBlocker[] = []
  const sessionIds = new SessionWorkflowBindingRepository(db)
    .listByWorkflow(workflowId)
    .map((binding) => binding.sessionId)
  if (sessionIds.length > 0) {
    blockers.push({ code: 'workflow_referenced_by_bindings', sessionIds })
  }
  const working = new WorkflowRunRepository(db).findWorkingByWorkflow(workflowId)
  if (working != null) {
    blockers.push({ code: 'workflow_run_working', runIds: [working.id] })
  }
  return blockers
}
