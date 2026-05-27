/**
 * CommandRegistry — 命令注册表 + 内置命令实现
 */

import type { ParsedCommand } from './command-parser.js'

export interface CommandContext {
  sessionId: string
  workspaceId?: string
  providerId?: string
  model?: string
}

export interface CommandResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

export interface CommandDefinition {
  name: string
  description: string
  category: 'general' | 'model' | 'session' | 'workspace' | 'debug'
  usage?: string
  isDangerous?: boolean
  handler: (cmd: ParsedCommand, ctx: CommandContext, deps: CommandDeps) => Promise<CommandResult>
}

/** 命令执行所需的外部依赖（由 SessionService 注入） */
export interface CommandDeps {
  getSession: (id: string) => { title: string; status: string; modelId: string | null; providerProfileId: string } | null
  updateSession: (id: string, fields: { modelId?: string | null }) => Promise<void>
  clearSessionEvents: (id: string) => Promise<void>
  getProviderName: (id: string) => string | null
  setApprovalMode: (sessionId: string, enabled: boolean) => void
}

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>()

  register(def: CommandDefinition): void {
    this.commands.set(def.name, def)
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name)
  }

  list(): CommandDefinition[] {
    return Array.from(this.commands.values())
  }

  async execute(cmd: ParsedCommand, ctx: CommandContext, deps: CommandDeps): Promise<CommandResult> {
    const def = this.commands.get(cmd.name)
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

/** 创建并注册所有内置命令 */
export function createBuiltinRegistry(): CommandRegistry {
  const registry = new CommandRegistry()

  // /help
  registry.register({
    name: 'help',
    description: '显示所有可用命令',
    category: 'general',
    usage: '/help [command]',
    handler: async (cmd, _ctx, _deps) => {
      // 如果指定了命令名，显示该命令详情（此处 registry 引用在闭包外，简化处理）
      const lines = [
        '**可用命令**',
        '',
        '`/help [command]` — 显示帮助',
        '`/status` — 显示当前会话状态',
        '`/model <model-id>` — 切换模型',
        '`/compact` — 压缩上下文（清除早期消息）',
        '`/clear` — 清空当前会话所有消息',
        '`/approval <on|off>` — 开关工具审批',
      ]
      return { success: true, message: lines.join('\n') }
    },
  })

  // /status
  registry.register({
    name: 'status',
    description: '显示当前会话状态',
    category: 'session',
    usage: '/status',
    handler: async (_cmd, ctx, deps) => {
      const session = deps.getSession(ctx.sessionId)
      if (session == null) {
        return { success: false, message: '会话不存在' }
      }
      const providerName = deps.getProviderName(session.providerProfileId) ?? session.providerProfileId
      const lines = [
        `**会话状态**`,
        `- 会话 ID：\`${ctx.sessionId}\``,
        `- 标题：${session.title}`,
        `- 状态：${session.status}`,
        `- Provider：${providerName}`,
        `- 模型：${session.modelId ?? '（使用 Provider 默认）'}`,
      ]
      return {
        success: true,
        message: lines.join('\n'),
        data: { sessionId: ctx.sessionId, status: session.status, model: session.modelId },
      }
    },
  })

  // /model
  registry.register({
    name: 'model',
    description: '切换当前会话使用的模型',
    category: 'model',
    usage: '/model <model-id>',
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

  // /compact
  registry.register({
    name: 'compact',
    description: '压缩上下文（清除早期消息以释放 token）',
    category: 'session',
    usage: '/compact',
    handler: async (_cmd, ctx, deps) => {
      await deps.clearSessionEvents(ctx.sessionId)
      return { success: true, message: '上下文已压缩，早期消息已清除。' }
    },
  })

  // /clear
  registry.register({
    name: 'clear',
    description: '清空当前会话所有消息',
    category: 'session',
    usage: '/clear',
    isDangerous: true,
    handler: async (_cmd, ctx, deps) => {
      await deps.clearSessionEvents(ctx.sessionId)
      return { success: true, message: '会话消息已全部清空。' }
    },
  })

  // /approval
  registry.register({
    name: 'approval',
    description: '开关工具审批模式',
    category: 'session',
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

  return registry
}
