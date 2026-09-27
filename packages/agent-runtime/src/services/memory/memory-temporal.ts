/**
 * @module memory-temporal
 *
 * 记忆时效语义工具（S2.6 / N5）—— valid_until 的精度/时区表达。
 *
 * 设计依据：docs/plans/2026-09-26-memory-evidence-and-temporal-semantics.md §5：
 *   - 精确 UTC 瞬时用半开区间 [from, until)；
 *   - 只有日期/模糊阶段时保存时区与精度，不捏造准确时间；
 *   - "下月起改用新地址" = 旧值有效期到本月底（该本地日结束，exclusive），
 *     到期前仍作为当前事实。
 *
 * date 精度的换算：调用方给"最后适用的本地日期"，本模块把该本地日的
 * 次日 00:00（半开区间右端，exclusive）换算为 UTC 瞬时存入 valid_until；
 * 原始表达（precision/timezone）存入 valid_until_meta 供展示层如实说明。
 */

/** valid_until 的精度表达（存 valid_until_meta JSON） */
export interface ValidUntilMeta {
  /** 'instant' = 精确 UTC 瞬时；'date' = 仅日期（含时区语义） */
  precision: 'instant' | 'date'
  /** IANA 时区名（date 精度必填；instant 为 null） */
  timezone?: string
}

export type ResolveValidUntilInput = {
  /** instant：完整 ISO datetime；date：YYYY-MM-DD（该本地日内仍适用） */
  validUntil: string
  precision: 'instant' | 'date'
  /** date 精度的时区（缺省用本机时区）；instant 忽略 */
  timezone?: string
}

export type ResolveValidUntilResult =
  | { ok: true; untilMs: number; meta: ValidUntilMeta }
  | { ok: false; error: string }

/** 本机时区（IANA 名；取不到时回退 UTC） */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** 指定时区在给定 UTC 瞬时的偏移（分钟）；时区非法返回 null */
function tzOffsetMinutes(timeZone: string, atMs: number): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(new Date(atMs))
    const get = (type: string): number => {
      const p = parts.find((x) => x.type === type)
      return p != null ? Number(p.value) : Number.NaN
    }
    const asUTC = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    )
    if (Number.isNaN(asUTC)) return null
    return Math.round((asUTC - atMs) / 60_000)
  } catch {
    return null
  }
}

/**
 * date 精度换算：给定"最后适用的本地日期"（YYYY-MM-DD）与时区，
 * 返回该本地日次日 00:00（exclusive 右端）对应的 UTC 瞬时。
 * 两轮迭代消化 DST 边界（多数时区不存在，但换算必须正确）。
 */
export function localDayEndExclusive(dateStr: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (m == null) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  // 输入日自身合法性（闰年由 Date.UTC 归一化回检；2/30 这类捏造日期拒绝）
  const sameDay = Date.UTC(year, month - 1, day)
  const d = new Date(sameDay)
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null
  }
  // 次日 00:00 的"朴素 UTC"（月末 +1 自然滚动到下月 1 日，语义正确）
  const naiveNext = Date.UTC(year, month - 1, day + 1, 0, 0, 0)
  // 第一轮：用猜测点的偏移修正；第二轮：用修正后点的偏移再修一次（DST 边界）
  let guess = naiveNext
  for (let i = 0; i < 2; i += 1) {
    const offset = tzOffsetMinutes(timeZone, guess)
    if (offset == null) return null
    const next = naiveNext - offset * 60_000
    if (next === guess) break
    guess = next
  }
  return guess
}

/**
 * 解析并规范化有效期输入（写入口共用）：
 *   - instant：必须可 Date.parse 的完整时间表达；
 *   - date：YYYY-MM-DD + 合法 IANA 时区 → 本地日结束（exclusive）UTC 瞬时。
 * 非法输入返回结构化错误（不静默丢弃也不捏造）。
 */
export function resolveValidUntil(input: ResolveValidUntilInput): ResolveValidUntilResult {
  const raw = input.validUntil.trim()
  if (raw === '') return { ok: false, error: 'validUntil 为空' }
  if (input.precision === 'instant') {
    const ms = Date.parse(raw)
    if (Number.isNaN(ms)) {
      return { ok: false, error: `instant 精度要求完整时间表达（ISO datetime），收到："${raw}"` }
    }
    return { ok: true, untilMs: ms, meta: { precision: 'instant' } }
  }
  const tz = input.timezone?.trim() || localTimezone()
  const endMs = localDayEndExclusive(raw, tz)
  if (endMs == null) {
    return { ok: false, error: `date 精度要求 YYYY-MM-DD 与合法时区，收到："${raw}" / "${tz}"` }
  }
  return { ok: true, untilMs: endMs, meta: { precision: 'date', timezone: tz } }
}

/** valid_until_meta 的展示文案（如实说明原始表达，不捏造准确时间） */
export function describeValidUntil(untilMs: number, metaJson: string | null): string {
  if (metaJson != null) {
    try {
      const meta = JSON.parse(metaJson) as Partial<ValidUntilMeta>
      if (meta.precision === 'date' && typeof meta.timezone === 'string') {
        const d = new Date(untilMs)
        const local = new Intl.DateTimeFormat('en-CA', {
          timeZone: meta.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(untilMs - 1)) // exclusive 右端 -1ms = 最后适用日
        return `有效期至 ${local}（${meta.timezone}，按日精度；${d.toISOString()} 起不再作为当前事实）`
      }
    } catch {
      /* 损坏 meta 回退到通用表达 */
    }
  }
  return `有效期至 ${new Date(untilMs).toISOString()}（精确时间点）`
}
