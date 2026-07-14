import type { ReactNode } from 'react'
import { Popover } from 'antd'

export const CANVAS_PROMPT_HOVER_MAX_HEIGHT = 280

export function CanvasPromptHoverCard({
  children,
  title,
  preview,
  metadata,
  content,
}: {
  children: ReactNode
  title: string
  preview?: ReactNode
  metadata?: Array<{ label: string; value: string }>
  content?: string
}) {
  return (
    <Popover
      trigger={['hover', 'focus']}
      placement="topLeft"
      overlayClassName="canvas-prompt-hover-popover"
      content={
        <div className="canvas-prompt-hover-card">
          <div className="canvas-prompt-hover-head">
            {preview ? <div className="canvas-prompt-hover-preview">{preview}</div> : null}
            <strong>{title}</strong>
          </div>
          {metadata && metadata.length > 0 ? (
            <div className="canvas-prompt-hover-meta">
              {metadata.map((item) => (
                <span key={`${item.label}-${item.value}`}>
                  {item.label}：{item.value}
                </span>
              ))}
            </div>
          ) : null}
          {content ? <div className="canvas-prompt-hover-scroll">{content}</div> : null}
        </div>
      }
    >
      {children}
    </Popover>
  )
}
