/**
 * 子应用运行时安全设置（设置「子应用」分类）。
 *
 * 双层持久化与 SettingsView 的 usePersistedSettings 同构：
 * localStorage（同步首屏）+ settings:get/set IPC（SQLite 权威源），
 * category 取 'sub-app'、key 取 'data'，与 localStorageKeyToCategory 约定一致。
 * 独立成模块是因为 useSubAppRunner（运行时）与设置卡片（UI）两侧都要读。
 */
import { DEFAULT_SUB_APP_RUNTIME_SECURITY } from './appRuntimeDocument'

export interface SubAppRuntimeSettings {
  allowNetworkAccess: boolean
  allowUnsafeEval: boolean
  /** 单条源码长度上限；0 = 不限制。 */
  sourceLengthLimit: number
}

export const SUB_APP_SETTINGS_STORAGE_KEY = 'spark-settings-sub-app'
export const SUB_APP_SETTINGS_CATEGORY = 'sub-app'

export const DEFAULT_SUB_APP_RUNTIME_SETTINGS: SubAppRuntimeSettings = {
  allowNetworkAccess: DEFAULT_SUB_APP_RUNTIME_SECURITY.allowNetworkAccess,
  allowUnsafeEval: DEFAULT_SUB_APP_RUNTIME_SECURITY.allowUnsafeEval,
  sourceLengthLimit: DEFAULT_SUB_APP_RUNTIME_SECURITY.sourceLengthLimit,
}

/** 兼容旧数据/异常输入：只收窄已知字段，缺省回落默认值。 */
export function normalizeSubAppRuntimeSettings(value: unknown): SubAppRuntimeSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const limit =
    typeof raw.sourceLengthLimit === 'number' && isFinite(raw.sourceLengthLimit)
      ? Math.max(0, Math.floor(raw.sourceLengthLimit))
      : DEFAULT_SUB_APP_RUNTIME_SETTINGS.sourceLengthLimit
  return {
    allowNetworkAccess:
      typeof raw.allowNetworkAccess === 'boolean'
        ? raw.allowNetworkAccess
        : DEFAULT_SUB_APP_RUNTIME_SETTINGS.allowNetworkAccess,
    allowUnsafeEval:
      typeof raw.allowUnsafeEval === 'boolean'
        ? raw.allowUnsafeEval
        : DEFAULT_SUB_APP_RUNTIME_SETTINGS.allowUnsafeEval,
    sourceLengthLimit: limit,
  }
}

/** 同步读 localStorage（首屏兜底；未写过时返回默认值）。 */
export function readCachedSubAppRuntimeSettings(): SubAppRuntimeSettings {
  if (typeof window === 'undefined') return DEFAULT_SUB_APP_RUNTIME_SETTINGS
  try {
    const raw = window.localStorage.getItem(SUB_APP_SETTINGS_STORAGE_KEY)
    if (raw == null) return DEFAULT_SUB_APP_RUNTIME_SETTINGS
    return normalizeSubAppRuntimeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SUB_APP_RUNTIME_SETTINGS
  }
}

/** 异步读 IPC 权威值；IPC 不可用或未初始化时回落 localStorage 缓存。 */
export async function fetchSubAppRuntimeSettings(): Promise<SubAppRuntimeSettings> {
  try {
    const res = await window.spark?.invoke('settings:get', {
      category: SUB_APP_SETTINGS_CATEGORY,
      key: 'data',
    })
    if (res?.value != null) return normalizeSubAppRuntimeSettings(res.value)
  } catch {
    // IPC 不可用（测试环境等）：走缓存
  }
  return readCachedSubAppRuntimeSettings()
}

/** 写入双层存储（localStorage 同步写、IPC fire-and-forget）。 */
export function persistSubAppRuntimeSettings(settings: SubAppRuntimeSettings): void {
  window.localStorage.setItem(SUB_APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  window.spark
    ?.invoke('settings:set', {
      category: SUB_APP_SETTINGS_CATEGORY,
      key: 'data',
      value: settings,
    })
    .catch(() => {
      /* 忽略 IPC 失败：localStorage 已写，下次打开仍生效 */
    })
}
