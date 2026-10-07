// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary, VoiceAssistantSettings } from '@spark/protocol'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'

import { useVoiceTtsSettings, type UseVoiceTtsSettingsResult } from './useVoiceTtsSettings'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 覆盖 HUD 播报设置数据 hook 的链路：
 * - 首读成功 ready=true；候选列举失败不阻塞首读
 * - patch 成功：提交前补读主进程最新设置（防陈旧快照回滚设置页改动），
 *   全量合并提交 + 以主进程 normalize 回显回写
 * - 补读失败回落本地快照合并；patch 失败回滚提交前快照 + saveError
 *   （5s 自动清空，且旧 timer 不清掉新错误）
 * - 卸载后 invoke 迟到不崩溃；settings 未就绪时 patch 直接拒绝
 */

function speechModel(
  providerProfileId: string,
  modelId: string,
  displayName: string,
): CanvasMediaModelSummary {
  return {
    manifestId: `${providerProfileId}:${modelId}`,
    providerProfileId,
    providerName: '自建 MiniMax',
    providerKind: 'custom',
    modelId,
    effectiveModelId: modelId,
    displayName,
    domains: ['audio'],
    invocationMode: 'sync',
    capabilities: [
      {
        id: 'audio.speech',
        label: '语音合成',
        input: { required: ['text'] },
        output: { types: ['audio'], mimeTypes: ['audio/mpeg'] },
        paramSchema: {
          type: 'object',
          properties: { voice: { type: 'string', examples: ['male-qn-qingse'] } },
        },
      },
    ],
    sourceUrls: [],
    enabled: true,
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type GetSettingsResponse = { settings: VoiceAssistantSettings; sessionAgent: null }

/** window.spark 桩：默认全部成功回显，可按通道覆盖。返回各 mock 供调用断言。 */
function stubSpark(handlers: {
  getSettings?: () => Promise<GetSettingsResponse>
  listModels?: () => Promise<unknown>
  updateSettings?: (request: { settings: VoiceAssistantSettings }) => Promise<unknown>
} = {}): {
  // 传入方可能给 vi.fn 也可能给普通函数：按可调用签名窄化，Mock 天然满足
  updateSettings: (request: { settings: VoiceAssistantSettings }) => Promise<unknown>
} {
  const updateSettings =
    handlers.updateSettings ??
    vi.fn(async (request: { settings: VoiceAssistantSettings }) => ({ settings: request.settings }))
  vi.stubGlobal('spark', {
    invoke: vi.fn(async (channel: string, request?: unknown) => {
      if (channel === 'voice-assistant:get-settings') {
        return (
          handlers.getSettings?.() ?? {
            settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS },
            sessionAgent: null,
          }
        )
      }
      if (channel === 'canvas:media-models:list') {
        return handlers.listModels?.() ?? { models: [speechModel('p-minimax', 'speech-2.6-hd', 'MiniMax Speech 2.6 HD')] }
      }
      if (channel === 'voice-assistant:update-settings') {
        return updateSettings(request as { settings: VoiceAssistantSettings })
      }
      throw new Error(`unexpected channel: ${channel}`)
    }),
    on: vi.fn(() => vi.fn()),
  })
  return { updateSettings }
}

let latest: UseVoiceTtsSettingsResult | null = null
let container: HTMLDivElement | null = null
let root: Root | null = null

function Probe(): React.ReactNode {
  latest = useVoiceTtsSettings()
  return null
}

async function renderProbe(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<Probe />)
  })
}

/** 等待挂载后的 async 链路（invoke → setState）跑完：宏任务边界能清空全部微任务链。 */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

/** fake timers 生效期间的刷新：不能依赖被劫持的 setTimeout，只排空微任务。 */
async function flushMicro(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useVoiceTtsSettings', () => {
  afterEach(() => {
    if (root != null) {
      act(() => {
        root?.unmount()
      })
      root = null
    }
    container?.remove()
    container = null
    latest = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('加载成功：ready=true，settings 与候选模型就位', async () => {
    stubSpark({
      getSettings: async () => ({
        settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ttsSpeed: 1.25 },
        sessionAgent: null,
      }),
    })
    await renderProbe()
    await flushAsync()

    expect(latest?.ready).toBe(true)
    expect(latest?.settings?.ttsSpeed).toBe(1.25)
    expect(latest?.models).toHaveLength(1)
    expect(latest?.models[0]?.modelId).toBe('speech-2.6-hd')
    expect(latest?.saveError).toBeNull()
  })

  it('候选列举失败不阻塞首读：ready 照常置位，候选为空数组', async () => {
    stubSpark({ listModels: async () => Promise.reject(new Error('渠道服务不可用')) })
    await renderProbe()
    await flushAsync()

    expect(latest?.ready).toBe(true)
    expect(latest?.settings).not.toBeNull()
    expect(latest?.models).toEqual([])
  })

  it('patch 成功：全量合并提交，并以主进程 normalize 回显回写', async () => {
    stubSpark({
      getSettings: async () => ({
        settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ttsSpeed: 1.25 },
        sessionAgent: null,
      }),
      // 回显与乐观合并值不同：模拟主进程 normalize 后的结果，证明回写优先于乐观值。
      updateSettings: vi.fn(async (request: { settings: VoiceAssistantSettings }) => ({
        settings: { ...request.settings, ttsVoice: `${request.settings.ttsVoice}#normalized` },
      })),
    })
    await renderProbe()
    await flushAsync()

    const patchFn = latest?.patch
    expect(patchFn).toBeDefined()
    let ok = false
    await act(async () => {
      ok = (await patchFn?.({ ttsVoice: 'tongtong' })) ?? false
    })

    expect(ok).toBe(true)
    // 未 patch 的字段保留（全量合并提交，不是只发 patch 片段）。
    expect(latest?.settings?.ttsSpeed).toBe(1.25)
    // 展示的是主进程回显，不是本地乐观合并值。
    expect(latest?.settings?.ttsVoice).toBe('tongtong#normalized')
  })

  it('patch 提交前补读主进程最新设置：陈旧快照里的旧值不被写回', async () => {
    // 场景：启动后用户在设置页把 ttsVoice 从 local 改成 external，HUD 快照仍停留
    // 在启动时的 local。patch 若直接拿快照全量合并，会把 ttsVoice 静默回滚。
    let getCalls = 0
    const updateSettings = vi.fn(async (request: { settings: VoiceAssistantSettings }) => ({
      settings: request.settings,
    }))
    stubSpark({
      getSettings: async () => {
        getCalls += 1
        return getCalls === 1
          ? {
              settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ttsVoice: 'local', ttsSpeed: 1 },
              sessionAgent: null,
            }
          : {
              settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ttsVoice: 'external', ttsSpeed: 1.75 },
              sessionAgent: null,
            }
      },
      updateSettings,
    })
    await renderProbe()
    await flushAsync()

    const patchFn = latest?.patch
    let ok = false
    await act(async () => {
      ok = (await patchFn?.({ ttsSpeed: 2 })) ?? false
    })

    expect(ok).toBe(true)
    const submitted = updateSettings.mock.calls[0]?.[0]?.settings
    // 合并基线是补读到的新值：外部改动没有被陈旧快照回滚。
    expect(submitted?.ttsVoice).toBe('external')
    // patch 字段本身生效。
    expect(submitted?.ttsSpeed).toBe(2)
  })

  it('补读失败回落本地快照合并，单次读取失败不卡死提交', async () => {
    let getCalls = 0
    const updateSettings = vi.fn(async (request: { settings: VoiceAssistantSettings }) => ({
      settings: request.settings,
    }))
    stubSpark({
      getSettings: async () => {
        getCalls += 1
        if (getCalls === 1) {
          return {
            settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ttsVoice: 'local', ttsSpeed: 1 },
            sessionAgent: null,
          }
        }
        throw new Error('IPC 瞬时失败')
      },
      updateSettings,
    })
    await renderProbe()
    await flushAsync()

    const patchFn = latest?.patch
    let ok = false
    await act(async () => {
      ok = (await patchFn?.({ ttsSpeed: 1.5 })) ?? false
    })

    expect(ok).toBe(true)
    const submitted = updateSettings.mock.calls[0]?.[0]?.settings
    // 补读失败时与旧行为一致：回落快照合并，仍能提交。
    expect(submitted?.ttsSpeed).toBe(1.5)
    expect(submitted?.ttsVoice).toBe('local')
  })

  it('patch 失败：回滚提交前快照并展示 saveError', async () => {
    stubSpark({
      getSettings: async () => ({
        settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ttsSpeed: 1.25 },
        sessionAgent: null,
      }),
      updateSettings: vi.fn(async () => Promise.reject(new Error('渠道服务不可用'))),
    })
    await renderProbe()
    await flushAsync()

    const patchFn = latest?.patch
    let ok = true
    await act(async () => {
      ok = (await patchFn?.({ ttsSpeed: 1.5 })) ?? true
    })

    expect(ok).toBe(false)
    // 乐观值被拒绝后原路退回提交前快照。
    expect(latest?.settings?.ttsSpeed).toBe(1.25)
    expect(latest?.saveError).toBe('渠道服务不可用')
  })

  it('saveError 5s 自动清空，且新错误的定时器不被旧 timer 提前清掉', async () => {
    vi.useFakeTimers()
    try {
      let failures = 0
      stubSpark({
        updateSettings: vi.fn(async () => {
          failures += 1
          return Promise.reject(new Error(`失败 ${failures}`))
        }),
      })
      await renderProbe()
      await flushMicro()

      const patchFn = latest?.patch
      await act(async () => {
        await patchFn?.({})
      })
      await flushMicro()
      expect(latest?.saveError).toBe('失败 1')

      // 3s 后第二次失败：旧 timer（还剩 2s）必须被清掉，否则会在 5s 整点提前清空新错误。
      await act(async () => {
        vi.advanceTimersByTime(3000)
        await patchFn?.({})
      })
      await flushMicro()
      expect(latest?.saveError).toBe('失败 2')

      // 距第一次失败已满 5s：新错误仍应展示。
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(latest?.saveError).toBe('失败 2')

      // 距第二次失败满 5s：自动清空。
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(latest?.saveError).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('settings 未就绪时 patch 直接返回 false，不发起保存请求', async () => {
    const pendingSettings = createDeferred<GetSettingsResponse>()
    const { updateSettings } = stubSpark({
      getSettings: () => pendingSettings.promise,
    })
    await renderProbe()
    await flushAsync()

    expect(latest?.ready).toBe(false)
    expect(latest?.settings).toBeNull()

    const patchFn = latest?.patch
    let ok = true
    await act(async () => {
      ok = (await patchFn?.({ ttsSpeed: 1.5 })) ?? true
    })

    expect(ok).toBe(false)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('卸载后 invoke 迟到完成不崩溃、不产生未处理拒绝', async () => {
    // React 18 对已卸载组件的 setState 是静默 no-op，「没写入」无法从外部断言；
    // cancelled 标志守卫的正确性体现在：迟到解析既不抛错也不产生未处理拒绝
    // （vitest 会把未处理拒绝判为测试失败，本用例正常通过即为通过）。
    const pendingSettings = createDeferred<GetSettingsResponse>()
    const pendingModels = createDeferred<unknown>()
    stubSpark({
      getSettings: () => pendingSettings.promise,
      listModels: () => pendingModels.promise,
    })
    await renderProbe()
    expect(latest?.ready).toBe(false)

    await act(async () => {
      root?.unmount()
    })
    root = null

    await act(async () => {
      pendingSettings.resolve({
        settings: DEFAULT_VOICE_ASSISTANT_SETTINGS,
        sessionAgent: null,
      })
      pendingModels.resolve({ models: [] })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  })
})
