import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceInputQueue, type QueuedVoiceInput } from './VoiceInputQueue.js'

describe('VoiceInputQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function createQueue(
    capacity = 3,
    events: {
      onEnqueued?: (entry: QueuedVoiceInput, evicted: QueuedVoiceInput | null) => void
      onDraftConfirmed?: (text: string) => void
      onRemoved?: (entry: QueuedVoiceInput, cause: 'discarded' | 'dispatched' | 'cleared') => void
    } = {},
  ): VoiceInputQueue {
    return new VoiceInputQueue(capacity, () => 500, {
      onEnqueued: events.onEnqueued ?? (() => undefined),
      onDraftChanged: () => undefined,
      onDraftConfirmed: events.onDraftConfirmed ?? (() => undefined),
      onRemoved: events.onRemoved ?? (() => undefined),
    })
  }

  it('draft 确认窗口：静默到期收口为一条输入（onDraftConfirmed）', async () => {
    const confirmed: string[] = []
    const queue = createQueue(3, { onDraftConfirmed: (text) => confirmed.push(text) })
    queue.feedDraftFinal('帮我查日程', 'thinking')
    expect(queue.draft).toEqual({ text: '帮我查日程' })
    await vi.advanceTimersByTimeAsync(500)
    expect(confirmed).toEqual(['帮我查日程'])
    expect(queue.draft).toBeNull()
  })

  it('窗口内继续说：撤销计时拼接为一条', async () => {
    const confirmed: string[] = []
    const queue = createQueue(3, { onDraftConfirmed: (text) => confirmed.push(text) })
    queue.feedDraftFinal('等一下', 'thinking')
    await vi.advanceTimersByTimeAsync(300)
    queue.feedDraftFinal('换个话题', 'thinking')
    expect(queue.draft).toEqual({ text: '等一下 换个话题' })
    await vi.advanceTimersByTimeAsync(500)
    expect(confirmed).toEqual(['等一下 换个话题'])
  })

  it('partial 活动信号撤销计时（extendDraft）', async () => {
    const confirmed: string[] = []
    const queue = createQueue(3, { onDraftConfirmed: (text) => confirmed.push(text) })
    queue.feedDraftFinal('说话中', 'speaking')
    await vi.advanceTimersByTimeAsync(300)
    queue.extendDraft('speaking')
    await vi.advanceTimersByTimeAsync(300) // 原计时已过但被重置
    expect(confirmed).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(confirmed).toEqual(['说话中'])
  })

  it('容量满挤掉最旧并回调 evicted', () => {
    const enqueued: Array<{ text: string; evicted: string | null }> = []
    const removed: string[] = []
    const queue = createQueue(2, {
      onEnqueued: (entry, evicted) =>
        enqueued.push({ text: entry.text, evicted: evicted?.text ?? null }),
      onRemoved: (entry) => removed.push(entry.text),
    })
    queue.enqueue('第一条', 'thinking')
    queue.enqueue('第二条', 'thinking')
    queue.enqueue('第三条', 'thinking')
    expect(queue.snapshot().map((e) => e.text)).toEqual(['第二条', '第三条'])
    expect(enqueued[2]).toEqual({ text: '第三条', evicted: '第一条' })
    expect(removed).toContain('第一条')
  })

  it('removeById 移除指定条目（放弃按钮）', () => {
    const queue = createQueue(3)
    const first = queue.enqueue('第一条', 'thinking')
    const second = queue.enqueue('第二条', 'thinking')
    expect(first?.text).toBe('第一条')
    expect(second?.text).toBe('第二条')
    if (first == null || second == null) throw new Error('enqueue 不应返回 null')
    expect(queue.removeById(second.id)?.text).toBe('第二条')
    expect(queue.snapshot().map((e) => e.text)).toEqual(['第一条'])
    expect(queue.removeById(first.id)?.text).toBe('第一条')
    expect(queue.size).toBe(0)
  })

  it('latest 返回最新条（HUD 展示「刚说的那句」）', () => {
    const queue = createQueue(3)
    queue.enqueue('第一条', 'thinking')
    queue.enqueue('第二条', 'speaking')
    expect(queue.latest()?.text).toBe('第二条')
  })

  it('clear 逐条回调并清空 draft', async () => {
    const removed: string[] = []
    const queue = createQueue(3, { onRemoved: (entry) => removed.push(entry.text) })
    queue.enqueue('a', 'thinking')
    queue.enqueue('b', 'thinking')
    queue.feedDraftFinal('草稿中', 'speaking')
    queue.clear()
    expect(removed).toEqual(['a', 'b'])
    expect(queue.size).toBe(0)
    expect(queue.draft).toBeNull()
    await vi.advanceTimersByTimeAsync(600) // draft 计时器已清，不产生确认回调
  })

  it('cancelDraft 丢弃当前草稿（打断场景）', async () => {
    const confirmed: string[] = []
    const queue = createQueue(3, { onDraftConfirmed: (text) => confirmed.push(text) })
    queue.feedDraftFinal('说一半', 'thinking')
    queue.cancelDraft()
    await vi.advanceTimersByTimeAsync(600)
    expect(confirmed).toEqual([])
    expect(queue.draft).toBeNull()
  })

  it('dispose 后不再接受输入', () => {
    const queue = createQueue(3)
    queue.dispose()
    queue.enqueue('x', 'thinking')
    expect(queue.size).toBe(0)
  })

  it('dequeueHead 触发 onRemoved(dispatched)：派发即时刷新 status 的依据', () => {
    const removed: Array<{ id: string; cause: string }> = []
    const queue = createQueue(3, {
      onRemoved: (entry, cause) => removed.push({ id: entry.id, cause }),
    })
    const entry = queue.enqueue('第一条', 'thinking')
    if (entry == null) throw new Error('enqueue 不应返回 null')
    expect(queue.dequeueHead()?.id).toBe(entry.id)
    expect(removed).toEqual([{ id: entry.id, cause: 'dispatched' }])
    expect(queue.size).toBe(0)
    expect(queue.dequeueHead()).toBeNull() // 空队出队不再触发回调
    expect(removed.length).toBe(1)
  })

  it('removeById cause 区分放弃与抢占派发（日志/广播语义）', () => {
    const removed: Array<{ id: string; cause: string }> = []
    const queue = createQueue(3, {
      onRemoved: (entry, cause) => removed.push({ id: entry.id, cause }),
    })
    const discarded = queue.enqueue('放弃我', 'thinking')
    const dispatched = queue.enqueue('立即发我', 'thinking')
    if (discarded == null || dispatched == null) throw new Error('enqueue 不应返回 null')
    queue.removeById(discarded.id) // 缺省 = 放弃按钮
    queue.removeById(dispatched.id, 'dispatched') // 立即发送抢占
    expect(removed.map((r) => r.cause)).toEqual(['discarded', 'dispatched'])
  })
})
