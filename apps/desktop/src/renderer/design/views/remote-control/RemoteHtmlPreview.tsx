/**
 * 远程 HTML 内容预览。
 *
 * 目标电脑上的 HTML 产物本机打不开：经 attachment:fetch 取回原文后，
 * 原文登记为独立 capability-asset 文档后就地渲染，避免 srcDoc 继承 renderer
 * CSP / origin；内容按浏览器能力运行，但无法访问主窗口 DOM 或 SparkWork IPC。
 */
import { createLogger } from '@spark/shared'
import { useEffect, useId, useRef, useState } from 'react'
import { Icons } from '../../Icons'
import {
  buildHtmlRenderToken,
  htmlRenderDocUrl,
  putHtmlRuntimeDoc,
  releaseHtmlRuntimeDoc,
} from '../../services/render-html'

const logger = createLogger('remote-html-preview')

type RemoteHtmlFrameState = {
  html: string
  url?: string
  error?: boolean
}

export function RemoteHtmlPreview({
  html,
  title = 'HTML 预览',
  height = 300,
}: {
  html: string
  title?: string
  height?: number
}) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [frameState, setFrameState] = useState<RemoteHtmlFrameState | null>(null)
  const frameVersionRef = useRef(0)
  const previewId = useId()
  const token = buildHtmlRenderToken(`remote-preview:${previewId}`)

  useEffect(() => {
    let cancelled = false
    const version = ++frameVersionRef.current
    putHtmlRuntimeDoc(token, html)
      .then(() => {
        if (!cancelled) setFrameState({ html, url: htmlRenderDocUrl(token, version) })
      })
      .catch((error: unknown) => {
        logger.warn('Failed to register remote HTML preview document', error)
        if (!cancelled) setFrameState({ html, error: true })
      })

    return () => {
      cancelled = true
      releaseHtmlRuntimeDoc(token)
    }
  }, [html, token])

  const activeFrame = frameState?.html === html ? frameState : null

  return (
    <div className="rc-html">
      <div className="rc-html-head">
        <Icons.Globe size={12} />
        <span className="rc-html-title">{title}</span>
        <div className="rc-html-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            className={`rc-html-tab${mode === 'preview' ? ' active' : ''}`}
            onClick={() => setMode('preview')}
          >
            预览
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'source'}
            className={`rc-html-tab${mode === 'source' ? ' active' : ''}`}
            onClick={() => setMode('source')}
          >
            源码
          </button>
        </div>
      </div>
      {mode === 'preview' ? (
        activeFrame?.error ? (
          <div className="rc-html-source" role="alert">
            HTML 预览加载失败，请查看源码或稍后重试。
          </div>
        ) : activeFrame?.url == null ? (
          <div className="rc-html-source" role="status">
            正在加载 HTML 预览…
          </div>
        ) : (
          <iframe
            className="rc-html-frame"
            title={title}
            src={activeFrame.url}
            style={{ height }}
            onError={() => {
              logger.warn('Remote HTML preview frame failed to load')
              setFrameState({ html, error: true })
            }}
          />
        )
      ) : (
        <pre className="rc-html-source">{html}</pre>
      )}
    </div>
  )
}
