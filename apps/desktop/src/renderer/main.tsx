import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setCreateRoot } from '@arco-design/web-react/es/_util/react-dom'
import { App } from './App'

// React 19 不再从 react-dom 默认导出 createRoot，Arco Design 内部依赖它做动态渲染
// (Message、Notification、Modal.confirm 等)，必须手动注入。
setCreateRoot(createRoot)

import '@arco-design/web-react/es/style/index.css'
import '@arco-design/web-react/es/Input/style/css.js'
import '@arco-design/web-react/es/Select/style/css.js'
import '@arco-design/web-react/es/Checkbox/style/css.js'
import '@arco-design/web-react/es/DatePicker/style/css.js'
import '@arco-design/web-react/es/Modal/style/css.js'
import '@arco-design/web-react/es/Drawer/style/css.js'
import '@arco-design/web-react/es/Slider/style/css.js'
import '@arco-design/web-react/es/Button/style/css.js'
import '@arco-design/web-react/es/Switch/style/css.js'
import '@arco-design/web-react/es/Tag/style/css.js'
import '@arco-design/web-react/es/Badge/style/css.js'
import '@arco-design/web-react/es/Alert/style/css.js'
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
