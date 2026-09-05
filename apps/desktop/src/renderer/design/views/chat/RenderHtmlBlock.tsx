import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@lobehub/ui'
import { findHtmlExternalResourceWarning } from '@spark/shared'
import { Icons } from '../../Icons'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { MarkdownCodeBlock } from '../../components/MarkdownCodeBlock'
import { BlockTrafficHeader } from '../../components/BlockTrafficHeader'
import {
  buildHtmlRenderToken,
  buildRenderHtmlSrcDoc,
  htmlRenderDocUrl,
  putHtmlRuntimeDoc,
  releaseHtmlRuntimeDoc,
  type HtmlOpenMode,
} from '../../services/render-html'
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

// 外部资源确认态：app 会话内按块记忆。点击「允许渲染」后，该块在滚动
// 重建、主题切换、侧面板来回切换等重挂载场景下都不再被阻拦。
const externalAllowedHtmlToolCallIds = new Set<string>()

export function HtmlCodePreview({ code }: { code: string }) {
  return (
    <div className="render-html-code-preview">
      <MarkdownCodeBlock code={code} lang="html" syntaxHighlight />
    </div>
  )
}

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
  const [frame, setFrame] = useState<{ src: string; version: number } | null>(null)
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const isSidePanel = variant === 'side-panel'
  const isOpenInSidePanel = !isSidePanel && activeSidePanelBlockId === block.toolCallId
  const remoteOpenMode =
    activeRemotePresentation?.blockId === block.toolCallId ? activeRemotePresentation.mode : null
  const isOpenElsewhere = isOpenInSidePanel || remoteOpenMode != null
  const srcDoc = useMemo(() => buildRenderHtmlSrcDoc(block, resolvedTheme), [block, resolvedTheme])
  const docToken = useMemo(() => buildHtmlRenderToken(block.toolCallId), [block.toolCallId])

  // 外部资源门控：内容含外链时先展示警告 + 「允许渲染」按钮，用户确认后才
  // 挂载 iframe；判定直接来自 HTML 内容（与工具侧警告同源），不依赖工具
  // 结果是否回传 warnings。
  const externalWarning = useMemo(() => findHtmlExternalResourceWarning(block.html), [block.html])
  const [externalAllowed, setExternalAllowed] = useState(() =>
    externalAllowedHtmlToolCallIds.has(block.toolCallId),
  )
  const gateExternal = externalWarning != null && !externalAllowed
  const allowExternalRender = () => {
    externalAllowedHtmlToolCallIds.add(block.toolCallId)
    setExternalAllowed(true)
  }
  // 底部提示条只承载非外部资源类警告；外部资源警告由门控 UI 呈现，
  // 允许渲染后不再重复常驻。
  const informationalWarnings = useMemo(() => {
    if (externalWarning == null) return block.warnings
    return block.warnings.filter((item) => item !== externalWarning)
  }, [block.warnings, externalWarning])

  // 合成文档 → 主进程登记 → capability-asset 导航地址（机制同子应用，见
  // main/services/RuntimeDocRegistry.ts）。srcDoc 变化时复用 token 覆盖登记，
  // 递增 version 强制 iframe 重新加载。卸载时 release：同 token 的其他展示
  // 入口（侧面板/全屏）若仍挂载，已加载内容不受影响，其下次重建会重新 put。
  const docVersionRef = useRef(0)
  useEffect(() => {
    let cancelled = false
    docVersionRef.current += 1
    const version = docVersionRef.current
    putHtmlRuntimeDoc(docToken, srcDoc)
      .then(() => {
        if (cancelled) return
        setFrameError(null)
        setFrame({ src: htmlRenderDocUrl(docToken, version), version })
      })
      .catch(() => {
        if (!cancelled) setFrameError('HTML 沙箱文档登记失败')
      })
    return () => {
      cancelled = true
      releaseHtmlRuntimeDoc(docToken)
    }
  }, [docToken, srcDoc])

  const frameLoaded = frame != null && loadedVersion === frame.version

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
      <BlockTrafficHeader
        title={block.title}
        status={block.status === 'pending' ? '准备渲染' : undefined}
        actions={
          <>
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
            <Button
              type="text"
              size="small"
              className="render-html-action"
              icon={<Icons.Code size={13} />}
              onClick={() => setSourceOpen((v) => !v)}
            >
              {sourceOpen ? '预览' : '源码'}
            </Button>
            {!isSidePanel && !isOpenElsewhere && block.status === 'rendered' && !gateExternal && (
              <Button
                type="text"
                size="small"
                className="render-html-action"
                aria-label="全屏查看 HTML"
                icon={<Icons.Maximize size={13} />}
                onClick={() => setFullscreen(true)}
              >
                全屏
              </Button>
            )}
          </>
        }
      />

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
            <Button
              type="text"
              size="small"
              className="render-html-action"
              icon={<Icons.Copy size={13} />}
              onClick={() => void copySource()}
            >
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          <HtmlCodePreview code={block.html} />
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
            <HtmlCodePreview code={block.html} />
          </details>
        </div>
      ) : gateExternal ? (
        <div className="render-html-gate" role="note">
          <div className="render-html-gate-message">
            <Icons.AlertTriangle size={15} />
            <span>{externalWarning}</span>
          </div>
          <div className="render-html-gate-actions">
            <button type="button" onClick={() => setSourceOpen(true)}>
              查看源码
            </button>
            <button type="button" className="render-html-gate-allow" onClick={allowExternalRender}>
              允许渲染
            </button>
          </div>
        </div>
      ) : (
        <div className="render-html-frame-wrap" style={{ height: `${block.height}px` }}>
          {!frameLoaded && <div className="render-html-loading">正在渲染 HTML…</div>}
          {frame != null && (
            <iframe
              title={block.title}
              className="render-html-frame"
              sandbox="allow-scripts"
              src={frame.src}
              onLoad={() => {
                setLoadedVersion(frame.version)
                setFrameError(null)
              }}
              onError={() => setFrameError('隔离文档加载失败')}
            />
          )}
        </div>
      )}

      {informationalWarnings.length > 0 && (
        <div className="render-html-warning" role="note">
          {informationalWarnings.join('；')}
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
                <HtmlCodePreview code={block.html} />
              ) : block.status !== 'rendered' ? (
                <div className="render-html-muted-state" role="status">
                  等待 HTML 安全校验…
                </div>
              ) : gateExternal ? (
                <div className="render-html-muted-state" role="status">
                  请先在卡片中允许渲染外部资源
                </div>
              ) : frame != null ? (
                <iframe
                  title={`${block.title}（全屏）`}
                  className="render-html-frame"
                  sandbox="allow-scripts"
                  src={frame.src}
                />
              ) : (
                <div className="render-html-muted-state" role="status">
                  正在渲染 HTML…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
