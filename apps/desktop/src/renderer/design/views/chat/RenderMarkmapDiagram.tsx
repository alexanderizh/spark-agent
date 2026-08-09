import { useEffect, useRef, useState } from 'react'
import type { HtmlRenderTheme } from '@spark/shared'

type MarkmapDiagramProps = {
  source: string
  theme: HtmlRenderTheme
}

/**
 * 对齐 app 主题的思维导图分支配色（柔和、不刺眼）。
 * markmap 按「节点深度」从 palette 取色，light/dark 各一套，避免默认配色在
 * 深色背景下偏暗、或过于鲜艳。色相与 mermaid 主色蓝紫系呼应。
 */
const MARKMAP_LIGHT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
const MARKMAP_DARK_COLORS = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa']

/** Markmap 实例句柄（用到 destroy / fit / state.rect） */
type MarkmapRect = { x1: number; y1: number; x2: number; y2: number }
type MarkmapHandle = {
  destroy?: () => void
  fit?: (maxScale?: number) => Promise<void> | void
  state?: { rect?: MarkmapRect }
} | null

/**
 * 懒加载 markmap-lib + markmap-view，把 Markdown 大纲编译为思维导图 SVG。
 * 仅在实际渲染时才 dynamic import，d3/markmap 体积不进首屏 bundle。
 *
 * 宿主节点隔离：svg 由 effect 里手动 createElementNS 创建并 append 到宿主 div，
 * React 完全不认识这个 svg、不参与其 reconciliation。cleanup 时手动 removeChild。
 * 这样 markmap 直接改写 svg 子树不会撞上 React 的协调，杜绝
 * "removeChild: node not a child" 崩溃（该崩溃源于第三方库改写了 React 通过
 * JSX 管理的 DOM 节点的子节点）。
 */
export default function RenderMarkmapDiagram({ source, theme }: MarkmapDiagramProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'rendered' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let markmap: MarkmapHandle = null
    let svgEl: SVGSVGElement | null = null
    setStatus('loading')
    setErrorMessage(null)

    async function run() {
      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import('markmap-lib'),
          import('markmap-view'),
        ])
        if (cancelled || !hostRef.current) return
        const transformer = new Transformer()
        const { root } = transformer.transform(source)
        // 手动创建独立 svg 并挂到宿主 div 下；React 不管理它的生命周期
        svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svgEl.setAttribute('class', 'render-diagram-markmap-svg')
        hostRef.current.appendChild(svgEl)
        const palette = theme === 'dark' ? MARKMAP_DARK_COLORS : MARKMAP_LIGHT_COLORS
        // markmap 的 color 回调只拿到 INode（类型上无 depth），自己按树深算一层映射：
        // 用 WeakMap 以节点引用为 key 记录深度，color 回调里查表取色。
        const depthMap = new WeakMap<object, number>()
        const markDepth = (node: object, depth: number): void => {
          depthMap.set(node, depth)
          const children = (node as { children?: unknown[] }).children
          children?.forEach((child) => markDepth(child as object, depth + 1))
        }
        markDepth(root, 0)
        markmap = Markmap.create(
          svgEl,
          {
            // autoFit:false —— 避免在 svg 高度尚未确定时过早 fit（会用到错误的视口高度）。
            // 改为先算出内容自然高度、写入 svg.style.height，再显式 fit() 让内容适配。
            autoFit: false,
            color: (node) => palette[depthMap.get(node) ?? 0] ?? '#6366f1',
          },
          root,
        )
        // 自适应内容高度：读 markmap.state.rect 内容包围盒算自然高度，
        // 钳制到 [200, 600] 写入 svg.style.height，再 fit() 让内容适配该高度。
        //   内容少 → 贴合高度，不留大块空白；
        //   内容多 → 上限 600，fit 缩小后看全貌。
        // 用 double rAF：state.rect 在 renderData（async）内部 await rAF 后的
        // _relayout() 才赋值，create 同步返回时尚未填；多等一帧确保它就绪。
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (cancelled || !svgEl || !markmap) return
            const rect = markmap.state?.rect
            const natural = rect ? Math.ceil((rect.y2 ?? 0) - (rect.y1 ?? 0)) + 48 : 0
            const height = natural > 0 ? Math.max(200, Math.min(600, natural)) : 200
            svgEl.style.height = `${height}px`
            void markmap.fit?.()
          })
        })
        setStatus('rendered')
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : '思维导图渲染失败')
        setStatus('error')
      }
    }

    void run()
    return () => {
      cancelled = true
      markmap?.destroy?.()
      markmap = null
      // 手动移除我们创建的 svg，React 永远不碰它
      if (svgEl?.parentNode) svgEl.parentNode.removeChild(svgEl)
      svgEl = null
    }
  }, [source, theme])

  if (status === 'error') {
    return <div className="render-diagram-error-inline">{errorMessage ?? '思维导图渲染失败'}</div>
  }
  return (
    <div
      className="render-diagram-canvas render-diagram-canvas-markmap"
      data-diagram-theme={theme}
    >
      {status === 'loading' && <div className="render-diagram-loading">正在生成思维导图…</div>}
      <div ref={hostRef} className="render-diagram-markmap-host" />
    </div>
  )
}
