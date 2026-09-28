import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readModelSwitchMarkers,
  saveModelSwitchMarker,
  shouldRecordModelSwitch,
} from './ModelSwitchMarkers'

describe('model switch markers', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('persists a marker for a session', () => {
    const marker = {
      afterMessageId: 'message-1',
      fromModel: 'GLM-5.2',
      toModel: '火山',
      createdAt: '2026-07-12T12:00:00.000Z',
    }

    saveModelSwitchMarker('session-1', marker)

    expect(readModelSwitchMarkers('session-1')).toEqual([marker])
    expect(readModelSwitchMarkers('session-2')).toEqual([])
  })

  it('merges repeated switches at the same message boundary', () => {
    saveModelSwitchMarker('session-1', {
      afterMessageId: 'message-1',
      fromModel: 'model-a',
      toModel: 'model-b',
      createdAt: 'first',
    })

    expect(
      saveModelSwitchMarker('session-1', {
        afterMessageId: 'message-1',
        fromModel: 'model-b',
        toModel: 'model-c',
        createdAt: 'second',
      }),
    ).toEqual([
      {
        afterMessageId: 'message-1',
        fromModel: 'model-a',
        toModel: 'model-c',
        createdAt: 'first',
      },
    ])
  })

  // 回归背景：切到「智能路由」行时目标模型名解析为空，曾落盘 toModel: '' 并渲染出
  // 「模型已从 deepseek-v4.1-flash 更改为 」这样的半句话提示（紧邻「已路由」提示条，看似重复）。
  it('drops persisted markers whose target model name is empty', () => {
    values.set(
      'spark:model-switch-markers:session-1',
      JSON.stringify([
        {
          afterMessageId: 'message-1',
          fromModel: 'deepseek-v4.1-flash',
          toModel: '',
          createdAt: 'first',
        },
        {
          afterMessageId: 'message-2',
          fromModel: 'deepseek-v4.1-flash',
          toModel: 'glm-5.3-flash',
          createdAt: 'second',
        },
      ]),
    )

    expect(readModelSwitchMarkers('session-1')).toEqual([
      {
        afterMessageId: 'message-2',
        fromModel: 'deepseek-v4.1-flash',
        toModel: 'glm-5.3-flash',
        createdAt: 'second',
      },
    ])
  })

  it('refuses to persist a switch whose target model cannot be resolved', () => {
    expect(
      saveModelSwitchMarker('session-1', {
        afterMessageId: 'message-1',
        fromModel: 'deepseek-v4.1-flash',
        toModel: '',
        createdAt: 'now',
      }),
    ).toEqual([])

    expect(values.get('spark:model-switch-markers:session-1')).toBeUndefined()
  })
})

describe('shouldRecordModelSwitch', () => {
  it('records a switch between two resolved models', () => {
    expect(shouldRecordModelSwitch('deepseek-v4.1-flash', 'glm-5.3-flash')).toBe(true)
  })

  it('skips a switch whose target model is empty (auto-router row)', () => {
    expect(shouldRecordModelSwitch('deepseek-v4.1-flash', '')).toBe(false)
    expect(shouldRecordModelSwitch('deepseek-v4.1-flash', '   ')).toBe(false)
  })

  it('skips a switch without an origin model', () => {
    expect(shouldRecordModelSwitch('', 'glm-5.3-flash')).toBe(false)
  })

  it('skips a no-op switch', () => {
    expect(shouldRecordModelSwitch('glm-5.3-flash', 'glm-5.3-flash')).toBe(false)
    expect(shouldRecordModelSwitch(' glm-5.3-flash ', 'glm-5.3-flash')).toBe(false)
  })
})
