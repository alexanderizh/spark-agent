import DOMPurify from 'dompurify'

/**
 * ```svg 代码块渲染用的纯工具（文档判定 / 编码 / 净化）。
 *
 * 与组件分文件的原因：纯函数独立可测，且组件文件只导出组件（满足 fast-refresh 约束）。
 */

export const SVG_NS = 'http://www.w3.org/2000/svg'
export const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** 完整 SVG 文档判定：出现 `<svg` 起始标签即按文档处理 */
const SVG_ROOT_PATTERN = /<svg[\s>]/i

/** 外部资源引用（含协议相对地址）；片段内联渲染时浏览器会真的去加载它 */
const EXTERNAL_REFERENCE_PATTERN = /\b(?:src|href|xlink:href)\s*=\s*["']?(?:https?:)?\/\//i

/** 该源码是否是自带根标签的完整 SVG 文档 */
export function isSvgDocument(source: string): boolean {
  return SVG_ROOT_PATTERN.test(source)
}

/** 源码内是否引用了外部资源（http/https/协议相对） */
export function hasExternalSvgReference(source: string): boolean {
  return EXTERNAL_REFERENCE_PATTERN.test(source)
}

/** UTF-8 安全的 base64：btoa 只接受 latin1，SVG 里的中文注释会直接抛错 */
export function toSvgDataUrl(source: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
}

/**
 * 片段净化：只保留 SVG 图形标签，去掉脚本与文档级样式。
 *
 * 必须先把片段包进 `<svg>` 外壳再净化：HTML 解析器只有在 `<svg>` 内部才按 SVG
 * 命名空间解析 `<g>`/`<circle>`，裸片段会被当成未知 HTML 元素而整段被 DOMPurify 丢弃。
 * `<style>` 被禁是因为内联 SVG 的样式表作用域是整个文档，可能影响宿主界面。
 */
export function sanitizeSvgFragment(source: string): string {
  const wrapped = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${source}</svg>`
  const cleaned = DOMPurify.sanitize(wrapped, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'style', 'foreignObject', 'iframe', 'handler', 'listener'],
  })
  // 只取外壳内部内容：外壳由组件自己渲染（需要 ref/getBBox 与根命名空间属性）
  const inner = /^<svg[^>]*>([\s\S]*)<\/svg>$/i.exec(cleaned.trim())
  return inner?.[1] ?? ''
}
