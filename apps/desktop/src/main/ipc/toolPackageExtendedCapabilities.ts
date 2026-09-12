import type {
  MediaGenerateInput,
  MediaProviderProfile,
  MediaTaskRecord,
  MediaTaskRuntimeService,
  ProviderService,
  SessionService,
  ToolPackageBuiltInCapabilityDeps,
  ToolHostCapabilityContext,
} from '@spark/agent-runtime'
import { WorkflowSessionLauncher } from '@spark/agent-runtime'
import type { MediaCapabilityId } from '@spark/protocol'
import {
  AgentRepository,
  SessionRepository,
  SettingsRepository,
  TurnRequestRepository,
  WorkflowRepository,
  WorkflowRunRepository,
  type SparkDatabase,
} from '@spark/storage'
import type { ComputerUseAgentController } from '../services/computer-use/ComputerUseAgentController.js'

type ExtendedCapabilityDeps = Pick<
  ToolPackageBuiltInCapabilityDeps,
  | 'listWorkflows'
  | 'runWorkflow'
  | 'getWorkflowStatus'
  | 'computerCapabilities'
  | 'computerInvoke'
  | 'listMediaModels'
  | 'generateMedia'
>

const TOOL_PACKAGE_WORKFLOW_OWNER_METADATA_KEY = 'toolPackageWorkflowOwner'

/** Tool Package 工作流启动窗口锁（与编辑器试跑的锁相互独立，按入口隔离）。 */
const toolPackageWorkflowLaunchLocks = new Set<string>()
function getToolPackageWorkflowLaunchLocks(): Set<string> {
  return toolPackageWorkflowLaunchLocks
}

export function createDesktopToolPackageCapabilities(input: {
  db: SparkDatabase
  sessionService: SessionService
  providerService: Pick<ProviderService, 'listProviders'>
  computerController: ComputerUseAgentController
  resolveMediaProviders(): Promise<MediaProviderProfile[]>
  mediaTaskRuntime: MediaTaskRuntimeService
  defaultMediaOutputDir: string
  assertMediaInputPath(path: string): Promise<void> | void
}): ExtendedCapabilityDeps {
  const requireSessionId = (context: ToolHostCapabilityContext): string => {
    if (context.sessionId == null)
      throw new Error('This capability requires an active Spark session')
    return context.sessionId
  }

  const bindComputerContext = (context: ToolHostCapabilityContext): string => {
    const sessionId = requireSessionId(context)
    const session = new SessionRepository(input.db).get(sessionId)
    if (session == null) throw new Error('Spark session is unavailable')
    input.computerController.bindSessionContext(sessionId, {
      turnId: context.turnId ?? context.invocationId,
      providerProfileId: session.provider_profile_id ?? '',
      modelId: session.model_id ?? '',
      permissionMode: session.permission_mode,
    })
    return sessionId
  }

  return {
    listWorkflows: async () => {
      const workflows = new WorkflowRepository(input.db)
        .list()
        .filter((workflow) => workflow.enabled && workflow.status === 'active')
      const agents = new AgentRepository(input.db)
        .list()
        .filter((agent) => agent.workflowId != null)
      return {
        workflows: workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          version: workflow.version,
          agents: agents
            .filter((agent) => agent.workflowId === workflow.id)
            .map((agent) => ({ id: agent.id, name: agent.name })),
        })),
      }
    },
    runWorkflow: async (context, request) => {
      if (context.signal?.aborted === true)
        throw new DOMException('Workflow start cancelled', 'AbortError')
      // 统一走 WorkflowSessionLauncher（方案 §15 阶段 6）：启动锁、工作中冲突、
      // 图结构校验、Provider 回落、失败清理与运行留档与编辑器试跑同一实现。
      // Owner 元数据在启动后落位：workflows.status 鉴权读取发生在远端轮询时，
      // 与启动窗口无竞争。
      const launchLocks = getToolPackageWorkflowLaunchLocks()
      const launched = await new WorkflowSessionLauncher({
        workflowRepo: new WorkflowRepository(input.db),
        workflowRunRepo: new WorkflowRunRepository(input.db),
        turnRequestRepo: new TurnRequestRepository(input.db),
        agentRepo: new AgentRepository(input.db),
        settingsRepo: new SettingsRepository(input.db),
        providerService: input.providerService,
        sessionService: input.sessionService,
        launchingWorkflowIds: launchLocks,
      }).launch({
        workflowId: request.workflowId,
        objective: request.objective,
        source: 'tool-package',
        ...(request.providerProfileId != null
          ? { providerProfileId: request.providerProfileId }
          : {}),
        ...(request.modelId != null ? { modelId: request.modelId } : {}),
        ...(request.workspaceId != null ? { workspaceId: request.workspaceId } : {}),
      })
      new SessionRepository(input.db).patchMetadata(launched.sessionId, {
        [TOOL_PACKAGE_WORKFLOW_OWNER_METADATA_KEY]: {
          packageId: context.packageId,
          packageVersion: context.packageVersion,
        },
      })
      return {
        workflowId: request.workflowId,
        agentId: launched.hostAgentId,
        sessionId: launched.sessionId,
        turnId: launched.turnId,
      }
    },
    getWorkflowStatus: async (context, request) => {
      const owner = new SessionRepository(input.db).getMetadata(request.sessionId)[
        TOOL_PACKAGE_WORKFLOW_OWNER_METADATA_KEY
      ]
      if (
        owner == null ||
        typeof owner !== 'object' ||
        Array.isArray(owner) ||
        (owner as Record<string, unknown>).packageId !== context.packageId ||
        (owner as Record<string, unknown>).packageVersion !== context.packageVersion
      ) {
        throw new Error('Tool Package cannot inspect a workflow session it did not start')
      }
      const run = new WorkflowRunRepository(input.db).listBySession(request.sessionId, 1)[0]
      if (run == null) return { sessionId: request.sessionId, run: null }
      return {
        sessionId: request.sessionId,
        run: {
          id: run.id,
          workflowId: run.workflow_id,
          turnId: run.turn_id,
          status: run.status,
          objective: run.objective,
          startedAt: run.started_at,
          updatedAt: run.updated_at,
          endedAt: run.ended_at,
          completedNodeIds: JSON.parse(run.completed_node_ids_json) as unknown,
          skippedNodeIds: JSON.parse(run.skipped_node_ids_json) as unknown,
          failedNode:
            run.failed_node_json == null ? null : (JSON.parse(run.failed_node_json) as unknown),
        },
      }
    },
    computerCapabilities: async () => input.computerController.promptCapabilities(),
    computerInvoke: async (context, action, args) => {
      const sessionId = bindComputerContext(context)
      const onAbort = () => void input.computerController.stopOwnedSessions(sessionId)
      context.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await input.computerController.invoke(sessionId, action, args)
      } finally {
        context.signal?.removeEventListener('abort', onAbort)
      }
    },
    listMediaModels: async () => {
      const providers = await input.resolveMediaProviders()
      return {
        providers: providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          defaultModel: provider.defaultModel,
          modelIds: provider.modelIds ?? [],
          mediaCapabilities: provider.mediaCapabilities ?? [],
          manifests: (provider.mediaModelManifests ?? []).map((manifest) => ({
            id: manifest.id,
            modelId: manifest.modelId,
            displayName: manifest.displayName,
            domains: manifest.domains,
            capabilities: manifest.capabilities.map((capability) => capability.id),
          })),
        })),
      }
    },
    generateMedia: async (context, request) => {
      if (context.signal?.aborted === true)
        throw new DOMException('Media generation cancelled', 'AbortError')
      const providers = await input.resolveMediaProviders()
      if (providers.length === 0) throw new Error('No configured media Provider is available')
      for (const file of request.inputFiles ?? []) {
        if (typeof file.path === 'string' && file.path.trim().length > 0) {
          await input.assertMediaInputPath(file.path)
        }
      }
      let settle: ((record: MediaTaskRecord) => void) | undefined
      const completion = new Promise<MediaTaskRecord>((resolve) => {
        settle = resolve
      })
      const mediaInput: MediaGenerateInput = {
        operation: request.operation,
        ...(request.prompt != null ? { prompt: request.prompt } : {}),
        ...(request.negativePrompt != null ? { negativePrompt: request.negativePrompt } : {}),
        ...(request.inputFiles != null
          ? { inputFiles: request.inputFiles as MediaGenerateInput['inputFiles'] }
          : {}),
        modelParams: request.modelParams,
        outputDir: input.defaultMediaOutputDir,
      }
      const task = input.mediaTaskRuntime.submitBackground(
        mediaInput,
        {
          providers,
          ...(request.providerProfileId != null
            ? { providerProfileId: request.providerProfileId }
            : {}),
          ...(request.manifestId != null ? { manifestId: request.manifestId } : {}),
          ...(request.modelId != null ? { modelId: request.modelId } : {}),
          ...(request.capabilityId != null
            ? { capability: request.capabilityId as MediaCapabilityId }
            : {}),
        },
        (record) => {
          if (record.status !== 'running') settle?.(record)
        },
      )
      const onAbort = () => {
        const cancelled = input.mediaTaskRuntime.cancel(task.id)
        if (cancelled != null) settle?.(cancelled)
      }
      context.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await completion
      } finally {
        context.signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}
