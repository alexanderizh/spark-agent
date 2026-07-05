// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaModelManifest } from '@spark/protocol'

// @lobehub/ui 间接 import @emoji-mart/data（裸 JSON 入口），Node ESM 严格模式不允许。
// 直接 mock @lobehub/ui 用原生 input/checkbox 替代，避免 lobehub 的 emoji 数据依赖。
vi.mock('@lobehub/ui', () => ({
  Checkbox: ({ checked, onChange }: { checked?: boolean; onChange?: (v: boolean) => void }) =>
    React.createElement('input', {
      type: 'checkbox',
      checked: checked === true,
      onChange: (e) => onChange?.((e.target as HTMLInputElement).checked),
      'data-mock': 'lobe-checkbox',
    }),
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string
    onChange?: (v: { target: { value: string } }) => void
    placeholder?: string
  }) =>
    React.createElement('input', {
      type: 'text',
      value: value ?? '',
      placeholder,
      onChange: (e) => onChange?.({ target: { value: e.target.value } }),
      'data-mock': 'lobe-input',
    }),
  Tag: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-mock': 'lobe-tag' }, children),
}))

import { ProviderManifestContractEditor } from '../design/components/ProviderManifestContractEditor'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

function setAreaValue(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  expect(setter).toBeDefined()
  setter?.call(area, value)
  area.dispatchEvent(new Event('input', { bubbles: true }))
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  expect(setter).toBeDefined()
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function buildManifest(overrides: Partial<MediaModelManifest> = {}): MediaModelManifest {
  return {
    modelId: 'test-image-model',
    displayName: 'Test Image Model',
    kind: 'image.generate',
    apiType: 'openai',
    capabilities: [
      {
        id: 'image.generate',
        label: 'Image Generate',
        paramPolicy: {
          strict: false,
          passthrough: { enabled: true, allow: [], deny: [] },
          forbidden: [],
        },
        input: [],
        output: { kind: 'url', jsonPaths: ['url'] },
      },
    ],
    ...overrides,
  } as unknown as MediaModelManifest
}

describe('ProviderManifestContractEditor', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    if (!('PointerEvent' in window)) {
      vi.stubGlobal('PointerEvent', MouseEvent)
    }
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

  it('shows placeholder when manifest is null', () => {
    act(() => {
      root = createRoot(container)
      root.render(<ProviderManifestContractEditor manifest={null} onChange={() => {}} />)
    })
    expect(container.textContent).toContain('尚未提供 manifest')
  })

  it('renders capability header and current strict/passthrough tags', () => {
    const manifest = buildManifest()
    act(() => {
      root = createRoot(container)
      root.render(<ProviderManifestContractEditor manifest={manifest} onChange={() => {}} />)
    })
    expect(container.textContent).toContain('Image Generate')
    expect(container.textContent).toContain('compat')
    expect(container.textContent).toContain('passthrough on')
  })

  it('parses forbidden textarea lines into entries and propagates via onChange', () => {
    const manifest = buildManifest()
    const changes: MediaModelManifest[] = []
    act(() => {
      root = createRoot(container)
      root.render(
        <ProviderManifestContractEditor
          manifest={manifest}
          onChange={(next) => changes.push(next)}
        />,
      )
    })

    const forbiddenAreas = container.querySelectorAll<HTMLTextAreaElement>('textarea')
    const forbiddenArea = Array.from(forbiddenAreas).find((area) =>
      (area.previousElementSibling?.textContent ?? '').includes('forbidden'),
    )
    expect(forbiddenArea).toBeDefined()

    act(() => {
      setAreaValue(forbiddenArea!, 'size: 当前模型不支持 size\nwatermark: 不允许\nbadline')
    })

    expect(changes.length).toBeGreaterThan(0)
    const last = changes[changes.length - 1]!
    const capability = last.capabilities[0]!
    expect(capability.paramPolicy?.forbidden).toEqual([
      { name: 'size', reason: '当前模型不支持 size' },
      { name: 'watermark', reason: '不允许' },
      { name: 'badline', reason: '' },
    ])
  })

  it('synchronizes passthrough.allow input through onChange', () => {
    const manifest = buildManifest()
    const changes: MediaModelManifest[] = []
    act(() => {
      root = createRoot(container)
      root.render(
        <ProviderManifestContractEditor
          manifest={manifest}
          onChange={(next) => changes.push(next)}
        />,
      )
    })

    const allowInput = container.querySelector<HTMLInputElement>(
      'input[placeholder*="aspect_ratio"]',
    )
    expect(allowInput).toBeDefined()

    act(() => {
      setInputValue(allowInput!, 'aspect_ratio, output_format')
    })

    expect(changes.length).toBeGreaterThan(0)
    const last = changes[changes.length - 1]!
    expect(last.capabilities[0]!.paramPolicy?.passthrough?.allow).toEqual([
      'aspect_ratio',
      'output_format',
    ])
  })
})
