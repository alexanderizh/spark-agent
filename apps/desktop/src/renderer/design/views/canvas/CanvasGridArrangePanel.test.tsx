// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasGridArrangePanel } from './CanvasGridArrangePanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      size,
      block: _block,
      loading: _loading,
      icon: _icon,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      size?: string
      block?: boolean
      loading?: boolean
      icon?: React.ReactNode
    }) => ReactActual.createElement('button', { ...props, 'data-size': size }, children),
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    InputNumber: () => ReactActual.createElement('input', { type: 'number' }),
  }
})

vi.mock('../../Icons', () => ({ Icons: { Grid: () => React.createElement('span') } }))
vi.mock('./CanvasGridSelectionMatrix', () => ({
  CanvasGridSelectionMatrix: () => React.createElement('div', { 'data-testid': 'grid-matrix' }),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('CanvasGridArrangePanel', () => {
  it('supports compact custom copy for the auto-layout popover', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <CanvasGridArrangePanel
          nodeCount={31}
          columns={6}
          title="自动整理画布"
          description="整理全画布"
          applyLabel="开始整理"
          fullWidth
          onColumnsChange={vi.fn()}
          onApply={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('自动整理画布')
    expect(container.textContent).toContain('整理全画布')
    expect(container.textContent).toContain('开始整理')
    expect(container.querySelector('button')?.dataset.size).toBe('small')
    expect(container.querySelector('.canvas-grid-arrange-panel.is-full-width')).not.toBeNull()
  })
})
