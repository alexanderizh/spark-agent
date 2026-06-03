import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

import '@spark/ui-kit/styles'
import './design/styles/styles.css'
import './design/styles/views.css'
import './design/styles/interactions.css'

const rootElement = document.getElementById('root')
if (rootElement == null) {
  throw new Error('Root element #root not found in DOM')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
