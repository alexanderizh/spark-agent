/**
 * 远程 — 在桌面端直接操作另一台电脑上的 SparkWork。
 *
 * 与手机端（apps/mobile）的区别：
 *   - 不需要登录/配对：中继身份与账号来自当前桌面端登录态，主进程已按 deviceId 过滤本机；
 *   - 能力直接复用目标设备的 MobileBridge /v1/* 语义路由，无需另开协议；
 *   - UI 按桌面端设计语言重做（紧凑密度、中性灰、无渐变）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteAgentDeviceSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { useToast } from '../../components/Toast'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { RemoteChatPane } from './RemoteChatPane'
import { RemoteSessionPane } from './RemoteSessionPane'
import { deviceLabel, deviceRealName, deviceTooltip } from './remoteDevices'
import { findSessionProjectId } from './remoteSessionStore'
import {
  readLastSession,
  readRemoteViewState,
  rememberLastDevice,
  rememberLastSession,
} from './remoteViewState'
import { useRemoteRelay } from './useRemoteBridge'
import { useRemoteSessionTitle } from './useRemoteSessionTree'
import './remote-control.less'

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
  /** 顶部设备名下拉：只有多台设备时才当切换入口用 */
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false)
  /** 正在保存备注名的设备：按钮显示 spinner，避免连点写出多条 */
  const [aliasPendingId, setAliasPendingId] = useState<string | null>(null)
  const deviceMenuRef = useRef<HTMLDivElement | null>(null)

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
  // 标题栏跟随侧栏缓存（改名后立刻同步），所以要在组件顶层取，不能在 renderBody 里
  const sessionTitle = useRemoteSessionTitle(activeDeviceId ?? '', activeSessionId)

  const handleSelectDevice = useCallback((next: string) => {
    setPickedDeviceId(next)
    rememberLastDevice(next)
    // 切到这台机器时把它上次的会话一起带回来，不用重新在项目树里找一遍
    const remembered = readLastSession(next)
    setSelection(remembered != null ? { deviceId: next, sessionId: remembered.sessionId } : null)
  }, [])

  const handleSwitchDevice = useCallback(() => {
    setPickedDeviceId(null)
    setSelection(null)
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

  // 设备下拉：点外部 / Esc 关闭；切换设备后也立刻收起
  useEffect(() => {
    if (!deviceMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const node = deviceMenuRef.current
      if (node != null && event.target instanceof Node && node.contains(event.target)) return
      setDeviceMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeviceMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [deviceMenuOpen])

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
        />
        <RemoteChatPane
          deviceId={activeDeviceId}
          sessionId={activeSessionId}
          sessionTitle={sessionTitle}
          deviceName={deviceLabel(activeDevice)}
          onSessionInvalid={handleSessionInvalid}
        />
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
          {t.sidebarHidden && <SidebarExpandButton />}
          <Icons.RemoteMonitor size={16} />
          <h2>远程</h2>
          {activeDevice != null && (
            <div className="rc-head-device-wrap" ref={deviceMenuRef}>
              {canSwitchDevice ? (
                <button
                  type="button"
                  className={`rc-head-device is-switchable${deviceMenuOpen ? ' is-open' : ''}`}
                  onClick={() => setDeviceMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={deviceMenuOpen}
                  title={`切换电脑（当前：${deviceTooltip(activeDevice)}）`}
                >
                  <span className="rc-head-device-name">{deviceLabel(activeDevice)}</span>
                  <Icons.ChevronDown size={11} />
                </button>
              ) : (
                <span className="rc-head-device" title={deviceTooltip(activeDevice)}>
                  {deviceLabel(activeDevice)}
                </span>
              )}
              {deviceMenuOpen && (
                <div className="rc-device-menu" role="menu" aria-label="选择电脑">
                  <div className="rc-device-menu-title">切换到其它电脑</div>
                  {relay.devices.map((device) => {
                    const current = device.deviceId === activeDeviceId
                    return (
                      <button
                        key={device.deviceId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={current}
                        className={`rc-device-menu-item${current ? ' is-current' : ''}${
                          device.online ? '' : ' is-offline'
                        }`}
                        disabled={!device.online}
                        onClick={() => {
                          setDeviceMenuOpen(false)
                          if (!current) handleSelectDevice(device.deviceId)
                        }}
                      >
                        <span className={`rc-device-menu-dot${device.online ? ' online' : ''}`} />
                        <span className="rc-device-menu-name" title={deviceTooltip(device)}>
                          {deviceLabel(device)}
                          {deviceRealName(device) != null && (
                            <span className="rc-device-menu-real">{deviceRealName(device)}</span>
                          )}
                        </span>
                        {device.online ? (
                          current && <Icons.Check size={12} />
                        ) : (
                          <span className="rc-device-menu-state">离线</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
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
        </div>
      </header>
      <div className="rc-body">{renderBody()}</div>
    </div>
  )
}
