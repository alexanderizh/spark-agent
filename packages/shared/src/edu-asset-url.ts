const EDU_PROD_HOSTS = new Set(['spark.yiqibyte.com', 'www.yiqibyte.com', 'yiqibyte.com'])
const EDU_PROD_ASSET_ORIGIN = 'https://www.yiqibyte.com'

/**
 * 把线上上传资源统一规范化到 www.yiqibyte.com，并修正缺失的 `/edu-prod` 前缀。
 *
 * 仅处理：
 * - host 为 yiqibyte 生产域名，且 path 以 `/uploads/` 或 `/edu-prod/uploads/` 开头
 * - 或传入的是上述上传资源的根相对路径
 */
export function normalizeEduAssetUrl(url: string | null | undefined): string {
  if (!url) return url ?? ''
  const trimmed = url.trim()
  if (!trimmed) return trimmed

  if (trimmed.startsWith('/uploads/')) {
    return `${EDU_PROD_ASSET_ORIGIN}/edu-prod${trimmed}`
  }
  if (trimmed.startsWith('/edu-prod/uploads/')) {
    return `${EDU_PROD_ASSET_ORIGIN}${trimmed}`
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (!EDU_PROD_HOSTS.has(parsed.hostname)) return trimmed
    if (parsed.pathname.startsWith('/uploads/')) {
      parsed.pathname = `/edu-prod${parsed.pathname}`
    } else if (!parsed.pathname.startsWith('/edu-prod/uploads/')) {
      return trimmed
    }
    parsed.protocol = 'https:'
    parsed.hostname = 'www.yiqibyte.com'
    parsed.port = ''
    return parsed.toString()
  } catch {
    return trimmed
  }
}
