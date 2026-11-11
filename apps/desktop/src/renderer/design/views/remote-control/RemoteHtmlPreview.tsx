/**
 * 远程 HTML 内容预览。
 *
 * 目标电脑上的 HTML 产物本机打不开：经 attachment:fetch 取回原文后，
 * 用 srcDoc 塞进沙箱 iframe 就地渲染。沙箱刻意**不给 allow-same-origin**：
 * srcDoc 会继承宿主文档的源，一旦放行 same-origin + scripts，远端 HTML 就能
 * 直接摸到渲染进程的 window.spark IPC。opaque origin 下脚本仍能跑，只是拿不到
 * 宿主（代价是 localStorage 之类不可用，对静态预览足够）。
 */
import { useState } from 'react'
import { Icons } from '../../Icons'

const REMOTE_HTML_SANDBOX = 'allow-scripts allow-forms allow-modals'

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
        <iframe
          className="rc-html-frame"
          title={title}
          sandbox={REMOTE_HTML_SANDBOX}
          srcDoc={html}
          style={{ height }}
        />
      ) : (
        <pre className="rc-html-source">{html}</pre>
      )}
    </div>
  )
}
