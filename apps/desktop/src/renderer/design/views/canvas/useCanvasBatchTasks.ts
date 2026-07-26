import { useRef, useSyncExternalStore } from 'react'
import {
  buildCanvasBatchNodeUpdates,
  createCanvasBatchTaskSession,
  findStaleCanvasBatchNodeIds,
  patchCanvasBatchTaskGroup,
  patchCanvasBatchTaskNode,
  planCanvasBatchTaskFlow,
  rebaseCanvasBatchTaskSession,
  refreshCanvasBatchTaskSession,
  type CanvasBatchTaskPatch,
  type CanvasBatchTaskSession,
} from './canvasBatchTaskModel'
import {
  readSkipCanvasBatchSubmitConfirmation,
  writeSkipCanvasBatchSubmitConfirmation,
} from './canvasBatchSubmitPreferences'
import {
  readSkipCanvasParameterValidation,
  writeSkipCanvasParameterValidation,
} from './canvasParameterValidationPreferences'
import {
  prepareSavedCanvasOperationSubmission,
  type PreparedCanvasOperationSubmission,
  type SavedCanvasOperationRunParams,
} from './canvasOperationSubmission'
import { CanvasTaskValidationError } from './canvasTaskSubmissionValidation'
import { confirmCanvasTaskValidation } from './canvasTaskValidationWarning'
import type {
  CanvasNode,
  CanvasNodeData,
  CanvasOperationType,
  CanvasSnapshot,
} from './canvas.types'

export type CanvasBatchPanelMode = 'closed' | 'configure' | 'confirm' | 'submitting' | 'result'

export type CanvasBatchValidationIssue = {
  nodeId: string
  fieldPath: Array<string | number>
  message: string
}

export type CanvasBatchSubmitResult = {
  nodeId: string
  batchId: string
  status: 'succeeded' | 'failed'
  error?: string
}

export type CanvasBatchTaskState = {
  mode: CanvasBatchPanelMode
  session: CanvasBatchTaskSession | null
  issues: CanvasBatchValidationIssue[]
  validationWarnings: CanvasBatchValidationIssue[]
  results: CanvasBatchSubmitResult[]
  skipNextConfirmation: boolean
  skipParameterValidation: boolean
  saving: boolean
}

export type CanvasBatchTaskControllerDependencies = {
  getSnapshot: () => CanvasSnapshot | null
  updateManyNodeData: (
    updates: Array<{ nodeId: string; data: Partial<CanvasNodeData> }>,
  ) => Promise<CanvasSnapshot | void>
  runOperationNode: (
    nodeId: string,
    params: SavedCanvasOperationRunParams,
  ) => Promise<CanvasSnapshot | void>
  waitForTask?: (taskId: string) => Promise<void>
  prepareSubmission?: (
    input: Parameters<typeof prepareSavedCanvasOperationSubmission>[0],
    options?: { skipParameterValidation?: boolean },
  ) => Promise<PreparedCanvasOperationSubmission>
  readSkipConfirmation?: () => boolean
  writeSkipConfirmation?: (skip: boolean) => void
  readSkipParameterValidation?: () => boolean
  writeSkipParameterValidation?: (skip: boolean) => void
  confirmParameterValidation?: typeof confirmCanvasTaskValidation
  createBatchId?: () => string
  onSingleValidationError?: (nodeId: string, error: unknown) => void
}

export type CanvasBatchTaskController = ReturnType<typeof createCanvasBatchTaskController>

const INITIAL_STATE: CanvasBatchTaskState = {
  mode: 'closed',
  session: null,
  issues: [],
  validationWarnings: [],
  results: [],
  skipNextConfirmation: false,
  skipParameterValidation: false,
  saving: false,
}

const BATCH_TASK_CONCURRENCY = 3

export function createCanvasBatchTaskController(
  inputDependencies: CanvasBatchTaskControllerDependencies,
) {
  let dependencies = withDefaults(inputDependencies)
  let state: CanvasBatchTaskState = INITIAL_STATE
  let preparedSubmissions: PreparedCanvasOperationSubmission[] = []
  let flowLayers: string[][] = []
  let sessionGeneration = 0
  const listeners = new Set<() => void>()

  const setState = (
    next: CanvasBatchTaskState | ((current: CanvasBatchTaskState) => CanvasBatchTaskState),
  ) => {
    state = typeof next === 'function' ? next(state) : next
    for (const listener of listeners) listener()
  }

  const requireSnapshot = (): CanvasSnapshot => {
    const snapshot = dependencies.getSnapshot()
    if (!snapshot) throw new Error('画布尚未加载')
    return snapshot
  }

  const openConfigure = (nodeIds: string[]) => {
    const snapshot = requireSnapshot()
    const selected = selectNodes(snapshot, nodeIds)
    sessionGeneration += 1
    setState({
      ...INITIAL_STATE,
      mode: 'configure',
      session: createCanvasBatchTaskSession(selected),
    })
    preparedSubmissions = []
    flowLayers = []
  }

  const patchGroup = (operation: CanvasOperationType, patch: CanvasBatchTaskPatch) => {
    if (!state.session) return
    setState({
      ...state,
      session: patchCanvasBatchTaskGroup(state.session, operation, patch),
      issues: [],
    })
  }

  const patchNode = (nodeId: string, patch: CanvasBatchTaskPatch) => {
    if (!state.session) return
    setState({
      ...state,
      session: patchCanvasBatchTaskNode(state.session, nodeId, patch),
      issues: [],
    })
  }

  const saveDrafts = async (): Promise<CanvasSnapshot> => {
    const session = state.session
    if (!session || state.saving) return requireSnapshot()
    const generation = sessionGeneration
    const currentSnapshot = requireSnapshot()
    const staleNodeIds = findStaleCanvasBatchNodeIds(session, currentSnapshot.nodes)
    if (staleNodeIds.length > 0) {
      const currentNodeIds = new Set(currentSnapshot.nodes.map((node) => node.id))
      const issues = staleNodeIds.map((nodeId) => ({
        nodeId,
        fieldPath: [],
        message: currentNodeIds.has(nodeId)
          ? '节点配置已变化，已合并最新值，请检查后重试'
          : '任务节点已被删除',
      }))
      const refreshedSession = refreshCanvasBatchTaskSession(session, currentSnapshot.nodes)
      const firstStaleEntry = refreshedSession.entries.find(
        (entry) => entry.nodeId === staleNodeIds[0],
      )
      setState({
        ...state,
        issues,
        session: firstStaleEntry
          ? {
              ...refreshedSession,
              activeOperation: firstStaleEntry.operation,
              activeNodeId: firstStaleEntry.nodeId,
            }
          : refreshedSession,
      })
      throw new Error(issues[0]?.message ?? '节点配置已变化，请重新检查')
    }
    const updates = buildCanvasBatchNodeUpdates(session)
    setState({ ...state, saving: true })
    try {
      const updatedSnapshot =
        updates.length > 0 ? await dependencies.updateManyNodeData(updates) : undefined
      const snapshot = updatedSnapshot ?? requireSnapshot()
      if (generation !== sessionGeneration) return snapshot
      const rebasedSession = rebaseCanvasBatchTaskSession(session, snapshot.nodes)
      setState({ ...state, session: rebasedSession, issues: [], saving: false })
      return snapshot
    } catch (error) {
      if (generation === sessionGeneration) setState({ ...state, saving: false })
      throw error
    }
  }

  const collectPreflight = async (snapshot: CanvasSnapshot, generation: number) => {
    const session = state.session
    if (!session || generation !== sessionGeneration) return
    const planned = planCanvasBatchTaskFlow(session, snapshot.edges)
    if (!planned.ok) {
      preparedSubmissions = []
      flowLayers = []
      setState({
        ...state,
        mode: 'configure',
        issues: planned.nodeIds.map((nodeId) => ({
          nodeId,
          fieldPath: [],
          message: planned.message,
        })),
        validationWarnings: [],
      })
      return
    }
    flowLayers = planned.layers
    const firstLayer = planned.layers[0] ?? []
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
    const results = await runWithConcurrency(
      session.entries.filter((entry) => firstLayer.includes(entry.nodeId)),
      BATCH_TASK_CONCURRENCY,
      async (entry) => {
        const node = nodeById.get(entry.nodeId)
        if (!node) {
          return {
            blockingIssues: [
              {
                nodeId: entry.nodeId,
                fieldPath: [],
                message: '任务节点已被删除',
              },
            ],
            validationWarnings: [],
          }
        }
        try {
          const skipParameterValidation = dependencies.readSkipParameterValidation()
          return {
            prepared: await dependencies.prepareSubmission(
              { snapshot, node },
              skipParameterValidation ? { skipParameterValidation: true } : undefined,
            ),
            validationWarnings: [],
            blockingIssues: [],
          }
        } catch (error) {
          if (error instanceof CanvasTaskValidationError) {
            try {
              return {
                prepared: await dependencies.prepareSubmission(
                  { snapshot, node },
                  { skipParameterValidation: true },
                ),
                validationWarnings: issuesFromError(entry.nodeId, error),
                blockingIssues: [],
              }
            } catch (retryError) {
              return {
                validationWarnings: [],
                blockingIssues: issuesFromError(entry.nodeId, retryError),
              }
            }
          }
          return {
            validationWarnings: [],
            blockingIssues: issuesFromError(entry.nodeId, error),
          }
        }
      },
    )
    if (generation !== sessionGeneration) return
    const issues = results.flatMap((result) => result.blockingIssues ?? [])
    const validationWarnings = results.flatMap((result) => result.validationWarnings ?? [])
    if (issues.length > 0) {
      preparedSubmissions = []
      const firstIssueEntry = session.entries.find((entry) => entry.nodeId === issues[0]?.nodeId)
      setState({
        ...state,
        mode: 'configure',
        issues,
        validationWarnings: [],
        session: firstIssueEntry
          ? {
              ...session,
              activeOperation: firstIssueEntry.operation,
              activeNodeId: firstIssueEntry.nodeId,
            }
          : session,
      })
      return
    }
    preparedSubmissions = results.flatMap((result) => (result.prepared ? [result.prepared] : []))
    if (dependencies.readSkipConfirmation()) {
      if (validationWarnings.length > 0) {
        setState({
          ...state,
          mode: 'confirm',
          issues: [],
          validationWarnings,
          skipNextConfirmation: false,
          skipParameterValidation: false,
        })
        return
      }
      await executePrepared(preparedSubmissions, dependencies.createBatchId(), generation)
      return
    }
    setState({
      ...state,
      mode: 'confirm',
      issues: [],
      validationWarnings,
      skipNextConfirmation: false,
      skipParameterValidation: false,
    })
  }

  const submit = async () => {
    if (state.mode !== 'configure' || state.saving) return
    const generation = sessionGeneration
    const snapshot = await saveDrafts()
    if (generation !== sessionGeneration) return
    setState({ ...state, mode: 'submitting' })
    await collectPreflight(snapshot, generation)
  }

  const openSubmit = async (nodeIds: string[]) => {
    openConfigure(nodeIds)
    await submit()
  }

  const runPreparedSubmissions = (
    submissions: PreparedCanvasOperationSubmission[],
    batchId: string,
  ) =>
    runWithConcurrency(
      submissions,
      BATCH_TASK_CONCURRENCY,
      async (submission): Promise<CanvasBatchSubmitResult> => {
        try {
          const submittedSnapshot = await dependencies.runOperationNode(
            submission.nodeId,
            submission.params,
          )
          const taskId = resolveSubmittedTaskId(
            submittedSnapshot ?? dependencies.getSnapshot(),
            submission.nodeId,
          )
          if (taskId) await dependencies.waitForTask(taskId)
          return {
            nodeId: submission.nodeId,
            batchId,
            status: 'succeeded',
          }
        } catch (error) {
          return {
            nodeId: submission.nodeId,
            batchId,
            status: 'failed',
            error: errorMessage(error),
          }
        }
      },
    )

  const executePrepared = async (
    submissions: PreparedCanvasOperationSubmission[],
    batchId: string,
    generation = sessionGeneration,
  ) => {
    if (generation !== sessionGeneration) return
    setState({ ...state, mode: 'submitting', issues: [], validationWarnings: [] })
    const nextResults = await runPreparedFlow(submissions, batchId, generation)
    if (generation !== sessionGeneration) return
    setState({ ...state, mode: 'result', results: nextResults })
  }

  const prepareLayerSubmissions = async (
    nodeIds: string[],
  ): Promise<PreparedCanvasOperationSubmission[]> => {
    const snapshot = requireSnapshot()
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
    const skipParameterValidation = dependencies.readSkipParameterValidation()
    return runWithConcurrency(nodeIds, BATCH_TASK_CONCURRENCY, async (nodeId) => {
      const node = nodeById.get(nodeId)
      if (!node) throw new Error(`任务节点已被删除：${nodeId}`)
      return dependencies.prepareSubmission(
        { snapshot, node },
        skipParameterValidation ? { skipParameterValidation: true } : undefined,
      )
    })
  }

  const runPreparedFlow = async (
    initialSubmissions: PreparedCanvasOperationSubmission[],
    batchId: string,
    generation: number,
  ): Promise<CanvasBatchSubmitResult[]> => {
    const plannedLayers =
      flowLayers.length > 0
        ? flowLayers
        : [initialSubmissions.map((submission) => submission.nodeId)]
    return runFlowLayers(plannedLayers, initialSubmissions, batchId, generation)
  }

  const runFlowLayers = async (
    plannedLayers: string[][],
    initialSubmissions: PreparedCanvasOperationSubmission[],
    batchId: string,
    generation: number,
  ): Promise<CanvasBatchSubmitResult[]> => {
    const results: CanvasBatchSubmitResult[] = []
    const initialByNodeId = new Map(
      initialSubmissions.map((submission) => [submission.nodeId, submission]),
    )

    for (const layer of plannedLayers) {
      if (generation !== sessionGeneration) return results
      const preparedLayer = await runWithConcurrency(
        layer,
        BATCH_TASK_CONCURRENCY,
        async (
          nodeId,
        ): Promise<
          | { ok: true; submission: PreparedCanvasOperationSubmission }
          | { ok: false; result: CanvasBatchSubmitResult }
        > => {
          const initial = initialByNodeId.get(nodeId)
          if (initial) return { ok: true, submission: initial }
          try {
            const [prepared] = await prepareLayerSubmissions([nodeId])
            if (!prepared) throw new Error(`任务节点无法准备：${nodeId}`)
            preparedSubmissions = [
              ...preparedSubmissions.filter((item) => item.nodeId !== nodeId),
              prepared,
            ]
            return { ok: true, submission: prepared }
          } catch (error) {
            return {
              ok: false,
              result: {
                nodeId,
                batchId,
                status: 'failed',
                error: errorMessage(error),
              },
            }
          }
        },
      )
      const preparationFailures = preparedLayer.flatMap((item) => (item.ok ? [] : [item.result]))
      if (preparationFailures.length > 0) {
        results.push(...preparationFailures)
        break
      }
      const submissions = preparedLayer.flatMap((item) => (item.ok ? [item.submission] : []))
      const layerResults = await runPreparedSubmissions(submissions, batchId)
      results.push(...layerResults)
      if (layerResults.some((result) => result.status === 'failed')) break
    }
    return orderResultsBySession(results)
  }

  const orderResultsBySession = (results: CanvasBatchSubmitResult[]): CanvasBatchSubmitResult[] => {
    const resultByNodeId = new Map(results.map((result) => [result.nodeId, result]))
    const orderedNodeIds =
      state.session?.entries.map((entry) => entry.nodeId) ?? results.map((result) => result.nodeId)
    return orderedNodeIds.flatMap((nodeId) => {
      const result = resultByNodeId.get(nodeId)
      return result ? [result] : []
    })
  }

  const confirmSubmit = async () => {
    if (state.mode !== 'confirm' || !state.session) return
    const generation = sessionGeneration
    const snapshot = requireSnapshot()
    const staleNodeIds = findStaleCanvasBatchNodeIds(state.session, snapshot.nodes)
    if (staleNodeIds.length > 0) {
      setState({
        ...state,
        mode: 'configure',
        validationWarnings: [],
        issues: staleNodeIds.map((nodeId) => ({
          nodeId,
          fieldPath: [],
          message: '节点配置已变化，请重新检查后提交',
        })),
      })
      return
    }
    if (state.skipNextConfirmation) dependencies.writeSkipConfirmation(true)
    if (state.skipParameterValidation) dependencies.writeSkipParameterValidation(true)
    await executePrepared(preparedSubmissions, dependencies.createBatchId(), generation)
  }

  const retryFailed = async () => {
    if (state.mode !== 'result') return
    const generation = sessionGeneration
    const failedIds = new Set(
      state.results.filter((result) => result.status === 'failed').map((result) => result.nodeId),
    )
    if (failedIds.size === 0) return
    const retrySubmissions = preparedSubmissions.filter((submission) =>
      failedIds.has(submission.nodeId),
    )
    const successful = state.results.filter((result) => result.status === 'succeeded')
    const batchId = state.results[0]?.batchId ?? dependencies.createBatchId()
    const successfulIds = new Set(successful.map((result) => result.nodeId))
    const failedLayerIndex = flowLayers.findIndex((layer) =>
      layer.some((nodeId) => failedIds.has(nodeId)),
    )
    const retryLayers =
      failedLayerIndex >= 0
        ? flowLayers
            .slice(failedLayerIndex)
            .map((layer, index) =>
              index === 0 ? layer.filter((nodeId) => !successfulIds.has(nodeId)) : layer,
            )
            .filter((layer) => layer.length > 0)
        : [retrySubmissions.map((submission) => submission.nodeId)]
    setState({ ...state, mode: 'submitting' })
    const retried = await runFlowLayers(retryLayers, retrySubmissions, batchId, generation)
    const byNodeId = new Map([...successful, ...retried].map((result) => [result.nodeId, result]))
    const ordered = orderResultsBySession([...byNodeId.values()])
    if (generation !== sessionGeneration) return
    setState({ ...state, mode: 'result', results: ordered })
  }

  const runSingle = async (nodeId: string) => {
    const snapshot = requireSnapshot()
    const node = snapshot.nodes.find((item) => item.id === nodeId)
    if (!node) throw new Error('任务节点不存在')
    let prepared: PreparedCanvasOperationSubmission
    try {
      const skipParameterValidation = dependencies.readSkipParameterValidation()
      prepared = await dependencies.prepareSubmission(
        { snapshot, node },
        skipParameterValidation ? { skipParameterValidation: true } : undefined,
      )
    } catch (error) {
      if (error instanceof CanvasTaskValidationError) {
        const decision = await dependencies.confirmParameterValidation(error.issues)
        if (!decision.confirmed) return
        if (decision.skipFutureValidation) dependencies.writeSkipParameterValidation(true)
        prepared = await dependencies.prepareSubmission(
          { snapshot, node },
          { skipParameterValidation: true },
        )
        await dependencies.runOperationNode(nodeId, {
          ...prepared.params,
          skipParameterValidation: true,
        })
        return
      }
      dependencies.onSingleValidationError?.(nodeId, error)
      throw error
    }
    await dependencies.runOperationNode(nodeId, {
      ...prepared.params,
      ...(dependencies.readSkipParameterValidation() ? { skipParameterValidation: true } : {}),
    })
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    updateDependencies: (next: CanvasBatchTaskControllerDependencies) => {
      dependencies = withDefaults(next)
    },
    openConfigure,
    openSubmit,
    patchGroup,
    patchNode,
    saveDrafts,
    submit,
    confirmSubmit,
    retryFailed,
    runSingle,
    setSkipNextConfirmation: (skip: boolean) => setState({ ...state, skipNextConfirmation: skip }),
    setSkipParameterValidation: (skip: boolean) =>
      setState({ ...state, skipParameterValidation: skip }),
    backToConfigure: () => setState({ ...state, mode: 'configure' }),
    close: () => {
      sessionGeneration += 1
      preparedSubmissions = []
      flowLayers = []
      setState(INITIAL_STATE)
    },
  }
}

export function useCanvasBatchTasks(dependencies: CanvasBatchTaskControllerDependencies) {
  const dependenciesRef = useRef(dependencies)
  dependenciesRef.current = dependencies
  const controllerRef = useRef<CanvasBatchTaskController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createCanvasBatchTaskController({
      ...dependencies,
      getSnapshot: () => dependenciesRef.current.getSnapshot(),
      updateManyNodeData: (updates) => dependenciesRef.current.updateManyNodeData(updates),
      runOperationNode: (nodeId, params) =>
        dependenciesRef.current.runOperationNode(nodeId, params),
      onSingleValidationError: (nodeId, error) =>
        dependenciesRef.current.onSingleValidationError?.(nodeId, error),
    })
  }
  controllerRef.current.updateDependencies({
    ...dependencies,
    getSnapshot: () => dependenciesRef.current.getSnapshot(),
    updateManyNodeData: (updates) => dependenciesRef.current.updateManyNodeData(updates),
    runOperationNode: (nodeId, params) => dependenciesRef.current.runOperationNode(nodeId, params),
    onSingleValidationError: (nodeId, error) =>
      dependenciesRef.current.onSingleValidationError?.(nodeId, error),
  })
  const state = useSyncExternalStore(
    controllerRef.current.subscribe,
    controllerRef.current.getState,
  )
  return { controller: controllerRef.current, state }
}

function withDefaults(
  dependencies: CanvasBatchTaskControllerDependencies,
): Required<Omit<CanvasBatchTaskControllerDependencies, 'onSingleValidationError'>> &
  Pick<CanvasBatchTaskControllerDependencies, 'onSingleValidationError'> {
  return {
    ...dependencies,
    prepareSubmission:
      dependencies.prepareSubmission ??
      ((input, options) => prepareSavedCanvasOperationSubmission(input, undefined, options)),
    readSkipConfirmation:
      dependencies.readSkipConfirmation ?? readSkipCanvasBatchSubmitConfirmation,
    writeSkipConfirmation:
      dependencies.writeSkipConfirmation ?? writeSkipCanvasBatchSubmitConfirmation,
    readSkipParameterValidation:
      dependencies.readSkipParameterValidation ?? readSkipCanvasParameterValidation,
    writeSkipParameterValidation:
      dependencies.writeSkipParameterValidation ?? writeSkipCanvasParameterValidation,
    waitForTask: dependencies.waitForTask ?? (async () => undefined),
    confirmParameterValidation:
      dependencies.confirmParameterValidation ?? confirmCanvasTaskValidation,
    createBatchId:
      dependencies.createBatchId ??
      (() => globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}`),
  }
}

function selectNodes(snapshot: CanvasSnapshot, nodeIds: string[]): CanvasNode[] {
  const selected = new Set(nodeIds)
  return snapshot.nodes.filter((node) => selected.has(node.id))
}

function issuesFromError(nodeId: string, error: unknown): CanvasBatchValidationIssue[] {
  if (error instanceof CanvasTaskValidationError) {
    return error.issues.map((issue) => ({
      nodeId,
      fieldPath: issue.path,
      message: issue.message,
    }))
  }
  return [{ nodeId, fieldPath: [], message: errorMessage(error) }]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '提交任务失败'
}

function resolveSubmittedTaskId(
  snapshot: CanvasSnapshot | null | undefined,
  nodeId: string,
): string | null {
  if (!snapshot) return null
  const nodeTaskId = snapshot.nodes.find((node) => node.id === nodeId)?.taskId
  if (nodeTaskId) return nodeTaskId
  const task = [...snapshot.tasks]
    .filter((item) => item.operationNodeId === nodeId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return task?.id ?? null
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      if (item === undefined) continue
      results[index] = await worker(item)
    }
  })
  await Promise.all(runners)
  return results
}
