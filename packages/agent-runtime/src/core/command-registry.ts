/**
 * CommandRegistry — 三层命令注册表
 *
 * 三层架构:
 *   Layer 1: SDK 兼容命令（Claude Agent SDK / Codex SDK；未在 Spark 本地实现的命令透传给 Agent）
 *   Layer 2: 程序内置命令（Session/Model/Context/Permission/...）
 *   Layer 3: Agent 技能命令（Skill manifest 注册）
 *
 * 命令按 12 个分组展示:
 *   session / model / context / permission / workflow / agent / mcp / skill / resource / team / git / utility / system
 */

import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ParsedCommand } from './command-parser.js'

/* ============================================================
   Types
   ============================================================ */

/** 命令来源层 */
export type CommandLayer = 'sdk' | 'builtin' | 'skill' | 'custom'

/** 命令分组 */
export type CommandGroup =
  | 'session'
  | 'model'
  | 'context'
  | 'permission'
  | 'workflow'
  | 'agent'
  | 'mcp'
  | 'skill'
  | 'resource'
  | 'team'
  | 'git'
  | 'utility'
  | 'system'

/** 命令作用域 */
export type CommandScope = 'global' | 'workspace' | 'session' | 'workflow' | 'team'

/** 风险等级 */
export type CommandRisk = 'none' | 'low' | 'medium' | 'high'

export interface CommandPaletteMeta {
  /** Hide from Cmd/Ctrl+K while keeping the slash command available when typed manually. */
  hidden?: boolean
}

/** 命令上下文 */
export interface CommandContext {
  sessionId: string
  workspaceId?: string
  providerId?: string
  model?: string
}

/** 命令执行结果 */
export interface CommandResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
  /** 若为 true，调用方应将原始命令文本透传给 Agent 执行，而非本地处理 */
  forwardToAgent?: boolean
  /** Optional follow-up user message to enqueue after the command result is shown. */
  followUpPrompt?: string
  /** Optional Skill ID whose full instructions should be forced into the follow-up turn. */
  followUpSkillId?: string
  /** Optional parameters for the forced follow-up skill. */
  followUpSkillParams?: Record<string, unknown>
  /**
   * 若为 true，本次命令意味着「会话历史已被清空」，executeCommandAsEvents 在注入
   * 后续 user/assistant/completed 事件前会先 emit 一条 SessionHistoryResetEvent，
   * renderer 借此把本地缓存（消息/状态/上下文）清空，让 CLI 风格的「清空 → 已清空」
   * 流程在 UI 上正确呈现。
   */
  wipeHistory?: boolean
}

export interface CheckpointSnapshot {
  checkpointId: string
  label?: string
  path?: string
  filePaths?: string[]
  timestamp?: string
  /** SDK 会话 id：restore 时 resume 出 Query 调 rewindFiles(checkpointId)。有此值即可还原。 */
  sdkSessionId?: string
}

export interface CheckpointRestoreResult {
  checkpointId: string
  restoredFiles: string[]
  missingFiles: string[]
}

/** 命令定义（三层架构统一接口） */
export interface CommandDefinition {
  /** 唯一 ID */
  id: string
  /** 命令名（不含 /） */
  name: string
  /** 别名列表 */
  aliases: string[]
  /** 来源层 */
  layer: CommandLayer
  /** 命令分组 */
  group: CommandGroup
  /** 描述 */
  description: string
  /** 作用域 */
  scope: CommandScope
  /** 风险等级 */
  risk: CommandRisk
  /** 命令面板展示元数据 */
  palette?: CommandPaletteMeta
  /** 用法提示 */
  usage?: string
  /** 是否支持子命令 */
  hasSubcommands?: boolean
  /** 命令执行 handler */
  handler: (cmd: ParsedCommand, ctx: CommandContext, deps: CommandDeps) => Promise<CommandResult>
}

/** 命令执行所需的外部依赖（由 SessionService 注入） */
export interface CommandDeps {
  getSession: (id: string) => { title: string; status: string; modelId: string | null; providerProfileId: string; agentAdapter?: string; permissionMode?: string; agentId?: string | null } | null
  updateSession: (id: string, fields: { modelId?: string | null; title?: string }) => Promise<void>
  clearSessionEvents: (id: string) => Promise<void>
  getProviderName: (id: string) => string | null
  getProviderModelIds?: (id: string) => string[]
  setApprovalMode: (sessionId: string, enabled: boolean) => void
  /** 获取 workspace 文件路径 */
  getWorkspacePath?: () => string | null
  /** 执行 shell 命令 */
  execShell?: (command: string, cwd?: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  /** 获取会话事件数量 */
  getSessionEventCount?: (id: string) => number
  /** 获取当前 session 的 usage 统计 */
  getSessionUsage?: (id: string) => { totalInputTokens: number; totalOutputTokens: number; totalCost: number } | null
  listSessionCheckpoints?: (id: string) => CheckpointSnapshot[]
  restoreCheckpoint?: (sessionId: string, checkpointRef: string) => Promise<CheckpointRestoreResult>
  getCheckpointEnabled?: (sessionId: string) => boolean
  setCheckpointEnabled?: (sessionId: string, enabled: boolean) => boolean
  listSkills?: (query?: string) => Array<{ id: string; name: string; description: string; tags: string[]; enabled: boolean }>
  getSessionRuntimeInfo?: (sessionId: string) => { providerProfileId?: string | null; providerName?: string | null; modelId?: string | null; agentAdapter?: string | null; permissionMode?: string | null } | null
  checkSdkAvailability?: () => Promise<{ claudeSdk: boolean; codexCli: boolean; openaiSdk: boolean }>
  checkWorkspaceShell?: (cwd?: string | null) => Promise<{ available: boolean; shell?: string; error?: string }>
  getMcpStatusSummary?: () => Array<{ id: string; name: string; enabled: boolean; connected: boolean; toolCount: number; error?: string }>
  getCurrentAgentSummary?: (sessionId: string) => { id: string; name: string; exists: boolean; enabled: boolean; hasModelConfig: boolean; providerProfileId?: string | null; modelId?: string | null } | null
  setGoal?: (sessionId: string, objective: string, options?: { successCriteria?: string[]; validationCommands?: string[] }) => Promise<Record<string, unknown>>
  getGoal?: (sessionId: string) => Record<string, unknown> | null
  controlGoal?: (sessionId: string, action: 'pause' | 'resume' | 'clear' | 'complete', summary?: string) => Promise<Record<string, unknown> | null>
  confirmGoalContract?: (sessionId: string) => Promise<Record<string, unknown> | null>
  rejectGoalContract?: (sessionId: string) => Promise<Record<string, unknown> | null>
}


/** 命令面板展示用的轻量类型 */
export interface CommandListItem {
  id: string
  name: string
  aliases: string[]
  layer: CommandLayer
  group: CommandGroup
  description: string
  scope: CommandScope
  risk: CommandRisk
  palette?: CommandPaletteMeta
  usage?: string
  hasSubcommands?: boolean
}

export type CustomCommandScriptLanguage = 'javascript' | 'python'

export interface CustomCommandConfig {
  id: string
  name: string
  description: string
  prompt: string
  script: string
  scriptLanguage: CustomCommandScriptLanguage
  enabled: boolean
}

/* ============================================================
   Helpers
   ============================================================ */

/** Convert a skill name to a slug suitable for a slash command. */
const GIT_LOG_LIMIT_USAGE = '用法：/git log [n]（n 必须是 1-100 的正整数）'

function parseGitLogLimit(value: string | undefined): number | null {
  const raw = value ?? '10'
  if (!/^[1-9]\d*$/.test(raw)) return null

  const limit = Number(raw)
  if (!Number.isSafeInteger(limit) || limit > 100) return null

  return limit
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function normalizeCustomCommandName(name: string): string {
  return name.trim().replace(/^\//, '').toLowerCase()
}

export function isValidCustomCommandName(name: string): boolean {
  return /^[a-z][a-z0-9-]{1,62}$/.test(normalizeCustomCommandName(name))
}

function clipCommandSectionOutput(output: string, maxLength = 4000): string {
  return output.length > maxLength ? `${output.slice(0, maxLength)}\n... output truncated ...` : output
}

/* ============================================================
   Command Registry
   ============================================================ */

/** 支持子命令的命令集合 */
const SUBCOMMAND_COMMANDS = new Set([
  'skill',
  'checkpoint',
  'git',
  'goal',
])

function forwardToAgent(message = ''): CommandResult {
  return { success: true, message, forwardToAgent: true }
}

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>()
  private aliasIndex = new Map<string, string>()  // alias → command name

  register(def: CommandDefinition): void {
    this.commands.set(def.name, def)
    // Index aliases for lookup
    for (const alias of def.aliases) {
      this.aliasIndex.set(alias, def.name)
    }
  }

  /** Remove all Layer 3 skill commands (called before re-registration) */
  clearSkillCommands(): void {
    for (const [name, def] of this.commands) {
      if (def.layer === 'skill') {
        this.commands.delete(name)
        for (const alias of def.aliases) {
          this.aliasIndex.delete(alias)
        }
      }
    }
  }

  clearCustomCommands(): void {
    for (const [name, def] of this.commands) {
      if (def.layer !== 'custom') continue
      this.commands.delete(name)
      for (const alias of def.aliases) {
        this.aliasIndex.delete(alias)
      }
    }
  }

  registerCustomCommands(customCommands: CustomCommandConfig[]): void {
    this.clearCustomCommands()
    for (const custom of customCommands) {
      if (!custom.enabled || !isValidCustomCommandName(custom.name)) continue
      const name = normalizeCustomCommandName(custom.name)
      if (this.commands.has(name) && this.commands.get(name)!.layer !== 'custom') continue
      this.register({
        id: `custom:${custom.id}`,
        name,
        aliases: [],
        layer: 'custom',
        group: 'utility',
        description: custom.description.trim() || `自定义命令 /${name}`,
        scope: 'session',
        risk: custom.script.trim().length > 0 ? 'medium' : 'low',
        usage: `/${name} [参数]`,
        handler: async (cmd, _ctx, deps) => runCustomCommand(custom, cmd, deps),
      })
    }
  }

  /**
   * Register enabled skills as individual Layer 3 commands.
   * Each skill becomes `/<skill-name>` with `forwardToAgent` and `followUpSkillId`.
   */
  registerSkillCommands(skills: Array<{ id: string; name: string; description: string; tags: string[] }>): void {
    this.clearSkillCommands()
    for (const skill of skills) {
      // Derive command name from skill name (slugified), not from ID which can be numeric
      const cmdName = slugify(skill.name)
      if (!cmdName) continue
      // Skip if command name already taken by Layer 1/2
      if (this.commands.has(cmdName) && this.commands.get(cmdName)!.layer !== 'skill') continue
      const skillId = skill.id
      this.register({
        id: `skill:${skill.id}`,
        name: cmdName,
        aliases: [],
        layer: 'skill',
        group: 'skill',
        description: skill.description || skill.name,
        scope: 'session' as const,
        risk: 'none' as const,
        handler: async (cmd, _ctx, _deps) => {
          const task = cmd.freeText || cmd.args.join(' ').trim()
          const followUpPrompt = task.length > 0
            ? task
            : `Use the selected skill ${skillId} for the current task.`
          return {
            success: true,
            message: `已选择 Skill \`${skillId}\`。下一轮将强制加载该 Skill 的完整指令。`,
            data: { skillId },
            followUpPrompt,
            followUpSkillId: skillId,
          }
        },
      })
    }
  }

  /** Look up by name or alias */
  get(nameOrAlias: string): CommandDefinition | undefined {
    const direct = this.commands.get(nameOrAlias)
    if (direct) return direct
    const aliasedName = this.aliasIndex.get(nameOrAlias)
    if (aliasedName) return this.commands.get(aliasedName)
    return undefined
  }

  list(): CommandDefinition[] {
    return Array.from(this.commands.values())
  }

  /** Get lightweight list for command palette */
  listItems(): CommandListItem[] {
    return this.list().map((c) => {
      const item: CommandListItem = {
        id: c.id,
        name: c.name,
        aliases: c.aliases,
        layer: c.layer,
        group: c.group,
        description: c.description,
        scope: c.scope,
        risk: c.risk,
      }
      if (c.palette !== undefined) item.palette = c.palette
      if (c.usage !== undefined) item.usage = c.usage
      if (c.hasSubcommands !== undefined) item.hasSubcommands = c.hasSubcommands
      return item
    })
  }

  /** Get commands by layer */
  listByLayer(layer: CommandLayer): CommandDefinition[] {
    return this.list().filter((c) => c.layer === layer)
  }

  /** Get commands by group */
  listByGroup(group: CommandGroup): CommandDefinition[] {
    return this.list().filter((c) => c.group === group)
  }

  /** Check if a command name supports subcommands */
  supportsSubcommand(name: string): boolean {
    return SUBCOMMAND_COMMANDS.has(name)
  }

  async execute(cmd: ParsedCommand, ctx: CommandContext, deps: CommandDeps): Promise<CommandResult> {
    const def = this.get(cmd.name)
    if (def == null) {
      return {
        success: false,
        message: `未知命令 /${cmd.name}。输入 /help 查看所有可用命令。`,
      }
    }
    try {
      return await def.handler(cmd, ctx, deps)
    } catch (err) {
      return {
        success: false,
        message: `命令执行失败：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}

async function runCustomCommand(
  custom: CustomCommandConfig,
  cmd: ParsedCommand,
  deps: CommandDeps,
): Promise<CommandResult> {
  const argsText = cmd.freeText || cmd.args.join(' ').trim()
  const outputSections: string[] = []

  if (custom.script.trim().length > 0) {
    if (deps.execShell == null) {
      return { success: false, message: '当前运行时不支持执行自定义脚本。' }
    }
    const ext = custom.scriptLanguage === 'python' ? 'py' : 'js'
    const runner = custom.scriptLanguage === 'python' ? 'python3' : 'node'
    const safeId = custom.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'command'
    const filePath = path.join(tmpdir(), `spark-custom-command-${safeId}-${crypto.randomUUID()}.${ext}`)
    await writeFile(filePath, custom.script, 'utf8')
    try {
      const result = await deps.execShell(
        `${runner} ${JSON.stringify(filePath)} ${JSON.stringify(argsText)}`,
        deps.getWorkspacePath?.() ?? undefined,
      )
      outputSections.push(formatCustomScriptOutput(custom.scriptLanguage, result))
      if (result.exitCode !== 0) return { success: false, message: outputSections.join('\n\n') }
    } finally {
      await rm(filePath, { force: true }).catch(() => undefined)
    }
  }

  const prompt = custom.prompt.trim()
  if (prompt.length > 0) {
    return {
      success: true,
      message: [...outputSections, '已按自定义命令提示词继续交给 Agent 处理。']
        .filter(Boolean)
        .join('\n\n'),
      followUpPrompt: `${prompt}${argsText ? `\n\n用户提供的命令参数：\n${argsText}` : ''}`,
    }
  }

  return {
    success: true,
    message: outputSections.length > 0 ? outputSections.join('\n\n') : '自定义命令已执行。',
  }
}

function formatCustomScriptOutput(
  language: CustomCommandScriptLanguage,
  result: { stdout: string; stderr: string; exitCode: number },
): string {
  const sections = [`脚本执行完成（${language}，exit ${result.exitCode}）。`]
  if (result.stdout.trim()) {
    sections.push(`**stdout**\n\n\`\`\`\n${clipCommandSectionOutput(result.stdout, 6000)}\n\`\`\``)
  }
  if (result.stderr.trim()) {
    sections.push(`**stderr**\n\n\`\`\`\n${clipCommandSectionOutput(result.stderr, 3000)}\n\`\`\``)
  }
  return sections.join('\n\n')
}

/* ============================================================
   Layer 1: SDK 原生命令
   ============================================================ */

function registerSdkCommands(registry: CommandRegistry): void {
  // ── Claude Agent SDK 命令映射 ──

  registry.register({
    id: 'sdk:claude:help',
    name: 'help',
    aliases: ['?'],
    layer: 'sdk',
    group: 'session',
    description: '显示所有可用命令',
    scope: 'global',
    risk: 'none',
    palette: { hidden: true },
    usage: '/help [command]',
    handler: async (cmd) => {
      const targetCmd = cmd.args[0]?.replace(/^\//, '').toLowerCase()
      if (targetCmd) {
        const def = registry.get(targetCmd)
        if (def == null) {
          return { success: false, message: `未知命令 /${targetCmd}。输入 /help 查看所有可用命令。` }
        }
        const lines = [
          `**/${def.name}**`,
          '',
          `- 描述：${def.description}`,
          `- 来源：${def.layer}`,
          `- 分组：${def.group}`,
          `- 作用域：${def.scope}`,
          `- 风险：${def.risk}`,
          ...(def.usage != null ? [`- 用法：\`${def.usage}\``] : []),
          ...(def.aliases.length > 0 ? [`- 别名：${def.aliases.map((alias) => `\`/${alias}\``).join('、')}`] : []),
          `- 执行方式：${isAgentForwardedCommand(def) ? '交给 Agent 处理' : 'Spark 内部处理'}`,
        ]
        return {
          success: true,
          message: lines.join('\n'),
        }
      }
      const lines = [
        '**可用命令**',
        '',
        '▸ **会话管理**',
        '`/help [command]` — 显示帮助',
        '`/status` — 显示当前会话状态',
        '`/rename <title>` — 重命名会话',
        '`/clear` — 清空会话消息',
        '`/compact [instructions]` — 交给 Agent 总结/压缩上下文（不会清空会话）',
        '`/checkpoint list|restore` — 管理快照',
        '',
        '▸ **工具与诊断**',
        '`/doctor` — 环境诊断',
        '',
        '▸ **Git 操作**',
        '`/git status` — 查看状态',
        '`/git log [n]` — 查看提交记录',
        '`/git branch` — 查看分支',
        '`/git stash` — 查看暂存',
        '`/git add [files]` — 暂存文件（交给 AI 执行）',
        '`/git commit [message]` — 提交变更（交给 AI 执行）',
        '`/git push` — 推送远程（交给 AI 执行）',
        '`/git pull` — 拉取远程（交给 AI 执行）',
        '',
        '▸ **Agent 交互**',
        '`/review [instructions]` — 代码审查',
        '`/skill list|run` — Skill 管理',
        '`/goal <objective>` — 设置任务目标',
        '',
        '▸ **Agent 技能命令** (Layer 3)',
        '（根据当前 Agent 配置动态展示）',
        '',
        '输入 `/命令名 help` 查看子命令详情。',
      ]
      return { success: true, message: lines.join('\n') }
    },
  })

  registry.register({
    id: 'sdk:claude:status',
    name: 'status',
    aliases: ['info'],
    layer: 'sdk',
    group: 'session',
    description: '显示当前会话状态',
    scope: 'session',
    risk: 'none',
    usage: '/status',
    handler: async (_cmd, ctx, deps) => {
      const session = deps.getSession(ctx.sessionId)
      if (session == null) {
        return { success: false, message: '会话不存在' }
      }
      const providerName = deps.getProviderName(session.providerProfileId) ?? session.providerProfileId
      const eventCount = deps.getSessionEventCount?.(ctx.sessionId) ?? 0
      const usage = deps.getSessionUsage?.(ctx.sessionId)
      const lines = [
        `**会话状态**`,
        `- 会话 ID：\`${ctx.sessionId.slice(0, 8)}...\``,
        `- 标题：${session.title}`,
        `- 状态：${session.status}`,
        `- Provider：${providerName}`,
        `- 模型：${session.modelId ?? '（使用 Provider 默认）'}`,
        `- 事件数：${eventCount}`,
      ]
      if (usage) {
        lines.push(
          `- Token：${usage.totalInputTokens.toLocaleString()} 入 / ${usage.totalOutputTokens.toLocaleString()} 出`,
          `- 成本：$${usage.totalCost.toFixed(4)}`,
        )
      }
      return {
        success: true,
        message: lines.join('\n'),
        data: { sessionId: ctx.sessionId, status: session.status, model: session.modelId },
      }
    },
  })

  registry.register({
    id: 'builtin:goal',
    name: 'goal',
    aliases: [],
    layer: 'builtin',
    group: 'session',
    description: '创建或控制持久目标循环（Spark-managed Goal）',
    scope: 'session',
    risk: 'medium',
    usage: '/goal <objective> | /goal pause|resume|clear|complete|confirm|reject|status',
    hasSubcommands: true,
    handler: async (cmd, ctx, deps) => {
      const action = cmd.subcommand ?? cmd.args[0]
      const isControl = action != null && ['pause', 'resume', 'clear', 'complete'].includes(action)
      if (isControl) {
        if (!deps.controlGoal) return { success: false, message: '当前运行时不支持 Goal 控制。' }
        const goal = await deps.controlGoal(ctx.sessionId, action as 'pause' | 'resume' | 'clear' | 'complete', cmd.args.slice(1).join(' '))
        return { success: true, message: `Goal 已${action === 'pause' ? '暂停' : action === 'resume' ? '恢复' : action === 'clear' ? '清除' : '完成'}。`, data: { goal } }
      }
      if (action === 'confirm') {
        if (!deps.confirmGoalContract) return { success: false, message: '当前运行时不支持 Goal 契约确认。' }
        const goal = await deps.confirmGoalContract(ctx.sessionId)
        const status = (goal as { status?: string } | null)?.status
        if (status === 'active') return { success: true, message: 'Goal 契约已确认，开始执行。', data: { goal } }
        return { success: false, message: '没有待确认的契约，或契约缺少验收标准，无法启动。', data: { goal } }
      }
      if (action === 'reject') {
        if (!deps.rejectGoalContract) return { success: false, message: '当前运行时不支持 Goal 契约拒绝。' }
        const goal = await deps.rejectGoalContract(ctx.sessionId)
        return { success: true, message: 'Goal 契约已拒绝，目标已清除。', data: { goal } }
      }
      if (action === 'status' || cmd.args.length === 0) {
        const goal = deps.getGoal?.(ctx.sessionId) ?? null
        if (goal == null) return { success: true, message: '当前会话没有活动 Goal。' }
        const pendingStatus = (goal as { status?: string }).status
        if (pendingStatus === 'pending_contract') {
          const sc = (goal as { successCriteria?: string[] }).successCriteria ?? []
          const lines = sc.length > 0 ? sc.map((c) => `- ${c}`).join('\n') : '（契约起草中…）'
          return { success: true, message: `待确认验收契约：\n${lines}\n\n\`/goal confirm\` 启动 · \`/goal reject\` 取消`, data: { goal } }
        }
        return { success: true, message: '当前 Goal 状态如下。', data: { goal } }
      }
      if (!deps.setGoal) return { success: false, message: '当前运行时不支持 Goal。' }
      const objective = cmd.args.join(' ').trim()
      if (!objective) return { success: false, message: '用法：/goal <objective>' }
      const goal = await deps.setGoal(ctx.sessionId, objective)
      return { success: true, message: 'Goal 已创建并开始执行。', data: { goal } }
    },
  })

  registry.register({
    id: 'sdk:claude:compact',
    name: 'compact',
    aliases: [],
    layer: 'sdk',
    group: 'context',
    description: '压缩上下文（交给 Agent 总结，不清空会话）',
    scope: 'session',
    risk: 'low',
    palette: { hidden: true },
    usage: '/compact [instructions]',
    handler: async () => forwardToAgent('已交给 Agent 以对话形式总结/压缩上下文。'),
  })

  registry.register({
    id: 'sdk:claude:clear',
    name: 'clear',
    aliases: [],
    layer: 'sdk',
    group: 'context',
    description: '清空当前会话所有消息',
    scope: 'session',
    risk: 'high',
    usage: '/clear',
    handler: async (_cmd, ctx, deps) => {
      await deps.clearSessionEvents(ctx.sessionId)
      return { success: true, message: '会话消息已全部清空。', wipeHistory: true }
    },
  })

  registry.register({
    id: 'sdk:codex:doctor',
    name: 'doctor',
    aliases: ['check'],
    layer: 'sdk',
    group: 'utility',
    description: '运行环境诊断',
    scope: 'global',
    risk: 'none',
    usage: '/doctor',
    handler: async (_cmd, ctx, deps) => {
      const session = deps.getSession(ctx.sessionId)
      const runtime = deps.getSessionRuntimeInfo?.(ctx.sessionId) ?? null
      const providerId = runtime?.providerProfileId ?? session?.providerProfileId ?? ctx.providerId ?? null
      const providerName = runtime?.providerName ?? (providerId ? deps.getProviderName(providerId) : null)
      const modelId = runtime?.modelId ?? session?.modelId ?? ctx.model ?? null
      const agentAdapter = runtime?.agentAdapter ?? session?.agentAdapter ?? null
      const permissionMode = runtime?.permissionMode ?? session?.permissionMode ?? null
      const workspacePath = deps.getWorkspacePath?.() ?? null
      const sdk = await resolveSdkAvailability(deps)
      const shell = await resolveWorkspaceShell(deps, workspacePath)
      const git = await resolveGitVersion(deps, workspacePath)
      const mcpServers = deps.getMcpStatusSummary?.() ?? []
      const agent = deps.getCurrentAgentSummary?.(ctx.sessionId) ?? null
      const issues: string[] = []

      if (session == null) issues.push('当前 session 不存在，请重新打开或创建会话。')
      if (!workspacePath) issues.push('未打开 workspace，Git、验证脚本和本地 shell 能力受限。')
      if (!shell.available) issues.push(`workspace shell 不可执行${shell.error ? `：${shell.error}` : '。'}`)
      if (!providerId) issues.push('当前 session 缺少 provider 配置。')
      if (!modelId) issues.push('当前 session 未显式设置 model，将依赖 provider 或 agent 默认模型。')
      if (!agentAdapter) issues.push('当前 session 缺少 agent adapter 配置。')
      if (agent != null) {
        if (!agent.exists) issues.push(`当前 Agent 不存在：${agent.id}`)
        else if (!agent.enabled) issues.push(`当前 Agent 已禁用：${agent.name}`)
        if (!agent.hasModelConfig) issues.push(`当前 Agent 缺少模型配置：${agent.name}`)
      } else {
        issues.push('无法读取当前 Agent 配置摘要。')
      }
      if (!sdk.claudeSdk && agentAdapter === 'claude-sdk') issues.push('Claude SDK 不可用，但当前 adapter 为 claude-sdk。')
      if (!sdk.codexCli && agentAdapter === 'codex') issues.push('Codex CLI 不可用，本地 Codex adapter 可能无法运行。')
      if (!sdk.openaiSdk) issues.push('OpenAI SDK 不可用，OpenAI Responses adapter 可能无法运行。')

      const lines = [
        '**环境诊断**',
        '',
        '## Session',
        session == null ? '- ❌ Session: 不存在' : `- ✅ Session: ${ctx.sessionId} (${session.status})`,
        `- Workspace: ${workspacePath ? `✅ ${workspacePath}` : '⚠️ 未打开'}`,
        `- Permission Mode: ${permissionMode ? `✅ ${permissionMode}` : '⚠️ 未配置'}`,
        '',
        '## Provider/Model',
        `- Provider: ${providerId ? `✅ ${providerName ?? providerId} (${providerId})` : '❌ 未配置'}`,
        `- Model: ${modelId ? `✅ ${modelId}` : '⚠️ 未配置（使用默认）'}`,
        `- Claude SDK: ${sdk.claudeSdk ? '✅ 可用' : '❌ 不可用'}`,
        `- Codex CLI: ${sdk.codexCli ? '✅ 可用' : '❌ 不可用'}`,
        `- OpenAI SDK: ${sdk.openaiSdk ? '✅ 可用' : '❌ 不可用'}`,
        '',
        '## Agent Adapter',
        `- Adapter: ${agentAdapter ? `✅ ${agentAdapter}` : '❌ 未配置'}`,
        agent == null
          ? '- Agent: ⚠️ 未提供摘要'
          : `- Agent: ${agent.exists ? (agent.enabled ? '✅' : '⚠️') : '❌'} ${agent.name} (${agent.id})`,
        agent == null ? '- Agent Model Config: ⚠️ 未知' : `- Agent Model Config: ${agent.hasModelConfig ? '✅ 已配置' : '⚠️ 缺失'}`,
        '',
        '## Shell/Git',
        `- Shell: ${shell.available ? `✅ 可执行${shell.shell ? ` (${shell.shell})` : ''}` : `❌ 不可用${shell.error ? `：${shell.error}` : ''}`}`,
        `- Git: ${git.available ? `✅ ${git.version}` : `❌ 不可用${git.error ? `：${git.error}` : ''}`}`,
        '',
        '## MCP',
        ...formatMcpStatus(mcpServers),
        '',
        '## Known Issues / Suggestions',
        ...(issues.length > 0 ? issues.map((issue) => `- ${issue}`) : ['- ✅ 未发现明显问题。']),
      ]

      return {
        success: true,
        message: lines.join('\n'),
        data: { session: session != null, workspacePath, providerId, modelId, agentAdapter, permissionMode, sdk, shell, git, mcpServers, agent, issues },
      }
    },
  })

  registry.register({
    id: 'sdk:codex:review',
    name: 'review',
    aliases: [],
    layer: 'sdk',
    group: 'utility',
    description: '代码审查',
    scope: 'workspace',
    risk: 'none',
    palette: { hidden: true },
    usage: '/review [instructions]',
    handler: async () => forwardToAgent(),
  })
}

function isAgentForwardedCommand(def: CommandDefinition): boolean {
  const forwardedCommands = new Set(['compact', 'review'])
  if (forwardedCommands.has(def.name)) return true
  return def.name === 'git'
}

/* ============================================================
   Layer 2: 程序内置命令
   ============================================================ */

function registerBuiltinCommands(registry: CommandRegistry): void {
  // ── Session ──

  registry.register({
    id: 'builtin:rename',
    name: 'rename',
    aliases: [],
    layer: 'builtin',
    group: 'session',
    description: '重命名当前会话',
    scope: 'session',
    risk: 'none',
    usage: '/rename <title>',
    handler: async (cmd, ctx, deps) => {
      const title = cmd.args.join(' ') || cmd.freeText
      if (!title) {
        const session = deps.getSession(ctx.sessionId)
        return { success: true, message: `当前标题：${session?.title ?? '未知'}\n用法：/rename <新标题>` }
      }
      await deps.updateSession(ctx.sessionId, { title })
      return { success: true, message: `会话已重命名为「${title}」` }
    },
  })

  registry.register({
    id: 'builtin:checkpoint',
    name: 'checkpoint',
    aliases: ['cp'],
    layer: 'builtin',
    group: 'session',
    description: '管理会话快照',
    scope: 'session',
    risk: 'high',
    usage: '/checkpoint <on|off|status|list|restore> [checkpoint-id]',
    hasSubcommands: true,
    handler: async (cmd, ctx, deps) => {
      const action = cmd.args[0]?.toLowerCase() ?? 'list'
      if (action === 'on' || action === 'off') {
        if (deps.setCheckpointEnabled == null) return { success: false, message: '当前运行时不支持 checkpoint 开关。' }
        const ok = deps.setCheckpointEnabled(ctx.sessionId, action === 'on')
        if (!ok) return { success: false, message: '会话不存在，无法切换 checkpoint。' }
        return { success: true, message: action === 'on'
          ? '已开启代码还原点：之后每当工作区发生文件变更，会在改动前自动快照（仅变更时）。'
          : '已关闭代码还原点（不再新建快照；已有快照保留）。' }
      }
      if (action === 'status') {
        const enabled = deps.getCheckpointEnabled?.(ctx.sessionId) ?? false
        const count = deps.listSessionCheckpoints?.(ctx.sessionId)?.length ?? 0
        return { success: true, message: `代码还原点：${enabled ? '已开启' : '未开启'}；当前 ${count} 个快照。${enabled ? '' : '\n用 `/checkpoint on` 开启。'}` }
      }
      if (action === 'list') {
        const checkpoints = deps.listSessionCheckpoints?.(ctx.sessionId) ?? []
        if (checkpoints.length === 0) {
          return { success: true, message: '当前会话还没有可用 checkpoint。' }
        }
        const lines = checkpoints.slice(-10).reverse().map((checkpoint) => {
          const files = checkpoint.filePaths?.length ?? 0
          const filePreview = checkpoint.filePaths?.slice(0, 3).join(', ')
          const label = checkpoint.label != null ? ` ${checkpoint.label}` : ''
          const source = checkpoint.path != null ? ` · ${checkpoint.path}` : ''
          const fileText = filePreview != null && filePreview.length > 0 ? ` · ${filePreview}` : ''
          return `- \`${checkpoint.checkpointId}\`${label} · ${files} files${fileText}${source}`
        })
        return { success: true, message: ['**Checkpoints**', '', ...lines].join('\n') }
      }

      if (action !== 'restore' && action !== 'rollback') {
        return { success: false, message: '用法: /checkpoint <list|restore> [checkpoint-id]' }
      }

      const checkpointRef = cmd.args[1]
      if (checkpointRef == null || checkpointRef.trim().length === 0) {
        return { success: false, message: '用法: /checkpoint restore <checkpoint-id>' }
      }
      if (deps.restoreCheckpoint == null) {
        return { success: false, message: '当前运行时不支持 checkpoint restore。' }
      }

      const result = await deps.restoreCheckpoint(ctx.sessionId, checkpointRef)
      const restored = result.restoredFiles.length > 0
        ? result.restoredFiles.map((file) => `- ${file}`).join('\n')
        : '- none'
      const missing = result.missingFiles.length > 0
        ? `\n\nMissing files:\n${result.missingFiles.map((file) => `- ${file}`).join('\n')}`
        : ''
      return {
        success: result.missingFiles.length === 0,
        message: `Restored checkpoint \`${result.checkpointId}\`:\n${restored}${missing}`,
        data: {
          checkpointId: result.checkpointId,
          restoredFiles: result.restoredFiles,
          missingFiles: result.missingFiles,
        },
      }
    },
  })

  // ── Skill ──

  registry.register({
    id: 'builtin:skill',
    name: 'skill',
    aliases: ['skills'],
    layer: 'builtin',
    group: 'skill',
    description: 'Skill 管理',
    scope: 'workspace',
    risk: 'low',
    hasSubcommands: true,
    usage: '/skill <list|search|run>',
    handler: async (cmd, _ctx, deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      if (subcommand === 'list') {
        const skills = deps.listSkills?.() ?? []
        if (skills.length === 0) return { success: true, message: '当前没有可用 Skill。' }
        return {
          success: true,
          message: [
            '**可用 Skills**',
            '',
            ...skills.map((skill) => `- \`${skill.id}\` — ${skill.name}${skill.description ? `：${skill.description}` : ''}`),
          ].join('\n'),
          data: { skills },
        }
      }
      if (subcommand === 'search') {
        const query = cmd.args.slice(1).join(' ').trim()
        const skills = deps.listSkills?.(query) ?? []
        return {
          success: true,
          message: skills.length > 0
            ? [
                `**Skill 搜索结果** ${query ? `\`${query}\`` : ''}`,
                '',
                ...skills.map((skill) => `- \`${skill.id}\` — ${skill.name}${skill.description ? `：${skill.description}` : ''}`),
              ].join('\n')
            : `没有找到匹配的 Skill：\`${query}\``,
          data: { skills },
        }
      }
      if (subcommand === 'run' || subcommand === 'use') {
        const skillId = cmd.args[1]
        if (!skillId) return { success: false, message: '用法：/skill run <skill-id> [task]' }
        const skill = deps.listSkills?.().find((item) => item.id === skillId)
        if (skill == null) return { success: false, message: `Skill 不可用或不存在：\`${skillId}\`` }
        const followUpPrompt = cmd.args.slice(2).join(' ').trim() || `Use the selected skill ${skillId} for the current task.`
        return {
          success: true,
          message: `已选择 Skill \`${skillId}\`。下一轮将强制加载该 Skill 的完整指令。`,
          data: { skillId },
          followUpPrompt,
          followUpSkillId: skillId,
        }
      }
      return {
        success: true,
        message: '**Skill 管理**\n\n用法：\n- `/skill list` — 查看技能\n- `/skill search <query>` — 搜索\n- `/skill run <id>` — 运行',
      }
    },
  })

  // ── Git ──

  /** 需要 AI Agent 执行的 git 子命令 */
  const GIT_AGENT_SUBCOMMANDS = new Set(['add', 'commit', 'push', 'pull', 'merge', 'rebase', 'checkout', 'fetch', 'reset', 'revert', 'cherry-pick'])

  registry.register({
    id: 'builtin:git',
    name: 'git',
    aliases: [],
    layer: 'builtin',
    group: 'git',
    description: 'Git 操作',
    scope: 'workspace',
    risk: 'low',
    hasSubcommands: true,
    usage: '/git <status|log|stash|branch|add|commit|push|pull|...>',
    handler: async (cmd, ctx, deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand

      // add/commit/push/pull 等写操作直接交给 AI Agent 执行
      if (subcommand && GIT_AGENT_SUBCOMMANDS.has(subcommand)) {
        return forwardToAgent()
      }

      const cwd = deps.getWorkspacePath?.()
      if (!cwd) {
        return { success: false, message: '未打开工作区。' }
      }
      if (!deps.execShell) {
        return { success: false, message: 'Shell 执行不可用。' }
      }
      try {
        if (subcommand === 'status') {
          const { stdout } = await deps.execShell('git status --short', cwd)
          return { success: true, message: stdout.trim() ? `\`\`\`\n${stdout}\n\`\`\`` : '工作区干净，无变更。' }
        }
        if (subcommand === 'log') {
          const limit = parseGitLogLimit(cmd.args[1])
          if (limit == null) {
            return { success: false, message: GIT_LOG_LIMIT_USAGE }
          }
          const { stdout } = await deps.execShell(`git log --oneline -${limit}`, cwd)
          return { success: true, message: `\`\`\`\n${stdout}\n\`\`\`` }
        }
        if (subcommand === 'stash') {
          const { stdout } = await deps.execShell('git stash list', cwd)
          return { success: true, message: stdout.trim() ? `\`\`\`\n${stdout}\n\`\`\`` : '无暂存变更。' }
        }
        if (subcommand === 'branch') {
          const { stdout } = await deps.execShell('git branch -a --list', cwd)
          return { success: true, message: `\`\`\`\n${stdout}\n\`\`\`` }
        }
        return {
          success: true,
          message: [
            '**Git 操作**',
            '',
            '▸ 只读操作（本地执行）',
            '`/git status` — 查看状态',
            '`/git log [n]` — 查看提交记录',
            '`/git stash` — 查看暂存列表',
            '`/git branch` — 查看分支',
            '',
            '▸ 写操作（交给 AI 执行）',
            '`/git add [files]` — 暂存文件',
            '`/git commit [message]` — 提交变更',
            '`/git push` — 推送到远程',
            '`/git pull` — 拉取远程更新',
            '`/git checkout <branch>` — 切换分支',
            '`/git merge <branch>` — 合并分支',
            '`/git rebase <branch>` — 变基',
            '`/git fetch` — 获取远程更新',
            '`/git reset [target]` — 重置',
            '`/git revert <commit>` — 回退提交',
            '`/git cherry-pick <commit>` — 摘取提交',
          ].join('\n'),
        }
      } catch (err) {
        return { success: false, message: `Git 操作失败：${err instanceof Error ? err.message : String(err)}` }
      }
    },
  })

}

async function resolveSdkAvailability(deps: CommandDeps): Promise<{ claudeSdk: boolean; codexCli: boolean; openaiSdk: boolean }> {
  if (deps.checkSdkAvailability) return deps.checkSdkAvailability()
  return {
    claudeSdk: false,
    codexCli: false,
    openaiSdk: false,
  }
}

async function resolveWorkspaceShell(
  deps: CommandDeps,
  cwd: string | null,
): Promise<{ available: boolean; shell?: string; error?: string }> {
  if (deps.checkWorkspaceShell) return deps.checkWorkspaceShell(cwd)
  if (!deps.execShell) return { available: false, error: 'Shell dependency is not registered' }
  try {
    const result = await deps.execShell('echo spark-shell-ok', cwd ?? undefined)
    const output = `${result.stdout}\n${result.stderr}`
    return result.exitCode === 0 && output.includes('spark-shell-ok')
      ? { available: true }
      : { available: false, error: `exit ${result.exitCode}` }
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function resolveGitVersion(
  deps: CommandDeps,
  cwd: string | null,
): Promise<{ available: boolean; version?: string; error?: string }> {
  if (!deps.execShell) return { available: false, error: 'Shell dependency is not registered' }
  try {
    const result = await deps.execShell('git --version', cwd ?? undefined)
    const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n').trim()
    return result.exitCode === 0
      ? { available: true, version: output || 'git available' }
      : { available: false, error: output || `exit ${result.exitCode}` }
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function formatMcpStatus(
  servers: Array<{ id: string; name: string; enabled: boolean; connected: boolean; toolCount: number; error?: string }>,
): string[] {
  if (servers.length === 0) return ['- ⚠️ 未配置 MCP server，或当前运行时未提供 MCP 摘要。']
  const enabled = servers.filter((server) => server.enabled)
  const connected = enabled.filter((server) => server.connected)
  const lines = [`- Summary: ${connected.length}/${enabled.length} enabled servers connected (${servers.length} total)`]
  for (const server of servers) {
    const state = server.enabled ? (server.connected ? '✅ connected' : '❌ disconnected') : '⚠️ disabled'
    const error = server.error ? ` — ${server.error}` : ''
    lines.push(`- ${state}: ${server.name} (${server.toolCount} tools)${error}`)
  }
  return lines
}

/* ============================================================
   Registry Factory
   ============================================================ */

/** 创建并注册所有命令（三层架构） */
export function createBuiltinRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registerSdkCommands(registry)
  registerBuiltinCommands(registry)
  return registry
}
