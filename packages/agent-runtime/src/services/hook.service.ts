/**
 * @module hook.service
 *
 * Hook Service
 *
 * 负责在会话关键节点触发 hooks（提示音、系统通知等）。
 * 通过 IPC 调用主进程的实际执行能力。
 */

import type { HookNode, HookConfig } from '@spark/protocol'
import { DEFAULT_HOOK_CONFIG } from '@spark/protocol'
import { SettingsService } from './settings.service.js'
import { createLogger } from '@spark/shared'

const log = createLogger('hook.service')

const HOOK_SETTINGS_CATEGORY = 'hooks'
const HOOK_SETTINGS_KEY = 'config'

/**
 * Hook 触发器接口
 * 用于向主进程发送 hook 触发请求
 */
export type HookTriggerFn = (params: {
  sessionId: string
  node: HookNode
  title?: string
  body?: string
}) => Promise<{ triggered: boolean }>

/**
 * Hook Service
 *
 * 管理配置读取和 hook 触发逻辑。
 */
export class HookService {
  private triggerFn: HookTriggerFn | null = null

  constructor(private readonly settingsService: SettingsService) {}

  /**
   * 设置 hook 触发函数
   * 通常在运行时注入 IPC 调用能力
   */
  setTriggerFn(fn: HookTriggerFn): void {
    this.triggerFn = fn
  }

  /**
   * 获取 hook 配置
   */
  getConfig(): HookConfig {
    const value = this.settingsService.get(HOOK_SETTINGS_CATEGORY, HOOK_SETTINGS_KEY)
    if (value == null || typeof value !== 'object') {
      return DEFAULT_HOOK_CONFIG
    }
    return this.mergeConfig(value as Partial<HookConfig>)
  }

  /**
   * 更新 hook 配置
   */
  updateConfig(patch: Partial<HookConfig>): void {
    const current = this.getConfig()
    const merged = this.mergeConfig({ ...current, ...patch })
    this.settingsService.set(HOOK_SETTINGS_CATEGORY, HOOK_SETTINGS_KEY, merged)
  }

  /**
   * 触发指定节点的 hooks
   *
   * @param sessionId - Session ID
   * @param node - 触发的节点类型
   * @param context - 可选的上下文信息（标题、内容）
   */
  async trigger(
    sessionId: string,
    node: HookNode,
    context?: { title?: string; body?: string },
  ): Promise<boolean> {
    if (!this.triggerFn) {
      log.debug(`Hook trigger skipped: no trigger function set (node=${node})`)
      return false
    }

    try {
      const result = await this.triggerFn({
        sessionId,
        node,
        ...(context?.title !== undefined && { title: context.title }),
        ...(context?.body !== undefined && { body: context.body }),
      })
      return result.triggered
    } catch (err) {
      log.warn(`Failed to trigger hook for node=${node}: ${String(err)}`)
      return false
    }
  }

  /**
   * 检查指定节点的 hook 是否启用
   */
  isHookEnabled(node: HookNode, type: 'sound' | 'notification'): boolean {
    const config = this.getConfig()
    if (!config.enabled) return false
    const nodeConfig = config.nodes[node]
    if (!nodeConfig) return false
    return type === 'sound' ? nodeConfig.sound : nodeConfig.notification
  }

  /**
   * 合并配置，确保所有节点都有默认值
   */
  private mergeConfig(partial: Partial<HookConfig>): HookConfig {
    return {
      enabled: partial.enabled ?? DEFAULT_HOOK_CONFIG.enabled,
      nodes: {
        ...DEFAULT_HOOK_CONFIG.nodes,
        ...(partial.nodes ?? {}),
      },
    }
  }
}
