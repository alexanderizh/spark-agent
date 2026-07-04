import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, TextArea as LobeTextArea } from '@lobehub/ui'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { Icons } from '../../Icons'

type CanvasPromptEditorProps = {
  prompt: string
  negativePrompt: string
  promptPlaceholder?: string
  negativePlaceholder?: string
  optimizeDisabled?: boolean
  onPromptChange: (value: string) => void
  onNegativePromptChange: (value: string) => void
  onOptimizePrompt: () => void
}

type PromptFormat = 'bold' | 'italic' | 'bullet' | 'quote'

export function CanvasPromptEditor({
  prompt,
  negativePrompt,
  promptPlaceholder,
  negativePlaceholder = '写下不希望 AI 出现的内容，例如低清晰度、变形、错误文字、水印等',
  optimizeDisabled,
  onPromptChange,
  onNegativePromptChange,
  onOptimizePrompt,
}: CanvasPromptEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const promptRef = useRef<TextAreaRef | null>(null)
  const stats = useMemo(
    () => ({
      promptChars: prompt.trim().length,
      negativeChars: negativePrompt.trim().length,
      lines: prompt.split(/\r?\n/).filter((line) => line.trim()).length,
    }),
    [negativePrompt, prompt],
  )

  const applyFormat = (format: PromptFormat) => {
    const textarea = promptRef.current?.resizableTextArea?.textArea
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = prompt.slice(start, end)
    const fallback = format === 'bullet' ? '要点' : format === 'quote' ? '说明' : '文本'
    const text = selected || fallback
    const nextText =
      format === 'bold'
        ? `**${text}**`
        : format === 'italic'
          ? `*${text}*`
          : format === 'bullet'
            ? text
                .split(/\r?\n/)
                .map((line) => `- ${line || fallback}`)
                .join('\n')
            : text
                .split(/\r?\n/)
                .map((line) => `> ${line || fallback}`)
                .join('\n')
    const nextValue = `${prompt.slice(0, start)}${nextText}${prompt.slice(end)}`
    onPromptChange(nextValue)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start, start + nextText.length)
    })
  }

  return (
    <div className={`canvas-prompt-editor ${expanded ? 'expanded' : ''}`}>
      <div className="canvas-prompt-editor-head">
        <div>
          <label>提示词</label>
          <span>支持 Markdown 富文本，可输入更完整的生成、编辑和约束说明</span>
        </div>
        <div className="canvas-prompt-editor-tools" aria-label="提示词格式工具">
          <Button size="middle" type="text" title="加粗" onClick={() => applyFormat('bold')}>
            B
          </Button>
          <Button size="middle" type="text" title="斜体" onClick={() => applyFormat('italic')}>
            I
          </Button>
          <Button size="middle" type="text" title="列表" onClick={() => applyFormat('bullet')}>
            列表
          </Button>
          <Button size="middle" type="text" title="引用" onClick={() => applyFormat('quote')}>
            引用
          </Button>
          <Button
            size="middle"
            type={previewing ? 'primary' : 'text'}
            title={previewing ? '返回编辑' : '预览富文本'}
            onClick={() => setPreviewing((prev) => !prev)}
          >
            预览
          </Button>
          <Button
            size="middle"
            type="text"
            icon={expanded ? <Icons.Minimize size={13} /> : <Icons.Maximize size={13} />}
            title={expanded ? '折叠输入区' : '展开输入区'}
            aria-label={expanded ? '折叠输入区' : '展开输入区'}
            onClick={() => setExpanded((prev) => !prev)}
          />
        </div>
      </div>
      {previewing ? (
        <PromptMarkdownPreview
          value={prompt}
          {...(promptPlaceholder != null ? { placeholder: promptPlaceholder } : {})}
        />
      ) : (
        <LobeTextArea
          ref={promptRef}
          className="canvas-prompt-editor-textarea"
          value={prompt}
          rows={expanded ? 12 : 7}
          placeholder={promptPlaceholder}
          onChange={(e) => onPromptChange(e.target.value)}
        />
      )}
      <div className="canvas-prompt-editor-meta">
        <span>{stats.promptChars} 字符</span>
        <span>{stats.lines} 行有效内容</span>
      </div>
      <div className="canvas-negative-prompt-field">
        <label>反向提示词</label>
        <LobeTextArea
          value={negativePrompt}
          rows={expanded ? 5 : 3}
          placeholder={negativePlaceholder}
          onChange={(e) => onNegativePromptChange(e.target.value)}
        />
        <div className="canvas-prompt-editor-meta">
          <span>{stats.negativeChars} 字符</span>
          <span>会作为 negativePrompt 随任务提交</span>
        </div>
      </div>
      <div className="canvas-prompt-editor-footer">
        <Button
          size="middle"
          icon={<Icons.Sparkles size={14} />}
          disabled={Boolean(optimizeDisabled)}
          onClick={onOptimizePrompt}
        >
          AI 优化
        </Button>
      </div>
    </div>
  )
}

function PromptMarkdownPreview({
  value,
  placeholder,
}: {
  value: string
  placeholder?: string
}) {
  const blocks = value.trim() ? value.split(/\n{2,}/) : []
  if (blocks.length === 0) {
    return <div className="canvas-prompt-preview empty">{placeholder ?? '暂无提示词内容'}</div>
  }
  return (
    <div className="canvas-prompt-preview">
      {blocks.map((block, index) => (
        <div key={`${index}-${block.slice(0, 16)}`}>{renderPreviewBlock(block)}</div>
      ))}
    </div>
  )
}

function renderPreviewBlock(block: string) {
  const lines = block.split(/\r?\n/)
  if (lines.every((line) => line.trim().startsWith('- '))) {
    return (
      <ul>
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>{renderInlineMarkdown(line.trim().replace(/^- /, ''))}</li>
        ))}
      </ul>
    )
  }
  if (lines.every((line) => line.trim().startsWith('> '))) {
    return (
      <blockquote>
        {lines.map((line, index) => (
          <span key={`${index}-${line}`}>
            {renderInlineMarkdown(line.trim().replace(/^> /, ''))}
            {index < lines.length - 1 ? '\n' : null}
          </span>
        ))}
      </blockquote>
    )
  }
  return <p>{renderInlineMarkdown(block)}</p>
}

function renderInlineMarkdown(value: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push(value.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('**')) {
      parts.push(<strong key={`${index}-strong`}>{token.slice(2, -2)}</strong>)
    } else {
      parts.push(<em key={`${index}-em`}>{token.slice(1, -1)}</em>)
    }
    cursor = index + token.length
  }
  if (cursor < value.length) parts.push(value.slice(cursor))
  return parts
}
