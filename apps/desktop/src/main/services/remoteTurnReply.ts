import type { SessionAttachment } from '@spark/protocol'

export type RemoteTurnReplyTarget = {
  connectionId: string
  externalId: string
  attachments: SessionAttachment[]
}

export type RemoteTurnReplyTransport = {
  finishTurnFeedback(turnId: string, finalText?: string): Promise<boolean>
  sendReply(
    connectionId: string,
    externalId: string,
    text: string,
    attachments?: SessionAttachment[],
  ): Promise<void>
}

export async function deliverRemoteTurnReply(
  transport: RemoteTurnReplyTransport,
  turnId: string,
  target: RemoteTurnReplyTarget,
  rawContent: string,
): Promise<void> {
  const content = rawContent.trim()
  // Image Markdown needs the normal reply path to extract and deliver the image.
  const delivered = await transport.finishTurnFeedback(
    turnId,
    content.length > 0 && !content.includes('![') ? content : undefined,
  )
  if (content.length === 0 && target.attachments.length === 0) return
  if (delivered && target.attachments.length === 0) return
  await transport.sendReply(
    target.connectionId,
    target.externalId,
    delivered ? '' : content,
    target.attachments,
  )
}
