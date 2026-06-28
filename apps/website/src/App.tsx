import { useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { useReveal } from './components/useReveal'
import { ArchitecturePage } from './routes/ArchitecturePage'
import { CanvasPage } from './routes/CanvasPage'
import { ContactPage } from './routes/ContactPage'
import { DocsPage } from './routes/DocsPage'
import { DownloadPage } from './routes/DownloadPage'
import { FeaturesPage } from './routes/FeaturesPage'
import { HomePage } from './routes/HomePage'
import { OpenSourcePage } from './routes/OpenSourcePage'
import { RoadmapPage } from './routes/RoadmapPage'

const routes: Record<string, React.ComponentType> = {
  '/': HomePage,
  '/features': FeaturesPage,
  '/canvas': CanvasPage,
  '/architecture': ArchitecturePage,
  '/download': DownloadPage,
  '/docs': DocsPage,
  '/roadmap': RoadmapPage,
  '/open-source': OpenSourcePage,
  '/contact': ContactPage,
}

const routePaths = new Set(Object.keys(routes))

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
      const pathname = href.split('#')[0].replace(/\/$/, '') || '/'
      if (!routePaths.has(pathname)) return
      event.preventDefault()
      if (pathname !== readPath()) {
        window.history.pushState({}, '', href)
        setPath(pathname)
      }
      // 同页锚点跳转交给浏览器，路由切换则回到顶部
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    const onPop = () => {
      setPath(readPath())
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    document.addEventListener('click', onClick)
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  const Page = routes[path] ?? HomePage
  return (
    <Layout currentPath={path}>
      <Page />
    </Layout>
  )
}
