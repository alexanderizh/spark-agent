import { useEffect, useMemo, useState } from 'react'
import { Layout } from './components/Layout'
import { useReveal } from './components/useReveal'
import { ArchitecturePage } from './routes/ArchitecturePage'
import { CanvasPage } from './routes/CanvasPage'
import { ContactPage } from './routes/ContactPage'
import { DocsPage } from './routes/DocsPage'
import { DocsSearchPage } from './routes/DocsSearchPage'
import { DocsTopicPage } from './routes/DocsTopicPage'
import { DownloadPage } from './routes/DownloadPage'
import { FeaturesPage } from './routes/FeaturesPage'
import { HomePage } from './routes/HomePage'
import { OpenSourcePage } from './routes/OpenSourcePage'
import { RoadmapPage } from './routes/RoadmapPage'
import { APP_NAVIGATE_EVENT } from './lib/router'
import { docsTopics } from './content/docs'

interface RouteMatch {
  /** 实际渲染的页面组件 */
  Page: React.ComponentType<any>
  /** 透传给页面组件的 props（动态路由专用） */
  props?: Record<string, string>
}

/**
 * 解析当前 pathname → 路由 + 透传 props。
 *
 * 静态路由优先；动态路由 /docs/:slug 在最后匹配。
 * 这样 /docs 和 /docs/search 不会被 /docs/:slug 抢走。
 */
function matchRoute(pathname: string): RouteMatch {
  const path = pathname.replace(/\/$/, '') || '/'

  // 静态路由
  switch (path) {
    case '/':
      return { Page: HomePage }
    case '/features':
      return { Page: FeaturesPage }
    case '/canvas':
      return { Page: CanvasPage }
    case '/architecture':
      return { Page: ArchitecturePage }
    case '/download':
      return { Page: DownloadPage }
    case '/docs':
      return { Page: DocsPage }
    case '/docs/search':
      return { Page: DocsSearchPage }
    case '/roadmap':
      return { Page: RoadmapPage }
    case '/open-source':
      return { Page: OpenSourcePage }
    case '/contact':
      return { Page: ContactPage }
  }

  // 动态路由 /docs/:slug（仅匹配 docsTopics 里的合法 slug）
  const docsMatch = path.match(/^\/docs\/([a-z0-9-]+)$/)
  if (docsMatch) {
    const slug = docsMatch[1]
    if (slug && docsTopics.some((t) => t.slug === slug)) {
      return { Page: DocsTopicPage, props: { slug } }
    }
  }

  // 未知路径 → 退回首页
  return { Page: HomePage }
}

function readPath() {
  return window.location.pathname.replace(/\/$/, '') || '/'
}

export function App() {
  const [path, setPath] = useState(readPath)
  // 路由变化后重新观察新页面的滚动入场元素，否则切页会让内容停留在隐藏态。
  useReveal(path)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // 只接管网内左键点击；修饰键 / 新窗口交给浏览器默认行为
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const anchor = (event.target as HTMLElement | null)?.closest?.('a')
      if (!anchor) return
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const href = anchor.getAttribute('href')
      if (!href || !href.startsWith('/')) return
      event.preventDefault()
      const pathname = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/'
      // 查询串变化时直接 pushState（让浏览器地址栏更新），由 popstate / app:navigate 触发 setPath
      if (pathname === readPath()) {
        window.history.pushState({}, '', href)
        window.dispatchEvent(new Event(APP_NAVIGATE_EVENT))
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      } else {
        window.history.pushState({}, '', href)
        window.dispatchEvent(new Event(APP_NAVIGATE_EVENT))
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      }
    }
    const onPop = () => {
      setPath(readPath())
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    const onAppNav = () => {
      const next = readPath()
      setPath((prev) => (prev === next ? prev : next))
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    document.addEventListener('click', onClick)
    window.addEventListener('popstate', onPop)
    window.addEventListener(APP_NAVIGATE_EVENT, onAppNav)
    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener(APP_NAVIGATE_EVENT, onAppNav)
    }
  }, [])

  const { Page, props } = useMemo(() => matchRoute(path), [path])
  const pageElement = useMemo(() => <Page {...(props ?? {})} />, [Page, props])

  return (
    <Layout currentPath={path}>
      {pageElement}
    </Layout>
  )
}
