/**
 * SkillFileViewer — 技能文件查看/编辑面板（右侧）。
 *
 * 三种呈现：
 *   - 预览：Markdown 走 ChatMarkdown 渲染管线（表格/代码块/引用/相对路径图片全支持）；
 *     图片文件走 safe-file:// 直接渲染；其余文本按纯文本段落展示
 *   - 源码：Monaco（复用 CodeViewerEditor，读只读态由 readOnly 控制）
 *   - 编辑：源码模式 + 可写，Ctrl/Cmd+S 保存（快捷键由 CodeViewerEditor 内置）
 *
 * 顶部工具条给出「技能文件 · 文件名 / 体积 / 预览|源码 分段控件」，与设计系统
 * 的分段控件（.skill-store-tab）视觉语言保持一致。
 */

import { useMemo } from 'react'
import { Spin } from 'antd'
import { Icons } from '../../Icons'
import { Button, Empty } from '@lobehub/ui'
import { MarkdownText } from '../chat/ChatMarkdown'
import { CodeViewerEditor } from '../../components/code-viewer/CodeViewerEditor'
import {
  editorFontSizeFor,
  editorLineHeightFor,
  useCodeViewerZoom,
} from '../../components/code-viewer/codeViewerZoom'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import {
  SKILL_FILE_PREVIEW_LIMIT,
  fileExtension,
  formatFileSize,
  isImageFile,
  isMarkdownFile,
  toSafeFileUrl,
} from './skill-detail-utils'

export type SkillFileViewMode = 'preview' | 'source'

interface SkillFileViewerProps {
  /** 文件展示名 */
  fileName: string
  /** 相对技能根目录的路径（标题栏与 monaco 模型键都用它拼唯一值） */
  relPath: string
  /** monaco 模型唯一键：优先用绝对路径，虚拟技能用合成 skill:// 路径 */
  modelKey: string
  /** 图片预览用的绝对路径（虚拟技能 / 未知根目录时为 null） */
  absolutePath: string | null
  /** Markdown 内相对路径图片的解析基准目录（绝对路径） */
  imageBasePath: string | null
  /** 当前编辑器内容（编辑态为草稿，非编辑态为磁盘内容） */
  content: string
  /** 磁盘内容体积（用于标题栏展示；编辑态仍展示原始体积） */
  size: number
  truncated?: boolean
  error?: string
  loading: boolean
  mode: SkillFileViewMode
  onModeChange: (mode: SkillFileViewMode) => void
  editing: boolean
  readOnly: boolean
  saving?: boolean
  /** 资源不存在（虚拟技能无文件） */
  empty?: boolean
  onDraftChange: (value: string) => void
  onSave: () => void
}

export function SkillFileViewer({
  fileName,
  relPath,
  modelKey,
  absolutePath,
  imageBasePath,
  content,
  size,
  truncated = false,
  error = '',
  loading,
  mode,
  onModeChange,
  editing,
  readOnly,
  saving = false,
  empty = false,
  onDraftChange,
  onSave,
}: SkillFileViewerProps) {
  const theme = useResolvedTheme()
  const zoom = useCodeViewerZoom()
  const fontSize = useMemo(() => editorFontSizeFor(zoom), [zoom])
  const lineHeight = useMemo(() => editorLineHeightFor(fontSize), [fontSize])

  const markdown = isMarkdownFile(fileName)
  const image = isImageFile(fileName)
  // 预览态只对 markdown 有「渲染」语义；图片走图片预览，其余文本退化为只读源码
  const canPreview = markdown || image
  const effectiveMode: SkillFileViewMode = canPreview ? mode : 'source'
  const monacoTheme: 'dark' | 'light' = theme === 'dark' ? 'dark' : 'light'

  const imageSrc = useMemo(() => {
    if (!image || absolutePath == null) return null
    return toSafeFileUrl(absolutePath)
  }, [image, absolutePath])

  return (
    <div className="skill-file-viewer">
      <div className="skill-file-viewer-head">
        <div className="skill-file-viewer-title">
          <Icons.FileText size={14} />
          <span className="skill-file-viewer-title-label">技能文件</span>
          <span className="skill-file-viewer-title-name" title={relPath}>
            {fileName}
          </span>
        </div>
        <div className="skill-file-viewer-head-right">
          {size > 0 && <span className="skill-file-viewer-size">{formatFileSize(size)}</span>}
          {canPreview && (
            <div className="skill-file-viewer-mode" role="tablist" aria-label="查看方式">
              <button
                type="button"
                role="tab"
                aria-selected={effectiveMode === 'preview'}
                className={`skill-file-viewer-mode-btn ${effectiveMode === 'preview' ? 'is-active' : ''}`}
                onClick={() => onModeChange('preview')}
                disabled={editing}
                title={editing ? '编辑中不支持切换预览' : '预览渲染结果'}
              >
                <Icons.Eye size={12} />
                预览
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveMode === 'source'}
                className={`skill-file-viewer-mode-btn ${effectiveMode === 'source' ? 'is-active' : ''}`}
                onClick={() => onModeChange('source')}
              >
                <Icons.Code size={12} />
                源码
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="skill-file-viewer-body">
        {loading ? (
          <div className="skill-file-viewer-state">
            <Spin />
            <span>正在读取文件…</span>
          </div>
        ) : error.length > 0 ? (
          <div className="skill-file-viewer-state">
            <Empty description={error} />
          </div>
        ) : empty ? (
          <div className="skill-file-viewer-state">
            <Empty description="该技能没有可预览的磁盘文件" />
          </div>
        ) : effectiveMode === 'preview' && image ? (
          <div className="skill-file-viewer-image">
            {imageSrc != null ? (
              <img src={imageSrc} alt={fileName} />
            ) : (
              <div className="skill-file-viewer-hint">无法解析该图片的磁盘路径</div>
            )}
            <div className="skill-file-viewer-hint">
              {fileExtension(fileName).toUpperCase().slice(1)} · {formatFileSize(size)}
            </div>
          </div>
        ) : effectiveMode === 'preview' ? (
          <div className="skill-file-viewer-markdown">
            {truncated && (
              <div className="skill-file-viewer-truncated">
                文件超过 {formatFileSize(SKILL_FILE_PREVIEW_LIMIT)}，仅展示前一部分内容
              </div>
            )}
            <MarkdownText content={content} imageBasePath={imageBasePath} />
          </div>
        ) : image ? (
          <div className="skill-file-viewer-state">
            <Empty description="图片为二进制内容，暂无源码视图" />
          </div>
        ) : (
          <CodeViewerEditor
            filePath={modelKey}
            content={content}
            readOnly={!editing || readOnly}
            theme={monacoTheme}
            minimapEnabled={false}
            fontSize={fontSize}
            lineHeight={lineHeight}
            onContentChange={onDraftChange}
            onSave={onSave}
          />
        )}

        {saving && (
          <div className="skill-file-viewer-saving">
            <Spin size="small" />
            <span>保存中…</span>
          </div>
        )}
      </div>

      {editing && !readOnly && (
        <div className="skill-file-viewer-foot">
          <span className="skill-file-viewer-foot-hint">
            <Icons.Lightbulb size={12} />
            Ctrl / ⌘ + S 保存
          </span>
          <div className="skill-file-viewer-foot-actions">
            <Button size="small" type="text" onClick={onSave} disabled={saving}>
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
