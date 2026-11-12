/**
 * 远程输入区的草稿（按设备 + 会话隔离）。
 *
 * 为什么需要它：`RemoteChatPane` 是一个长驻组件，`sessionId` 变了只是换数据，
 * 组件自己的 state 不会重置 —— 结果在会话 A 打的字切到 B 还留着，切回 A 又没了。
 * 草稿与「待发附件」一起按会话存，切走再回来能接着写，也不会串到别的会话上。
 *
 * 存在模块级 Map 里（不是组件 ref）：远程视图是 lazy 挂载的，切到别的页面再回来
 * 组件会重建，模块级状态能让草稿活过一次视图切换；进程退出即丢，不落盘。
 */

import type { RemoteAttachmentRef } from './RemoteAttachmentStrip'

export interface RemoteDraft {
  text: string
  attachments: RemoteAttachmentRef[]
}

/** 最多记这么多会话的草稿，超出按写入顺序淘汰最旧的 */
export const MAX_REMOTE_DRAFTS = 40

const drafts = new Map<string, RemoteDraft>()

function draftKey(deviceId: string, sessionId: string): string {
  // 目标机不同 => 附件路径不同，必须按设备分开存
  return `${deviceId}\u0000${sessionId}`
}

function isEmpty(draft: RemoteDraft): boolean {
  return draft.text.trim().length === 0 && draft.attachments.length === 0
}

export function readRemoteDraft(deviceId: string, sessionId: string): RemoteDraft | null {
  const found = drafts.get(draftKey(deviceId, sessionId))
  return found != null ? { text: found.text, attachments: [...found.attachments] } : null
}

/**
 * 写入 / 覆盖草稿；空白草稿等同于删除（不给「空草稿」占位置，
 * 否则淘汰逻辑会被一堆空条目挤掉真正有用的草稿）。
 */
export function writeRemoteDraft(deviceId: string, sessionId: string, draft: RemoteDraft): void {
  const key = draftKey(deviceId, sessionId)
  if (isEmpty(draft)) {
    drafts.delete(key)
    return
  }
  // 重新插入以刷新顺序：Map 保持插入序，先删再设 = 最近使用排到最后
  drafts.delete(key)
  drafts.set(key, { text: draft.text, attachments: [...draft.attachments] })
  while (drafts.size > MAX_REMOTE_DRAFTS) {
    const oldest = drafts.keys().next()
    if (oldest.done === true) break
    drafts.delete(oldest.value)
  }
}

export function clearRemoteDraft(deviceId: string, sessionId: string): void {
  drafts.delete(draftKey(deviceId, sessionId))
}

/** 仅供测试：清空模块级缓存 */
export function resetRemoteDrafts(): void {
  drafts.clear()
}
