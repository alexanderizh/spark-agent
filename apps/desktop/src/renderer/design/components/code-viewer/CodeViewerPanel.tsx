/**
 * CodeViewerPanel ——「代码」tab 内容容器。
 *
 * 布局：文件 tabs 行（含文件树开关 + 多文件切换/关闭/脏标）
 *       · cv-main-row 横向 = [FileExplorerPanel(条件) | 拖拽条 | cv-editor-column]
 *       · cv-editor-column 纵向 = 工具栏 · 冲突横幅 · 编辑器/diff 主体 · 状态栏
 * 作为 UnifiedSessionSidePanel 的 children 渲染，自身填满父容器（高度 100%）。
 *
 * 文件列表 / 激活文件 / 视图模式 / 文件树状态由 ChatView 受控传入（便于切会话快照存盘）；
 * 内容运行时态（读取/脏标/外部变更）由内部 useCodeViewerFiles 管理。
 */

import { Dropdown } from '@lobehub/ui'
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { FileTypeIcon } from '../FileDisplay'
import { useToast } from '../Toast'
import { CodeViewerEditor } from './CodeViewerEditor'
import { CodeViewerDiff } from './CodeViewerDiff'
import { CodeViewerToolbar } from './CodeViewerToolbar'
import { useCodeViewerFiles, CodeFileExternalChangeError } from './useCodeViewerFiles'
import { useGitDiff } from './useGitDiff'
import { FileExplorerPanel } from './file-explorer/FileExplorerPanel'
import { GitPanel } from './git-panel/GitPanel'
import {
  closeGitPanel,
  openGitPanel,
  setGitPanelWidth,
  toggleGitPanel,
  useGitPanelVisible,
  useGitPanelWidth,
} from './git-panel/gitPanelVisibility'
import { SearchPanel } from './search-panel/SearchPanel'
import {
  closeSearchPanel,
  openSearchPanel,
  setSearchPanelWidth,
  toggleSearchPanel,
  useSearchPanelVisible,
  useSearchPanelWidth,
} from './search-panel/searchPanelVisibility'
import { getMonacoLanguage } from './codeLanguage'
import type { OpenCodeFile, CodeViewMode } from './types'
import './index.less'

export interface CodeViewerPanelProps {
  files: OpenCodeFile[]
  activeAbsPath: string | null
  viewMode: CodeViewMode
  onSelectActive: (absPath: string) => void
  onCloseFile: (absPath: string) => void
  onCloseFiles: (absPaths: string[]) => void
  onViewModeChange: (mode: CodeViewMode) => void
  workspaceId?: string | null
  // 文件树（受控：visible/width 走全局 store，expandedDirs 走 per-session 快照）
  explorerVisible: boolean
  explorerWidth: number
  explorerExpandedDirs: Set<string>
  workspaceRootPath?: string | null
  onExplorerVisibleChange: (visible: boolean) => void
  onExplorerWidthChange: (width: number) => void
  onExplorerExpandedChange: (next: Set<string>) => void
  onOpenFileFromExplorer: (relativePath: string) => void
  // 文件树右键菜单的显式「预览 / 编辑」入口（可选：不传则菜单不显示对应项）
  onPreviewFileFromExplorer?: ((relativePath: string) => void) | undefined
  onEditFileFromExplorer?: ((relativePath: string) => void) | undefined
  // 文件树右键菜单「添加到对话」（可选：不传则菜单不显示对应项）
  onAddToChatFromExplorer?: ((relativePath: string) => void) | undefined
  // Git 面板（与文件树互斥共用同一左侧栏槽位；可见性走全局 store）
  gitStatus?: WorkspaceGitStatusResponse | null
  onGitStatusApplied?: ((status: WorkspaceGitStatusResponse | null) => void) | undefined
  onRefreshGitStatus?: (() => void) | undefined
  onOpenFileFromGit?: ((relativePath: string) => void) | undefined
  // 工作区搜索面板（与文件树 / Git 面板互斥共用同一左侧栏槽位）
  onOpenFileFromSearch: (relativePath: string, lineNumber?: number) => void
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
  onCloseFiles,
  onViewModeChange,
  workspaceId,
  explorerVisible,
  explorerWidth,
  explorerExpandedDirs,
  workspaceRootPath,
  onExplorerVisibleChange,
  onExplorerWidthChange,
  onExplorerExpandedChange,
  onOpenFileFromExplorer,
  onPreviewFileFromExplorer,
  onEditFileFromExplorer,
  onAddToChatFromExplorer,
  gitStatus,
  onGitStatusApplied,
  onRefreshGitStatus,
  onOpenFileFromGit,
  onOpenFileFromSearch,
}: CodeViewerPanelProps) {
  const resolvedTheme = useResolvedTheme()
  const theme: 'dark' | 'light' = resolvedTheme === 'light' ? 'light' : 'dark'
  const gitPanelVisible = useGitPanelVisible()
  const gitPanelWidth = useGitPanelWidth()
  const searchPanelVisible = useSearchPanelVisible()
  const searchPanelWidth = useSearchPanelWidth()
  const { activeRuntime, editActive, saveActive, reloadActive, forceSaveActive, isDirty } =
    useCodeViewerFiles(files, activeAbsPath)
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [minimapEnabled, setMinimapEnabled] = useState(false)
  const resizeStateRef = useRef<{
    startWidth: number
    startX: number
    target: 'explorer' | 'git' | 'search'
  } | null>(null)

  const active = files.find((f) => f.absPath === activeAbsPath) ?? null
  const diffInfo = useGitDiff(
    workspaceId ?? null,
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

  // 左侧栏宽度拖拽：按下时记录初始宽度 / x / 目标面板（文件树 / Git / 搜索面板，互斥下同时只有一个在用），
  // move 用 ref 计算（避免闭包 stale）
  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const target: 'explorer' | 'git' | 'search' = explorerVisible
        ? 'explorer'
        : searchPanelVisible
          ? 'search'
          : 'git'
      resizeStateRef.current = {
        startWidth:
          target === 'explorer'
            ? explorerWidth
            : target === 'search'
              ? searchPanelWidth
              : gitPanelWidth,
        startX: e.clientX,
        target,
      }
      const onMove = (ev: PointerEvent): void => {
        const st = resizeStateRef.current
        if (st == null) return
        const next = st.startWidth + (ev.clientX - st.startX)
        if (st.target === 'explorer') onExplorerWidthChange(next)
        else if (st.target === 'search') setSearchPanelWidth(next)
        else setGitPanelWidth(next)
      }
      const onUp = (): void => {
        resizeStateRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.classList.remove('cv-resizing')
      }
      document.body.classList.add('cv-resizing')
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [
      explorerVisible,
      explorerWidth,
      gitPanelWidth,
      searchPanelVisible,
      searchPanelWidth,
      onExplorerWidthChange,
    ],
  )

  // 统一外壳（empty / 有激活文件 共用）
  const renderLayout = (editorContent: ReactNode): ReactNode => (
    <div className="code-viewer-panel" data-cv-theme={theme}>
      <div className="cv-filetabs">
        <button
          type="button"
          className={`cv-ftab-toggle${explorerVisible ? ' on' : ''}`}
          title={explorerVisible ? '隐藏文件树' : '显示文件树'}
          onClick={() => {
            if (!explorerVisible) {
              closeGitPanel()
              closeSearchPanel()
            }
            onExplorerVisibleChange(!explorerVisible)
          }}
          disabled={workspaceId == null}
        >
          <Icons.FolderClosed size={14} />
        </button>
        <button
          type="button"
          className={`cv-ftab-toggle${gitPanelVisible ? ' on' : ''}`}
          title={gitPanelVisible ? '隐藏 Git 面板' : '显示 Git 面板（与文件树互斥）'}
          onClick={() => {
            // 打开必须同时收起文件树与搜索面板（左侧栏槽位互斥），否则面板被挡住不出现
            if (gitPanelVisible) toggleGitPanel(false)
            else {
              closeSearchPanel()
              openGitPanel()
            }
          }}
          disabled={workspaceId == null}
        >
          <Icons.GitBranch size={14} />
        </button>
        <button
          type="button"
          className={`cv-ftab-toggle${searchPanelVisible ? ' on' : ''}`}
          title={searchPanelVisible ? '隐藏搜索面板' : '搜索文件或代码内容（与文件树互斥）'}
          onClick={() => {
            // openSearchPanel 内部会收起文件树与 Git 面板（左侧栏槽位互斥）
            if (searchPanelVisible) toggleSearchPanel(false)
            else openSearchPanel()
          }}
          disabled={workspaceId == null}
        >
          <Icons.Search size={14} />
        </button>
        {files.map((f, idx) => {
          const fDirty = isDirty(f.absPath)
          const isActive = f.absPath === activeAbsPath
          // tab 右键菜单：关闭 / 关闭右侧 / 关闭左侧 / 关闭全部 / 关闭已保存
          const tabMenu = {
            items: [
              { key: 'close', label: '关闭', onClick: () => onCloseFiles([f.absPath]) },
              {
                key: 'closeRight',
                label: '关闭右侧',
                onClick: () => onCloseFiles(files.slice(idx + 1).map((x) => x.absPath)),
              },
              {
                key: 'closeLeft',
                label: '关闭左侧',
                onClick: () => onCloseFiles(files.slice(0, idx).map((x) => x.absPath)),
              },
              {
                key: 'closeAll',
                label: '关闭全部',
                onClick: () => onCloseFiles(files.map((x) => x.absPath)),
              },
              {
                key: 'closeSaved',
                label: '关闭已保存',
                onClick: () =>
                  onCloseFiles(files.filter((x) => !isDirty(x.absPath)).map((x) => x.absPath)),
              },
            ],
          }
          return (
            <Dropdown
              key={f.absPath}
              trigger={['contextMenu']}
              menu={tabMenu}
              placement="bottomLeft"
            >
              <div
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
            </Dropdown>
          )
        })}
      </div>
      <div className="cv-main-row">
        {workspaceId != null && (explorerVisible || gitPanelVisible || searchPanelVisible) ? (
          <>
            <div
              className="cv-explorer"
              style={{
                width: explorerVisible
                  ? explorerWidth
                  : searchPanelVisible
                    ? searchPanelWidth
                    : gitPanelWidth,
              }}
            >
              {explorerVisible ? (
                <FileExplorerPanel
                  workspaceId={workspaceId}
                  workspaceRootPath={workspaceRootPath ?? null}
                  expandedDirs={explorerExpandedDirs}
                  onExpandedChange={onExplorerExpandedChange}
                  onOpenFile={onOpenFileFromExplorer}
                  onPreviewFile={onPreviewFileFromExplorer}
                  onEditFile={onEditFileFromExplorer}
                  onAddToChat={onAddToChatFromExplorer}
                />
              ) : searchPanelVisible ? (
                <SearchPanel workspaceId={workspaceId} onOpenFile={onOpenFileFromSearch} />
              ) : (
                <GitPanel
                  workspaceId={workspaceId}
                  status={gitStatus ?? null}
                  onRefresh={onRefreshGitStatus ?? (() => {})}
                  onStatusApplied={onGitStatusApplied ?? (() => {})}
                  onOpenFile={onOpenFileFromGit ?? (() => {})}
                />
              )}
            </div>
            <div className="cv-explorer-resize" onPointerDown={handleResizeStart} />
          </>
        ) : null}
        <div className="cv-editor-column">{editorContent}</div>
      </div>
    </div>
  )

  if (active == null) {
    return renderLayout(
      <div className="code-viewer-empty">
        <div className="code-viewer-empty-icon">{'</>'}</div>
        <div className="code-viewer-empty-text">
          点击左侧文件树或会话中的代码文件，在此查看与编辑
        </div>
      </div>,
    )
  }

  const readOnly = active.changeType === 'delete'
  const dirty = isDirty(active.absPath)
  const externalChanged = activeRuntime?.externalChanged === true

  return renderLayout(
    <>
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
          <span className="cv-conflict-text">
            文件已被外部修改（如 agent 写入），继续保存将覆盖磁盘内容。
          </span>
          <div className="cv-conflict-actions">
            <button type="button" className="cv-mini-btn" onClick={() => void reloadActive()}>
              用磁盘重载
            </button>
            <button
              type="button"
              className="cv-mini-btn primary"
              onClick={() => void forceSaveActive()}
            >
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
        <span className={`cv-sb-item${dirty ? ' dirty' : ''}`}>
          {dirty ? '● 未保存' : '已保存'}
        </span>
        <span className="cv-sb-spacer" />
        <span className="cv-sb-item">{getMonacoLanguage(active.absPath)}</span>
        <span className="cv-sb-item">UTF-8</span>
        <span className="cv-sb-item">LF</span>
      </div>
    </>,
  )
}
