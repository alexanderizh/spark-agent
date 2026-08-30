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

/** 临时桶路径特征：yiqibyte 域名下 /<bucket>/ 形式且桶名含 tmp（如 /edu-tmp/、/edugen-tmp/）。 */
const EDU_TMP_BUCKET_PATH_RE = /^\/[a-z0-9-]*tmp[a-z0-9-]*\//i

/**
 * 判断是否为 Spark 平台上传资源的公网 URL，两类形态均算：
 * - 主桶上传：www.yiqibyte.com/edu-prod/uploads/...（未启用临时桶时的中转回退形态）
 * - 临时桶上传（?tmp=1）：yiqibyte 域名下桶名含 tmp 的路径（如 /edu-tmp/uploads/...），
 *   桶由服务端 MinIO Lifecycle 定期自动清理
 * UI 可据此提示「临时存储、到期清理」。
 */
export function isEduUploadAssetUrl(url: string | null | undefined): boolean {
  const normalized = normalizeEduAssetUrl(url)
  if (normalized.startsWith(`${EDU_PROD_ASSET_ORIGIN}/edu-prod/uploads/`)) return true
  // 临时桶路径不经 normalize 改写，直接按域名 + 桶名特征判断
  try {
    const parsed = new URL(normalized)
    return EDU_PROD_HOSTS.has(parsed.hostname) && EDU_TMP_BUCKET_PATH_RE.test(parsed.pathname)
  } catch {
    return false
  }
}
