import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SubAppDetails, SubAppManifest, SubAppSummary, SubAppSurface } from '@spark/protocol'
import { subAppClient } from './subAppClient'
import { SubAppIcon } from './SubAppIcon'
import { SubAppRunner } from './SubAppRunner'
import { SUB_APP_DIRECTORY_CHANGED_EVENT } from './subAppEvents'
import { SubAppSurfaceLauncher } from './SubAppSurfaceLauncher'
import './SubAppSurfaceHost.less'

/**
 * 主窗口内多 surface 运行宿主（overlay / panel）。
 *
 * 层级治理：应用浮层 root 固定 z-index 900——高于内容区普通流，
 * 低于 antd Modal/Message（≥1000）、Git 面板（1200+）、语音 UI（10000）。
 * 应用不得自行写更大 z-index 抢占平台弹层；这是宿主对浮层的唯一层级出口。
 *
 * 实例约束：overlay 最多 3 个（超出替换最旧），panel 最多 1 个（后开替换）；
 * 关闭浮层只销毁该实例的 SubAppRunner（iframe + bridge host 随组件卸载），
 * 不影响其他实例与运行页。
 */

const MAX_OVERLAY_INSTANCES = 3
const MAX_PANEL_INSTANCES = 1

/** overlay 拖拽位置按 appId 记忆（下次打开恢复），panel 宽度全局记忆。 */
const OVERLAY_POS_KEY_PREFIX = 'spark-agent:subapp-overlay-pos:'
const PANEL_WIDTH_KEY = 'spark-agent:subapp-panel-width'
const PANEL_WIDTH_MIN = 280
const PANEL_WIDTH_MAX = 560
const PANEL_WIDTH_DEFAULT = 360

function readOverlayOffset(appId: string): { x: number; y: number } | null {
  try {
    const raw = window.localStorage.getItem(OVERLAY_POS_KEY_PREFIX + appId)
    if (raw == null) return null
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown }
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      Math.abs(parsed.x) > 8192 ||
      Math.abs(parsed.y) > 8192
    ) {
      return null
    }
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

function persistOverlayOffset(appId: string, offset: { x: number; y: number }): void {
  try {
    window.localStorage.setItem(OVERLAY_POS_KEY_PREFIX + appId, JSON.stringify(offset))
  } catch {
    // 存储满/隐私模式时静默降级为不记忆
  }
}

function readPanelWidth(): number {
  const raw = Number(window.localStorage.getItem(PANEL_WIDTH_KEY))
  if (!Number.isFinite(raw) || raw < PANEL_WIDTH_MIN || raw > PANEL_WIDTH_MAX) {
    return PANEL_WIDTH_DEFAULT
  }
  return raw
}

interface SurfaceInstance {
  key: string
  kind: 'overlay' | 'panel'
  appId: string
  name: string
  manifest: SubAppManifest
  source: string
  collapsed: boolean
}

export interface SubAppSurfaceController {
  instances: SurfaceInstance[]
  /** 已发布+启用的浮层/侧板应用目录（胶囊启动器与侧板菜单的数据源）。 */
  directory: SubAppSummary[]
  /** 按应用 manifest 的 surface 打开 overlay/panel 实例；已在跑则不重复开。 */
  open: (appId: string) => Promise<void>
  close: (key: string) => void
  toggleCollapse: (key: string) => void
}

const SurfaceContext = React.createContext<SubAppSurfaceController | null>(null)

export function useSubAppSurfaces(): SubAppSurfaceController {
  const controller = React.useContext(SurfaceContext)
  if (controller == null) {
    throw new Error('useSubAppSurfaces 必须在 SubAppSurfaceProvider 内使用')
  }
  return controller
}

function kindOfSurface(surface: SubAppSurface): 'overlay' | 'panel' | null {
  if (surface === 'overlay') return 'overlay'
  if (surface === 'panel') return 'panel'
  return null
}

export function SubAppSurfaceProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [instances, setInstances] = useState<SurfaceInstance[]>([])
  const [directory, setDirectory] = useState<SubAppSummary[]>([])

  // 浮层/侧板应用目录：这些 surface 不进侧栏菜单，入口是右下角胶囊
  // 启动器与侧板 tab。目录变化（发布/启用/禁用/删除）经 renderer 事件刷新。
  useEffect(() => {
    let cancelled = false
    const loadDirectory = async (): Promise<void> => {
      try {
        const res = await subAppClient.list({ menuOnly: true, limit: 50 })
        if (cancelled) return
        setDirectory(
          res.items.filter((item) => item.surface === 'overlay' || item.surface === 'panel'),
        )
      } catch {
        if (!cancelled) setDirectory([])
      }
    }
    void loadDirectory()
    const handleDirectoryChanged = () => void loadDirectory()
    window.addEventListener(SUB_APP_DIRECTORY_CHANGED_EVENT, handleDirectoryChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SUB_APP_DIRECTORY_CHANGED_EVENT, handleDirectoryChanged)
    }
  }, [])

  const open = useCallback(async (appId: string): Promise<void> => {
    let details: SubAppDetails
    try {
      details = await subAppClient.get({ appId })
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }
    const kind = kindOfSurface(details.draft.manifest.surface)
    if (kind == null) return
    setInstances((prev) => {
      if (prev.some((item) => item.appId === appId)) return prev
      const instance: SurfaceInstance = {
        key: `${kind}-${appId}-${Date.now()}`,
        kind,
        appId,
        name: details.name,
        manifest: details.draft.manifest,
        source: details.draft.source,
        collapsed: false,
      }
      const cap = kind === 'overlay' ? MAX_OVERLAY_INSTANCES : MAX_PANEL_INSTANCES
      const sameKind = prev.filter((item) => item.kind === kind)
      const others = prev.filter((item) => item.kind !== kind)
      const nextSameKind = [...sameKind, instance].slice(-cap)
      return [...others, ...nextSameKind]
    })
  }, [])

  const close = useCallback((key: string): void => {
    setInstances((prev) => prev.filter((item) => item.key !== key))
  }, [])

  const toggleCollapse = useCallback((key: string): void => {
    setInstances((prev) =>
      prev.map((item) => (item.key === key ? { ...item, collapsed: !item.collapsed } : item)),
    )
  }, [])

  const controller = useMemo<SubAppSurfaceController>(
    () => ({ instances, directory, open, close, toggleCollapse }),
    [instances, directory, open, close, toggleCollapse],
  )

  return (
    <SurfaceContext.Provider value={controller}>
      <SubAppSurfaceLayer controller={controller} />
      {children}
    </SurfaceContext.Provider>
  )
}

/** 渲染层：必须放在 Provider children 渲染树之外、主内容区尾部（fixed 定位）。 */
function SubAppSurfaceLayer({
  controller,
}: {
  controller: SubAppSurfaceController
}): React.ReactElement {
  const { instances } = controller
  const overlays = instances.filter((item) => item.kind === 'overlay')
  const panels = instances.filter((item) => item.kind === 'panel')
  return (
    <div className="subapp-surface-layer" aria-label="子应用浮层">
      {panels.map((item) => (
        <SubAppPanelDock key={item.key} instance={item} controller={controller} />
      ))}
      <div className="subapp-overlay-stack">
        {overlays.map((item) => (
          <SubAppOverlayCard key={item.key} instance={item} controller={controller} />
        ))}
      </div>
      {/* 胶囊启动器常驻右下角：无实例时也要能随时打开浮层/侧板应用 */}
      <SubAppSurfaceLauncher controller={controller} />
    </div>
  )
}

function SubAppOverlayCard({
  instance,
  controller,
}: {
  instance: SurfaceInstance
  controller: SubAppSurfaceController
}): React.ReactElement {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(() =>
    readOverlayOffset(instance.appId),
  )
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    // 操作按钮区不进入拖拽：pointer capture 会把后续 click 的 target 改写为
    // 标题栏本身，导致收起/关闭按钮的 onClick 丢失。
    if ((event.target as HTMLElement).closest('.subapp-overlay-actions') != null) return
    const baseX = offset?.x ?? 0
    const baseY = offset?.y ?? 0
    dragState.current = { startX: event.clientX, startY: event.clientY, baseX, baseY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragState.current
    if (drag == null) return
    setOffset({
      x: drag.baseX + event.clientX - drag.startX,
      y: drag.baseY + event.clientY - drag.startY,
    })
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragState.current
    dragState.current = null
    if (drag != null) {
      // 拖拽结束才持久化，避免 move 高频写 localStorage
      setOffset((current) => {
        if (current != null) persistOverlayOffset(instance.appId, current)
        return current
      })
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // pointer capture 可能已释放（点掉标题栏的一瞬），忽略
    }
  }

  const dragStyle = useMemo<React.CSSProperties>(
    () =>
      offset == null
        ? {}
        : { transform: `translate(${offset.x}px, ${offset.y}px)`, right: 'auto', bottom: 'auto' },
    [offset],
  )

  return (
    <section
      className={`subapp-overlay-card${instance.collapsed ? ' is-collapsed' : ''}`}
      style={dragStyle}
      data-testid="subapp-overlay-card"
    >
      <header
        className="subapp-overlay-titlebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="subapp-overlay-name" title={instance.name}>
          {instance.name}
        </span>
        <div className="subapp-overlay-actions">
          <button
            type="button"
            aria-label={instance.collapsed ? '展开浮层' : '收起浮层'}
            onClick={() => controller.toggleCollapse(instance.key)}
          >
            {instance.collapsed ? '▴' : '▾'}
          </button>
          <button
            type="button"
            aria-label="关闭浮层"
            onClick={() => controller.close(instance.key)}
          >
            ✕
          </button>
        </div>
      </header>
      {instance.collapsed ? null : (
        <div className="subapp-overlay-body">
          <SubAppRunner
            appId={instance.appId}
            manifest={instance.manifest}
            source={instance.source}
            mode="draft"
            className="subapp-overlay-runner"
          />
        </div>
      )}
    </section>
  )
}

function SubAppPanelDock({
  instance,
  controller,
}: {
  instance: SurfaceInstance
  controller: SubAppSurfaceController
}): React.ReactElement {
  const [width, setWidth] = useState<number>(() => readPanelWidth())
  const resizeState = useRef<{ startX: number; baseWidth: number } | null>(null)

  const onResizeDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    resizeState.current = { startX: event.clientX, baseWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = resizeState.current
    if (drag == null) return
    // 右侧 dock：向左拖（clientX 减小）加宽
    const next = drag.baseWidth + (drag.startX - event.clientX)
    setWidth(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, next)))
  }
  const onResizeUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeState.current != null) {
      try {
        window.localStorage.setItem(PANEL_WIDTH_KEY, String(width))
      } catch {
        // 存储不可用时静默降级
      }
    }
    resizeState.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // capture 已释放时忽略
    }
  }

  // 统一侧面板菜单：dock 头部列出所有已启用的侧板应用，点击切换
  // （panel 容量 1，后开替换当前实例）。
  const panelApps = controller.directory.filter((app) => app.surface === 'panel')

  return (
    <aside
      className="subapp-panel-dock"
      style={{ width }}
      data-testid="subapp-panel-dock"
      aria-label={instance.name}
    >
      <div
        className="subapp-panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="调节侧栏宽度"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
      />
      <header className="subapp-panel-titlebar">
        <span className="subapp-panel-name" title={instance.name}>
          {instance.name}
        </span>
        <button
          type="button"
          aria-label="关闭侧栏应用"
          onClick={() => controller.close(instance.key)}
        >
          ✕
        </button>
      </header>
      {panelApps.length > 1 ? (
        <nav className="subapp-panel-tabs" aria-label="侧板应用菜单">
          {panelApps.map((app) => (
            <button
              type="button"
              key={app.id}
              className={`subapp-panel-tab${app.id === instance.appId ? ' is-active' : ''}`}
              aria-current={app.id === instance.appId ? 'true' : undefined}
              title={app.name}
              onClick={() => {
                if (app.id !== instance.appId) void controller.open(app.id)
              }}
            >
              <SubAppIcon icon={app.icon} size={14} />
              <span className="subapp-panel-tab-name">{app.name}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <div className="subapp-panel-body">
        <SubAppRunner
          appId={instance.appId}
          manifest={instance.manifest}
          source={instance.source}
          mode="draft"
          className="subapp-panel-runner"
        />
      </div>
    </aside>
  )
}
