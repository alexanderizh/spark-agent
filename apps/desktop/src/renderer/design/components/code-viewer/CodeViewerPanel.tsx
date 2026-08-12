/**
 * CodeViewerPanel ——「代码」tab 内容容器。
 *
 * 组合：文件 tabs 行（多文件切换/关闭/脏标）· 工具栏 · 冲突横幅 · 编辑器/diff 主体 · 状态栏。
 * 作为 UnifiedSessionSidePanel 的 children 渲染，自身填满父容器（高度 100%）。
 *
 * 文件列表 / 激活文件 / 视图模式由 ChatView 受控传入（便于切会话快照存盘）；
 * 内容运行时态（读取/脏标/外部变更）由内部 useCodeViewerFiles 管理。
 */

import { useCallback, useState } from 'react'
import { Icons } from '../../Icons'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { FileTypeIcon } from '../FileDisplay'
import { useToast } from '../Toast'
import { CodeViewerEditor } from './CodeViewerEditor'
import { CodeViewerDiff } from './CodeViewerDiff'
import { CodeViewerToolbar } from './CodeViewerToolbar'
import { useCodeViewerFiles, CodeFileExternalChangeError } from './useCodeViewerFiles'
import { useGitDiff } from './useGitDiff'
import { getMonacoLanguage } from './codeLanguage'
import type { OpenCodeFile, CodeViewMode } from './types'
import './index.less'

export interface CodeViewerPanelProps {
  files: OpenCodeFile[]
  activeAbsPath: string | null
  viewMode: CodeViewMode
  onSelectActive: (absPath: string) => void
  onCloseFile: (absPath: string) => void
  onViewModeChange: (mode: CodeViewMode) => void
  workspaceId?: string | null
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx >= 0 ? norm.slice(idx + 1) : p
}

export function CodeViewerPanel({
  files,
  activeAbsPath,
  viewMode,
  onSelectActive,
  onCloseFile,
  onViewModeChange,
  workspaceId,
}: CodeViewerPanelProps) {
  const resolvedTheme = useResolvedTheme()
  const theme: 'dark' | 'light' = resolvedTheme === 'light' ? 'light' : 'dark'
  const { activeRuntime, editActive, saveActive, reloadActive, forceSaveActive, isDirty } =
    useCodeViewerFiles(files, activeAbsPath)
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [minimapEnabled, setMinimapEnabled] = useState(false)

  const active = files.find((f) => f.absPath === activeAbsPath) ?? null
  // 「本次改动」视图按需实时取 git diff（仅切到 diff 视图才请求）
  const diffInfo = useGitDiff(
    workspaceId,
    active?.displayPath,
    active?.changeType === 'create',
    viewMode === 'diff' && active != null,
  )

  const handleSave = useCallback(async () => {
    if (activeAbsPath == null) return
    setSaving(true)
    try {
      await saveActive()
      toast.success('已保存')
    } catch (err) {
      if (err instanceof CodeFileExternalChangeError) {
        // externalChanged 已在 runtime 置位 → 冲突横幅出现，不重复 toast
      } else {
        toast.error(err instanceof Error ? err.message : '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }, [activeAbsPath, saveActive, toast])

  if (active == null) {
    return (
      <div className="code-viewer-panel" data-cv-theme={theme}>
        <div className="code-viewer-empty">
          <div className="code-viewer-empty-icon">{'</>'}</div>
          <div className="code-viewer-empty-text">点击会话中的代码文件，在此查看与编辑</div>
        </div>
      </div>
    )
  }

  const readOnly = active.changeType === 'delete'
  const dirty = isDirty(active.absPath)
  const externalChanged = activeRuntime?.externalChanged === true

  return (
    <div className="code-viewer-panel" data-cv-theme={theme}>
      <div className="cv-filetabs">
        {files.map((f) => {
          const fDirty = isDirty(f.absPath)
          const isActive = f.absPath === activeAbsPath
          return (
            <div
              key={f.absPath}
              className={`cv-ftab${isActive ? ' active' : ''}${fDirty ? ' dirty' : ''}`}
              title={f.absPath}
              onClick={() => onSelectActive(f.absPath)}
            >
              <span className="cv-ftab-icon">
                <FileTypeIcon filePath={f.absPath} size={14} />
              </span>
              <span className="cv-ftab-name">{basename(f.displayPath)}</span>
              <span className="cv-ftab-dot" aria-label="未保存" />
              <button
                type="button"
                className="cv-ftab-x"
                aria-label="关闭"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseFile(f.absPath)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <CodeViewerToolbar
        absPath={active.absPath}
        displayPath={active.displayPath}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        dirty={dirty}
        externalChanged={externalChanged}
        saving={saving}
        readOnly={readOnly}
        hasDiff={active.changeType !== 'delete'}
        minimapEnabled={minimapEnabled}
        onToggleMinimap={() => setMinimapEnabled((v) => !v)}
        onSave={() => void handleSave()}
      />

      {externalChanged && (
        <div className="cv-conflict-banner">
          <span className="cv-conflict-text">文件已被外部修改（如 agent 写入），继续保存将覆盖磁盘内容。</span>
          <div className="cv-conflict-actions">
            <button type="button" className="cv-mini-btn" onClick={() => void reloadActive()}>
              用磁盘重载
            </button>
            <button type="button" className="cv-mini-btn primary" onClick={() => void forceSaveActive()}>
              覆盖保存
            </button>
          </div>
        </div>
      )}

      <div className="cv-body">
        {activeRuntime?.state === 'loading' && (
          <div className="code-viewer-loading">
            <Icons.Spinner size={18} className="cv-spin" /> 读取文件…
          </div>
        )}
        {activeRuntime?.state === 'error' && (
          <div className="code-viewer-error">
            <div className="code-viewer-error-title">无法读取该文件</div>
            <div className="code-viewer-error-detail">{activeRuntime.error}</div>
          </div>
        )}
        {activeRuntime?.state === 'ready' &&
          (viewMode === 'diff' ? (
            <CodeViewerDiff
              diff={diffInfo.diff}
              isBinary={diffInfo.isBinary}
              loading={diffInfo.loading}
              error={diffInfo.error}
              changeType={active.changeType}
            />
          ) : (
            <CodeViewerEditor
              filePath={active.absPath}
              content={activeRuntime.content}
              readOnly={readOnly}
              theme={theme}
              lineNumber={active.lineNumber}
              minimapEnabled={minimapEnabled}
              onContentChange={editActive}
              onSave={() => void handleSave()}
            />
          ))}
      </div>

      <div className="cv-statusbar">
        <span className={`cv-sb-item${dirty ? ' dirty' : ''}`}>{dirty ? '● 未保存' : '已保存'}</span>
        <span className="cv-sb-spacer" />
        <span className="cv-sb-item">{getMonacoLanguage(active.absPath)}</span>
        <span className="cv-sb-item">UTF-8</span>
        <span className="cv-sb-item">LF</span>
      </div>
    </div>
  )
}
