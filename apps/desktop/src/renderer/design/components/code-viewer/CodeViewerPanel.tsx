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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId, WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../Icons'
import { OPEN_CODE_SEARCH_EVENT } from '../../hooks/useKeyboard'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { FileTypeIcon } from '../FileDisplay'
import type { PreviewFileType } from '../FileDisplay'
import { FilePreviewPanel } from '../FilePreviewPanel'
import { useToast } from '../Toast'
import { CodeViewerEditor } from './CodeViewerEditor'
import { CodeViewerDiff } from './CodeViewerDiff'
import { CodeViewerToolbar } from './CodeViewerToolbar'
import { useCodeViewerFiles, CodeFileExternalChangeError } from './useCodeViewerFiles'
import { useGitDiff } from './useGitDiff'
import { FileExplorerPanel } from './file-explorer/FileExplorerPanel'
import { GitPanel } from './git-panel/GitPanel'
import { useGitPanelActions } from './git-panel/useGitPanelActions'
import {
  closeGitPanel,
  openGitPanel,
  setGitPanelWidth,
  toggleGitPanel,
  useGitPanelVisible,
  useGitPanelWidth,
} from './git-panel/gitPanelVisibility'
import { SidebarGitFooter, shouldShowSidebarGitFooter } from './SidebarGitFooter'
import { SearchPanel } from './search-panel/SearchPanel'
import { ToolbarTooltip } from './ToolbarTooltip'
import {
  closeSearchPanel,
  openSearchPanel,
  setSearchPanelWidth,
  toggleSearchPanel,
  useSearchPanelVisible,
  useSearchPanelWidth,
} from './search-panel/searchPanelVisibility'
import { getMonacoLanguage } from './codeLanguage'
import { resolveCodeSearchShortcut } from './codeSearchShortcut'
import {
  CODE_VIEWER_ZOOM_BOUNDS,
  diffFontSizeFor,
  editorFontSizeFor,
  editorLineHeightFor,
  resetCodeViewerZoom,
  stepCodeViewerZoom,
  useCodeViewerZoom,
} from './codeViewerZoom'
import {
  canPreviewInCodeViewer,
  canSplitPreviewInCodeViewer,
  isSvgFile,
  previewTypeInCodeViewer,
} from './previewSupport'
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
  sessionId?: SessionId | null
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
  onOpenFileFromGit?:
    | ((relativePath: string, commitHash?: string, changeType?: OpenCodeFile['changeType']) => void)
    | undefined
  // 工具栏「打开方式」的应用内预览入口（可选：不传则主按钮回落为用默认应用打开）
  onPreviewFileFromToolbar?: ((filePath: string, fileType: PreviewFileType) => void) | undefined
  // 工作区搜索面板（与文件树 / Git 面板互斥共用同一左侧栏槽位）
  onOpenFileFromSearch: (relativePath: string, lineNumber?: number) => void
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx >= 0 ? norm.slice(idx + 1) : p
}

/** 分屏实时预览防抖间隔（ms）：编辑停顿约 300ms 后把未保存内容同步到预览区 */
const CODE_PREVIEW_LIVE_DEBOUNCE_MS = 300
/** 分屏左栏（源码）占比的钳制范围与初始值：20% ~ 80%，初始各占一半 */
const SPLIT_RATIO_MIN = 0.2
const SPLIT_RATIO_MAX = 0.8
const SPLIT_RATIO_DEFAULT = 0.5

export function CodeViewerPanel({
  files,
  activeAbsPath,
  viewMode,
  onSelectActive,
  onCloseFile,
  onCloseFiles,
  onViewModeChange,
  workspaceId,
  sessionId,
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
  onPreviewFileFromToolbar,
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
  // 分屏比例（左栏源码占 cv-split 容器的宽度比）：组件本地态不持久化，拖拽钳制 20%~80%
  const [splitRatio, setSplitRatio] = useState(SPLIT_RATIO_DEFAULT)
  const splitRatioRef = useRef(SPLIT_RATIO_DEFAULT)
  // 实时预览直传快照：~300ms 防抖后的未保存内容（path 绑定文件，防切 tab 串台）
  const [livePreview, setLivePreview] = useState<{ path: string; content: string } | null>(null)
  // 预览刷新令牌：保存 / 重载成功后递增，驱动非直传预览（图片等）重读磁盘
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0)
  const zoom = useCodeViewerZoom()
  const editorFontSize = editorFontSizeFor(zoom)
  const editorLineHeight = editorLineHeightFor(editorFontSize)
  const diffFontSize = diffFontSizeFor(zoom)
  const resizeStateRef = useRef<{
    startWidth: number
    startX: number
    target: 'explorer' | 'git' | 'search'
  } | null>(null)

  // 左侧栏公用 foot（分支 + ahead/behind + 同步）的动作实例：挂在面板常驻层，
  // 面板切换 / 侧栏隐藏时同步动作不中断，结果照常经 onStatusApplied 回写共享快照。
  const gitSidebarActions = useGitPanelActions({
    workspaceId: workspaceId ?? null,
    onStatusApplied: onGitStatusApplied ?? (() => {}),
  })
  const gitSidebarSyncing =
    gitSidebarActions.busy === 'sync' ||
    gitSidebarActions.busy === 'pull' ||
    gitSidebarActions.busy === 'push'

  const active = files.find((f) => f.absPath === activeAbsPath) ?? null
  // 预览能力（纯扩展名判定，无 IO）：preview 整页 / split 分屏是否可用 + FilePreviewPanel 渲染类型
  const canPreview = active != null && canPreviewInCodeViewer(active.absPath)
  const canSplit = active != null && canSplitPreviewInCodeViewer(active.absPath)
  // 有无源码视图：纯文本/代码（不可预览）与双向文件（可编辑+可预览）有；
  // 只能看不能编的二进制富媒体（png/mp4/office 等）没有——工具栏「源码」段对其禁用
  const canShowSource = active != null && (!canPreview || canSplit)
  const activePreviewType = active != null ? previewTypeInCodeViewer(active.absPath) : null
  // 实时直传仅对「可编辑文本 + 文本渲染」类型有意义：markdown / html 原生支持 contentOverride；
  // svg 属 image 类型但为 XML 文本，走 FilePreviewPanel 的 data URL 直传分支；
  // csv 等 universal 类型（Flyfish Viewer 读磁盘 buffer）不支持直传，分屏右侧按磁盘内容渲染。
  const supportsLiveOverride =
    activePreviewType === 'markdown' ||
    activePreviewType === 'html' ||
    (activePreviewType === 'image' && active != null && isSvgFile(active.absPath))
  const diffInfo = useGitDiff(
    workspaceId ?? null,
    active?.displayPath,
    active?.changeType === 'create',
    viewMode === 'diff' && active != null,
    active?.gitCommitHash,
  )

  // ── 实时预览联动（markdown / html / svg） ──
  // 编辑器内容变化后 ~300ms 防抖，把未保存内容快照给预览区（contentOverride 直传）。
  // 仅在「脏」时直传：保存 / 撤销回到磁盘内容（content === savedContent）时自动回落磁盘渲染，
  // 避免打开文件瞬间出现一次「磁盘渲染 → 直传同内容」的无谓重载（html 会整帧重登沙箱文档）。
  const runtimeContent = activeRuntime?.content
  const runtimeSavedContent = activeRuntime?.savedContent
  const runtimeState = activeRuntime?.state
  useEffect(() => {
    if (!supportsLiveOverride || activeAbsPath == null) return
    if (
      runtimeState !== 'ready' ||
      runtimeContent == null ||
      runtimeContent === runtimeSavedContent
    ) {
      return
    }
    const path = activeAbsPath
    const content = runtimeContent
    const timer = window.setTimeout(() => {
      setLivePreview({ path, content })
    }, CODE_PREVIEW_LIVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [supportsLiveOverride, activeAbsPath, runtimeState, runtimeContent, runtimeSavedContent])

  // 直传内容生效条件：快照属于当前文件 && 仍与当前编辑内容一致 && 文件处于脏态；
  // 任一不满足即回落磁盘渲染（保存 / 撤销 / 切文件 / 只读 reload 均天然覆盖）
  const liveOverride =
    livePreview != null &&
    livePreview.path === activeAbsPath &&
    runtimeContent === livePreview.content &&
    runtimeContent !== runtimeSavedContent
      ? livePreview.content
      : undefined

  const handleSave = useCallback(async () => {
    if (activeAbsPath == null) return
    setSaving(true)
    try {
      await saveActive()
      toast.success('已保存')
      // 保存完成：递增刷新令牌，预览区（非直传类型）重读磁盘；直传类型此时已回落磁盘渲染
      setPreviewRefreshToken((t) => t + 1)
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

  // 冲突横幅的「用磁盘重载 / 覆盖保存」：成功后同样递增刷新令牌，预览区同步回落磁盘内容
  const handleReloadActive = useCallback(() => {
    void reloadActive().then(
      () => setPreviewRefreshToken((t) => t + 1),
      () => {},
    )
  }, [reloadActive])
  const handleForceSaveActive = useCallback(() => {
    void forceSaveActive().then(
      () => setPreviewRefreshToken((t) => t + 1),
      () => {},
    )
  }, [forceSaveActive])

  // 工具栏「刷新预览」：令牌自增，预览区双通道刷新 ——
  // key 重挂载重建图片/音视频/Office 等媒体元素并重读磁盘；
  // html 据令牌重新登记沙箱文档整页重载（未保存直传内容保持直传语义，刷新的是当前预览内容）。
  const handleRefreshPreview = useCallback(() => {
    setPreviewRefreshToken((t) => t + 1)
  }, [])

  // ── 分屏分隔条拖拽 ──
  // pointer capture 落在分隔条自身（capture 期间事件持续派发给它，Monaco 不会抢走），
  // 按容器实宽把位移换算为比例并钳制 20%~80%；拖动期间 body 加 cv-split-resizing
  // （col-resize 光标 + 禁止选中文本）。比例用 ref 镜像，move 闭包不读 state 防 stale。
  const handleSplitDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const divider = e.currentTarget
    const totalWidth = divider.parentElement?.getBoundingClientRect().width ?? 0
    if (totalWidth <= 0) return
    const startX = e.clientX
    const startRatio = splitRatioRef.current
    const onMove = (ev: PointerEvent): void => {
      const next = startRatio + (ev.clientX - startX) / totalWidth
      const clamped = Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, next))
      splitRatioRef.current = clamped
      setSplitRatio(clamped)
    }
    const onUp = (ev: PointerEvent): void => {
      if (divider.hasPointerCapture(ev.pointerId)) divider.releasePointerCapture(ev.pointerId)
      divider.removeEventListener('pointermove', onMove)
      divider.removeEventListener('pointerup', onUp)
      divider.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('cv-split-resizing')
    }
    try {
      divider.setPointerCapture(e.pointerId)
    } catch {
      return
    }
    document.body.classList.add('cv-split-resizing')
    divider.addEventListener('pointermove', onMove)
    divider.addEventListener('pointerup', onUp)
    divider.addEventListener('pointercancel', onUp)
  }, [])
  const handleSplitReset = useCallback(() => {
    splitRatioRef.current = SPLIT_RATIO_DEFAULT
    setSplitRatio(SPLIT_RATIO_DEFAULT)
  }, [])
  // 拖拽中途组件卸载时清理 body 上的全局拖动态类
  useEffect(
    () => () => {
      document.body.classList.remove('cv-split-resizing')
    },
    [],
  )

  // 代码面板内统一接管搜索快捷键（capture 早于 Monaco / 应用全局处理）：
  // Cmd/Ctrl+F = 内容搜索，Cmd/Ctrl+P = 文件搜索；三个左侧板块内行为一致。
  const handleSearchShortcut = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    const mode = resolveCodeSearchShortcut(event)
    if (mode == null) return

    event.preventDefault()
    event.stopPropagation()
    openSearchPanel(mode)
    // 面板首次挂载发生在 store 通知后的 render；下一宏任务再通知 SearchPanel 聚焦/全选。
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CODE_SEARCH_EVENT, { detail: { mode } }))
    }, 0)
  }, [])

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
    <div
      className="code-viewer-panel"
      data-cv-theme={theme}
      onKeyDownCapture={handleSearchShortcut}
    >
      <div className="cv-filetabs">
        <div className="cv-ftab-switch">
          <ToolbarTooltip label={explorerVisible ? '隐藏文件树' : '显示文件树'}>
            <button
              type="button"
              className={`cv-ftab-toggle${explorerVisible ? ' on' : ''}`}
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
              <span className="cv-ftab-toggle-text">文件</span>
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip
            label={gitPanelVisible ? '隐藏 Git 面板' : '显示 Git 面板（与文件树互斥）'}
          >
            <button
              type="button"
              className={`cv-ftab-toggle${gitPanelVisible ? ' on' : ''}`}
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
              <span className="cv-ftab-toggle-text">Git</span>
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip
            label={searchPanelVisible ? '隐藏搜索面板' : '搜索文件或代码内容（与文件树互斥）'}
          >
            <button
              type="button"
              className={`cv-ftab-toggle${searchPanelVisible ? ' on' : ''}`}
              onClick={() => {
                // openSearchPanel 内部会收起文件树与 Git 面板（左侧栏槽位互斥）
                if (searchPanelVisible) toggleSearchPanel(false)
                else openSearchPanel()
              }}
              disabled={workspaceId == null}
            >
              <Icons.Search size={14} />
              <span className="cv-ftab-toggle-text">搜索</span>
            </button>
          </ToolbarTooltip>
        </div>
        <div className="cv-filetabs-scroll">
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
        <div className="cv-zoom">
          <button
            type="button"
            className="cv-zoom-btn"
            aria-label="缩小"
            title="缩小（10%）"
            onClick={() => stepCodeViewerZoom(-10)}
            disabled={zoom <= CODE_VIEWER_ZOOM_BOUNDS.min}
          >
            <Icons.Minus size={13} />
          </button>
          <button
            type="button"
            className="cv-zoom-value"
            title="重置缩放"
            onClick={() => resetCodeViewerZoom()}
          >
            {zoom}%
          </button>
          <button
            type="button"
            className="cv-zoom-btn"
            aria-label="放大"
            title="放大（10%）"
            onClick={() => stepCodeViewerZoom(10)}
            disabled={zoom >= CODE_VIEWER_ZOOM_BOUNDS.max}
          >
            <Icons.Plus size={13} />
          </button>
        </div>
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
              <div className="cv-explorer-body">
                {explorerVisible ? (
                  // key 只含 workspaceId：同一项目下切会话不重挂载文件树，
                  // 展开/选中/滚动等内部状态保持一致（会话只影响 IPC 的 sessionId 入参）。
                  <FileExplorerPanel
                    key={workspaceId}
                    workspaceId={workspaceId}
                    sessionId={sessionId ?? null}
                    workspaceRootPath={workspaceRootPath ?? null}
                    expandedDirs={explorerExpandedDirs}
                    onExpandedChange={onExplorerExpandedChange}
                    onOpenFile={onOpenFileFromExplorer}
                    onPreviewFile={onPreviewFileFromExplorer}
                    onEditFile={onEditFileFromExplorer}
                    onAddToChat={onAddToChatFromExplorer}
                    onOpenSearch={() => openSearchPanel()}
                  />
                ) : searchPanelVisible ? (
                  // 同上：搜索面板按项目复用，切会话不重置查询/布局/结果滚动
                  <SearchPanel
                    key={workspaceId}
                    workspaceId={workspaceId}
                    sessionId={sessionId ?? null}
                    onOpenFile={onOpenFileFromSearch}
                  />
                ) : (
                  <GitPanel
                    workspaceId={workspaceId}
                    status={gitStatus ?? null}
                    onRefresh={onRefreshGitStatus ?? (() => {})}
                    onStatusApplied={onGitStatusApplied ?? (() => {})}
                    onOpenFile={onOpenFileFromGit ?? (() => {})}
                    onOpenHistoricalFile={onOpenFileFromGit}
                    workspaceRootPath={workspaceRootPath ?? null}
                    onAddToChat={onAddToChatFromExplorer}
                  />
                )}
              </div>
              {/* 公用 foot：分支 + 待同步数量 + 同步/发布按钮（三个左侧面板共用；非 Git 仓库隐藏） */}
              {shouldShowSidebarGitFooter(gitStatus ?? null) && (
                <SidebarGitFooter
                  status={gitStatus ?? null}
                  busy={gitSidebarSyncing}
                  onSync={() => void gitSidebarActions.sync()}
                  onPublish={() => void gitSidebarActions.push()}
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
        <span className="code-viewer-empty-icon">
          <Icons.FileText size={22} />
        </span>
        <div className="code-viewer-empty-text">在左侧选择一个文件开始查看或编辑</div>
        <div className="code-viewer-empty-hint">支持文件树、Git 变更与全局搜索三种入口</div>
      </div>,
    )
  }

  const readOnly = active.changeType === 'delete'
  const dirty = isDirty(active.absPath)
  const externalChanged = activeRuntime?.externalChanged === true

  // 源码区三态（loading / error / Monaco）：source 整页与 split 左栏共用同一渲染块
  const sourceArea = (
    <>
      {(activeRuntime == null ||
        activeRuntime.state === 'idle' ||
        activeRuntime.state === 'loading') && (
        <div className="code-viewer-loading">
          <Icons.Spinner size={18} className="cv-spin" /> 读取文件…
        </div>
      )}
      {activeRuntime?.state === 'error' && (
        <div className="code-viewer-error">
          <span className="code-viewer-error-icon">
            <Icons.AlertTriangle size={20} />
          </span>
          <div className="code-viewer-error-title">无法读取该文件</div>
          <div className="code-viewer-error-detail">{activeRuntime.error}</div>
        </div>
      )}
      {activeRuntime?.state === 'ready' && (
        <CodeViewerEditor
          filePath={active.absPath}
          content={activeRuntime.content}
          readOnly={readOnly}
          theme={theme}
          lineNumber={active.lineNumber}
          minimapEnabled={minimapEnabled}
          fontSize={editorFontSize}
          lineHeight={editorLineHeight}
          onContentChange={editActive}
          onSave={() => void handleSave()}
        />
      )}
    </>
  )

  // 内容区预览（embedded：填满宿主，无头部/关闭钮）：markdown / html / svg 实时直传未保存内容，
  // 图片 / 音视频 / Office 按磁盘内容渲染（保存后由 refreshToken 驱动刷新）。
  // key 绑定刷新令牌：手动刷新时整组件重挂载，媒体元素重建、磁盘内容重读、
  // html 沙箱文档重新登记（配合组件内 refreshToken 依赖双保险）。
  // onClose 为必填 prop，embedded 形态没有关闭语义，传 no-op；
  // workspaceRootPath 可选 prop 未声明 | undefined（exactOptionalPropertyTypes），
  // 用条件展开传值，与 FilePreviewPanel 内部 imageBasePath 的写法一致。
  const previewArea =
    activePreviewType != null ? (
      <FilePreviewPanel
        key={`fp-${previewRefreshToken}`}
        filePath={active.absPath}
        fileType={activePreviewType}
        variant="embedded"
        contentOverride={liveOverride}
        refreshToken={previewRefreshToken}
        {...(workspaceRootPath != null ? { workspaceRootPath } : {})}
        onClose={() => {}}
      />
    ) : null

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
        hasDiff={active.gitCommitHash != null || active.changeType !== 'delete'}
        canPreview={canPreview}
        canSplit={canSplit}
        canShowSource={canShowSource}
        minimapEnabled={minimapEnabled}
        onToggleMinimap={() => setMinimapEnabled((v) => !v)}
        onSave={() => void handleSave()}
        onRefreshPreview={handleRefreshPreview}
        onPreview={onPreviewFileFromToolbar}
      />

      {externalChanged && (
        <div className="cv-conflict-banner">
          <span className="cv-conflict-text">
            文件已被外部修改（如 agent 写入），继续保存将覆盖磁盘内容。
          </span>
          <div className="cv-conflict-actions">
            <button type="button" className="cv-mini-btn" onClick={handleReloadActive}>
              用磁盘重载
            </button>
            <button type="button" className="cv-mini-btn primary" onClick={handleForceSaveActive}>
              覆盖保存
            </button>
          </div>
        </div>
      )}

      <div className="cv-body">
        {viewMode === 'diff' ? (
          <CodeViewerDiff
            diff={diffInfo.diff}
            isBinary={diffInfo.isBinary}
            loading={diffInfo.loading}
            error={diffInfo.error}
            changeType={active.changeType}
            fontSize={diffFontSize}
          />
        ) : viewMode === 'preview' && previewArea != null ? (
          previewArea
        ) : viewMode === 'split' && canSplit && previewArea != null ? (
          <div className="cv-split">
            <div className="cv-split-editor" style={{ width: `${(splitRatio * 100).toFixed(2)}%` }}>
              {sourceArea}
            </div>
            <div
              className="cv-split-divider"
              role="separator"
              aria-orientation="vertical"
              title="拖拽调整分屏比例，双击复位"
              onPointerDown={handleSplitDragStart}
              onDoubleClick={handleSplitReset}
            />
            <div className="cv-split-preview">{previewArea}</div>
          </div>
        ) : (
          sourceArea
        )}
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
