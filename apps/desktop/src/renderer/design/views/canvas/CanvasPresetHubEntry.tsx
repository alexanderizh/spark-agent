import { Button, Tag } from '@lobehub/ui'
import { Icons } from '../../Icons'

type CanvasPresetHubEntryProps = {
  configuredPresetCount: number
  onOpen: () => void
  variant: 'panel' | 'floating'
}

function buildPresetStatus(count: number) {
  return count > 0 ? `已配置 ${count}` : '未配置'
}

export function CanvasPresetHubEntry({
  configuredPresetCount,
  onOpen,
  variant,
}: CanvasPresetHubEntryProps) {
  const configured = configuredPresetCount > 0
  const statusText = buildPresetStatus(configuredPresetCount)

  if (variant === 'floating') {
    return (
      <button
        type="button"
        className="canvas-preset-hub-quick-entry"
        aria-label={`打开节点预设中心，${statusText}`}
        onClick={onOpen}
      >
        <span className="canvas-preset-hub-quick-entry-icon">
          <Icons.Sliders size={16} />
        </span>
        <span className="canvas-preset-hub-quick-entry-body">
          <strong>预设中心</strong>
          <span>统一节点默认 Agent / 模型 / Skills</span>
        </span>
        <span className="canvas-preset-hub-quick-entry-status">{statusText}</span>
      </button>
    )
  }

  return (
    <section className="canvas-preset-hub-card">
      <div className="canvas-preset-hub-card-head">
        <div className="canvas-preset-hub-card-heading">
          <span className="canvas-preset-hub-card-icon">
            <Icons.Sliders size={18} />
          </span>
          <div className="canvas-preset-hub-card-title">
            <div className="canvas-preset-hub-card-title-row">
              <h3>节点预设中心</h3>
              <Tag bordered color="blue">
                功能中心
              </Tag>
            </div>
            <span>统一配置后续新建任务节点的默认 Prompt、Agent、模型、Skills 与参数</span>
          </div>
        </div>
        <Tag bordered color={configured ? 'gold' : 'default'}>
          {statusText}
        </Tag>
      </div>
      <div className="canvas-preset-hub-card-points">
        <span>按节点类型拆分管理</span>
        <span>新节点首次打开时按这里初始化</span>
        <span>节点改过后保持自己的配置</span>
      </div>
      <div className="canvas-preset-hub-card-actions">
        <Button size="middle" type="primary" onClick={onOpen}>
          打开预设中心
        </Button>
      </div>
    </section>
  )
}
