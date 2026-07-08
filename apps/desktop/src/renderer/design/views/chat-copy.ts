import type { UIBlock, UIMessage } from '../services/event-mapper'

export function isLocalCopySlashCommand(text: string): boolean {
  return /^\/copy(?:\s|$)/i.test(text.trim())
}

export function serializeAssistantMessageToMarkdown(message: UIMessage): string {
  return message.blocks
    .map((block: UIBlock) => {
      switch (block.kind) {
        case 'text':
          return block.content.trim()
        case 'thinking':
          return block.content.trim() ? `> ${block.content.trim().replace(/\n/g, '\n> ')}` : ''
        case 'error':
          return `**错误:** ${block.message}`.trim()
        case 'tool_call': {
          const output = block.output ?? block.error ?? ''
          return output.trim() ? `\`\`\`\n${output.trim()}\n\`\`\`` : ''
        }
        case 'file_change':
          return block.diff?.trim()
            ? `### ${block.changeType}: ${block.path}\n\n\`\`\`diff\n${block.diff.trim()}\n\`\`\``
            : `### ${block.changeType}: ${block.path}`
        default:
          return ''
      }
    })
    .filter((part) => part.length > 0)
    .join('\n\n')
    .trim()
}

export function getLastAssistantMessageMarkdown(messages: UIMessage[]): string | null {
  const message = [...messages].reverse().find((item) => item.role === 'assistant')
  if (message == null) return null
  const markdown = serializeAssistantMessageToMarkdown(message)
  return markdown.length > 0 ? markdown : null
}


function getMessageRoleLabel(role: UIMessage['role']): string {
  return role === 'user' ? '用户' : '助手'
}

export function serializeMessageToMarkdown(message: UIMessage): string {
  const body = serializeAssistantMessageToMarkdown(message)
  if (body.length === 0) return ''
  const time = message.timestamp != null ? ` · ${message.timestamp}` : ''
  return `## ${getMessageRoleLabel(message.role)}${time}\n\n${body}`.trim()
}

export function serializeMessagesToMarkdown(messages: UIMessage[]): string {
  return messages
    .map(serializeMessageToMarkdown)
    .filter((part) => part.length > 0)
    .join('\n\n---\n\n')
    .trim()
}
