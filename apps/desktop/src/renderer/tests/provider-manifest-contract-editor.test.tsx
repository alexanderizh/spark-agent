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
    onBlur,
    placeholder,
  }: {
    value?: string
    onChange?: (v: { target: { value: string } }) => void
    onBlur?: () => void
    placeholder?: string
  }) =>
    React.createElement('input', {
      type: 'text',
      value: value ?? '',
      placeholder,
      onChange: (e) => onChange?.({ target: { value: e.target.value } }),
      onBlur,
      'data-mock': 'lobe-input',
    }),
  Select: ({
    value,
    options,
    onChange,
  }: {
    value?: string
    options?: Array<{ label: string; value: string }>
    onChange?: (value: string) => void
  }) =>
    React.createElement(
      'select',
      {
        value,
        onChange: (e) => onChange?.((e.target as HTMLSelectElement).value),
        'data-mock': 'lobe-select',
      },
      options?.map((option) =>
        React.createElement('option', { key: option.value, value: option.value }, option.label),
      ),
    ),
  Tag: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-mock': 'lobe-tag' }, children),
}))

import { ProviderManifestContractEditor } from '../design/components/ProviderManifestContractEditor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
    expect(container.textContent).toContain('兼容模式')
    expect(container.textContent).toContain('未声明参数透传：开启')
  })

  it('renders model parameters as a Chinese visual form', () => {
    const manifest = buildManifest({
      capabilities: [
        {
          ...buildManifest().capabilities[0]!,
          paramSchema: {
            type: 'object',
            properties: {
              size: { type: 'string', title: '画面尺寸', enum: ['1:1', '16:9'] },
            },
          },
          defaults: { size: '1:1' },
          aliases: { size: 'aspect_ratio' },
        },
      ],
    })
    act(() => {
      root = createRoot(container)
      root.render(<ProviderManifestContractEditor manifest={manifest} onChange={() => {}} />)
    })

    expect(container.querySelector('.pv_parameter_card')).not.toBeNull()
    expect(container.textContent).toContain('参数标识')
    expect(container.textContent).toContain('显示名称')
    expect(container.textContent).toContain('渠道字段名')
    expect(container.textContent).toContain('可选值')
    expect(container.textContent).toContain('默认值')
  })

  it('keeps the stable manifest identity when the provider model id changes', () => {
    const manifest = buildManifest({ id: 'custom:test-image-model:provider-instance' })
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

    const modelInput = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find(
      (input) => input.value === 'test-image-model',
    )
    expect(modelInput).toBeDefined()
    act(() => setInputValue(modelInput!, 'same-model-name'))

    expect(changes.at(-1)?.modelId).toBe('same-model-name')
    expect(changes.at(-1)?.id).toBe('custom:test-image-model:provider-instance')
  })

  it('adds a parameter through the visual editor', () => {
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

    const addButton = container.querySelector<HTMLButtonElement>('.pv_parameter_add')
    expect(addButton).not.toBeNull()
    act(() => addButton!.click())

    expect(changes.at(-1)?.capabilities[0]?.paramSchema).toMatchObject({
      properties: { param1: { type: 'string', title: '新参数' } },
    })
  })

  it('renames parameter references together to avoid a partially valid contract', () => {
    const manifest = buildManifest({
      capabilities: [
        {
          ...buildManifest().capabilities[0]!,
          paramSchema: {
            type: 'object',
            properties: { size: { type: 'string' } },
            required: ['size'],
          },
          defaults: { size: '1:1' },
          aliases: { size: 'aspect_ratio' },
          paramPolicy: {
            strict: true,
            passthrough: { enabled: false, allow: ['size'] },
            transforms: [{ kind: 'map_value', field: 'size', values: { square: '1:1' } }],
          },
        },
      ],
    })
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

    const nameInput = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find(
      (input) => input.value === 'size',
    )
    expect(nameInput).toBeDefined()
    act(() => {
      setInputValue(nameInput!, 'aspectRatio')
      nameInput!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

    const capability = changes.at(-1)?.capabilities[0]
    expect(capability?.paramSchema).toMatchObject({
      properties: { aspectRatio: { type: 'string' } },
      required: ['aspectRatio'],
    })
    expect(capability?.defaults).toEqual({ aspectRatio: '1:1' })
    expect(capability?.aliases).toEqual({ aspectRatio: 'aspect_ratio' })
    expect(capability?.paramPolicy?.passthrough?.allow).toEqual(['aspectRatio'])
    expect(capability?.paramPolicy?.transforms).toEqual([
      { kind: 'map_value', field: 'aspectRatio', values: { square: '1:1' } },
    ])
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

  it('builds the production ToApis image contract with uploads and both image capabilities', () => {
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

    const preset = container.querySelector<HTMLSelectElement>('select option[value="toapis-image"]')
      ?.parentElement as HTMLSelectElement | null
    expect(preset).toBeDefined()
    act(() => {
      preset!.value = 'toapis-image'
      preset!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const next = changes.at(-1)!
    expect(next.capabilities.map((item) => item.id)).toEqual(['image.generate', 'image.edit'])
    expect(next.capabilities[0]?.paramSchema).toMatchObject({
      properties: {
        resolution: { enum: ['1k', '2k', '4k'] },
        quality: { enum: ['low', 'medium', 'high'] },
      },
    })
    expect(next.invocation.uploads?.[0]).toMatchObject({
      name: 'referenceImages',
      request: { endpoint: '/v1/uploads/images' },
      result: { urlPaths: ['data.url'], multiple: true },
    })
    expect(next.invocation.response).toMatchObject({
      kind: 'task_poll',
      poll: { endpoint: '/v1/images/generations/{taskId}' },
      resultPaths: ['result.data[].url', 'url'],
    })
  })

  it('can add video generation and reference capabilities from the editor', () => {
    const manifest = buildManifest({ domains: ['video'] })
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

    const addCapability = container.querySelector<HTMLSelectElement>('.pv_adapter_capability_add')
    expect(addCapability).toBeDefined()
    act(() => {
      addCapability!.value = 'video.reference_to_video'
      addCapability!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(changes.at(-1)?.capabilities.map((item) => item.id)).toContain(
      'video.reference_to_video',
    )
  })

  it('edits the selected capability instead of always changing the first one', () => {
    const manifest = buildManifest({
      capabilities: [
        buildManifest().capabilities[0]!,
        { ...buildManifest().capabilities[0]!, id: 'image.edit', label: '图生图 / 图片编辑' },
      ],
    })
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

    const editTab = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('图生图'),
    )
    expect(editTab).toBeDefined()
    act(() => editTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const fields = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[data-mock="lobe-input"]'),
    )
    const labelField = fields.find((field) => field.value === '图生图 / 图片编辑')
    expect(labelField).toBeDefined()
    act(() => {
      setInputValue(labelField!, '图生图（已配置）')
    })

    expect(changes.at(-1)?.capabilities[0]?.label).toBe('Image Generate')
    expect(changes.at(-1)?.capabilities[1]?.label).toBe('图生图（已配置）')
  })
})
