import type { ReactNode } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import './CanvasComposerToolbar.less'

export type CanvasComposerSummaryAction = {
  key: string
  label: string
  value: string
  icon: ReactNode
  onClick: () => void
}

export type CanvasComposerToolbarProps = {
  summaries: CanvasComposerSummaryAction[]
  advancedAvailable: boolean
  advancedOpen: boolean
  canSubmit: boolean
  submitting: boolean
  onToggleAdvanced: () => void
  onCancel: () => void
  onSubmit: () => void
}

export function CanvasComposerToolbar({
  summaries,
  advancedAvailable,
  advancedOpen,
  canSubmit,
  submitting,
  onToggleAdvanced,
  onCancel,
  onSubmit,
}: CanvasComposerToolbarProps) {
  const advancedLabel = advancedOpen ? '收起高级设置' : '展开高级设置'
  return (
    <div className="canvas-composer-toolbar">
      <div className="canvas-composer-toolbar-summaries" aria-label="当前生成参数">
        {summaries.map((summary) => (
          <Tooltip key={summary.key} title={`${summary.label}：${summary.value}`}>
            <Button
              size="middle"
              type="text"
              className="canvas-composer-summary-button"
              data-summary-key={summary.key}
              aria-label={`设置${summary.label}`}
              icon={summary.icon}
              onClick={summary.onClick}
            >
              <span>{summary.value}</span>
              <Icons.ChevronDown size={11} />
            </Button>
          </Tooltip>
        ))}
      </div>
      <div className="canvas-composer-toolbar-actions">
        {advancedAvailable && (
          <Tooltip title={advancedLabel}>
            <Button
              size="middle"
              type={advancedOpen ? 'primary' : 'text'}
              className="canvas-composer-icon-button"
              aria-label={advancedLabel}
              aria-expanded={advancedOpen}
              icon={<Icons.Sliders size={15} />}
              onClick={onToggleAdvanced}
            />
          </Tooltip>
        )}
        <Tooltip title="取消并关闭">
          <Button
            size="middle"
            type="text"
            className="canvas-composer-icon-button"
            aria-label="取消"
            icon={<Icons.X size={15} />}
            onClick={onCancel}
          />
        </Tooltip>
        <Tooltip title={canSubmit ? '创建任务' : '请先补充必要输入'}>
          <Button
            size="middle"
            type="primary"
            className="canvas-composer-icon-button is-submit"
            aria-label="创建任务"
            disabled={!canSubmit || submitting}
            loading={submitting}
            icon={<Icons.Send size={15} />}
            onClick={onSubmit}
          />
        </Tooltip>
      </div>
    </div>
  )
}
