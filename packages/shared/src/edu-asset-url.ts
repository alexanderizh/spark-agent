const EDU_PROD_HOSTS = new Set(['spark.yiqibyte.com', 'yiqibyte.com'])

/**
 * 修正线上资源 URL 缺失 `/edu-prod` 前缀的问题。
 *
 * 仅处理：
 * - host 为 yiqibyte 生产域名
 * - path 以 `/uploads/` 开头
 * - 且当前还没有 `/edu-prod/` 前缀
 */
export function normalizeEduAssetUrl(url: string | null | undefined): string {
  if (!url) return url ?? ''
  const trimmed = url.trim()
  if (!trimmed) return trimmed

  if (trimmed.startsWith('/uploads/')) {
    return `/edu-prod${trimmed}`
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (!EDU_PROD_HOSTS.has(parsed.hostname)) return trimmed
    if (!parsed.pathname.startsWith('/uploads/')) return trimmed
    parsed.pathname = `/edu-prod${parsed.pathname}`
    return parsed.toString()
  } catch {
    return trimmed
  }
}
