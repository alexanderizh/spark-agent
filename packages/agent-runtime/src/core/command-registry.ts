/**
 * CommandRegistry — 三层命令注册表
 *
 * 三层架构:
 *   Layer 1: SDK 原生命令（Claude Agent SDK / Codex SDK）
 *   Layer 2: 程序内置命令（Session/Model/Context/Permission/...）
 *   Layer 3: Agent 技能命令（Skill manifest 注册）
 *
 * 命令按 12 个分组展示:
 *   session / model / context / permission / workflow / agent / mcp / skill / resource / team / git / utility / system
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ParsedCommand } from './command-parser.js'

/* ============================================================
   Types
   ============================================================ */

/** 命令来源层 */
export type CommandLayer = 'sdk' | 'builtin' | 'skill'

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
}

export interface CheckpointSnapshot {
  checkpointId: string
  label?: string
  path?: string
  filePaths?: string[]
  timestamp?: string
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
  /** 用法提示 */
  usage?: string
  /** 是否支持子命令 */
  hasSubcommands?: boolean
  /** 命令执行 handler */
  handler: (cmd: ParsedCommand, ctx: CommandContext, deps: CommandDeps) => Promise<CommandResult>
}

/** 命令执行所需的外部依赖（由 SessionService 注入） */
export interface CommandDeps {
  getSession: (id: string) => { title: string; status: string; modelId: string | null; providerProfileId: string } | null
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
  listSkills?: (query?: string) => Array<{ id: string; name: string; description: string; tags: string[]; enabled: boolean }>
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
  usage?: string
  hasSubcommands?: boolean
}

/* ============================================================
   Helpers
   ============================================================ */

/** Convert a skill name to a slug suitable for a slash command. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function clipCommandSectionOutput(output: string, maxLength = 4000): string {
  return output.length > maxLength ? `${output.slice(0, maxLength)}\n... output truncated ...` : output
}

function formatDiffSection(title: string, diff: string): string {
  const body = diff.trim()
  if (!body) {
    return `## ${title}\n\n_No changes._`
  }
  return `## ${title}\n\n\`\`\`diff\n${clipCommandSectionOutput(body)}\n\`\`\``
}

function formatUntrackedFilesSection(files: string): string {
  const body = files.trim()
  if (!body) {
    return '## Untracked files\n\n_No untracked files._'
  }
  return `## Untracked files\n\n\`\`\`\n${clipCommandSectionOutput(body)}\n\`\`\``
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
    usage: '/help [command]',
    handler: async (cmd, _ctx, deps) => {
      const targetCmd = cmd.args[0]
      if (targetCmd) {
        return { success: true, message: `查看 /${targetCmd} 的详细帮助（待实现）` }
      }
      const lines = [
        '**可用命令**',
        '',
        '▸ **会话管理**',
        '`/help [command]` — 显示帮助',
        '`/status` — 显示当前会话状态',
        '`/model [model-id]` — 切换模型',
        '`/rename <title>` — 重命名会话',
        '`/clear` — 清空会话消息',
        '`/compact` — 压缩上下文',
        '`/checkpoint list|restore` — 管理快照',
        '',
        '▸ **工具与诊断**',
        '`/diff` — 查看 git diff',
        '`/doctor` — 环境诊断',
        '`/validate [command]` — 运行项目验证脚本',
        '`/usage` — 查看 token/cost 统计',
        '`/init` — 初始化项目配置',
        '`/approval <on|off>` — 开关工具审批',
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
        '`/plan [task]` — 进入 Plan 模式',
        '`/review [instructions]` — 代码审查',
        '`/memory` — 管理记忆文件',
        '`/skill list|run` — Skill 管理',
        '`/add-dir <path>` — 添加工作目录',
        '`/copy` — 复制上次输出',
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
    id: 'sdk:claude:model',
    name: 'model',
    aliases: [],
    layer: 'sdk',
    group: 'model',
    description: '切换当前会话使用的模型',
    scope: 'session',
    risk: 'low',
    usage: '/model [model-id]',
    handler: async (cmd, ctx, deps) => {
      const session = deps.getSession(ctx.sessionId)
      const modelId = cmd.args[0]
      if (modelId == null || modelId.length === 0) {
        const current = session?.modelId ?? '（使用 Provider 默认）'
        return { success: true, message: `当前模型：${current}\n用法：/model <model-id>` }
      }
      if (session == null) {
        return { success: false, message: '当前会话不存在，无法切换模型。' }
      }
      const providerModels = deps.getProviderModelIds?.(session.providerProfileId) ?? []
      if (providerModels.length > 0 && !providerModels.includes(modelId)) {
        const providerName = deps.getProviderName(session.providerProfileId) ?? session.providerProfileId
        return {
          success: false,
          message: `模型 \`${modelId}\` 不属于当前 Provider（${providerName}）。请在模型选择器中切换到对应 Provider，或使用当前 Provider 支持的模型：${providerModels.join(', ')}`,
          data: { modelId, providerProfileId: session.providerProfileId, providerModels },
        }
      }
      await deps.updateSession(ctx.sessionId, { modelId })
      return { success: true, message: `模型已切换为 \`${modelId}\``, data: { modelId } }
    },
  })

  registry.register({
    id: 'sdk:claude:compact',
    name: 'compact',
    aliases: [],
    layer: 'sdk',
    group: 'context',
    description: '压缩上下文（清除早期消息以释放 token）',
    scope: 'session',
    risk: 'low',
    usage: '/compact',
    handler: async (_cmd, ctx, deps) => {
      await deps.clearSessionEvents(ctx.sessionId)
      return { success: true, message: '上下文已压缩，早期消息已清除。' }
    },
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
      return { success: true, message: '会话消息已全部清空。' }
    },
  })

  registry.register({
    id: 'sdk:codex:diff',
    name: 'diff',
    aliases: [],
    layer: 'sdk',
    group: 'git',
    description: '查看当前 git diff（含未跟踪文件）',
    scope: 'workspace',
    risk: 'none',
    usage: '/diff',
    handler: async (_cmd, _ctx, deps) => {
      const cwd = deps.getWorkspacePath?.()
      if (!cwd) {
        return { success: false, message: '未打开工作区，无法执行 git diff。' }
      }
      if (!deps.execShell) {
        return { success: false, message: 'Shell 执行不可用。' }
      }
      try {
        const [workingTreeDiff, stagedDiff, untrackedFiles] = await Promise.all([
          deps.execShell('git diff', cwd),
          deps.execShell('git diff --cached', cwd),
          deps.execShell('git ls-files --others --exclude-standard', cwd),
        ])
        if (!workingTreeDiff.stdout.trim() && !stagedDiff.stdout.trim() && !untrackedFiles.stdout.trim()) {
          return { success: true, message: '没有文件变更。' }
        }
        return {
          success: true,
          message: [
            formatDiffSection('Working tree diff', workingTreeDiff.stdout),
            formatDiffSection('Staged diff', stagedDiff.stdout),
            formatUntrackedFilesSection(untrackedFiles.stdout),
          ].join('\n\n'),
        }
      } catch (err) {
        return { success: false, message: `执行 git diff 失败：${err instanceof Error ? err.message : String(err)}` }
      }
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
    handler: async (_cmd, _ctx, deps) => {
      const lines: string[] = ['**环境诊断**', '']
      // Check git
      if (deps.execShell) {
        try {
          const { stdout } = await deps.execShell('git --version')
          lines.push(`✅ Git: ${stdout.trim()}`)
        } catch {
          lines.push('❌ Git: 未安装')
        }
      } else {
        lines.push('⚠️ Shell 不可用，跳过检查')
      }
      // Check workspace
      const wsPath = deps.getWorkspacePath?.()
      lines.push(wsPath ? `✅ 工作区: ${wsPath}` : '⚠️ 工作区: 未打开')
      // Check session
      lines.push('✅ Spark Agent 运行正常')
      return { success: true, message: lines.join('\n') }
    },
  })

  registry.register({
    id: 'builtin:validate',
    name: 'validate',
    aliases: ['verify'],
    layer: 'builtin',
    group: 'utility',
    description: '运行项目验证脚本',
    scope: 'workspace',
    risk: 'medium',
    usage: '/validate [pnpm run typecheck] [--repair]',
    handler: async (cmd, _ctx, deps) => {
      const cwd = deps.getWorkspacePath?.()
      if (!cwd) return { success: false, message: '未打开工作区，无法运行验证。' }
      if (!deps.execShell) return { success: false, message: 'Shell 执行不可用。' }

      const scripts = readWorkspaceScripts(cwd)
      const validationScripts = Object.keys(scripts).filter(isValidationScriptName)
      if (validationScripts.length === 0) {
        return { success: false, message: '当前工作区 package.json 中没有发现 typecheck/test/lint 类验证脚本。' }
      }

      if (cmd.args.length === 0) {
        const pm = detectWorkspacePackageManager(cwd)
        const lines = [
          '**可用验证脚本**',
          '',
          ...validationScripts.map((script) => `- \`${pm} run ${script}\``),
        ]
        return { success: true, message: lines.join('\n') }
      }

      const requestedCommand = cmd.args.join(' ')
      const parsed = parseValidationRunCommand(requestedCommand)
      if (parsed == null || !validationScripts.includes(parsed.scriptName)) {
        return {
          success: false,
          message: `只允许运行 package.json 中的验证脚本：${validationScripts.map((script) => `\`${script}\``).join('、')}。`,
        }
      }

      const startedAt = Date.now()
      const result = await deps.execShell(requestedCommand, cwd)
      const elapsed = Date.now() - startedAt
      const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n')
      const clippedOutput = output.length > 8000 ? `${output.slice(0, 8000)}\n... output truncated ...` : output
      const statusLine = result.exitCode === 0 ? '验证通过' : '验证失败'
      const body = clippedOutput.trim().length > 0 ? `\n\n\`\`\`\n${clippedOutput.trim()}\n\`\`\`` : ''
      const repairRequested = cmd.flags.repair === 'true'
      const repairAttempt = parsePositiveInt(cmd.flags.attempt, 1)
      const maxRepairAttempts = parsePositiveInt(cmd.flags['max-retries'] ?? cmd.flags.maxRetries, 3)
      const repairCanContinue = result.exitCode !== 0 && repairRequested && repairAttempt < maxRepairAttempts
      const repairStopped = result.exitCode !== 0 && repairRequested && !repairCanContinue
      const followUpPrompt = repairCanContinue
        ? buildValidationRepairPrompt({
            command: requestedCommand,
            exitCode: result.exitCode,
            output: clippedOutput,
            attempt: repairAttempt,
            maxAttempts: maxRepairAttempts,
            nextAttempt: repairAttempt + 1,
          })
        : undefined
      const repairNote = followUpPrompt != null ? '\n\n已把失败摘要交给 Agent 继续修复。' : ''
      const repairLoopNote = followUpPrompt != null
        ? `\n\n已把失败摘要交给 Agent 继续修复（attempt ${repairAttempt}/${maxRepairAttempts}）。`
        : (repairStopped ? `\n\n修复循环已停止：达到最大重试次数 ${maxRepairAttempts}。` : repairNote)
      const repairLoopNoteText = followUpPrompt != null
        ? `\n\nRepair summary queued for Agent (attempt ${repairAttempt}/${maxRepairAttempts}).`
        : (repairStopped ? `\n\nRepair loop stopped: max retries ${maxRepairAttempts} reached.` : repairLoopNote)
      return {
        success: result.exitCode === 0,
        message: `**${statusLine}** \`${requestedCommand}\` (${elapsed}ms, exit ${result.exitCode})${body}${repairLoopNoteText}`,
        data: {
          command: requestedCommand,
          exitCode: result.exitCode,
          durationMs: elapsed,
          repairQueued: followUpPrompt != null,
          validationRepair: {
            requested: repairRequested,
            attempt: repairAttempt,
            maxAttempts: maxRepairAttempts,
            nextAttempt: repairCanContinue ? repairAttempt + 1 : null,
            stopped: repairStopped,
            stopReason: repairStopped ? 'max_retries_exhausted' : null,
          },
        },
        ...(followUpPrompt != null ? { followUpPrompt } : {}),
      }
    },
  })

  registry.register({
    id: 'sdk:claude:usage',
    name: 'usage',
    aliases: ['cost'],
    layer: 'sdk',
    group: 'utility',
    description: '查看当前会话 token/cost 统计',
    scope: 'session',
    risk: 'none',
    usage: '/usage',
    handler: async (_cmd, ctx, deps) => {
      const usage = deps.getSessionUsage?.(ctx.sessionId)
      if (!usage) {
        return { success: true, message: '当前会话暂无用量数据。' }
      }
      const lines = [
        '**会话用量统计**',
        `- 输入 Token：${usage.totalInputTokens.toLocaleString()}`,
        `- 输出 Token：${usage.totalOutputTokens.toLocaleString()}`,
        `- 总成本：$${usage.totalCost.toFixed(4)}`,
      ]
      return { success: true, message: lines.join('\n') }
    },
  })

  registry.register({
    id: 'sdk:claude:init',
    name: 'init',
    aliases: [],
    layer: 'sdk',
    group: 'utility',
    description: '初始化项目配置文件',
    scope: 'workspace',
    risk: 'low',
    usage: '/init',
    handler: async (_cmd, _ctx, deps) => {
      const cwd = deps.getWorkspacePath?.()
      if (!cwd) {
        return { success: false, message: '未打开工作区。' }
      }
      if (!deps.execShell) {
        return { success: false, message: 'Shell 执行不可用。' }
      }
      try {
        const { stdout } = await deps.execShell('test -f .claude/commands && echo "exists" || echo "not_found"', cwd)
        if (stdout.trim() === 'exists') {
          return { success: true, message: '项目配置已存在。如需重新初始化，请先删除 `.claude/` 目录。' }
        }
        await deps.execShell('mkdir -p .claude/commands', cwd)
        return { success: true, message: '已创建 `.claude/commands/` 目录。可在其中添加自定义命令。' }
      } catch (err) {
        return { success: false, message: `初始化失败：${err instanceof Error ? err.message : String(err)}` }
      }
    },
  })

  registry.register({
    id: 'sdk:claude:add-dir',
    name: 'add-dir',
    aliases: [],
    layer: 'sdk',
    group: 'utility',
    description: '添加工作目录',
    scope: 'workspace',
    risk: 'low',
    usage: '/add-dir <path>',
    handler: async () => ({ success: true, message: '', forwardToAgent: true }),
  })

  registry.register({
    id: 'sdk:claude:memory',
    name: 'memory',
    aliases: ['memories'],
    layer: 'sdk',
    group: 'utility',
    description: '管理记忆文件',
    scope: 'workspace',
    risk: 'none',
    usage: '/memory',
    handler: async () => ({ success: true, message: '', forwardToAgent: true }),
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
    usage: '/review [instructions]',
    handler: async () => ({ success: true, message: '', forwardToAgent: true }),
  })

  registry.register({
    id: 'sdk:codex:copy',
    name: 'copy',
    aliases: [],
    layer: 'sdk',
    group: 'utility',
    description: '复制上次 agent 输出为 Markdown',
    scope: 'session',
    risk: 'none',
    usage: '/copy',
    handler: async () => ({ success: true, message: '', forwardToAgent: true }),
  })

  registry.register({
    id: 'sdk:codex:plan',
    name: 'plan',
    aliases: [],
    layer: 'sdk',
    group: 'utility',
    description: '进入 Plan 模式',
    scope: 'session',
    risk: 'none',
    usage: '/plan [task]',
    handler: async () => ({ success: true, message: '', forwardToAgent: true }),
  })

  registry.register({
    id: 'sdk:codex:side',
    name: 'side',
    aliases: ['btw'],
    layer: 'sdk',
    group: 'utility',
    description: '开启旁路对话',
    scope: 'session',
    risk: 'none',
    usage: '/side [message]',
    handler: async () => ({ success: true, message: '', forwardToAgent: true }),
  })
}

function readWorkspaceScripts(cwd: string): Record<string, string> {
  try {
    const raw = readFileSync(path.join(cwd, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) return {}
    const scripts: Record<string, string> = {}
    for (const [name, value] of Object.entries(parsed.scripts)) {
      if (typeof value === 'string') scripts[name] = value
    }
    return scripts
  } catch {
    return {}
  }
}

function detectWorkspacePackageManager(cwd: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function isValidationScriptName(name: string): boolean {
  return /(typecheck|check|tsc|test|vitest|lint|format:check|eslint)/i.test(name)
}

function parseValidationRunCommand(command: string): { packageManager: string; scriptName: string } | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 3) return null
  const packageManager = tokens[0]
  if (packageManager !== 'pnpm' && packageManager !== 'npm' && packageManager !== 'yarn') return null

  const runIndex = tokens.indexOf('run')
  if (runIndex < 0 || runIndex + 1 >= tokens.length) return null
  const scriptName = tokens[runIndex + 1]
  if (scriptName == null || scriptName.startsWith('-')) return null
  return { packageManager, scriptName }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value == null) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function buildValidationRepairPrompt(params: {
  command: string
  exitCode: number
  output: string
  attempt: number
  maxAttempts: number
  nextAttempt: number
}): string {
  const output = params.output.trim()
  const clipped = output.length > 6000 ? `${output.slice(0, 6000)}\n... output truncated ...` : output
  return [
    '上一次代码验证失败，请基于下面的验证结果继续修复项目。',
    '',
    `验证命令: ${params.command}`,
    `退出码: ${params.exitCode}`,
    '',
    '请先定位失败原因，修改必要代码，然后再次给出或触发合适的验证命令。不要回退无关改动。',
    '',
    clipped.length > 0 ? `验证输出:\n\`\`\`\n${clipped}\n\`\`\`` : '验证输出为空。',
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/* ============================================================
   Layer 2: 程序内置命令
   ============================================================ */

function registerBuiltinCommands(registry: CommandRegistry): void {
  // ── Session ──

  registry.register({
    id: 'builtin:approval',
    name: 'approval',
    aliases: [],
    layer: 'builtin',
    group: 'permission',
    description: '开关工具审批模式',
    scope: 'session',
    risk: 'medium',
    usage: '/approval <on|off>',
    handler: async (cmd, ctx, deps) => {
      const arg = cmd.args[0]?.toLowerCase()
      if (arg !== 'on' && arg !== 'off') {
        return { success: false, message: '用法：/approval <on|off>' }
      }
      const enabled = arg === 'on'
      deps.setApprovalMode(ctx.sessionId, enabled)
      return { success: true, message: `工具审批已${enabled ? '开启' : '关闭'}。` }
    },
  })

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
    usage: '/checkpoint <list|restore> [checkpoint-id]',
    hasSubcommands: true,
    handler: async (cmd, ctx, deps) => {
      const action = cmd.args[0]?.toLowerCase() ?? 'list'
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
        return { success: true, message: '', forwardToAgent: true }
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
          const n = cmd.args[1] || '10'
          const { stdout } = await deps.execShell(`git log --oneline -${n}`, cwd)
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

  // ── Goal ──

  registry.register({
    id: 'sdk:codex:goal',
    name: 'goal',
    aliases: [],
    layer: 'sdk',
    group: 'utility',
    description: '设置或查看长任务目标',
    scope: 'session',
    risk: 'none',
    hasSubcommands: true,
    usage: '/goal <objective> | /goal clear | /goal pause | /goal resume',
    handler: async () => ({ success: true, message: '', forwardToAgent: true }),
  })
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
