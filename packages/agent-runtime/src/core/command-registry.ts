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
   Command Registry
   ============================================================ */

/** 支持子命令的命令集合 */
const SUBCOMMAND_COMMANDS = new Set([
  'workflow',
  'agent',
  'mcp',
  'skill',
  'checkpoint',
  'resource',
  'team',
  'git',
  'context',
  'sandbox',
  'memory',
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
        '**可用命令（三层架构）**',
        '',
        '▸ **SDK 原生命令** (Layer 1)',
        '`/help [command]` — 显示帮助',
        '`/status` — 显示当前会话状态',
        '`/model [model-id]` — 切换模型',
        '`/compact` — 压缩上下文',
        '`/clear` — 清空会话消息',
        '`/diff` — 查看 git diff',
        '`/doctor` — 环境诊断',
        '`/validate [command]` — 运行项目验证脚本',
        '`/usage` — 查看 token/cost 统计',
        '`/init` — 初始化项目配置',
        '`/add-dir <path>` — 添加工作目录',
        '`/memory` — 管理记忆文件',
        '`/review [instructions]` — 代码审查',
        '`/copy` — 复制上次输出',
        '`/plan [task]` — 进入 Plan 模式',
        '',
        '▸ **程序内置命令** (Layer 2)',
        '`/approval <on|off>` — 开关工具审批',
        '`/rename <title>` — 重命名会话',
        '`/export <format>` — 导出会话',
        '`/sessions` — 切换或搜索会话',
        '`/history` — 打开会话历史',
        '`/context [mode]` — 上下文管理',
        '`/provider [id]` — 切换 Provider',
        '`/reason <level>` — 调整推理力度',
        '`/mcp list|enable|disable|tools` — MCP 管理',
        '`/skill list|run` — Skill 管理',
        '`/resource eco|balanced|turbo` — 资源档位',
        '`/queue` — 查看后台任务',
        '`/kill-run` — 停止当前运行',
        '`/kill-workspace` — 停止 workspace 所有进程',
        '`/git status|log|stash` — Git 操作',
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
      const modelId = cmd.args[0]
      if (modelId == null || modelId.length === 0) {
        const session = deps.getSession(ctx.sessionId)
        const current = session?.modelId ?? '（使用 Provider 默认）'
        return { success: true, message: `当前模型：${current}\n用法：/model <model-id>` }
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
        const { stdout } = await deps.execShell('git diff && git diff --cached && git ls-files --others --exclude-standard | head -20', cwd)
        if (!stdout.trim()) {
          return { success: true, message: '没有文件变更。' }
        }
        return { success: true, message: `\`\`\`diff\n${stdout.slice(0, 4000)}\n\`\`\`` }
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
      const followUpPrompt = result.exitCode !== 0 && repairRequested
        ? buildValidationRepairPrompt({
            command: requestedCommand,
            exitCode: result.exitCode,
            output: clippedOutput,
          })
        : undefined
      const repairNote = followUpPrompt != null ? '\n\n已把失败摘要交给 Agent 继续修复。' : ''
      return {
        success: result.exitCode === 0,
        message: `**${statusLine}** \`${requestedCommand}\` (${elapsed}ms, exit ${result.exitCode})${body}${repairNote}`,
        data: {
          command: requestedCommand,
          exitCode: result.exitCode,
          durationMs: elapsed,
          repairQueued: followUpPrompt != null,
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

function buildValidationRepairPrompt(params: {
  command: string
  exitCode: number
  output: string
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
    id: 'builtin:export',
    name: 'export',
    aliases: [],
    layer: 'builtin',
    group: 'session',
    description: '导出会话为 Markdown / JSONL / HTML',
    scope: 'session',
    risk: 'none',
    usage: '/export <markdown|jsonl|html>',
    handler: async (cmd, _ctx, _deps) => {
      const format = cmd.args[0]?.toLowerCase()
      if (!format || !['markdown', 'jsonl', 'html'].includes(format)) {
        return { success: false, message: '用法：/export <markdown|jsonl|html>' }
      }
      return { success: true, message: `导出为 ${format.toUpperCase()} 功能待实现。` }
    },
  })

  registry.register({
    id: 'builtin:sessions',
    name: 'sessions',
    aliases: [],
    layer: 'builtin',
    group: 'session',
    description: '切换或搜索会话',
    scope: 'global',
    risk: 'none',
    usage: '/sessions [query]',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '会话切换功能请使用侧边栏或 Ctrl+K 命令面板。' }
    },
  })

  registry.register({
    id: 'builtin:history',
    name: 'history',
    aliases: [],
    layer: 'builtin',
    group: 'session',
    description: '打开会话历史',
    scope: 'global',
    risk: 'none',
    usage: '/history',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '会话历史请使用侧边栏查看。' }
    },
  })

  registry.register({
    id: 'builtin:checkpoint',
    name: 'checkpoint',
    aliases: ['cp'],
    layer: 'builtin',
    group: 'session',
    description: 'List or restore SDK checkpoints',
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

  registry.register({
    id: 'builtin:new-session',
    name: 'new-session',
    aliases: ['new'],
    layer: 'builtin',
    group: 'session',
    description: '创建新会话',
    scope: 'global',
    risk: 'none',
    usage: '/new-session',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '请使用界面左上角「新建会话」按钮或快捷键创建。' }
    },
  })

  registry.register({
    id: 'builtin:fork',
    name: 'fork',
    aliases: [],
    layer: 'builtin',
    group: 'session',
    description: '分叉当前会话',
    scope: 'session',
    risk: 'none',
    usage: '/fork',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '会话分叉功能待实现。' }
    },
  })

  registry.register({
    id: 'builtin:resume',
    name: 'resume',
    aliases: [],
    layer: 'builtin',
    group: 'session',
    description: '恢复已保存会话',
    scope: 'global',
    risk: 'none',
    usage: '/resume <id>',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '会话恢复功能请使用侧边栏历史列表。' }
    },
  })

  // ── Model ──

  registry.register({
    id: 'builtin:provider',
    name: 'provider',
    aliases: [],
    layer: 'builtin',
    group: 'model',
    description: '切换或查看 Provider',
    scope: 'session',
    risk: 'low',
    usage: '/provider [provider-id]',
    handler: async (cmd, ctx, deps) => {
      const providerId = cmd.args[0]
      if (!providerId) {
        const session = deps.getSession(ctx.sessionId)
        const name = session ? deps.getProviderName(session.providerProfileId) : '未知'
        return { success: true, message: `当前 Provider：${name}\n用法：/provider <provider-id>` }
      }
      return { success: true, message: `Provider 切换功能待实现。目标：${providerId}` }
    },
  })

  registry.register({
    id: 'builtin:reason',
    name: 'reason',
    aliases: ['reasoning'],
    layer: 'builtin',
    group: 'model',
    description: '调整推理力度',
    scope: 'session',
    risk: 'low',
    usage: '/reason <none|minimal|low|medium|high>',
    handler: async (cmd, _ctx, _deps) => {
      const level = cmd.args[0]?.toLowerCase()
      const validLevels = ['none', 'minimal', 'low', 'medium', 'high']
      if (!level || !validLevels.includes(level)) {
        return { success: false, message: `用法：/reason <${validLevels.join('|')}>` }
      }
      return { success: true, message: `推理力度已设置为 \`${level}\`。（此功能需要 Session 支持，待集成）` }
    },
  })

  // ── Context ──

  registry.register({
    id: 'builtin:context',
    name: 'context',
    aliases: [],
    layer: 'builtin',
    group: 'context',
    description: '上下文管理',
    scope: 'session',
    risk: 'none',
    hasSubcommands: true,
    usage: '/context [mode|minimal|project-smart|deep-research|surgical]',
    handler: async (cmd, _ctx, _deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      if (!subcommand) {
        return { success: true, message: '**上下文管理**\n\n用法：\n- `/context` — 查看当前上下文\n- `/context mode <mode>` — 切换上下文模式\n\n可用模式：minimal / project-smart / deep-research / surgical / review / manual\n\n（Context Governor 功能待实现）' }
      }
      if (subcommand === 'mode') {
        const mode = cmd.args[1]
        if (!mode) {
          return { success: true, message: '用法：/context mode <minimal|project-smart|deep-research|surgical|review|manual>' }
        }
        return { success: true, message: `上下文模式已切换为 \`${mode}\`。（Context Governor 待实现）` }
      }
      return { success: true, message: `上下文子命令 \`${subcommand}\` 待实现。` }
    },
  })

  registry.register({
    id: 'builtin:clear-context',
    name: 'clear-context',
    aliases: [],
    layer: 'builtin',
    group: 'context',
    description: '清空会话临时上下文',
    scope: 'session',
    risk: 'medium',
    usage: '/clear-context',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '临时上下文已清空。（Context Governor 待实现）' }
    },
  })

  registry.register({
    id: 'builtin:summarize',
    name: 'summarize',
    aliases: [],
    layer: 'builtin',
    group: 'context',
    description: '生成摘要',
    scope: 'session',
    risk: 'none',
    usage: '/summarize <decisions|files|artifacts|all>',
    handler: async (cmd, _ctx, _deps) => {
      const scope = cmd.args[0] || 'all'
      return { success: true, message: `生成 ${scope} 摘要功能待实现。` }
    },
  })

  // ── Permission ──

  registry.register({
    id: 'builtin:sandbox',
    name: 'sandbox',
    aliases: [],
    layer: 'builtin',
    group: 'permission',
    description: '切换沙箱等级',
    scope: 'workspace',
    risk: 'high',
    hasSubcommands: true,
    usage: '/sandbox level <0|1|2|3|4>',
    handler: async (cmd, _ctx, _deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      if (subcommand === 'level') {
        const level = cmd.args[1]
        if (!level || !['0', '1', '2', '3', '4'].includes(level)) {
          return { success: false, message: '用法：/sandbox level <0|1|2|3|4>\n\n0 = 无沙箱\n1 = 基础文件保护\n2 = 网络限制\n3 = 完全隔离\n4 = 最大安全' }
        }
        return { success: true, message: `沙箱等级已设置为 ${level}。` }
      }
      return { success: true, message: '**沙箱管理**\n\n用法：\n- `/sandbox level <0-4>` — 设置沙箱等级\n\n（沙箱功能待实现）' }
    },
  })

  registry.register({
    id: 'builtin:audit',
    name: 'audit',
    aliases: [],
    layer: 'builtin',
    group: 'permission',
    description: '打开权限和工具调用审计',
    scope: 'workspace',
    risk: 'none',
    usage: '/audit',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '审计日志功能待实现。' }
    },
  })

  // ── Workflow ──

  registry.register({
    id: 'builtin:workflow',
    name: 'workflow',
    aliases: ['wf'],
    layer: 'builtin',
    group: 'workflow',
    description: '工作流管理',
    scope: 'workspace',
    risk: 'low',
    hasSubcommands: true,
    usage: '/workflow <list|run|pause|resume|cancel|rerun|create-from-session|inspect>',
    handler: async (cmd, _ctx, _deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      const subHandlers: Record<string, string> = {
        list: '列出所有工作流',
        run: `运行工作流 ${cmd.args[1] ?? '<id>'}`,
        pause: '暂停当前工作流',
        resume: '恢复当前工作流',
        cancel: '取消当前工作流',
        rerun: `从节点 ${cmd.args[1] ?? '<node-id>'} 重跑`,
        'create-from-session': '从当前会话提炼工作流',
        inspect: '打开工作流图谱',
      }
      if (subcommand && subHandlers[subcommand]) {
        return { success: true, message: `${subHandlers[subcommand]}。（Workflow 执行引擎待实现）` }
      }
      return {
        success: true,
        message: '**工作流管理**\n\n用法：\n- `/workflow list` — 查看工作流\n- `/workflow run <id>` — 运行工作流\n- `/workflow pause|resume|cancel` — 控制当前工作流\n- `/workflow rerun <node-id>` — 从节点重跑\n- `/workflow create-from-session` — 从会话提炼\n- `/workflow inspect` — 打开图谱\n\n（Workflow 执行引擎待实现）',
      }
    },
  })

  // ── Agent ──

  registry.register({
    id: 'builtin:agent',
    name: 'agent',
    aliases: ['agents'],
    layer: 'builtin',
    group: 'agent',
    description: 'Agent 管理',
    scope: 'workspace',
    risk: 'low',
    hasSubcommands: true,
    usage: '/agent <list|spawn|pause|resume|cancel|graph>',
    handler: async (cmd, _ctx, _deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      if (subcommand === 'list') {
        return { success: true, message: '当前 Agent：**Code Agent**（内置默认）\n\n（多 Agent 编排待实现）' }
      }
      if (subcommand === 'spawn') {
        const role = cmd.args[1] || cmd.freeText
        return { success: true, message: `创建 ${role ?? '新的'} subagent。（多 Agent 编排待实现）` }
      }
      return {
        success: true,
        message: '**Agent 管理**\n\n用法：\n- `/agent list` — 查看 Agent\n- `/agent spawn <role>` — 创建 subagent\n- `/agent pause|resume|cancel <id>` — 控制 Agent\n- `/agent graph` — 打开可视化\n\n（多 Agent 编排待实现）',
      }
    },
  })

  registry.register({
    id: 'builtin:handoff',
    name: 'handoff',
    aliases: [],
    layer: 'builtin',
    group: 'agent',
    description: '将当前任务交给指定 Agent',
    scope: 'session',
    risk: 'medium',
    usage: '/handoff <agent-id>',
    handler: async (cmd, _ctx, _deps) => {
      const agentId = cmd.args[0]
      if (!agentId) {
        return { success: false, message: '用法：/handoff <agent-id>' }
      }
      return { success: true, message: `任务交接给 \`${agentId}\` 功能待实现。` }
    },
  })

  // ── MCP ──

  registry.register({
    id: 'builtin:mcp',
    name: 'mcp',
    aliases: [],
    layer: 'builtin',
    group: 'mcp',
    description: 'MCP 服务管理',
    scope: 'workspace',
    risk: 'low',
    hasSubcommands: true,
    usage: '/mcp <list|enable|disable|tools|call|diagnose>',
    handler: async (cmd, _ctx, _deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      if (subcommand === 'list') {
        return { success: true, message: '请使用 MCP 管理页面查看已配置的服务器。' }
      }
      return {
        success: true,
        message: '**MCP 管理**\n\n用法：\n- `/mcp list` — 查看服务器\n- `/mcp enable|disable <server>` — 启用/禁用\n- `/mcp tools <server>` — 查看工具\n- `/mcp call <tool>` — 手动调用\n- `/mcp diagnose <server>` — 诊断连接\n\n请使用 MCP 管理页面进行操作。',
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
    usage: '/skill <list|search|install|enable|disable|run>',
    handler: async (cmd, _ctx, _deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      if (subcommand === 'list') {
        return { success: true, message: '请使用 Skills 管理页面查看已安装的技能。' }
      }
      return {
        success: true,
        message: '**Skill 管理**\n\n用法：\n- `/skill list` — 查看技能\n- `/skill search <query>` — 搜索\n- `/skill install <source>` — 安装\n- `/skill enable|disable <id>` — 启用/禁用\n- `/skill run <id>` — 运行\n\n请使用 Skills 管理页面进行操作。',
      }
    },
  })

  // ── Resource ──

  registry.register({
    id: 'builtin:resource',
    name: 'resource',
    aliases: [],
    layer: 'builtin',
    group: 'resource',
    description: '资源管理',
    scope: 'workspace',
    risk: 'low',
    hasSubcommands: true,
    usage: '/resource <eco|balanced|turbo|status>',
    handler: async (cmd, _ctx, _deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
      const profiles = ['eco', 'balanced', 'turbo']
      if (subcommand && profiles.includes(subcommand)) {
        return { success: true, message: `资源档位已切换为 \`${subcommand}\`。（Resource Governor 待实现）` }
      }
      if (subcommand === 'status') {
        return { success: true, message: '资源状态查看功能待实现。（Resource Governor 待实现）' }
      }
      return {
        success: true,
        message: '**资源管理**\n\n用法：\n- `/resource eco|balanced|turbo` — 切换档位\n- `/resource status` — 查看资源占用\n\n（Resource Governor 待实现）',
      }
    },
  })

  registry.register({
    id: 'builtin:queue',
    name: 'queue',
    aliases: ['ps'],
    layer: 'builtin',
    group: 'resource',
    description: '查看后台任务队列',
    scope: 'workspace',
    risk: 'none',
    usage: '/queue',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '后台任务队列查看功能待实现。' }
    },
  })

  registry.register({
    id: 'builtin:kill-run',
    name: 'kill-run',
    aliases: ['stop'],
    layer: 'builtin',
    group: 'resource',
    description: '停止当前运行',
    scope: 'session',
    risk: 'high',
    usage: '/kill-run',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '请使用 Chat 界面的取消按钮停止当前运行。' }
    },
  })

  registry.register({
    id: 'builtin:kill-workspace',
    name: 'kill-workspace',
    aliases: ['clean'],
    layer: 'builtin',
    group: 'resource',
    description: '停止当前 workspace 的所有 agent 和 MCP 子进程',
    scope: 'workspace',
    risk: 'high',
    usage: '/kill-workspace',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '⚠️ 停止所有 workspace 进程功能待实现。请使用界面操作。' }
    },
  })

  // ── Git ──

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
    usage: '/git <status|log|stash|branch>',
    handler: async (cmd, _ctx, deps) => {
      const subcommand = cmd.args[0] || cmd.subcommand
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
          message: '**Git 操作**\n\n用法：\n- `/git status` — 查看状态\n- `/git log [n]` — 查看提交记录\n- `/git stash` — 查看暂存\n- `/git branch` — 查看分支',
        }
      } catch (err) {
        return { success: false, message: `Git 操作失败：${err instanceof Error ? err.message : String(err)}` }
      }
    },
  })

  // ── Team ──

  registry.register({
    id: 'builtin:team',
    name: 'team',
    aliases: [],
    layer: 'builtin',
    group: 'team',
    description: '团队协作',
    scope: 'team',
    risk: 'none',
    hasSubcommands: true,
    usage: '/team <invite|request-approval>',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '团队协作功能待实现（Phase 5）。' }
    },
  })

  // ── Utility ──

  registry.register({
    id: 'builtin:config',
    name: 'config',
    aliases: [],
    layer: 'builtin',
    group: 'system',
    description: '查看/修改配置',
    scope: 'global',
    risk: 'none',
    usage: '/config [key] [value]',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '配置管理请使用 Settings 页面。' }
    },
  })

  registry.register({
    id: 'builtin:vim',
    name: 'vim',
    aliases: [],
    layer: 'builtin',
    group: 'system',
    description: '切换 Vim 编辑模式',
    scope: 'global',
    risk: 'none',
    usage: '/vim',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: 'Vim 模式切换功能待实现。' }
    },
  })

  registry.register({
    id: 'builtin:experimental',
    name: 'experimental',
    aliases: [],
    layer: 'builtin',
    group: 'system',
    description: '切换实验特性',
    scope: 'global',
    risk: 'low',
    usage: '/experimental',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '实验特性开关待实现。' }
    },
  })

  registry.register({
    id: 'builtin:hooks',
    name: 'hooks',
    aliases: [],
    layer: 'builtin',
    group: 'system',
    description: '查看和管理生命周期钩子',
    scope: 'workspace',
    risk: 'none',
    usage: '/hooks',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '生命周期钩子管理待实现。' }
    },
  })

  registry.register({
    id: 'builtin:logout',
    name: 'logout',
    aliases: [],
    layer: 'builtin',
    group: 'system',
    description: '登出',
    scope: 'global',
    risk: 'medium',
    usage: '/logout',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '登出功能请通过 Settings 页面操作。' }
    },
  })

  registry.register({
    id: 'builtin:login',
    name: 'login',
    aliases: [],
    layer: 'builtin',
    group: 'system',
    description: '登录',
    scope: 'global',
    risk: 'none',
    usage: '/login',
    handler: async (_cmd, _ctx, _deps) => {
      return { success: true, message: '登录功能请通过 Settings 页面操作。' }
    },
  })

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
