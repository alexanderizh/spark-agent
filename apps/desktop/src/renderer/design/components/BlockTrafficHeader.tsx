import type { ReactNode } from 'react'

type BlockTrafficHeaderProps = {
  title: string
  /** 标题右侧的类型标识，例如「Mermaid 图表」「HTML 片段」 */
  badge?: ReactNode
  /** 状态提示文本，例如「准备渲染」 */
  status?: ReactNode
  /** 右侧操作区（按钮、下拉等） */
  actions?: ReactNode
  /** 透传到根节点的额外 className */
  className?: string
}

/**
 * 内容区富内容板块（HTML 板块 / 图表板块）的统一标题栏。
 *
 * 复用代码块的 macOS 红绿灯视觉（`.md-code-traffic` / `.md-code-dot`，定义在
 * `styles/views.css`，按 `.app.theme-light` / `.app.theme-dark` 自适应颜色），
 * 让富内容板块与代码块视觉一致。红绿灯为纯装饰（`aria-hidden`），不承担
 * 窗口控制语义——真正的窗口控制在 WindowControls 组件里。
 *
 * 样式类 `.block-traffic-*` 同样定义在 `styles/views.css`，紧跟在 `md-code-*`
 * 之后，便于和代码块 header 一起维护。
 */
export function BlockTrafficHeader({
  title,
  badge,
  status,
  actions,
  className,
}: BlockTrafficHeaderProps) {
  return (
    <div className={`block-traffic-header${className ? ` ${className}` : ''}`}>
      <div className="block-traffic-left">
        <span className="md-code-traffic" aria-hidden="true">
          <i className="md-code-dot md-code-dot-red" />
          <i className="md-code-dot md-code-dot-yellow" />
          <i className="md-code-dot md-code-dot-green" />
        </span>
        <span className="block-traffic-title" title={title}>
          {title}
        </span>
        {badge != null && <span className="block-traffic-badge">{badge}</span>}
        {status != null && <span className="block-traffic-status">{status}</span>}
      </div>
      {actions != null && <div className="block-traffic-actions">{actions}</div>}
    </div>
  )
}
