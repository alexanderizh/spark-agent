/**
 * 远程 — 在桌面端直接操作另一台电脑上的 SparkWork。
 *
 * 与手机端（apps/mobile）的区别：
 *   - 不需要登录/配对：中继身份与账号来自当前桌面端登录态，主进程已按 deviceId 过滤本机；
 *   - 能力直接复用目标设备的 MobileBridge /v1/* 语义路由，无需另开协议；
 *   - UI 按桌面端设计语言重做（紧凑密度、中性灰、无渐变）。
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { RemoteAgentDeviceSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { useToast } from '../../components/Toast'
import { WindowControls } from '../../components/WindowControls'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { isRemoteControlWindowMode } from '../../../remoteControlWindowParams'
import { RemoteChatPane } from './RemoteChatPane'
import { RemoteSessionPane } from './RemoteSessionPane'
import { RemoteProjectPanel } from './RemoteProjectPanel'
import { RemoteDeviceSwitcher } from './RemoteDeviceSwitcher'
import { deviceLabel, deviceRealName, deviceTooltip } from './remoteDevices'
import {
  findSessionProjectId,
  getRemoteSessionStore,
  subscribeRemoteSessionStore,
} from './remoteSessionStore'
import {
  readDeviceSwitcher,
  readLastSession,
  readRemoteViewState,
  rememberDeviceSwitcher,
  rememberLastDevice,
  rememberLastSession,
  resolveDeviceSwitcherMode,
} from './remoteViewState'
import type { RemoteDeviceSwitcherMode } from './remoteViewState'
import { useRemoteRelay } from './useRemoteBridge'
import { useRemoteSessionTitle } from './useRemoteSessionTree'
import {
  clampRemoteProjectPanelWidth,
  readRemoteProjectPanelOpen,
  readRemoteProjectPanelWidth,
  rememberRemoteProjectPanelOpen,
  rememberRemoteProjectPanelWidth,
  type RemoteProjectPanelTab,
} from './remoteProjectPanelState'
import './remote-control.less'
import './remote-control-improvements.less'

function formatSeenAt(value: string | null): string {
  if (!value) return '未知'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return '未知'
  const diffMs = Date.now() - then
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  return `${Math.floor(diffMs / 86_400_000)} 天前`
}

function DeviceCard({
  device,
  onSelect,
  onRename,
  renaming,
}: {
  device: RemoteAgentDeviceSummary
  onSelect: (deviceId: string) => void
  onRename: (device: RemoteAgentDeviceSummary) => void
  renaming: boolean
}) {
  const label = deviceLabel(device)
  const realName = deviceRealName(device)
  return (
    <div className={`rc-device-card-wrap${device.online ? '' : ' is-offline'}`}>
      <button
        type="button"
        className={`rc-device-card${device.online ? '' : ' is-offline'}`}
        onClick={() => device.online && onSelect(device.deviceId)}
        disabled={!device.online}
      >
        <span className="rc-device-icon">
          <Icons.RemoteMonitor size={18} />
        </span>
        <span className="rc-device-body">
          <span className="rc-device-name" title={deviceTooltip(device)}>
            {label}
          </span>
          {realName != null && (
            <span className="rc-device-real" title={`设备自报名：${realName}`}>
              原名 {realName}
            </span>
          )}
          <span className="rc-device-meta">
            {device.online
              ? `在线 · ${device.version ?? '版本未知'}`
              : `离线 · ${formatSeenAt(device.lastSeenAt)}`}
          </span>
        </span>
        <span className={`rc-device-status${device.online ? ' online' : ''}`} />
      </button>
      <button
        type="button"
        className="rc-device-rename"
        onClick={() => onRename(device)}
        disabled={renaming}
        title="修改备注名"
        aria-label={`修改「${label}」的备注名`}
      >
        {renaming ? <Icons.Spinner size={11} className="spin" /> : <Icons.Pencil size={11} />}
      </button>
    </div>
  )
}

export function RemoteControlView() {
  const { t, requestPrompt } = useApp()
  const { toast } = useToast()
  const relay = useRemoteRelay()
  /** 独立窗口模式：隐藏主窗口专属的侧栏展开按钮，改渲染窗口控制按钮 */
  const isStandaloneWindow = isRemoteControlWindowMode()
  /**
   * 上次停留的设备与会话从本地状态恢复：远程视图是 lazy 挂载的，切走再回来组件
   * 就是新的，只靠模块级缓存能救列表、救不了「选中的是哪台机器哪个会话」。
   * 首次渲染就带出来，避免「先闪一下设备列表再跳进会话」。
   */
  const [restored] = useState(() => readRemoteViewState())
  const [pickedDeviceId, setPickedDeviceId] = useState<string | null>(restored.lastDeviceId)
  /** 会话选择与设备绑定存储：设备切换后旧会话不再生效，避免串到别的电脑上 */
  const [selection, setSelection] = useState<{ deviceId: string; sessionId: string } | null>(() => {
    const deviceId = restored.lastDeviceId
    const ref = deviceId != null ? restored.lastSessionByDevice[deviceId] : null
    return deviceId != null && ref != null ? { deviceId, sessionId: ref.sessionId } : null
  })
  /** 顶部设备切换器形态（自动 / Tab 栏 / 下拉），持久化在本机 */
  const [deviceSwitcher, setDeviceSwitcher] = useState<RemoteDeviceSwitcherMode>(() =>
    readDeviceSwitcher(),
  )
  /** 正在保存备注名的设备：按钮显示 spinner，避免连点写出多条 */
  const [aliasPendingId, setAliasPendingId] = useState<string | null>(null)
  /**
   * 右侧项目信息面板：open 是显式开关（持久化，2026-11-25 起默认打开——
   * 未持久化过时展开；手动关过则跟随用户选择，不再强开）；
   * pinnedProjectId 是项目右键菜单锁定的项目。
   * 不锁定时面板跟随当前选中会话的项目（会话切换自动跟随，无需手动刷新）。
   */
  const [projectPanelOpen, setProjectPanelOpenState] = useState(() =>
    readRemoteProjectPanelOpen(),
  )
  /** 开关统一走这里：状态与持久化同步写（用户手动关过就记住，下次不再强开） */
  const setProjectPanelOpen = useCallback((next: boolean) => {
    setProjectPanelOpenState(next)
    rememberRemoteProjectPanelOpen(next)
  }, [])
  const [panelPinnedProjectId, setPanelPinnedProjectId] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState<RemoteProjectPanelTab>('session')
  const [projectPanelWidth, setProjectPanelWidth] = useState(readRemoteProjectPanelWidth)

  const onlineDevices = useMemo(
    () => relay.devices.filter((device) => device.online),
    [relay.devices],
  )

  /**
   * 生效设备全部由派生得出，不在 effect 里回写 state：
   *   - 显式选过且仍在线 → 用显式选择；
   *   - 没选过且只有一台在线 → 直接进入，省掉一次点击；
   *   - 其余（含选中设备已下线）→ 回到设备列表。
   */
  const singleOnlineId = onlineDevices.length === 1 ? (onlineDevices[0]?.deviceId ?? null) : null
  const activeDeviceId =
    pickedDeviceId != null && onlineDevices.some((device) => device.deviceId === pickedDeviceId)
      ? pickedDeviceId
      : pickedDeviceId == null
        ? singleOnlineId
        : null
  const activeDevice =
    activeDeviceId != null
      ? (relay.devices.find((device) => device.deviceId === activeDeviceId) ?? null)
      : null
  const activeSessionId =
    selection != null && selection.deviceId === activeDeviceId ? selection.sessionId : null
  // 订阅侧栏缓存版本：锁定项目在目标端被删除后，下方派生值要能感知并自动回落。
  // 版本号只用来驱动重渲染（删除发生在 store 写回层，本组件没有 setState 时机）。
  // （必须在 activeDeviceId 派生之后声明，快照函数引用了它）
  useSyncExternalStore(
    subscribeRemoteSessionStore,
    () => (activeDeviceId != null ? getRemoteSessionStore(activeDeviceId).version : 0),
    () => 0,
  )
  // 锁定的项目已不在缓存列表里（目标端删除）→ 视为失效，回落跟随选中会话；
  // 项目列表还没拉到（空）时不判定删除，避免设备刚切换时误清。
  const pinnedProjectValid =
    panelPinnedProjectId == null ||
    (() => {
      if (activeDeviceId == null) return false
      const store = getRemoteSessionStore(activeDeviceId)
      if (store.projects.length === 0) return true
      return store.projects.some((project) => project.id === panelPinnedProjectId)
    })()
  const effectivePinnedProjectId = pinnedProjectValid ? panelPinnedProjectId : null
  /** 面板展示的项目：有效锁定优先，否则跟随当前选中会话的项目 */
  const panelProjectId =
    effectivePinnedProjectId ??
    (activeDeviceId != null && activeSessionId != null
      ? findSessionProjectId(activeDeviceId, activeSessionId)
      : null)
  // 标题栏跟随侧栏缓存（改名后立刻同步），所以要在组件顶层取，不能在 renderBody 里
  const sessionTitle = useRemoteSessionTitle(activeDeviceId ?? '', activeSessionId)

  const handleProjectPanelResize = useCallback((nextWidth: number, commit: boolean) => {
    const width = clampRemoteProjectPanelWidth(nextWidth)
    setProjectPanelWidth(width)
    if (commit) rememberRemoteProjectPanelWidth(width)
  }, [])

  const handleSelectDevice = useCallback((next: string) => {
    setPickedDeviceId(next)
    rememberLastDevice(next)
    // 切到这台机器时把它上次的会话一起带回来，不用重新在项目树里找一遍
    const remembered = readLastSession(next)
    setSelection(remembered != null ? { deviceId: next, sessionId: remembered.sessionId } : null)
    // 与 handleSwitchDevice 同理：锁定的项目属于旧设备，跨设备残留会在新设备上
    // 请求一个不存在的项目，面板永远显示「未关联目录」占位
    setPanelPinnedProjectId(null)
  }, [])

  const handleSwitchDevice = useCallback(() => {
    setPickedDeviceId(null)
    setSelection(null)
    // 换机器后锁定的项目属于旧设备：解锁让面板回落「跟随选中会话」
    setPanelPinnedProjectId(null)
  }, [])

  /** 项目右键菜单 → 打开信息面板并锁定该项目（不受会话切换影响） */
  const handleOpenProjectInfo = useCallback((projectId: string) => {
    setPanelPinnedProjectId(projectId)
    setPanelTab('project')
    setProjectPanelOpen(true)
  }, [])

  /** 聊天头部按钮：开着就关；没开则跟随当前会话项目打开（没有选中会话时不响应） */
  const handleToggleProjectPanel = useCallback(() => {
    setProjectPanelOpen(!projectPanelOpen)
    setPanelPinnedProjectId(null)
    setPanelTab('session')
  }, [projectPanelOpen, setProjectPanelOpen])

  const handleCloseProjectPanel = useCallback(() => {
    setProjectPanelOpen(false)
    setPanelPinnedProjectId(null)
  }, [])

  const handleSelectSession = useCallback(
    (next: string) => {
      if (activeDeviceId == null) return
      setSelection({ deviceId: activeDeviceId, sessionId: next })
      // 单设备场景的 activeDeviceId 是派生值，没有经过设备卡片点击；选会话时也要落盘设备。
      rememberLastDevice(activeDeviceId)
      rememberLastSession(activeDeviceId, {
        sessionId: next,
        projectId: findSessionProjectId(activeDeviceId, next),
      })
    },
    [activeDeviceId],
  )

  const handleSelectSessionFromPanel = useCallback(
    (next: string) => {
      handleSelectSession(next)
      setPanelPinnedProjectId(null)
      setPanelTab('session')
    },
    [handleSelectSession],
  )

  const handleClearSession = useCallback(() => {
    setSelection(null)
    if (activeDeviceId != null) rememberLastSession(activeDeviceId, null)
  }, [activeDeviceId])

  /** 记住的会话已经被删 / 换机器打了不开了：回落列表，别让用户对着报错干等 */
  const handleSessionInvalid = useCallback(() => {
    setSelection(null)
    if (activeDeviceId != null) {
      rememberLastSession(activeDeviceId, null)
      toast.info('这个会话已经不存在了，已回到会话列表')
    }
  }, [activeDeviceId, toast])

  /**
   * 改备注名：只写本机设置（不上报目标机）。
   * 留空 = 清除备注，回落设备自报名；这样两台同名机器可以随时换回原样。
   */
  const handleRenameDevice = useCallback(
    async (device: RemoteAgentDeviceSummary) => {
      if (aliasPendingId != null) return
      const realName = device.name?.trim() || '未命名设备'
      const next = await requestPrompt({
        title: '修改设备备注名',
        description: `这台电脑的自报名是「${realName}」。备注名只保存在本机，不会改到对方电脑上；留空即恢复原名。`,
        value: device.alias ?? '',
        placeholder: '例如：公司台式机、家里的 iMac、渲染机',
        confirmText: '保存',
      })
      if (next == null) return
      const alias = next.trim()
      setAliasPendingId(device.deviceId)
      try {
        await relay.setDeviceAlias(device.deviceId, alias.length > 0 ? alias : null)
        toast.success(alias.length > 0 ? `备注名已保存：${alias}` : '已恢复设备原名')
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : '备注名保存失败')
      } finally {
        setAliasPendingId(null)
      }
    },
    [aliasPendingId, relay, requestPrompt, toast],
  )

  /** 至少两台「在线」设备才给切换入口：只多一台离线机器时没什么可切的 */
  const canSwitchDevice = onlineDevices.length > 1

  /** 主窗口页头入口：把远程界面挪到独立窗口（已打开则聚焦那个窗口） */
  const handleOpenStandaloneWindow = useCallback(async () => {
    try {
      const response = await window.spark.invoke('remote-control:window:open', {})
      if (!response.success) toast.error('独立窗口打开失败，请重试')
    } catch {
      toast.error('独立窗口打开失败，请重试')
    }
  }, [toast])
  /**
   * 切换器形态：auto 按设备规模判定（少则 Tab、多则下拉），显式选择优先。
   * 两台设备是最常见场景，Tab 少一次点击，所以 auto 默认倾向 Tab。
   */
  const switcherShape = useMemo(
    () => resolveDeviceSwitcherMode(deviceSwitcher, onlineDevices.length, relay.devices.length),
    [deviceSwitcher, onlineDevices.length, relay.devices.length],
  )

  const handleSwitcherModeChange = useCallback((next: RemoteDeviceSwitcherMode) => {
    setDeviceSwitcher(rememberDeviceSwitcher(next).deviceSwitcher)
  }, [])

  const relayLabel = relay.status.connected
    ? '中继已连接'
    : relay.connecting || relay.status.state === 'connecting'
      ? '正在连接中继…'
      : relay.status.state === 'reconnecting'
        ? '中继重连中…'
        : '中继未连接'

  const renderBody = () => {
    if (!relay.status.connected) {
      return (
        <div className="rc-state">
          <Icons.RemoteMonitor size={28} />
          <h3>{relayLabel}</h3>
          <p>
            {relay.error ??
              '远程操作依赖账号中继。请确认已登录、网络可用，并在设置中保持了远程连接开启。'}
          </p>
          <button type="button" className="rc-primary-btn" onClick={() => void relay.refresh(true)}>
            重新连接
          </button>
        </div>
      )
    }

    if (relay.devices.length === 0) {
      return (
        <div className="rc-state">
          <Icons.RemoteMonitor size={28} />
          <h3>没有其它在线电脑</h3>
          <p>
            在另一台电脑上登录同一个 SparkWork
            账号，中继会自动把它登记为可操作设备。本机不会出现在此列表中。
          </p>
          <button
            type="button"
            className="rc-secondary-btn"
            onClick={() => void relay.refresh(false)}
          >
            刷新列表
          </button>
        </div>
      )
    }

    if (activeDeviceId == null || activeDevice == null) {
      return (
        <div className="rc-device-picker">
          <div className="rc-section-title">选择一台电脑</div>
          <div className="rc-device-grid">
            {relay.devices.map((device) => (
              <DeviceCard
                key={device.deviceId}
                device={device}
                onSelect={handleSelectDevice}
                onRename={(target) => void handleRenameDevice(target)}
                renaming={aliasPendingId === device.deviceId}
              />
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="rc-workspace">
        <RemoteSessionPane
          deviceId={activeDeviceId}
          deviceName={deviceLabel(activeDevice)}
          deviceRealName={deviceRealName(activeDevice)}
          selectedSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onSwitchDevice={handleSwitchDevice}
          canSwitchDevice={onlineDevices.length > 1}
          onClearSession={handleClearSession}
          onRenameDevice={() => void handleRenameDevice(activeDevice)}
          renamingDevice={aliasPendingId === activeDevice.deviceId}
          onOpenProjectInfo={handleOpenProjectInfo}
        />
        <RemoteChatPane
          deviceId={activeDeviceId}
          sessionId={activeSessionId}
          sessionTitle={sessionTitle}
          deviceName={deviceLabel(activeDevice)}
          onSessionInvalid={handleSessionInvalid}
          projectPanelOpen={projectPanelOpen && panelProjectId != null}
          onToggleProjectPanel={activeSessionId != null ? handleToggleProjectPanel : undefined}
        />
        {projectPanelOpen && panelProjectId != null && (
          <RemoteProjectPanel
            deviceId={activeDeviceId}
            projectId={panelProjectId}
            sessionId={activeSessionId}
            sessionTitle={sessionTitle}
            deviceLabel={deviceLabel(activeDevice)}
            activeTab={panelTab}
            onTabChange={setPanelTab}
            width={projectPanelWidth}
            onResize={handleProjectPanelResize}
            onSelectSession={handleSelectSessionFromPanel}
            onClose={handleCloseProjectPanel}
          />
        )}
      </div>
    )
  }

  return (
    <div className="remote-control">
      <header
        className="rc-head"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => undefined)
        }}
      >
        <div className="rc-head-left">
          {t.sidebarHidden && !isStandaloneWindow && <SidebarExpandButton />}
          <Icons.RemoteMonitor size={16} />
          <h2>远程</h2>
          {activeDevice != null && (
            <RemoteDeviceSwitcher
              devices={relay.devices}
              activeDevice={activeDevice}
              canSwitch={canSwitchDevice}
              shape={switcherShape}
              mode={deviceSwitcher}
              onModeChange={handleSwitcherModeChange}
              onSelectDevice={handleSelectDevice}
            />
          )}
        </div>
        <div className="rc-head-right">
          <span className={`rc-relay-pill${relay.status.connected ? ' online' : ''}`}>
            <span className="rc-relay-dot" />
            {relayLabel}
          </span>
          <button
            type="button"
            className="rc-icon-btn"
            onClick={() => void relay.refresh(true)}
            aria-label="刷新远程设备"
            title="刷新远程设备"
          >
            <Icons.Refresh size={14} />
          </button>
          {!isStandaloneWindow && (
            <button
              type="button"
              className="rc-icon-btn"
              onClick={() => void handleOpenStandaloneWindow()}
              aria-label="在独立窗口中打开"
              title="在独立窗口中打开"
            >
              <Icons.ExternalLink size={14} />
            </button>
          )}
          {isStandaloneWindow && <WindowControls />}
        </div>
      </header>
      <div className="rc-body">{renderBody()}</div>
    </div>
  )
}
