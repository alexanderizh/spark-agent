/**
 * FileMarkdownView — 项目文件 Markdown 预览的完整渲染器
 *
 * 为什么不和聊天共用 ChatMarkdown：
 * ────────────────────────
 * 聊天侧的 parseMarkdown 是为「流式消息」裁剪的轻量解析器，刻意不支持
 * 内嵌 HTML、嵌套图片链接（badge）、表格对齐、嵌套列表等文档级语法；
 * 而文件预览的对象是磁盘上的完整文档（README、设计文档），这些语法
 * 恰恰是主力，直接复用会导致 README 被「渲染得稀巴烂」。
 *
 * 本组件基于 react-markdown 建立 GitHub 级渲染管线：
 *   - remark-gfm：表格（含对齐）、任务列表、删除线、自动链接、脚注
 *   - rehype-raw：解析文档内嵌的 HTML 片段（<div align>、<table> 布局、
 *     <a>/<picture> badge、<sub>/<kbd> 等），空行后的 markdown 仍按
 *     CommonMark 规则解析（与 GitHub 行为一致）
 *   - rehype-sanitize：内嵌 HTML 白名单过滤——预览的 md 来自任意项目，
 *     属不可信输入，script/事件属性/危险协议必须剥除
 *
 * 渲染层复用应用内既有组件，保持与聊天一致的交互：
 *   - 图片 → MarkdownImage（本地路径转 safe-file://、点击全屏预览、失败占位）
 *   - 代码块 → MarkdownCodeBlock（shiki 高亮、复制按钮）
 *   - mermaid/svg 代码块 → RenderDiagramBlock / RenderSvgBlock 直接成图
 *   - 链接 → ClickableUrl（favicon 卡片）/ ClickableFilePath（本地文件引用）
 *   - 标题带锚点 id，支持文档内 `[跳转](#锚点)` 平滑滚动
 */

import React, { useMemo, useRef, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import type { Element, Nodes } from 'hast'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import './FileMarkdownView.less'
import { useAppearanceSettings } from '../hooks/useAppearance'
import { MarkdownImage, resolveImageSrc } from './MarkdownImage'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { isSvgCodeLanguage } from './markdown-code/codeLanguages'
import { ClickableFilePath, ClickableUrl } from './ClickableFilePath'
import {
  isLocalFileReference,
  isPreviewableFileReference,
  normalizeFileReference,
} from './FileDisplay'
import { RenderDiagramBlock } from '../views/chat/RenderDiagramBlock'
import { RenderSvgBlock } from '../views/chat/RenderSvgBlock'

type Props = {
  /** 文件全文内容 */
  content: string
  /** 相对路径图片的解析基准目录（被预览 md 文件所在目录） */
  imageBasePath?: string | null
  /** 当前工作区根目录；用于文档内相对文件链接的解析 */
  workspaceRootPath?: string | null
}

/**
 * sanitize 白名单：GitHub 风格 defaultSchema 上的最小扩展。
 * - img/source 放行 srcSet、src、media、type（<picture> 响应式图片）
 * - src 协议补 data:（data:image 内联图）——组件层只把它交给 <img>/MarkdownImage，无脚本执行面
 * - 标签补 figure/figcaption/mark（文档常见语义标签）
 */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'figure', 'figcaption', 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'srcSet', 'loading'],
    source: [...(defaultSchema.attributes?.source ?? []), 'src', 'type'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https', 'data'],
  },
}

/** data:image/ 的内联图保留原值，其余走 react-markdown 默认清洗（保留相对路径与 #锚点） */
function urlTransform(url: string): string {
  if (/^data:image\//i.test(url)) return url
  return defaultUrlTransform(url)
}

/**
 * GitHub 风格标题 slug：小写、空白折叠为连字符、去标点（保留字母数字连字符）。
 * 中文等 unicode 字母保留，与 GitHub 锚点行为一致，文档内 `[x](#中文标题)` 可直接命中。
 * 幂等无状态：重复标题的锚点都指向首个（可接受，文档极少内链重复标题）。
 */
function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
}

/** 递归提取 hast 节点内的纯文本（标题 slug、badge 链接 label 用） */
function hastText(node: Nodes | undefined): string {
  if (node == null) return ''
  if (node.type === 'text') return node.value
  if (node.type === 'element') {
    return node.children.map((child) => hastText(child)).join('')
  }
  return ''
}

function isMermaidLanguage(lang: string): boolean {
  const normalized = lang.trim().toLowerCase()
  return normalized === 'mermaid' || normalized === 'mmd'
}

/** 从 pre 的 hast 节点提取代码文本与语言标签（比从 React children 反查更稳） */
function extractCodeBlock(node: Element | undefined): { code: string; lang: string } | null {
  if (node == null) return null
  const codeEl = node.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'code',
  )
  if (codeEl == null) return null
  const className = codeEl.properties?.className
  const langClass =
    typeof className === 'string'
      ? className
      : Array.isArray(className)
        ? className.find(
            (item): item is string => typeof item === 'string' && item.startsWith('language-'),
          )
        : undefined
  const lang = langClass?.replace(/^language-/, '') ?? ''
  const code = codeEl.children.map((child) => hastText(child)).join('')
  return { code, lang }
}

/** 点击外链统一交给宿主安全打开（browser:open-external 全局拦截），不污染当前窗口 */
function isSafeExternalUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url)
}

/** children 是否为纯文本（单个或多个字符串），用于决定链接走 ClickableUrl 还是保真渲染 */
function isPlainTextChildren(children: ReactNode): children is string {
  if (typeof children === 'string') return true
  return Array.isArray(children) && children.every((item) => typeof item === 'string')
}

export function FileMarkdownView({ content, imageBasePath, workspaceRootPath }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { syntaxHighlight } = useAppearanceSettings()

  /** 文档内锚点跳转：preventDefault 后在预览容器内平滑滚动，避免 Electron 窗口内 hash 导航 */
  const scrollToAnchor = (id: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const target = containerRef.current?.querySelector(`[id="${id}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const components = useMemo<Components>(
    () => ({
      h1: HeadingWithAnchor(1),
      h2: HeadingWithAnchor(2),
      h3: HeadingWithAnchor(3),
      h4: HeadingWithAnchor(4),
      h5: HeadingWithAnchor(5),
      h6: HeadingWithAnchor(6),
      a: ({ href, children }) => {
        const url = typeof href === 'string' ? href : ''
        if (url.startsWith('#')) {
          const id = githubSlug(decodeURIComponent(url.slice(1)))
          return (
            <a href={url} className="md-anchor-link" onClick={scrollToAnchor(id)}>
              {children}
            </a>
          )
        }
        if (isLocalFileReference(url) || isPreviewableFileReference(url)) {
          return (
            <ClickableFilePath
              path={normalizeFileReference(url)}
              // label 是 ReactNode：badge 等富内容链接（图片指向本地路径）保真渲染
              label={children}
              workspaceRootPath={workspaceRootPath}
            />
          )
        }
        if (!isSafeExternalUrl(url)) {
          // javascript: 等危险协议（sanitize 已剥一层，这里兜底）退化为纯文本
          return <span className="md-unsafe-link">{children}</span>
        }
        // badge（子节点是 <img>）等富内容链接保持原样渲染，由全局外链拦截接管；
        // 纯文本链接走 ClickableUrl 获得 favicon 卡片与右键菜单
        return isPlainTextChildren(children) ? (
          <ClickableUrl url={url} label={Array.isArray(children) ? children.join('') : children} />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="md-rich-link">
            {children}
          </a>
        )
      },
      img: ({ node, src, alt }) => {
        const rawSrc = typeof src === 'string' ? src : ''
        const rawAlt = typeof alt === 'string' ? alt : ''
        if (rawSrc.length === 0) return null
        const properties = node?.properties ?? {}
        const width = typeof properties.width === 'number' ? properties.width : undefined
        const height = typeof properties.height === 'number' ? properties.height : undefined
        if (width != null || height != null) {
          // badge / 头像等显式指定了尺寸的内嵌图：保留原始宽高，只做路径解析与懒加载
          return (
            <img
              src={resolveImageSrc(rawSrc, imageBasePath)}
              alt={rawAlt}
              {...(width != null ? { width } : {})}
              {...(height != null ? { height } : {})}
              loading="lazy"
            />
          )
        }
        // 常规 markdown 图片走完整交互组件（safe-file://、点击预览、失败占位）
        return (
          <MarkdownImage
            src={rawSrc}
            alt={rawAlt}
            {...(imageBasePath != null ? { basePath: imageBasePath } : {})}
          />
        )
      },
      pre: ({ node }) => {
        const extracted = extractCodeBlock(node)
        if (extracted == null || extracted.code.length === 0) return null
        const { code, lang } = extracted
        if (isMermaidLanguage(lang) && code.trim().length > 0) {
          return (
            <RenderDiagramBlock
              block={{
                kind: 'diagram_block',
                toolCallId: 'file-markdown-mermaid',
                diagramType: 'mermaid',
                source: code,
                title: 'Mermaid 图表',
                height: 360,
                status: 'rendered',
                error: undefined,
                warnings: [],
              }}
            />
          )
        }
        if (isSvgCodeLanguage(lang) && code.trim().length > 0) {
          return <RenderSvgBlock source={code} />
        }
        return <MarkdownCodeBlock code={code} lang={lang} syntaxHighlight={syntaxHighlight} />
      },
      table: ({ children }) => (
        <div className="md-table-wrap">
          <table>{children}</table>
        </div>
      ),
    }),
    // 组件覆盖依赖的外部值仅这三个；保持引用稳定避免整棵文档树 remount
    [workspaceRootPath, imageBasePath, syntaxHighlight],
  )

  return (
    <div ref={containerRef} className="md-surface file-markdown-view">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          // 先解析内嵌 HTML，再统一过安全白名单
          [rehypeSanitize, sanitizeSchema],
        ]}
        urlTransform={urlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** react-markdown 组件覆盖的额外 props（hast 节点）；显式含 undefined 以兼容 exactOptionalPropertyTypes */
type ExtraProps = { node?: Element | undefined }

/** 标题渲染：附加 GitHub 风格锚点 id，作为文档内 `[x](#锚点)` 链接的滚动定位目标 */
function HeadingWithAnchor(level: 1 | 2 | 3 | 4 | 5 | 6) {
  return function Heading({ node, children }: React.ComponentPropsWithoutRef<'h1'> & ExtraProps) {
    const tagName = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    const id = githubSlug(hastText(node))
    return React.createElement(tagName, { id, 'data-anchor-id': id }, children)
  }
}
