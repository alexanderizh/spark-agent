import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { readCanvasWindowProjectId } from './canvasWindowParams'

import './design/styles/styles.css'
import './design/styles/views.css'
import './design/styles/interactions.css'
import './design/styles/board.css'
import './design/styles/global-overrides.css'

const rootElement = document.getElementById('root')
if (rootElement == null) {
  throw new Error('Root element #root not found in DOM')
}

const CanvasWindowApp = lazy(async () => ({
  default: (await import('./CanvasWindowApp')).CanvasWindowApp,
}))
const isCanvasWindow = readCanvasWindowProjectId() != null

createRoot(rootElement).render(
  <StrictMode>
    <Suspense fallback={<div className="app window" aria-label="正在加载" />}>
      {isCanvasWindow ? <CanvasWindowApp /> : <App />}
    </Suspense>
  </StrictMode>,
)
