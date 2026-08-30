import { useMemo, useState } from 'react'
import { Tag, Tooltip, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { BUILTIN_TEMPLATES, type CanvasTemplate, type CanvasTemplateType } from './canvasTemplates'

/**
 * 模板中心（文档 §7.8）。
 *
 * 第一阶段：内置工作流模板 + Prompt 模板 + 布局模板。
 * 点击模板 → 在当前 board 视口中心生成节点组合（通过 applyTemplate 落库）。
 * 用户自定义模板留待后续（先放 localStorage）。
 */

const TYPE_LABEL: Record<CanvasTemplateType, string> = {
  prompt: 'Prompt',
  task_params: '任务参数',
  workflow: '工作流',
  layout: '布局',
}

const TYPE_COLOR: Record<CanvasTemplateType, string> = {
  prompt: 'orange',
  task_params: 'blue',
  workflow: 'green',
  layout: 'default',
}

const TYPE_ICON: Record<CanvasTemplateType, React.ReactNode> = {
  prompt: <Icons.Edit size={15} />,
  task_params: <Icons.Sparkles size={15} />,
  workflow: <Icons.Layers size={15} />,
  layout: <Icons.PanelLeft size={15} />,
}

export function CanvasTemplatePanel({
  onApply,
}: {
  onApply: (template: CanvasTemplate) => void
}) {
  const [filter, setFilter] = useState<CanvasTemplateType | 'all'>('all')

  const filtered = useMemo(
    () => (filter === 'all' ? BUILTIN_TEMPLATES : BUILTIN_TEMPLATES.filter((t) => t.type === filter)),
    [filter],
  )

  return (
    <div className="canvas-template-panel">
      <div className="canvas-template-filters">
        {(['all', 'workflow', 'prompt', 'layout'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`canvas-template-filter${filter === key ? ' active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {key === 'all' ? '全部' : TYPE_LABEL[key]}
          </button>
        ))}
      </div>

      <div className="canvas-template-list">
        {filtered.map((template) => (
          <div key={template.id} className="canvas-template-card">
            <div className="canvas-template-card-head">
              <span className="canvas-template-card-icon">{TYPE_ICON[template.type]}</span>
              <div className="canvas-template-card-title-block">
                <div className="canvas-template-card-title">{template.name}</div>
                <Tag color={TYPE_COLOR[template.type]} bordered className="canvas-template-type-tag">
                  {TYPE_LABEL[template.type]}
                </Tag>
              </div>
            </div>
            {template.description && (
              <p className="canvas-template-card-desc">{template.description}</p>
            )}
            <div className="canvas-template-card-meta">
              <span>{template.nodes.length} 节点{template.edges?.length ? ` · ${template.edges.length} 连线` : ''}</span>
            </div>
            <div className="canvas-template-card-actions">
              <Tooltip title="在当前画布生成这组节点">
                <Button
                  size="middle"
                  type="primary"
                  icon={<Icons.Plus size={13} />}
                  onClick={() => {
                    onApply(template)
                    message.success(`已应用模板「${template.name}」`)
                  }}
                >
                  应用模板
                </Button>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>

      <div className="canvas-template-footer">
        <Icons.HelpCircle size={13} />
        <span>用户自定义模板将在后续版本支持</span>
      </div>
    </div>
  )
}
