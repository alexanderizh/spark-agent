/**
 * 远程项目信息面板（工作区右侧栏）。
 *
 * 只读展示被控电脑上项目的 git 快照（分支 / 变更文件 + diff / 最近提交）、
 * 产物聚合、会话检查器与配置。数据层见 useRemoteProjectPanel；git 端点是
 * 2026-11 新增的 /v1/projects/:id/git 族，旧版目标端 404 → 面板渲染降级占位。
 * 2026-11-25 复审移除「会话」tab：会话列表与左侧栏完全重复，不再保留。
 *
 * 项目名直接读 remoteSessionStore 模块级缓存（左侧栏已在维护，
 * 面板不重复请求），git 快照与产物走本面板自己的 hook（30s 轮询 + 手动刷新）。
 */
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { WorkspaceGitCommitEntry, WorkspaceGitFileChange } from '@spark/protocol'
import { Icons } from '../../Icons'
import {
  getRemoteSessionStore,
  formatRelativeTime,
  subscribeRemoteSessionStore,
  UNASSIGNED_PROJECT_ID,
} from './remoteSessionStore'
import { RemoteFileCards } from './RemoteFileCards'
import type { RemoteAgentFileEntry } from './remoteEventMerge'
import { useRemoteProjectPanel } from './useRemoteProjectPanel'
import { useRemoteSessionTimelineSummary } from './useRemoteSessionTimelineSummary'
import { RemoteSessionInspector } from './RemoteSessionInspector'
import { RemoteSessionConfigPanel } from './RemoteSessionConfigPanel'
import { RemotePreviewTab } from './RemotePreviewTab'
import {
  filterProjectArtifacts,
  mergeSessionTimelineArtifacts,
  parseRemoteArtifactType,
  remoteFilePreviewPanelKind,
  remotePathOfPreviewPanelTab,
  REMOTE_PROJECT_PANEL_MAX_WIDTH,
  REMOTE_PROJECT_PANEL_MIN_WIDTH,
  type RemoteArtifactScope,
  type RemoteArtifactType,
  type RemoteProjectPanelTab,
} from './remoteProjectPanelState'

// ─── diff 拉取的上下文透传 ──────────────────────────────────────────────────────

interface RemoteProjectPanelContextValue {
  loadDiff: (filePath: string, untracked: boolean) => Promise<{ diff: string }>
}

const RemoteProjectPanelContext = createContext<RemoteProjectPanelContextValue | null>(null)

function useRemoteProjectPanelContext(): RemoteProjectPanelContextValue {
  const value = useContext(RemoteProjectPanelContext)
  if (value == null) throw new Error('ChangedFileRow 必须在 RemoteProjectPanel 树内使用')
  return value
}

// ─── 展示子组件 ────────────────────────────────────────────────────────────────

/** 变更文件最多渲染条数（--untracked-files=all 在误入 node_modules 的仓库能返回数千条） */
const RENDERED_FILES_LIMIT = 200

/** 变更文件的短状态徽标：git status 字母 → 一两个字（空壳兜底「M」） */
function fileStatusBadge(file: WorkspaceGitFileChange): string {
  const raw = file.status.trim()
  if (raw.length === 0) return file.untracked ? '?' : 'M'
  const code = raw[0]?.toUpperCase() ?? 'M'
  return ['A', 'D', 'R', 'C', '?'].includes(code) ? code : 'M'
}

const BADGE_CLASS: Record<string, string> = {
  A: 'is-add',
  D: 'is-del',
  M: 'is-mod',
  R: 'is-ren',
  C: 'is-ren',
  '?': 'is-untracked',
}

/** basename（路径分隔符兼容 win32 远端） */
function baseName(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index >= 0 ? filePath.slice(index + 1) : filePath
}

function ChangedFileRow({ file }: { file: WorkspaceGitFileChange }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const { loadDiff } = useRemoteProjectPanelContext()

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (diff != null || loading) return
    setLoading(true)
    setError(null)
    loadDiff(file.path, file.untracked)
      .then((response) => {
        setDiff(response.diff)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      })
  }

  const badge = fileStatusBadge(file)
  const name = baseName(file.path)
  const dir = file.path.slice(0, file.path.length - name.length)
  const isBinary = diff?.includes('Binary files') === true

  return (
    <div className={`rc-git-file${open ? ' is-open' : ''}`}>
      <button type="button" className="rc-git-file-row" onClick={toggle} aria-expanded={open}>
        <span className={`rc-git-file-badge ${BADGE_CLASS[badge] ?? 'is-mod'}`}>{badge}</span>
        <span className="rc-git-file-path" title={file.path}>
          {dir.length > 0 && <span className="rc-git-file-dir">{dir}</span>}
          <span className="rc-git-file-name">{name}</span>
        </span>
        <span className="rc-git-file-nums">
          {file.additions > 0 && <span className="is-add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="is-del">−{file.deletions}</span>}
        </span>
        <span className="rc-git-file-chevron">
          {open ? <Icons.ChevronDown size={11} /> : <Icons.ChevronRight size={11} />}
        </span>
      </button>
      {open && (
        <div className="rc-git-diff">
          {loading && <div className="rc-git-diff-hint">正在读取 diff…</div>}
          {error != null && <div className="rc-git-diff-error">{error}</div>}
          {!loading && error == null && isBinary && (
            <div className="rc-git-diff-hint">二进制文件，不支持文本 diff</div>
          )}
          {!loading && error == null && !isBinary && diff != null && (
            <pre className="rc-git-diff-text">{diff.length > 0 ? diff : '（无文本差异）'}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function CommitRow({ commit }: { commit: WorkspaceGitCommitEntry }) {
  return (
    <div className="rc-git-commit">
      <span className="rc-git-commit-hash" title={commit.hash}>
        {commit.shortHash}
      </span>
      <span
        className="rc-git-commit-subject"
        title={`${commit.subject}${commit.authorName.length > 0 ? ` · ${commit.authorName}` : ''}`}
      >
        {commit.subject}
      </span>
      {commit.unpushed && (
        <span className="rc-git-commit-unpushed" title="尚未推送到上游">
          未推送
        </span>
      )}
      <span className="rc-git-commit-time">{formatRelativeTime(commit.date)}</span>
    </div>
  )
}

// ─── 面板主体 ──────────────────────────────────────────────────────────────────

export interface RemoteProjectPanelProps {
  deviceId: string
  projectId: string
  sessionId: string | null
  sessionTitle: string | null
  /** 当前连接设备的展示名（检查器「会话信息」用） */
  deviceLabel: string
  activeTab: RemoteProjectPanelTab
  width: number
  onResize: (width: number, commit: boolean) => void
  onTabChange: (tab: RemoteProjectPanelTab) => void
  onClose: () => void
}

export function RemoteProjectPanel({
  deviceId,
  projectId,
  sessionId,
  sessionTitle,
  deviceLabel,
  activeTab,
  width,
  onResize,
  onTabChange,
  onClose,
}: RemoteProjectPanelProps) {
  const [artifactScope, setArtifactScope] = useState<RemoteArtifactScope>('session')
  const [artifactType, setArtifactType] = useState<RemoteArtifactType>('all')
  const [resizing, setResizing] = useState(false)
  const resizeStartRef = useRef<{
    pointerId: number
    clientX: number
    width: number
    currentWidth: number
  } | null>(null)

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      width,
      currentWidth: width,
    }
    setResizing(true)
  }

  const handleResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current
    if (start == null || event.pointerId !== start.pointerId) return
    const nextWidth = start.width + start.clientX - event.clientX
    start.currentWidth = nextWidth
    onResize(nextWidth, false)
  }

  const handleResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current
    if (start == null || event.pointerId !== start.pointerId) return
    resizeStartRef.current = null
    setResizing(false)
    const finalWidth =
      event.type === 'pointerup' ? start.width + start.clientX - event.clientX : start.currentWidth
    onResize(finalWidth, true)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
    if (delta === 0) return
    event.preventDefault()
    onResize(width + delta, true)
  }
  // 左侧栏维护的项目/会话缓存：订阅版本号驱动重渲染，面板自己不发列表请求
  const storeVersion = useSyncExternalStore(
    subscribeRemoteSessionStore,
    () => getRemoteSessionStore(deviceId).version,
    () => 0,
  )
  const store = getRemoteSessionStore(deviceId)
  const {
    snapshot,
    loading,
    refreshing,
    error,
    unsupported,
    artifactsError,
    artifactsUnsupported,
    refresh,
    loadDiff,
  } = useRemoteProjectPanel(deviceId, projectId)
  // 当前会话时间线摘要（事件流订阅）：产物即时并入 + 检查器工具统计的数据源
  const timelineSummary = useRemoteSessionTimelineSummary(deviceId, sessionId)

  const project = useMemo(
    () => store.projects.find((item) => item.id === projectId) ?? null,
    // store 是可变单例，version 变化才需要重查（渲染期读最新字段）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeVersion, projectId],
  )
  const projectName =
    project?.name || (projectId === UNASSIGNED_PROJECT_ID ? '未归属会话' : '未命名项目')
  const rootPath = snapshot.git?.rootPath || project?.rootPath || ''

  // REST 聚合 + 当前会话时间线（presented_files 事件）按路径去重合并：
  // 聊天里刚出现的文件卡片即时进面板，不等 30s 轮询（2026-11-25）
  const mergedArtifacts = useMemo(
    () =>
      mergeSessionTimelineArtifacts(
        snapshot.artifacts?.artifacts ?? [],
        timelineSummary.files,
        sessionId,
      ),
    [sessionId, snapshot.artifacts, timelineSummary.files],
  )
  const filteredArtifacts = useMemo(
    () => filterProjectArtifacts(mergedArtifacts, sessionId, artifactScope, artifactType),
    [artifactScope, artifactType, mergedArtifacts, sessionId],
  )
  const artifactEntries = useMemo<RemoteAgentFileEntry[]>(
    () =>
      filteredArtifacts.map((item) => ({
        path: item.path,
        ...(item.title != null ? { title: item.title } : {}),
      })),
    [filteredArtifacts],
  )
  const artifactMetaByPath = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of filteredArtifacts) {
      map.set(item.path, `${item.sessionTitle} · ${formatRelativeTime(item.presentedAt)}`)
    }
    return map
  }, [filteredArtifacts])

  const git = snapshot.git
  const gitReady = git?.status.state.kind === 'ready'
  const files = git?.status.files ?? []
  const commits = git?.recentCommits ?? []
  // 动态预览 tab：activeTab 为 preview:<远程路径> 时渲染取回渲染区
  const previewPath = remotePathOfPreviewPanelTab(activeTab)

  const panelBody: ReactNode = (
    <>
      {activeTab === 'project' && rootPath.length > 0 && (
        <div className="rc-panel-rootpath" title={rootPath}>
          {/* 内层 span 命中 less 的 bidi 纠偏规则：容器 rtl 截头留尾，文本本体保持 ltr */}
          <span>{rootPath}</span>
        </div>
      )}

      {activeTab === 'project' && unsupported && (
        <div className="rc-panel-placeholder">
          <Icons.GitBranch size={20} />
          <p>这台电脑的 SparkWork 版本较旧，还不支持项目信息面板。</p>
          <p className="rc-panel-placeholder-sub">升级对方的桌面端后即可查看 git 与产物信息。</p>
        </div>
      )}

      {!unsupported && error != null && (
        <div className="rc-pane-hint error">
          {error}
          <button type="button" className="rc-link-btn" onClick={refresh}>
            重试
          </button>
        </div>
      )}

      {!unsupported && loading && git == null && (
        <div className="rc-pane-hint">正在读取项目信息…</div>
      )}

      {activeTab === 'project' && !unsupported && !loading && git != null && !gitReady && (
        <div className="rc-panel-placeholder">
          <Icons.GitBranch size={20} />
          {git.status.state.kind === 'not_repository' ? (
            rootPath.length === 0 ? (
              <p>该项目未关联本地目录，没有可展示的 git 信息。</p>
            ) : (
              <p>这个目录不是 git 仓库，无法展示分支与变更。</p>
            )
          ) : (
            <p>{'message' in git.status.state ? git.status.state.message : 'git 状态不可用'}</p>
          )}
        </div>
      )}

      {activeTab === 'project' && !unsupported && gitReady && git != null && (
        <>
          <div className="rc-git-overview">
            <span className="rc-git-branch" title="当前分支">
              <Icons.GitBranch size={12} />
              {git.status.currentBranch ?? '（无分支）'}
            </span>
            {git.status.ahead > 0 && (
              <span className="rc-git-ahead" title={`领先远端 ${git.status.ahead} 个提交`}>
                ↑{git.status.ahead}
              </span>
            )}
            {git.status.behind > 0 && (
              <span className="rc-git-behind" title={`落后远端 ${git.status.behind} 个提交`}>
                ↓{git.status.behind}
              </span>
            )}
            <span className="rc-git-nums">
              <span className="is-add">+{git.status.additions}</span>
              <span className="is-del">−{git.status.deletions}</span>
            </span>
            {git.status.stashEntries.length > 0 && (
              <span className="rc-git-stash" title={`${git.status.stashEntries.length} 个 stash`}>
                stash {git.status.stashEntries.length}
              </span>
            )}
          </div>

          <div className="rc-panel-section">
            <div className="rc-panel-section-head">
              <span>变更文件</span>
              <span className="rc-panel-section-count">{git.status.changedFiles}</span>
            </div>
            {files.length === 0 ? (
              <div className="rc-panel-empty">工作区是干净的，没有未提交变更</div>
            ) : (
              <>
                <div className="rc-git-files">
                  {files.slice(0, RENDERED_FILES_LIMIT).map((file) => (
                    <ChangedFileRow key={`${file.path}\u0000${file.status}`} file={file} />
                  ))}
                </div>
                {files.length > RENDERED_FILES_LIMIT && (
                  <div className="rc-panel-hint-note">
                    还有 {files.length - RENDERED_FILES_LIMIT} 个变更未显示
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rc-panel-section">
            <div className="rc-panel-section-head">
              <span>最近提交</span>
              <span className="rc-panel-section-count">{commits.length}</span>
            </div>
            {commits.length === 0 ? (
              <div className="rc-panel-empty">还没有提交记录</div>
            ) : (
              <div className="rc-git-commits">
                {commits.map((commit) => (
                  <CommitRow key={commit.hash} commit={commit} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'artifacts' && (
        <div className="rc-panel-section">
          <div className="rc-panel-section-head">
            <span>产物</span>
            <span className="rc-panel-section-count">{artifactEntries.length}</span>
          </div>
          <div className="rc-artifact-controls">
            <div className="rc-artifact-scope" role="group" aria-label="产物范围">
              <button
                type="button"
                aria-pressed={artifactScope === 'session'}
                onClick={() => setArtifactScope('session')}
              >
                当前会话
              </button>
              <button
                type="button"
                aria-pressed={artifactScope === 'project'}
                onClick={() => setArtifactScope('project')}
              >
                项目近期
              </button>
            </div>
            <select
              className="rc-artifact-type-filter"
              aria-label="按文件类型筛选"
              value={artifactType}
              onChange={(event) =>
                setArtifactType(parseRemoteArtifactType(event.currentTarget.value))
              }
            >
              <option value="all">全部类型</option>
              <option value="image">图片</option>
              <option value="document">文档</option>
              <option value="text">文本</option>
              <option value="code">代码</option>
              <option value="other">其他</option>
            </select>
          </div>
          {artifactScope === 'project' && (
            <div className="rc-panel-hint-note">按最近 20 个会话汇总</div>
          )}
          {artifactsUnsupported && (
            <div className="rc-panel-placeholder">
              <Icons.Package size={20} />
              <p>这台电脑的 SparkWork 版本较旧，暂无法读取产物。</p>
            </div>
          )}
          {!artifactsUnsupported && artifactsError != null && (
            <div className="rc-pane-hint error">
              产物读取失败：{artifactsError}
              <button type="button" className="rc-link-btn" onClick={refresh}>
                重试
              </button>
            </div>
          )}
          {!artifactsUnsupported && artifactEntries.length === 0 && artifactsError == null ? (
            <div className="rc-panel-empty">
              {artifactScope === 'session' && sessionId == null
                ? '先选择一个会话，或查看项目近期产物'
                : '没有符合筛选条件的产物'}
            </div>
          ) : (
            !artifactsUnsupported && (
              <RemoteFileCards
                deviceId={deviceId}
                files={artifactEntries}
                onOpenPreview={(file) => onTabChange(remoteFilePreviewPanelKind(file.path))}
                meta={(file) => {
                  const meta = artifactMetaByPath.get(file.path)
                  return meta != null ? <span className="rc-file-meta-text">{meta}</span> : null
                }}
              />
            )
          )}
          {(snapshot.artifacts?.truncated ?? false) && (
            <div className="rc-panel-hint-note">产物较多，仅显示最近一部分</div>
          )}
        </div>
      )}

      {activeTab === 'inspector' && (
        <RemoteSessionInspector
          deviceId={deviceId}
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          projectName={projectName}
          rootPath={rootPath}
          deviceLabel={deviceLabel}
          summary={timelineSummary}
          artifacts={mergedArtifacts}
          onOpenPreview={(filePath) => onTabChange(remoteFilePreviewPanelKind(filePath))}
        />
      )}

      {activeTab === 'config' && (
        <RemoteSessionConfigPanel deviceId={deviceId} sessionId={sessionId} />
      )}

      {previewPath != null && (
        <RemotePreviewTab
          deviceId={deviceId}
          remotePath={previewPath}
          onClose={() => onTabChange('artifacts')}
        />
      )}
    </>
  )

  return (
    <aside
      className={`rc-project-panel${resizing ? ' is-resizing' : ''}`}
      style={{ width }}
      aria-label="项目侧栏"
    >
      <div
        className="rc-project-panel-resizer"
        role="separator"
        aria-label="调整右侧面板宽度"
        aria-orientation="vertical"
        aria-valuemin={REMOTE_PROJECT_PANEL_MIN_WIDTH}
        aria-valuemax={REMOTE_PROJECT_PANEL_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onKeyDown={handleResizeKeyDown}
      />
      <div className="rc-panel-head">
        <span className="rc-panel-title">
          <Icons.Folder size={13} />
          <span className="rc-panel-name" title={rootPath.length > 0 ? rootPath : projectName}>
            {projectName}
          </span>
        </span>
        <div className="rc-panel-head-actions">
          <button
            type="button"
            className={`rc-icon-btn${refreshing ? ' is-spinning' : ''}`}
            onClick={refresh}
            disabled={refreshing || unsupported}
            title={refreshing ? '正在刷新…' : '刷新'}
            aria-label="刷新项目信息"
          >
            <Icons.Refresh size={13} />
          </button>
          <button
            type="button"
            className="rc-icon-btn"
            onClick={onClose}
            title="关闭面板"
            aria-label="关闭项目信息面板"
          >
            <Icons.X size={13} />
          </button>
        </div>
      </div>

      <div className="rc-panel-tabs" role="tablist" aria-label="项目侧栏视图">
        {(
          [
            ['project', '项目'],
            ['artifacts', '产物'],
            ['inspector', '检查器'],
            ['config', '配置'],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`rc-panel-tab-${tab}`}
            aria-controls="rc-panel-content"
            aria-selected={activeTab === tab}
            onClick={() => onTabChange(tab)}
          >
            {label}
          </button>
        ))}
        {previewPath != null && (
          <button
            type="button"
            role="tab"
            id="rc-panel-tab-preview"
            aria-controls="rc-panel-content"
            aria-selected
            title={previewPath}
            onClick={() => onTabChange(activeTab)}
          >
            预览
          </button>
        )}
      </div>

      <div
        className="rc-panel-scroll"
        id="rc-panel-content"
        role="tabpanel"
        aria-labelledby={`rc-panel-tab-${activeTab}`}
      >
        <RemoteProjectPanelContext.Provider value={{ loadDiff }}>
          {panelBody}
        </RemoteProjectPanelContext.Provider>
      </div>
    </aside>
  )
}
