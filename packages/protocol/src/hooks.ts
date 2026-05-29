/**
 * @module hooks
 *
 * Hook 系统类型定义
 *
 * 支持在会话关键节点触发自定义行为，如提示音、系统通知等。
 * 节点类型：
 *   - permission_request: 权限申请时
 *   - ask_user_question: Agent 需要用户补充信息时
 *   - session_end: Turn 正常结束时
 *   - session_fail: 运行出错时
 */

/**
 * Hook 节点类型
 */
export type HookNode = 'permission_request' | 'ask_user_question' | 'session_end' | 'session_fail'

/**
 * Hook 类型
 */
export type HookType = 'sound' | 'notification'

/**
 * 单个节点的 Hook 配置
 */
export interface HookNodeConfig {
  /** 播放提示音 */
  sound: boolean
  /** 显示系统通知 */
  notification: boolean
}

/**
 * 完整的 Hook 配置
 */
export interface HookConfig {
  /** Hook 系统总开关 */
  enabled: boolean
  /** 各节点的配置 */
  nodes: Record<HookNode, HookNodeConfig>
}

/**
 * 默认 Hook 配置：全部开启
 */
export const DEFAULT_HOOK_CONFIG: HookConfig = {
  enabled: true,
  nodes: {
    permission_request: { sound: true, notification: true },
    ask_user_question: { sound: true, notification: true },
    session_end: { sound: true, notification: true },
    session_fail: { sound: true, notification: true },
  },
}

/**
 * Hook 触发时的上下文信息
 */
export interface HookTriggerContext {
  /** Session ID */
  sessionId: string
  /** 触发的节点 */
  node: HookNode
  /** 通知标题 */
  title?: string
  /** 通知内容 */
  body?: string
}
