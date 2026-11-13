/**
 * 远程会话标记的展示文案（纯数据，无依赖）。
 *
 * 之前放在 remoteSessionActions 里，但筛选/分组这些纯函数也要用同一份文案，
 * 而 actions 依赖桥接 hook 与 AppContext —— 抽到这里两边都能引，不会成环。
 */
import type { SessionLabelKey } from '@spark/protocol'

/** 与桌面端侧栏右键菜单同序（新增标记只改这一处 + 配色） */
export const REMOTE_SESSION_LABELS: ReadonlyArray<{ key: SessionLabelKey; label: string }> = [
  { key: 'suspended', label: '挂起' },
  { key: 'not-started', label: '未开始' },
  { key: 'pending-review', label: '待审查' },
  { key: 'pending-advance', label: '待推进' },
  { key: 'undelivered', label: '未交付' },
]

export function sessionLabelText(key: SessionLabelKey | null | undefined): string | null {
  if (key == null) return null
  return REMOTE_SESSION_LABELS.find((meta) => meta.key === key)?.label ?? null
}
