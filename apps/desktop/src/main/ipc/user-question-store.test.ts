import { describe, expect, it, vi } from 'vitest'
import { PendingUserQuestionStore } from './user-question-store.js'

const prompt = [{ header: '确认', question: '继续吗？', options: [{ label: '继续' }] }]

describe('PendingUserQuestionStore', () => {
  it('deduplicates stable question ids and replays the same pending request', async () => {
    const onRequest = vi.fn()
    const onClose = vi.fn()
    const store = new PendingUserQuestionStore({ onRequest, onClose })

    const first = store.request({ questionId: 'tool-1', sessionId: 'session-1', questions: prompt })
    const duplicate = store.request({
      questionId: 'tool-1',
      sessionId: 'session-1',
      questions: prompt,
    })

    expect(duplicate).toBe(first)
    expect(onRequest).toHaveBeenCalledTimes(2)
    expect(store.list('session-1')).toHaveLength(1)
    expect(store.resolve('other-session', 'tool-1', {})).toBe(false)
    expect(store.resolve('session-1', 'tool-1', { answers: ['继续'] })).toBe(true)
    await expect(first).resolves.toEqual({ answers: ['继续'] })
    expect(store.resolve('session-1', 'tool-1', {})).toBe(false)
    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'tool-1' }),
      'answered',
    )
  })

  it('removes and settles questions when their SDK control request is aborted', async () => {
    const onClose = vi.fn()
    const controller = new AbortController()
    const store = new PendingUserQuestionStore({ onRequest: vi.fn(), onClose })
    const pending = store.request({
      questionId: 'tool-2',
      sessionId: 'session-1',
      questions: prompt,
      signal: controller.signal,
    })

    controller.abort()

    await expect(pending).resolves.toEqual({ cancelled: true })
    expect(store.list()).toEqual([])
    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'tool-2' }),
      'aborted',
    )
  })
})
