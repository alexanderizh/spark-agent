/**
 * RenderSvgBlock —— 内容区 ```svg 代码块的直接渲染板块。
 *
 * 现象背景：shiki 不收录 svg（`codeToHtml` 传 'svg' 直接抛 Language not found），
 * ```svg 代码块此前只能回落成无着色纯文本，既看不到图形也看不到着色源码。这里按
 * 「代码块 → 图形板块」处理（与 mermaid 图表、HTML 板块同一套路由）：
 *   - 默认直接渲染图形；
 *   - header 提供「源码 / 预览」切换，源码复用 MarkdownCodeBlock（svg 已归一到 xml 着色）。
 *
 * 渲染策略（安全优先，两条路径）：
 *   1. 完整文档（含 `<svg>` 根）→ `<img src="data:image/svg+xml;base64,...">`。
 *      SVG-as-image 处于 secure animated mode：脚本不执行、其 `<style>` 也不会污染宿主
 *      DOM，同时 CSS/动画保真，保真度与安全性都最好。
 *   2. 片段（只有 `<g>`/`<circle>` 等，没有 `<svg>` 根，团队/子 agent 常返回这种）→
 *      先经 DOMPurify（svg profile，禁 script/style/foreignObject）净化，再内联到自建
 *      `<svg>` 外壳；挂载后按 `getBBox()` 自动算 viewBox，坐标原点不在 (0,0) 的片段也能
 *      完整落在可视区。
 *
 * 派生状态按源码键控（失败态/几何都记录在「属于哪段源码」上），切换代码块时天然失效，
 * 不需要用 effect 反向重置 state。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { BlockTrafficHeader } from '../../components/BlockTrafficHeader'
import { MarkdownCodeBlock } from '../../components/MarkdownCodeBlock'
import {
  hasExternalSvgReference,
  isSvgDocument,
  sanitizeSvgFragment,
  SVG_NS,
  toSvgDataUrl,
  XLINK_NS,
} from './renderSvgSource'
import './RenderSvgBlock.less'

type SvgGeometry = {
  /** 该几何是为哪段片段源码测量的 */
  fragment: string
  viewBox: string
  aspectRatio: string
}

export function RenderSvgBlock({ source }: { source: string }) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [geometry, setGeometry] = useState<SvgGeometry | null>(null)
  const hostRef = useRef<SVGSVGElement | null>(null)

  const isDocument = useMemo(() => isSvgDocument(source), [source])
  const dataUrl = useMemo(() => (isDocument ? toSvgDataUrl(source) : null), [isDocument, source])
  const fragment = useMemo(
    () => (isDocument ? null : sanitizeSvgFragment(source)),
    [isDocument, source],
  )
  const externalNote =
    !isDocument && hasExternalSvgReference(source)
      ? '该片段引用了外部资源，预览时由浏览器直接加载'
      : null
  const imageFailed = failedSource === source
  const fit = geometry != null && geometry.fragment === fragment ? geometry : null

  // 片段没有自身尺寸：挂载后按实际几何算 viewBox + 宽高比，避免原点不在 (0,0) 时被裁切
  useEffect(() => {
    const host = hostRef.current
    if (host == null || fragment == null) return
    try {
      const box = host.getBBox()
      if (box.width <= 0 || box.height <= 0) return
      const padding = Math.max(box.width, box.height) * 0.04
      const width = box.width + padding * 2
      const height = box.height + padding * 2
      setGeometry({
        fragment,
        viewBox: `${box.x - padding} ${box.y - padding} ${width} ${height}`,
        aspectRatio: `${width} / ${height}`,
      })
    } catch {
      // getBBox 在未布局/空内容/测试环境（jsdom）下不可用：保持无 viewBox 渲染，不阻断预览
    }
  }, [fragment])

  const toggleSource = () => setSourceOpen((open) => !open)

  const renderPreview = () => {
    if (isDocument) {
      if (imageFailed) {
        return (
          <div className="render-svg-error" role="alert">
            <Icons.AlertTriangle size={15} />
            <span>SVG 图形解析失败，可切换到「源码」查看原始内容。</span>
          </div>
        )
      }
      return (
        <div className="render-svg-canvas-wrap">
          <img
            alt="SVG 图形预览"
            className="render-svg-image"
            onError={() => setFailedSource(source)}
            src={dataUrl ?? ''}
          />
        </div>
      )
    }

    if (fragment != null && fragment.trim().length === 0) {
      return (
        <div className="render-svg-muted" role="status">
          未识别到可渲染的 SVG 图形内容，可切换到「源码」查看。
        </div>
      )
    }

    return (
      <div className="render-svg-canvas-wrap">
        <div
          className="render-svg-fragment"
          style={fit != null ? { aspectRatio: fit.aspectRatio } : undefined}
        >
          <svg
            className="render-svg-canvas"
            dangerouslySetInnerHTML={{ __html: fragment ?? '' }}
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            ref={hostRef}
            viewBox={fit?.viewBox}
            width="100%"
            xmlns={SVG_NS}
            xmlnsXlink={XLINK_NS}
          />
        </div>
      </div>
    )
  }

  return (
    <section className="render-svg-block">
      <BlockTrafficHeader
        actions={
          <Button
            className="render-svg-action"
            icon={<Icons.Code size={13} />}
            onClick={toggleSource}
            size="small"
            type="text"
          >
            {sourceOpen ? '预览' : '源码'}
          </Button>
        }
        badge="SVG"
        title="SVG 图形"
      />
      {sourceOpen ? (
        <div className="render-svg-source-wrap">
          <MarkdownCodeBlock code={source} lang="svg" syntaxHighlight />
        </div>
      ) : (
        renderPreview()
      )}
      {externalNote != null && !sourceOpen && (
        <div className="render-svg-note" role="note">
          {externalNote}
        </div>
      )}
    </section>
  )
}
