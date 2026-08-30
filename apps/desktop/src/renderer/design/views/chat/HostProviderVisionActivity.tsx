import { Button } from '@lobehub/ui'
import type { UIBlock } from '../../services/event-mapper'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { classNames } from '../../utils/class-names'
import { requestOpenCustomToolTrace } from '../customToolTraceNavigation'
import { parseHostProviderVisionOutput } from './host-provider-vision-tool'
import './HostProviderVisionActivity.less'

type ToolBlock = Extract<UIBlock, { kind: 'tool_call' }>

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs == null) return undefined
  if (durationMs < 1_000) return `${durationMs}ms`
  return `${(durationMs / 1_000).toFixed(1)}s`
}

export function HostProviderVisionActivity({ block }: { block: ToolBlock }) {
  const { setTweak } = useApp()
  const output = parseHostProviderVisionOutput(block.output)
  const toolId = optionalString(block.toolInput.toolId) ?? optionalString(output.toolId)
  const toolTitle = optionalString(block.toolInput.toolTitle) ?? '图像理解'
  const traceId = optionalPositiveInteger(output.traceId)
  const imageCount = optionalPositiveInteger(block.toolInput.imageCount) ?? 0
  const targetOrigin =
    optionalString(block.toolInput.targetOrigin) ?? optionalString(output.targetOrigin)
  const model = optionalString(block.toolInput.model) ?? optionalString(output.model)
  const duration = formatDuration(block.durationMs)
  const succeeded = block.status === 'success'

  const openTrace = () => {
    if (toolId == null) return
    setTweak('view', 'mcp')
    requestOpenCustomToolTrace({ toolId, ...(traceId != null ? { traceId } : {}) })
  }

  return (
    <div className={classNames('host-vision-activity', succeeded ? 'is-success' : 'is-error')}>
      <div className="host-vision-activity__summary">
        <Icons.Image size={14} />
        <span>
          {succeeded ? `已使用 ${toolTitle}` : '图像理解未完成'}
          {' · 因当前文本模型不支持图片'}
          {duration != null ? ` · ${duration}` : ''}
        </span>
      </div>
      <div className="host-vision-activity__details">
        <span>{imageCount} 张图片</span>
        {targetOrigin != null && <span>发送至 {targetOrigin}</span>}
        {model != null && <span>模型 {model}</span>}
        {traceId != null && <code>Trace #{traceId}</code>}
        {toolId != null && (
          <Button size="small" type="text" onClick={openTrace}>
            在 Tool Studio 打开
          </Button>
        )}
      </div>
      {block.error != null && <div className="host-vision-activity__error">{block.error}</div>}
    </div>
  )
}
