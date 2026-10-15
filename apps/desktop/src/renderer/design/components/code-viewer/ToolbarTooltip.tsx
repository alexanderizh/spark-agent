/**
 * 统一的工具按钮悬浮提示。
 *
 * 对齐会话头部按钮组规范（ChatToolbar 的 TabbarTooltipButton）：
 * @lobehub/ui Tooltip + arrow + spark-icon-tooltip 深色实心气泡，
 * mouseEnterDelay={0} 即时触发（原生 title 在 Electron 里几乎不可感）。
 *
 * 中间垫一层 inline-flex span（cv-tip-host）：disabled 按钮不派发鼠标事件，
 * 把 Tooltip 挂在宿主 span 上才能在禁用态正常显示——
 * 如 Git 推/拉不可用原因、提交按钮「没有已暂存的文件」提示。
 */

import type { ReactElement, ReactNode } from 'react'
import { Tooltip } from '@lobehub/ui'

export interface ToolbarTooltipProps {
  label: ReactNode
  /** 气泡方向；默认底部（顶部工具栏习惯） */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactElement
}

export function ToolbarTooltip({
  label,
  placement = 'bottom',
  children,
}: ToolbarTooltipProps): ReactElement {
  return (
    <Tooltip
      title={label}
      placement={placement}
      mouseEnterDelay={0}
      arrow
      className="spark-icon-tooltip"
    >
      <span className="cv-tip-host" style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </Tooltip>
  )
}
