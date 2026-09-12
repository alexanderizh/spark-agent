import crypto from 'node:crypto'
import {
  SessionWorkflowBindingRepository,
  WorkflowRepository,
  WorkflowRunRepository,
  type AgentItem,
  type SessionWorkflowBinding,
  type WorkflowItem,
  type WorkflowRunRow,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { WorkflowExecutionSource } from '@spark/protocol'
import { createLogger, SparkError } from '@spark/shared'
import { normalizeWorkflowGraph, type NormalizedWorkflowGraph } from '../workflow-executor.js'
import type { WorkflowExecutionMode } from '../workflow-system-prompt.js'
import type { AgentAdapterKind } from '../session/engine-kinds.js'
import type { ResumeGateManager } from '../session-resume-gate.js'
import {
  buildCodexNativeThreadIdentityScope,
  scopeCodexNativeThreadBindingKey,
  scopeRuntimeSessionIdentity,
} from '../session/codex-native-thread-binding.js'
import { hasWorkflowExecutableNodes } from '../session-workflow-helpers.js'
import { resolveWorkflowExecutionModeCapability } from './workflow-execution-mode.js'

const log = createLogger('workflow:effective-resolver')

type BindingReader = Pick<SessionWorkflowBindingRepository, 'get'>
type WorkflowReader = Pick<WorkflowRepository, 'get'>
type WorkflowRunReader = Pick<
  WorkflowRunRepository,
  'findLatestResumable' | 'findLatestResumableByBinding'
>

export type EffectiveWorkflowExecutionMode = WorkflowExecutionMode | 'none'
export type EffectiveWorkflowGraphSource = 'definition' | 'resumable-run' | 'none'

export interface EffectiveWorkflowExecutionContext {
  source: WorkflowExecutionSource
  bindingInstanceId: string | null
  hostAgentId: string
  workflowId: string | null
  workflowName: string | null
  workflowVersion: string | null
  workflowStatus: 'draft' | 'active' | 'archived' | null
  workflowEnabled: boolean | null
  graph: NormalizedWorkflowGraph | null
  graphDigest: string | null
  graphSource: EffectiveWorkflowGraphSource
  resumableRunId: string | null
  executionMode: EffectiveWorkflowExecutionMode
  workflowMemberSignatures: string[]
  runtimeIdentity: WorkflowRuntimeIdentitySnapshot
}

export interface WorkflowRuntimeIdentitySnapshot {
  stableSdkSessionId: string
  turnSdkSessionId: string
  codexNativeThreadBindingKey: string
  sparkLedgerBindingKey: string
}

export interface WorkflowRuntimeIdentityInput {
  makeRuntimeSessionId: ResumeGateManager['makeRuntimeSessionId']
  sessionId: string
  providerProfileId: string
  model: string
  agentAdapter: AgentAdapterKind
  turnId: string
  nativeThreadGeneration: number
  agentId: string
  isMentionTurn: boolean
}

export interface ResolveEffectiveWorkflowInput {
  sessionId: string
  hostAgent: Pick<AgentItem, 'id' | 'workflowId'>
  isMentionTurn: boolean
  agentAdapter: AgentAdapterKind
  resolveWorkflowMembers: (graph: NormalizedWorkflowGraph) => readonly AgentItem[]
  runtimeIdentity: WorkflowRuntimeIdentityInput
  /**
   * Shadow mode may reuse the legacy definition already read by SessionService,
   * avoiding a second workflow query for the compatibility path.
   */
  legacyWorkflow?: WorkflowItem | null
  legacyGraph?: NormalizedWorkflowGraph | null
}

export class EffectiveWorkflowResolver {
  constructor(
    private readonly bindingReader: BindingReader,
    private readonly workflowReader: WorkflowReader,
    private readonly workflowRunReader?: WorkflowRunReader,
  ) {}

  resolve(input: ResolveEffectiveWorkflowInput): EffectiveWorkflowExecutionContext {
    const binding = input.isMentionTurn ? null : this.bindingReader.get(input.sessionId)
    const selection = selectWorkflow(
      input.hostAgent.workflowId ?? null,
      binding,
      input.isMentionTurn,
    )
    if (selection.source === 'session-disabled') {
      return {
        source: selection.source,
        bindingInstanceId: selection.bindingInstanceId,
        hostAgentId: input.hostAgent.id,
        workflowId: null,
        workflowName: null,
        workflowVersion: null,
        workflowStatus: null,
        workflowEnabled: null,
        graph: null,
        graphDigest: null,
        graphSource: 'none',
        resumableRunId: null,
        executionMode: 'none',
        workflowMemberSignatures: [],
        runtimeIdentity: buildWorkflowRuntimeIdentitySnapshot(
          input.runtimeIdentity,
          selection.bindingInstanceId,
        ),
      }
    }

    const canReuseLegacyDefinition =
      selection.source === 'legacy-agent' || selection.source === 'none'
    const workflow =
      selection.workflowId == null
        ? null
        : canReuseLegacyDefinition && Object.hasOwn(input, 'legacyWorkflow')
          ? (input.legacyWorkflow ?? null)
          : this.workflowReader.get(selection.workflowId)
    if (selection.bindingInstanceId != null && selection.workflowId != null && workflow == null) {
      throwWorkflowRuntimeIssue('workflow_not_found')
    }
    if (selection.bindingInstanceId != null && workflow?.enabled === false) {
      throwWorkflowRuntimeIssue('workflow_disabled')
    }
    const resumableRun = this.resolveResumableRun(input.sessionId, selection)
    if (
      selection.bindingInstanceId != null &&
      workflow != null &&
      (workflow.status === 'draft' || (workflow.status === 'archived' && resumableRun == null))
    ) {
      throwWorkflowRuntimeIssue('workflow_not_active', undefined, workflow.status)
    }
    const definitionGraph =
      workflow == null
        ? null
        : canReuseLegacyDefinition && Object.hasOwn(input, 'legacyGraph')
          ? (input.legacyGraph ?? null)
          : normalizeWorkflowGraph(workflow.graph)
    const graph =
      resumableRun == null ? definitionGraph : parseFrozenWorkflowGraphSnapshot(resumableRun)
    const effectiveWorkflow =
      workflow == null
        ? null
        : {
            ...workflow,
            ...(resumableRun?.workflow_name_snapshot != null
              ? { name: resumableRun.workflow_name_snapshot }
              : {}),
            ...(resumableRun?.workflow_version_snapshot != null
              ? { version: resumableRun.workflow_version_snapshot }
              : {}),
            ...(graph != null ? { graph: graph as unknown as Record<string, unknown> } : {}),
          }
    const workflowMembers = graph == null ? [] : input.resolveWorkflowMembers(graph)
    const workflowMemberIds = workflowMembers.map((member) => member.id)
    const managedExecutorAvailable =
      graph != null &&
      hasWorkflowExecutableNodes(graph, new Set(workflowMemberIds), input.hostAgent.id)
    return {
      source: selection.source,
      bindingInstanceId: selection.bindingInstanceId,
      hostAgentId: input.hostAgent.id,
      workflowId: selection.workflowId,
      workflowName: effectiveWorkflow?.name ?? null,
      workflowVersion: effectiveWorkflow?.version ?? null,
      workflowStatus: workflow?.status ?? null,
      workflowEnabled: workflow?.enabled ?? null,
      graph,
      graphDigest: graph == null ? null : digestNormalizedWorkflowGraph(graph),
      graphSource: graph == null ? 'none' : resumableRun == null ? 'definition' : 'resumable-run',
      resumableRunId: resumableRun?.id ?? null,
      executionMode:
        selection.workflowId == null
          ? 'none'
          : resolveWorkflowExecutionModeCapability({
              agentAdapter: input.agentAdapter,
              hasWorkflowGraph: graph != null,
              managedExecutorAvailable,
              isMentionTurn: input.isMentionTurn,
            }),
      workflowMemberSignatures: buildWorkflowMemberExecutionSignatures(workflowMembers),
      runtimeIdentity: buildWorkflowRuntimeIdentitySnapshot(
        input.runtimeIdentity,
        selection.bindingInstanceId,
      ),
    }
  }

  private resolveResumableRun(
    sessionId: string,
    selection: WorkflowSelection,
  ): WorkflowRunRow | null {
    if (this.workflowRunReader == null || selection.workflowId == null) return null
    return selection.bindingInstanceId == null
      ? this.workflowRunReader.findLatestResumable(sessionId, selection.workflowId)
      : this.workflowRunReader.findLatestResumableByBinding(
          sessionId,
          selection.bindingInstanceId,
          selection.workflowId,
        )
  }
}

export function parseFrozenWorkflowGraphSnapshot(row: WorkflowRunRow): NormalizedWorkflowGraph {
  let raw: unknown
  try {
    raw = JSON.parse(row.graph_json)
  } catch {
    throwWorkflowRuntimeIssue('workflow_run_snapshot_invalid', row.id)
  }
  if (
    raw == null ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as Record<string, unknown>).nodes) ||
    !Array.isArray((raw as Record<string, unknown>).edges)
  ) {
    throwWorkflowRuntimeIssue('workflow_run_snapshot_invalid', row.id)
  }
  const graph = normalizeWorkflowGraph(raw as Record<string, unknown>)
  if (
    row.workflow_graph_digest != null &&
    digestNormalizedWorkflowGraph(graph) !== row.workflow_graph_digest
  ) {
    throwWorkflowRuntimeIssue('workflow_run_snapshot_invalid', row.id)
  }
  return graph
}

function throwWorkflowRuntimeIssue(
  code:
    | 'workflow_not_found'
    | 'workflow_disabled'
    | 'workflow_not_active'
    | 'workflow_run_snapshot_invalid',
  runId?: string,
  status?: 'draft' | 'archived',
): never {
  throw new SparkError('VALIDATION_FAILED', '会话工作流当前不可执行。', {
    issues: [
      {
        code,
        ...(runId != null || status != null
          ? {
              params: {
                ...(runId != null ? { runId } : {}),
                ...(status != null ? { status } : {}),
              },
            }
          : {}),
      },
    ],
  })
}

export function buildWorkflowMemberExecutionSignatures(members: readonly AgentItem[]): string[] {
  return members
    .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...effectiveMember }) => effectiveMember)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((member) => crypto.createHash('sha256').update(stableStringify(member)).digest('hex'))
}

export function buildWorkflowRuntimeIdentitySnapshot(
  input: WorkflowRuntimeIdentityInput,
  bindingInstanceId: string | null = null,
): WorkflowRuntimeIdentitySnapshot {
  const stableBaseScope = input.isMentionTurn ? `mention:${input.agentId}` : undefined
  const stableScope = scopeRuntimeSessionIdentity(
    scopeWorkflowBindingIdentity(stableBaseScope, bindingInstanceId),
    input.nativeThreadGeneration,
  )
  const stableSdkSessionId = input.makeRuntimeSessionId(
    input.sessionId,
    input.providerProfileId,
    input.model,
    input.agentAdapter,
    stableScope,
  )
  const turnBaseScope = input.isMentionTurn
    ? `mention:${input.agentId}:${input.turnId}`
    : input.turnId
  const turnSdkSessionId = input.makeRuntimeSessionId(
    input.sessionId,
    input.providerProfileId,
    input.model,
    input.agentAdapter,
    scopeWorkflowBindingIdentity(turnBaseScope, bindingInstanceId),
  )
  const nativeScope = scopeWorkflowBindingIdentity(
    buildCodexNativeThreadIdentityScope({
      agentId: input.agentId,
      isMentionTurn: input.isMentionTurn,
    }),
    bindingInstanceId,
  )
  const codexNativeThreadBindingKey = scopeCodexNativeThreadBindingKey(
    input.makeRuntimeSessionId(
      input.sessionId,
      input.providerProfileId,
      input.model,
      input.agentAdapter,
      nativeScope,
    ),
    input.nativeThreadGeneration,
  )
  return {
    stableSdkSessionId,
    turnSdkSessionId,
    codexNativeThreadBindingKey,
    sparkLedgerBindingKey: stableSdkSessionId,
  }
}

function scopeWorkflowBindingIdentity(
  baseScope: string | undefined,
  bindingInstanceId: string | null,
): string | undefined {
  if (bindingInstanceId == null) return baseScope
  return baseScope == null
    ? `workflow-binding:${bindingInstanceId}`
    : `${baseScope}:workflow-binding:${bindingInstanceId}`
}

interface WorkflowSelection {
  source: WorkflowExecutionSource
  bindingInstanceId: string | null
  workflowId: string | null
}

function selectWorkflow(
  hostWorkflowId: string | null,
  binding: SessionWorkflowBinding | null,
  isMentionTurn: boolean,
): WorkflowSelection {
  if (isMentionTurn || binding == null) {
    return {
      source: hostWorkflowId == null ? 'none' : 'legacy-agent',
      bindingInstanceId: null,
      workflowId: hostWorkflowId,
    }
  }
  if (binding.mode === 'disabled') {
    return {
      source: 'session-disabled',
      bindingInstanceId: binding.bindingInstanceId,
      workflowId: null,
    }
  }
  return {
    source: binding.mode === 'override' ? 'session-override' : 'session-inherit',
    bindingInstanceId: binding.bindingInstanceId,
    workflowId: binding.mode === 'override' ? binding.workflowId : hostWorkflowId,
  }
}

export function digestNormalizedWorkflowGraph(graph: NormalizedWorkflowGraph): string {
  return crypto.createHash('sha256').update(stableStringify(graph)).digest('hex')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item))
  if (value == null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, sortJsonValue(record[key])]),
  )
}

export interface LegacyWorkflowResolutionSnapshot {
  source: 'legacy-agent' | 'none'
  hostAgentId: string
  workflowId: string | null
  workflowName: string | null
  workflowVersion: string | null
  workflowStatus: 'draft' | 'active' | 'archived' | null
  workflowEnabled: boolean | null
  graphDigest: string | null
  graphSource: 'definition' | 'none'
  executionMode: WorkflowExecutionMode
  workflowMemberSignatures: string[]
  runtimeIdentity: WorkflowRuntimeIdentitySnapshot
}

export type WorkflowShadowObservation =
  | { status: 'equivalent'; mismatchFields: [] }
  | { status: 'mismatch'; mismatchFields: string[] }
  | { status: 'binding-present'; source: WorkflowExecutionSource }
  | { status: 'skipped-mention' }
  | { status: 'failed'; errorName: string }

interface WorkflowShadowLogger {
  debug(message: string, meta: Record<string, unknown>): void
  warn(message: string, meta: Record<string, unknown>): void
}

export interface ObserveEffectiveWorkflowShadowInput {
  db: SparkDatabase
  sessionId: string
  hostAgent: Pick<AgentItem, 'id' | 'workflowId'>
  isMentionTurn: boolean
  agentAdapter: AgentAdapterKind
  legacyWorkflowMembers: readonly AgentItem[]
  resolveWorkflowMembers: (graph: NormalizedWorkflowGraph) => readonly AgentItem[]
  runtimeIdentity: WorkflowRuntimeIdentityInput
  legacyRuntimeIdentity: WorkflowRuntimeIdentitySnapshot
  legacyWorkflow: WorkflowItem | null
  legacyGraph: NormalizedWorkflowGraph | null
  legacyExecutionMode: WorkflowExecutionMode
  observer?: WorkflowShadowLogger
}

/**
 * Resolve the future binding-aware context without applying it. Failures and
 * mismatches are observable only; the caller keeps using the legacy variables.
 */
export function observeEffectiveWorkflowResolutionShadow(
  input: ObserveEffectiveWorkflowShadowInput,
): WorkflowShadowObservation {
  if (input.isMentionTurn) return { status: 'skipped-mention' }
  const observer = input.observer ?? log
  try {
    const shadow = new EffectiveWorkflowResolver(
      new SessionWorkflowBindingRepository(input.db),
      new WorkflowRepository(input.db),
    ).resolve({
      sessionId: input.sessionId,
      hostAgent: input.hostAgent,
      isMentionTurn: false,
      agentAdapter: input.agentAdapter,
      resolveWorkflowMembers: input.resolveWorkflowMembers,
      runtimeIdentity: input.runtimeIdentity,
      legacyWorkflow: input.legacyWorkflow,
      legacyGraph: input.legacyGraph,
    })
    if (shadow.bindingInstanceId != null) {
      observer.debug('workflow resolver shadow observed binding without applying it', {
        sessionId: input.sessionId,
        source: shadow.source,
      })
      return { status: 'binding-present', source: shadow.source }
    }

    const legacy = buildLegacyWorkflowResolutionSnapshot(input)
    const mismatchFields = compareLegacyWorkflowResolution(legacy, shadow)
    if (mismatchFields.length > 0) {
      observer.warn('workflow resolver shadow mismatch; legacy result remains authoritative', {
        sessionId: input.sessionId,
        mismatchFields,
      })
      return { status: 'mismatch', mismatchFields }
    }
    observer.debug('workflow resolver shadow matched legacy resolution', {
      sessionId: input.sessionId,
      source: shadow.source,
    })
    return { status: 'equivalent', mismatchFields: [] }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : typeof error
    observer.warn('workflow resolver shadow failed; legacy result remains authoritative', {
      sessionId: input.sessionId,
      errorName,
    })
    return { status: 'failed', errorName }
  }
}

function buildLegacyWorkflowResolutionSnapshot(
  input: ObserveEffectiveWorkflowShadowInput,
): LegacyWorkflowResolutionSnapshot {
  const workflowId = input.hostAgent.workflowId ?? null
  return {
    source: workflowId == null ? 'none' : 'legacy-agent',
    hostAgentId: input.hostAgent.id,
    workflowId,
    workflowName: input.legacyWorkflow?.name ?? null,
    workflowVersion: input.legacyWorkflow?.version ?? null,
    workflowStatus: input.legacyWorkflow?.status ?? null,
    workflowEnabled: input.legacyWorkflow?.enabled ?? null,
    graphDigest:
      input.legacyGraph == null ? null : digestNormalizedWorkflowGraph(input.legacyGraph),
    graphSource: input.legacyGraph == null ? 'none' : 'definition',
    executionMode: input.legacyExecutionMode,
    workflowMemberSignatures: buildWorkflowMemberExecutionSignatures(input.legacyWorkflowMembers),
    runtimeIdentity: input.legacyRuntimeIdentity,
  }
}

export function compareLegacyWorkflowResolution(
  legacy: LegacyWorkflowResolutionSnapshot,
  shadow: EffectiveWorkflowExecutionContext,
): string[] {
  const comparable = {
    source: shadow.source,
    hostAgentId: shadow.hostAgentId,
    workflowId: shadow.workflowId,
    workflowName: shadow.workflowName,
    workflowVersion: shadow.workflowVersion,
    workflowStatus: shadow.workflowStatus,
    workflowEnabled: shadow.workflowEnabled,
    graphDigest: shadow.graphDigest,
    graphSource: shadow.graphSource,
    executionMode:
      shadow.source === 'none' && shadow.executionMode === 'none' ? 'guided' : shadow.executionMode,
    workflowMemberSignatures: shadow.workflowMemberSignatures,
    runtimeIdentity: shadow.runtimeIdentity,
  }
  const mismatchFields: string[] = (
    [
      'source',
      'hostAgentId',
      'workflowId',
      'workflowName',
      'workflowVersion',
      'workflowStatus',
      'workflowEnabled',
      'graphDigest',
      'graphSource',
      'executionMode',
    ] as const
  ).filter((key) => legacy[key] !== comparable[key])
  if (
    legacy.workflowMemberSignatures.join('\0') !== comparable.workflowMemberSignatures.join('\0')
  ) {
    mismatchFields.push('workflowMemberSignatures')
  }
  for (const key of Object.keys(legacy.runtimeIdentity) as Array<
    keyof WorkflowRuntimeIdentitySnapshot
  >) {
    if (legacy.runtimeIdentity[key] !== comparable.runtimeIdentity[key]) {
      mismatchFields.push(`runtimeIdentity.${key}`)
    }
  }
  return mismatchFields
}
