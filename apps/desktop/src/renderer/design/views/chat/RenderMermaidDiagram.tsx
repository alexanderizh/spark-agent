import { useEffect, useRef, useState } from 'react'
import type { HtmlRenderTheme } from '@spark/shared'
import { parseDiagramViewBox } from './diagramViewportMath'

type MermaidDiagramProps = {
  source: string
  theme: HtmlRenderTheme
}

/**
 * 对齐 app design token 的 mermaid 配色（跟随主题·蓝紫主色）。
 * theme: 'base' 下用 themeVariables 精确控制 flowchart / sequence / 状态机等
 * 图型的节点底色、边框、连线与文字色，替代默认 'default' 主题的浅紫观感。
 * 配色取自项目 design token：主色 #6366f1（dark 亮化为 #818cf8）、中性灰连线、
 * 节点白底+主色描边（dark 为深底+亮色描边）。
 */
const MERMAID_LIGHT_VARS = {
  fontSize: '14px',
  fontFamily: 'inherit',
  background: 'transparent',
  // flowchart 主节点：白底 + 蓝紫边框
  primaryColor: '#ffffff',
  primaryTextColor: '#312e2a',
  primaryBorderColor: '#6366f1',
  lineColor: '#a8a29e',
  secondaryColor: '#eef2ff',
  tertiaryColor: '#faf9f5',
  textColor: '#312e2a',
  edgeLabelBackground: '#ffffff',
  // sequence 时序图
  actorBkg: '#eef2ff',
  actorBorder: '#6366f1',
  actorTextColor: '#3730a3',
  actorLineColor: '#a8a29e',
  signalColor: '#312e2a',
  signalTextColor: '#312e2a',
  labelBoxBkgColor: '#eef2ff',
  labelBorderColor: '#6366f1',
  labelTextColor: '#3730a3',
  loopTextColor: '#312e2a',
  noteBkgColor: '#fef9c3',
  noteTextColor: '#713f12',
  noteBorderColor: '#facc15',
} as const

const MERMAID_DARK_VARS = {
  fontSize: '14px',
  fontFamily: 'inherit',
  background: 'transparent',
  primaryColor: '#1e1d1a',
  primaryTextColor: '#e4e4e7',
  primaryBorderColor: '#818cf8',
  lineColor: '#52525b',
  secondaryColor: '#312e81',
  tertiaryColor: '#27272a',
  textColor: '#e4e4e7',
  edgeLabelBackground: '#1e1d1a',
  actorBkg: '#312e81',
  actorBorder: '#818cf8',
  actorTextColor: '#c7d2fe',
  actorLineColor: '#52525b',
  signalColor: '#e4e4e7',
  signalTextColor: '#e4e4e7',
  labelBoxBkgColor: '#312e81',
  labelBorderColor: '#818cf8',
  labelTextColor: '#c7d2fe',
  loopTextColor: '#e4e4e7',
  noteBkgColor: '#422006',
  noteTextColor: '#fef08a',
  noteBorderColor: '#a16207',
} as const

// mermaid.render 需要全局唯一的 dom node id；模块级自增保证多实例不冲突
let mermaidRenderSeq = 0

/**
 * 懒加载 mermaid 并把 DSL 编译为 SVG。
 * securityLevel: 'strict' —— 转义 diagram 文本中的 HTML，杜绝 XSS。
 * 仅在实际渲染时才 dynamic import（vite 会拆出独立 chunk，不影响首屏）。
 *
 * 宿主节点隔离：宿主 div 在 JSX 里永远没有 children 表达式，React 把它当
 * 永远空节点、从不 reconcile 它的 DOM children。mermaid 通过 innerHTML 接管
 * 它的内容，React 不参与，杜绝 "removeChild: node not a child" 崩溃
 * （该崩溃源于第三方库改写了 React 通过 JSX 管理的 DOM 子节点）。
 */
export default function RenderMermaidDiagram({ source, theme }: MermaidDiagramProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'rendered' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    const hostElement: HTMLDivElement = host

    async function run() {
      setStatus('loading')
      setErrorMessage(null)
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          fontFamily: 'inherit',
          themeVariables: theme === 'dark' ? MERMAID_DARK_VARS : MERMAID_LIGHT_VARS,
        })
        const id = `spark-mmd-${(mermaidRenderSeq += 1)}`
        const { svg } = await mermaid.render(id, source.trim())
        if (cancelled) return
        hostElement.innerHTML = svg
        const svgElement = hostElement.querySelector<SVGSVGElement>('svg')
        const naturalSize = parseDiagramViewBox(svgElement?.getAttribute('viewBox') ?? null)
        if (svgElement && naturalSize) {
          const width = Math.ceil(naturalSize.width)
          const height = Math.ceil(naturalSize.height)
          svgElement.setAttribute('width', String(width))
          svgElement.setAttribute('height', String(height))
          svgElement.style.removeProperty('max-width')
          svgElement.style.width = `${width}px`
          svgElement.style.height = `${height}px`
        }
        setStatus('rendered')
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : 'Mermaid 渲染失败')
        setStatus('error')
      }
    }

    void run()
    return () => {
      cancelled = true
      // 重跑/卸载前清空宿主，避免上一轮 svg 残留堆叠
      hostElement.innerHTML = ''
    }
  }, [source, theme])

  if (status === 'error') {
    return <div className="render-diagram-error-inline">{errorMessage ?? 'Mermaid 渲染失败'}</div>
  }
  return (
    <div className="render-diagram-canvas">
      {status === 'loading' && <div className="render-diagram-loading">正在生成图表…</div>}
      <div ref={hostRef} className="render-diagram-mermaid-host" />
    </div>
  )
}
