import React, { useEffect, useRef, useState } from 'react'
import type { SubAppSummary } from '@spark/protocol'
import { Icons } from '../Icons'
import { SubAppIcon } from './SubAppIcon'
import type { SubAppSurfaceController } from './SubAppSurfaceHost'

/**
 * 右下角胶囊启动器：浮层/侧板应用的统一全局入口。
 *
 * overlay/panel surface 的应用不进侧栏菜单；只要存在已发布+启用的
 * 浮层/侧板应用，胶囊就常驻主窗口右下角，任何视图（含画布模式）
 * 都能展开启动。已运行的项可从列表直接关闭（toggle 语义）。
 */
export function SubAppSurfaceLauncher({
  controller,
}: {
  controller: SubAppSurfaceController
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

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

  return (
    <div className="subapp-surface-launcher" ref={rootRef} data-testid="subapp-surface-launcher">
      {expanded ? (
        <div className="subapp-launcher-panel" role="menu" aria-label="浮层与侧板应用">
          {renderGroup('浮层应用', overlayApps, '浮层')}
          {renderGroup('侧板应用', panelApps, '侧板')}
        </div>
      ) : null}
      <button
        type="button"
        className="subapp-launcher-capsule"
        aria-expanded={expanded}
        aria-label={expanded ? '收起浮层应用菜单' : '展开浮层应用菜单'}
        data-running-count={runningCount}
        onClick={() => setExpanded((prev) => !prev)}
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
