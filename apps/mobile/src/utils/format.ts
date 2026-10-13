/** 通用格式化工具 */

/** 字节数 → 人类可读（B / KB / MB / GB） */
export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/** ISO 时间 → 本地化短时间（MM-DD HH:mm） */
export function formatShortTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO 时间 → 完整本地时间 */
export function formatFullTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 毫秒 → 「x 秒 / x 分钟」 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} 毫秒`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`
  return `${Math.round(ms / 60_000)} 分钟`
}

/** 相对时间（刚刚 / x 分钟前 / x 小时前 / x 天前 / 日期） */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '从未同步'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '从未同步'
  const diff = Date.now() - d.getTime()
  if (diff < 0) return formatShortTime(iso)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return formatShortTime(iso)
}

/** 脱敏账号：邮箱显示前 2 位 + ***，手机号中间四位打码 */
export function maskAccount(account: string): string {
  if (!account) return ''
  if (account.includes('@')) {
    const [name, domain] = account.split('@')
    const head = name.slice(0, 2)
    return `${head}***@${domain}`
  }
  if (/^1[3-9]\d{9}$/.test(account)) {
    return `${account.slice(0, 3)}****${account.slice(7)}`
  }
  return account
}
