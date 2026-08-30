import React, { Suspense, useEffect, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { MarkdownCodeBlock } from '../../components/MarkdownCodeBlock'
import { BlockTrafficHeader } from '../../components/BlockTrafficHeader'
import type { UIBlock } from '../../services/event-mapper'
import { DiagramViewport } from './DiagramViewport'
import './RenderDiagramBlock.less'

// 两个渲染器各自懒加载：mermaid (~1.5MB) 与 markmap+d3 只在实际出图时才拉取，首屏不背体积
const MermaidDiagram = React.lazy(() => import('./RenderMermaidDiagram'))
const MarkmapDiagram = React.lazy(() => import('./RenderMarkmapDiagram'))

type DiagramBlock = Extract<UIBlock, { kind: 'diagram_block' }>

export function RenderDiagramBlock({ block }: { block: DiagramBlock }) {
  const resolvedTheme = useResolvedTheme()
  const [sourceOpen, setSourceOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const isMarkmap = block.diagramType === 'markmap'
  const codeLang = isMarkmap ? 'markdown' : 'mermaid'
  const typeLabel = isMarkmap ? '思维导图' : 'Mermaid 图表'

  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [fullscreen])

  const renderPreview = () => (
    <Suspense fallback={<div className="render-diagram-loading">正在加载渲染器…</div>}>
      {isMarkmap ? (
        <MarkmapDiagram source={block.source} theme={resolvedTheme} />
      ) : (
        <MermaidDiagram source={block.source} theme={resolvedTheme} />
      )}
    </Suspense>
  )

  const body = sourceOpen ? (
    <div className="render-diagram-source-wrap">
      <MarkdownCodeBlock code={block.source} lang={codeLang} syntaxHighlight />
    </div>
  ) : block.status === 'pending' ? (
    <div className="render-diagram-muted" role="status">
      等待图表校验…
    </div>
  ) : block.status === 'error' ? (
    <div className="render-diagram-error" role="alert">
      <div className="render-diagram-error-title">
        <Icons.AlertTriangle size={15} /> 图表渲染失败
      </div>
      <div>{block.error ?? '无法渲染该图表'}</div>
      <details>
        <summary>查看源码</summary>
        <MarkdownCodeBlock code={block.source} lang={codeLang} syntaxHighlight />
      </details>
    </div>
  ) : (
    <div className="render-diagram-frame-wrap">
      <DiagramViewport ariaLabel={`${block.title}图表视口`}>{renderPreview()}</DiagramViewport>
    </div>
  )

  return (
    <section className="render-diagram-block">
      <BlockTrafficHeader
        title={block.title}
        badge={typeLabel}
        actions={
          <>
            <Button
              type="text"
              size="small"
              className="render-diagram-action"
              icon={<Icons.Code size={13} />}
              onClick={() => setSourceOpen((v) => !v)}
            >
              {sourceOpen ? '预览' : '源码'}
            </Button>
            {!sourceOpen && block.status === 'rendered' && (
              <Button
                type="text"
                size="small"
                className="render-diagram-action"
                aria-label="全屏查看图表"
                icon={<Icons.Maximize size={13} />}
                onClick={() => setFullscreen(true)}
              >
                全屏
              </Button>
            )}
          </>
        }
      />

      {body}

      {block.warnings.length > 0 && (
        <div className="render-diagram-warning" role="note">
          {block.warnings.join('；')}
        </div>
      )}

      {fullscreen && (
        <div
          className="render-diagram-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label={block.title}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFullscreen(false)
          }}
        >
          <div className="render-diagram-fullscreen-panel">
            <div className="render-diagram-fullscreen-head">
              <span>{block.title}</span>
              <button
                type="button"
                className="render-diagram-icon-button"
                aria-label="关闭全屏"
                onClick={() => setFullscreen(false)}
              >
                <Icons.X size={15} />
              </button>
            </div>
            <div className="render-diagram-fullscreen-body">
              <DiagramViewport fullscreen ariaLabel={`${block.title}全屏图表视口`}>
                {renderPreview()}
              </DiagramViewport>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
