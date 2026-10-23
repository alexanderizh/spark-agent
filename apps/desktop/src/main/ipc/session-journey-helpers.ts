/**
 * @module session-journey-helpers
 *
 * 会话经历聚合（`session:get-journey`）的纯函数：工具名分类、载荷字段提取、
 * URL / 路径展示名派生。无 electron / db 依赖，可独立单测。
 */

/** 技能类工具：SDK 原生 Skill 工具与 skills_load 家族。 */
export function isSkillToolName(toolName: string): boolean {
  return (
    toolName === 'Skill' ||
    toolName === 'skills_load' ||
    toolName.endsWith('__skills_load') ||
    toolName.endsWith('__skill_run')
  )
}

/** 联网检索 / 网页查阅类工具（内置 WebSearch/WebFetch 与 spark_search 等家族）。 */
export function isWebToolName(toolName: string): boolean {
  if (toolName === 'WebSearch' || toolName === 'WebFetch') return true
  return /__(web_search|fetch_url|web_search_prime|webreader)$/i.test(toolName)
}

/** 工具名短标签：mcp__server__tool → server/tool；内置工具保持原名。 */
export function shortToolLabel(toolName: string): string {
  if (!toolName.startsWith('mcp__')) return toolName
  return toolName.slice('mcp__'.length).split('__').join('/')
}

/** 从脱敏输入载荷中提取第一个非空字符串字段。 */
export function extractStringField(payload: unknown, fields: string[]): string | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

/** 技能展示名：优先载荷 id/name/skillId/command，兜底工具名。 */
export function extractSkillName(payload: unknown, toolName: string): string {
  return extractStringField(payload, ['id', 'name', 'skillId', 'command']) ?? toolName
}

/** 网页条目：URL 字段命中为 page，检索词字段命中为 search，都没有则 null。 */
export function extractWebEntry(
  payload: unknown,
): { kind: 'page' | 'search'; text: string } | null {
  const url = extractStringField(payload, ['url', 'link', 'websiteUrl', 'pageUrl'])
  if (url != null) return { kind: 'page', text: url }
  const query = extractStringField(payload, [
    'query',
    'q',
    'searchQuery',
    'search_query',
    'keyword',
  ])
  if (query != null) return { kind: 'search', text: query }
  return null
}

/** URL 主机名（展示用；解析失败返回 null）。 */
export function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/** 路径展示名：兼容 posix / win32 分隔符取最后一段。 */
export function baseNameOf(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? filePath
}

// ── 过程产物白名单：只收文档与多媒体，代码/配置类文件不进「过程产物」清单 ──
const DOCUMENT_EXTENSIONS = new Set([
  // 文档：Markdown / 纯文本 / 富文本 / Office / 表格 / 网页产物
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text',
  '.rtf',
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.odt',
  '.odp',
  '.ods',
  '.csv',
  '.tsv',
  '.epub',
  '.html',
  '.htm',
])
const MULTIMEDIA_EXTENSIONS = new Set([
  // 图片
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.tiff',
  '.tif',
  '.heic',
  '.heif',
  '.avif',
  // 音频
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.opus',
  '.wma',
  '.aiff',
  // 视频
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.flv',
  '.wmv',
  '.m4v',
])

/** 路径扩展名（小写；兼容 posix / win32 分隔符与无扩展名场景返回空串）。 */
function extensionOf(filePath: string): string {
  const base = baseNameOf(filePath).toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot)
}

/** 过程产物是否收集：仅文档与多媒体扩展名（代码 / 配置 / 无扩展名一律排除）。 */
export function isJourneyArtifactPath(filePath: string): boolean {
  const ext = extensionOf(filePath)
  return DOCUMENT_EXTENSIONS.has(ext) || MULTIMEDIA_EXTENSIONS.has(ext)
}
