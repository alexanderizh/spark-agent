/**
 * 远程设备切换器 — 同一份设备数据，两种形态：
 *   - 'dropdown' 标题栏里的设备名 + 下拉菜单（原行为）；
 *   - 'tabs'     标题栏里的 Tab 栏，点一下直接切，另有尾部 chevron 打开完整菜单
 *                （离线设备、备注名、切回下拉都还在菜单里）。
 *
 * 形态选择属于「这台机器上这个人怎么用」的偏好，交给 remoteViewState 持久化；
 * 本组件只负责渲染 + 回调，不碰存储，方便单测。
 */
import { useEffect, useRef, useState } from 'react'
import type { RemoteAgentDeviceSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { deviceLabel, deviceRealName, deviceTooltip } from './remoteDevices'
import type { RemoteDeviceSwitcherMode } from './remoteViewState'

const SWITCHER_MODES: { id: RemoteDeviceSwitcherMode; label: string; hint: string }[] = [
  { id: 'auto', label: '自动', hint: '设备少时用 Tab，多了自动回到下拉' },
  { id: 'tabs', label: 'Tab 栏', hint: '标题栏常驻 Tab，点一下切换' },
  { id: 'dropdown', label: '下拉', hint: '点设备名展开菜单再选' },
]

export interface RemoteDeviceSwitcherProps {
  devices: RemoteAgentDeviceSummary[]
  activeDevice: RemoteAgentDeviceSummary
  /** 是否给切换入口；只有一台在线设备时连下拉都不需要 */
  canSwitch: boolean
  /** 实际生效的形态（已由 resolveDeviceSwitcherMode 解过 auto） */
  shape: 'tabs' | 'dropdown'
  /** 用户选的形态（含 auto），用于菜单里的三选一高亮 */
  mode: RemoteDeviceSwitcherMode
  onModeChange: (mode: RemoteDeviceSwitcherMode) => void
  onSelectDevice: (deviceId: string) => void
}

export function RemoteDeviceSwitcher({
  devices,
  activeDevice,
  canSwitch,
  shape,
  mode,
  onModeChange,
  onSelectDevice,
}: RemoteDeviceSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  /**
   * 轨道是否被容器裁掉：裁掉时右端做渐隐，否则最后一台设备的名字会硬切一半，
   * 看着像坏了。只在真的溢出时加类，未溢出不加（避免无谓的视觉噪点）。
   */
  const [trackScrollable, setTrackScrollable] = useState(false)

  useEffect(() => {
    if (shape !== 'tabs') return
    const node = trackRef.current
    if (node == null) return
    const sync = () => setTrackScrollable(node.scrollWidth - node.clientWidth > 1)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [devices.length, shape])

  // 点外部 / Esc 收起菜单；形态切换后菜单保持打开，方便连着调
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const node = wrapRef.current
      if (node != null && event.target instanceof Node && node.contains(event.target)) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menuOpen])

  if (!canSwitch) {
    return (
      <span className="rc-head-device" title={deviceTooltip(activeDevice)}>
        {deviceLabel(activeDevice)}
      </span>
    )
  }

  const handlePick = (device: RemoteAgentDeviceSummary) => {
    setMenuOpen(false)
    if (device.deviceId === activeDevice.deviceId || !device.online) return
    onSelectDevice(device.deviceId)
  }

  return (
    <div className="rc-head-device-wrap" ref={wrapRef}>
      {shape === 'tabs' ? (
        <div className="rc-device-tabs" role="tablist" aria-label="切换电脑">
          <div
            className={`rc-device-tabs-track${trackScrollable ? ' is-scrollable' : ''}`}
            ref={trackRef}
          >
            {devices.map((device) => {
              const current = device.deviceId === activeDevice.deviceId
              return (
                <button
                  key={device.deviceId}
                  type="button"
                  role="tab"
                  aria-selected={current}
                  className={`rc-device-tab${current ? ' is-current' : ''}${
                    device.online ? '' : ' is-offline'
                  }`}
                  disabled={!device.online}
                  title={deviceTooltip(device)}
                  onClick={() => handlePick(device)}
                >
                  <span className={`rc-device-tab-dot${device.online ? ' online' : ''}`} />
                  <span className="rc-device-tab-name">{deviceLabel(device)}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className={`rc-device-tabs-more${menuOpen ? ' is-open' : ''}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="更多设备 / 切换方式"
            aria-label="更多设备与切换方式"
          >
            <Icons.ChevronDown size={11} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`rc-head-device is-switchable${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={`切换电脑（当前：${deviceTooltip(activeDevice)}）`}
        >
          <span className="rc-head-device-name">{deviceLabel(activeDevice)}</span>
          <Icons.ChevronDown size={11} />
        </button>
      )}

      {menuOpen && (
        <div className="rc-device-menu" role="menu" aria-label="选择电脑">
          <div className="rc-device-menu-title">切换到其它电脑</div>
          {devices.map((device) => {
            const current = device.deviceId === activeDevice.deviceId
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
                onClick={() => handlePick(device)}
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
          <div className="rc-device-menu-foot">
            <span className="rc-device-menu-foot-label">切换方式</span>
            <div className="rc-device-seg" role="radiogroup" aria-label="设备切换方式">
              {SWITCHER_MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === item.id}
                  className={`rc-device-seg-btn${mode === item.id ? ' is-active' : ''}`}
                  title={item.hint}
                  onClick={() => onModeChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
