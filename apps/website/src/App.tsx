import { Layout } from './components/Layout'
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

export function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const Page = routes[path] ?? HomePage
  return (
    <Layout>
      <Page />
    </Layout>
  )
}
