import type { RemoteChannelType, UserMessagePresentation } from '@spark/protocol'

const CHANNEL_LABEL: Record<RemoteChannelType, string> = {
  telegram: 'Telegram',
  feishu: '飞书',
  qq: 'QQ',
  'wechat-claw': '微信',
}

export function createRemoteUserTurn(
  channel: RemoteChannelType,
  userMessage: string,
  options: { canTransferFiles?: boolean } = {},
): UserMessagePresentation & { message: string } {
  const label = CHANNEL_LABEL[channel]
  const fileInstruction =
    options.canTransferFiles === false
      ? '当前连接未启用“传输文件”能力，不能向远程端发送或接收图片/附件；不要调用文件展示工具，也绝不能声称文件已发送。若用户要求传文件，请明确告知需要先在 SparkWork 的远程连接设置中开启“传输文件”。'
      : '若生成截图、图片或其他文件，请调用 mcp__spark_files__present_files 提交真实文件；只有文件实际提交后才能说“已发送”，不能只在文字里声称“已发送/见上方”。'
  return {
    message: `【本轮远程渠道：${label}】本轮消息来自 ${label}，回复只能发送回本轮渠道。历史消息中提到的 Telegram、QQ 或飞书不代表当前渠道；不要据此改变发送目标。${fileInstruction}\n\n${userMessage}`,
    turnSource: 'remote_user',
    userMessageDisplayContent: userMessage.trim().length > 0 ? userMessage : '（图片或附件）',
  }
}

/** Only shortcut an explicit local image path coupled with a send-to-me request. */
export function extractExplicitRemoteImageSendPath(text: string): string | null {
  const asksToSend =
    /(?:发给我|发送给我|传给我|发过来)/u.test(text) || /\bsend\b[\s\S]{0,300}\bto me\b/iu.test(text)
  if (!asksToSend) return null
  if (
    /(?:不要|别|无需|不用)[\s\S]*(?:发给我|发送给我|传给我|发过来)/u.test(text) ||
    /(?:don't|do not)[\s\S]*\bsend\b/iu.test(text)
  )
    return null
  const withoutUrls = text.replace(/https?:\/\/\S+/giu, '')
  const matches = [
    ...withoutUrls.matchAll(
      /(\/(?:[^\r\n<>“”"']+?)\.(?:png|jpe?g|webp))(?=这|那|并|发|传|给|\bto\b|[，。,.!！?？\s”"'）)]|$)/giu,
    ),
  ]
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null
}
