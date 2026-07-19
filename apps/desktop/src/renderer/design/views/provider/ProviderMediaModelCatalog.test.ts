// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { ProviderMediaModelCatalog } from './ProviderMediaModelCatalog'
import { filterProviderMediaModels } from './providerMediaModelCatalogFilter'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement('button', null, children),
    Checkbox: () => ReactActual.createElement('input', { type: 'checkbox' }),
    Input: ({ prefix: _prefix, allowClear: _allowClear, ...props }: React.InputHTMLAttributes<HTMLInputElement> & {
      prefix?: React.ReactNode
      allowClear?: boolean
    }) => ReactActual.createElement('input', props),
    Tag: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement('span', null, children),
  }
})

function model(
  overrides: Partial<CanvasMediaModelSummary> & Pick<CanvasMediaModelSummary, 'manifestId' | 'displayName' | 'effectiveModelId'>,
): CanvasMediaModelSummary {
  return {
    providerKind: 'apimart',
    modelId: overrides.effectiveModelId,
    domains: ['video'],
    invocationMode: 'async_polling',
    capabilities: [{
      id: 'video.generate',
      label: '文生视频',
      input: { required: ['prompt'] },
      output: { types: ['video'], mimeTypes: ['video/mp4'] },
      paramSchema: {},
    }],
    sourceUrls: [],
    enabled: true,
    ...overrides,
  }
}

const MODELS = [
  model({
    manifestId: 'apimart:gemini-omni-flash-preview',
    displayName: 'APIMart Gemini Omni Flash Preview',
    effectiveModelId: 'gemini-omni-flash-preview',
  }),
  model({
    manifestId: 'apimart:grok-imagine-1.5-video',
    displayName: 'APIMart Grok Imagine 1.5 Video',
    effectiveModelId: 'grok-imagine-1.5-video-apimart',
    capabilities: [{
      id: 'video.edit',
      label: '视频编辑',
      input: { required: ['prompt', 'video'] },
      output: { types: ['video'], mimeTypes: ['video/mp4'] },
      paramSchema: {},
    }],
  }),
]

describe('filterProviderMediaModels', () => {
  it('matches model names and IDs without case sensitivity', () => {
    expect(filterProviderMediaModels(MODELS, 'GEMINI')).toEqual([MODELS[0]])
    expect(filterProviderMediaModels(MODELS, 'grok-imagine-1.5-video-apimart')).toEqual([MODELS[1]])
  })

  it('matches capability text and requires every whitespace-separated term', () => {
    expect(filterProviderMediaModels(MODELS, '视频 编辑')).toEqual([MODELS[1]])
    expect(filterProviderMediaModels(MODELS, 'gemini 编辑')).toEqual([])
  })

  it('returns the full list for a blank query', () => {
    expect(filterProviderMediaModels(MODELS, '   ')).toEqual(MODELS)
  })
})

describe('ProviderMediaModelCatalog', () => {
  it('filters the visible catalog as the user types', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root: Root | null = createRoot(container)

    act(() => {
      root?.render(React.createElement(ProviderMediaModelCatalog, {
        models: MODELS,
        loading: false,
        isChatModel: false,
        selectedManifestIds: new Set<string>(),
        defaultModel: '',
        onToggleModel: () => undefined,
        onSetDefaultModel: () => undefined,
      }))
    })

    const searchInput = container.querySelector('input[aria-label="搜索模型清单"]')
    expect(searchInput).toBeInstanceOf(HTMLInputElement)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(searchInput, 'grok')
      searchInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.textContent).toContain('APIMart Grok Imagine 1.5 Video')
    expect(container.textContent).not.toContain('APIMart Gemini Omni Flash Preview')
    expect(container.textContent).toContain('1 / 2')

    act(() => root?.unmount())
    root = null
    container.remove()
  })
})
