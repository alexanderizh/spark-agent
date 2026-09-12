import {
  SessionWorkflowBindingRepository,
  SettingsRepository,
  type SparkDatabase,
} from '@spark/storage'
import type { SessionWorkflowBindingCreate } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { readSessionWorkflowFeatureFlags } from './session-workflow-feature-flags.js'
import { WorkflowPreflightService } from './workflow-preflight.service.js'

export function assertSessionWorkflowBindingCreationReady(
  db: SparkDatabase,
  binding: SessionWorkflowBindingCreate | undefined,
  hostAgentId?: string,
  options?: {
    /**
     * WorkflowSessionLauncher 内部启动（编辑器试跑 / Tool Package）：
     * 跳过面向用户的挂载 Preflight（launcher 自行校验存在性、enabled、
     * draft 放行与图结构），仅保留功能开关要求。
     */
    launchSource?: 'editor-test' | 'tool-package'
  },
): void {
  if (binding == null) return
  const flags = readSessionWorkflowFeatureFlags(new SettingsRepository(db))
  if (!flags.writeEnabled) {
    throw new SparkError('CAPABILITY_DISABLED', '会话工作流挂载功能尚未启用。')
  }
  if (options?.launchSource != null) return
  const preflight = new WorkflowPreflightService(db).inspect({
    ...binding,
    ...(hostAgentId != null ? { hostAgentId } : {}),
  })
  if (!preflight.ok) {
    throw new SparkError('VALIDATION_FAILED', '所选工作流未通过挂载前检查。', {
      issues: preflight.issues,
      warnings: preflight.warnings,
    })
  }
}

export function createSessionAndBindingAtomically<T extends { id: string }>(input: {
  db: SparkDatabase
  binding: SessionWorkflowBindingCreate | undefined
  createSession: () => T
  applyMetadata: (created: T) => void
  bindingRepository?: Pick<SessionWorkflowBindingRepository, 'create'>
}): T {
  const bindingRepository =
    input.bindingRepository ?? new SessionWorkflowBindingRepository(input.db)
  const create = () => {
    const created = input.createSession()
    input.applyMetadata(created)
    if (input.binding != null) {
      bindingRepository.create({
        sessionId: created.id,
        mode: input.binding.mode,
        ...(input.binding.mode === 'override' ? { workflowId: input.binding.workflowId } : {}),
      })
    }
    return created
  }
  const database = input.db as unknown as {
    raw?: { transaction?: <R>(work: () => R) => () => R }
  }
  // A few narrow SessionService tests use a pre-transaction repository double.
  // Production SparkDatabase always takes the transactional branch.
  return typeof database.raw?.transaction === 'function'
    ? database.raw.transaction(create)()
    : create()
}
