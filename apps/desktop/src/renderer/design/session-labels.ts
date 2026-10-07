/**
 * 会话标记（打标）设计数据与判定工具。
 *
 * 标记是会话的独立字段（持久化在 metadata 的 sessionLabel / labeledAt），
 * 「有标记 ⇒ 进入置顶区」由本模块的 isSessionPinnedZone() 统一推导，
 * 不改写 pinned_at，因此标记与手动置顶互不干扰。
 *
 * 放置于独立文件（而非塞进 SidebarSessionList.tsx）的原因：
 * 右键菜单、筛选器、排序与拖拽分区都要用到同一份定义，且该文件已接近单文件上限。
 */
import type { SessionLabelKey, SessionListResponse } from '@spark/protocol'

export type { SessionLabelKey }

/** 判定所需的最小会话结构（避免与 sidebar-session-sort 形成循环依赖）。 */
export type SessionLabelCarrier = Pick<
  SessionListResponse['sessions'][number],
  'pinnedAt' | 'labeledAt' | 'sessionLabel'
>

export interface SessionLabelMeta {
  key: SessionLabelKey
  /** i18n 键：标记名称（zh/en 均在 locales.ts 中） */
  labelKey: string
  /** 置顶图标着色用的 class 后缀 */
  colorClass: string
}

/**
 * 全部标记，顺序即右键二级菜单与筛选器的展示顺序。
 * 新增标记只需在此追加一项 + 一份 i18n 文案 + 一条 .less 配色。
 */
export const SESSION_LABELS: readonly SessionLabelMeta[] = [
  { key: 'suspended', labelKey: 'sidebar.label.suspended', colorClass: 'label-suspended' },
  { key: 'not-started', labelKey: 'sidebar.label.notStarted', colorClass: 'label-not-started' },
  {
    key: 'pending-review',
    labelKey: 'sidebar.label.pendingReview',
    colorClass: 'label-pending-review',
  },
  {
    key: 'pending-advance',
    labelKey: 'sidebar.label.pendingAdvance',
    colorClass: 'label-pending-advance',
  },
  { key: 'undelivered', labelKey: 'sidebar.label.undelivered', colorClass: 'label-undelivered' },
]

const LABEL_BY_KEY = new Map<SessionLabelKey, SessionLabelMeta>(
  SESSION_LABELS.map((meta) => [meta.key, meta] as const),
)

export function getSessionLabelMeta(key: SessionLabelKey): SessionLabelMeta | null {
  return LABEL_BY_KEY.get(key) ?? null
}

/** 会话是否已打标。 */
export function hasSessionLabel(session: SessionLabelCarrier): boolean {
  return session.sessionLabel != null
}

/**
 * 会话是否属于置顶区：手动置顶或已打标。
 * 会话栏里所有「置顶段 / 普通段」的分区判定都必须走这里，保证标记会话自动进置顶区。
 */
export function isSessionPinnedZone(session: SessionLabelCarrier): boolean {
  return session.pinnedAt != null || session.sessionLabel != null
}

/**
 * 置顶区内的排序时间（ISO 8601）：手动置顶优先，其次打标时间。
 * 刚打标的会话因此立刻浮到置顶区顶部；取消标记后自动回到普通段。
 */
export function getSessionPinTime(session: SessionLabelCarrier): string | null {
  return session.pinnedAt ?? session.labeledAt ?? null
}

/** 会话标记筛选值：全部 / 已标记 / 未标记 / 某个具体标记。 */
export type SidebarLabelsFilter = 'all' | 'labeled' | 'unlabeled' | SessionLabelKey

/** 标记筛选的具体值（不含「全部」）；筛选状态里的空数组 = 全部标记。 */
export type SidebarLabelsFilterValue = Exclude<SidebarLabelsFilter, 'all'>

export const SIDEBAR_LABEL_FILTER_OPTIONS: ReadonlyArray<{
  value: SidebarLabelsFilter
  labelKey: string
}> = [
  { value: 'all', labelKey: 'sidebar.filter.all' },
  { value: 'labeled', labelKey: 'sidebar.filter.labels.labeled' },
  { value: 'unlabeled', labelKey: 'sidebar.filter.labels.unlabeled' },
  ...SESSION_LABELS.map((meta) => ({
    value: meta.key as SidebarLabelsFilter,
    labelKey: meta.labelKey,
  })),
]

/** 筛选器行值文案（用于「标记」一行右侧的当前值）。 */
export function getSidebarLabelFilterLabelKey(value: SidebarLabelsFilter): string {
  return (
    SIDEBAR_LABEL_FILTER_OPTIONS.find((option) => option.value === value)?.labelKey ??
    'sidebar.filter.all'
  )
}

export function isSidebarLabelFilterValue(value: unknown): value is SidebarLabelsFilter {
  return SIDEBAR_LABEL_FILTER_OPTIONS.some((option) => option.value === value)
}

/** 校验一组标记筛选值（剔除「全部」与未知值）；持久化读取时用于收敛脏数据。 */
export function isSidebarLabelFilterSelection(value: unknown): value is SidebarLabelsFilterValue[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => isSidebarLabelFilterValue(item) && item !== ('all' satisfies SidebarLabelsFilter),
    )
  )
}

/** 筛选值对应的标记色点 class；「全部 / 已标记 / 未标记」没有色点，返回 undefined。 */
export function getSidebarLabelFilterColorClass(value: SidebarLabelsFilter): string | undefined {
  return LABEL_BY_KEY.get(value as SessionLabelKey)?.colorClass
}

/** 会话是否命中标记筛选。 */
export function matchesSidebarLabelFilter(
  session: SessionLabelCarrier,
  filter: SidebarLabelsFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'labeled') return session.sessionLabel != null
  if (filter === 'unlabeled') return session.sessionLabel == null
  return session.sessionLabel === filter
}

/**
 * 会话是否命中多选标记筛选：空选择 = 全部；否则任一条件命中即保留（OR 语义）。
 * 「已标记/未标记」可与具体标记共存，例如「未标记 + 挂起」= 无标记或挂起的会话。
 */
export function matchesSidebarLabelFilters(
  session: SessionLabelCarrier,
  filters: readonly SidebarLabelsFilterValue[],
): boolean {
  if (filters.length === 0) return true
  return filters.some((filter) => matchesSidebarLabelFilter(session, filter))
}
