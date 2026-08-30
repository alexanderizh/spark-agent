import { describe, expect, it } from 'vitest'
import {
  hasSessionReferenceDrag,
  readSessionReferenceDragPayload,
  writeSessionReferenceDragPayload,
} from './session-reference-dnd'

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    getData: (format: string) => values.get(format) ?? '',
    setData: (format: string, value: string) => {
      values.set(format, value)
    },
    get types() {
      return Array.from(values.keys())
    },
  } as unknown as DataTransfer
}

describe('session reference drag payload', () => {
  it('preserves the source session turn count', () => {
    const dataTransfer = createDataTransfer()

    writeSessionReferenceDragPayload(dataTransfer, {
      sessionId: 'source-1',
      title: '源会话',
      projectId: 'project-1',
      updatedAt: '2026-08-14T00:00:00.000Z',
      turnCount: 7,
    })

    expect(hasSessionReferenceDrag(dataTransfer)).toBe(true)
    expect(readSessionReferenceDragPayload(dataTransfer)).toEqual({
      sessionId: 'source-1',
      title: '源会话',
      projectId: 'project-1',
      updatedAt: '2026-08-14T00:00:00.000Z',
      turnCount: 7,
    })
  })

  it('ignores invalid turn counts instead of trusting external drag data', () => {
    const dataTransfer = createDataTransfer()
    writeSessionReferenceDragPayload(dataTransfer, {
      sessionId: 'source-1',
      title: '源会话',
    })
    const raw = JSON.stringify({
      sessionId: 'source-1',
      title: '源会话',
      turnCount: -1,
    })
    dataTransfer.setData('application/x-spark-session-reference', raw)

    expect(readSessionReferenceDragPayload(dataTransfer)).toEqual({
      sessionId: 'source-1',
      title: '源会话',
    })
  })
})
