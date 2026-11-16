/**
 * 会话阅读进度（滚动位置）的内存存档。
 *
 * 为什么需要它：三个聊天容器（ChatView 主聊天流 / ChatPanel 嵌入面板 /
 * RemoteChatPane 远程会话）都是「长驻组件 + sessionId 变化换数据」的模式，
 * 切换会话时历史会重新加载，旧实现一律强制贴底 —— 用户在长会话里翻到一半
 * 切去别的会话再切回来，阅读位置就丢了。
 *
 * 存档内容只有 { scrollTop, atBottom }：恢复用绝对 scrollTop（历史首屏窗口
 * 总是「最近 N 轮」，顶部内容跨切换稳定，绝对值即内容位置）；atBottom 记录
 * 切走时是否贴底 —— 贴底的会话切回来应继续保持跟随（贴底），不该恢复旧值。
 *
 * 存在模块级 Map 里（不是组件 ref）：SideChatPanel / 远程视图都是 lazy 挂载，
 * 切页面回来组件会重建，模块级状态能让进度活过一次视图切换；进程退出即丢，
 * 不落盘（滚动值高频变化，写 localStorage 得每次滚动都落盘，不值得）。
 *
 * key 由调用方拼：本地会话用 sessionId；远程会话用 `${deviceId}\u0000${sessionId}`
 * （不同目标机的会话 id 可能撞车，与 remoteDrafts 同一套分隔符）。
 */

/** 切走时距底部多少像素内算「贴底」——与 ChatPanel.handleScroll 的口径一致 */
export const CHAT_SCROLL_AT_BOTTOM_THRESHOLD_PX = 80

export interface ChatScrollState {
  scrollTop: number
  atBottom: boolean
}

/** 最多记这么多会话的进度，超出按写入顺序淘汰最旧的 */
export const MAX_CHAT_SCROLL_MEMORIES = 200

const memories = new Map<string, ChatScrollState>()

/** 读取会话的阅读进度；没有存档（从未切走过）返回 null */
export function readChatScroll(key: string): ChatScrollState | null {
  const found = memories.get(key)
  return found != null ? { ...found } : null
}

/**
 * 写入 / 覆盖会话的阅读进度。贴底状态不占存档（切回来本来就该贴底，
 * 留着会让「用户到底部后切走再切回」的条目挤掉真正需要恢复的进度）。
 */
export function rememberChatScroll(key: string, state: ChatScrollState): void {
  if (state.atBottom) {
    memories.delete(key)
    return
  }
  // 重新插入以刷新顺序：Map 保持插入序，先删再设 = 最近使用排到最后
  memories.delete(key)
  memories.set(key, { ...state })
  while (memories.size > MAX_CHAT_SCROLL_MEMORIES) {
    const oldest = memories.keys().next()
    if (oldest.done === true) break
    memories.delete(oldest.value)
  }
}

/** 会话被删除 / 重置时清掉对应进度 */
export function forgetChatScroll(key: string): void {
  memories.delete(key)
}

/** 恢复时的安全钳制：存档值可能超过当前可滚动范围（内容变短 / 首屏历史更少） */
export function clampChatScrollTop(
  top: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, Math.min(top, scrollHeight - clientHeight))
}

/** 距底部距离是否算贴底（保存口径统一走这里，避免三处阈值漂移） */
export function isChatScrollAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight < CHAT_SCROLL_AT_BOTTOM_THRESHOLD_PX
}

/** 仅供测试：清空模块级缓存 */
export function resetChatScrollMemory(): void {
  memories.clear()
}
