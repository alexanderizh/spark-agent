import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

import '@arco-design/web-react/es/style/index.css'
import '@arco-design/web-react/es/Input/style/css.js'
import '@arco-design/web-react/es/Select/style/css.js'
import '@arco-design/web-react/es/Checkbox/style/css.js'
import '@arco-design/web-react/es/DatePicker/style/css.js'
import '@arco-design/web-react/es/Modal/style/css.js'
import '@arco-design/web-react/es/Slider/style/css.js'
import '@arco-design/web-react/es/Button/style/css.js'
import '@arco-design/web-react/es/Switch/style/css.js'
import '@spark/ui-kit/styles'
import './design/styles/styles.css'
import './design/styles/views.css'
import './design/styles/interactions.css'
import './design/styles/board.css'

const rootElement = document.getElementById('root')
if (rootElement == null) {
  throw new Error('Root element #root not found in DOM')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
