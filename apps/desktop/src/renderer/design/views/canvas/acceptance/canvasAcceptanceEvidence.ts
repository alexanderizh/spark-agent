import type { CanvasSnapshot, CanvasTask } from '../canvas.types'
import { probeCanvasAcceptanceAssets } from './canvasAcceptanceAssetProbe'
import { persistCanvasAcceptanceEvidence } from './canvasAcceptancePersistence'
import type { CanvasAcceptanceCasePlan, CanvasAcceptancePlan } from './canvasAcceptanceTypes'

const STORAGE_PREFIX = 'spark-canvas:acceptance-evidence:v1:'
const MAX_EVENTS_PER_RUN = 600
const MAX_STRING_CHARS = 12_000
const SECRET_KEYS = new Set([
  'authorization',
  'apikey',
  'cookie',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
])
const BASE64_BLOCK = /(?:data:[^;]+;base64,)?[A-Za-z0-9+/]{512,}={0,2}/
const URL_SECRET_BLOCK = /((?:https?|file|safe-file):\/\/[^\s"'<>?#]+)(?:[?#][^\s"'<>]*)/gi
const BEARER_TOKEN_BLOCK = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const memoryEvidence = new Map<string, CanvasAcceptanceStoredEvidence>()

export type CanvasAcceptanceAssertion = {
  id: string
  status: 'passed' | 'failed' | 'warned'
  message: string
}

export type CanvasAcceptanceEvidenceEvent = {
  sequence: number
  at: string
  source: 'media-stream' | 'text-stream' | 'manual-verification'
  runId: string
  caseId: string
  attemptId: string
  attemptIndex: number
  taskId: string
  operationNodeId: string | null
  taskStatus: CanvasTask['status']
  stage: string
  preCall: unknown
  providerCall: unknown
  providerResult: unknown
  canvasResult: unknown
  assertions: CanvasAcceptanceAssertion[]
  observabilityGap: boolean
}

export type CanvasAcceptanceEvidenceSummary = {
  totalEvents: number
  totalAttempts: number
  observedCases: number
  passedCases: number
  failedCases: number
  runningCases: number
  observabilityGaps: number
}

type AcceptanceContext = {
  runId: string
  boardId: string
  plan: CanvasAcceptancePlan
  caseNodeIds: Record<string, string>
  casePlan: CanvasAcceptanceCasePlan
}

export type CanvasAcceptanceStoredEvidence = {
  runId: string
  updatedAt: string
  events: CanvasAcceptanceEvidenceEvent[]
}

export type CanvasAcceptanceAttemptIdentity = {
  attemptId: string
  attemptIndex: number
}

export function captureCanvasAcceptanceTaskEvidence(input: {
  snapshot: CanvasSnapshot
  taskId: string
  source: CanvasAcceptanceEvidenceEvent['source']
  attempt?: CanvasAcceptanceAttemptIdentity
}): CanvasAcceptanceEvidenceEvent | null {
  try {
    const task = input.snapshot.tasks.find((item) => item.id === input.taskId)
    if (!task) return null
    const context = resolveAcceptanceContext(input.snapshot, task)
    if (!context) return null
    const existing = readCanvasAcceptanceEvidence(context.runId)
    const attempt =
      input.attempt ??
      resolveCanvasAcceptanceAttempt(existing.events, context.casePlan.caseId, task.id)
    const event = buildCanvasAcceptanceEvidenceEvent({
      snapshot: input.snapshot,
      task,
      context,
      source: input.source,
      sequence: nextEvidenceSequence(existing.events),
      attempt,
    })
    const next: CanvasAcceptanceStoredEvidence = {
      runId: context.runId,
      updatedAt: event.at,
      events: [...existing.events, event].slice(-MAX_EVENTS_PER_RUN),
    }
    saveCanvasAcceptanceEvidence(next)
    void persistCanvasAcceptanceEvidence({
      project: input.snapshot.project,
      plan: context.plan,
      evidence: next,
    })
    return event
  } catch {
    // 验收证据采集绝不能打断生产画布的 task stream 回写。
    return null
  }
}

export function appendCanvasAcceptanceRunnerEvidence(input: {
  runId: string
  casePlan: CanvasAcceptanceCasePlan
  operationNodeId?: string | null
  taskId?: string
  taskStatus: CanvasTask['status']
  stage: string
  preCall?: unknown
  providerCall?: unknown
  providerResult?: unknown
  canvasResult?: unknown
  assertions: CanvasAcceptanceAssertion[]
  attempt?: CanvasAcceptanceAttemptIdentity
  now?: () => Date
}): CanvasAcceptanceEvidenceEvent | null {
  try {
    const existing = readCanvasAcceptanceEvidence(input.runId)
    const attempt =
      input.attempt ??
      resolveCanvasAcceptanceAttempt(
        existing.events,
        input.casePlan.caseId,
        input.taskId ?? `preflight:${input.casePlan.caseId}`,
      )
    const event: CanvasAcceptanceEvidenceEvent = {
      sequence: nextEvidenceSequence(existing.events),
      at: (input.now ?? (() => new Date()))().toISOString(),
      source: 'manual-verification',
      runId: input.runId,
      caseId: input.casePlan.caseId,
      attemptId: attempt.attemptId,
      attemptIndex: attempt.attemptIndex,
      taskId: input.taskId ?? `preflight:${input.casePlan.caseId}`,
      operationNodeId: input.operationNodeId ?? null,
      taskStatus: input.taskStatus,
      stage: input.stage,
      preCall: sanitizeEvidence(input.preCall ?? null),
      providerCall: sanitizeEvidence(input.providerCall ?? null),
      providerResult: sanitizeEvidence(input.providerResult ?? null),
      canvasResult: sanitizeEvidence(input.canvasResult ?? null),
      assertions: input.assertions,
      observabilityGap: input.assertions.some(
        (item) => item.id.startsWith('evidence.') && item.status === 'failed',
      ),
    }
    const next: CanvasAcceptanceStoredEvidence = {
      runId: input.runId,
      updatedAt: event.at,
      events: [...existing.events, event].slice(-MAX_EVENTS_PER_RUN),
    }
    saveCanvasAcceptanceEvidence(next)
    return event
  } catch {
    return null
  }
}

export function readCanvasAcceptanceEvidence(runId: string): CanvasAcceptanceStoredEvidence {
  const memory = memoryEvidence.get(runId)
  if (memory) return memory
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${runId}`)
    if (!raw) return { runId, updatedAt: '', events: [] }
    const parsed = JSON.parse(raw) as Partial<CanvasAcceptanceStoredEvidence>
    return {
      runId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      events: Array.isArray(parsed.events)
        ? normalizeCanvasAcceptanceEvidenceEvents(parsed.events)
        : [],
    }
  } catch {
    return { runId, updatedAt: '', events: [] }
  }
}

function saveCanvasAcceptanceEvidence(evidence: CanvasAcceptanceStoredEvidence): void {
  memoryEvidence.set(evidence.runId, evidence)
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${evidence.runId}`, JSON.stringify(evidence))
  } catch {
    // localStorage 配额不足时继续使用内存并由项目文件镜像持久化，不能丢失本次真实调用证据。
  }
}

function nextEvidenceSequence(events: readonly CanvasAcceptanceEvidenceEvent[]): number {
  return events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1
}

export function summarizeCanvasAcceptanceEvidence(
  events: readonly CanvasAcceptanceEvidenceEvent[],
): CanvasAcceptanceEvidenceSummary {
  const latestByCase = new Map<string, CanvasAcceptanceEvidenceEvent>()
  const attemptIds = new Set<string>()
  for (const event of events) {
    latestByCase.set(event.caseId, event)
    attemptIds.add(event.attemptId)
  }
  let passedCases = 0
  let failedCases = 0
  let runningCases = 0
  let observabilityGaps = 0
  for (const event of latestByCase.values()) {
    const hasFailedAssertion = event.assertions.some((item) => item.status === 'failed')
    if (event.observabilityGap) observabilityGaps += 1
    if (event.taskStatus === 'completed' && !hasFailedAssertion) passedCases += 1
    else if (event.taskStatus === 'failed' || hasFailedAssertion) failedCases += 1
    else runningCases += 1
  }
  return {
    totalEvents: events.length,
    totalAttempts: attemptIds.size,
    observedCases: latestByCase.size,
    passedCases,
    failedCases,
    runningCases,
    observabilityGaps,
  }
}

export function buildCanvasAcceptanceEvidenceEvent(input: {
  snapshot: CanvasSnapshot
  task: CanvasTask
  context: AcceptanceContext
  source: CanvasAcceptanceEvidenceEvent['source']
  sequence: number
  attempt?: CanvasAcceptanceAttemptIdentity
  now?: () => Date
}): CanvasAcceptanceEvidenceEvent {
  const { snapshot, task, context } = input
  const outputNodes = snapshot.nodes.filter((node) => task.outputNodeIds.includes(node.id))
  const outputAssets = snapshot.assets.filter((asset) => task.outputAssetIds.includes(asset.id))
  const relatedEdges = snapshot.edges.filter(
    (edge) =>
      edge.taskId === task.id ||
      edge.sourceNodeId === task.operationNodeId ||
      task.outputNodeIds.includes(edge.targetNodeId),
  )
  const attempt = input.attempt ?? {
    attemptId: `${context.casePlan.caseId}:attempt:1`,
    attemptIndex: 1,
  }
  const mediaProbe = probeCanvasAcceptanceAssets(context.casePlan.targetKind, outputAssets)
  const assertions = [
    ...buildAssertions(task, context.casePlan, outputNodes.length, outputAssets.length),
    ...(task.status === 'completed' ? mediaProbe.assertions : []),
  ]
  const observabilityGap = assertions.some(
    (assertion) => assertion.id.startsWith('evidence.') && assertion.status === 'failed',
  )
  return {
    sequence: input.sequence,
    at: (input.now ?? (() => new Date()))().toISOString(),
    source: input.source,
    runId: context.runId,
    caseId: context.casePlan.caseId,
    attemptId: attempt.attemptId,
    attemptIndex: attempt.attemptIndex,
    taskId: task.id,
    operationNodeId: task.operationNodeId ?? null,
    taskStatus: task.status,
    stage: inferEvidenceStage(task),
    preCall: sanitizeEvidence({
      projectId: task.projectId,
      boardId: task.boardId,
      operation: task.operation,
      providerProfileId: task.providerProfileId,
      manifestId: task.manifestId,
      requestedModelId: task.modelId,
      agentId: task.agentId,
      skillIds: task.skillIds,
      reasoningEffort: task.reasoningEffort,
      taskPipelineRole: task.taskPipelineRole,
      outputPipelineRole: task.outputPipelineRole,
      prompt: task.prompt,
      negativePrompt: task.negativePrompt,
      systemPrompt: task.systemPrompt,
      compiledUserText: task.compiledUserText,
      promptSnapshot: task.promptSnapshot,
      inputSnapshots: task.inputSnapshots,
      relationManifest: task.relationManifest,
      promptWarnings: task.promptWarnings,
      modelParams: task.modelParams,
      inputNodeIds: task.inputNodeIds,
      inputAssetIds: task.inputAssetIds,
      inputFileDiagnostics: task.inputFileDiagnostics,
      shotScriptConfig: task.shotScriptConfig,
    }),
    providerCall: sanitizeEvidence({
      actualRequest: task.requestCall,
      submitResponse: task.submitResponse,
      runtimeEvents: task.runtimeEvents,
      providerRequestId: task.requestId,
    }),
    providerResult: sanitizeEvidence({
      actualProvider: task.provider,
      actualModel: task.modelId,
      rawResponse: task.rawResponse,
      modelOutputText: task.modelOutputText,
      errorMsg: task.errorMsg,
      errorDetail: task.errorDetail,
      completedAt: task.completedAt,
    }),
    canvasResult: sanitizeEvidence({
      outputNodeIds: task.outputNodeIds,
      outputAssetIds: task.outputAssetIds,
      outputNodes: outputNodes.map((node) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        assetId: node.assetId,
        pipelineRole: node.data.pipelineRole,
        status: node.data.status,
      })),
      outputAssets: outputAssets.map((asset) => ({
        id: asset.id,
        type: asset.type,
        mimeType: asset.mimeType,
        storageKey: asset.storageKey,
        url: asset.url,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        sizeBytes: asset.sizeBytes,
        metadata: asset.metadata,
      })),
      relatedEdges: relatedEdges.map((edge) => ({
        id: edge.id,
        type: edge.type,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
      mediaProbe: mediaProbe.probes,
    }),
    assertions,
    observabilityGap,
  }
}

export function createCanvasAcceptanceAttempt(
  runId: string,
  caseId: string,
): CanvasAcceptanceAttemptIdentity {
  const existing = readCanvasAcceptanceEvidence(runId).events
  const attemptIndex =
    existing.reduce(
      (maximum, event) =>
        event.caseId === caseId ? Math.max(maximum, event.attemptIndex) : maximum,
      0,
    ) + 1
  return { attemptId: `${caseId}:attempt:${attemptIndex}`, attemptIndex }
}

function resolveCanvasAcceptanceAttempt(
  events: readonly CanvasAcceptanceEvidenceEvent[],
  caseId: string,
  taskId: string,
): CanvasAcceptanceAttemptIdentity {
  const matchingTask = [...events]
    .reverse()
    .find((event) => event.caseId === caseId && event.taskId === taskId)
  if (matchingTask) {
    return { attemptId: matchingTask.attemptId, attemptIndex: matchingTask.attemptIndex }
  }
  const latest = [...events].reverse().find((event) => event.caseId === caseId)
  if (
    latest &&
    (latest.taskStatus === 'pending' || latest.taskStatus === 'running') &&
    latest.stage !== 'preflight_blocked' &&
    latest.stage !== 'blocked_by_upstream'
  ) {
    return { attemptId: latest.attemptId, attemptIndex: latest.attemptIndex }
  }
  const attemptIndex = (latest?.attemptIndex ?? 0) + 1
  return { attemptId: `${caseId}:attempt:${attemptIndex}`, attemptIndex }
}

function normalizeCanvasAcceptanceEvidenceEvents(
  events: unknown[],
): CanvasAcceptanceEvidenceEvent[] {
  const legacyAttempts = new Map<string, CanvasAcceptanceAttemptIdentity>()
  return events.filter(isRecord).map((raw, index) => {
    const caseId = typeof raw.caseId === 'string' ? raw.caseId : `legacy-case-${index + 1}`
    const taskId = typeof raw.taskId === 'string' ? raw.taskId : `legacy-task-${index + 1}`
    const legacyKey = `${caseId}\u0000${taskId}`
    let attempt = legacyAttempts.get(legacyKey)
    if (!attempt) {
      const attemptIndex =
        Array.from(legacyAttempts.entries()).filter(([key]) => key.startsWith(`${caseId}\u0000`))
          .length + 1
      attempt = { attemptId: `${caseId}:attempt:${attemptIndex}`, attemptIndex }
      legacyAttempts.set(legacyKey, attempt)
    }
    return {
      ...(raw as unknown as CanvasAcceptanceEvidenceEvent),
      sequence: typeof raw.sequence === 'number' ? raw.sequence : index + 1,
      caseId,
      taskId,
      attemptId: typeof raw.attemptId === 'string' ? raw.attemptId : attempt.attemptId,
      attemptIndex: typeof raw.attemptIndex === 'number' ? raw.attemptIndex : attempt.attemptIndex,
    }
  })
}

function resolveAcceptanceContext(
  snapshot: CanvasSnapshot,
  task: CanvasTask,
): AcceptanceContext | null {
  const metadata = snapshot.project.metadata
  if (metadata?.projectKind !== 'acceptance') return null
  const runs = [
    ...(Array.isArray(metadata.acceptanceRuns) ? metadata.acceptanceRuns : []),
    metadata.latestAcceptanceRun,
  ].filter(isRecord)
  const run = [...runs]
    .reverse()
    .find((item) => item.boardId === task.boardId && typeof item.runId === 'string')
  if (!run || !isRecord(run.plan) || !Array.isArray(run.plan.cases)) return null
  const plan = run.plan as unknown as CanvasAcceptancePlan
  const caseNodeIds = isRecord(run.caseNodeIds)
    ? Object.fromEntries(
        Object.entries(run.caseNodeIds).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {}
  const matchedCaseId = Object.entries(caseNodeIds).find(
    ([, nodeId]) => nodeId === task.operationNodeId,
  )?.[0]
  const casePlan = plan.cases.find(
    (item) => item.caseId === matchedCaseId || item.title === task.title,
  )
  if (!casePlan) return null
  return {
    runId: run.runId as string,
    boardId: task.boardId,
    plan,
    caseNodeIds,
    casePlan,
  }
}

function buildAssertions(
  task: CanvasTask,
  casePlan: CanvasAcceptanceCasePlan,
  outputNodeCount: number,
  outputAssetCount: number,
): CanvasAcceptanceAssertion[] {
  const terminal = ['completed', 'failed', 'cancelled'].includes(task.status)
  const isText = casePlan.targetKind === 'text'
  const expectedTarget = casePlan.target
  const actualCallPresent = task.requestCall != null || task.rawResponse != null || task.submitResponse != null
  const assertions: CanvasAcceptanceAssertion[] = [
    assertion(
      'config.provider_profile',
      task.providerProfileId === expectedTarget?.providerProfileId,
      `Provider Profile ${task.providerProfileId ?? '(missing)'}`,
    ),
    assertion(
      'config.model',
      task.modelId === expectedTarget?.modelId,
      `Model ${task.modelId ?? '(missing)'}`,
    ),
    assertion('lifecycle.terminal', terminal, terminal ? `任务终态 ${task.status}` : `任务当前 ${task.status}`),
  ]
  if (task.status === 'completed') {
    assertions.push(
      assertion('evidence.actual_call', actualCallPresent, '实际调用或 Provider 响应证据'),
      assertion(
        'evidence.runtime_events',
        Boolean(task.runtimeEvents?.length),
        '任务生命周期事件',
      ),
      assertion(
        'canvas.output_materialized',
        outputNodeCount > 0,
        `画布产物节点 ${outputNodeCount}`,
      ),
      assertion(
        isText ? 'text.model_output' : 'canvas.output_asset',
        isText ? Boolean(task.modelOutputText?.trim()) : outputAssetCount > 0,
        isText ? '模型原始文本' : `画布产物资产 ${outputAssetCount}`,
      ),
    )
  }
  if (task.status === 'failed') {
    assertions.push(
      assertion(
        'evidence.failure_detail',
        Boolean(task.errorMsg || task.errorDetail),
        '失败错误码与详情',
      ),
      assertion(
        'evidence.failure_trace',
        actualCallPresent || Boolean(task.runtimeEvents?.length),
        '失败发生前的调用或生命周期依据',
      ),
    )
  }
  if (casePlan.blockedReasons.length > 0 && task.status !== 'pending') {
    assertions.push({
      id: 'preflight.blocked_case_executed',
      status: 'warned',
      message: `预检曾阻断：${casePlan.blockedReasons.join('、')}`,
    })
  }
  return assertions
}

function assertion(id: string, passed: boolean, message: string): CanvasAcceptanceAssertion {
  return { id, status: passed ? 'passed' : 'failed', message }
}

function inferEvidenceStage(task: CanvasTask): string {
  if (task.status === 'pending') return 'preflight'
  if (task.status === 'running') return task.requestId ? 'provider_processing' : 'submitting'
  if (task.status === 'completed') return 'materialized'
  if (task.status === 'cancelled') return 'cancelled'
  if (task.requestCall?.response) return 'provider_terminal'
  return 'failed'
}

export function sanitizeEvidence(value: unknown): unknown {
  return sanitizeValue(value, '', new WeakSet<object>())
}

function sanitizeValue(value: unknown, key: string, seen: WeakSet<object>): unknown {
  if (isSecretKey(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    const redacted = value
      .replace(BEARER_TOKEN_BLOCK, 'Bearer [REDACTED]')
      .replace(URL_SECRET_BLOCK, '$1?[REDACTED]')
    if (BASE64_BLOCK.test(redacted)) {
      return `[base64 omitted chars=${redacted.length}]`
    }
    return redacted.length > MAX_STRING_CHARS
      ? `${redacted.slice(0, MAX_STRING_CHARS)}…[truncated chars=${redacted.length}]`
      : redacted
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const result = value.slice(0, 200).map((item) => sanitizeValue(item, key, seen))
    seen.delete(value)
    return result
  }
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  const result: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeValue(childValue, childKey, seen)
  }
  seen.delete(value)
  return result
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.replace(/[-_]/g, '').toLowerCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
