import type { Event, WebContents, WebContentsWillNavigateEventParams } from 'electron'
import { createLogger } from '@spark/shared'

const log = createLogger('sub-app-navigation')

type NavigationEvent = Pick<
  Event<WebContentsWillNavigateEventParams>,
  'isMainFrame' | 'preventDefault'
>
type NavigationWebContents = Pick<WebContents, 'getURL' | 'on' | 'removeListener' | 'send'>

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isCurrentRendererDocument(target: URL, current: URL): boolean {
  if (target.protocol !== current.protocol) return false
  if (target.protocol === 'file:') {
    return target.pathname === current.pathname && target.search === current.search
  }
  return target.origin === current.origin
}

/**
 * 子应用的 sandbox 允许用户触发顶层导航，但不能让远程页面替换主窗口：
 * HTTP(S) 目标转入隔离的浏览器面板，其他非宿主文档协议全部拒绝。
 */
export function installSubAppTopNavigationRouter(webContents: NavigationWebContents): () => void {
  const onWillNavigate = (event: NavigationEvent, targetValue: string): void => {
    if (!event.isMainFrame) return
    const target = parseUrl(targetValue)
    const current = parseUrl(webContents.getURL())
    if (target == null || current == null || isCurrentRendererDocument(target, current)) return

    event.preventDefault()
    if (
      (target.protocol === 'https:' || target.protocol === 'http:') &&
      target.username.length === 0 &&
      target.password.length === 0
    ) {
      log.info(`Routed sub-app top-level navigation to browser panel: ${target.origin}`)
      webContents.send('stream:browser-panel:restore', { url: target.toString() })
      return
    }

    log.warn(`Blocked sub-app top-level navigation using protocol: ${target.protocol || 'unknown'}`)
  }

  webContents.on('will-navigate', onWillNavigate)
  return () => webContents.removeListener('will-navigate', onWillNavigate)
}
