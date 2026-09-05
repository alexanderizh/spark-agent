import type {
  MediaGenerateInput,
  MediaProviderProfile,
  MediaTaskRecord,
  MediaTaskRuntimeService,
  SessionService,
  ToolPackageBuiltInCapabilityDeps,
  ToolHostCapabilityContext,
} from '@spark/agent-runtime'
import type { MediaCapabilityId } from '@spark/protocol'
import {
  AgentRepository,
  ProviderProfileRepository,
  SessionRepository,
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

export function createDesktopToolPackageCapabilities(input: {
  db: SparkDatabase
  sessionService: SessionService
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
      const workflow = new WorkflowRepository(input.db).get(request.workflowId)
      if (workflow == null || !workflow.enabled || workflow.status !== 'active') {
        throw new Error(`Workflow is unavailable: ${request.workflowId}`)
      }
      const agent = new AgentRepository(input.db)
        .list()
        .find((candidate) => candidate.workflowId === workflow.id)
      if (agent == null) throw new Error(`Workflow has no enabled execution Agent: ${workflow.id}`)
      const providerId =
        request.providerProfileId ??
        agent.providerProfileId ??
        new ProviderProfileRepository(input.db).getDefault()?.id
      if (providerId == null) throw new Error('Workflow execution Provider is not configured')
      const created = await input.sessionService.createSession({
        providerProfileId: providerId,
        agentId: agent.id,
        ...(request.modelId != null ? { modelId: request.modelId } : {}),
        ...(request.workspaceId != null ? { workspaceId: request.workspaceId } : {}),
        title: `${workflow.name} · Tool Package`,
      })
      new SessionRepository(input.db).patchMetadata(created.sessionId, {
        [TOOL_PACKAGE_WORKFLOW_OWNER_METADATA_KEY]: {
          packageId: context.packageId,
          packageVersion: context.packageVersion,
        },
      })
      let turn: Awaited<ReturnType<SessionService['sendTurn']>>
      try {
        turn = await input.sessionService.sendTurn({
          sessionId: created.sessionId,
          message: request.objective,
        })
      } catch (error) {
        // 会话刚创建、turn 未被接受即失败：删除空会话，避免遗留无法产生任何运行记录的孤儿会话。
        // deleteSession 会先终止在跑执行器再删关联数据；清理失败不掩盖原始错误。
        await input.sessionService.deleteSession(created.sessionId).catch(() => undefined)
        throw error
      }
      return { workflowId: workflow.id, agentId: agent.id, sessionId: created.sessionId, ...turn }
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
