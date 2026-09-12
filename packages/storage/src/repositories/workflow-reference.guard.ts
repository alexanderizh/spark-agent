import type { SparkDatabase } from '../database.js'

/**
 * 工作流删除引用守卫（方案 §8.2，阶段 5）。
 *
 * 所有删除入口（Desktop `workflow:delete`、Platform Bridge、Bundle 卸载/导入
 * 回滚、AccountSync tombstone）共用本守卫，且由 `WorkflowRepository.delete`
 * 在仓储层强制执行——入口不需要、也不允许各自重复接线。
 *
 * `interactive`：普通硬删除，四类活动引用任一存在即拒绝；
 * `bundle-uninstall`：Bundle 卸载是独立显式生命周期操作，只被 override
 *   Binding 与可恢复 Run 阻断（Agent 绑定由卸载流程显式解除，Bundle 归属
 *   本身就是卸载目标）；
 * `internalRollback`：导入失败回滚专用，仅断言对象没有任何 Binding 与任何
 *   状态的 Run（导入事务内尚未对外可见的对象必然为零）。
 */
export type WorkflowDeletePolicy = 'interactive' | 'bundle-uninstall' | 'internalRollback'

export type WorkflowReferenceBlocker =
  | { code: 'workflow_referenced_by_agents'; agentIds: string[] }
  | { code: 'workflow_referenced_by_bindings'; sessionIds: string[] }
  | { code: 'workflow_run_resumable'; runIds: string[] }
  | { code: 'workflow_in_installed_bundle'; bundleId: string }

/** 删除被引用守卫拒绝时的稳定错误；入口捕获后转结构化响应，不透传裸 FK 错误。 */
export class WorkflowReferenceGuardError extends Error {
  readonly blockers: WorkflowReferenceBlocker[]

  constructor(
    readonly workflowId: string,
    blockers: WorkflowReferenceBlocker[],
  ) {
    super(buildGuardMessage(workflowId, blockers))
    this.name = 'WorkflowReferenceGuardError'
    this.blockers = blockers
  }
}

/** 完整列出四类引用，供 UI 展示与策略判断；不区分 policy。 */
export function inspectWorkflowReferences(
  db: SparkDatabase,
  workflowId: string,
): WorkflowReferenceBlocker[] {
  const blockers: WorkflowReferenceBlocker[] = []

  const agentIds = (
    db.raw.prepare('SELECT id FROM agents WHERE workflow_id = ?').all(workflowId) as Array<{
      id: string
    }>
  ).map((row) => row.id)
  if (agentIds.length > 0) blockers.push({ code: 'workflow_referenced_by_agents', agentIds })

  const sessionIds = (
    db.raw
      .prepare('SELECT session_id FROM session_workflow_bindings WHERE workflow_id = ?')
      .all(workflowId) as Array<{ session_id: string }>
  ).map((row) => row.session_id)
  if (sessionIds.length > 0) {
    blockers.push({ code: 'workflow_referenced_by_bindings', sessionIds })
  }

  const runIds = (
    db.raw
      .prepare(
        `SELECT id FROM workflow_runs
         WHERE workflow_id = ?
           AND (
             status = 'working'
             OR (
               status = 'failed'
               AND (
                 workflow_binding_instance_id IS NULL
                 OR EXISTS (
                   SELECT 1 FROM session_workflow_bindings b
                   WHERE b.session_id = workflow_runs.session_id
                     AND b.binding_instance_id = workflow_runs.workflow_binding_instance_id
                 )
               )
             )
           )`,
      )
      .all(workflowId) as Array<{ id: string }>
  ).map((row) => row.id)
  if (runIds.length > 0) blockers.push({ code: 'workflow_run_resumable', runIds })

  const bundleRow = db.raw
    .prepare('SELECT bundle_id FROM workflows WHERE id = ?')
    .get(workflowId) as { bundle_id: string | null } | undefined
  if (bundleRow?.bundle_id != null) {
    blockers.push({ code: 'workflow_in_installed_bundle', bundleId: bundleRow.bundle_id })
  }

  return blockers
}

/** 按 policy 过滤需要强制执行的阻断项；为空即允许删除。 */
export function enforceWorkflowDeletePolicy(
  blockers: WorkflowReferenceBlocker[],
  policy: WorkflowDeletePolicy,
): WorkflowReferenceBlocker[] {
  switch (policy) {
    case 'interactive':
      return blockers
    case 'bundle-uninstall':
      return blockers.filter(
        (blocker) =>
          blocker.code === 'workflow_referenced_by_bindings' ||
          blocker.code === 'workflow_run_resumable',
      )
    case 'internalRollback':
      // 回滚对象必须零绑定、零运行记录（任意状态，含终态）。
      return blockers.filter((blocker) => blocker.code === 'workflow_referenced_by_bindings')
  }
}

/** 仓储层统一入口：policy 不允许的删除抛 WorkflowReferenceGuardError。 */
export function assertWorkflowDeletable(
  db: SparkDatabase,
  workflowId: string,
  policy: WorkflowDeletePolicy,
): void {
  const enforced = enforceWorkflowDeletePolicy(inspectWorkflowReferences(db, workflowId), policy)
  if (policy === 'internalRollback' && enforced.length === 0) {
    // internalRollback 还要求任意状态的 Run 为零（inspect 的 run 查询只覆盖可恢复态）。
    const anyRun = db.raw
      .prepare('SELECT 1 FROM workflow_runs WHERE workflow_id = ? LIMIT 1')
      .get(workflowId)
    if (anyRun != null) {
      throw new WorkflowReferenceGuardError(workflowId, [
        { code: 'workflow_run_resumable', runIds: [] },
      ])
    }
  }
  if (enforced.length > 0) {
    throw new WorkflowReferenceGuardError(workflowId, enforced)
  }
}

function buildGuardMessage(workflowId: string, blockers: WorkflowReferenceBlocker[]): string {
  const parts = blockers.map((blocker) => {
    switch (blocker.code) {
      case 'workflow_referenced_by_agents':
        return `Agent 仍绑定该工作流（${blocker.agentIds.join(', ')}）`
      case 'workflow_referenced_by_bindings':
        return `会话仍挂载该工作流（${blocker.sessionIds.join(', ')}）`
      case 'workflow_run_resumable':
        return blocker.runIds.length > 0
          ? `存在可恢复的运行记录（${blocker.runIds.join(', ')}）`
          : '存在运行记录'
      case 'workflow_in_installed_bundle':
        return `该工作流属于已安装的 Bundle（${blocker.bundleId}），请走 Bundle 卸载`
    }
  })
  return `工作流 ${workflowId} 不能删除：${parts.join('；')}。请先解除相关引用或改用归档。`
}
