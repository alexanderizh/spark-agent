/**
 * spark_notify（in-process 版，claude SDK 路径）：agent 主动推送通知工具。
 *
 * 送达路径由 desktop 注入的 RemotePushProvider 决定（见
 * desktop/src/main/services/proactiveRemotePush.ts）：
 *   - 会话绑定了远程路由（TG/飞书/QQ/微信/wechat-claw）→ 逐条投递到远程聊天；
 *   - 未绑定（或渠道全部关闭 proactivePush）→ 回落桌面系统通知。
 *
 * provider 为 null（CLI 等非 desktop 环境）时不挂载——session.service 条件装配，
 * 与 spark_verify 同为进程内 type=sdk server，仅 claude-sdk 引擎可用。
 *
 * 频控：每轮 ≤ NOTIFY_USER_MAX_PER_TURN 条。server 每轮构建一次（buildNotifyMcpServer
 * 在轮次闭包内调用），闭包内计数天然按轮重置，无需外部注册表。
 */
import { z } from 'zod'
import type { SDKMcpServerConfig } from '../../../sdk/index.js'
import type { SdkMcpToolResult } from '../../../sdk/claude-sdk-executor.js'

export const NOTIFY_USER_MAX_PER_TURN = 3

export const NOTIFY_USER_TOOL_DESCRIPTION = [
  'Push a proactive notification to the user. Delivery path is chosen automatically:',
  'if this session is bound to remote chats (Telegram/Feishu/QQ/WeChat), the message is delivered there;',
  'otherwise it falls back to a desktop system notification.',
  'Use for: long-running task completion/failure, decisions that need the user, important anomalies.',
  'Discipline: say everything in ONE message — do not split into multiple pushes;',
  'only notify when there is genuine value (not after every step);',
  `at most ${NOTIFY_USER_MAX_PER_TURN} calls per turn — excess calls are rejected.`,
].join('\n')

/** desktop 注入的投递 provider（跨包解耦，仿 setCanvasMcpProvider 模式）。 */
export interface RemotePushProvider {
  notifyUser(sessionId: string, text: string, title?: string): Promise<NotifyUserResult>
}

export interface NotifyUserDeliveryTarget {
  /** 连接显示名（不暴露 externalId）。 */
  label: string
  channel: string
}

export interface NotifyUserDeliveryFailure extends NotifyUserDeliveryTarget {
  error: string
}

export interface NotifyUserResult {
  delivered: NotifyUserDeliveryTarget[]
  failures: NotifyUserDeliveryFailure[]
  /** 未绑定启用推送的远程路由时回落桌面系统通知。 */
  fallbackDesktop: boolean
}

/** loadSdkMcpFactory 的返回结构（收窄为 notify-server 实际用到的形状，便于测试注入）。 */
export interface SdkMcpServerFactory {
  createSdkMcpServer: (opts: {
    name: string
    version?: string
    tools: unknown[]
  }) => SDKMcpServerConfig
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<SdkMcpToolResult>,
  ) => unknown
}

function textResult(text: string, isError = false): SdkMcpToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

function describeResult(result: NotifyUserResult): string {
  const delivered = result.delivered.map((item) => `${item.label} (${item.channel})`).join(', ')
  const failed = result.failures
    .map((item) => `${item.label} (${item.channel}): ${item.error}`)
    .join('; ')
  if (result.fallbackDesktop)
    return 'Delivered via desktop system notification (no remote route bound).'
  if (result.delivered.length > 0 && result.failures.length === 0) {
    return `Notification delivered to: ${delivered}.`
  }
  if (result.delivered.length > 0) {
    return `Partially delivered to: ${delivered}. Failed: ${failed}.`
  }
  return `Delivery failed: ${failed}.`
}

/**
 * 构建 spark_notify in-process MCP server。每轮调用一次：
 * 闭包内的频控计数随轮次重建自动重置。
 */
export function buildNotifyMcpServer(
  factory: SdkMcpServerFactory,
  provider: RemotePushProvider,
  context: { sessionId: string },
): SDKMcpServerConfig {
  let usedThisTurn = 0
  const notifyTool = factory.tool(
    'notify_user',
    NOTIFY_USER_TOOL_DESCRIPTION,
    {
      text: z.string().min(1).max(4000).describe('Notification body. One complete message.'),
      title: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe('Optional short title, prepended to the message.'),
    } as Record<string, unknown>,
    async (args) => {
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      const title =
        typeof args.title === 'string' && args.title.trim().length > 0
          ? args.title.trim()
          : undefined
      if (text.length === 0) {
        return textResult('Notification text is empty; nothing was sent.', true)
      }
      if (usedThisTurn >= NOTIFY_USER_MAX_PER_TURN) {
        return textResult(
          `Rate limit reached: at most ${NOTIFY_USER_MAX_PER_TURN} notify_user calls per turn. ` +
            'Merge your pending notices into one message and retry once, or skip the less important ones.',
          true,
        )
      }
      usedThisTurn += 1
      const result = await provider.notifyUser(context.sessionId, text, title)
      return textResult(describeResult(result))
    },
  )
  return factory.createSdkMcpServer({
    name: 'spark_notify',
    version: '1.0.0',
    tools: [notifyTool],
  })
}
