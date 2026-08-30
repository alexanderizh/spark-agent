import { Icons } from '../Icons'
import type { ChatPanelThinkingBlock } from './chat-panel-thinking'

export function ChatPanelThinkingGroup({
  blocks,
}: {
  blocks: ChatPanelThinkingBlock[]
}): React.ReactElement | null {
  const contents = blocks
    .map((block) => block.content)
    .filter((content) => content.trim().length > 0)
  if (contents.length === 0) return null

  const isStreaming = blocks.some((block) => block.isStreaming)

  return (
    <details className={`chat-panel-thinking${isStreaming ? ' is-streaming' : ''}`}>
      <summary>
        <Icons.ChevronRight className="chat-panel-thinking-chevron" size={12} />
        <span className="chat-panel-thinking-status" aria-hidden="true" />
        <span className="chat-panel-thinking-label">{isStreaming ? '思考中…' : '思考过程'}</span>
        {contents.length > 1 && (
          <span className="chat-panel-thinking-count">{contents.length} 段</span>
        )}
      </summary>
      <div className="chat-panel-thinking-content">
        <pre>{contents.join('\n\n')}</pre>
      </div>
    </details>
  )
}
