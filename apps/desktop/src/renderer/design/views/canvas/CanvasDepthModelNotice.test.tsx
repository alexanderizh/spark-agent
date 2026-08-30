// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { CanvasDepthModelNotice } from './CanvasDepthModelNotice'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CanvasDepthModelNotice', () => {
  it('reports an active model download in the inline workbench', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<CanvasDepthModelNotice state="installing" error="" compact />)
    })

    expect(container.textContent).toContain('正在下载 Depth Anything V2 模型')

    await act(async () => root.unmount())
  })
})
