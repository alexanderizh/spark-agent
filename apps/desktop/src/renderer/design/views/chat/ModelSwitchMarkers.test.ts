import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readModelSwitchMarkers, saveModelSwitchMarker } from './ModelSwitchMarkers'

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
})
