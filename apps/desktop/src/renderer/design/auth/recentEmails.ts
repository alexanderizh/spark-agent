/**
 * recentEmails — 登录/注册邮箱历史
 *
 * 渲染端 localStorage 缓存（不入主进程 keytar）：
 *   - 邮箱本身不是凭证，明文存在 renderer 没问题（就像浏览器记住表单一样）
 *   - 不放 SQLite 是为了避免每次写盘影响性能，邮箱历史是低敏感度
 *
 * 行为：
 *   - LRU：相同邮箱移到最前
 *   - 上限 8 条
 *   - 校验：必须是合法 email 格式
 *   - 容错：localStorage 不可用或解析失败时静默降级
 */

const STORAGE_KEY = 'spark:auth:recent-emails'
const MAX_COUNT = 8

/** 简单但够用的 email 校验 */
function isValidEmail(value: string): boolean {
  if (!value) return false
  // 不强求完整 RFC：要求有 @、@ 前后有非空、@ 后包含点
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function safeRead(): string[] {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && isValidEmail(v))
  } catch {
    return []
  }
}

function safeWrite(list: string[]): void {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 忽略：localStorage 满了 / 隐私模式禁用
  }
}

/** 获取最近邮箱列表（最近使用的在最前）*/
export function getRecentEmails(): string[] {
  return safeRead()
}

/**
 * 记住一个邮箱（登录/注册成功后调用）：
 *   - 已有则置顶
 *   - 没有则插入到最前
 *   - 超过上限则丢弃最旧的
 */
export function rememberEmail(email: string): void {
  const trimmed = (email ?? '').trim().toLowerCase()
  if (!isValidEmail(trimmed)) return
  const list = safeRead()
  const next = [trimmed, ...list.filter((e) => e.toLowerCase() !== trimmed)].slice(0, MAX_COUNT)
  safeWrite(next)
}

/** 清空邮箱历史（设置-账号页暴露一个清理按钮）*/
export function clearRecentEmails(): void {
  try {
    window.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}