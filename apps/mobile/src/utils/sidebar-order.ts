/**
 * 侧栏排序与置顶区语义（与桌面端同构的纯函数集合）。
 *
 * 桌面端来源（勿分叉语义，改请两端同步）：
 *   - 置顶区判定/有效置顶时间：apps/desktop/src/renderer/design/session-labels.ts
 *     （isSessionPinnedZone / getSessionPinTime）
 *   - 手动序应用/置顶分区：apps/desktop/src/renderer/design/sidebar-manual-order.ts
 *     （sortByManualOrder / sortByManualOrderWithinPinnedSections / moveItem）
 *   - 项目组内会话合成：apps/desktop/src/renderer/design/sidebar-session-sort.ts
 *     （composeProjectGroupSessions：置顶段与普通段各自套用手动序）
 *   - 被筛选隐藏项的顺序合并：sidebar-manual-order.ts mergeManualOrderWithHidden
 *
 * 小程序不引入 @spark/protocol（包体约束），类型在此手工同步。
 */

import type { BridgeSessionSummary } from '../api/bridge'

// ─── 会话标记（5 预置标签，与桌面端 SESSION_LABEL_KEYS/SESSION_LABELS 对齐） ────

export const SESSION_LABEL_KEYS = [
  'suspended',
  'not-started',
  'pending-review',
  'pending-advance',
  'undelivered',
] as const

export type BridgeSessionLabelKey = (typeof SESSION_LABEL_KEYS)[number]

export interface SessionLabelMeta {
  key: BridgeSessionLabelKey
  /** 界面文案（桌面端 i18n zh 的对应措辞） */
  label: string
  /** 行内标签配色 class 后缀（页面 wxss 内定义） */
  colorClass: string
}

/** 顺序即标记菜单与筛选器展示顺序（与桌面端一致） */
export const SESSION_LABELS: readonly SessionLabelMeta[] = [
  { key: 'suspended', label: '挂起', colorClass: 'label-suspended' },
  { key: 'not-started', label: '未开始', colorClass: 'label-not-started' },
  { key: 'pending-review', label: '待审查', colorClass: 'label-pending-review' },
  { key: 'pending-advance', label: '待推进', colorClass: 'label-pending-advance' },
  { key: 'undelivered', label: '未交付', colorClass: 'label-undelivered' },
]

const LABEL_BY_KEY = new Map<string, SessionLabelMeta>(
  SESSION_LABELS.map((meta) => [meta.key, meta] as const),
)

export function getSessionLabelMeta(key: string | null | undefined): SessionLabelMeta | null {
  if (key == null) return null
  return LABEL_BY_KEY.get(key) ?? null
}

// ─── 系统保留项目（与桌面端 NO_PROJECT_WORKSPACE_NAME 同值；@spark/protocol/workspace） ──

/**
 * 桌面端侧栏「临时会话」分组的真实工作区名：主进程与渲染端都按名称查找它，
 * 改名/归档/删除会破坏该查找——桌面端桥接层对这三类写操作直接拒绝（400），
 * 小程序端同名守卫用于直接隐藏菜单项（不发无效请求）。
 */
export const NO_PROJECT_WORKSPACE_NAME = '不使用项目'

// ─── 置顶区判定（桌面端统一谓词，移动端所有分区都走这里） ───────────────────────

/** 置顶区最小会话结构 */
export type SessionLabelCarrier = Pick<
  BridgeSessionSummary,
  'pinnedAt' | 'labeledAt' | 'sessionLabel'
>

/** 手动置顶或已打标都算置顶区（有标记的会话自动进置顶区，与桌面端一致） */
export function isSessionPinnedZone(session: SessionLabelCarrier): boolean {
  return session.pinnedAt != null || session.sessionLabel != null
}

/** 置顶区内排序时间：手动置顶优先，其次打标时间（刚打标即浮到置顶区顶部） */
export function getSessionPinTime(session: SessionLabelCarrier): string | null {
  return session.pinnedAt ?? session.labeledAt ?? null
}

// ─── 手动序（桌面端 sidebar-manual-order 同构复制） ─────────────────────────────

/**
 * 应用持久化手动序（不改入参数组）。最近一次排序之后新建的项没有秩，
 * 保持在段首按兜底顺序展示（与桌面端无秩项规则一致）。
 */
export function sortByManualOrder<T>(
  items: readonly T[],
  manualIds: readonly string[] | undefined,
  getId: (item: T) => string,
): T[] {
  if (manualIds == null || manualIds.length === 0) return [...items]
  const rank = new Map(manualIds.map((id, index) => [id, index] as const))
  return items
    .map((item, index) => ({ item, index, rank: rank.get(getId(item)) }))
    .sort((left, right) => {
      if (left.rank == null && right.rank != null) return -1
      if (left.rank != null && right.rank == null) return 1
      if (left.rank != null && right.rank != null) return left.rank - right.rank
      return left.index - right.index
    })
    .map(({ item }) => item)
}

/**
 * 先整体套用手动序，再稳定切分「置顶段在前 / 普通段在后」。
 * 置顶与普通共用同一份持久化顺序（桌面端同模型），秩先落位再分区。
 */
export function sortByManualOrderWithinPinnedSections<T>(
  items: readonly T[],
  manualIds: readonly string[] | undefined,
  getId: (item: T) => string,
  isPinned: (item: T) => boolean,
): T[] {
  const manuallyOrdered = sortByManualOrder(items, manualIds, getId)
  return [...manuallyOrdered.filter(isPinned), ...manuallyOrdered.filter((item) => !isPinned(item))]
}

/** 数组内移动一项（越界/同位时原样返回拷贝） */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items]
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (moved == null) return [...items]
  next.splice(toIndex, 0, moved)
  return next
}

/**
 * 在被筛选（搜索/标记过滤）的视图上移动可见项时，把仅含可见项的新顺序合并回
 * 完整手动序：可见项按 visibleNext 的相对顺序落位，被隐藏但仍存在的项按原邻居
 * 位置插回（避免一次移动把隐藏项挤出手动序）；staleIds 之外的隐藏 id 视为已删除
 * 数据沿用「移动即自清理」语义。与桌面端 mergeManualOrderWithHidden 同构。
 */
export function mergeManualOrderWithHidden(
  fullOrder: readonly string[] | undefined,
  visibleNext: readonly string[],
  validHiddenIds: ReadonlySet<string>,
): string[] {
  const persisted = fullOrder ?? []
  const visibleSet = new Set(visibleNext)
  const persistedSet = new Set(persisted)
  const result: string[] = []
  const emitted = new Set<string>()
  const emit = (id: string): void => {
    if (emitted.has(id)) return
    emitted.add(id)
    result.push(id)
  }
  // 新建未排序项在展示段最前（sortByManualOrder 的无秩项规则），合并后保持相对位置
  for (const id of visibleNext) {
    if (!persistedSet.has(id)) emit(id)
  }
  let cursor = 0
  for (const id of persisted) {
    if (!visibleSet.has(id)) {
      if (validHiddenIds.has(id)) emit(id)
      continue
    }
    while (cursor < visibleNext.length && visibleNext[cursor] !== id) {
      const nextVisible = visibleNext[cursor]
      if (nextVisible != null) emit(nextVisible)
      cursor += 1
    }
    if (visibleNext[cursor] === id) cursor += 1
    emit(id)
  }
  for (; cursor < visibleNext.length; cursor += 1) {
    const remaining = visibleNext[cursor]
    if (remaining != null) emit(remaining)
  }
  return result
}

/**
 * 旧版桌面端兼容回显校验：写请求成功但响应实体缺少/未变更目标字段时，
 * 说明桌面端版本过低忽略了新字段，端上应提示升级而不是假成功。
 * 返回中文提示；null = 校验通过。
 */
export function describeWriteEchoMismatch(
  expected: { label?: string | null; pinned?: boolean },
  actual: { sessionLabel?: string | null; labeledAt?: string | null; pinnedAt?: string | null },
): string | null {
  if (expected.label !== undefined) {
    const actualLabel = actual.sessionLabel ?? null
    if (actualLabel !== expected.label) {
      return actualLabel == null && expected.label != null
        ? '这台电脑的桌面端版本过低，请升级后再使用标记功能'
        : '标记状态与预期不一致，请刷新后重试'
    }
    return null
  }
  if (expected.pinned !== undefined) {
    const actualPinned = actual.pinnedAt != null
    if (actualPinned !== expected.pinned) {
      return '置顶状态与预期不一致，请刷新后重试'
    }
  }
  return null
}
