import type { CanvasProject, CanvasSnapshot } from '../canvas.types'
import type {
  CanvasAcceptanceMaterializedRun,
  CanvasAcceptancePlan,
  CanvasAcceptanceSelection,
  CanvasAcceptanceWorkflowNode,
} from './canvasAcceptanceTypes'
import { compileCanvasAcceptancePlan } from './canvasAcceptancePlan'
import { buildCanvasAcceptanceWorkflowBlueprint } from './canvasAcceptanceWorkflow'

export const CANVAS_ACCEPTANCE_PROJECT_TITLE = '🧪 无限画布验收实验室'
export const CANVAS_ACCEPTANCE_SCHEMA_VERSION = 1
const MAX_ACCEPTANCE_RUNS_IN_METADATA = 50

type AcceptanceCanvasApi = {
  listProjects(): Promise<CanvasProject[]>
  createProject(input: { title: string; description?: string }): Promise<CanvasSnapshot>
  openSnapshot(projectId: string, boardId?: string | null): Promise<CanvasSnapshot>
  updateProjectMetadata(projectId: string, patch: Record<string, unknown>): Promise<CanvasSnapshot>
  createBoard(projectId: string, input?: { name?: string }): Promise<CanvasSnapshot>
  renameBoard(projectId: string, boardId: string, name: string): Promise<CanvasSnapshot>
  setActiveBoard(projectId: string, boardId: string): Promise<CanvasSnapshot>
  createTextNode(input: {
    projectId: string
    boardId: string
    text: string
    x: number
    y: number
    kind?: 'text' | 'prompt'
    format?: 'plain' | 'markdown' | 'prompt'
  }): Promise<CanvasSnapshot['nodes'][number]>
  patchNodes(
    projectId: string,
    nodeIds: string[],
    patch: Partial<CanvasSnapshot['nodes'][number]>,
  ): Promise<CanvasSnapshot>
  createOperationNode(input: {
    projectId: string
    boardId: string
    operation: NonNullable<CanvasAcceptanceWorkflowNode['operation']>
    inputNodeIds: string[]
    x: number
    y: number
    title?: string
    message?: string
    prompt?: string
    systemPrompt?: string
    modelParams?: Record<string, unknown>
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    taskPipelineRole?: CanvasAcceptanceWorkflowNode['taskPipelineRole']
    outputPipelineRole?: CanvasAcceptanceWorkflowNode['outputPipelineRole']
    outputTitle?: string
    shotScriptConfig?: { maxClipSec: number }
  }): Promise<CanvasSnapshot>
}

export async function materializeCanvasAcceptanceRun(input: {
  api: AcceptanceCanvasApi
  selection: CanvasAcceptanceSelection
  persist?: () => Promise<boolean>
  now?: () => Date
  randomId?: () => string
}): Promise<CanvasAcceptanceMaterializedRun> {
  const blueprint = buildCanvasAcceptanceWorkflowBlueprint(input.selection)
  const plan = compileCanvasAcceptancePlan({
    selection: input.selection,
    blueprint,
    ...(input.now ? { now: input.now } : {}),
    ...(input.randomId ? { randomId: input.randomId } : {}),
  })
  const { projectId, snapshot, created } = await ensureAcceptanceProject(input.api)
  const runBoardName = buildRunBoardName(plan)
  const runSnapshot = created
    ? await input.api.renameBoard(projectId, snapshot.board.id, runBoardName)
    : await input.api.createBoard(projectId, { name: runBoardName })
  const boardId = runSnapshot.activeBoardId ?? runSnapshot.board.id
  const refToNodeId = new Map<string, string>()
  const caseNodeIds: Record<string, string> = {}

  const summaryNode = await input.api.createTextNode({
    projectId,
    boardId,
    text: buildPlanSummary(plan),
    x: -420,
    y: -320,
    format: 'markdown',
  })
  await input.api.patchNodes(projectId, [summaryNode.id], {
    title: `🧪 验收计划 · ${plan.runId}`,
    locked: true,
  })

  for (const node of blueprint.nodes) {
    const inputNodeIds = node.inputRefs
      .map((ref) => refToNodeId.get(ref))
      .filter((id): id is string => Boolean(id))
    if (!node.operation) {
      const createdNode = await input.api.createTextNode({
        projectId,
        boardId,
        text: node.text ?? '',
        x: node.x,
        y: node.y,
        format: 'markdown',
      })
      await input.api.patchNodes(projectId, [createdNode.id], { title: node.title })
      refToNodeId.set(node.ref, createdNode.id)
      continue
    }

    const casePlan = plan.cases.find((item) => item.caseId === node.caseId)
    const target = casePlan?.target
    const operationSnapshot = await input.api.createOperationNode({
      projectId,
      boardId,
      operation: node.operation,
      inputNodeIds,
      x: node.x,
      y: node.y,
      title: node.title,
      message:
        casePlan && casePlan.blockedReasons.length > 0
          ? `验收预检阻断：${casePlan.blockedReasons.join('、')}`
          : `验收 Case ${node.caseId} · 等待手动运行`,
      ...(node.prompt ? { prompt: node.prompt } : {}),
      ...(node.systemPrompt ? { systemPrompt: node.systemPrompt } : {}),
      ...(node.modelParams ? { modelParams: node.modelParams } : {}),
      ...(target?.providerProfileId ? { providerProfileId: target.providerProfileId } : {}),
      ...(target?.manifestId ? { manifestId: target.manifestId } : {}),
      ...(target?.modelId ? { modelId: target.modelId } : {}),
      ...(node.taskPipelineRole ? { taskPipelineRole: node.taskPipelineRole } : {}),
      ...(node.outputPipelineRole ? { outputPipelineRole: node.outputPipelineRole } : {}),
      ...(node.outputTitle ? { outputTitle: node.outputTitle } : {}),
      ...(node.shotScriptConfig ? { shotScriptConfig: node.shotScriptConfig } : {}),
    })
    const createdNode = operationSnapshot.nodes.find(
      (item) => item.boardId === boardId && item.title === node.title,
    )
    if (!createdNode) throw new Error(`验收节点创建后无法定位：${node.caseId}`)
    refToNodeId.set(node.ref, createdNode.id)
    caseNodeIds[node.caseId] = createdNode.id
  }

  const acceptanceRun = {
    runId: plan.runId,
    boardId,
    createdAt: plan.createdAt,
    suite: plan.suite,
    executableCaseCount: plan.executableCaseCount,
    blockedCaseCount: plan.blockedCaseCount,
    highCostCaseCount: plan.highCostCaseCount,
    caseNodeIds,
    plan,
  }
  const previousRuns = readAcceptanceRunMetadata(snapshot.project.metadata)
  await input.api.updateProjectMetadata(projectId, {
    projectKind: 'acceptance',
    acceptanceSchemaVersion: CANVAS_ACCEPTANCE_SCHEMA_VERSION,
    acceptanceFixtureVersion: blueprint.fixtureVersion,
    latestAcceptanceRun: acceptanceRun,
    acceptanceRuns: [
      ...previousRuns.filter((run) => run.runId !== plan.runId),
      acceptanceRun,
    ].slice(-MAX_ACCEPTANCE_RUNS_IN_METADATA),
  })
  await input.api.setActiveBoard(projectId, boardId)
  if (input.persist) {
    const persisted = await input.persist()
    if (!persisted) throw new Error('验收画布已生成，但持久化到 SQLite 失败')
  }
  return { runId: plan.runId, projectId, boardId, caseNodeIds, plan }
}

async function ensureAcceptanceProject(
  api: AcceptanceCanvasApi,
): Promise<{ projectId: string; snapshot: CanvasSnapshot; created: boolean }> {
  const projects = await api.listProjects()
  const existing = projects.find((project) => project.metadata?.projectKind === 'acceptance')
  if (existing) {
    const snapshot = await api.openSnapshot(existing.id)
    return { projectId: existing.id, snapshot, created: false }
  }
  const snapshot = await api.createProject({
    title: CANVAS_ACCEPTANCE_PROJECT_TITLE,
    description: 'Dev 专属真实工作流验收项目。只有手动确认后才会调用真实渠道和模型。',
  })
  await api.updateProjectMetadata(snapshot.project.id, {
    projectKind: 'acceptance',
    acceptanceSchemaVersion: CANVAS_ACCEPTANCE_SCHEMA_VERSION,
  })
  return { projectId: snapshot.project.id, snapshot, created: true }
}

function readAcceptanceRunMetadata(
  metadata: Record<string, unknown> | undefined,
): Array<{ runId: string; [key: string]: unknown }> {
  const runs = Array.isArray(metadata?.acceptanceRuns) ? metadata.acceptanceRuns : []
  const latest = isRecord(metadata?.latestAcceptanceRun) ? [metadata.latestAcceptanceRun] : []
  const validRuns = [...runs, ...latest].filter(
    (run): run is { runId: string; [key: string]: unknown } =>
      isRecord(run) && typeof run.runId === 'string',
  )
  return Array.from(new Map(validRuns.map((run) => [run.runId, run])).values())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function buildRunBoardName(plan: CanvasAcceptancePlan): string {
  const at = new Date(plan.createdAt)
  const stamp = Number.isNaN(at.getTime())
    ? plan.createdAt
    : `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return `${stamp} · ${plan.suite} · ${plan.runId.slice(-8)}`
}

function buildPlanSummary(plan: CanvasAcceptancePlan): string {
  const blocked = plan.cases.filter((item) => item.blockedReasons.length > 0)
  return [
    `# 无限画布真实工作流验收`,
    ``,
    `- Run ID：${plan.runId}`,
    `- Suite：${plan.suite}`,
    `- Fixture：${plan.fixtureVersion}`,
    `- 创建时间：${plan.createdAt}`,
    `- 可执行 Case：${plan.executableCaseCount}`,
    `- 预检阻断：${plan.blockedCaseCount}`,
    `- 视频等高成本 Case：${plan.highCostCaseCount}`,
    `- 刷新恢复验证：${plan.verifyReload ? '开启' : '关闭'}`,
    `- 预览验证：${plan.verifyPreview ? '开启' : '关闭'}`,
    ``,
    `> 本画板只生成真实生产节点，不会自动调用模型。请检查节点配置后手动运行。`,
    ...(blocked.length > 0
      ? [
          ``,
          `## 调用前阻断`,
          ...blocked.map((item) => `- ${item.caseId}：${item.blockedReasons.join('、')}`),
        ]
      : []),
  ].join('\n')
}
