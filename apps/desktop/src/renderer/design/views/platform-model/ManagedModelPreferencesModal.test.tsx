// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import { ManagedModelPreferencesModal } from './ManagedModelPreferencesModal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  Checkbox: ({ checked, disabled }: { checked?: boolean; disabled?: boolean }) => (
    <input type="checkbox" checked={checked} disabled={disabled} readOnly />
  ),
  Modal: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  Select: ({ value }: { value?: string }) => <select value={value} onChange={() => {}} />,
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }),
}))

describe('ManagedModelPreferencesModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('separates platform image models and shows them as automatically enabled', async () => {
    const profile = {
      id: 'spark-platform-newapi',
      name: 'Spark 平台模型',
      provider: 'anthropic',
      defaultModel: 'glm-5',
      modelIds: ['glm-5'],
      availableModelIds: ['glm-5'],
      mediaModelRefs: [
        {
          manifestId: 'platform:spark-img:test',
          modelId: 'spark-img',
          templateManifestId: 'openai-images:gpt-image-2',
          displayName: 'spark-img',
          enabled: true,
        },
      ],
      maxTokens: 128_000,
      modelType: 'text',
      supportsMillionContext: false,
      isDefault: false,
      keystoreRef: 'newapi-spark-user-1-api-key',
      managed: true,
      managedType: 'newapi',
      createdAt: '',
    } satisfies ProviderProfile

    await act(async () =>
      root.render(
        <ManagedModelPreferencesModal profile={profile} onClose={vi.fn()} onSaved={vi.fn()} />,
      ),
    )

    expect(container.textContent).toContain('对话模型')
    expect(container.textContent).toContain('图片模型')
    expect(container.textContent).toContain('由平台标签自动启用')
    expect(container.textContent).toContain('spark-img')
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[1]?.checked).toBe(true)
    expect(checkboxes[1]?.disabled).toBe(true)
  })
})
