import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../../Icons'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { buildRenderHtmlSrcDoc, type HtmlOpenMode } from '../../services/render-html'
import type { UIBlock } from '../../services/event-mapper'
import './RenderHtmlBlock.less'

type HtmlBlock = Extract<UIBlock, { kind: 'html_block' }>

export type HtmlRemoteOpenMode = Exclude<HtmlOpenMode, 'inline' | 'side-panel'>

export type HtmlActiveRemotePresentation = {
  blockId: string
  mode: HtmlRemoteOpenMode
}

export type HtmlRenderContextValue = {
  activeSidePanelBlockId: string | null
  activeRemotePresentation: HtmlActiveRemotePresentation | null
  onOpenMode: (block: HtmlBlock, mode: HtmlOpenMode) => void
}

const DEFAULT_HTML_RENDER_CONTEXT: HtmlRenderContextValue = {
  activeSidePanelBlockId: null,
  activeRemotePresentation: null,
  onOpenMode: () => undefined,
}

const HtmlRenderContext = createContext<HtmlRenderContextValue>(DEFAULT_HTML_RENDER_CONTEXT)

export function HtmlRenderProvider({
  value,
  children,
}: {
  value: HtmlRenderContextValue
  children: ReactNode
}) {
  return <HtmlRenderContext.Provider value={value}>{children}</HtmlRenderContext.Provider>
}

export function RenderHtmlBlock({
  block,
  variant = 'inline',
}: {
  block: HtmlBlock
  variant?: 'inline' | 'side-panel'
}) {
  const resolvedTheme = useResolvedTheme()
  const { activeSidePanelBlockId, activeRemotePresentation, onOpenMode } =
    useContext(HtmlRenderContext)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [loadedSrcDoc, setLoadedSrcDoc] = useState<string | null>(null)
  const [frameErrorState, setFrameErrorState] = useState<{
    srcDoc: string
    message: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const isSidePanel = variant === 'side-panel'
  const isOpenInSidePanel = !isSidePanel && activeSidePanelBlockId === block.toolCallId
  const remoteOpenMode =
    activeRemotePresentation?.blockId === block.toolCallId ? activeRemotePresentation.mode : null
  const isOpenElsewhere = isOpenInSidePanel || remoteOpenMode != null
  const srcDoc = useMemo(() => buildRenderHtmlSrcDoc(block, resolvedTheme), [block, resolvedTheme])

  const frameLoaded = loadedSrcDoc === srcDoc
  const frameError = frameErrorState?.srcDoc === srcDoc ? frameErrorState.message : null

  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [fullscreen])

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(block.html)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setActionError('复制源码失败，请检查剪贴板权限')
    }
  }

  const openMode = async (mode: HtmlOpenMode) => {
    setActionError(null)
    if (mode === 'inline' || mode === 'side-panel') {
      onOpenMode(block, mode)
      return
    }
    const channel = mode === 'window' ? 'html:open-window' : 'html:open-external'
    try {
      const response = await window.spark.invoke(channel, {
        html: block.html,
        title: block.title,
        theme: resolvedTheme,
      })
      if (!response.success) setActionError('HTML 打开失败')
      else onOpenMode(block, mode)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'HTML 打开失败')
    }
  }

  const selectValue = isSidePanel
    ? 'side-panel'
    : (remoteOpenMode ?? (isOpenInSidePanel ? 'side-panel' : 'inline'))
  const content = (
    <>
      <div className="render-html-toolbar">
        <div className="render-html-heading">
          <span className="render-html-mark" aria-hidden="true">
            &lt;/&gt;
          </span>
          <span className="render-html-title" title={block.title}>
            {block.title}
          </span>
          {block.status === 'pending' && <span className="render-html-status">准备渲染</span>}
        </div>
        <div className="render-html-actions">
          <label className="render-html-mode-label">
            <span>打开方式</span>
            <select
              aria-label="HTML 打开方式"
              value={selectValue}
              onChange={(event) => void openMode(event.target.value as HtmlOpenMode)}
            >
              <option value="inline">内容区</option>
              <option value="side-panel">侧面板</option>
              <option value="window">独立窗口</option>
              <option value="external">外部浏览器</option>
            </select>
          </label>
          <button
            type="button"
            className="render-html-action"
            onClick={() => setSourceOpen((v) => !v)}
          >
            <Icons.Code size={13} />
            {sourceOpen ? '预览' : '源码'}
          </button>
          {!isSidePanel && !isOpenElsewhere && block.status === 'rendered' && (
            <button
              type="button"
              className="render-html-action"
              aria-label="全屏查看 HTML"
              onClick={() => setFullscreen(true)}
            >
              <Icons.Maximize size={13} />
              全屏
            </button>
          )}
        </div>
      </div>

      {isOpenElsewhere ? (
        <div className="render-html-muted-state" role="status">
          <span>
            {isOpenInSidePanel
              ? 'HTML 已在侧面板打开'
              : remoteOpenMode === 'window'
                ? 'HTML 已在独立窗口打开'
                : 'HTML 已在外部浏览器打开'}
          </span>
          <button type="button" onClick={() => void openMode('inline')}>
            返回内容区
          </button>
        </div>
      ) : sourceOpen ? (
        <div className="render-html-source-wrap">
          <div className="render-html-source-actions">
            <span>原始 HTML</span>
            <button type="button" className="render-html-action" onClick={() => void copySource()}>
              <Icons.Copy size={13} />
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="render-html-source">{block.html}</pre>
        </div>
      ) : block.status === 'pending' ? (
        <div className="render-html-muted-state" role="status">
          <span>等待 HTML 安全校验…</span>
        </div>
      ) : block.status === 'error' || frameError != null ? (
        <div className="render-html-error" role="alert">
          <div className="render-html-error-title">
            <Icons.AlertTriangle size={15} /> HTML 渲染失败
          </div>
          <div>{block.error ?? frameError ?? '无法渲染该 HTML 内容'}</div>
          <details>
            <summary>查看原始 HTML</summary>
            <pre className="render-html-source">{block.html}</pre>
          </details>
        </div>
      ) : (
        <div className="render-html-frame-wrap" style={{ height: `${block.height}px` }}>
          {!frameLoaded && <div className="render-html-loading">正在渲染 HTML…</div>}
          <iframe
            title={block.title}
            className="render-html-frame"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            onLoad={() => {
              setLoadedSrcDoc(srcDoc)
              setFrameErrorState(null)
            }}
            onError={() => setFrameErrorState({ srcDoc, message: '隔离文档加载失败' })}
          />
        </div>
      )}

      {block.warnings.length > 0 && (
        <div className="render-html-warning" role="note">
          {block.warnings.join('；')}
        </div>
      )}
      {actionError != null && <div className="render-html-action-error">{actionError}</div>}
    </>
  )

  return (
    <section className={`render-html-block ${isSidePanel ? 'render-html-block-side-panel' : ''}`}>
      {content}
      {fullscreen && (
        <div
          className="render-html-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label={block.title}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFullscreen(false)
          }}
        >
          <div className="render-html-fullscreen-panel">
            <div className="render-html-fullscreen-head">
              <span>{block.title}</span>
              <button
                type="button"
                className="render-html-icon-button"
                aria-label="关闭全屏 HTML"
                onClick={() => setFullscreen(false)}
              >
                <Icons.X size={15} />
              </button>
            </div>
            <div className="render-html-fullscreen-body">
              {sourceOpen ? (
                <pre className="render-html-source">{block.html}</pre>
              ) : block.status !== 'rendered' ? (
                <div className="render-html-muted-state" role="status">
                  等待 HTML 安全校验…
                </div>
              ) : (
                <iframe
                  title={`${block.title}（全屏）`}
                  className="render-html-frame"
                  sandbox="allow-scripts"
                  srcDoc={srcDoc}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
