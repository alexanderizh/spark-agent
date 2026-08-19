/**
 * session.service 类外纯函数（P1-W3-S1 迁出，2026-08-19）。
 *
 * 本模块承接原 session.service.ts 类体外部的模块级纯函数/常量/类型：
 * 标题派生、事件快照查询、附件规范化、团队花名册与讨论线程格式化、
 * metadata 解析、provider/model 路由解析、历史裁剪等。
 * 全部为零状态纯函数（或仅依赖传入 repo），不持有 SessionService 引用。
 * session.service.ts 顶部保留 re-export，既有 import 面不变。
 */
import crypto from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import {
  EventRepository,
  RulesRepository,
  SkillRepository,
  TeamDiscussionRepository,
} from '@spark/storage'
import type {
  AgentItem,
  WorkflowItem,
  TeamThreadMessageRow,
  ProviderProfileRow,
  ReferencedSessionTurn as StoredReferencedSessionTurn,
} from '@spark/storage'
import type {
  AgentEvent,
  CliSparkOverride,
  HistoryImportSource,
  SessionChatMode,
  SessionAttachment,
  SessionId,
  SessionLineage,
  SessionPermissionMode,
  SessionReference,
  SessionReferenceCandidate,
  TeamA2ATask,
  TeamModeConfig,
} from '@spark/protocol'
import {
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  isLocalCodexCliProvider,
} from '@spark/protocol'
import type { SDKExecutorConfig, SDKMcpServerConfig, SDKTurnAttachment } from '../../sdk/index.js'
import {
  normalizeSparkReasoningEffort,
  type SparkReasoningEffort,
} from '../../sdk/reasoning-effort.js'
import type { CheckpointSnapshot, CustomCommandConfig } from '../../core/index.js'
import { createInterruptedTurnEvents } from '../session-event-helpers.js'
import { SkillLoader } from '../../skills/skill-loader.js'
import { ProjectContextService } from '../project-context.service.js'
import { normalizeWorkflowGraph, type WorkflowDispatchAttachment } from '../workflow-executor.js'
import { resolveEngineKind } from './engine-kinds.js'
import type { AgentAdapterKind } from '../session-resume-gate.js'
import type { ModelRouterProvider } from '../model-router.service.js'

export type WorktreePromptMeta = {
  baseRepoRoot: string
  branch: string
  baseBranch: string
  baseWorkspaceId?: string
}

export type SessionRuntimePatch = {
  providerProfileId?: string
  modelId?: string | null
  agentId?: string
  skillIds?: string[]
  agentAdapter?: AgentAdapterKind
  permissionMode?: SessionPermissionMode
  chatMode?: SessionChatMode
  reasoningEffort?: SparkReasoningEffort
}

export const DEFAULT_SESSION_TITLES = new Set([
  'New Session',
  '新会话',
  'Workspace Session',
  '未命名会话',
])
export const SESSION_TITLE_MAX_LENGTH = 40

export function shouldDeriveSessionTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim() ?? ''
  return DEFAULT_SESSION_TITLES.has(normalized) || normalized.endsWith(' 会话')
}

/**
 * 标题是否为首条消息的前缀截断（视为派生态，允许精炼覆盖）。
 * 覆盖 dispatchTurn 派生之外的命名来源：renderer 对 /goal 等命令会话用
 * objective 文本直接命名（截断规则与 truncateTitle 不一致），以及前端
 * 首条消息命名。只认短前缀，用户手改的长标题不会被误判为派生态。
 */
export function isTitlePrefixOfMessage(title: string | null | undefined, message: string): boolean {
  const normalized = title?.trim() ?? ''
  if (normalized.length === 0 || normalized.length > SESSION_TITLE_MAX_LENGTH + 3) return false
  const stripped = normalized.replace(/\.{3}$/, '').replace(/…$/, '')
  if (stripped.length === 0) return false
  return message.includes(stripped)
}

export function getLatestAgentStatusFromEvents(
  eventRepo: EventRepository,
  sessionId: string,
): string | null {
  const row = eventRepo.queryBySession({ sessionId, eventType: 'agent_status', limit: 1 }).events[0]
  if (row == null) return null
  try {
    const event = JSON.parse(row.event_json) as AgentEvent
    return event.type === 'agent_status' ? event.status : null
  } catch {
    return null
  }
}

export function appendInterruptedTurnEvents(eventRepo: EventRepository, sessionId: string): void {
  const turnId = getLatestTurnIdFromEvents(eventRepo, sessionId)
  const timestamp = new Date().toISOString()
  const seq = eventRepo.nextSeqBySession(sessionId)
  const persistedEvents = eventRepo.queryStreamEventsByTurn(sessionId, turnId).flatMap((row) => {
    try {
      return [JSON.parse(row.event_json) as AgentEvent]
    } catch {
      return []
    }
  })
  const events = createInterruptedTurnEvents(sessionId, turnId, seq, timestamp, persistedEvents)

  eventRepo.insertBatch(
    events.map((event) => ({
      id: event.id,
      sessionId,
      turnId,
      eventType: event.type,
      eventJson: JSON.stringify(event),
    })),
  )
}

export function getLatestTurnIdFromEvents(eventRepo: EventRepository, sessionId: string): string {
  const latestRow = eventRepo.queryBySession({ sessionId, limit: 1 }).events[0]
  let turnId: string = crypto.randomUUID()
  if (latestRow != null) {
    try {
      const event = JSON.parse(latestRow.event_json) as AgentEvent
      if (event.turnId != null && event.turnId.length > 0) turnId = event.turnId
    } catch {
      // Fall back to a synthetic turn id.
    }
  }
  return turnId
}

export function listSessionCheckpointsFromEvents(
  eventRepo: EventRepository,
  sessionId: string,
): CheckpointSnapshot[] {
  const rows = eventRepo.queryBySession({ sessionId, eventType: 'checkpoint', limit: 100 }).events
  const checkpoints: CheckpointSnapshot[] = []
  for (const row of rows) {
    try {
      const event = JSON.parse(row.event_json) as AgentEvent
      if (event.type !== 'checkpoint') continue
      checkpoints.push({
        checkpointId: event.checkpointId,
        ...(event.label != null ? { label: event.label } : {}),
        ...(event.path != null ? { path: event.path } : {}),
        ...(event.filePaths != null ? { filePaths: event.filePaths } : {}),
        ...(event.sdkSessionId != null ? { sdkSessionId: event.sdkSessionId } : {}),
        timestamp: event.timestamp,
      })
    } catch {
      // Ignore malformed historical rows.
    }
  }
  return checkpoints
}

export function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function normalizeTurnAttachments(
  attachments: SessionAttachment[] | undefined,
): SessionAttachment[] | undefined {
  if (attachments == null || attachments.length === 0) return undefined
  const seen = new Set<string>()
  const normalized: SessionAttachment[] = []
  for (const attachment of attachments) {
    const rawPath = attachment.path.trim()
    if (rawPath.length === 0) continue
    const absolutePath = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(rawPath)
    if (seen.has(absolutePath)) continue
    seen.add(absolutePath)
    normalized.push({ type: attachment.type, path: absolutePath })
  }
  return normalized.length > 0 ? normalized.slice(0, 20) : undefined
}

export function prepareTurnAttachments(
  attachments: SessionAttachment[] | undefined,
  workspaceRootPath: string,
): SDKTurnAttachment[] {
  if (attachments == null || attachments.length === 0) return []
  return attachments.map((attachment) => {
    const absolutePath = path.isAbsolute(attachment.path)
      ? path.normalize(attachment.path)
      : path.resolve(workspaceRootPath, attachment.path)
    if (!existsSync(absolutePath)) {
      throw new Error(`附件不存在: ${absolutePath}`)
    }
    const fileStat = statSync(absolutePath)
    // directory 类型：作为上下文引用，校验是目录即可（不强制读取内容）
    if (attachment.type === 'directory') {
      if (!fileStat.isDirectory()) {
        throw new Error(`附件应是目录: ${absolutePath}`)
      }
      return {
        type: 'directory',
        path: absolutePath,
        name: path.basename(absolutePath),
      }
    }
    if (!fileStat.isFile()) {
      throw new Error(`附件必须是文件: ${absolutePath}`)
    }
    return {
      type: attachment.type,
      path: absolutePath,
      name: path.basename(absolutePath),
      sizeBytes: fileStat.size,
    }
  })
}

export function getAttachmentAdditionalDirectories(
  attachments: SDKTurnAttachment[],
  workspaceRootPath: string,
): string[] {
  const directories = new Set<string>()
  for (const attachment of attachments) {
    // directory 类型：把目录本身加入可访问范围，让 agent 的文件工具能遍历它
    const target = attachment.type === 'directory' ? attachment.path : path.dirname(attachment.path)
    if (!isInsidePath(workspaceRootPath, target)) directories.add(target)
  }
  return Array.from(directories)
}

export function buildUserMessageSnapshot(
  message: string,
  attachments: SDKTurnAttachment[],
): string {
  if (attachments.length === 0) return message
  return [message, '', buildAttachmentPromptLedger(attachments)].join('\n')
}

export function buildAttachmentPromptLedger(attachments: SDKTurnAttachment[]): string {
  if (attachments.length === 0) return ''
  const lines = attachments.map((attachment, index) => {
    return `${index + 1}. ${attachment.type}: ${attachment.name} (${attachment.path})`
  })
  return ['Attachments:', ...lines].join('\n')
}

export function deriveSessionTitle(message: string): string {
  const normalized = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^>+\s*/, '')
    .replace(/[`*_~[\](){}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized == null || normalized.length === 0) return '新会话'
  return truncateTitle(normalized)
}

/** 创建子应用命令的会话标题直接取用户提供的应用需求，而不是内部 follow-up 提示。 */
export function deriveSubAppCreateSessionTitle(requirement: string): string {
  return deriveSessionTitle(requirement.trim() || '创建子应用')
}

export function parseWorktreePromptMeta(raw: string): WorktreePromptMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WorktreePromptMeta> | null
    if (parsed == null || typeof parsed !== 'object') return null
    if (
      typeof parsed.baseRepoRoot !== 'string' ||
      typeof parsed.branch !== 'string' ||
      typeof parsed.baseBranch !== 'string'
    ) {
      return null
    }
    return {
      baseRepoRoot: parsed.baseRepoRoot,
      branch: parsed.branch,
      baseBranch: parsed.baseBranch,
      ...(typeof parsed.baseWorkspaceId === 'string'
        ? { baseWorkspaceId: parsed.baseWorkspaceId }
        : {}),
    }
  } catch {
    return null
  }
}

/**
 * 会话 worktree 状态上报引导（静态文本，全 adapter 注入）。
 * 告知 agent 在进入/退出 worktree 开发时必须调用 set_worktree_state 工具，
 * 否则应用 UI 会继续显示主仓库分支，误导用户。
 */
export const SESSION_WORKTREE_STATE_SYSTEM_PROMPT = [
  '[Session Worktree State]',
  "The app UI shows this session's git branch based on the session worktree state reported through the `mcp__spark_session__set_worktree_state` tool (engine-level worktrees are invisible to the app otherwise).",
  'Rule: whenever you start developing inside a git worktree during this session — via the EnterWorktree tool, `git worktree add`, or a worktree created by your engine — you MUST call `mcp__spark_session__set_worktree_state` with action="enter" and the worktree\'s absolute root path right after entering it; call it with action="exit" when you leave the worktree and return to the main checkout.',
  'This does not change any git state; it only keeps the branch indicator and the worktree badge in the app accurate for the user.',
].join('\n')

/** spark_session.set_worktree_state 工具描述（in-process 与 stdio 版本共用文案） */
export const SPARK_SESSION_WORKTREE_TOOL_DESCRIPTION = [
  '更新当前会话的 worktree 运行状态，应用界面据此显示会话的真实分支并点亮 worktree 标记。',
  '调用时机（务必遵守）：',
  '1) 通过 EnterWorktree 等工具进入 worktree、或手动执行 git worktree add 创建 worktree 后，立即以 action="enter" 调用，path 传 worktree 根目录绝对路径；',
  '2) 后续所有开发都在该 worktree 中进行期间无需重复调用；',
  '3) 退出或删除 worktree、回到主仓库开发时，以 action="exit" 调用清除状态。',
  '注意：本工具不改变任何 git 状态，只是向应用上报展示信息；分支名会由应用从该路径自动解析，branch 参数仅在 detached HEAD 时作展示兜底。',
].join(' ')

export function buildWorktreeSessionSystemPrompt(
  workspaceInfo:
    | {
        name: string
        rootPath: string
        projectKind: string
        worktreeMeta?: WorktreePromptMeta
      }
    | undefined,
): string | undefined {
  if (workspaceInfo?.worktreeMeta == null) return undefined
  const { branch, baseBranch, baseRepoRoot } = workspaceInfo.worktreeMeta
  return [
    '[Worktree Session]',
    'This session runs inside an isolated git worktree, not the main checkout.',
    `Current worktree branch: ${branch}`,
    `Base branch: ${baseBranch}`,
    `Workspace root: ${workspaceInfo.rootPath}`,
    `Base repository root: ${baseRepoRoot}`,
    'Treat the current workspace as the source of truth for file edits, git status, and commands.',
    'Do not assume the main checkout path or branch is active unless the user explicitly asks you to leave this worktree workflow.',
  ].join('\n')
}

export function truncateTitle(title: string): string {
  const chars = Array.from(title)
  if (chars.length <= SESSION_TITLE_MAX_LENGTH) return title
  return `${chars
    .slice(0, SESSION_TITLE_MAX_LENGTH - 3)
    .join('')
    .trimEnd()}...`
}

// getAgentAdapterFromSession / getPermissionModeFromSession / normalizeAgentAdapter /
// normalizePermissionMode 已迁出至 ./session/engine-kinds.ts（P1-W1-D4 引擎归一化）

export function normalizeReasoningEffort(value: string | null | undefined): SparkReasoningEffort {
  return normalizeSparkReasoningEffort(value)
}

export function withAgentSnapshot(event: AgentEvent, agent: AgentItem): AgentEvent {
  if (
    event.type !== 'assistant_message' &&
    event.type !== 'agent_thinking' &&
    event.type !== 'agent_status'
  ) {
    return event
  }
  return {
    ...event,
    agentId: event.agentId ?? agent.id,
    agentName: event.agentName ?? agent.name,
  } as AgentEvent
}

/** Advisory nudge toward using the native Task subagent tool, framed as a net-gain decision — shown on every host turn. */
export const SUBAGENT_USAGE_HINT_SYSTEM_PROMPT = [
  '[Subagent Usage]',
  "You have a general-purpose subagent tool (Task) available for delegating self-contained, parallelizable, or context-heavy sub-tasks — e.g. broad codebase research, independent multi-file investigations, or exploratory searches whose raw output you don't need in your own context.",
  'Decide by NET GAIN, not by default: delegate when the subtask genuinely benefits from its own agent — it saves wall-clock time (e.g. independent work that can run in parallel), or offloading it protects the main context from being diluted by large raw output you only need the conclusion of. When delegating buys no time or context savings (small, tightly sequential, already-clear work), handle it inline instead — dispatching has overhead and is not the default.',
  'If the user explicitly asks you to use a subagent (or names a specific agent) for something, comply and dispatch it even if you believe you could handle it inline.',
  'Before dispatching, briefly state why this subtask is worth its own agent — e.g. parallel time savings, or isolating a large context (files/long outputs) from the main conversation.',
  'KEEP THE SESSION ALIVE after dispatching. Do not end the conversation early to wait for a subagent — ending the session terminates the in-flight subagents along with it and their work is lost. Keep the turn running and wait for the result, or use SendMessage to retrieve/continue a background agent when the tool result says it is still running. Only answer the user once you have incorporated the subagent result or can report a real failure.',
  'For long-running background tasks, pair them with a session-level scheduled wake-up (session schedule): if you must end the turn while background work is still pending, create the schedule task (interval or one-shot) BEFORE ending the turn — it will wake the session later so the result can be collected after the interruption. Never rely on an ended session to deliver subagent results on its own.',
].join('\n')

/**
 * 记忆行为引导（每次会话无条件注入）。
 *
 * 解决"两套记忆语义冲突"：本应用同时存在两套长期记忆机制——
 *   1. 应用长期记忆：上方可能出现的 `<user-memory>`/`<project-memory>`/`<agent-memory>` 摘要块
 *      + search_memory / recall_memory 工具。由后台在每轮对话结束后**自动抽取**写入，
 *      桌面端「设置 → Agent → 记忆」面板可见、可管理。
 *   2. 项目规则文件：AGENTS.md / CLAUDE.md（Claude Code 原生 `/memory` 命令维护），
 *      存项目静态规则、团队约定，git 跟踪、手动维护。
 * 两者并存、各司其职。主 agent 此前从未被告知这一区别，导致用户说"记住"时 agent 可能
 * 误走 `/memory` 写进 CLAUDE.md（桌面端不可见）却回答"记住了"，用户无法分辨去向。
 * 本段统一约定：用户说"记住"默认指应用长期记忆，回复措辞需明确去向。
 */
export const MEMORY_BEHAVIOR_SYSTEM_PROMPT = [
  '[Memory Behavior] This application has two distinct long-term memory systems:',
  '',
  '1. **Application Memory**',
  '   - This consists of the optional `<user-memory>`, `<project-memory>`, and `<agent-memory>` summaries above, plus the `search_memory` and `recall_memory` tools.',
  "   - Store durable user preferences and identity, project-level changing facts, feedback about the current agent's role or style, and stable references to external systems.",
  '   - The application extracts and writes these memories automatically after each turn. Do not manually write a file for application memory.',
  '   - Users can review and manage these entries under Settings → Agent → Memory.',
  '',
  '2. **Project Rule Files**',
  '   - These are `AGENTS.md` and `CLAUDE.md`; the native Claude Code `/memory` command manages this category.',
  '   - Store static project rules, team conventions, and collaboration procedures that should be manually maintained, shared with the team, and tracked by git.',
  '   - Updating this category is explicit work: edit the relevant file and include it in version control.',
  '',
  'When the user asks you to remember something, in any language:',
  '- Interpret it as application memory by default. The application will extract it automatically after the turn.',
  '- For application memory, say that it was noted or added to long-term memory. Do not claim that `CLAUDE.md` was updated.',
  '- If you actually changed a project rule file, name the exact `AGENTS.md` or `CLAUDE.md` file you updated.',
  '',
  'Do not promise to remember dates or the current time, live data such as weather, prices, or exchange rates, one-off query results, temporary task state, or facts that can be derived from code or git history. Handle those in the current turn instead.',
].join('\n')

// ── Team Mode helpers ────────────────────────────────────────────────────────

export const TEAM_DISPATCH_TOOL_DESCRIPTION = [
  'Delegate ONE focused subtask to a teammate agent (serial).',
  'When to use: the next step depends on the previous member reply, or only one member needs to act.',
  'When NOT to use: you can answer the user directly, or the user asks several members in parallel (use agent_dispatch_batch instead).',
  'Returns a structured reply with the member content. You decide whether to call again or synthesize the final answer.',
].join('\n')

export const TEAM_DISPATCH_BATCH_TOOL_DESCRIPTION = [
  'Delegate multiple INDEPENDENT subtasks to teammate agents IN PARALLEL.',
  'When to use: the user explicitly asks several members (e.g. "ask all agents", "have docs and qa each draft X"), or you have multiple unrelated tasks that can run concurrently.',
  'When NOT to use: tasks depend on each other (use agent_dispatch one at a time), or the user only mentioned one member.',
  'Each item is one independent dispatch; tasks may target the same or different members.',
  'Returns an array of structured replies in the same order as the input. A failure in one item does not abort the others.',
].join('\n')

/**
 * 编排宿主的行为引导（纯提示词，不禁用任何工具——产品决策 2026-07-04：所有 agent
 * 含团队 Host / 挂工作流的 agent 都保留全量工具权限，「优先派发」只靠引导实现）。
 */
export function buildOrchestrationModeSystemPrompt(
  source: 'team' | 'workflow',
  memberCount: number,
): string {
  const reason =
    source === 'team'
      ? 'Team Mode is enabled for this session'
      : 'the agent you are running as has a workflow attached with dispatchable phases'
  return [
    '[Orchestration Mode]',
    `You are the orchestration host this turn. Reason: ${reason}. You have ${memberCount} member(s)/worker(s) you can delegate to.`,
    'You keep your FULL toolset (Edit/Write/Bash/etc.), but your primary job this turn is coordination, not solo execution:',
    '- Delegate substantive work to members/workers via your dispatch tools — that is why this mode exists.',
    '- Reserve direct tool use for glue work: final assembly of member outputs, quick verification commands, or tiny fixes that are clearly cheaper to do than to delegate.',
    '- Do NOT solo the whole task while capable members sit idle — if a member could plausibly own a piece, dispatch it.',
    '- If the user explicitly asks YOU to edit/run something directly, doing it yourself is fine.',
    // 功能逻辑审查修复：避免 Host 与 member 内容冗余。
    // member dispatch 时 UI 已显示独立 member 气泡（team_member_message event），
    // 用户直接看到 member 的完整回复。Host 不应再 paraphrase member 已说的内容，
    // 否则用户看到双重表达（member 气泡 + Host 重复），感知冗余、噪音。
    '- Member/worker replies are shown to the user directly as separate message bubbles. Do NOT restate or paraphrase what a member already said.',
    '- Your final output should add value beyond member replies: cross-member synthesis, tradeoff analysis, decisions, next-step recommendations, or glue work that members cannot do themselves.',
    '- If a single member fully answered the user, a brief acknowledgment ("Member X handled this — see their reply above") is enough; do not re-explain.',
  ].join('\n')
}

/** 从 SessionRow.metadata_json 读取团队配置（不存在/无效返回 null） */
export function readSessionTeamConfig(session: { metadata_json?: string }): TeamModeConfig | null {
  if (session.metadata_json == null || session.metadata_json === '') return null
  try {
    const meta = JSON.parse(session.metadata_json) as { team?: Partial<TeamModeConfig> }
    const team = meta.team
    if (team == null || typeof team !== 'object') return null
    return {
      enabled: team.enabled === true,
      hostAgentId:
        typeof team.hostAgentId === 'string' ? team.hostAgentId : 'platform-manager-agent',
      memberAgentIds: Array.isArray(team.memberAgentIds)
        ? team.memberAgentIds.filter((id) => typeof id === 'string')
        : [],
      maxDepth:
        typeof team.maxDepth === 'number' && Number.isFinite(team.maxDepth)
          ? Math.max(1, Math.min(10, Math.floor(team.maxDepth)))
          : 1,
      allowNesting: team.allowNesting === true,
      ...(typeof team.dispatchTimeoutMs === 'number'
        ? { dispatchTimeoutMs: team.dispatchTimeoutMs }
        : {}),
      ...(typeof team.teamId === 'string' ? { teamId: team.teamId } : {}),
      ...(typeof team.maxDiscussionRounds === 'number'
        ? { maxDiscussionRounds: TeamDiscussionRepository.clampMaxRounds(team.maxDiscussionRounds) }
        : {}),
      ...(typeof team.enablePeerMessaging === 'boolean'
        ? { enablePeerMessaging: team.enablePeerMessaging }
        : {}),
      ...(typeof team.threadContextTokenBudget === 'number' &&
      Number.isFinite(team.threadContextTokenBudget)
        ? { threadContextTokenBudget: team.threadContextTokenBudget }
        : {}),
    }
  } catch {
    return null
  }
}

/** 构建团队花名册 system prompt 段，附加在 [Agent Instructions] 之后（设计文档 §8.2.3） */
export interface TeamRosterPromptOptions {
  /** 视角：host（编排者，默认，向后兼容）/ member（被注入 prompt 的成员） */
  perspective?: 'host' | 'member'
  /** member 视角必填：当前被注入 prompt 的成员（"You are X"） */
  viewingMember?: AgentItem
  /** 共享讨论线程片段（已按 token 预算截断）——member 视角拼进 [Discussion So Far] */
  threadSnippet?: string
  /** 是否启用对等消息（agent_message）——member 视角决定是否注入 agent_message 使用说明 */
  enablePeerMessaging?: boolean
  /** member 视角：SDK 原生子代理工具（Task/SendMessage）在本上下文是否可用。
   *  被派发的成员为 false（Task/SendMessage 已禁用）；被用户 @ 的成员为 true（保留原生能力，
   *  需要提示词消歧两套通信系统）。 */
  nativeSubagentToolsAvailable?: boolean
}

export function buildTeamRosterPrompt(
  host: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
  opts: TeamRosterPromptOptions = {},
): string {
  if (members.length === 0) return ''
  if (opts.perspective === 'member') {
    if (opts.viewingMember == null) {
      throw new Error("buildTeamRosterPrompt: 'member' perspective requires viewingMember")
    }
    return buildMemberRosterPrompt(host, opts.viewingMember, members, teamConfig, opts)
  }
  return buildHostRosterPrompt(host, members, teamConfig)
}

/** Host 视角：编排者，显式轮次状态机替代旧的"CONVERGE do NOT loop"道德劝诫。 */
export function buildHostRosterPrompt(
  host: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
): string {
  const exampleMember = members[0]
  const lines: string[] = [
    '[Team Roster]',
    `You are ${host.name} (${host.id}), the HOST of a multi-agent team.`,
    'Your job is to ORCHESTRATE, not to execute alone — you coordinate specialists, they do the hands-on work.',
    '',
    '════ How to reach a team member — READ THIS BEFORE picking any tool ════',
    'Two different subagent systems exist. They do NOT share address spaces:',
    '  1. TEAM MEMBERS (the roster below): reachable ONLY via `mcp__spark_team__agent_dispatch` /',
    '     `agent_dispatch_batch` / `agent_message`. They will NEVER appear in the built-in',
    '     `SendMessage` addressable list.',
    '  2. PRIVATE SUBAGENTS (built-in Task/SendMessage): a separate system for spawning your own',
    '     disposable helpers (e.g. quick research probes). Team members are NOT in this system —',
    '     `SendMessage({ to: "<teammate name>" })` will always fail with "not currently addressable".',
    '',
    `  Correct (works):   mcp__spark_team__agent_dispatch({ targetAgentId: "${exampleMember?.id ?? '<member-id-from-roster-below>'}", instruction: "..." })`,
    `  Wrong (will fail): SendMessage({ to: "${exampleMember?.name ?? '<member-name>'}", ... })`,
    '',
    '  If SendMessage returns "not currently addressable" while reaching a teammate, do NOT retry',
    '  with a different name/id — switch tools to `mcp__spark_team__agent_dispatch` / `agent_message`.',
    '════════════════════════════════════════════════════════════════════════',
    '',
    'Core principles:',
    '- Collaboration with net benefit. This is a team session — when delegating to a specialist has a real gain (their unique expertise, parallel execution, or keeping a large chunk of work out of your context), prefer delegating over doing it yourself. When a question is quick, self-contained, and within your own abilities, answering directly is fine — dispatching is not the default.',
    "- Match by expertise. Read each member's description below and route each subtask to whoever does it best — coding to the coder, review to the reviewer, and so on.",
    '- You orchestrate, members execute. Decide WHAT needs doing and WHO does it, then dispatch. When a capable member exists AND delegating has a real gain (expertise, parallelism, or context isolation), do not do the hands-on work yourself — that is what delegation is for.',
    "- Delegate on gain, not on default. Before dispatching, ask: does this subtask benefit from its own agent — e.g. it needs a member's unique expertise, it can run in parallel with other work, or its raw output would bloat the main context? If yes, dispatch; if not (a quick answer you can give in one step), answer directly. Do not dispatch merely because a member exists.",
    '- If the user explicitly asks to involve a specific member (or use a subagent), comply and dispatch even if you could handle it inline.',
    '- Before each dispatch, state briefly why this subtask is worth a dedicated agent — e.g. time savings from parallelism, or isolating a large context from the main conversation.',
    "- Talk with your team. Give each dispatch a clear instruction and the minimum context it needs (paste code/snippets into `attachments`, don't rely on shared memory). After replies come back, react, ask follow-ups, or chain to another member — treat it like a working conversation, not one-shot calls.",
    '- Cross-team @ is supported. The user may @-mention any member directly; you may also have members collaborate with each other within the depth limit below.',
    ...(teamConfig.enablePeerMessaging === true
      ? [
          '- Peer messaging is ON: members can talk to each other DIRECTLY via `agent_message` during their own turns. Members may consult each other before replying to you, so a reply you receive may already synthesize several teammates. Do NOT act as a relay between members; dispatch each member ONCE with an instruction like "use agent_message to ask your teammates directly", then let them talk.',
        ]
      : []),
    '',
    'Members available to you in this session:',
  ]
  for (const m of members) {
    const summary = m.description.trim().slice(0, 240)
    lines.push(`- id: ${m.id}`)
    lines.push(`  name: ${m.name}`)
    if (summary) lines.push(`  description: ${summary}`)
  }
  lines.push(
    '',
    'Tools:',
    '  - `mcp__spark_team__agent_dispatch` — delegate ONE subtask (serial; use when the next step depends on the previous reply).',
    '  - `mcp__spark_team__agent_dispatch_batch` — delegate MULTIPLE independent subtasks in PARALLEL (use when the user asks several members at once, or when tasks are unrelated).',
    '  - `mcp__spark_team__team_round_advance` — mark the current discussion round done (UI draws a divider, round counter advances). Call it once a round has gathered enough input, before starting the next round.',
    '  - `mcp__spark_team__team_conclude` — wrap up the whole discussion. No more dispatch/message after this.',
    '  - `mcp__spark_team__team_thread_read` — read back the shared discussion log (read-only). Use it when a member says "I already posted it" but you did not see the content, when a message was truncated with 〔省略 …〕, or when you need an earlier round\'s detail. Pass messageId for one message in full, or browse by round/fromAgentId with limit/offset.',
    '  (See the "How to reach a team member" box at the top for how these differ from built-in Task/SendMessage.)',
    '',
    'Guardrails:',
    `- You may call at most ${teamConfig.maxDepth} chained dispatch level(s).`,
    '- A quick question you can answer directly in one step does NOT need a dispatch round — handle it inline unless the user explicitly asked for a specific member.',
    '- Drive the session in EXPLICIT rounds (not open-ended looping): gather input from the right members this round, then call team_round_advance to close it; repeat until the objective is met, then call team_conclude. If a round is going in circles, summarize for the user instead of dispatching again.',
    '- KEEP THE SESSION ALIVE after dispatching members or subagents — do not end the conversation early to wait for their results; ending the session shuts down the in-flight subagents along with it. If you must end the turn while background work is still pending, set a session-level scheduled wake-up (session schedule, interval or one-shot) BEFORE ending the turn, so the session is woken later to collect the results.',
    '- Do NOT repeat, paraphrase, or list out member replies — they stream directly to the user in the chat UI. Stay silent and end the turn unless the user explicitly asked you to synthesize across members, you must ask a follow-up question, or a dispatch failed and you need to report what is missing.',
  )
  return lines.join('\n')
}

/**
 * Member 视角（FR-1）：被 dispatch 的成员看到的团队上下文。只在真实团队会话 +
 * enablePeerMessaging 时注入（Phase C 强制验收点：workflow 合成 teamConfig 路径绝不注入）。
 */
export function buildMemberRosterPrompt(
  host: AgentItem,
  viewingMember: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
  opts: TeamRosterPromptOptions,
): string {
  const others = members.filter((m) => m.id !== viewingMember.id)
  const exampleTeammate = others[0]
  const lines: string[] = [
    '[Team Roster]',
    `You are ${viewingMember.name} (${viewingMember.id}), a MEMBER of ${host.name}'s multi-agent team.`,
    `Session context: a human USER leads this session and sees every reply in the group chat; ${host.name} (id: ${host.id}) is the HOST agent that coordinates the team. Messages you receive come either from the host (dispatch), from a teammate (directed @), or from the user (@-mention).`,
    'You were dispatched with a specific subtask. Focus on that subtask and reply with your result; do not take over the whole session.',
    ...(opts.enablePeerMessaging
      ? [
          '',
          '════ How to reach a teammate — READ THIS BEFORE picking any tool ════',
          'Two different subagent systems exist in this runtime. They do NOT share address spaces:',
          '',
          '  1. TEAM MEMBERS (this roster, listed below): reachable ONLY via the MCP tool',
          '     `mcp__spark_team__agent_message`. Team members will NEVER appear in the built-in',
          '     `SendMessage` addressable list — that list only contains subagents you spawn yourself.',
          '',
          '  2. PRIVATE SUBAGENTS (built-in Task/SendMessage): a separate system for spawning your',
          '     own disposable helpers. Team members are NOT in this system. Trying to `SendMessage`',
          '     a teammate always fails with "No agent named X is currently addressable" — that error',
          '     literally means "wrong tool, switch to agent_message".',
          '',
          `  Correct (works):   mcp__spark_team__agent_message({ targetAgentId: "${exampleTeammate?.id ?? '<teammate-id-from-roster-below>'}", content: "..." })`,
          `  Wrong (will fail): SendMessage({ to: "${exampleTeammate?.name ?? '<teammate-name>'}", ... })`,
          '',
          '  If you see "not currently addressable" while trying to reach a teammate: DO NOT try a',
          '  different name/id with the same tool. Switch tools — call `mcp__spark_team__agent_message`',
          '  instead. Do not report the addressing failure to the user unless you have already tried',
          '  agent_message and it also failed.',
          '════════════════════════════════════════════════════════════════════',
        ]
      : []),
    '',
    'Core principles:',
    '- Stay in your lane. Do the dispatched subtask well — that is your contribution to the team.',
    ...(opts.enablePeerMessaging
      ? [
          '- The host orchestrates the overall plan; you OWN your subtask — including talking to teammates directly (via agent_message) whenever the subtask needs their input. Only the final result goes back to whoever asked.',
        ]
      : [
          '- The host orchestrates. Do not start broad re-planning or re-dispatch others on your own; reply with your result and let the host decide next steps.',
          '- Direct member-to-member messaging is currently DISABLED for this team (the user has not turned on peer messaging). You can SEE the roster below, but you cannot contact teammates yourself. If your task requires talking to a teammate, tell the user: enable "Peer Messaging" in the team settings (Inspector → Team), or route the request through the host. Do NOT claim teammates "do not exist" — they are listed below.',
        ]),
    ...(opts.enablePeerMessaging
      ? [
          '',
          '[Collaboration Playbook] — choose one mode per situation:',
          'MODE 1 · Answer directly: you have what you need — reply normally; your answer returns to whoever asked.',
          'MODE 2 · Consult first, then answer: you need input from teammate C before you can answer? Call `mcp__spark_team__agent_message({ targetAgentId: "<C>", mode: "call", content: "..." })` NOW, in this very turn. C runs immediately and their answer comes back in the tool result. You may consult several teammates, or the same teammate twice, before composing your final answer. Do NOT tell the asker "I need to check with C first" and end your turn — that wastes a round; check DURING your turn.',
          "MODE 3 · Hand off: the question is really for C? End your reply with `@C <the question + context>` — it auto-forwards and C's answer continues the thread.",
          'MODE 4 · Leave a note (async): the teammate does not need to act right now? Call `mcp__spark_team__agent_message({ targetAgentId: "<C>", mode: "note", content: "..." })`; C sees `[NOTE FOR YOU]` next time they run and nobody is interrupted. Broadcast note to everyone: omit targetAgentId.',
          '- Decision rule: if your current answer depends on the teammate reply, use MODE 2 call; if the teammate only needs to know something for later, use MODE 4 note.',
          '- MULTI-ROUND conversations: each call is one question→answer exchange. To hold a longer conversation, call agent_message AGAIN with your next message. Never write your reply to a teammate in your own answer text and wait — plain answer text is shown to the user only and the teammate will NEVER see it unless it @-mentions them.',
          // 双系统消歧已在成员 prompt 顶部的「How to reach a teammate」盒子里前置详述，此处
          // 只保留 dispatched-context 独有的 Task/SendMessage 禁用告知；mention 直答（Task/
          // SendMessage 保留）不需要额外说话，顶部盒子已经解释「switch tools when addressable
          // 失败」的正确策略。
          ...(opts.nativeSubagentToolsAvailable
            ? []
            : [
                '- Note: in this dispatched context the built-in `Task`/`SendMessage` subagent tools are disabled — see the top box; `agent_message` is your only inter-agent channel here.',
              ]),
          '- Do NOT immediately ping back the member who just @-messaged you (prevents ping-pong loops). Reply only when you have something substantive to add.',
        ]
      : []),
    '',
    ...(others.length > 0
      ? ['Other team members:']
      : ['You are currently the only active member in this team.']),
  ]
  for (const m of others) {
    const summary = m.description.trim().slice(0, 240)
    lines.push(`- id: ${m.id}`)
    lines.push(`  name: ${m.name}`)
    if (summary) lines.push(`  description: ${summary}`)
  }
  if (others.length > 0 && opts.enablePeerMessaging) {
    lines.push(
      '',
      "When calling team tools, pass the teammate's exact `id` from the list above in targetAgentId (a unique display name also resolves, but the id is unambiguous).",
    )
  }
  if (opts.threadSnippet != null && opts.threadSnippet.trim().length > 0) {
    lines.push('', '[Discussion So Far]', opts.threadSnippet.trim())
  }
  // team_thread_read 手册：无条件注入（只要成员在真实讨论里就有这个只读工具）。
  // 关键：[Discussion So Far] 是**截断预览**，长消息会被 〔省略 …〕 掉——务必让成员
  // 知道全文/更早历史怎么拿，否则会像现场 bug 那样「以为队友没发」。
  lines.push(
    '',
    '[Reading the group chat]',
    // 位置中立表述：dispatch 路径的快照在 user message 尾部，mention 直答路径的
    // 快照在本 roster 内手册上方——不写死方位，两条路径都成立。
    '- The "[Discussion So Far]" preview is TRUNCATED: long messages are cut with 〔省略 …〕 and older ones may be dropped. It is NOT the full log.',
    '- To read more, use `mcp__spark_team__team_thread_read` (read-only, notifies nobody):',
    '    • A teammate says they posted something but you only see a short line, or a message is cut with 〔省略 …〕 → call team_thread_read({ messageId: "<the id shown>" }) for the full text.',
    '    • You need earlier history or a specific round → browse: team_thread_read({ round: N }) or team_thread_read({ fromAgentId: "<teammate>", limit, offset }).',
    '- Do this BEFORE concluding a teammate "did not answer" or re-asking something already covered — the content is almost always already in the thread, just not in the preview.',
  )
  lines.push(
    '',
    'Guardrails:',
    `- Chained dispatch depth limit is ${teamConfig.maxDepth}.`,
    '- Do NOT repeat or summarize what other members already said — the host sees the shared thread. Reply with your own result only.',
  )
  return lines.join('\n')
}

/** 把 task 拼成传给 member 的 user message（instruction + attachments + expectedOutput） */
/**
 * 触发 workflow_run 的用户消息自带的附件（图片/文件/目录）→ dispatch 附件形状。
 * 沿用宿主自己那份 attachment 的做法：不搬运二进制内容，只把磁盘路径转发过去，
 * 被派发的 agent 拿到路径后自己用 Read 工具读——见 buildPromptWithAttachments
 * 里给宿主自己的同款指引，这里在 buildMemberUserMessage 渲染时补上同样的提示。
 */
export function mapSessionAttachmentsToDispatch(
  attachments: SessionAttachment[],
): WorkflowDispatchAttachment[] {
  return attachments.map((attachment) => ({
    type: attachment.type === 'image' ? 'image_ref' : 'file_ref',
    value: attachment.path,
  }))
}

export function buildMemberUserMessage(task: TeamA2ATask): string {
  const parts: string[] = [task.instruction]
  // task.inputs 承载 agent_dispatch 的结构化入参，也是 workflow_run 里 outputKey → 下游节点
  // inputs 状态传递的落地点（见 buildWorkflowNodeInputs）。此前这里从未渲染这个字段——数据算出来
  // 了，但 member 实际看到的 prompt 里从来没有它，等于整条 outputKey 状态传递链路是断的。
  if (task.inputs != null && Object.keys(task.inputs).length > 0) {
    parts.push('', '[Inputs]', JSON.stringify(task.inputs, null, 2))
  }
  if (task.attachments != null && task.attachments.length > 0) {
    parts.push('', '[Attachments]')
    const hasFileRef = task.attachments.some((att) => att.type !== 'text')
    for (const att of task.attachments) {
      parts.push(att.type === 'text' ? att.value : `${att.type}: ${att.value}`)
    }
    if (hasFileRef) {
      parts.push(
        'Use the Read tool on file_ref/image_ref paths above to inspect their content when relevant.',
      )
    }
  }
  if (task.expectedOutput != null) {
    parts.push('', `[Expected output] ${task.expectedOutput}`)
  }
  return parts.join('\n')
}

/**
 * P1-2（缓存命中优化）：member 的讨论线程快照 + ledger 摘要是随讨论增长的可变内容，
 * 按字节原样从 member system prompt 摘出拼成 per-dispatch 载荷块（只改位置不改写）。
 * 快照为空时省略 [Discussion So Far] 头（对齐 buildMemberRosterPrompt 里 threadSnippet
 * 的旧注入条件）；ledger 摘要恒非空（无记录时 renderActiveSummary 也有占位文案）。
 */
export function buildMemberDispatchThreadContext(
  threadSnippet: string,
  ledgerSummary: string,
): string | undefined {
  const blocks: string[] = []
  const snippet = threadSnippet.trim()
  if (snippet.length > 0) blocks.push(`[Discussion So Far]\n${snippet}`)
  const summary = ledgerSummary.trim()
  if (summary.length > 0) blocks.push(summary)
  if (blocks.length === 0) return undefined
  return blocks.join('\n\n')
}

/** team_thread_read 浏览模式：单条消息在列表里的最大正文字符数（超出提示用 messageId 读全文）。 */
export const THREAD_READ_BROWSE_CONTENT_CAP = 2000

/** team_thread_read 单条全文模式：完整呈现一条消息（不截断正文）。 */
export function formatThreadMessageFull(m: TeamThreadMessageRow): string {
  const target = m.target_agent_id ? ` → ${m.target_agent_id}` : ' → all'
  const delivery = m.delivery != null ? `, ${m.delivery}` : ''
  return [
    `id: ${m.id}`,
    `[R${m.round_index}] ${m.sender_agent_id}${target} (${m.kind}${delivery}) @ ${m.created_at}`,
    '',
    m.content,
  ].join('\n')
}

/** team_thread_read 浏览模式：单条消息的一段式呈现（正文超上限则截断并提示用 messageId 读全文）。 */
export function formatThreadMessageBrowse(m: TeamThreadMessageRow): string {
  const target = m.target_agent_id ? ` → ${m.target_agent_id}` : ' → all'
  const delivery = m.delivery != null ? `, ${m.delivery}` : ''
  let content = m.content
  if (content.length > THREAD_READ_BROWSE_CONTENT_CAP) {
    const head = content.slice(0, THREAD_READ_BROWSE_CONTENT_CAP).trimEnd()
    content = `${head}…〔省略 ${m.content.length - head.length} 字，team_thread_read(messageId: "${m.id}") 读全文〕`
  }
  return `[R${m.round_index}] ${m.sender_agent_id}${target} (${m.kind}${delivery}) · id=${m.id}\n${content}`
}

/**
 * 把「调用期间别人发到共享讨论的对等消息」格式化成一段附加到工具结果的增量文本。
 *
 * 场景（现场 bug）：A 定向 call / dispatch 了 B，B 在自己 turn 内向群里广播了一份长消息，
 * 但 A 只拿到 B 的最终回复，看不到那条广播。这里把这些「同期广播」以预览形式回流给 A，
 * A 想看全文可用 team_thread_read。已按 sender != caller 过滤（A 自己发的不回流），
 * 且只含 peer_message（member_reply 通过回复链本就返回，不重复展示）。
 *
 * @returns 无可回流消息时返回 null（handler 据此决定是否拼接）。
 */
export function formatPeerBroadcastDelta(
  messages: TeamThreadMessageRow[],
  callerAgentId: string,
): string | null {
  const others = messages.filter((m) => m.sender_agent_id !== callerAgentId)
  if (others.length === 0) return null
  return [
    `[Meanwhile in the shared discussion — ${others.length} message(s) other members posted during this call; read full text with team_thread_read]`,
    ...others.map((m) => formatThreadMessageBrowse(m)),
  ].join('\n\n')
}

/** 把 member 的结构化回复格式化成给 Host LLM 看的工具结果文本（UI 不渲染此文本） */
export function formatReplyForHost(reply: import('@spark/protocol').TeamA2AReply): string {
  const usage = reply.usage
  const meta = [
    `member=${reply.memberName != null ? `${reply.memberName} (${reply.memberAgentId})` : reply.memberAgentId}`,
    `state=${reply.state}`,
    usage?.durationMs != null ? `${usage.durationMs}ms` : null,
    usage?.inputTokens != null && usage?.outputTokens != null
      ? `${usage.inputTokens}→${usage.outputTokens} tok`
      : null,
    reply.error != null ? `code=${reply.error.code}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const header = `[Member Reply · ${meta}]`
  if (reply.state !== 'completed') {
    const errorLine = reply.error?.message ?? '(no content)'
    // 超时/取消但保留了部分产出时，把已产出内容一并带给 Host，避免盲目重派丢工作。
    const partial = reply.content.trim()
    return partial.length > 0
      ? `${header}\n${errorLine}\n\n[Partial output]\n${reply.content}`
      : `${header}\n${errorLine}`
  }
  const artifactsLine =
    reply.artifacts != null && reply.artifacts.length > 0
      ? `\n(artifacts: ${reply.artifacts.map((a) => a.name ?? a.type).join(', ')})`
      : ''
  return `${header}\n${reply.content}${artifactsLine}`
}

export function collectManagedRuleContents(
  rulesRepo: RulesRepository,
  agent: AgentItem,
  workflow: WorkflowItem | null,
): string[] {
  const ruleIds = new Set(agent.ruleIds)
  const graph = workflow != null ? normalizeWorkflowGraph(workflow.graph) : null
  for (const node of graph?.nodes ?? []) {
    const configured = node.config.ruleIds
    if (!Array.isArray(configured)) continue
    for (const id of configured) {
      if (typeof id === 'string' && id.trim().length > 0) ruleIds.add(id)
    }
  }
  if (ruleIds.size === 0) return []
  const allRules = rulesRepo.list().filter((rule) => rule.enabled === 1)
  return allRules
    .filter((rule) => ruleIds.has(rule.id))
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => `[${rule.name}]\n${rule.content}`)
}

export function buildRuntimeRulesPrompt(rules: string[]): string | undefined {
  const unique = Array.from(new Set(rules.map((rule) => rule.trim()).filter(Boolean)))
  if (unique.length === 0) return undefined
  return ['[Runtime Rules]', ...unique.map((rule, index) => `${index + 1}. ${rule}`)].join('\n\n')
}

export async function checkCommandAvailable(command: string, cwd: string | null): Promise<boolean> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)
  try {
    await execAsync(command, { cwd: cwd ?? undefined, timeout: 5000, maxBuffer: 64 * 1024 })
    return true
  } catch {
    return false
  }
}

export async function checkWorkspaceShellAvailable(
  cwd: string | null,
): Promise<{ available: boolean; shell?: string; error?: string }> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)
  const shell = process.env.SHELL
  const withShell = (result: {
    available: boolean
    error?: string
  }): { available: boolean; shell?: string; error?: string } => ({
    ...result,
    ...(shell != null ? { shell } : {}),
  })
  try {
    const { stdout } = await execAsync('echo spark-shell-ok', {
      cwd: cwd ?? undefined,
      timeout: 5000,
      maxBuffer: 64 * 1024,
    })
    return stdout.includes('spark-shell-ok')
      ? withShell({ available: true })
      : withShell({ available: false, error: 'unexpected shell output' })
  } catch (err) {
    return withShell({ available: false, error: err instanceof Error ? err.message : String(err) })
  }
}

export async function checkOpenAISdkAvailable(): Promise<boolean> {
  try {
    await import('openai')
    return true
  } catch {
    return false
  }
}

export async function getWorkspaceRootIssue(rootPath: string): Promise<string | null> {
  try {
    const info = await stat(rootPath)
    return info.isDirectory() ? null : 'Workspace path exists but is not a directory'
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  }
}

export function getChatModeFromSession(value: string | null | undefined): SessionChatMode {
  if (value === 'ask' || value === 'edit' || value === 'review') return value
  return 'agent'
}

/** 从 session.metadata_json 解析导入来源（用于侧边栏来源徽标）；非导入会话返回 null */
export function getImportedFromMetadata(
  metadataJson: string | null | undefined,
): HistoryImportSource | null {
  if (metadataJson == null || metadataJson === '') return null
  try {
    const meta = JSON.parse(metadataJson) as { importedFrom?: unknown }
    if (meta.importedFrom === 'claude-code' || meta.importedFrom === 'codex')
      return meta.importedFrom
  } catch {
    // 忽略损坏的 metadata
  }
  return null
}

/** 从 session.metadata_json 解析调试模式开关（per-session 能力开关，缺省 false）。 */
export function getDebugModeFromMetadata(metadataJson: string | null | undefined): boolean {
  if (metadataJson == null || metadataJson === '') return false
  try {
    const meta = JSON.parse(metadataJson) as { debugMode?: unknown }
    return meta.debugMode === true
  } catch {
    return false
  }
}

export function getCliSparkOverrideFromMetadata(
  metadataJson: string | null | undefined,
): CliSparkOverride | null {
  if (metadataJson == null || metadataJson === '') return null
  try {
    const meta = JSON.parse(metadataJson) as {
      cliSparkOverride?: { providerProfileId?: unknown; modelId?: unknown } | null
    }
    const override = meta.cliSparkOverride
    if (override == null || typeof override !== 'object') return null
    const providerProfileId =
      typeof override.providerProfileId === 'string' ? override.providerProfileId.trim() : ''
    const modelId = typeof override.modelId === 'string' ? override.modelId.trim() : ''
    if (providerProfileId.length === 0 || modelId.length === 0) return null
    return { providerProfileId, modelId }
  } catch {
    return null
  }
}

export function normalizeCliSparkOverride(
  value: CliSparkOverride | null | undefined,
): CliSparkOverride | null {
  if (value == null) return null
  const providerProfileId =
    typeof value.providerProfileId === 'string' ? value.providerProfileId.trim() : ''
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : ''
  if (providerProfileId.length === 0 || modelId.length === 0) {
    throw new Error('cliSparkOverride requires providerProfileId and modelId')
  }
  return { providerProfileId, modelId }
}

export function getAutomationMetadata(metadataJson: string | null | undefined): {
  unattended: boolean
  source: string | null
} {
  if (metadataJson == null || metadataJson === '') {
    return { unattended: false, source: null }
  }
  try {
    const meta = JSON.parse(metadataJson) as {
      automation?: { unattended?: unknown; source?: unknown } | null
    }
    const automation = meta.automation
    if (automation == null || typeof automation !== 'object') {
      return { unattended: false, source: null }
    }
    return {
      unattended: automation.unattended === true,
      source: typeof automation.source === 'string' ? automation.source : null,
    }
  } catch {
    return { unattended: false, source: null }
  }
}

/**
 * 判断排队 turn 的 runtimePatch 是否只携带 provider/model 选择（文本注入等价）。
 * - 返回 false：patch 含 agent/权限/模式/skill 等其他字段，turn 不能被迭代内联消费；
 * - 返回 null：可以内联，且没有需要持久化的运行时选择；
 * - 返回对象：可以内联，并把该选择持久化到会话运行时（用户插话时切了模型）。
 * 渲染端每条消息都携带当前 provider/model，若把「带 patch」一律视为不可排空，
 * goal 插话注入将永远无法触发。
 */
export function pickGoalDrainableRuntimeSelection(
  patch: SessionRuntimePatch | undefined,
): { providerProfileId?: string; modelId?: string } | null | false {
  if (patch == null) return null
  const isRuntimeOnly = Object.keys(patch).every(
    (key) => key === 'providerProfileId' || key === 'modelId',
  )
  if (!isRuntimeOnly) return false
  const selection: { providerProfileId?: string; modelId?: string } = {}
  if (patch.providerProfileId != null && patch.providerProfileId.trim().length > 0) {
    selection.providerProfileId = patch.providerProfileId
  }
  if (patch.modelId != null && patch.modelId.trim().length > 0) selection.modelId = patch.modelId
  return Object.keys(selection).length > 0 ? selection : null
}

export function getRuntimePatch(params: SessionRuntimePatch): SessionRuntimePatch | undefined {
  const patch: SessionRuntimePatch = {}
  if (params.providerProfileId !== undefined) patch.providerProfileId = params.providerProfileId
  if (params.modelId !== undefined) patch.modelId = params.modelId
  if (params.agentId !== undefined) patch.agentId = params.agentId
  if (params.skillIds !== undefined) patch.skillIds = params.skillIds
  if (params.agentAdapter !== undefined) patch.agentAdapter = params.agentAdapter
  if (params.permissionMode !== undefined) patch.permissionMode = params.permissionMode
  if (params.chatMode !== undefined) patch.chatMode = params.chatMode
  if (params.reasoningEffort !== undefined) patch.reasoningEffort = params.reasoningEffort
  return Object.keys(patch).length > 0 ? patch : undefined
}

export function getProviderModelIds(configJson: string | null | undefined): string[] {
  if (configJson == null) return []
  try {
    const config = JSON.parse(configJson) as {
      defaultModel?: unknown
      model?: unknown
      modelIds?: unknown
    }
    const models = [
      typeof config.defaultModel === 'string' ? config.defaultModel : undefined,
      typeof config.model === 'string' ? config.model : undefined,
      ...(Array.isArray(config.modelIds)
        ? config.modelIds.filter((item): item is string => typeof item === 'string')
        : []),
    ]
    return Array.from(
      new Set(models.filter((model): model is string => model != null && model.trim().length > 0)),
    )
  } catch {
    return []
  }
}

export function isCliSparkOverrideCompatible(
  cliProvider: Pick<ProviderProfileRow, 'id'>,
  overrideProvider: Pick<ProviderProfileRow, 'provider_type'>,
  overrideConfig: { codexApiKind?: 'chat' | 'responses' },
): boolean {
  if (isLocalCodexCliProvider(cliProvider)) {
    return (
      overrideProvider.provider_type !== 'anthropic' &&
      (overrideConfig.codexApiKind == null ||
        overrideConfig.codexApiKind === 'chat' ||
        overrideConfig.codexApiKind === 'responses')
    )
  }
  return overrideProvider.provider_type === 'anthropic'
}

export function getLocalCliDefaultModel(provider: { id: string }): string {
  return isLocalCodexCliProvider(provider) ? LOCAL_CODEX_CLI_DEFAULT_MODEL : LOCAL_CLI_DEFAULT_MODEL
}

export function providerRowsForModelRouter(
  rows: Array<{ id: string; provider_type: string; config_json: string; enabled: number }>,
): ModelRouterProvider[] {
  return rows
    .filter((row) => row.enabled !== 0)
    .map((row) => {
      const config = parseProviderConfigForModelRouter(row.config_json)
      return {
        id: row.id,
        provider: row.provider_type,
        defaultModel:
          stringConfigValue(config.defaultModel) ?? stringConfigValue(config.model) ?? '',
        modelIds: Array.isArray(config.modelIds)
          ? config.modelIds.filter((item): item is string => typeof item === 'string')
          : [],
        ...(isKnownModelType(config.modelType) ? { modelType: config.modelType } : {}),
        ...(typeof config.mediaProvider === 'string'
          ? { mediaProvider: config.mediaProvider }
          : {}),
        ...(Array.isArray(config.mediaCapabilities)
          ? {
              mediaCapabilities: config.mediaCapabilities.filter(
                (item): item is string => typeof item === 'string',
              ),
            }
          : {}),
      }
    })
}

export function parseProviderConfigForModelRouter(configJson: string): Record<string, unknown> {
  try {
    return JSON.parse(configJson) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function stringConfigValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function isKnownModelType(
  value: unknown,
): value is NonNullable<ModelRouterProvider['modelType']> {
  return (
    value === 'image' ||
    value === 'text' ||
    value === 'multimodal' ||
    value === 'voice' ||
    value === 'video'
  )
}

export function buildCodexCliModelProviderConfig(params: {
  providerProfileId: string
  providerName: string
  apiEndpoint?: string
  apiKind: 'chat' | 'responses'
  apiKey: string
}): NonNullable<SDKExecutorConfig['codexCliProvider']> {
  const envKey = `SPARK_CODEX_API_KEY_${params.providerProfileId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
  return {
    id: `spark_${params.providerProfileId}`,
    name: params.providerName,
    wireApi: params.apiKind,
    ...(params.apiEndpoint != null && params.apiEndpoint.trim().length > 0
      ? { baseUrl: params.apiEndpoint.trim() }
      : { baseUrl: 'https://api.openai.com/v1' }),
    envKey,
    env: { [envKey]: params.apiKey },
  }
}

/**
 * FR-0a：为团队成员按 adapter 解析执行器档位与 codex sdkConfig 扩展字段。
 * 与 Host 主循环 codex 分支（~1901-1920）对称；抽此纯函数便于单测 + 防 Host/member 漂移。
 *
 * - claude 成员 → permissionMode 'claude-auto'、无 codex 扩展（走 ClaudeSDKExecutor）
 * - codex 成员 → permissionMode 'codex-auto-review'（→ acceptEdits / workspace-write），并按
 *   isLocalCli/providerType/codexApiKind 构造 useLocalConfig/codexApiKind/codexCliProvider，
 *   供 createCodexExecutorForConfig 选 CodexCli/CodexOpenAI/CodexSdk 执行器。
 *
 * 注：原方案 6.8 节写的 'codex-auto' 不在 SparkPermissionMode 联合类型内（非法字面量），
 * 故取语义最近的 codex-auto-review。
 */
export function resolveCodexMemberExecutionProfile(args: {
  memberAdapter: AgentAdapterKind
  isLocalCli: boolean
  cliSparkOverride?: boolean
  providerType: string
  providerProfileId: string
  providerName: string
  apiKey: string
  codexApiKind?: 'chat' | 'responses' | undefined
  apiEndpoint?: string | undefined
}): {
  isCodexMember: boolean
  permissionMode: SDKExecutorConfig['permissionMode']
  extras: {
    useLocalConfig?: true
    codexApiKind?: 'chat' | 'responses'
    codexCliProvider?: SDKExecutorConfig['codexCliProvider']
  }
} {
  const isCodexMember = resolveEngineKind(args.memberAdapter) === 'codex'
  const permissionMode: SDKExecutorConfig['permissionMode'] = isCodexMember
    ? 'codex-auto-review'
    : 'claude-auto'
  // useLocalConfig 对 claude/codex 本地 CLI provider 都需要（走宿主本地配置/OAuth）；
  // codexApiKind/codexCliProvider 是 codex 专属，仅 codex 成员构造——claude 成员即便挂在
  // 非 anthropic provider 下也不注入，保持与改动前逐字节一致。
  const extras: {
    useLocalConfig?: true
    codexApiKind?: 'chat' | 'responses'
    codexCliProvider?: SDKExecutorConfig['codexCliProvider']
  } = {
    ...(args.isLocalCli && (args.cliSparkOverride !== true || isCodexMember)
      ? { useLocalConfig: true as const }
      : {}),
    ...(isCodexMember
      ? {
          ...(args.codexApiKind != null ? { codexApiKind: args.codexApiKind } : {}),
          ...((!args.isLocalCli || args.cliSparkOverride === true) &&
          args.providerType !== 'anthropic'
            ? {
                codexCliProvider: buildCodexCliModelProviderConfig({
                  providerProfileId: args.providerProfileId,
                  providerName: args.providerName,
                  apiKind: args.codexApiKind ?? 'responses',
                  apiKey: args.apiKey,
                  ...(args.apiEndpoint !== undefined ? { apiEndpoint: args.apiEndpoint } : {}),
                }),
              }
            : {}),
        }
      : {}),
  }
  return { isCodexMember, permissionMode, extras }
}

export function getLatestMatchingTurnPromptSnapshot(
  eventRepo: EventRepository,
  sessionId: string,
  expected: {
    model: string
    providerProfileId: string
    adapterKind: 'claude-sdk' | 'codex'
    sdkSessionId: string
  },
): {
  model: string
  providerProfileId?: string
  adapterKind: 'claude-sdk' | 'codex'
  sdkSessionId?: string
} | null {
  const row = eventRepo.getLatestByTypeAndJsonValue(
    sessionId,
    'turn_prompt_snapshot',
    '$.sdkSessionId',
    expected.sdkSessionId,
  )
  if (row == null) return null
  try {
    const event = JSON.parse(row.event_json) as AgentEvent
    if (event.type !== 'turn_prompt_snapshot') return null
    if (
      event.model !== expected.model ||
      event.adapterKind !== expected.adapterKind ||
      event.providerProfileId !== expected.providerProfileId ||
      event.sdkSessionId !== expected.sdkSessionId
    ) {
      return null
    }
    return {
      model: event.model,
      adapterKind: event.adapterKind,
      ...(event.providerProfileId !== undefined
        ? { providerProfileId: event.providerProfileId }
        : {}),
      ...(event.sdkSessionId !== undefined ? { sdkSessionId: event.sdkSessionId } : {}),
    }
  } catch {
    return null
  }
}

export function joinPromptSections(...sections: Array<string | undefined>): string | undefined {
  const joined = sections
    .map((section) => section?.trim())
    .filter((section): section is string => section != null && section.length > 0)
    .join('\n\n')
  return joined.length > 0 ? joined : undefined
}

export function makeRuntimeLoadStatus(
  key: string,
  label: string,
  content: string | undefined,
  itemCount?: number,
): {
  key: string
  label: string
  loaded: boolean
  charCount: number
  itemCount?: number
} {
  const charCount = content?.trim().length ?? 0
  return {
    key,
    label,
    loaded: charCount > 0 || (itemCount ?? 0) > 0,
    charCount,
    ...(itemCount !== undefined ? { itemCount } : {}),
  }
}

export function filterCliCompatibleMcpServers(
  servers: Record<string, SDKMcpServerConfig>,
): Record<string, SDKMcpServerConfig> {
  const result: Record<string, SDKMcpServerConfig> = {}
  for (const [name, server] of Object.entries(servers)) {
    if (server.type === 'sdk') continue
    if (server.command == null && server.url == null) continue
    result[name] = server
  }
  return result
}

export function formatSelectedSkillPrompt(skillId: string, prompt: string): string {
  // IMPORTANT: do NOT use the word "Skill" as a label here. The Claude Code SDK
  // preset registers a built-in `Skill` tool (for loading Anthropic-shipped
  // skills from disk); if the LLM sees "[Selected Skill: <id>]" it will try
  // to call that tool with our custom id, which fails with "Unknown skill".
  // Our custom skills are already fully expanded into the system prompt
  // below — the agent should act on them directly, not via any tool dispatch.
  return [
    `## Active capability: ${skillId}`,
    'The full instructions for this capability are inlined below. Follow them directly. Do NOT call the built-in `Skill` tool to load it — it is already loaded.',
    prompt,
  ].join('\n\n')
}

export function listSkillSummaries(
  skillRepo: SkillRepository,
  workspacePath?: string | null,
  query?: string,
): Array<{ id: string; name: string; description: string; tags: string[]; enabled: boolean }> {
  const loader = new SkillLoader(skillRepo)
  const infos = query?.trim() ? loader.search(query) : loader.listEnabled()
  const runtimeSkills = infos
    .filter((info) => {
      if (info.builtin) return true
      return info.dbRecord?.enabled === true
    })
    .map((info) => {
      const def = info.definition
      if (def != null) {
        return {
          id: def.id,
          name: def.name,
          description: def.description,
          tags: def.tags,
          enabled: true,
        }
      }
      return {
        id: info.dbRecord?.id ?? '',
        name: info.dbRecord?.name ?? '',
        description: '',
        tags: [],
        enabled: info.dbRecord?.enabled === true,
      }
    })
    .filter((skill) => skill.id.length > 0)
  const projectSkills = new ProjectContextService()
    .listSkillSummaries(workspacePath ?? undefined)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: [],
      enabled: true,
    }))
    .filter((skill) => {
      const q = query?.trim().toLowerCase()
      if (!q) return true
      return (
        skill.id.toLowerCase().includes(q) ||
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q)
      )
    })
  return uniqueSkillSummaries([...runtimeSkills, ...projectSkills])
}

export function uniqueSkillSummaries<T extends { id: string }>(skills: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const skill of skills) {
    if (seen.has(skill.id)) continue
    seen.add(skill.id)
    result.push(skill)
  }
  return result
}

export function isComputerVisionCandidate(provider: ProviderProfileRow): boolean {
  const config = parseComputerProviderConfig(provider.config_json)
  return (
    (config.modelType == null || config.modelType === 'multimodal') &&
    (typeof config.defaultModel === 'string' || typeof config.model === 'string')
  )
}

export function computerVisionCandidateScore(provider: ProviderProfileRow): number {
  const config = parseComputerProviderConfig(provider.config_json)
  return (
    (config.codexApiKind === 'responses' ? 100 : 0) +
    (config.modelType === 'multimodal' ? 10 : 0) +
    (provider.is_default === 1 ? 1 : 0)
  )
}

export function parseComputerProviderConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** 历史加载时单个 prompt 段落内容的字符上限（超出截断，原始长度仍由 charCount 记录）。 */
export const HISTORY_PROMPT_SECTION_CHAR_CAP = 800

/**
 * trimHistoryEvent — 历史加载时裁剪超大事件载荷。
 *
 * 目前针对 turn_prompt_snapshot.systemPromptSections：完整系统提示词（CLAUDE.md/技能/
 * 工具/项目上下文）按「每回合」存一份，1M 上下文打满时单字段可达数 MB，每次加载、每回合
 * 都要序列化+传输+解析，是大会话卡顿的主因之一。这里把每段 content 截断到上限，charCount
 * 仍保留真实长度，Inspector 可据此提示「已截断」。其余字段（label/charCount/模型/工具数等）
 * 不动，提示词审计的概览仍可用；如需完整内容可后续按需单独拉取。
 */
export function trimHistoryEvent(event: AgentEvent): AgentEvent {
  if (event.type !== 'turn_prompt_snapshot') return event
  const sections = event.systemPromptSections
  if (!Array.isArray(sections) || sections.length === 0) return event
  let trimmedAny = false
  const trimmedSections = sections.map((section) => {
    if (
      typeof section.content === 'string' &&
      section.content.length > HISTORY_PROMPT_SECTION_CHAR_CAP
    ) {
      trimmedAny = true
      return { ...section, content: section.content.slice(0, HISTORY_PROMPT_SECTION_CHAR_CAP) }
    }
    return section
  })
  if (!trimmedAny) return event
  return { ...event, systemPromptSections: trimmedSections }
}

export function toProtocolLineage(
  row: import('@spark/storage').SessionLineageRow | null,
): SessionLineage | null {
  if (row == null) return null
  return {
    childSessionId: row.child_session_id as SessionId,
    parentSessionId: row.parent_session_id as SessionId,
    forkAnchorTurnId: row.fork_anchor_turn_id as import('@spark/protocol').TurnId | null,
    forkCutoffSeq: row.fork_cutoff_seq,
    sourceTitleSnapshot: row.source_title_snapshot,
    ...(row.child_title != null ? { childTitle: row.child_title } : {}),
    createdAt: row.created_at,
  }
}

export function toProtocolCandidate(
  row: import('@spark/storage').SessionReferenceCandidate,
): SessionReferenceCandidate {
  return {
    sessionId: row.sessionId as SessionId,
    title: row.title,
    projectId: row.projectId,
    workspaceIds: row.workspaceIds,
    status: row.status,
    archived: row.archived,
    updatedAt: row.updatedAt,
    latestCompletedSeq: row.latestCompletedSeq,
    latestCompletedTurnId: row.latestCompletedTurnId as import('@spark/protocol').TurnId | null,
    turnCount: row.turnCount,
  }
}

export function toProtocolReference(
  row: import('@spark/storage').SessionReferenceView,
): SessionReference {
  return {
    id: row.id,
    targetSessionId: row.targetSessionId as SessionId,
    sourceSessionId: row.sourceSessionId as SessionId,
    title: row.title,
    sourceTitleSnapshot: row.sourceTitleSnapshot,
    projectId: row.projectId,
    snapshotSeq: row.snapshotSeq,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    turnCount: row.turnCount,
  }
}

export function toProtocolReferenceTurn(
  row: StoredReferencedSessionTurn,
): import('@spark/protocol').ReferencedSessionTurn {
  return {
    turnId: row.turnId as import('@spark/protocol').TurnId,
    userMessage: row.userMessage,
    assistantMessages: row.assistantMessages,
    activities: row.activities,
    firstSeq: row.firstSeq,
    lastSeq: row.lastSeq,
  }
}

export function normalizeCustomCommandConfig(value: unknown): CustomCommandConfig | null {
  if (value == null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const name = typeof record.name === 'string' ? record.name : ''
  if (!id || !name) return null
  return {
    id,
    name,
    description: typeof record.description === 'string' ? record.description : '',
    prompt: typeof record.prompt === 'string' ? record.prompt : '',
    script: typeof record.script === 'string' ? record.script : '',
    scriptLanguage: record.scriptLanguage === 'python' ? 'python' : 'javascript',
    enabled: record.enabled !== false,
  }
}
