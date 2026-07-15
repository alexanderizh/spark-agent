import type { ReactNode } from 'react'
import { Popover } from 'antd'

export const CANVAS_PROMPT_HOVER_MAX_HEIGHT = 280

export function CanvasPromptHoverCard({
  children,
  media,
  content,
}: {
  children: ReactNode
  media?: ReactNode
  content?: string
}) {
  return (
    <Popover
      trigger={['hover', 'focus']}
      placement="topLeft"
      overlayClassName="canvas-prompt-hover-popover"
      content={
        <div className="canvas-prompt-hover-card">
          {media ? <div className="canvas-prompt-hover-media">{media}</div> : null}
          {content ? <div className="canvas-prompt-hover-scroll">{content}</div> : null}
        </div>
      }
    >
      {children}
    </Popover>
  )
}
