import React, { useMemo, type ReactNode } from 'react'
import type { JSX } from 'react'
import { useAppearanceSettings } from '../../hooks/useAppearance'
import { MarkdownCodeBlock } from '../../components/MarkdownCodeBlock'
import { MarkdownImage } from '../../components/MarkdownImage'
import {
  ClickableFilePath,
  ClickableUrl,
  extractFilePaths,
  extractUrlsAndEmails,
  type PreviewFileType,
} from '../../components/ClickableFilePath'
import {
  isLocalFileReference,
  isPreviewableFileReference,
  normalizeFileReference,
} from '../../components/FileDisplay'
import { renderDocumentOutputParagraph } from './ChatDocumentOutput'
import { parseMarkdown } from './ChatMarkdownUtils'

export const MarkdownText = React.memo(function MarkdownText({
  content,
  isStreaming: _isStreaming = false,
  agents,
  onMentionClick,
  onFilePreview,
}: {
  content: string
  isStreaming?: boolean
  agents?: { id: string; name: string }[]
  onMentionClick?: (agentId: string) => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  const { syntaxHighlight } = useAppearanceSettings()
  const seenDocumentKeys = new Set<string>()

  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const tagName = `h${Math.min(block.level, 6)}` as keyof JSX.IntrinsicElements
            return React.createElement(
              tagName,
              { key: index },
              renderInlineMarkdown(block.text, agents, onMentionClick, onFilePreview),
            )
          }
          case 'paragraph': {
            const documentCards = renderDocumentOutputParagraph(
              block.text,
              seenDocumentKeys,
              onFilePreview,
              `doc-card-${index}`,
            )
            if (documentCards != null) return documentCards
            return (
              <p key={index}>
                {renderInlineMarkdown(block.text, agents, onMentionClick, onFilePreview)}
              </p>
            )
          }
          case 'code':
            return (
              <MarkdownCodeBlock
                key={index}
                code={block.code}
                lang={block.lang}
                syntaxHighlight={syntaxHighlight}
              />
            )
          case 'incomplete_code':
            return (
              <MarkdownCodeBlock
                key={index}
                code={block.code}
                lang={block.lang}
                syntaxHighlight={syntaxHighlight}
                incomplete
              />
            )
          case 'quote':
            return (
              <blockquote key={index}>
                {renderInlineMarkdown(block.text, agents, onMentionClick, onFilePreview)}
              </blockquote>
            )
          case 'list': {
            const listTag = (block.ordered ? 'ol' : 'ul') as 'ol' | 'ul'
            return React.createElement(
              listTag,
              { key: index },
              block.items.map((item, itemIndex) => (
                <li key={itemIndex} className={item.checked !== undefined ? 'md-task' : undefined}>
                  {item.checked !== undefined && (
                    <input type="checkbox" checked={item.checked} readOnly />
                  )}
                  <span>
                    {renderInlineMarkdown(item.text, agents, onMentionClick, onFilePreview)}
                  </span>
                </li>
              )),
            )
          }
          case 'table':
            return (
              <div key={index} className="md-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {block.headers.map((header, headerIndex) => (
                        <th key={headerIndex}>
                          {renderInlineMarkdown(header, agents, onMentionClick, onFilePreview)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {block.headers.map((_, cellIndex) => (
                          <td key={cellIndex}>
                            {renderInlineMarkdown(
                              row[cellIndex] ?? '',
                              agents,
                              onMentionClick,
                              onFilePreview,
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'hr':
            return <hr key={index} />
          default:
            return null
        }
      })}
    </>
  )
})

function StreamingCursor() {
  // 光标闪烁效果已移除 — 流式消息不再显示闪烁光标
  return null
}

/**
 * 将纯文本中的 @mention 片段替换为主题色 span；可点击时额外附加 onClick
 * @param offset `text` 在父串中的绝对偏移，用于生成跨调用唯一的 React key，
 *                避免同一段 markdown 文本里多个空隙调用本函数时 key 撞车。
 */
function highlightMentions(
  text: string,
  agents?: { id: string; name: string }[],
  onMentionClick?: (agentId: string) => void,
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void,
  offset: number = 0,
): ReactNode[] {
  const mentionPattern = /(^|\s)(@[\p{L}\p{N}_\-.]+)/gu
  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  const agentMap = agents ? new Map(agents.map((a) => [a.name.toLowerCase(), a.id])) : null
  while ((match = mentionPattern.exec(text)) != null) {
    const prefix = match[1] ?? ''
    const mention = match[2] ?? ''
    const mentionStart = match.index + prefix.length
    if (mentionStart > cursor)
      parts.push(
        ...highlightFilePaths(
          text.slice(cursor, mentionStart),
          onFilePreview,
          `fp-${offset + cursor}`,
        ),
      )
    const agentId = agentMap?.get(mention.slice(1).toLowerCase())
    const clickable = onMentionClick != null && agentId != null
    parts.push(
      <span
        key={`mention-${offset + mentionStart}`}
        className={`mention-highlight${clickable ? ' mention-highlight-clickable' : ''}`}
        {...(clickable
          ? {
              role: 'button',
              tabIndex: 0,
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation()
                onMentionClick!(agentId!)
              },
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onMentionClick!(agentId!)
                }
              },
            }
          : {})}
      >
        {mention}
      </span>,
    )
    cursor = mentionStart + mention.length
  }
  if (cursor < text.length)
    parts.push(...highlightFilePaths(text.slice(cursor), onFilePreview, `fp-${offset + cursor}`))
  return parts.length > 0 ? parts : [text]
}

/** 识别文本中的文件路径并渲染为可点击链接；非路径段交给 highlightUrls 处理裸 URL/mailto */
function highlightFilePaths(
  text: string,
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void,
  keyPrefix: string = 'fp',
): ReactNode[] {
  const pathParts = extractFilePaths(text)
  if (pathParts.length === 0) return [text]
  // 整段都不是路径 → 直接走 URL 高亮
  if (pathParts.length === 1 && !pathParts[0]!.isPath) {
    return highlightUrls(pathParts[0]!.text, `${keyPrefix}-u`)
  }

  const nodes: ReactNode[] = []
  pathParts.forEach((part, index) => {
    if (!part.isPath) {
      nodes.push(...highlightUrls(part.text, `${keyPrefix}-${index}-u`))
      return
    }
    nodes.push(
      <ClickableFilePath
        key={`${keyPrefix}-${index}`}
        path={part.text}
        {...(onFilePreview != null ? { onPreview: onFilePreview } : {})}
      />,
    )
  })
  return nodes
}

/** 识别裸 URL / www. / mailto，渲染为主题色 <a> */
function highlightUrls(text: string, keyPrefix: string = 'u'): ReactNode[] {
  const parts = extractUrlsAndEmails(text)
  if (parts.length === 0) return [text]
  if (parts.length === 1 && parts[0]!.kind === 'text') return [text]

  return parts.map((part, index) => {
    if (part.kind === 'text') {
      return <span key={`${keyPrefix}-${index}`}>{part.text}</span>
    }
    return <ClickableUrl key={`${keyPrefix}-${index}`} url={part.text} />
  })
}

function renderInlineMarkdown(
  text: string,
  agents?: { id: string; name: string }[],
  onMentionClick?: (agentId: string) => void,
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void,
): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern =
    /(!?\[[^\]]+]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) != null) {
    if (match.index > cursor)
      nodes.push(
        ...highlightMentions(
          text.slice(cursor, match.index),
          agents,
          onMentionClick,
          onFilePreview,
          cursor,
        ),
      )
    const token = match[0]
    const key = `${match.index}-${token}`
    const link = token.match(/^(!?)\[([^\]]+)]\(([^)]+)\)$/)
    if (link) {
      // 图片走 MarkdownImage 组件：自动把本地路径转 safe-file:// 协议，
      // 并支持点击预览 / 复制 / 下载 / 失败占位
      if (link[1] === '!') {
        nodes.push(<MarkdownImage key={key} src={link[3] ?? ''} alt={link[2] ?? ''} />)
      } else {
        const href = link[3] ?? ''
        const normalizedHref = normalizeFileReference(href)
        if (isLocalFileReference(href) || isPreviewableFileReference(href)) {
          nodes.push(
            <ClickableFilePath
              key={key}
              path={normalizedHref}
              label={link[2] ?? normalizedHref}
              {...(onFilePreview != null ? { onPreview: onFilePreview } : {})}
            />,
          )
        } else {
          nodes.push(
            <a
              key={key}
              className="clickable-url"
              href={href || '#'}
              target="_blank"
              rel="noreferrer"
            >
              {link[2] ?? ''}
            </a>,
          )
        }
      }
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    cursor = match.index + token.length
  }

  if (cursor < text.length)
    nodes.push(
      ...highlightMentions(text.slice(cursor), agents, onMentionClick, onFilePreview, cursor),
    )
  const rendered: ReactNode[] = []
  nodes.forEach((node, index) => {
    if (typeof node !== 'string') {
      rendered.push(node)
      return
    }
    const parts = node.split('\n')
    parts.forEach((part, partIndex) => {
      rendered.push(part)
      if (partIndex < parts.length - 1) rendered.push(<br key={`br-${index}-${partIndex}`} />)
    })
  })
  return rendered
}
