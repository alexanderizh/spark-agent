import React, { useCallback, useMemo, useRef, useState } from 'react'
import type { SubAppDetails, SubAppManifest, SubAppSurface } from '@spark/protocol'
import { subAppClient } from './subAppClient'
import { SubAppRunner } from './SubAppRunner'
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
    () => ({ instances, open, close, toggleCollapse }),
    [instances, open, close, toggleCollapse],
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
}): React.ReactElement | null {
  const { instances } = controller
  const overlays = instances.filter((item) => item.kind === 'overlay')
  const panels = instances.filter((item) => item.kind === 'panel')
  if (overlays.length === 0 && panels.length === 0) return null
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
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
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
    dragState.current = null
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
  return (
    <aside className="subapp-panel-dock" data-testid="subapp-panel-dock" aria-label={instance.name}>
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
