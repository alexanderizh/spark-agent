// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasCharacterSubviewEditor } from './CanvasCharacterSubviewEditor'
import type { FilmCharacterSubview } from './canvasCharacterLibrary'
import type { CanvasAsset } from './canvas.types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      className,
      disabled,
      loading,
      onClick,
      type,
    }: {
      children?: React.ReactNode
      className?: string
      disabled?: boolean
      loading?: boolean
      onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
      type?: string
    }) => {
      if (type === 'text') {
        return ReactActual.createElement(
          'span',
          {
            className,
            onClick: disabled || loading ? undefined : onClick,
            role: 'button',
          },
          children,
        )
      }
      return ReactActual.createElement(
        'button',
        {
          className,
          disabled: disabled || loading,
          onClick,
          type: 'button',
        },
        children,
      )
    },
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Modal = ({
    children,
    footer,
    open,
    title,
  }: {
    children?: React.ReactNode
    footer?: React.ReactNode
    open?: boolean
    title?: React.ReactNode
  }) =>
    open
      ? ReactActual.createElement(
          'div',
          { className: 'ant-modal' },
          ReactActual.createElement('div', { className: 'ant-modal-title' }, title),
          children,
          ReactActual.createElement('div', { className: 'ant-modal-footer' }, footer),
        )
      : null

  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    ReactActual.createElement('input', props)

  const Segmented = <T extends string>({
    onChange,
    options,
    value,
  }: {
    onChange?: (value: T) => void
    options?: Array<{ label: string; value: T }>
    value?: T
  }) =>
    ReactActual.createElement(
      'div',
      { className: 'ant-segmented' },
      (options ?? []).map((option) =>
        ReactActual.createElement(
          'button',
          {
            'aria-pressed': option.value === value,
            key: option.value,
            onClick: () => onChange?.(option.value),
            type: 'button',
          },
          option.label,
        ),
      ),
    )

  const Select = <T extends string>({
    disabled,
    onChange,
    options,
    value,
  }: {
    disabled?: boolean
    onChange?: (value: T) => void
    options?: Array<{ label: string; value: T }>
    value?: T | null
  }) =>
    ReactActual.createElement(
      'select',
      {
        disabled,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          onChange?.(event.target.value as T),
        value: value ?? '',
      },
      (options ?? []).map((option) =>
        ReactActual.createElement('option', { key: option.value, value: option.value }, option.label),
      ),
    )

  return { Input, Modal, Segmented, Select }
})

vi.mock('../../Icons', () => ({
  Icons: new Proxy({}, { get: () => () => null }),
}))

vi.mock('./CanvasCharacterSubviewPreview', () => ({
  CanvasCharacterSubviewPreview: ({ subview }: { subview?: FilmCharacterSubview | null }) =>
    React.createElement('div', { className: 'subview-preview-stub' }, subview?.label ?? ''),
}))

const createdAt = '2026-07-09T00:00:00.000Z'

const ownerAsset = createAsset({
  id: 'asset-character',
  title: '角色设定',
  type: 'file',
})

const sourceImageAsset = createAsset({
  id: 'asset-source-image',
  title: '角色参考图',
  type: 'image',
  url: 'spark://asset/source-image.png',
})

const initialSubviews: FilmCharacterSubview[] = [
  createSubview('subview-face', '脸部特写', 0),
  createSubview('subview-body', '站姿全身', 1),
]

describe('CanvasCharacterSubviewEditor', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    class ResizeObserverStub {
      disconnect() {}
      observe() {}
    }
    class ImageStub {
      naturalHeight = 800
      naturalWidth = 1000
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      set src(_value: string) {
        this.onload?.()
      }
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('Image', ImageStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('keeps unsaved in-session subviews when insert refreshes parent metadata', async () => {
    const onInsertSubview = vi.fn().mockResolvedValue(undefined)
    renderEditor({ onInsertSubview })

    expect(container.textContent).toContain('脸部特写')
    expect(container.textContent).toContain('站姿全身')

    const insertButton = buttonByText('插入画布')
    await act(async () => {
      insertButton.click()
      await Promise.resolve()
    })
    expect(onInsertSubview).toHaveBeenCalledWith(initialSubviews[0])

    renderEditor({ initialSubviews: [], onInsertSubview })

    expect(container.textContent).toContain('脸部特写')
    expect(container.textContent).toContain('站姿全身')
    expect(container.textContent).not.toContain('还没有子视图')
  })

  it('uses Tab inside the open editor to switch between crop and pan tools', () => {
    renderEditor()

    expect(container.textContent).toContain('拖动框体可移动，拖拽四角可微调大小')
    expect(stageElement().className).toContain('canvas-character-subview-stage-crop')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
    })

    expect(container.textContent).toContain('当前为拖图模式，可拖动画面位置')
    expect(stageElement().className).toContain('canvas-character-subview-stage-pan')
  })

  function renderEditor(
    overrides: Partial<React.ComponentProps<typeof CanvasCharacterSubviewEditor>> = {},
  ) {
    act(() => {
      if (root == null) root = createRoot(container)
      root.render(
        <CanvasCharacterSubviewEditor
          open
          ownerAsset={ownerAsset}
          sourceImageAsset={sourceImageAsset}
          initialSubviews={initialSubviews}
          onClose={vi.fn()}
          onInsertSubview={vi.fn().mockResolvedValue(undefined)}
          onSave={vi.fn().mockResolvedValue(undefined)}
          {...overrides}
        />,
      )
    })
  }
})

function createAsset(input: {
  id: string
  title: string
  type: CanvasAsset['type']
  url?: string
}): CanvasAsset {
  return {
    id: input.id,
    projectId: 'project-1',
    userId: 1,
    type: input.type,
    source: 'upload',
    title: input.title,
    url: input.url ?? null,
    width: 1000,
    height: 800,
    metadata: {},
    createdAt,
    updatedAt: createdAt,
  }
}

function createSubview(id: string, label: string, order: number): FilmCharacterSubview {
  return {
    id,
    label,
    kind: order === 0 ? 'portrait' : 'full_body',
    sourceAssetId: sourceImageAsset.id,
    cropPx: { x: 20 + order * 40, y: 30, width: 220, height: 260 },
    order,
    createdAt,
    updatedAt: createdAt,
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.includes(text),
  )
  expect(button).toBeDefined()
  if (button == null) throw new Error(`Button not found: ${text}`)
  return button
}

function stageElement(): HTMLDivElement {
  const stage = document.body.querySelector<HTMLDivElement>('.canvas-character-subview-stage')
  expect(stage).toBeDefined()
  if (stage == null) throw new Error('Subview stage not found')
  return stage
}
