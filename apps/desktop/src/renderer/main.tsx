import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { readCanvasWindowProjectId } from './canvasWindowParams'
import { isBrowserWindowMode } from './browserWindowParams'

import './design/styles/styles.css'
import './design/styles/views.css'
import './design/styles/markdown-code-semantics.css'
import './design/styles/workflow-loop-body.css'
import './design/styles/interactions.css'
import './design/styles/global-overrides.css'

const rootElement = document.getElementById('root')
if (rootElement == null) {
  throw new Error('Root element #root not found in DOM')
}

const CanvasWindowApp = lazy(async () => ({
  default: (await import('./CanvasWindowApp')).CanvasWindowApp,
}))
const BrowserWindowApp = lazy(async () => ({
  default: (await import('./BrowserWindowApp')).BrowserWindowApp,
}))
const isCanvasWindow = readCanvasWindowProjectId() != null
const isBrowserWindow = isBrowserWindowMode()

let rootContent: React.ReactNode
if (isCanvasWindow) {
  rootContent = <CanvasWindowApp />
} else if (isBrowserWindow) {
  rootContent = <BrowserWindowApp />
} else {
  rootContent = <App />
}

createRoot(rootElement).render(
  <StrictMode>
    <Suspense fallback={<div className="app window" aria-label="正在加载" />}>
      {rootContent}
    </Suspense>
  </StrictMode>,
)
