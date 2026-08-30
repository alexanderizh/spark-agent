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
    await expect(store.resolve('other-session', 'tool-1', {})).resolves.toBe(false)
    await expect(store.resolve('session-1', 'tool-1', { answers: ['继续'] })).resolves.toBe(true)
    await expect(first).resolves.toEqual({ answers: ['继续'] })
    await expect(store.resolve('session-1', 'tool-1', {})).resolves.toBe(false)
    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'tool-1' }),
      'answered',
    )
  })

  it('keeps questions visible when their SDK control request is aborted', async () => {
    const onClose = vi.fn()
    const onDetachedAnswer = vi.fn(async () => undefined)
    const controller = new AbortController()
    const store = new PendingUserQuestionStore({
      onRequest: vi.fn(),
      onClose,
      onDetachedAnswer,
    })
    const pending = store.request({
      questionId: 'tool-2',
      sessionId: 'session-1',
      questions: prompt,
      sourceTurnId: 'turn-1',
      signal: controller.signal,
    })

    controller.abort()

    expect(store.list()).toEqual([
      expect.objectContaining({ questionId: 'tool-2', sessionId: 'session-1' }),
    ])
    expect(onClose).not.toHaveBeenCalled()

    await expect(
      store.resolve('session-1', 'tool-2', { answers: [{ answer: '继续' }] }),
    ).resolves.toBe(true)
    await expect(pending).resolves.toEqual({ answers: [{ answer: '继续' }] })
    expect(onDetachedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'tool-2' }),
      { answers: [{ answer: '继续' }] },
      { sourceTurnId: 'turn-1' },
    )
    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'tool-2' }),
      'answered',
    )
  })

  it('treats an explicit close as cancellation without creating a recovery turn', async () => {
    const onDetachedAnswer = vi.fn(async () => undefined)
    const controller = new AbortController()
    const store = new PendingUserQuestionStore({
      onRequest: vi.fn(),
      onClose: vi.fn(),
      onDetachedAnswer,
    })
    const pending = store.request({
      questionId: 'tool-3',
      sessionId: 'session-1',
      questions: prompt,
      signal: controller.signal,
    })
    controller.abort()

    await expect(
      store.resolve('session-1', 'tool-3', { cancelled: true, declined: true }),
    ).resolves.toBe(true)
    await expect(pending).resolves.toEqual({ cancelled: true, declined: true })
    expect(onDetachedAnswer).not.toHaveBeenCalled()
  })
})
