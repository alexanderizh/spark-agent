/**
 * userMenuModel — 用户菜单「右侧数值列」的纯展示模型。
 *
 * 菜单里带状态的条目（账号同步、检查更新）都要把当前状态收敛到同一列，
 * 这里负责把状态翻译成 (i18n key, 语义色, 指示器)，供 UserMenuDropdown
 * 与单测共用；不依赖 React / window，方便直接覆盖状态矩阵。
 */
import type { TranslationKey } from '../../i18n'

/** 数值列语义色，对应 .user-menu-value 的修饰类 */
export type UserMenuValueTone = 'muted' | 'primary' | 'success' | 'warning' | 'danger'

/** 数值列前置指示器：加载中 / 完成 / 异常 */
export type UserMenuValueIndicator = 'none' | 'spinner' | 'check' | 'alert'

export interface UserMenuValue {
  /** 文案的 i18n key；为 null 时按 raw 原样展示（如版本号） */
  labelKey: TranslationKey | null
  /** i18n 插值参数 */
  params?: Record<string, string | number>
  /** 不需要翻译的原样文案 */
  raw?: string
  /** 数值列前的色块（主题色等） */
  swatch?: string
  tone: UserMenuValueTone
  indicator: UserMenuValueIndicator
}

export type AccountSyncOutcome = 'success' | 'partial' | 'failed'

export interface UserMenuSyncState {
  /** 未登录时不展示同步状态 */
  authenticated: boolean
  /** 正在执行同步（菜单保持打开，行内显示 loading） */
  busy: boolean
  /** 本次菜单打开后刚刚产生的同步结果 */
  outcome: AccountSyncOutcome | null
  /** 同步偏好是否开启；null = 尚未读取到 */
  enabled: boolean | null
  /** 已勾选的同步类别数量 */
  selectedCount: number
  /** 上一次成功同步完成时间（ISO 字符串） */
  lastFinishedAt: string | null
}

export type UserMenuUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'not-available'

export interface UserMenuUpdateInfo {
  state: UserMenuUpdateState
  /** 当前版本号（不含 v 前缀） */
  currentVersion: string | null
  /** 可更新到的版本号 */
  availableVersion: string | null
  /** 下载进度百分比 0-100 */
  percent: number
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 同步时间：当天只显示 时:分，跨天补 月-日；无效值返回 null（不展示数值）。
 * 用数字拼接而不是带语言前缀的文案，避免在菜单里塞入需要翻译的中文。
 */
export function formatSyncMoment(
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (value == null || value.trim().length === 0) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return clock
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`
}

/**
 * 账号同步行的右侧数值：
 * 同步中 > 刚结束的结果 > 未开启 > 上次同步时间 > 不展示。
 */
export function describeSyncValue(
  sync: UserMenuSyncState,
  now: Date = new Date(),
): UserMenuValue | null {
  if (!sync.authenticated) return null
  if (sync.busy) {
    return { labelKey: 'app.user.syncBusy', tone: 'primary', indicator: 'spinner' }
  }
  if (sync.outcome === 'success') {
    return { labelKey: 'app.user.syncDone', tone: 'success', indicator: 'check' }
  }
  if (sync.outcome === 'partial') {
    return { labelKey: 'app.user.syncPartial', tone: 'warning', indicator: 'alert' }
  }
  if (sync.outcome === 'failed') {
    return { labelKey: 'app.user.syncFailed', tone: 'danger', indicator: 'alert' }
  }
  if (sync.enabled === null) return null
  if (!sync.enabled || sync.selectedCount === 0) {
    return { labelKey: 'app.user.syncOff', tone: 'muted', indicator: 'none' }
  }
  const moment = formatSyncMoment(sync.lastFinishedAt, now)
  if (moment == null) return null
  return {
    labelKey: 'app.user.syncLastAt',
    params: { time: moment },
    tone: 'muted',
    indicator: 'none',
  }
}

/**
 * 检查更新行的右侧数值：始终展示「当前版本」或当前更新阶段，
 * 让不点开设置页的用户也能看到版本与更新进度。
 */
export function describeUpdateValue(update: UserMenuUpdateInfo): UserMenuValue {
  switch (update.state) {
    case 'checking':
      return { labelKey: 'app.user.updateChecking', tone: 'muted', indicator: 'spinner' }
    case 'available':
      return {
        labelKey: 'app.user.updateAvailable',
        params: { version: update.availableVersion ?? '' },
        tone: 'primary',
        indicator: 'none',
      }
    case 'downloading':
      return {
        labelKey: 'app.user.updateDownloading',
        params: { percent: Math.max(0, Math.round(update.percent)) },
        tone: 'primary',
        indicator: 'spinner',
      }
    case 'downloaded':
      return { labelKey: 'app.user.updateReady', tone: 'success', indicator: 'check' }
    case 'error':
      return { labelKey: 'app.user.updateError', tone: 'danger', indicator: 'alert' }
    default:
      return {
        labelKey: null,
        raw: update.currentVersion ? `v${update.currentVersion}` : '--',
        tone: 'muted',
        indicator: 'none',
      }
  }
}
