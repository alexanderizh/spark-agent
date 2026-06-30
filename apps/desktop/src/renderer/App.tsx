import React, { useEffect, useCallback, useRef, useState } from 'react'
import {
  AppProvider,
  AppDialogHost,
  useApp,
  PRIMARIES,
  FLOATING_SIDEBAR_WIDTH_MIN,
  FLOATING_SIDEBAR_WIDTH_MAX,
} from './design/AppContext'
import { SessionSidebarProvider, useSessionSidebar } from './design/SessionSidebarContext'
import { ToastProvider, ToastContainer, useToast } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { AvatarImage } from './design/components/AvatarImage'
import { LobeThemeProvider } from './design/theme/LobeThemeProvider'
import { getGuestAvatarConfig, getUserAvatarConfig, resolveAvatarSrc } from './design/avatar'
import { AuthProvider, useAuth } from './design/auth/AuthContext'
import type {
  PermissionApprovalRequest,
  SessionId,
  UpdateStatus,
  UserQuestionPrompt,
} from '@spark/protocol'
import { useGlobalShortcuts } from './design/hooks/useKeyboard'
import { isModalOverlayVisible } from './design/hooks/useAppDialogKeyboard'
import { useAppearanceEffects } from './design/hooks/useAppearance'

import { ChatView } from './design/views/ChatView'
import { ProjectView } from './design/views/ProjectView'
import { WorkflowView } from './design/views/WorkflowView'
import { AgentsView } from './design/views/AgentsView'
import { BoardView } from './design/views/BoardView'
import { CanvasProjectsView } from './design/views/canvas/CanvasProjectsView'
import { ScheduledTasksView } from './design/views/ScheduledTasksView'
import { McpView } from './design/views/McpView'
import { SkillStoreView } from './design/views/SkillStoreView'
import { SettingsView, ProfileEditModal } from './design/views/SettingsView'
import { AccountCenterView } from './design/views/AccountCenterView'
import ProvidersView from './design/views/ProvidersView'
import { LobePreviewView } from './design/theme/LobePreviewView'
import { BrowserPanelView } from './design/views/BrowserPanelView'
import { OnboardingView, shouldShowOnboarding } from './design/views/OnboardingView'
import { CommandPalette, PermissionModal } from './design/views/overlays'
import { SidebarExpandButton } from './design/SidebarExpandButton'
import { MacWindowDragHeader } from './design/components/MacWindowDragHeader'
import { WindowControls } from './design/components/WindowControls'
import { SidebarSessionList } from './design/SidebarSessionList'
import { GlobalQuickTaskModal } from './design/components/GlobalQuickTaskModal'
import { Icons } from './design/Icons'
import { useI18n, type TranslationKey } from './design/i18n'
import './FloatingSidebar.less'
import sparkLogo from './assets/spark-logo.png'
import { Dropdown, Modal, type MenuProps } from 'antd'
import { Tooltip } from '@lobehub/ui'
import { QRCodeSVG } from '@rc-component/qrcode'

const sparkPlatform = typeof window !== 'undefined' ? window.spark?.platform : undefined
const isPlatformDarwin = sparkPlatform === 'darwin'
const isPlatformWin32 = sparkPlatform === 'win32'
const REPOSITORY_URL = 'https://github.com/alexanderizh/spark-agent'
const GITHUB_ISSUES_URL = 'https://github.com/alexanderizh/spark-agent/issues'
const OFFICIAL_SITE_URL = 'https://spark.yiqibyte.com'
const CONTACT_EMAIL = 'open@yiqibyte.com'
const QQ_GROUP_URL = 'https://qm.qq.com/q/diT40hGAyQ'
const SETTINGS_GENERAL_KEY = 'spark-settings-general'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1040
const SIDEBAR_AUTO_RESTORE_WIDTH = 1120
// 浮动态侧栏会与窗口边缘保持额外留白，因此主区需要补上这段偏移。
// 扁平态侧栏贴边显示，不应再叠加这部分 gutter。
const SIDEBAR_VISIBLE_GUTTER = 16
// 侧栏隐藏时主区由 padding-left/right (各 clamp(8px, 3vw, 40px) ≈ 8~40px) 占据，预留最小值 16 (8+8)。
// 用于估算 sidebar 隐藏状态下 chat-layout 的可用宽度。
const SIDEBAR_HIDDEN_GUTTER_MIN = 16

type UserQuestionRequest = {
  questionId: string
  sessionId: string
  questions: UserQuestionPrompt[]
}

function getUpdateSourceLabel(source?: UpdateStatus['updateSource'] | UpdateStatus['downloadSource']): string {
  if (source === 'version-center') return '官网版本中心'
  if (source === 'github') return 'GitHub Releases'
  return '尚未确定'
}

function SparkLogoMark() {
  return (
    <img
      src={sparkLogo}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}

function CircularProgressGlyph({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress))
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clamped / 100)

  return (
    <span className="sidebar-update-progress-ring" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <circle className="sidebar-update-progress-track" cx="12" cy="12" r={radius} />
        <circle
          className="sidebar-update-progress-value"
          cx="12"
          cy="12"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </span>
  )
}

// 侧边栏功能入口的默认顺序
// 注：固定项(pinnedItems)始终排在最前,与此处顺序无关;
// 「新建任务」是单独渲染的固定按钮,不在此数组内。
const NAV_ITEMS: Array<{
  id: string
  labelKey: TranslationKey
  icon: React.FC<{ size?: number }>
}> = [
  { id: 'canvas', labelKey: 'nav.canvas', icon: Icons.Canvas },
  { id: 'agents', labelKey: 'nav.agents', icon: Icons.Assistant },
  { id: 'providers', labelKey: 'nav.providers', icon: Icons.Server },
  { id: 'skill-store', labelKey: 'nav.skills', icon: Icons.Skills },
  { id: 'mcp', labelKey: 'nav.mcp', icon: Icons.MCP },
  { id: 'scheduled-tasks', labelKey: 'nav.tasks', icon: Icons.Clock },
  { id: 'workflows', labelKey: 'nav.workflows', icon: Icons.Workflow },
  { id: 'board', labelKey: 'nav.board', icon: Icons.Board },
]

/* ---------- FloatingSidebar — navigation menu + full session list ---------- */
function FloatingSidebar({ onNewTask }: { onNewTask: () => void }) {
  const { t, setTweak } = useApp()
  const { t: tr } = useI18n()
  const { toast } = useToast()
  const auth = useAuth()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [navMoreOpen, setNavMoreOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [pinnedNavIds, setPinnedNavIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem('spark-agent:pinned-nav')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string')
      }
    } catch {
      // ignore corrupted storage
    }
    return []
  })
  useEffect(() => {
    window.localStorage.setItem('spark-agent:pinned-nav', JSON.stringify(pinnedNavIds))
  }, [pinnedNavIds])
  // 已登录时使用云端用户头像/昵称；未登录时使用产品 logo（白底）作为占位
  const userAvatarSrc = auth.isAuthenticated
    ? auth.user?.avatarUrl || resolveAvatarSrc(getUserAvatarConfig(null))
    : resolveAvatarSrc(getGuestAvatarConfig())
  const userName = auth.isAuthenticated
    ? auth.user?.nickname || auth.user?.account || tr('app.user.account')
    : tr('app.user.loggedOutLogin')
  const isResizing = useRef(false)

  useEffect(() => {
    let cancelled = false
    window.spark
      ?.invoke('update:get-status', {})
      .then((res) => {
        if (!cancelled) setUpdateStatus(res.status)
      })
      .catch(() => {})
    const unsub = window.spark?.on('stream:update:status', (payload) => {
      setUpdateStatus(payload)
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  const navItem = (viewId: string, title: string, Icon: React.FC<{ size?: number }>) => {
    const isActive = t.view === viewId
    const isPinned = pinnedNavIds.includes(viewId)
    const togglePin = (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setPinnedNavIds((cur) => (isPinned ? cur.filter((id) => id !== viewId) : [...cur, viewId]))
    }
    return (
      <button
        key={viewId}
        className={`nav-item ${isActive ? 'active' : ''}${isPinned ? ' nav-item-pinned' : ''}`}
        onClick={() => setTweak('view', viewId as typeof t.view)}
        title={title}
      >
        <span className="nav-icon">
          <Icon />
        </span>
        <span className="nav-label">{title}</span>
        <span
          className={`nav-pin-btn${isPinned ? ' is-pinned' : ''}`}
          onClick={togglePin}
          title={isPinned ? tr('app.nav.unpin') : tr('app.nav.pinTop')}
          aria-label={isPinned ? tr('app.nav.unpin') : tr('app.nav.pinTop')}
        >
          <Icons.Pin size={12} />
        </span>
      </button>
    )
  }

  const VISIBLE_COUNT = 3 // nav items visible before fold (excludes "新建任务")
  const resolvedNavItems = NAV_ITEMS.map((item) => ({ ...item, label: tr(item.labelKey) }))
  // 已固定的菜单项始终排在最前，且始终显示在可见区域
  const pinnedItems = resolvedNavItems.filter((item) => pinnedNavIds.includes(item.id))
  const unpinnedItems = resolvedNavItems.filter((item) => !pinnedNavIds.includes(item.id))
  const remainingVisibleSlots = Math.max(0, VISIBLE_COUNT - pinnedItems.length)
  const visibleItems = [...pinnedItems, ...unpinnedItems.slice(0, remainingVisibleSlots)]
  const collapsedItems = unpinnedItems.slice(remainingVisibleSlots)
  const hasCollapsed = collapsedItems.length > 0

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizing.current = true
      const startX = e.clientX
      const startWidth = t.floatingSidebarWidth
      document.body.classList.add('floating-sidebar-resizing')

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return
        const delta = ev.clientX - startX
        const next = Math.min(
          FLOATING_SIDEBAR_WIDTH_MAX,
          Math.max(FLOATING_SIDEBAR_WIDTH_MIN, startWidth + delta),
        )
        setTweak('floatingSidebarWidth', next)
      }

      const handleMouseUp = () => {
        isResizing.current = false
        document.body.classList.remove('floating-sidebar-resizing')
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [t.floatingSidebarWidth, setTweak],
  )

  const handleHideSidebar = useCallback(() => {
    setTweak('sidebarHidden', true)
  }, [setTweak])

  const handleOpenExternal = useCallback((url: string) => {
    void window.spark?.invoke('browser:open-external', { url })
    setUserMenuOpen(false)
  }, [])

  const handleCopyEmail = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      toast.success(tr('app.user.emailCopied'))
    } catch (err) {
      console.error('[user-menu] copy email failed', err)
      toast.error(tr('app.user.emailCopied'))
    }
  }, [toast, tr])

  const updateState = updateStatus?.state ?? 'idle'
  const updateProgressPercent = updateStatus?.progress?.percent ?? 0
  const handleUpdateClick = useCallback(() => {
    if (updateState === 'checking') return
    if (updateState === 'available') {
      void window.spark?.invoke('update:download', {})
      return
    }
    if (updateState === 'downloaded') {
      void window.spark?.invoke('update:install-restart', {})
      return
    }
    if (updateState === 'downloading') {
      void setTweak('view', 'settings')
      return
    }
    void window.spark?.invoke('update:check', {})
  }, [setTweak, updateState])

  const getUpdateButtonTitle = () => {
    if (updateState === 'checking') return tr('app.update.checking')
    if (updateState === 'available')
      return tr('app.update.available', { version: updateStatus?.updateInfo?.version ?? '' }).trim()
    if (updateState === 'downloading') {
      const percentLabel = Math.round(updateProgressPercent)
      return tr('app.update.downloading', {
        percent: Number.isFinite(percentLabel) ? `${percentLabel}%` : '',
      }).trim()
    }
    if (updateState === 'downloaded')
      return tr(isPlatformDarwin ? 'app.update.openInstaller' : 'app.update.install')
    if (updateState === 'error')
      return tr('app.update.error', { error: updateStatus?.error ?? tr('app.update.retry') })
    return tr('app.update.check')
  }

  const getUpdateButtonTooltip = () => {
    const lines = [
      getUpdateButtonTitle(),
      `来源：${getUpdateSourceLabel(updateStatus?.updateSource)}`,
    ]
    return (
      <span className="sidebar-update-tooltip">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    )
  }

  const renderUpdateButtonIcon = () => {
    if (updateState === 'checking') return <Icons.Spinner size={15} />
    if (updateState === 'available') return <Icons.Download size={15} />
    if (updateState === 'downloading') {
      return <CircularProgressGlyph progress={updateProgressPercent} />
    }
    if (updateState === 'downloaded') return <Icons.CheckCircle size={15} />
    if (updateState === 'error') return <Icons.AlertTriangle size={15} />
    return <Icons.CloudDownload size={14} />
  }

  const menuLabel = (leading: React.ReactNode, text: string, checked = false) => (
    <span className="user-menu-label">
      {leading}
      <span className="user-menu-label-text">{text}</span>
      {checked && <span className="user-menu-check">✓</span>}
    </span>
  )

  // Keep the panel mounted across hide/show so the slide+fade transition
  // (defined on .floating-sidebar in styles.css) can play both ways. The
  // .is-hidden class drives transform/opacity/visibility; the panel
  // subtree is taken out of the tab order and clickable surface via CSS
  // (pointer-events: none + visibility: hidden) so focus / clicks never
  // reach it while it's offscreen.
  const panelClass = `floating-sidebar${t.sidebarHidden ? ' is-hidden' : ''}`

  return (
    <div
      className={panelClass}
      style={{ '--sidebar-w': `${t.floatingSidebarWidth}px` } as React.CSSProperties}
      aria-hidden={t.sidebarHidden || undefined}
    >
      {/* Drag region */}
      <div className="floating-sidebar-drag" />

      {/* Panel header: logo + hide button, right-aligned */}
      <div className="floating-sidebar-header">
        <div className="floating-sidebar-brand" />
        {/* <div className="sidebar-logo"><SparkLogoMark /></div> */}
        <div className="sidebar-header-actions">
          {(updateState === 'available' ||
            updateState === 'downloading' ||
            updateState === 'downloaded') && (
            <Tooltip title={getUpdateButtonTooltip()} mouseEnterDelay={0.05}>
              <button
                className={`icon-btn sidebar-update-btn state-${updateState}`}
                onClick={handleUpdateClick}
                aria-label={getUpdateButtonTitle()}
              >
                {renderUpdateButtonIcon()}
                {(updateState === 'available' || updateState === 'downloaded') && (
                  <span className="sidebar-update-dot" />
                )}
              </button>
            </Tooltip>
          )}
          <button
            className="icon-btn sidebar-hide-btn"
            onClick={handleHideSidebar}
            title={tr('app.sidebar.hide')}
          >
            <Icons.SidebarHide size={15} />
          </button>
        </div>
      </div>

      {/* ── Navigation: 新建任务 + feature nav items in one section for uniform spacing ── */}
      <div className="sidebar-nav-section">
        <button className="nav-item" onClick={onNewTask} title={tr('app.sidebar.newTask')}>
          <span className="nav-icon">
            <Icons.MessageSquarePlus />
          </span>
          <span className="nav-label">{tr('app.sidebar.newTask')}</span>
        </button>
        {visibleItems.map((item) => navItem(item.id, item.label, item.icon))}
        {hasCollapsed && (
          <Dropdown
            menu={{ items: [] }}
            open={navMoreOpen}
            onOpenChange={setNavMoreOpen}
            trigger={['hover']}
            placement="bottomRight"
            mouseEnterDelay={0.08}
            mouseLeaveDelay={0.12}
            popupRender={() => (
              <div className="nav-more-menu">
                {collapsedItems.map((item) => navItem(item.id, item.label, item.icon))}
              </div>
            )}
          >
            <button
              type="button"
              className={`nav-more-trigger${navMoreOpen ? ' is-open' : ''}`}
              title={tr('app.sidebar.expandMore')}
            >
              <span className="nav-more-icon">
                <Icons.More />
              </span>
              <span className="nav-label">{tr('app.sidebar.expandMore')}</span>
            </button>
          </Dropdown>
        )}
      </div>

      {/* ── Divider between nav and session list ── */}
      <div className="sidebar-session-divider" />

      {/* ── Full session list (exact same functionality as original ChatView sidebar) ── */}
      <div className="sidebar-session-list">
        <SidebarSessionList />
      </div>

      {/* Bottom area: user + window controls */}
      <div className="sidebar-bottom">
        <div className="sidebar-bottom-user">
        <Dropdown
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          trigger={['click']}
          placement="topRight"
          menu={
            {
              className: 'user-menu',
              items: [
                ...(auth.isAuthenticated
                  ? [
                      {
                        key: 'account',
                        label: menuLabel(<Icons.User size={14} />, tr('app.user.account')),
                      },
                      { type: 'divider' as const },
                    ]
                  : [
                      {
                        key: 'login',
                        label: menuLabel(<Icons.User size={14} />, tr('app.user.login')),
                      },
                      { type: 'divider' as const },
                    ]),
                {
                  key: 'theme',
                  label: menuLabel(<Icons.Sun size={14} />, 'Theme'),
                  children: [
                    {
                      key: 'theme-light',
                      label: menuLabel(<Icons.Sun size={14} />, 'Light', t.theme === 'light'),
                    },
                    {
                      key: 'theme-dark',
                      label: menuLabel(<Icons.Moon size={14} />, 'Dark', t.theme === 'dark'),
                    },
                    {
                      key: 'theme-system',
                      label: menuLabel(<Icons.Monitor size={14} />, 'System', t.theme === 'system'),
                    },
                    { type: 'divider' as const },
                    {
                      key: 'accent',
                      label: menuLabel(
                        <span className="user-menu-accent-dot" style={{ background: t.primary }} />,
                        tr('app.user.accent'),
                      ),
                      children: Object.entries(PRIMARIES).map(([color, info]) => ({
                        key: `accent-${color}`,
                        label: menuLabel(
                          <span
                            className="user-menu-accent-swatch"
                            style={{ background: color }}
                          />,
                          info.name,
                          t.primary === color,
                        ),
                      })),
                    },
                  ],
                },
                {
                  key: 'sidebar-style',
                  label: menuLabel(<Icons.PanelLeft size={14} />, tr('app.sidebar.style')),
                  children: [
                    {
                      key: 'sidebar-style-floating',
                      label: menuLabel(
                        <Icons.SidebarShow size={14} />,
                        tr('app.sidebar.styleFloating'),
                        t.sidebarStyle === 'floating',
                      ),
                    },
                    {
                      key: 'sidebar-style-flat',
                      label: menuLabel(
                        <Icons.PanelLeft size={14} />,
                        tr('app.sidebar.styleFlat'),
                        t.sidebarStyle === 'flat',
                      ),
                    },
                  ],
                },
                { type: 'divider' as const },
                {
                  key: 'remote',
                  label: menuLabel(<Icons.Globe size={14} />, tr('app.nav.remote')),
                },
                {
                  key: 'contact',
                  label: menuLabel(<Icons.Users size={14} />, tr('app.user.contactUs')),
                  children: [
                    {
                      key: 'contact-qq',
                      label: menuLabel(<Icons.Users size={14} />, tr('app.user.contactQQ')),
                    },
                    {
                      key: 'contact-email',
                      label: menuLabel(<Icons.Mail size={14} />, tr('app.user.contactEmail')),
                    },
                    {
                      key: 'contact-github-issue',
                      label: menuLabel(<Icons.AlertTriangle size={14} />, tr('app.user.contactGithubIssue')),
                    },
                  ],
                },
                { key: 'github', label: menuLabel(<Icons.GitHub size={14} />, 'GitHub') },
                { key: 'website', label: menuLabel(<Icons.Home size={14} />, tr('app.user.website')) },
              ],
              onClick: ({ key }: { key: string }) => {
                switch (key) {
                  case 'account':
                    setTweak('view', 'account-center')
                    break
                  case 'login':
                    auth.setFlow('login')
                    setTweak('view', 'account-center')
                    break
                  case 'theme-light':
                    setTweak('theme', 'light' as typeof t.theme)
                    break
                  case 'theme-dark':
                    setTweak('theme', 'dark' as typeof t.theme)
                    break
                  case 'theme-system':
                    setTweak('theme', 'system' as typeof t.theme)
                    break
                  case 'sidebar-style-floating':
                    setTweak('sidebarStyle', 'floating')
                    break
                  case 'sidebar-style-flat':
                    setTweak('sidebarStyle', 'flat')
                    break
                  default:
                    if (key.startsWith('accent-')) {
                      setTweak('primary', key.slice('accent-'.length))
                    } else if (key === 'remote') {
                      setTweak('view', 'settings')
                      setTweak('settingsSection', 'remote-connections')
                    } else if (key === 'github') {
                      handleOpenExternal(REPOSITORY_URL)
                    } else if (key === 'website') {
                      handleOpenExternal(OFFICIAL_SITE_URL)
                    } else if (key === 'lobe-preview') {
                      setTweak('view', 'lobe-preview')
                    } else if (key === 'contact-qq') {
                      setContactModalOpen(true)
                      return // don't close parent menu — modal stays open
                    } else if (key === 'contact-email') {
                      void handleCopyEmail()
                    } else if (key === 'contact-github-issue') {
                      handleOpenExternal(GITHUB_ISSUES_URL)
                    }
                  }
                setUserMenuOpen(false)
              },
            } as MenuProps
          }
        >
          <button
            className={`sidebar-user${auth.isAuthenticated ? '' : ' sidebar-user-guest'}`}
            style={{ cursor: 'pointer' }}
          >
            <div className="avatar sidebar-user-avatar">
              {userAvatarSrc ? (
                <AvatarImage
                  src={userAvatarSrc}
                  seed={auth.user?.account || 'spark-user'}
                  name={userName}
                  alt={
                    auth.isAuthenticated ? tr('app.user.avatarAlt') : tr('app.user.guestAvatarAlt')
                  }
                  className={`sidebar-user-avatar-image${auth.isAuthenticated ? '' : ' sidebar-user-avatar-image-guest'}`}
                />
              ) : null}
            </div>
            <div className="sidebar-user-info">
              <div className="name">{userName}</div>
            </div>
            <Icons.ChevronDown size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          </button>
        </Dropdown>
        <button
          className="sidebar-user-settings"
          aria-label={tr('app.user.settings')}
          title={tr('app.user.settings')}
          onClick={() => setTweak('view', 'settings')}
        >
          <Icons.Settings size={13} />
        </button>
        </div>
        {/* Linux: custom HTML controls in sidebar. Windows/macOS use their own title bars. */}
        {!isPlatformDarwin && !isPlatformWin32 && <WindowControls />}
      </div>

      {/* Resize handle on the right edge */}
      <div className="floating-sidebar-resize-handle" onMouseDown={handleResizeStart} />

      {/* QQ 群扫码加群 — theme-aware card rebuilt in DOM (no header/footer, only a close button). */}
      <Modal
        open={contactModalOpen}
        onCancel={() => setContactModalOpen(false)}
        footer={null}
        title={null}
        closable
        centered
        destroyOnClose
        width={340}
        className="user-contact-qq-modal"
      >
        <div className="user-contact-qq-card">
          <div className="user-contact-qq-brand">
            <img src={sparkLogo} alt="" aria-hidden="true" className="user-contact-qq-brand-mark" />
            <span className="user-contact-qq-brand-name">SparkAgent</span>
          </div>
          <div className="user-contact-qq-title">{tr('app.user.qqScanTitle')}</div>
          <div className="user-contact-qq-qr">
            <QRCodeSVG value={QQ_GROUP_URL} size={180} level="M" marginSize={0} />
          </div>
          <div className="user-contact-qq-group-no">{tr('app.user.qqScanGroupNo')}</div>
          <div className="user-contact-qq-hint">{tr('app.user.qqScanHint')}</div>
        </div>
      </Modal>
    </div>
  )
}

function Shell() {
  const { t, setTweak, hasDialogOpen } = useApp()
  const { t: tr } = useI18n()
  const { toast } = useToast()
  const scaleRef = useRef<HTMLDivElement>(null)
  useAppearanceEffects()
  const [approvalRequests, setApprovalRequests] = useState<
    Record<string, PermissionApprovalRequest>
  >({})
  const [userQuestions, setUserQuestions] = useState<Record<string, UserQuestionRequest>>({})
  const [canvasWorkspaceActive, setCanvasWorkspaceActive] = useState(false)
  const wasCanvasWorkspaceActiveRef = useRef(false)
  const sidebarHiddenRef = useRef(t.sidebarHidden)
  const autoSidebarCollapsedRef = useRef(false)
  const lastSidebarViewportWidthRef = useRef<number | null>(null)
  // 用 ref 同步 floatingSidebarWidth，避免在 syncSidebarForViewport 内部依赖 React state。
  const floatingSidebarWidthRef = useRef(t.floatingSidebarWidth)
  useEffect(() => {
    floatingSidebarWidthRef.current = t.floatingSidebarWidth
  }, [t.floatingSidebarWidth])

  // Shared "start a brand new conversation" handler.
  // - Clears any active session/workspace so the chat view renders in fresh
  //   "new conversation" state.
  // - Used by both the sidebar "新建任务" button and the Cmd+N keyboard
  //   shortcut so they stay in lockstep.
  const sessionCtx = useSessionSidebar()
  const activeSessionRef = useRef(sessionCtx.activeSessionId)
  const viewRef = useRef(t.view)
  const chatModeRef = useRef(t.chatMode)

  useEffect(() => {
    activeSessionRef.current = sessionCtx.activeSessionId
  }, [sessionCtx.activeSessionId])

  useEffect(() => {
    sidebarHiddenRef.current = t.sidebarHidden
    if (!t.sidebarHidden) autoSidebarCollapsedRef.current = false
  }, [t.sidebarHidden])

  useEffect(() => {
    // 测量 ChatView 在当前面板打开状态下的 layout 最低需求宽度。
    // 返回值 = chat-main min-width(默认 520) + 右侧所有打开的面板宽度。
    // 返回 0 表示当前没有挂载 ChatView（其它 view），按原 innerWidth 阈值切换作为兜底。
    const measureChatLayoutMinWidth = (): number => {
      const layout = document.querySelector('.chat-layout') as HTMLElement | null
      if (!layout) return 0
      const layoutStyle = window.getComputedStyle(layout)
      const mainMinWidth = Number.parseFloat(
        layoutStyle.getPropertyValue('--chat-main-min-width'),
      )
      const chatMainMinWidth = Number.isFinite(mainMinWidth) ? mainMinWidth : 520
      const sidePanelsWidth = Array.from(layout.children).reduce((sum, child) => {
        const el = child as HTMLElement
        // chat-main 是 layout 主要内容，不算入侧栏宽度。
        if (el.classList.contains('chat-main')) return sum
        const rect = el.getBoundingClientRect()
        // 隐藏 / display:none 的元素不计入（避免在右侧面板全关时按页面其它 node 误算）。
        if (rect.width <= 0) return sum
        return sum + rect.width
      }, 0)
      return chatMainMinWidth + sidePanelsWidth
    }

    const syncSidebarForViewport = (force = false): void => {
      const width = window.innerWidth
      if (!force && lastSidebarViewportWidthRef.current === width) return
      lastSidebarViewportWidthRef.current = width

      const layoutMinWidth = measureChatLayoutMinWidth()
      // sidebar 展开时主区可用宽度 ≈ width - (floatingSidebarWidth + SIDEBAR_VISIBLE_GUTTER)
      // sidebar 隐藏时主区可用宽度 ≈ width - SIDEBAR_HIDDEN_GUTTER_MIN
      const sidebarVisibleAvailable = width - (floatingSidebarWidthRef.current + SIDEBAR_VISIBLE_GUTTER)
      const sidebarHiddenAvailable = width - SIDEBAR_HIDDEN_GUTTER_MIN
      // 当没有 ChatView 时 (layoutMinWidth === 0)，让两个 fits 字段都短路为 true，
      // 这样保留原 innerWidth 阈值切换的兜底行为。
      const fitsWithSidebarVisible = layoutMinWidth === 0 || sidebarVisibleAvailable >= layoutMinWidth
      const fitsWithSidebarHidden = layoutMinWidth === 0 || sidebarHiddenAvailable >= layoutMinWidth

      if (!sidebarHiddenRef.current) {
        // 当前 sidebar 显示：宽度过低 或 展开后 layout 装不下 → 折叠。
        // 装不下就折叠是关键修复：避免 sidebar 显示后 ChatView 的
        // ensureChatLayoutFitsWindow 触发 IPC 拉宽窗口被回滚成"缩小一点又弹回来"。
        // 注意：fitsWithSidebarVisible 在 layoutMinWidth === 0 时为 true，
        // 所以非 ChatView 下保留原始阈值行为。
        if (
          width <= SIDEBAR_AUTO_COLLAPSE_WIDTH ||
          !fitsWithSidebarVisible
        ) {
          autoSidebarCollapsedRef.current = true
          sidebarHiddenRef.current = true
          setTweak('sidebarHidden', true)
        }
      } else if (
        width >= SIDEBAR_AUTO_RESTORE_WIDTH &&
        sidebarHiddenRef.current &&
        fitsWithSidebarVisible
      ) {
        // 当前 sidebar 隐藏：宽度足够且展开后 layout 装得下 → 自动展开。
        // 与原行为一致，不限制为 auto-collapsed：用户手动隐藏的 sidebar 在窗口
        // 拉宽且 layout 装得下时也会自动恢复，避免覆盖"窗口大就展开"的用户预期。
        autoSidebarCollapsedRef.current = false
        sidebarHiddenRef.current = false
        setTweak('sidebarHidden', false)
      }
      // fitsWithSidebarHidden 目前只在"当前显示"分支需要，未来如果增加
      // "显示状态下隐藏反而装得下"的反向策略时可以复用。
      void fitsWithSidebarHidden
    }
    syncSidebarForViewport(true)
    const handleResize = () => syncSidebarForViewport()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [setTweak])

  useEffect(() => {
    if (shouldShowOnboarding() && viewRef.current !== 'onboarding') {
      setTweak('view', 'onboarding')
    }
  }, [setTweak])

  useEffect(() => {
    viewRef.current = t.view
    chatModeRef.current = t.chatMode
    if (t.view !== 'canvas') setCanvasWorkspaceActive(false)
  }, [t.chatMode, t.view])

  useEffect(() => {
    const isCanvasWorkspaceActive = t.view === 'canvas' && canvasWorkspaceActive
    if (isCanvasWorkspaceActive && !wasCanvasWorkspaceActiveRef.current && !t.sidebarHidden) {
      // 进入画布工作区：自动折叠左侧菜单，给画布更多横向空间
      setTweak('sidebarHidden', true)
    } else if (!isCanvasWorkspaceActive && wasCanvasWorkspaceActiveRef.current && t.sidebarHidden) {
      // 离开画布工作区：恢复左侧菜单（之前是自动折叠进来的）
      setTweak('sidebarHidden', false)
    }
    wasCanvasWorkspaceActiveRef.current = isCanvasWorkspaceActive
  }, [canvasWorkspaceActive, setTweak, t.sidebarHidden, t.view])

  const handleNewBlankSession = useCallback(() => {
    sessionCtx.setActiveSession(null)
    // Keep current workspace so new session inherits the active project context
    setTweak('view', 'chat')
  }, [sessionCtx, setTweak])

  const navigateToSession = useCallback(
    (sessionId: string) => {
      const targetSession = sessionCtx.sessions.find((session) => session.id === sessionId) ?? null
      sessionCtx.setActiveSession(sessionId as SessionId)
      if (targetSession?.workspaceIds?.[0] != null) {
        sessionCtx.setActiveWorkspace(targetSession.workspaceIds[0])
      }
      setTweak('view', 'chat')
    },
    [sessionCtx, setTweak],
  )

  const dismissApprovalRequest = useCallback((sessionId: string, requestId?: string) => {
    setApprovalRequests((current) => {
      const existing = current[sessionId]
      if (existing == null) return current
      if (requestId != null && existing.requestId !== requestId) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  const dismissUserQuestion = useCallback((sessionId: string, questionId?: string) => {
    setUserQuestions((current) => {
      const existing = current[sessionId]
      if (existing == null) return current
      if (questionId != null && existing.questionId !== questionId) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  // Global error handlers
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason)
      toast.error(tr('app.error.unhandledRejection', { message }), {
        duration: 8000,
        actions: [
          {
            label: tr('app.toast.viewDetails'),
            onClick: () => console.error('Unhandled rejection:', event.reason),
          },
        ],
      })
      event.preventDefault()
    }

    const handleWindowError = (event: ErrorEvent) => {
      if (event.message?.includes('ResizeObserver loop')) return
      const message = event.message || 'Unknown error'
      toast.error(tr('app.error.runtime', { message }), {
        duration: 8000,
        actions: [
          {
            label: tr('app.toast.viewDetails'),
            onClick: () => console.error('Window error:', event.error),
          },
        ],
      })
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleWindowError)
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleWindowError)
    }
  }, [toast, tr])

  // IPC error listener
  useEffect(() => {
    const handleIpcError = (event: CustomEvent<{ channel: string; error: string }>) => {
      const { channel, error: errMsg } = event.detail
      toast.error(tr('app.error.ipc', { channel, message: errMsg }), { duration: 6000 })
    }
    window.addEventListener('spark:ipc-error', handleIpcError as EventListener)
    return () => {
      window.removeEventListener('spark:ipc-error', handleIpcError as EventListener)
    }
  }, [toast, tr])

  // Auto-scale 1440x900 -> viewport
  useEffect(() => {
    const el = scaleRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      const sx = el.offsetWidth / 1440
      const sy = el.offsetHeight / 900
      const s = Math.min(sx, sy)
      el.style.setProperty('--scale', String(s))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Navigation handler for command palette
  const handleNavigate = useCallback(
    (view: string) => {
      setTweak('view', view as typeof t.view)
    },
    [setTweak],
  )

  const [quickTaskOpen, setQuickTaskOpen] = useState(false)
  const [paletteCommandRequest, setPaletteCommandRequest] = useState<{ id: number; commandText: string } | null>(null)

  // Toggle left sidebar visibility. Kept for non-shortcut UI entry points; Ctrl/Cmd+B
  // is now reserved for global quick task capture.
  const handleExpandSidebar = useCallback(() => {
    autoSidebarCollapsedRef.current = false
    sidebarHiddenRef.current = false
    lastSidebarViewportWidthRef.current = window.innerWidth
    setTweak('sidebarHidden', false)
  }, [setTweak])

  const handleToggleSidebar = useCallback(() => {
    if (t.sidebarHidden) {
      handleExpandSidebar()
    } else {
      autoSidebarCollapsedRef.current = false
      sidebarHiddenRef.current = true
      lastSidebarViewportWidthRef.current = window.innerWidth
      setTweak('sidebarHidden', true)
    }
  }, [handleExpandSidebar, setTweak, t.sidebarHidden])

  const handleQuickTask = useCallback(() => {
    setQuickTaskOpen(true)
  }, [])

  // Global keyboard shortcuts.
  // The "newSession" shortcut (Cmd/Ctrl+N) now behaves the same as the sidebar
  // "新建任务" button: it clears the active session and enters a fresh chat.
  useGlobalShortcuts({
    setTweak: setTweak as (key: string, val: unknown) => void,
    onSearchFocus: () => window.dispatchEvent(new CustomEvent('spark:focus-search')),
    onNewSession: handleNewBlankSession,
    onToggleSidebar: handleToggleSidebar,
    onQuickTask: handleQuickTask,
    hasOverlayOpen: () =>
      hasDialogOpen ||
      t.showPalette ||
      t.showPerm ||
      t.showProviderEdit ||
      t.showProfileEdit ||
      quickTaskOpen ||
      isModalOverlayVisible(),
  })

  // Listen for tool approval requests
  useEffect(() => {
    const api = window.spark
    if (!api?.on) return
    return api.on('stream:permission:approval-request', (req) => {
      setApprovalRequests((current) => ({ ...current, [req.sessionId]: req }))
      api
        .invoke?.('hook:trigger', {
          sessionId: req.sessionId,
          node: 'permission_request',
          title: tr('app.permission.notificationTitle'),
          body: tr('app.permission.notificationBody'),
        })
        .catch(() => {})

      const isVisibleInCurrentSession =
        viewRef.current === 'chat' &&
        chatModeRef.current !== 'workspace' &&
        activeSessionRef.current === req.sessionId
      if (isVisibleInCurrentSession) return

      toast.warning(tr('app.permission.waiting'), {
        duration: 8000,
        actions: [
          { label: tr('app.permission.goReview'), onClick: () => navigateToSession(req.sessionId) },
        ],
      })
    })
  }, [navigateToSession, toast])

  useEffect(() => {
    const api = window.spark
    if (!api?.on) return
    return api.on('stream:session:user-question', (req) => {
      setUserQuestions((current) => ({ ...current, [req.sessionId]: req }))

      const isVisibleInCurrentSession =
        viewRef.current === 'chat' &&
        chatModeRef.current !== 'workspace' &&
        activeSessionRef.current === req.sessionId
      if (isVisibleInCurrentSession) return

      toast.info(tr('app.question.waiting'), {
        duration: 8000,
        actions: [
          { label: tr('app.question.goAnswer'), onClick: () => navigateToSession(req.sessionId) },
        ],
      })
    })
  }, [navigateToSession, toast])

  const primary = t.primary
  const info = PRIMARIES[primary]

  // Resolve the effective theme for CSS class (system → light/dark)
  const resolvedTheme =
    t.theme === 'system'
      ? typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : t.theme

  const activeApprovalRequest =
    sessionCtx.activeSessionId != null
      ? (approvalRequests[sessionCtx.activeSessionId] ?? null)
      : null
  const activeUserQuestion =
    sessionCtx.activeSessionId != null ? (userQuestions[sessionCtx.activeSessionId] ?? null) : null

  const showInlineApproval = t.view === 'chat' && t.chatMode !== 'workspace'
  // Default view is chat (no more home). Render elements directly so the chat
  // tree keeps a stable component identity across Shell re-renders.
  const viewElement = (() => {
    switch (t.view) {
      case 'chat':
        return t.chatMode === 'workspace' ? (
          <ProjectView />
        ) : (
          <ChatView
            approvalRequest={activeApprovalRequest}
            onApprovalClose={dismissApprovalRequest}
            userQuestion={activeUserQuestion}
            onUserQuestionClose={dismissUserQuestion}
            onExpandSidebar={handleExpandSidebar}
            paletteCommandRequest={paletteCommandRequest}
          />
        )
      case 'workflows':
        return <WorkflowView />
      case 'agents':
        return <AgentsView />
      case 'board':
        return <BoardView />
      case 'canvas':
        return <CanvasProjectsView onWorkspaceActiveChange={setCanvasWorkspaceActive} />
      case 'scheduled-tasks':
        return <ScheduledTasksView />
      case 'skills':
        return <SkillStoreView />
      case 'skill-store':
        return <SkillStoreView />
      case 'providers':
        return <ProvidersView />
      case 'mcp':
        return <McpView />
      case 'settings':
        return <SettingsView />
      case 'account-center':
        return <AccountCenterView />
      case 'lobe-preview':
        return <LobePreviewView />
      case 'onboarding':
        return <OnboardingView />
      default:
        return (
          <ChatView
            approvalRequest={activeApprovalRequest}
            onApprovalClose={dismissApprovalRequest}
            userQuestion={activeUserQuestion}
            onUserQuestionClose={dismissUserQuestion}
            onExpandSidebar={handleExpandSidebar}
            paletteCommandRequest={paletteCommandRequest}
          />
        )
    }
  })()

  // Compute dynamic margin for main content area based on sidebar state.
  // Flat sidebar is flush to the window edge, so it should only offset by its own width.
  const sidebarOffset = t.sidebarHidden
    ? 0
    : t.floatingSidebarWidth + (t.sidebarStyle === 'flat' ? 0 : SIDEBAR_VISIBLE_GUTTER)
  const useIntegratedTitlebar = t.view === 'chat' && t.chatMode !== 'workspace'

  return (
    <ErrorBoundary level="global" name="Shell">
      <div
        ref={scaleRef}
        className={`app window theme-${resolvedTheme} density-${t.density} platform-${sparkPlatform ?? 'unknown'} sidebar-style-${t.sidebarStyle}${t.sidebarHidden ? ' sidebar-hidden' : ''}${useIntegratedTitlebar ? ' titlebar-integrated' : ''}`}
        style={
          {
            '--primary': primary,
            '--primary-hover': info?.hover ?? primary,
            '--primary-soft': info?.soft ?? 'rgba(99,102,241,0.12)',
            '--sidebar-offset': `${sidebarOffset}px`,
          } as React.CSSProperties
        }
      >
        {/* Onboarding is a full-screen takeover — it renders its own two-column
            layout and must be independent of the app's FloatingSidebar +
            main-content-area shell. Render it directly so it covers the whole
            window instead of being inset inside the right content pane. */}
        {t.view === 'onboarding' ? (
          <OnboardingView />
        ) : (
          <>
            <FloatingSidebar onNewTask={handleNewBlankSession} />
            {/* macOS / Linux: unified shell title bar when sidebar is hidden.
                  Mirrors win-titlebar so every view (including chat) gets the expand
                  button; on macOS the left padding reserves space for traffic lights.
                  画布工作区自带 canvas-workspace-header，且已把 expand 按钮并入其中，
                  此处不再渲染以免两个头重叠。 */}
            {!useIntegratedTitlebar &&
              !isPlatformWin32 &&
              t.sidebarHidden &&
              !(t.view === 'canvas' && canvasWorkspaceActive) && (
                <div
                  className={`shell-titlebar${isPlatformDarwin ? ' shell-titlebar-darwin' : ''}`}
                  onDoubleClick={() => {
                    window.spark?.invoke('window:maximize', {}).catch(() => {})
                  }}
                >
                  <SidebarExpandButton onExpand={handleExpandSidebar} />
                </div>
              )}
            <div
              className={`main-content-area${t.view === 'canvas' && canvasWorkspaceActive ? ' main-content-canvas-workspace' : ''}`}
            >
              {/* Windows: custom title bar spanning full width with drag region */}
              {!useIntegratedTitlebar && isPlatformWin32 && (
                <div className="win-titlebar">
                  {t.sidebarHidden && <SidebarExpandButton onExpand={handleExpandSidebar} />}
                  <div className="win-titlebar-controls">
                    <WindowControls />
                  </div>
                </div>
              )}

              {/* macOS: unified drag strip atop the content area while the sidebar
                  is visible. When the sidebar is hidden, the shell-titlebar above
                  takes over. 画布工作区自带 canvas-workspace-header，此处不再渲染以免重叠。 */}
              {!useIntegratedTitlebar &&
                isPlatformDarwin &&
                !t.sidebarHidden &&
                !(t.view === 'canvas' && canvasWorkspaceActive) && (
                  <MacWindowDragHeader />
                )}

              {t.view === 'chat' ? (
                <div className="main-with-browser">
                  <div className="main">
                    <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
                      {viewElement}
                    </div>
                  </div>
                  <BrowserPanelView />
                </div>
              ) : (
                <div className="main">
                  <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
                    {viewElement}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Overlays */}
        <GlobalQuickTaskModal open={quickTaskOpen} onClose={() => setQuickTaskOpen(false)} />
        {t.showPalette && (
          <CommandPalette
            onClose={() => setTweak('showPalette', false)}
            onNavigate={handleNavigate}
            onNewSession={handleNewBlankSession}
            onQuickTask={handleQuickTask}
            sessionContext={t.view === 'chat'}
            onInsertCommand={(commandText) => {
              setPaletteCommandRequest({ id: Date.now(), commandText })
            }}
          />
        )}
        {t.showPerm && (
          <PermissionModal
            request={{
              requestId: 'preview',
              sessionId: 'preview-session',
              toolName: 'write_file',
              action: 'file_write',
              toolInput: {},
              riskLevel: 'medium',
              persistentScopes: ['global'],
            }}
            onClose={() => setTweak('showPerm', false)}
          />
        )}

        {t.showProfileEdit && (
          <ProfileEditModal onClose={() => setTweak('showProfileEdit', false)} />
        )}

        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}

export function App() {
  return (
    <AppProvider>
      <LobeThemeBridge>
        <AuthProvider>
          <ToastProvider>
            <SessionSidebarProvider>
              <GateAwareShell />
              <AppDialogHost />
            </SessionSidebarProvider>
          </ToastProvider>
        </AuthProvider>
      </LobeThemeBridge>
    </AppProvider>
  )
}

/**
 * LobeThemeBridge — 读取 AppContext 的主题/配色,为 antd + lobe-ui 注入 ThemeProvider。
 * 必须放在 AppProvider 内层(读 useApp)。
 */
function LobeThemeBridge({ children }: { children: React.ReactNode }) {
  const { t } = useApp()
  const resolvedTheme: 'light' | 'dark' =
    t.theme === 'system'
      ? typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : (t.theme as 'light' | 'dark')
  return (
    <LobeThemeProvider themeMode={t.theme} resolvedTheme={resolvedTheme} primary={t.primary}>
      {children}
    </LobeThemeProvider>
  )
}

/**
 * 启动期拦截：
 *   - bootstrapping 显示 loading
 *   - 登录是可选的，未登录也进 Shell
 *   - 登录入口在侧边栏底部用户信息处 + 设置-账号页
 */
function GateAwareShell(): React.ReactElement {
  const auth = useAuth()
  const { t: tr } = useI18n()
  if (auth.bootstrapping) {
    return (
      <div className="boot-splash" role="status" aria-label={tr('app.boot.starting')}>
        <div className="boot-splash-inner" aria-hidden="true">
          <div className="boot-splash-spinner" />
        </div>
      </div>
    )
  }
  return <Shell />
}
