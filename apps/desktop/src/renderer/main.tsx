import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// 引入 Spark Agent 设计系统（Design Tokens + Tailwind CSS v4）
import '@spark/ui-kit/styles'

const rootElement = document.getElementById('root')
if (rootElement == null) {
  throw new Error('Root element #root not found in DOM')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
