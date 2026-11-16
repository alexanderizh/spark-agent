import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_CHAT_SCROLL_MEMORIES,
  CHAT_SCROLL_AT_BOTTOM_THRESHOLD_PX,
  clampChatScrollTop,
  forgetChatScroll,
  isChatScrollAtBottom,
  readChatScroll,
  rememberChatScroll,
  resetChatScrollMemory,
} from './chat-scroll-memory'

describe('chat-scroll-memory', () => {
  beforeEach(() => {
    resetChatScrollMemory()
  })

  it('读取不存在的会话返回 null', () => {
    expect(readChatScroll('session-a')).toBeNull()
  })

  it('记住并读回非贴底进度', () => {
    rememberChatScroll('session-a', { scrollTop: 1234, atBottom: false })
    expect(readChatScroll('session-a')).toEqual({ scrollTop: 1234, atBottom: false })
  })

  it('贴底状态不占存档：写贴底等价于删除', () => {
    rememberChatScroll('session-a', { scrollTop: 0, atBottom: true })
    expect(readChatScroll('session-a')).toBeNull()

    rememberChatScroll('session-a', { scrollTop: 500, atBottom: false })
    rememberChatScroll('session-a', { scrollTop: 0, atBottom: true })
    // 用户滚回底部后切走：切回来本来就该贴底，不留旧进度
    expect(readChatScroll('session-a')).toBeNull()
  })

  it('覆盖写入取最新值，且返回副本（外部改不动缓存）', () => {
    rememberChatScroll('session-a', { scrollTop: 100, atBottom: false })
    rememberChatScroll('session-a', { scrollTop: 200, atBottom: false })
    const saved = readChatScroll('session-a')
    expect(saved).toEqual({ scrollTop: 200, atBottom: false })
    if (saved != null) saved.scrollTop = 999
    expect(readChatScroll('session-a')).toEqual({ scrollTop: 200, atBottom: false })
  })

  it('不同 key 互不串扰', () => {
    rememberChatScroll('session-a', { scrollTop: 100, atBottom: false })
    rememberChatScroll('device-1\u0000session-a', { scrollTop: 300, atBottom: false })
    expect(readChatScroll('session-a')?.scrollTop).toBe(100)
    expect(readChatScroll('device-1\u0000session-a')?.scrollTop).toBe(300)
  })

  it(`超过上限（${MAX_CHAT_SCROLL_MEMORIES}）按写入顺序淘汰最旧的`, () => {
    for (let i = 0; i < MAX_CHAT_SCROLL_MEMORIES + 5; i += 1) {
      rememberChatScroll(`session-${i}`, { scrollTop: i, atBottom: false })
    }
    expect(readChatScroll('session-0')).toBeNull()
    expect(readChatScroll('session-4')).toBeNull()
    expect(readChatScroll('session-5')?.scrollTop).toBe(5)
    expect(readChatScroll(`session-${MAX_CHAT_SCROLL_MEMORIES + 4}`)?.scrollTop).toBe(
      MAX_CHAT_SCROLL_MEMORIES + 4,
    )
  })

  it('重新 remember 会刷新 LRU 顺序', () => {
    for (let i = 0; i < MAX_CHAT_SCROLL_MEMORIES; i += 1) {
      rememberChatScroll(`session-${i}`, { scrollTop: i, atBottom: false })
    }
    // 刚写入的最早条目被重新触碰后应活下来，次早的被挤掉
    rememberChatScroll('session-0', { scrollTop: 0, atBottom: false })
    for (let i = 0; i < 5; i += 1) {
      rememberChatScroll(`session-new-${i}`, { scrollTop: i, atBottom: false })
    }
    expect(readChatScroll('session-0')).not.toBeNull()
    expect(readChatScroll('session-1')).toBeNull()
  })

  it('forgetChatScroll 清掉指定会话', () => {
    rememberChatScroll('session-a', { scrollTop: 100, atBottom: false })
    forgetChatScroll('session-a')
    expect(readChatScroll('session-a')).toBeNull()
  })

  describe('clampChatScrollTop', () => {
    it('钳到 [0, scrollHeight - clientHeight]', () => {
      expect(clampChatScrollTop(500, 2000, 800)).toBe(500)
      expect(clampChatScrollTop(5000, 2000, 800)).toBe(1200)
      expect(clampChatScrollTop(-50, 2000, 800)).toBe(0)
      // 内容不足一屏（不可滚动）时恒为 0
      expect(clampChatScrollTop(300, 500, 800)).toBe(0)
    })
  })

  describe('isChatScrollAtBottom', () => {
    it(`距底部小于 ${CHAT_SCROLL_AT_BOTTOM_THRESHOLD_PX}px 算贴底`, () => {
      // scrollHeight=2000, clientHeight=800 → 底部 scrollTop=1200
      expect(isChatScrollAtBottom(1200, 2000, 800)).toBe(true)
      expect(isChatScrollAtBottom(1200 - CHAT_SCROLL_AT_BOTTOM_THRESHOLD_PX + 1, 2000, 800)).toBe(
        true,
      )
      expect(isChatScrollAtBottom(1200 - CHAT_SCROLL_AT_BOTTOM_THRESHOLD_PX, 2000, 800)).toBe(false)
    })
  })
})
