// @vitest-environment jsdom

/**
 * useAssetGenerationConfig 聚焦测试（R3）：
 * 默认模型选中、参数草稿初始化（capability.defaults）、参数互斥、
 * 提交配置编译与参数偏好记忆恢复。
 */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { mediaModelKey } from '../canvasModelPickerModel'
import { useAssetGenerationConfig } from './useAssetGenerationConfig'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listMediaModelsMock = vi.fn()

vi.mock('../canvas.api', () => ({
  canvasApi: {
    listMediaModels: (...args: unknown[]) => listMediaModelsMock(...(args as [])),
  },
}))

function imageModel(manifestId: string): CanvasMediaModelSummary {
  return {
    manifestId,
    providerProfileId: `profile-${manifestId}`,
    providerKind: 'openai',
    modelId: manifestId,
    effectiveModelId: manifestId,
    displayName: manifestId,
    domains: ['image'],
    invocationMode: 'sync',
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['text'], maxImages: 0 },
        output: { types: ['image'] },
        paramSchema: {
          properties: {
            aspect_ratio: { type: 'string', enum: ['16:9', '1:1', '9:16'] },
            size: { type: 'string', 'x-allow-custom': true },
          },
        },
        defaults: { aspect_ratio: '16:9' },
      },
    ],
    sourceUrls: [],
    enabled: true,
  }
}

type Controller = ReturnType<typeof useAssetGenerationConfig>

let container: HTMLDivElement | null = null
let root: Root | null = null
let current: Controller | null = null

function mount(enabled: boolean): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <Probe
        enabled={enabled}
        onCapture={(value) => {
          current = value
        }}
      />,
    )
  })
}

function Probe({
  enabled,
  onCapture,
}: {
  enabled: boolean
  onCapture: (value: Controller) => void
}) {
  const value = useAssetGenerationConfig('text_to_image', enabled)
  onCapture(value)
  return null
}

/** flush 异步模型加载与其后的两轮默认值 effect */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  listMediaModelsMock.mockReset()
  listMediaModelsMock.mockResolvedValue({ models: [imageModel('img-a'), imageModel('img-b')] })
  window.localStorage.clear()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  current = null
})

describe('useAssetGenerationConfig', () => {
  it('默认选中第一个可用模型并按 capability.defaults 初始化参数草稿', async () => {
    mount(true)
    await flush()
    expect(current).not.toBeNull()
    expect(current?.modelKey).toBe(mediaModelKey(imageModel('img-a')))
    expect(current?.paramDraft['aspect_ratio']).toBe('16:9')
    const config = current?.buildSubmitConfig()
    expect(config?.manifestId).toBe('img-a')
    expect(config?.modelParams).toMatchObject({ aspect_ratio: '16:9' })
  })

  it('参数变更反映到提交配置', async () => {
    mount(true)
    await flush()
    act(() => {
      current?.onParameterChange('aspect_ratio', '9:16')
    })
    expect(current?.buildSubmitConfig().modelParams).toMatchObject({ aspect_ratio: '9:16' })
  })

  it('size 与画幅参数互斥：设置 size 后画幅被清空且不进提交参数', async () => {
    mount(true)
    await flush()
    act(() => {
      current?.onParameterChange('size', '1024x1024')
    })
    expect(current?.paramDraft['size']).toBe('1024x1024')
    expect(current?.paramDraft['aspect_ratio']).toBe('')
    const params = current?.buildSubmitConfig().modelParams ?? {}
    expect(params['aspect_ratio']).toBeUndefined()
    expect(params['size']).toBe('1024x1024')
  })

  it('enabled=false 时不拉取模型列表', async () => {
    mount(false)
    await flush()
    expect(listMediaModelsMock).not.toHaveBeenCalled()
    expect(current?.models).toHaveLength(0)
  })

  it('rememberPreferences 后新实例从偏好恢复参数（优先于 defaults）', async () => {
    mount(true)
    await flush()
    act(() => {
      current?.onParameterChange('aspect_ratio', '1:1')
    })
    act(() => {
      current?.rememberPreferences()
    })
    // 卸载重挂：同一 localStorage 下的新 hook 实例
    act(() => {
      root?.unmount()
    })
    mount(true)
    await flush()
    expect(current?.paramDraft['aspect_ratio']).toBe('1:1')
  })
})
