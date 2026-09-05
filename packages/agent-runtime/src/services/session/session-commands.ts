/**
 * 会话命令系统（P1-W3-S2 迁出，2026-08-19）。
 *
 * 承接 `/xxx` 命令的解析/执行与结果事件注入（包装 commandRegistry）。
 * 对 SessionService 内部能力的依赖（事件序号、发布通道、回调、checkpoint/goal
 * 等会话能力）经窄接口 SessionCommandHost 注入；控制器不持有 SessionService
 * 引用本身，构造时接收 db + host。
 */
import crypto from 'node:crypto'
import {
  AgentRepository,
  EventRepository,
  ProviderProfileRepository,
  SessionCollaborationRepository,
  SessionRepository,
  SettingsRepository,
  SkillRepository,
  UsageLedgerRepository,
  WorkspaceRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  AgentEvent,
  AgentStatusEvent,
  AssistantMessageEvent,
  ProjectSkillSummaryItem,
  SessionAttachment,
  SessionGoalResponse,
  SessionHistoryResetEvent,
  SessionReferenceInput,
  UserMessageEvent,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { createBuiltinRegistry, isCommand, parseCommand } from '../../core/index.js'
import type {
  CheckpointRestoreResult,
  CommandDeps,
  CommandListItem,
  CustomCommandConfig,
} from '../../core/index.js'
import { AgentEventPersistenceError } from '../session-event-sequencer.js'
import { isSDKAvailable } from '../../sdk/index.js'
import {
  checkCommandAvailable,
  checkOpenAISdkAvailable,
  checkWorkspaceShellAvailable,
  getProviderModelIds,
  getProviderUseSparkExecutor,
  listSessionCheckpointsFromEvents,
  listSkillSummaries,
  normalizeCustomCommandConfig,
  normalizeTurnAttachments,
  shouldDeriveSessionTitle,
  type SessionRuntimePatch,
} from './session-pure-utils.js'
import {
  initializeCommandSessionTitle,
  resolveCommandTitleSource,
} from './session-command-title-refinement.js'
import { getAgentAdapterFromSession, getPermissionModeFromSession } from './engine-kinds.js'
import { createCodexNativeThreadClearPatch } from './codex-native-thread-binding.js'
import { ensureSessionWorkspaceRootPathSync } from '../session-workspace-root.js'

const log = createLogger('session.commands')

type SessionUsageTotals = { totalInputTokens: number; totalOutputTokens: number; totalCost: number }

/** 会话用量回退口径：usage ledger 无记录时从 usage_update 事件累加（随 S2 迁入）。 */
export function getSessionUsageFromPersistence(
  db: SparkDatabase,
  eventRepo: EventRepository,
  sessionId: string,
): SessionUsageTotals | null {
  try {
    const ledgerUsage = new UsageLedgerRepository(db).getSessionUsage(sessionId)
    if (ledgerUsage.recordCount > 0) {
      return {
        totalInputTokens: ledgerUsage.totalInputTokens,
        totalOutputTokens: ledgerUsage.totalOutputTokens,
        totalCost: ledgerUsage.totalCostUsd,
      }
    }
  } catch {
    // Usage ledger may be unavailable in older test doubles or partially migrated databases.
  }

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCost = 0
  let usageEventCount = 0

  for (const row of eventRepo.queryBySession({
    sessionId,
    eventType: 'usage_update',
    limit: 10_000,
  }).events) {
    try {
      const event = JSON.parse(row.event_json) as Partial<AgentEvent> & {
        inputTokens?: unknown
        outputTokens?: unknown
        estimatedCostUsd?: unknown
      }
      const inputTokens = typeof event.inputTokens === 'number' ? event.inputTokens : 0
      const outputTokens = typeof event.outputTokens === 'number' ? event.outputTokens : 0
      const estimatedCostUsd =
        typeof event.estimatedCostUsd === 'number' ? event.estimatedCostUsd : 0
      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      totalCost += estimatedCostUsd
      usageEventCount += 1
    } catch {
      // Ignore malformed historical events.
    }
  }

  if (usageEventCount === 0) return null
  return { totalInputTokens, totalOutputTokens, totalCost }
}

/** 命令系统对 SessionService 的窄依赖面（全部经公开回调满足，不暴露私有字段）。 */
export interface SessionCommandHost {
  /** 清空该会话的事件序号缓存（配合命令清空历史）。 */
  clearSessionEventSequencer(sessionId: string): void
  /** 为命令结果事件预留连续 seq 段。 */
  reserveEventSeqs(sessionId: string, eventRepo: EventRepository, count: number): number
  /** 经唯一事件发布通道落库并发布命令结果事件。 */
  persistAndPublishCommandEvents(eventRepo: EventRepository, events: AgentEvent[]): void
  /** 通知 UI 会话改名（改名类命令）。 */
  notifySessionRenamed(sessionId: string, title: string): void
  /** MCP 服务器状态摘要。 */
  getMcpStatusSummary(): Array<{
    id: string
    name: string
    enabled: boolean
    connected: boolean
    toolCount: number
    error?: string
  }>
  /** 该会话是否仍有活跃的 executor loop。 */
  hasActiveTurnLoop(sessionId: string): boolean
  /** 命令收尾后发起 follow-up Agent turn（宿主附加命令跟随 turn 展示形状）。 */
  startCommandFollowUpTurn(params: {
    sessionId: string
    message: string
    attachments?: SessionAttachment[]
    skillId?: string
    skillParams?: Record<string, unknown>
    runtimePatch?: SessionRuntimePatch
  }): Promise<{ started: boolean }>
  clearUsageLedgerTurnState(sessionId: string): void
  applyApprovalToggle(sessionId: string, enabled: boolean): void
  restoreCheckpointViaSnapshot(
    sessionId: string,
    checkpointRef: string,
  ): Promise<CheckpointRestoreResult>
  getSessionCheckpointEnabled(sessionId: string): boolean
  setSessionCheckpointEnabled(sessionId: string, enabled: boolean): boolean
  setGoal(params: {
    sessionId: string
    objective: string
    attachments?: SessionAttachment[]
    successCriteria?: string[]
    validation?: { commands: string[] }
  }): Promise<SessionGoalResponse>
  getGoal(sessionId: string): SessionGoalResponse
  controlGoal(params: {
    sessionId: string
    action: 'pause' | 'resume' | 'clear' | 'complete'
    summary?: string
  }): Promise<SessionGoalResponse>
  confirmGoalContract(params: { sessionId: string }): Promise<SessionGoalResponse>
  rejectGoalContract(params: { sessionId: string }): Promise<SessionGoalResponse>
}

/** `/xxx` 命令控制器：注册表自足，会话能力经 host 注入。 */
export class SessionCommandController {
  private readonly registry = createBuiltinRegistry()

  constructor(
    private readonly db: SparkDatabase,
    private readonly host: SessionCommandHost,
  ) {}

  async executeCommand(params: { sessionId: string; message: string }): Promise<
    | {
        isCommand: true
        result: { success: boolean; message: string; data?: Record<string, unknown> }
      }
    | { isCommand: false }
  > {
    if (!isCommand(params.message)) return { isCommand: false }

    const parsed = parseCommand(params.message)
    if (parsed == null) return { isCommand: false }

    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const session = sessionRepo.get(params.sessionId)

    // Get workspace path for git/shell commands
    let workspacePath: string | null = null
    try {
      const workspaceIds: string[] = session?.workspace_ids_json
        ? JSON.parse(session.workspace_ids_json)
        : []
      const workspaceId = workspaceIds[0]
      if (workspaceId) {
        const wsRepo = new WorkspaceRepository(this.db)
        const ws = wsRepo.get(workspaceId)
        workspacePath = ws == null ? null : ensureSessionWorkspaceRootPathSync(ws, params.sessionId)
      }
    } catch {
      // ignore parse errors
    }

    const deps = this.buildCommandDeps({ sessionRepo, providerRepo, eventRepo, workspacePath })

    const ctx = {
      sessionId: params.sessionId,
      ...(workspacePath != null ? { workspaceId: workspacePath } : {}),
      ...(session?.provider_profile_id != null ? { providerId: session.provider_profile_id } : {}),
      ...(session?.model_id != null ? { model: session.model_id } : {}),
    }

    this.registerConfiguredCommands(workspacePath)
    // A leading slash is also common in routes, file paths, and pasted text.
    // Only consume the message when its first token resolves to a real command;
    // otherwise let the normal Agent turn interpret the user's full text.
    if (this.registry.get(parsed.name) == null) return { isCommand: false }
    const result = await this.registry.execute(parsed, ctx, deps)
    if (result.forwardToAgent) return { isCommand: false }
    return { isCommand: true, result }
  }

  async executeCommandAsEvents(params: {
    sessionId: string
    message: string
    attachments?: SessionAttachment[]
    sessionReferences?: SessionReferenceInput[]
    runtimePatch?: SessionRuntimePatch
  }): Promise<{ isCommand: boolean; forwardToAgent?: boolean; started?: boolean }> {
    if (!isCommand(params.message)) return { isCommand: false }
    const parsed = parseCommand(params.message)
    if (parsed == null) return { isCommand: false }

    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const commandAttachments = normalizeTurnAttachments(params.attachments)
    const session = sessionRepo.get(params.sessionId)
    const hadNoEventsBeforeCommand = eventRepo.countBySession(params.sessionId) === 0

    let workspacePath: string | null = null
    try {
      const workspaceIds: string[] = session?.workspace_ids_json
        ? JSON.parse(session.workspace_ids_json)
        : []
      const workspaceId = workspaceIds[0]
      if (workspaceId) {
        const wsRepo = new WorkspaceRepository(this.db)
        const ws = wsRepo.get(workspaceId)
        workspacePath = ws == null ? null : ensureSessionWorkspaceRootPathSync(ws, params.sessionId)
      }
    } catch {
      /* ignore */
    }

    const deps = this.buildCommandDeps({ sessionRepo, providerRepo, eventRepo, workspacePath })

    const ctx = {
      sessionId: params.sessionId,
      ...(commandAttachments != null ? { attachments: commandAttachments } : {}),
      ...(workspacePath != null ? { workspaceId: workspacePath } : {}),
      ...(session?.provider_profile_id != null ? { providerId: session.provider_profile_id } : {}),
      ...(session?.model_id != null ? { model: session.model_id } : {}),
    }

    this.registerConfiguredCommands(workspacePath)
    // Preserve slash-prefixed routes/paths as ordinary user input when they do
    // not match a registered command. The renderer will forward the original
    // message unchanged, so the Agent can decide what the text represents.
    const commandDefinition = this.registry.get(parsed.name)
    if (commandDefinition == null) {
      return { isCommand: true, forwardToAgent: true }
    }
    const result = await this.registry.execute(parsed, ctx, deps)

    if (result.forwardToAgent) return { isCommand: true, forwardToAgent: true }
    const followUpPrompt = result.followUpPrompt?.trim()
    const hasFollowUpPrompt = followUpPrompt != null && followUpPrompt.length > 0
    // 命令结果事件会先于隐藏 follow-up Agent turn 落库，常规首轮标题逻辑看不到
    // “事件数为 0 的可见首轮”。在命令边界补齐即时派生 + LLM 异步精炼。
    if (
      result.success &&
      hasFollowUpPrompt &&
      hadNoEventsBeforeCommand &&
      session != null &&
      shouldDeriveSessionTitle(session.title)
    ) {
      initializeCommandSessionTitle({
        db: this.db,
        sessionId: params.sessionId,
        userMessage: resolveCommandTitleSource({
          commandName: parsed.name,
          args: parsed.args,
          description: commandDefinition.description,
        }),
        onSessionRenamed: (sessionId, title) => this.host.notifySessionRenamed(sessionId, title),
      })
    }
    const sessionReferences = params.sessionReferences?.slice(0, 10) ?? []
    if (sessionReferences.length > 0) {
      new SessionCollaborationRepository(this.db).attachReferencesInTransaction({
        references: sessionReferences.map((reference) => ({
          targetSessionId: params.sessionId,
          sourceSessionId: reference.sourceSessionId,
          ...(reference.snapshotSeq !== undefined ? { snapshotSeq: reference.snapshotSeq } : {}),
          actor: 'user' as const,
        })),
      })
    }

    // Inject result as events into the chat stream. Internal commands that end here
    // emit a terminal agent_status so the UI can clear loading, but commands that
    // enqueue a follow-up Agent turn must not mark the overall user request complete.
    // 若命令 handler 已自行启动了一个 agent loop（典型：/goal 触发 goal iteration），
    // 这里就不能再注入 'completed' 终态——那会让 UI 把命令结果 bubble 标完，但 loop
    // 仍在跑，渲染器随之渲出一个空的「执行任务中」占位气泡（双气泡 bug）。
    const hasActiveLoopAfterHandler = this.host.hasActiveTurnLoop(params.sessionId)
    const shouldEmitCompleted = !hasFollowUpPrompt && !hasActiveLoopAfterHandler
    const wipeHistory = result.wipeHistory === true
    const turnId = crypto.randomUUID()
    // wipeHistory 的命令（典型 /clear）会先 emit 一条 SessionHistoryResetEvent，
    // 让 renderer 在新 user/assistant 事件到达前清空本地缓存。
    const baseEventCount = shouldEmitCompleted ? 3 : 2
    const totalEventCount = baseEventCount + (wipeHistory ? 1 : 0)
    const seq0 = this.host.reserveEventSeqs(params.sessionId, eventRepo, totalEventCount)
    const commandEvents: AgentEvent[] = []
    let seqOffset = 0
    if (wipeHistory) {
      const resetEvent: SessionHistoryResetEvent = {
        id: crypto.randomUUID(),
        type: 'session_history_reset',
        sessionId: params.sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: seq0 + seqOffset,
        reason: `command:/${params.message.replace(/^\//, '').split(' ')[0]}`,
      }
      commandEvents.push(resetEvent)
      seqOffset += 1
    }

    const userEvent: UserMessageEvent = {
      id: crypto.randomUUID(),
      type: 'user_message',
      sessionId: params.sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: seq0 + seqOffset,
      content: params.message,
      ...(commandAttachments != null ? { attachments: commandAttachments } : {}),
      ...(sessionReferences.length > 0 ? { sessionReferences } : {}),
    }
    seqOffset += 1
    const cmdName = params.message.replace(/^\//, '').split(' ')[0]
    const icon = result.success ? '✅' : '❌'
    let content = `${icon} **/${cmdName}**\n\n${result.message}`
    if (result.data) content += '\n\n```json\n' + JSON.stringify(result.data, null, 2) + '\n```'

    const assistantEvent: AssistantMessageEvent = {
      id: crypto.randomUUID(),
      type: 'assistant_message',
      sessionId: params.sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: seq0 + seqOffset,
      mode: 'complete',
      content,
      provider: 'spark' as const,
      isFinal: true,
    }
    seqOffset += 1

    commandEvents.push(userEvent, assistantEvent)
    if (shouldEmitCompleted) {
      const completedEvent: AgentStatusEvent = {
        id: crypto.randomUUID(),
        type: 'agent_status',
        sessionId: params.sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: seq0 + seqOffset,
        status: 'completed',
        message: `/${cmdName} completed`,
      }
      commandEvents.push(completedEvent)
    }

    try {
      this.host.persistAndPublishCommandEvents(eventRepo, commandEvents)
    } catch (err) {
      if (err instanceof AgentEventPersistenceError) {
        log.error('Failed to persist command events', {
          sessionId: params.sessionId,
          turnId,
          error: err.message,
        })
      }
      throw err
    }

    if (hasFollowUpPrompt) {
      const sendResult = await this.host.startCommandFollowUpTurn({
        sessionId: params.sessionId,
        message: followUpPrompt,
        ...(commandAttachments != null ? { attachments: commandAttachments } : {}),
        ...(result.followUpSkillId != null ? { skillId: result.followUpSkillId } : {}),
        ...(result.followUpSkillParams != null ? { skillParams: result.followUpSkillParams } : {}),
        ...(params.runtimePatch != null ? { runtimePatch: params.runtimePatch } : {}),
      })
      return { isCommand: true, forwardToAgent: false, started: sendResult.started }
    }

    return { isCommand: true, forwardToAgent: false, started: false }
  }

  listCommands(sessionId?: string): CommandListItem[] {
    const workspacePath = sessionId != null ? this.resolveSessionWorkspacePath(sessionId) : null
    this.registerConfiguredCommands(workspacePath)
    return this.registry.listItems()
  }

  /**
   * 列出会话工作区项目技能目录实时扫描到的项目级技能（project: 前缀）。
   * 同名技能按目录优先级去重（listSkillSummaries 按优先级顺序返回，保留首个）。
   */
  listProjectSkills(sessionId: string): ProjectSkillSummaryItem[] {
    const workspacePath = this.resolveSessionWorkspacePath(sessionId)
    if (!workspacePath) return []
    const seen = new Set<string>()
    const result: ProjectSkillSummaryItem[] = []
    for (const s of listSkillSummaries(new SkillRepository(this.db), workspacePath)) {
      if (!s.id.startsWith('project:')) continue
      const key = s.name.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ id: s.id, name: s.name, description: s.description })
    }
    return result
  }

  private registerConfiguredCommands(workspacePath?: string | null): void {
    const skills = listSkillSummaries(new SkillRepository(this.db), workspacePath)
    this.registry.registerSkillCommands(skills)
    this.registry.registerCustomCommands(this.listCustomCommands())
  }

  /** 从会话绑定的首个工作区解析根路径（决定项目级技能的扫描范围）。 */
  private resolveSessionWorkspacePath(sessionId: string): string | null {
    try {
      const session = new SessionRepository(this.db).get(sessionId)
      const workspaceIds: string[] = session?.workspace_ids_json
        ? JSON.parse(session.workspace_ids_json)
        : []
      const workspaceId = workspaceIds[0]
      if (workspaceId) {
        const ws = new WorkspaceRepository(this.db).get(workspaceId)
        return ws == null ? null : ensureSessionWorkspaceRootPathSync(ws, sessionId)
      }
    } catch {
      // ignore parse errors
    }
    return null
  }

  private listCustomCommands(): CustomCommandConfig[] {
    const raw = new SettingsRepository(this.db).get('custom-commands', 'items')
    if (typeof raw !== 'string' || raw.trim().length === 0) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((item) => normalizeCustomCommandConfig(item))
        .filter((item): item is CustomCommandConfig => item != null)
    } catch {
      return []
    }
  }

  private buildCommandDeps(args: {
    sessionRepo: SessionRepository
    providerRepo: ProviderProfileRepository
    eventRepo: EventRepository
    workspacePath: string | null
  }): CommandDeps {
    const { sessionRepo, providerRepo, eventRepo, workspacePath } = args
    return {
      getSession: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        const providerRow = providerRepo.get(s.provider_profile_id ?? '')
        return {
          title: s.title,
          status: s.status,
          modelId: s.model_id ?? null,
          providerProfileId: s.provider_profile_id ?? '',
          agentAdapter: getAgentAdapterFromSession(
            s.agent_adapter,
            s.chat_mode,
            providerRow?.provider_type ?? null,
            getProviderUseSparkExecutor(providerRow?.config_json),
          ),
          permissionMode: getPermissionModeFromSession(
            s.permission_mode,
            getAgentAdapterFromSession(
              s.agent_adapter,
              s.chat_mode,
              providerRow?.provider_type ?? null,
              getProviderUseSparkExecutor(providerRow?.config_json),
            ),
          ),
          agentId: s.agent_id ?? null,
        }
      },
      updateSession: async (id, fields) => {
        if (fields.title !== undefined) sessionRepo.updateTitle(id, fields.title)
        if (fields.modelId !== undefined) sessionRepo.updateRuntime(id, { modelId: fields.modelId })
      },
      clearSessionEvents: async (id) => {
        sessionRepo.patchMetadata(
          id,
          createCodexNativeThreadClearPatch(sessionRepo.getMetadata(id)),
        )
        eventRepo.deleteBySession(id)
        this.host.clearSessionEventSequencer(id)
        this.host.clearUsageLedgerTurnState(id)
      },
      getProviderName: (id) => {
        return providerRepo.get(id)?.name ?? null
      },
      getProviderModelIds: (id) => getProviderModelIds(providerRepo.get(id)?.config_json),
      setApprovalMode: (id, enabled) => {
        this.host.applyApprovalToggle(id, enabled)
      },
      getWorkspacePath: () => workspacePath,
      execGit: async (args, cwd) => {
        const { getDefaultGitCommandService } = await import('../git-command.service.js')
        return getDefaultGitCommandService().execute(args, { cwd, operation: 'read' })
      },
      execShell: async (command, cwd) => {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: cwd ?? workspacePath ?? undefined,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          })
          return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string; code?: number }
          return {
            stdout: execErr.stdout || '',
            stderr: execErr.stderr || '',
            exitCode: execErr.code ?? 1,
          }
        }
      },
      getSessionEventCount: (id) => {
        return eventRepo.countBySession(id)
      },
      getSessionUsage: (id) => getSessionUsageFromPersistence(this.db, eventRepo, id),
      listSessionCheckpoints: (id) => listSessionCheckpointsFromEvents(eventRepo, id),
      restoreCheckpoint: async (id, checkpointRef) =>
        this.host.restoreCheckpointViaSnapshot(id, checkpointRef),
      getCheckpointEnabled: (id) => this.host.getSessionCheckpointEnabled(id),
      setCheckpointEnabled: (id, enabled) => this.host.setSessionCheckpointEnabled(id, enabled),
      listSkills: (query) => listSkillSummaries(new SkillRepository(this.db), workspacePath, query),
      getSessionRuntimeInfo: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        const provider = providerRepo.get(s.provider_profile_id ?? '')
        const adapter = getAgentAdapterFromSession(
          s.agent_adapter,
          s.chat_mode,
          provider?.provider_type ?? null,
          getProviderUseSparkExecutor(provider?.config_json),
        )
        return {
          providerProfileId: s.provider_profile_id ?? null,
          providerName: provider?.name ?? null,
          modelId: s.model_id ?? null,
          agentAdapter: adapter,
          permissionMode: getPermissionModeFromSession(s.permission_mode, adapter),
        }
      },
      checkSdkAvailability: async () => ({
        claudeSdk: await isSDKAvailable(),
        codexCli: await checkCommandAvailable('codex --version', workspacePath),
        openaiSdk: await checkOpenAISdkAvailable(),
      }),
      checkWorkspaceShell: async (cwd) => checkWorkspaceShellAvailable(cwd ?? workspacePath),
      getMcpStatusSummary: () => this.host.getMcpStatusSummary(),
      getCurrentAgentSummary: (id) => {
        const s = sessionRepo.get(id)
        const agentId = s?.agent_id ?? 'platform-manager-agent'
        const agent = new AgentRepository(this.db).get(agentId)
        if (agent == null)
          return {
            id: agentId,
            name: agentId,
            exists: false,
            enabled: false,
            hasModelConfig: false,
          }
        return {
          id: agent.id,
          name: agent.name,
          exists: true,
          enabled: agent.enabled,
          hasModelConfig: Boolean(agent.providerProfileId || agent.modelId),
          providerProfileId: agent.providerProfileId ?? null,
          modelId: agent.modelId ?? null,
        }
      },
      setGoal: async (id, objective, options) =>
        (
          await this.host.setGoal({
            sessionId: id,
            objective,
            ...(options?.attachments != null ? { attachments: options.attachments } : {}),
            ...(options?.successCriteria != null
              ? { successCriteria: options.successCriteria }
              : {}),
            ...(options?.validationCommands != null
              ? { validation: { commands: options.validationCommands } }
              : {}),
          })
        ).goal as unknown as Record<string, unknown>,
      getGoal: (id) => this.host.getGoal(id).goal as unknown as Record<string, unknown> | null,
      controlGoal: async (id, action, summary) =>
        (
          await this.host.controlGoal({
            sessionId: id,
            action,
            ...(summary != null ? { summary } : {}),
          })
        ).goal as unknown as Record<string, unknown> | null,
      confirmGoalContract: async (id) =>
        (await this.host.confirmGoalContract({ sessionId: id })).goal as unknown as Record<
          string,
          unknown
        > | null,
      rejectGoalContract: async (id) =>
        (await this.host.rejectGoalContract({ sessionId: id })).goal as unknown as Record<
          string,
          unknown
        > | null,
    }
  }
}
