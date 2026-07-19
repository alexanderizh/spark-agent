import { Spin } from 'antd'
import { Icons } from '../Icons'
import {
  extractCanvasNodeIds,
  getChatPanelToolLabel,
  type ChatPanelToolBlock,
} from './chat-panel-tool-activity'

export function ChatPanelToolActivity({
  blocks,
  onFocusNode,
}: {
  blocks: ChatPanelToolBlock[]
  onFocusNode?: (nodeId: string) => void
}): React.ReactElement | null {
  if (blocks.length === 0) return null
  const runningCount = blocks.filter(
    (block) => block.status === 'pending' || block.status === 'running',
  ).length
  const errorCount = blocks.filter((block) => block.status === 'error').length
  const completedCount = blocks.filter((block) => block.status === 'success').length
  const statusLabel =
    runningCount > 0
      ? `正在执行 · ${completedCount}/${blocks.length}`
      : errorCount > 0
        ? `${errorCount} 项失败`
        : `${completedCount} 项完成`

  return (
    <section className="chat-panel-tool-activity" aria-label="画布执行记录">
      <div className="chat-panel-tool-activity-head" role="status" aria-live="polite">
        <Icons.Workflow size={13} />
        <span>画布执行</span>
        <span className="chat-panel-tool-activity-meta">{statusLabel}</span>
      </div>
      <div className="chat-panel-tool-activity-list">
        {blocks.map((block) => {
          const running = block.status === 'pending' || block.status === 'running'
          const nodeIds = extractCanvasNodeIds(block)
          return (
            <div
              key={block.toolCallId}
              className={`chat-panel-tool-activity-row is-${block.status}`}
            >
              <span className="chat-panel-tool-activity-icon" aria-hidden="true">
                {running ? (
                  <Spin size="small" />
                ) : block.status === 'error' ? (
                  <Icons.X size={11} />
                ) : (
                  <Icons.Check size={11} />
                )}
              </span>
              <span className="chat-panel-tool-activity-copy">
                <span className="chat-panel-tool-activity-name">
                  {getChatPanelToolLabel(block.toolName)}
                </span>
                {block.error && (
                  <span className="chat-panel-tool-activity-error">{block.error}</span>
                )}
              </span>
              {onFocusNode != null && nodeIds.length > 0 && (
                <span className="chat-panel-tool-activity-nodes">
                  {nodeIds.slice(0, 3).map((nodeId, index) => (
                    <button
                      key={nodeId}
                      type="button"
                      title={`定位节点 ${nodeId}`}
                      onClick={() => onFocusNode(nodeId)}
                    >
                      <Icons.Crosshair size={10} />
                      {nodeIds.length === 1 ? '定位' : index + 1}
                    </button>
                  ))}
                </span>
              )}
              {block.durationMs != null && (
                <span className="chat-panel-tool-activity-duration">
                  {formatToolDuration(block.durationMs)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function formatToolDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs}ms` : `${(durationMs / 1_000).toFixed(1)}s`
}
