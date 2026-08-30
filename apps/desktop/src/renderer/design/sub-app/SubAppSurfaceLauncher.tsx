import React, { useEffect, useRef, useState } from 'react'
import type { SubAppSummary } from '@spark/protocol'
import { Icons } from '../Icons'
import { SubAppIcon } from './SubAppIcon'
import type { SubAppSurfaceController } from './SubAppSurfaceHost'

/** 胶囊启动器位置记忆（右下锚定，窗口缩放时天然跟随边缘不会跑出屏幕）。 */
const LAUNCHER_POS_KEY = 'spark-agent:subapp-launcher-pos:v1'
const LAUNCHER_SIZE = 44
const LAUNCHER_MARGIN = 8
/** 位移超过该阈值才算拖动，否则视为点击（展开菜单）。 */
const DRAG_THRESHOLD = 4
/** 指针离开启动器区域后延迟收起菜单：给「胶囊 ↔ 菜单」间往返留缓冲。 */
const HOVER_CLOSE_DELAY = 200

interface LauncherPos {
  right: number
  bottom: number
}

function readLauncherPos(): LauncherPos | null {
  try {
    const raw = window.localStorage.getItem(LAUNCHER_POS_KEY)
    if (raw == null) return null
    const parsed = JSON.parse(raw) as { right?: unknown; bottom?: unknown }
    if (
      typeof parsed.right !== 'number' ||
      typeof parsed.bottom !== 'number' ||
      !Number.isFinite(parsed.right) ||
      !Number.isFinite(parsed.bottom) ||
      parsed.right < 0 ||
      parsed.bottom < 0 ||
      parsed.right > 8192 ||
      parsed.bottom > 8192
    ) {
      return null
    }
    return { right: parsed.right, bottom: parsed.bottom }
  } catch {
    return null
  }
}

function persistLauncherPos(pos: LauncherPos): void {
  try {
    window.localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(pos))
  } catch {
    // 存储不可用时静默降级为不记忆
  }
}

function clampPos(value: number): number {
  // 胶囊 44px；窗口极小时至少留出半宽，保证抓手仍可点
  const max = Math.max(LAUNCHER_MARGIN, window.innerWidth - LAUNCHER_SIZE / 2)
  return Math.min(max, Math.max(LAUNCHER_MARGIN, value))
}

/**
 * 右下角胶囊启动器：浮层/侧板应用的统一全局入口。
 *
 * overlay/panel surface 的应用不进侧栏菜单；只要存在已发布+启用的
 * 浮层/侧板应用，胶囊就常驻主窗口右下角，任何视图（含画布模式）
 * 都能展开启动。已运行的项可从列表直接关闭（toggle 语义）。
 *
 * 菜单 hover 触发展开（省一次点击）：指针移入胶囊即展开，移出整个
 * 启动器区域（胶囊+菜单）后延迟 HOVER_CLOSE_DELAY 收起；点击胶囊仅作
 * 兜底展开，不再 toggle，避免「hover 已展开、点击反而收起」的反直觉。
 *
 * 胶囊本体可拖动摆放位置（右下锚定 + localStorage 记忆）；位移小于
 * DRAG_THRESHOLD 的按下仍按点击处理，不会误触菜单展开。
 */
export function SubAppSurfaceLauncher({
  controller,
}: {
  controller: SubAppSurfaceController
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false)
  const [pos, setPos] = useState<LauncherPos | null>(() => readLauncherPos())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const capsuleRef = useRef<HTMLButtonElement | null>(null)
  const dragState = useRef<{
    startX: number
    startY: number
    baseRight: number
    baseBottom: number
    moved: boolean
  } | null>(null)
  // 拖动结束的 pointerup 后浏览器还会派发一次 click，用它吸收掉
  const suppressClick = useRef(false)
  // 计划中的延迟收起定时器：移出区域后缓冲，再次移入即取消
  const closeTimer = useRef<number | null>(null)

  const cancelScheduledClose = (): void => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = (): void => {
    cancelScheduledClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setExpanded(false)
    }, HOVER_CLOSE_DELAY)
  }

  // 卸载时清掉挂起的定时器
  useEffect(
    () => () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  // 点击/触摸胶囊外部时收起列表
  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current != null && !rootRef.current.contains(event.target as Node)) {
        setExpanded(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [expanded])

  const onCapsulePointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const rect = capsuleRef.current?.getBoundingClientRect()
    if (rect == null) return
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      // 右下锚定：从胶囊当前实际位置换算，兼容记忆位置与默认右下角
      baseRight: window.innerWidth - rect.right,
      baseBottom: window.innerHeight - rect.bottom,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // capture 不可用时忽略（极端时序/测试环境），拖动仍可走通
    }
  }

  const onCapsulePointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragState.current
    if (drag == null) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    drag.moved = true
    suppressClick.current = true
    // 向右拖（dx>0）时 right 减小；上下同理
    setPos({
      right: clampPos(drag.baseRight - dx),
      bottom: clampPos(drag.baseBottom - dy),
    })
  }

  const onCapsulePointerUp = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragState.current
    dragState.current = null
    if (drag != null && drag.moved) {
      setPos((current) => {
        if (current != null) persistLauncherPos(current)
        return current
      })
      // 吸收紧随 pointerup 的 click；下一个宏轮次恢复点击
      window.setTimeout(() => {
        suppressClick.current = false
      }, 0)
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // capture 已释放时忽略
    }
  }

  const overlayApps = controller.directory.filter((app) => app.surface === 'overlay')
  const panelApps = controller.directory.filter((app) => app.surface === 'panel')
  if (overlayApps.length === 0 && panelApps.length === 0) return null

  const runningCount = controller.instances.length

  const renderGroup = (
    title: string,
    apps: SubAppSummary[],
    surfaceLabel: string,
  ): React.ReactElement | null => {
    if (apps.length === 0) return null
    return (
      <div className="subapp-launcher-group" key={title}>
        <div className="subapp-launcher-group-title">{title}</div>
        {apps.map((app) => {
          const instance = controller.instances.find((item) => item.appId === app.id)
          const running = instance != null
          return (
            <button
              type="button"
              key={app.id}
              className={`subapp-launcher-item${running ? ' is-running' : ''}`}
              aria-pressed={running}
              title={running ? `${app.name}（运行中，点击关闭）` : `打开${app.name}`}
              onClick={() => {
                if (instance != null) {
                  controller.close(instance.key)
                } else {
                  void controller.open(app.id)
                  // 启动后收起列表，让用户立即看到浮层/侧板出现
                  setExpanded(false)
                }
              }}
            >
              <SubAppIcon icon={app.icon} size={16} />
              <span className="subapp-launcher-item-name" title={app.name}>
                {app.name}
              </span>
              <span className="subapp-launcher-item-surface">{surfaceLabel}</span>
              {running ? <span className="subapp-launcher-item-dot" aria-label="运行中" /> : null}
            </button>
          )
        })}
      </div>
    )
  }

  // 记忆位置后改为内联 right/bottom（同为右下锚定，展开面板向上生长
  // 时胶囊不动）；未拖动过则走 CSS 默认右下角，无需内联。
  const rootStyle: React.CSSProperties | undefined =
    pos != null ? { left: 'auto', top: 'auto', right: pos.right, bottom: pos.bottom } : undefined

  return (
    <div
      className="subapp-surface-launcher"
      ref={rootRef}
      style={rootStyle}
      data-testid="subapp-surface-launcher"
      onMouseEnter={cancelScheduledClose}
      onMouseLeave={scheduleClose}
    >
      {expanded ? (
        <div className="subapp-launcher-panel" role="menu" aria-label="浮层与侧板应用">
          {renderGroup('浮层应用', overlayApps, '浮层')}
          {renderGroup('侧板应用', panelApps, '侧板')}
        </div>
      ) : null}
      <button
        type="button"
        ref={capsuleRef}
        className="subapp-launcher-capsule"
        aria-expanded={expanded}
        aria-label="展开浮层应用菜单"
        title="子应用启动器（可拖动摆放位置）"
        data-running-count={runningCount}
        onMouseEnter={() => {
          cancelScheduledClose()
          setExpanded(true)
        }}
        onClick={() => {
          // 兜底展开（键盘/触控）；hover 已展开时点击不收起
          if (suppressClick.current) return
          setExpanded(true)
        }}
        onPointerDown={onCapsulePointerDown}
        onPointerMove={onCapsulePointerMove}
        onPointerUp={onCapsulePointerUp}
      >
        <Icons.Layers size={18} />
        {runningCount > 0 ? (
          <span className="subapp-launcher-badge" aria-label={`${runningCount} 个应用运行中`}>
            {runningCount}
          </span>
        ) : null}
      </button>
    </div>
  )
}
