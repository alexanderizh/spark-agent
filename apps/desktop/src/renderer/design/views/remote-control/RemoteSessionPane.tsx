/**
 * 远程会话侧栏：项目 → 会话 的折叠层级。
 *
 * 项目行只用项目列表里的 sessionCount / runningSessionCount 渲染角标，
 * 点开某个项目才去拉它的会话，避免一进视图就把全部会话（带 preview）拖下来。
 *
 * 会话与项目都支持管理动作（右键或行尾「…」）：重命名 / 置顶 / 打标 / 删除 /
 * 新建会话。写接口就是目标端的 /v1 语义路由，动作实现见 remoteSessionActions。
 */
import { useCallback, useState } from 'react'
import type { MobileBridgeSessionSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { ContextMenu } from '../../components/ContextMenu'
import type { ContextMenuEntry } from '../../components/contextMenuModel'
import {
  UNASSIGNED_PROJECT_ID,
  buildProjectRows,
  filterSessions,
  formatRelativeTime,
  groupSessionsByProject,
  type RemoteProjectRow,
  type RemoteSessionBucket,
} from './remoteSessionStore'
import {
  REMOTE_SESSION_LABELS,
  sessionLabelText,
  useRemoteSessionActions,
} from './remoteSessionActions'
import { useRemoteSessionTree } from './useRemoteSessionTree'

export interface RemoteSessionPaneProps {
  deviceId: string
  deviceName: string
  /** 有备注名时的设备自报名（副标题展示，避免忘记改的是哪台） */
  deviceRealName?: string | null
  /** 改备注名入口（桌面端在设备行右侧给一个铅笔按钮） */
  onRenameDevice?: () => void
  /** 备注名保存中：按钮转 spinner */
  renamingDevice?: boolean
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onSwitchDevice: () => void
  canSwitchDevice: boolean
  /** 会话或其所属项目被删除后，让右侧对话区回到空态 */
  onClearSession?: () => void
}

type MenuState =
  | { kind: 'session'; x: number; y: number; session: MobileBridgeSessionSummary }
  | { kind: 'label'; x: number; y: number; session: MobileBridgeSessionSummary }
  | { kind: 'project'; x: number; y: number; row: RemoteProjectRow }
  | null

function SessionItem({
  session,
  active,
  busy,
  onSelect,
  onMenu,
}: {
  session: MobileBridgeSessionSummary
  active: boolean
  busy: boolean
  onSelect: (session: MobileBridgeSessionSummary) => void
  onMenu: (x: number, y: number, session: MobileBridgeSessionSummary) => void
}) {
  const label = sessionLabelText(session.sessionLabel)
  const title = session.title || '未命名会话'

  return (
    <div className={`rc-session-item${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className="rc-session-row"
        onClick={() => onSelect(session)}
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu(event.clientX, event.clientY, session)
        }}
        title={session.preview || title}
      >
        <span className="rc-session-line">
          {session.pinnedAt != null && (
            <span className="rc-session-pin" aria-label="已置顶">
              <Icons.Pin size={10} />
            </span>
          )}
          <span className="rc-session-title">{title}</span>
        </span>
        <span className="rc-session-meta">
          {session.status === 'running' ? (
            <span className="rc-running">
              <span className="rc-running-dot" />
              运行中
            </span>
          ) : (
            <span className="rc-session-time">{formatRelativeTime(session.updatedAt)}</span>
          )}
          {label != null && <span className="rc-label">{label}</span>}
        </span>
      </button>
      <button
        type="button"
        className="rc-session-more"
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu(rect.right - 6, rect.bottom + 2, session)
        }}
        title="会话操作"
        aria-label={`${title} 的操作`}
      >
        {busy ? <Icons.Spinner size={12} className="spin" /> : <Icons.More size={13} />}
      </button>
    </div>
  )
}

function ProjectSessions({
  bucket,
  loading,
  selectedSessionId,
  busyId,
  onSelectSession,
  onMenuSession,
}: {
  bucket: RemoteSessionBucket | null
  loading: boolean
  selectedSessionId: string | null
  busyId: string | null
  onSelectSession: (session: MobileBridgeSessionSummary) => void
  onMenuSession: (x: number, y: number, session: MobileBridgeSessionSummary) => void
}) {
  if (bucket == null) {
    return <div className="rc-project-hint">{loading ? '读取会话…' : '展开以加载会话'}</div>
  }
  if (bucket.rows.length === 0) {
    return <div className="rc-project-hint">这个项目下还没有会话</div>
  }
  return (
    <>
      {bucket.rows.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          active={session.id === selectedSessionId}
          busy={busyId === session.id}
          onSelect={onSelectSession}
          onMenu={onMenuSession}
        />
      ))}
      {bucket.total > bucket.rows.length && (
        <div className="rc-project-hint">
          仅显示最近 {bucket.rows.length} 个 · 共 {bucket.total} 个
        </div>
      )}
    </>
  )
}

export function RemoteSessionPane({
  deviceId,
  deviceName,
  deviceRealName,
  onRenameDevice,
  renamingDevice,
  selectedSessionId,
  onSelectSession,
  onSwitchDevice,
  canSwitchDevice,
  onClearSession,
}: RemoteSessionPaneProps) {
  const tree = useRemoteSessionTree(deviceId)
  const actions = useRemoteSessionActions(deviceId)
  const { store, keyword, setKeyword, searching } = tree
  const [menu, setMenu] = useState<MenuState>(null)

  const unassignedInSearch = (store.allSessions?.rows ?? []).some(
    (row) => (row.projectId ?? UNASSIGNED_PROJECT_ID) === UNASSIGNED_PROJECT_ID,
  )
  const projectRows = buildProjectRows(
    store.projects,
    store.unassignedRunning,
    // 目标端只透出未归属的「运行中」数量：没有运行时默认不显示，
    // 除非已展开过 / 项目列表为空（只剩未归属）/ 搜索结果里命中了它
    store.unassignedRunning > 0 ||
      store.sessions[UNASSIGNED_PROJECT_ID] != null ||
      store.projects.length === 0 ||
      unassignedInSearch,
  )

  const searchGroups = searching
    ? groupSessionsByProject(filterSessions(store.allSessions?.rows ?? [], keyword), store.projects)
    : []
  const searchHits = searchGroups.reduce((sum, group) => sum + group.sessions.length, 0)

  const handleSelect = useCallback(
    (session: MobileBridgeSessionSummary) => {
      // 选中会话所在项目保持展开：切走再回来还看得到上下文
      const projectId = session.projectId ?? UNASSIGNED_PROJECT_ID
      tree.expandProject(projectId)
      onSelectSession(session.id)
    },
    [onSelectSession, tree],
  )

  const openSessionMenu = useCallback(
    (x: number, y: number, session: MobileBridgeSessionSummary) => {
      setMenu({ kind: 'session', x, y, session })
    },
    [],
  )

  /** 新建：落在选中会话所属项目；没有选中就落当前展开的第一个项目；都没有才落未归属 */
  const handleCreate = useCallback(
    async (projectId: string) => {
      tree.expandProject(projectId)
      const created = await actions.createSession(projectId)
      if (created != null) onSelectSession(created)
    },
    [actions, onSelectSession, tree],
  )

  const createIntoSelected = useCallback(() => {
    const owner =
      selectedSessionId == null
        ? undefined
        : Object.entries(store.sessions).find(([, bucket]) =>
            bucket.rows.some((row) => row.id === selectedSessionId),
          )
    const expandedProject = Object.keys(store.expanded).find((id) => store.expanded[id] === true)
    const target = owner?.[0] ?? expandedProject ?? UNASSIGNED_PROJECT_ID
    void handleCreate(target)
  }, [handleCreate, selectedSessionId, store.expanded, store.sessions])

  const projectPinned = useCallback(
    (projectId: string) =>
      store.projects.find((project) => project.id === projectId)?.pinnedAt != null,
    [store.projects],
  )

  const menuItems: ContextMenuEntry[] =
    menu == null
      ? []
      : menu.kind === 'session'
        ? [
            {
              key: 'rename',
              label: '重命名',
              icon: <Icons.Pencil size={13} />,
              onClick: () => void actions.renameSession(menu.session),
            },
            {
              key: 'pin',
              label: menu.session.pinnedAt == null ? '置顶' : '取消置顶',
              icon: <Icons.Pin size={13} />,
              onClick: () => void actions.toggleSessionPin(menu.session),
            },
            {
              key: 'label',
              label: '设置标记',
              icon: <Icons.Tag size={13} />,
              onClick: () =>
                setMenu({ kind: 'label', x: menu.x, y: menu.y, session: menu.session }),
            },
            { type: 'divider' },
            {
              key: 'delete',
              label: '删除会话',
              icon: <Icons.Trash size={13} />,
              danger: true,
              onClick: () => {
                const target = menu.session
                void actions.deleteSession(target).then((deleted) => {
                  if (deleted && target.id === selectedSessionId) onClearSession?.()
                })
              },
            },
          ]
        : menu.kind === 'label'
          ? [
              ...REMOTE_SESSION_LABELS.map<ContextMenuEntry>((meta) => ({
                key: meta.key,
                label: meta.label,
                icon:
                  menu.session.sessionLabel === meta.key ? (
                    <Icons.Check size={13} />
                  ) : (
                    <span className="rc-menu-dot" />
                  ),
                onClick: () => void actions.setSessionLabel(menu.session, meta.key),
              })),
              { type: 'divider' },
              {
                key: 'clear',
                label: '清除标记',
                icon: <Icons.X size={13} />,
                disabled: menu.session.sessionLabel == null,
                onClick: () => void actions.setSessionLabel(menu.session, null),
              },
            ]
          : [
              {
                key: 'new-session',
                label: '在此项目新建会话',
                icon: <Icons.MessageSquarePlus size={13} />,
                onClick: () => void handleCreate(menu.row.id),
              },
              { type: 'divider' },
              {
                key: 'rename',
                label: '重命名项目',
                icon: <Icons.Pencil size={13} />,
                disabled: menu.row.kind === 'unassigned',
                onClick: () => void actions.renameProject(menu.row),
              },
              {
                key: 'pin',
                label: projectPinned(menu.row.id) ? '取消置顶项目' : '置顶项目',
                icon: <Icons.Pin size={13} />,
                disabled: menu.row.kind === 'unassigned',
                onClick: () =>
                  void actions.toggleProjectPin(menu.row.id, !projectPinned(menu.row.id)),
              },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除项目',
                icon: <Icons.Trash size={13} />,
                danger: true,
                disabled: menu.row.kind === 'unassigned',
                onClick: () => {
                  const target = menu.row
                  const ownsSelected =
                    selectedSessionId != null &&
                    (store.sessions[target.id]?.rows ?? []).some(
                      (row) => row.id === selectedSessionId,
                    )
                  void actions.deleteProject(target).then((deleted) => {
                    if (deleted && ownsSelected) onClearSession?.()
                  })
                },
              },
            ]

  return (
    <aside className="rc-session-pane">
      <div className="rc-pane-head">
        <div className="rc-pane-device">
          <span className={`rc-pane-dot${canSwitchDevice ? '' : ' single'}`} />
          <span
            className="rc-pane-device-name"
            title={
              deviceRealName != null ? `${deviceName}（原设备名：${deviceRealName}）` : deviceName
            }
          >
            {deviceName}
          </span>
          {deviceRealName != null && <span className="rc-pane-device-real">{deviceRealName}</span>}
          {onRenameDevice != null && (
            <button
              type="button"
              className="rc-pane-device-rename"
              onClick={onRenameDevice}
              disabled={renamingDevice}
              title="修改设备备注名"
              aria-label="修改设备备注名"
            >
              {renamingDevice ? (
                <Icons.Spinner size={10} className="spin" />
              ) : (
                <Icons.Pencil size={10} />
              )}
            </button>
          )}
        </div>
        <div className="rc-pane-head-actions">
          <button
            type="button"
            className="rc-icon-btn"
            onClick={createIntoSelected}
            disabled={actions.busyId != null}
            title="新建会话"
            aria-label="新建会话"
          >
            <Icons.MessageSquarePlus size={13} />
          </button>
          <button
            type="button"
            className={`rc-icon-btn${tree.refreshing ? ' is-spinning' : ''}`}
            onClick={() => void tree.refresh()}
            disabled={tree.refreshing}
            title={tree.refreshing ? '正在刷新…' : '刷新列表'}
            aria-label="刷新列表"
          >
            <Icons.Refresh size={13} />
          </button>
          {canSwitchDevice && (
            <button
              type="button"
              className="rc-icon-btn"
              onClick={onSwitchDevice}
              title="切换电脑"
              aria-label="切换电脑"
            >
              <Icons.Monitor size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="rc-search-box">
        <Icons.Search size={13} />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索远程会话"
          aria-label="搜索远程会话"
        />
        {keyword.length > 0 && (
          <button
            type="button"
            className="rc-search-clear"
            onClick={() => setKeyword('')}
            aria-label="清空搜索"
          >
            <Icons.X size={11} />
          </button>
        )}
      </div>

      <div className="rc-session-scroll">
        {tree.error != null && (
          <div className="rc-pane-hint error">
            {tree.error}
            <button type="button" className="rc-link-btn" onClick={() => void tree.refresh()}>
              重试
            </button>
          </div>
        )}

        {tree.error == null && !store.projectsLoaded && (
          <div className="rc-pane-hint">正在读取远程项目…</div>
        )}

        {tree.error == null && store.projectsLoaded && searching && (
          <>
            <div className="rc-group-head">
              <span className="rc-group-name">搜索结果</span>
              <span className="rc-group-count">{searchHits}</span>
            </div>
            {store.allSessions == null && <div className="rc-project-hint">正在搜索全部会话…</div>}
            {store.allSessions != null && searchHits === 0 && (
              <div className="rc-pane-hint">没有匹配的会话</div>
            )}
            {searchGroups.map((group) => (
              <div key={group.projectId} className="rc-project is-open">
                <div className="rc-project-head is-static">
                  <span className="rc-project-icon">
                    <Icons.Folder size={13} />
                  </span>
                  <span className="rc-project-name">{group.name}</span>
                  <span className="rc-project-count">{group.sessions.length}</span>
                </div>
                <div className="rc-project-body">
                  {group.sessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === selectedSessionId}
                      busy={actions.busyId === session.id}
                      onSelect={handleSelect}
                      onMenu={openSessionMenu}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {tree.error == null && store.projectsLoaded && !searching && (
          <>
            {projectRows.length === 0 ? (
              <div className="rc-pane-hint">这台电脑上还没有会话</div>
            ) : (
              projectRows.map((row) => {
                const open = store.expanded[row.id] === true
                const pinned = projectPinned(row.id)
                return (
                  <div key={row.id} className={`rc-project${open ? ' is-open' : ''}`}>
                    {/*
                     * 项目行原本是一个 <button>，但「在此项目新建会话」也必须能点，
                     * 按钮不能套按钮，所以拆成 line 容器 + 行内两个并列按钮：
                     * 整行仍是展开/收起的热区，行尾 + 只在 hover/展开时浮现。
                     */}
                    <div className="rc-project-line">
                      <button
                        type="button"
                        className="rc-project-head"
                        onClick={() => tree.toggleProject(row.id)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setMenu({
                            kind: 'project',
                            x: event.clientX,
                            y: event.clientY,
                            row,
                          })
                        }}
                        aria-expanded={open}
                        title={row.name}
                      >
                        <span className="rc-project-chevron">
                          {open ? (
                            <Icons.ChevronDown size={12} />
                          ) : (
                            <Icons.ChevronRight size={12} />
                          )}
                        </span>
                        <span
                          className={`rc-project-icon${row.kind === 'unassigned' ? ' is-unassigned' : ''}`}
                        >
                          {row.kind === 'unassigned' ? (
                            <Icons.FolderX size={13} />
                          ) : (
                            <Icons.Folder size={13} />
                          )}
                        </span>
                        <span className="rc-project-name">{row.name}</span>
                        {pinned && (
                          <span className="rc-project-pin">
                            <Icons.Pin size={10} />
                          </span>
                        )}
                        {row.runningCount > 0 && (
                          <span
                            className="rc-project-running"
                            title={`${row.runningCount} 个会话运行中`}
                          >
                            <span className="rc-running-dot" />
                            {row.runningCount}
                          </span>
                        )}
                        <span className="rc-project-count">
                          {tree.pending[row.id] === true || actions.busyId === row.id ? (
                            <Icons.Spinner size={10} className="spin" />
                          ) : row.sessionCount > 0 ? (
                            row.sessionCount
                          ) : (
                            ''
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rc-project-add"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleCreate(row.id)
                        }}
                        disabled={actions.busyId != null}
                        title={`在「${row.name}」新建会话`}
                        aria-label={`在 ${row.name} 新建会话`}
                      >
                        {actions.busyId === row.id ? (
                          <Icons.Spinner size={11} className="spin" />
                        ) : (
                          <Icons.Plus size={12} />
                        )}
                      </button>
                    </div>
                    {open && (
                      <div className="rc-project-body">
                        <ProjectSessions
                          bucket={store.sessions[row.id] ?? null}
                          loading={tree.pending[row.id] === true}
                          selectedSessionId={selectedSessionId}
                          busyId={actions.busyId}
                          onSelectSession={handleSelect}
                          onMenuSession={openSessionMenu}
                        />
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </>
        )}
      </div>

      {menu != null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
          ariaLabel="远程会话操作"
        />
      )}
    </aside>
  )
}
