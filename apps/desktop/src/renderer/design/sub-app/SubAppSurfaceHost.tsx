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
 * 实例约束：overlay 最多 3 个（超出替换最旧），panel 最多 1 个（后开替换）。
 * overlay 是带公用头部的自由浮窗：头部（应用图标/名称 + 关闭）兼任拖动把手，
 * 应用本体（iframe）铺满头部之下的窗口区域；可三向拉伸（右/下/右下角），
 * 几何按 appId 持久化，多开时级联偏移。浮窗无收起态——关闭即销毁实例，
 * 重新打开走右下角胶囊启动器菜单；关闭只销毁该实例的 SubAppRunner
 * （iframe + bridge host 随组件卸载），不影响其他实例与运行页。
 */

const MAX_OVERLAY_INSTANCES = 3
const MAX_PANEL_INSTANCES = 1

/** 浮层窗口几何记忆（left/top 视口坐标 + width/height），按 appId 存储 */
const OVERLAY_GEOMETRY_PREFIX = 'spark-agent:subapp-overlay-geometry-v3'
const OVERLAY_MIN_WIDTH = 320
const OVERLAY_MIN_HEIGHT = 240
const OVERLAY_CASCADE_STEP = 32
const OVERLAY_VIEWPORT_MARGIN = 8

/** panel dock 宽度全局记忆。 */
const PANEL_WIDTH_KEY = 'spark-agent:subapp-panel-width'
const PANEL_WIDTH_MIN = 280
const PANEL_WIDTH_MAX = 960
const PANEL_WIDTH_DEFAULT = 360

function readPanelWidth(): number {
  const raw = Number(window.localStorage.getItem(PANEL_WIDTH_KEY))
  if (!Number.isFinite(raw) || raw < PANEL_WIDTH_MIN || raw > PANEL_WIDTH_MAX) {
    return PANEL_WIDTH_DEFAULT
  }
  // 已存宽度仍需受当前视口约束：小窗口下不超视口的 80%，且不跌破最小宽
  const viewportCap = Math.max(PANEL_WIDTH_MIN, Math.round(window.innerWidth * 0.8))
  return Math.min(raw, viewportCap)
}

interface OverlayGeometry {
  left: number
  top: number
  width: number
  height: number
}

/** 几何整体钳制在当前视口内：尺寸不越上下限，位置保证窗口完全可见。 */
function clampOverlayGeometry(geo: OverlayGeometry): OverlayGeometry {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxWidth = Math.max(OVERLAY_MIN_WIDTH, vw - OVERLAY_VIEWPORT_MARGIN * 2)
  const maxHeight = Math.max(OVERLAY_MIN_HEIGHT, vh - OVERLAY_VIEWPORT_MARGIN * 2)
  const width = Math.min(Math.max(geo.width, OVERLAY_MIN_WIDTH), maxWidth)
  const height = Math.min(Math.max(geo.height, OVERLAY_MIN_HEIGHT), maxHeight)
  const left = Math.min(
    Math.max(geo.left, OVERLAY_VIEWPORT_MARGIN),
    Math.max(OVERLAY_VIEWPORT_MARGIN, vw - OVERLAY_VIEWPORT_MARGIN - width),
  )
  const top = Math.min(
    Math.max(geo.top, OVERLAY_VIEWPORT_MARGIN),
    Math.max(OVERLAY_VIEWPORT_MARGIN, vh - OVERLAY_VIEWPORT_MARGIN - height),
  )
  return { left, top, width, height }
}

function readOverlayGeometry(appId: string): OverlayGeometry | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(window.localStorage.getItem(`${OVERLAY_GEOMETRY_PREFIX}:${appId}`) ?? '')
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed == null) return null
  const geo = parsed as Partial<Record<keyof OverlayGeometry, unknown>>
  const values = [geo.left, geo.top, geo.width, geo.height]
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null
  // 持久化时的视口可能比当前大（窗口缩小/换了显示器）：恢复时重新钳制
  return clampOverlayGeometry({
    left: geo.left as number,
    top: geo.top as number,
    width: geo.width as number,
    height: geo.height as number,
  })
}

function writeOverlayGeometry(appId: string, geo: OverlayGeometry): void {
  try {
    window.localStorage.setItem(`${OVERLAY_GEOMETRY_PREFIX}:${appId}`, JSON.stringify(geo))
  } catch {
    // 存储不可用时静默降级（本次会话内几何仍生效）
  }
}

/** 首次打开的默认几何：内容区（.main）的 85% 居中，多开按序级联偏移。 */
function defaultOverlayGeometry(cascadeIndex: number): OverlayGeometry {
  const area = document
    .querySelector<HTMLElement>('.main-content-area .main')
    ?.getBoundingClientRect()
  const baseLeft = area?.left ?? 0
  const baseTop = area?.top ?? 0
  const baseWidth = area?.width ?? window.innerWidth
  const baseHeight = area?.height ?? window.innerHeight
  const width = Math.max(OVERLAY_MIN_WIDTH, Math.round(baseWidth * 0.85))
  const height = Math.max(OVERLAY_MIN_HEIGHT, Math.round(baseHeight * 0.85))
  const offset = (cascadeIndex % 5) * OVERLAY_CASCADE_STEP
  return clampOverlayGeometry({
    left: Math.round(baseLeft + (baseWidth - width) / 2) + offset,
    top: Math.round(baseTop + (baseHeight - height) / 2) + offset,
    width,
    height,
  })
}

interface SurfaceInstance {
  key: string
  kind: 'overlay' | 'panel'
  appId: string
  name: string
  icon: string | null
  manifest: SubAppManifest
  source: string
}

export interface SubAppSurfaceController {
  instances: SurfaceInstance[]
  /** 已发布+启用的浮层/侧板应用目录（胶囊启动器与侧板菜单的数据源）。 */
  directory: SubAppSummary[]
  /** 目录首载是否完成：未完成前 directory 为空不代表「无 panel 应用」，消费方据此避免误清理 */
  directoryLoaded: boolean
  /** 按应用 manifest 的 surface 打开 overlay/panel 实例；已在跑则不重复开。 */
  open: (appId: string) => Promise<void>
  close: (key: string) => void
  /**
   * panel 应用改由统一侧面板承载（ChatView 挂载时注册处理器）：
   * open() 遇 panel surface 优先转发；未注册（如画布模式）回落到 dock 渲染。
   */
  setPanelOpenHandler: (handler: ((appId: string) => void) | null) => void
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
  const [directoryLoaded, setDirectoryLoaded] = useState(false)
  // 统一侧面板注册的 panel 打开处理器；ref 存储避免 open 回调依赖变化导致 consumers 重渲染
  const panelOpenHandlerRef = useRef<((appId: string) => void) | null>(null)

  const setPanelOpenHandler = useCallback((handler: ((appId: string) => void) | null): void => {
    panelOpenHandlerRef.current = handler
  }, [])

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
        setDirectoryLoaded(true)
      } catch {
        if (!cancelled) {
          setDirectory([])
          setDirectoryLoaded(true)
        }
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
    // panel 应用优先转发给统一侧面板（作为 subapp tab 打开）；无处理器时回落 dock
    if (kind === 'panel') {
      const handler = panelOpenHandlerRef.current
      if (handler != null) {
        handler(appId)
        return
      }
    }
    setInstances((prev) => {
      const existing = prev.find((item) => item.appId === appId)
      // 已在跑的不重复开；浮窗关闭即销毁，重开走胶囊启动器菜单
      if (existing != null) return prev
      const instance: SurfaceInstance = {
        key: `${kind}-${appId}-${Date.now()}`,
        kind,
        appId,
        name: details.name,
        icon: details.icon,
        manifest: details.draft.manifest,
        source: details.draft.source,
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

  const controller = useMemo<SubAppSurfaceController>(
    () => ({
      instances,
      directory,
      directoryLoaded,
      open,
      close,
      setPanelOpenHandler,
    }),
    [instances, directory, directoryLoaded, open, close, setPanelOpenHandler],
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
  const panels = instances.filter((item) => item.kind === 'panel')
  const overlays = instances.filter((item) => item.kind === 'overlay')
  return (
    <div className="subapp-surface-layer" aria-label="子应用浮层">
      {panels.map((item) => (
        <SubAppPanelDock key={item.key} instance={item} controller={controller} />
      ))}
      {/* 浮层：带公用头部的自由浮窗，多开按序级联偏移 */}
      {overlays.map((item, index) => (
        <SubAppOverlayCard
          key={item.key}
          instance={item}
          controller={controller}
          cascadeIndex={index}
        />
      ))}
      {/* 胶囊启动器常驻右下角：无实例时也要能随时打开浮层/侧板应用 */}
      <SubAppSurfaceLauncher controller={controller} />
    </div>
  )
}

type ResizeDir = 'e' | 's' | 'se'

/**
 * 浮层：带公用头部的自由浮窗。头部（应用图标/名称 + 关闭按钮）兼任窗口
 * 拖动把手——iframe 隔离鼠标事件，宿主必须提供移动入口；应用本体
 * （runner iframe）铺满头部之下的窗口区域。窗口有独立几何（默认取内容区
 * 85% 居中，多开级联偏移），可三向拉伸（右缘/下缘/右下角），几何按 appId
 * 持久化并在恢复/拖拽/拉伸时整体钳制在视口内。无收起态：关闭即销毁实例。
 */
function SubAppOverlayCard({
  instance,
  controller,
  cascadeIndex,
}: {
  instance: SurfaceInstance
  controller: SubAppSurfaceController
  cascadeIndex: number
}): React.ReactElement {
  const [geometry, setGeometry] = useState<OverlayGeometry>(
    // 惰性初始化只取一次：级联偏移按打开序固定，重渲染不重算
    () => readOverlayGeometry(instance.appId) ?? defaultOverlayGeometry(cascadeIndex),
  )
  // 拖拽/拉伸共享的指针会话：dir 为 null 表示移动窗口；latest 记录手势内
  // 最新几何（pointerup 时 state 可能尚未 flush，持久化必须读它而不是 ref）
  const dragState = useRef<{
    dir: ResizeDir | null
    startX: number
    startY: number
    base: OverlayGeometry
    latest: OverlayGeometry
  } | null>(null)

  const beginGesture = useCallback(
    (dir: ResizeDir | null) =>
      (event: React.PointerEvent<HTMLElement>): void => {
        if (event.button !== 0) return
        dragState.current = {
          dir,
          startX: event.clientX,
          startY: event.clientY,
          base: geometry,
          latest: geometry,
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // jsdom 等无 capture 环境忽略
        }
      },
    [geometry],
  )

  const moveGesture = useCallback((event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragState.current
    if (drag == null) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const base = drag.base
    let next: OverlayGeometry
    if (drag.dir == null) {
      // 移动窗口：整体平移，钳制保证标题抓手始终可达
      next = clampOverlayGeometry({ ...base, left: base.left + dx, top: base.top + dy })
    } else {
      next = { ...base }
      if (drag.dir === 'e' || drag.dir === 'se') next.width = base.width + dx
      if (drag.dir === 's' || drag.dir === 'se') next.height = base.height + dy
      // 拉伸只改右/下边界：left/top 不动，钳制会截断越界尺寸（尺寸顶到
      // 视口边缘时左/上边界被反推，窗口始终保持完全可见）
      next = clampOverlayGeometry(next)
    }
    drag.latest = next
    setGeometry(next)
  }, [])

  const endGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      if (dragState.current != null) {
        writeOverlayGeometry(instance.appId, dragState.current.latest)
        dragState.current = null
      }
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // capture 已释放时忽略
      }
    },
    [instance.appId],
  )

  // 窗口尺寸变化后把记忆几何重新钳回视口（用户缩小窗口时浮窗不悬空）
  useEffect(() => {
    const onResize = (): void => {
      setGeometry((prev) => clampOverlayGeometry(prev))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <section
      className="subapp-overlay-card"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
      }}
      data-testid="subapp-overlay-card"
    >
      {/* 公用头部：仅关闭入口（应用自带标题/图标，宿主不重复展示），
          兼任窗口拖动把手（iframe 会吃指针，宿主提供移动入口）；
          头部内按钮不吃拖拽，click 正常触发 */}
      <header
        className="subapp-overlay-header"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button') != null) return
          beginGesture(null)(event)
        }}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
      >
        <button type="button" aria-label="关闭浮层" onClick={() => controller.close(instance.key)}>
          ✕
        </button>
      </header>
      {/* 应用本体：iframe 铺满头部之下的窗口区域，容器只负责边界与裁切 */}
      <SubAppRunner
        appId={instance.appId}
        manifest={instance.manifest}
        source={instance.source}
        mode="draft"
        className="subapp-overlay-runner"
      />
      {/* 三向拉伸手柄：右缘加宽、下缘加高、右下角同时改宽高 */}
      {(['e', 's', 'se'] as const).map((dir) => (
        <div
          key={dir}
          className="subapp-overlay-resize"
          data-dir={dir}
          role="separator"
          aria-label="拉伸浮窗"
          onPointerDown={beginGesture(dir)}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
        />
      ))}
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
    // 右侧 dock：向左拖（clientX 减小）加宽；上限取常量与视口 80% 的较小者
    const viewportCap = Math.max(PANEL_WIDTH_MIN, Math.round(window.innerWidth * 0.8))
    const next = drag.baseWidth + (drag.startX - event.clientX)
    setWidth(Math.min(Math.min(PANEL_WIDTH_MAX, viewportCap), Math.max(PANEL_WIDTH_MIN, next)))
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

  // ESC 关闭：dock 是常驻右侧的浮层，键盘关闭与头部 ✕ 等价。
  // 限制：焦点在子应用 iframe 内时按键不冒泡到宿主文档，ESC 不生效；
  // isComposing 时是输入法取消候选词，不当作关闭。
  // 宿主 antd 弹窗（Modal/Drawer）开着时让 ESC 只关弹窗，不连坐关闭侧板
  // （弹窗默认按需挂载，关闭后节点即卸载，存在即视为打开）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      const hostOverlayOpen = document.querySelector('.ant-modal-wrap, .ant-drawer-content') != null
      if (hostOverlayOpen) return
      controller.close(instance.key)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller, instance.key])

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
