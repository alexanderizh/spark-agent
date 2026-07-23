import crypto from 'node:crypto'
import {
  CanvasWorkflowPackageSchema,
  compileCanvasWorkflowPackage,
  type CanvasWorkflowDefinition,
  type CanvasWorkflowPackage,
  type CanvasWorkflowRun,
  type CanvasWorkflowRunStep,
  type CanvasWorkflowRunStepStatus,
  type CanvasWorkflowVersion,
} from '@spark/protocol'
import {
  CanvasWorkflowRepository,
  CanvasWorkflowRunRepository,
  CanvasWorkflowVersionRepository,
  type CanvasWorkflowRow,
  type CanvasWorkflowRunRow,
  type CanvasWorkflowRunStepRow,
  type CanvasWorkflowVersionRow,
} from '@spark/storage'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'

export interface RegisterCanvasWorkflowIpcOptions {
  repository?: CanvasWorkflowRepository
  versionRepository?: CanvasWorkflowVersionRepository
  runRepository?: CanvasWorkflowRunRepository
  createId?: () => string
  now?: () => string
}

function parsePackage(value: unknown, context: string): CanvasWorkflowPackage {
  const parsed = CanvasWorkflowPackageSchema.safeParse(value)
  if (!parsed.success) {
    throw new SparkError(
      'VALIDATION_FAILED',
      `画布工作流${context}定义数据已损坏，请恢复历史版本或重新提取`,
    )
  }
  return parsed.data
}

function parseJsonObject(value: string | null, context: string): Record<string, unknown> | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not object')
    return parsed as Record<string, unknown>
  } catch {
    throw new SparkError('VALIDATION_FAILED', `画布工作流${context}数据已损坏`)
  }
}

function readOutputHandle(output: Record<string, unknown>, sourceHandle?: string): unknown {
  if (!sourceHandle) return output
  let current: unknown = output
  for (const part of sourceHandle.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function normalizeRunBindings(
  workflowPackage: CanvasWorkflowPackage,
  inputs: Record<string, unknown>,
  exposedParams: Record<string, unknown>,
): { inputs: Record<string, unknown>; exposedParams: Record<string, unknown> } {
  const inputById = new Map(workflowPackage.contract.inputs.map((input) => [input.id, input]))
  const paramById = new Map(
    workflowPackage.contract.exposedParams.map((param) => [param.id, param]),
  )
  for (const id of Object.keys(inputs)) {
    if (!inputById.has(id)) throw new SparkError('VALIDATION_FAILED', `未知的画布工作流输入：${id}`)
  }
  for (const input of workflowPackage.contract.inputs) {
    const value = inputs[input.id]
    if (
      input.required &&
      (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
    ) {
      throw new SparkError('VALIDATION_FAILED', `请填写必填输入“${input.name}”`)
    }
    if (value === undefined || value === null) continue
    if (input.valueType === 'text' && typeof value !== 'string') {
      throw new SparkError('VALIDATION_FAILED', `输入“${input.name}”必须是文本`)
    }
    if (input.valueType === 'structured' && (typeof value !== 'object' || value === null)) {
      throw new SparkError('VALIDATION_FAILED', `输入“${input.name}”必须是结构化数据`)
    }
  }

  const normalizedParams: Record<string, unknown> = {}
  for (const id of Object.keys(exposedParams)) {
    if (!paramById.has(id)) throw new SparkError('VALIDATION_FAILED', `未知的画布工作流参数：${id}`)
  }
  for (const param of workflowPackage.contract.exposedParams) {
    const value = exposedParams[param.id] ?? param.defaultValue
    if (value === undefined) continue
    const valid =
      (param.valueType === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (param.valueType === 'boolean' && typeof value === 'boolean') ||
      ((param.valueType === 'text' || param.valueType === 'select') && typeof value === 'string')
    if (!valid) throw new SparkError('VALIDATION_FAILED', `参数“${param.name}”类型不正确`)
    normalizedParams[param.id] = value
  }
  return { inputs: { ...inputs }, exposedParams: normalizedParams }
}

function toDefinition(
  repository: CanvasWorkflowRepository,
  row: CanvasWorkflowRow,
): CanvasWorkflowDefinition {
  const item = repository.toItem<CanvasWorkflowPackage>(row)
  return {
    id: item.id,
    projectId: item.projectId,
    name: item.name,
    description: item.description,
    scope: item.scope,
    status: item.status,
    version: item.version,
    tags: item.tags,
    package: parsePackage(item.package, ''),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function toVersion(row: CanvasWorkflowVersionRow): CanvasWorkflowVersion {
  let rawPackage: unknown
  try {
    rawPackage = JSON.parse(row.package_json)
  } catch {
    throw new SparkError('VALIDATION_FAILED', '画布工作流历史版本数据已损坏')
  }
  return {
    workflowId: row.workflow_id,
    version: row.version,
    name: row.name,
    package: parsePackage(rawPackage, '历史版本'),
    createdAt: row.created_at,
  }
}

function toRunStep(row: CanvasWorkflowRunStepRow): CanvasWorkflowRunStep {
  let dependsOnNodeIds: unknown
  try {
    dependsOnNodeIds = JSON.parse(row.depends_on_json)
  } catch {
    throw new SparkError('VALIDATION_FAILED', '画布工作流步骤依赖数据已损坏')
  }
  if (
    !Array.isArray(dependsOnNodeIds) ||
    dependsOnNodeIds.some((item) => typeof item !== 'string')
  ) {
    throw new SparkError('VALIDATION_FAILED', '画布工作流步骤依赖数据已损坏')
  }
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    stepIndex: row.step_index,
    status: row.status,
    dependsOnNodeIds,
    taskId: row.task_id,
    input: parseJsonObject(row.input_json, '步骤输入') ?? {},
    output: parseJsonObject(row.output_json, '步骤输出'),
    error: parseJsonObject(row.error_json, '步骤错误'),
    attempt: row.attempt,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  }
}

function toRun(
  repository: CanvasWorkflowRunRepository,
  row: CanvasWorkflowRunRow,
): CanvasWorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    projectId: row.project_id,
    status: row.status,
    inputs: parseJsonObject(row.inputs_json, '运行输入') ?? {},
    exposedParams: parseJsonObject(row.exposed_params_json, '运行参数') ?? {},
    outputs: parseJsonObject(row.outputs_json, '运行输出') ?? {},
    error: parseJsonObject(row.error_json, '运行错误'),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    steps: repository.listSteps(row.id).map(toRunStep),
  }
}

function requireWorkflow(repository: CanvasWorkflowRepository, id: string): CanvasWorkflowRow {
  const row = repository.get(id)
  if (!row) throw new SparkError('NOT_FOUND', '画布工作流不存在或已删除')
  return row
}

function requireMutableWorkflow(
  repository: CanvasWorkflowRepository,
  id: string,
): CanvasWorkflowRow {
  const row = requireWorkflow(repository, id)
  if (row.scope === 'builtin') {
    throw new SparkError('VALIDATION_FAILED', '内置模板为只读内容，请先复制到项目或个人库')
  }
  return row
}

export function registerCanvasWorkflowIpc(options: RegisterCanvasWorkflowIpcOptions = {}): void {
  const repository = options.repository ?? new CanvasWorkflowRepository(getDatabase())
  const versionRepository =
    options.versionRepository ?? new CanvasWorkflowVersionRepository(getDatabase())
  const runRepository = options.runRepository ?? new CanvasWorkflowRunRepository(getDatabase())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const resolveSubworkflowPackage = (workflowId: string, workflowVersion: number) => {
    const version = versionRepository.get(workflowId, workflowVersion)
    return version ? toVersion(version).package : null
  }

  typedIpcHandle('canvas:workflow:list', async (request) => {
    const offset = request.offset ?? 0
    const page = repository.listPage({
      ...(request.scope ? { scope: request.scope } : {}),
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.status ? { status: request.status } : {}),
      ...(request.query ? { query: request.query } : {}),
      ...(request.includeArchived !== undefined
        ? { includeArchived: request.includeArchived }
        : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.offset !== undefined ? { offset: request.offset } : {}),
    })
    return {
      workflows: page.rows.map((row) => toDefinition(repository, row)),
      total: page.total,
      hasMore: offset + page.rows.length < page.total,
    }
  })

  typedIpcHandle('canvas:workflow:get', async (request) => {
    const row = repository.get(request.id)
    return { workflow: row ? toDefinition(repository, row) : null }
  })

  typedIpcHandle('canvas:workflow:create', async (request) => {
    const createdAt = now()
    const row = repository.withTransaction(() => {
      const created = repository.create({
        id: createId(),
        name: request.name,
        description: request.description ?? null,
        scope: request.scope,
        projectId: request.scope === 'project' ? request.projectId! : null,
        status: request.status ?? 'draft',
        tags: request.tags ?? [],
        packageJson: request.package,
        createdAt,
        updatedAt: createdAt,
      })
      versionRepository.create({
        workflowId: created.id,
        version: created.version,
        name: created.name,
        packageJson: request.package,
        createdAt,
      })
      return created
    })
    return { workflow: toDefinition(repository, row) }
  })

  typedIpcHandle('canvas:workflow:update', async (request) => {
    const current = requireMutableWorkflow(repository, request.id)
    const nextVersion = request.package !== undefined ? current.version + 1 : current.version
    const row = repository.withTransaction(() => {
      const updated = repository.update(request.id, {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
        ...(request.tags !== undefined ? { tags: request.tags } : {}),
        ...(request.package !== undefined ? { packageJson: request.package } : {}),
        ...(request.package !== undefined
          ? { version: nextVersion, status: 'draft' as const }
          : {}),
        updatedAt: now(),
      })
      if (updated && request.package !== undefined) {
        versionRepository.create({
          workflowId: updated.id,
          version: updated.version,
          name: updated.name,
          packageJson: request.package,
          createdAt: updated.updated_at,
        })
      }
      return updated
    })
    if (!row) throw new SparkError('NOT_FOUND', '画布工作流不存在或已删除')
    return { workflow: toDefinition(repository, row) }
  })

  typedIpcHandle('canvas:workflow:duplicate', async (request) => {
    const source = requireWorkflow(repository, request.id)
    const row = repository.withTransaction(() => {
      const duplicated = repository.duplicate(request.id, {
        id: createId(),
        name: request.name ?? `${source.name} 副本`,
        scope: request.targetScope,
        projectId: request.targetScope === 'project' ? request.targetProjectId! : null,
        createdAt: now(),
      })
      if (duplicated) {
        const copiedPackage = toDefinition(repository, duplicated).package
        versionRepository.create({
          workflowId: duplicated.id,
          version: duplicated.version,
          name: duplicated.name,
          packageJson: copiedPackage,
          createdAt: duplicated.created_at,
        })
      }
      return duplicated
    })
    if (!row) throw new SparkError('NOT_FOUND', '画布工作流不存在或已删除')
    return { workflow: toDefinition(repository, row) }
  })

  typedIpcHandle('canvas:workflow:archive', async (request) => {
    requireMutableWorkflow(repository, request.id)
    const row = repository.update(request.id, {
      status: request.archived ? 'archived' : 'draft',
      updatedAt: now(),
    })
    if (!row) throw new SparkError('NOT_FOUND', '画布工作流不存在或已删除')
    return { workflow: toDefinition(repository, row) }
  })

  typedIpcHandle('canvas:workflow:delete', async (request) => {
    requireMutableWorkflow(repository, request.id)
    if (runRepository.hasRunsForWorkflow(request.id)) {
      throw new SparkError('VALIDATION_FAILED', '该画布工作流已有运行历史，请归档后保留追溯记录')
    }
    return { deleted: repository.delete(request.id) }
  })

  typedIpcHandle('canvas:workflow:version:list', async (request) => ({
    versions: versionRepository
      .list(request.workflowId, request.limit ?? 100, request.offset ?? 0)
      .map(toVersion),
  }))

  typedIpcHandle('canvas:workflow:publish', async (request) => {
    const current = requireMutableWorkflow(repository, request.id)
    const definition = toDefinition(repository, current)
    const compiled = compileCanvasWorkflowPackage(definition.package, {
      workflowId: definition.id,
      resolveSubworkflowPackage,
    })
    if (!compiled.ok) {
      throw new SparkError(
        'VALIDATION_FAILED',
        compiled.diagnostics[0]?.message ?? '画布工作流无法发布',
      )
    }
    const result = repository.withTransaction(() => {
      const versionRow =
        versionRepository.get(current.id, current.version) ??
        versionRepository.create({
          workflowId: current.id,
          version: current.version,
          name: current.name,
          packageJson: definition.package,
          createdAt: current.updated_at,
        })
      const published = repository.update(current.id, { status: 'published', updatedAt: now() })
      return { versionRow, published }
    })
    const { versionRow, published } = result
    if (!published) throw new SparkError('NOT_FOUND', '画布工作流不存在或已删除')
    return { workflow: toDefinition(repository, published), version: toVersion(versionRow) }
  })

  typedIpcHandle('canvas:workflow:run:create', async (request) => {
    const existing = runRepository.getByIdempotencyKey(request.idempotencyKey)
    if (existing) {
      if (
        existing.workflow_id !== request.workflowId ||
        existing.project_id !== request.projectId ||
        (request.workflowVersion !== undefined &&
          existing.workflow_version !== request.workflowVersion)
      ) {
        throw new SparkError('VALIDATION_FAILED', '幂等键已被其他画布工作流运行使用')
      }
      const existingVersionRow = versionRepository.get(
        existing.workflow_id,
        existing.workflow_version,
      )
      if (!existingVersionRow) {
        throw new SparkError('VALIDATION_FAILED', '画布工作流运行绑定的历史版本不存在')
      }
      const existingVersion = toVersion(existingVersionRow)
      const existingCompiled = compileCanvasWorkflowPackage(existingVersion.package, {
        workflowId: existing.workflow_id,
        resolveSubworkflowPackage,
      })
      if (!existingCompiled.ok) {
        throw new SparkError(
          'VALIDATION_FAILED',
          existingCompiled.diagnostics[0]?.message ?? '画布工作流历史运行计划已失效',
        )
      }
      return { run: toRun(runRepository, existing), plan: existingCompiled.plan }
    }

    const current = requireWorkflow(repository, request.workflowId)
    if (current.scope === 'project' && current.project_id !== request.projectId) {
      throw new SparkError('PERMISSION_DENIED', '项目画布工作流只能在所属项目中运行')
    }
    const requestedVersionRow =
      request.workflowVersion !== undefined
        ? versionRepository.get(current.id, request.workflowVersion)
        : null
    if (request.workflowVersion !== undefined && !requestedVersionRow) {
      throw new SparkError('NOT_FOUND', '指定的画布工作流历史版本不存在')
    }
    const currentDefinition = toDefinition(repository, current)
    const workflowPackage = requestedVersionRow
      ? toVersion(requestedVersionRow).package
      : currentDefinition.package
    const compiled = compileCanvasWorkflowPackage(workflowPackage, {
      workflowId: currentDefinition.id,
      resolveSubworkflowPackage,
    })
    if (!compiled.ok) {
      throw new SparkError(
        'VALIDATION_FAILED',
        compiled.diagnostics[0]?.message ?? '画布工作流无法运行',
      )
    }
    const bindings = normalizeRunBindings(workflowPackage, request.inputs, request.exposedParams)

    const runId = createId()
    const createdAt = now()
    const { run } = runRepository.withTransaction(() => {
      const versionRow =
        requestedVersionRow ??
        versionRepository.get(current.id, current.version) ??
        versionRepository.create({
          workflowId: current.id,
          version: current.version,
          name: current.name,
          packageJson: workflowPackage,
          createdAt: current.updated_at,
        })
      const created = runRepository.create({
        id: runId,
        workflowId: current.id,
        workflowVersion: versionRow.version,
        projectId: request.projectId,
        inputsJson: bindings.inputs,
        exposedParamsJson: bindings.exposedParams,
        idempotencyKey: request.idempotencyKey,
        createdAt,
      })
      runRepository.createSteps(
        created.id,
        compiled.plan.steps.map((step, stepIndex) => ({
          id: createId(),
          nodeId: step.nodeId,
          stepIndex,
          dependsOnNodeIds: [...step.dependsOnNodeIds],
        })),
      )
      return { run: created }
    })
    return { run: toRun(runRepository, run), plan: compiled.plan }
  })

  typedIpcHandle('canvas:workflow:run:list', async (request) => ({
    runs: runRepository
      .list({
        ...(request.projectId ? { projectId: request.projectId } : {}),
        ...(request.workflowId ? { workflowId: request.workflowId } : {}),
        ...(request.status ? { status: request.status } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
        ...(request.offset !== undefined ? { offset: request.offset } : {}),
      })
      .map((row) => toRun(runRepository, row)),
  }))

  typedIpcHandle('canvas:workflow:run:get', async (request) => {
    const run = runRepository.get(request.id)
    return { run: run ? toRun(runRepository, run) : null }
  })

  typedIpcHandle('canvas:workflow:run:step-update', async (request) => {
    const run = runRepository.get(request.runId)
    if (!run) throw new SparkError('NOT_FOUND', '画布工作流运行不存在')
    if (['completed', 'cancelled'].includes(run.status)) {
      throw new SparkError('VALIDATION_FAILED', '已结束的画布工作流运行不能再更新步骤')
    }
    const step = runRepository.getStep(request.runId, request.nodeId)
    if (!step) throw new SparkError('NOT_FOUND', '画布工作流运行步骤不存在')
    const allowed: Record<CanvasWorkflowRunStepStatus, CanvasWorkflowRunStepStatus[]> = {
      blocked: [],
      ready: ['running', 'completed', 'failed', 'cancelled', 'skipped'],
      running: ['completed', 'failed', 'cancelled'],
      completed: [],
      failed: [],
      cancelled: [],
      skipped: [],
    }
    if (!allowed[step.status].includes(request.status)) {
      throw new SparkError(
        'VALIDATION_FAILED',
        `步骤不能从 ${step.status} 变更为 ${request.status}`,
      )
    }
    const at = now()
    runRepository.updateStep(request.runId, request.nodeId, {
      status: request.status,
      ...(request.taskId !== undefined ? { taskId: request.taskId } : {}),
      ...(request.input !== undefined ? { inputJson: request.input } : {}),
      ...(request.output !== undefined ? { outputJson: request.output } : {}),
      ...(request.error !== undefined ? { errorJson: request.error } : {}),
      ...(request.status === 'running' ? { startedAt: at } : {}),
      ...(['completed', 'failed', 'cancelled', 'skipped'].includes(request.status)
        ? { finishedAt: at }
        : {}),
      updatedAt: at,
    })
    if (request.status === 'completed' || request.status === 'skipped') {
      runRepository.releaseReadySteps(request.runId, at)
    }
    let reconciled = runRepository.reconcileStatus(request.runId, at)
    if (!reconciled) throw new SparkError('NOT_FOUND', '画布工作流运行不存在')
    if (reconciled.status === 'completed') {
      const versionRow = versionRepository.get(reconciled.workflow_id, reconciled.workflow_version)
      if (!versionRow) throw new SparkError('VALIDATION_FAILED', '画布工作流运行版本不存在')
      const version = toVersion(versionRow)
      const stepOutputs = new Map(
        runRepository
          .listSteps(reconciled.id)
          .map((item) => [item.node_id, parseJsonObject(item.output_json, '步骤输出')]),
      )
      const outputs = Object.fromEntries(
        version.package.contract.outputs.flatMap((output) => {
          const stepOutput = output.sourceNodeId ? stepOutputs.get(output.sourceNodeId) : null
          if (!stepOutput) return []
          const value = readOutputHandle(stepOutput, output.sourceHandle)
          return value === undefined ? [] : [[output.id, value]]
        }),
      )
      reconciled = runRepository.updateRun(reconciled.id, { outputsJson: outputs, updatedAt: at })!
    }
    return { run: toRun(runRepository, reconciled) }
  })

  typedIpcHandle('canvas:workflow:run:cancel', async (request) => {
    const run = runRepository.cancel(request.id, now())
    if (!run) throw new SparkError('NOT_FOUND', '画布工作流运行不存在')
    return { run: toRun(runRepository, run) }
  })

  typedIpcHandle('canvas:workflow:run:retry', async (request) => {
    if (!request.nodeId) throw new SparkError('VALIDATION_FAILED', '重试运行必须指定失败节点')
    const step = runRepository.retryFailedStep(request.id, request.nodeId, now())
    if (!step) throw new SparkError('VALIDATION_FAILED', '仅失败步骤可以重试')
    const run = runRepository.get(request.id)
    if (!run) throw new SparkError('NOT_FOUND', '画布工作流运行不存在')
    return { run: toRun(runRepository, run) }
  })

  typedIpcHandle('canvas:workflow:run:resume', async (request) => {
    const run = runRepository.resume(request.id, now())
    if (!run) throw new SparkError('VALIDATION_FAILED', '当前画布工作流运行不能恢复')
    const versionRow = versionRepository.get(run.workflow_id, run.workflow_version)
    if (!versionRow) throw new SparkError('VALIDATION_FAILED', '画布工作流运行绑定的历史版本不存在')
    const compiled = compileCanvasWorkflowPackage(toVersion(versionRow).package, {
      workflowId: run.workflow_id,
      resolveSubworkflowPackage,
    })
    if (!compiled.ok) {
      throw new SparkError(
        'VALIDATION_FAILED',
        compiled.diagnostics[0]?.message ?? '画布工作流历史运行计划已失效',
      )
    }
    return { run: toRun(runRepository, run), plan: compiled.plan }
  })
}
