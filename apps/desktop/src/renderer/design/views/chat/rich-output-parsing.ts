// 行为日志富输出解析：从工具输入/输出中提取可富展示的数据（图片源、HTTP 来源链接）。
// 纯函数、无 React 依赖，便于单测；渲染层见 ToolLogRichOutput.tsx。

import {
  IMAGE_EXTENSIONS,
  isImageReadToolCall,
  isScreenshotToolCall,
  isWebSearchToolCall,
} from './tool-log-metadata'

/** 富展示的 HTTP 来源链接 */
export interface RichSourceLink {
  title: string
  url: string
}

/** 图片富展示源 */
export interface RichImageDisplay {
  /** 可直接用于 <img src> 的地址（本地绝对路径 / dataUrl，渲染时经 resolveImageSrc 转换） */
  src: string
  /** 对应的本地文件路径；截图 dataUrl 无落盘路径时为 null */
  filePath: string | null
}

/** markdown 链接 [title](url) */
const MARKDOWN_LINK_RE = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g
/** 裸 URL（排除中英文引号/括号与中文标点，避免吞掉句尾标点） */
const BARE_URL_RE = /https?:\/\/[^\s<>"'`，。；：！？）」』】\])]+/g
/** base64 图片 dataUrl（长度阈值过滤小图标，只取成规模的数据） */
const IMAGE_DATA_URL_RE = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]{256,}/g

/**
 * 候选本地绝对路径「整词」：以空白/引号/全角冒号/行首为边界。
 * macOS/Linux 以 / 开头，Windows 形如 C:\... 或 C:/...；
 * 是否图片由代码按 IMAGE_EXTENSIONS 检查（避免 路径+扩展名 两段式
 * 正则的回溯歧义——贪婪回溯会把扩展名让给捕获组导致路径丢尾）。
 */
const PATH_WORD_RE = /(?:^|[\s'"`：:])(\/[^\s'"`]+|[A-Za-z]:[\\/][^\s'"`]+)/g

/**
 * 从工具输出文本提取 http(s) 链接：markdown 链接自带标题，其余文本再扫裸
 * URL；按文本出现顺序输出，按 URL 去重（首个出现的胜出）。
 */
export function extractHttpLinks(output: string | undefined): RichSourceLink[] {
  if (output == null || output.length === 0) return []

  const candidates: Array<{ index: number; title: string; url: string }> = []
  const markdownRanges: Array<[number, number]> = []
  for (const match of output.matchAll(MARKDOWN_LINK_RE)) {
    const url = match[2]
    if (url == null) continue
    const title = (match[1] ?? '').trim()
    const start = match.index ?? 0
    candidates.push({ index: start, title: title.length > 0 ? title : url, url })
    markdownRanges.push([start, start + match[0].length])
  }
  // 裸 URL 跳过 markdown 链接覆盖的区间：同一链接不会重复，也不会截断出前缀
  for (const match of output.matchAll(BARE_URL_RE)) {
    const start = match.index ?? 0
    if (markdownRanges.some(([from, to]) => start >= from && start < to)) continue
    candidates.push({ index: start, title: match[0], url: match[0] })
  }
  candidates.sort((a, b) => a.index - b.index)

  const byUrl = new Map<string, RichSourceLink>()
  for (const candidate of candidates) {
    if (!byUrl.has(candidate.url)) {
      byUrl.set(candidate.url, { title: candidate.title, url: candidate.url })
    }
  }
  return [...byUrl.values()]
}

/** 从文本中提取本地图片绝对路径（如 playwright 的 "Screenshot saved to: /tmp/shot.png"） */
export function extractLocalImagePath(output: string | undefined): string | null {
  if (output == null) return null
  for (const match of output.matchAll(PATH_WORD_RE)) {
    const word = match[1]
    if (word == null || word.length === 0) continue
    const lower = word.toLowerCase()
    if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return word
  }
  return null
}

/**
 * 提取截图输出中的 base64 dataUrl（spark_browser 截图直接返回图片数据）。
 * 多个匹配时取最长的一个（截图数据通常远大于误混入的小图）。
 */
export function getScreenshotDataUrl(output: string | undefined): string | null {
  if (output == null) return null
  let best: string | null = null
  for (const match of output.matchAll(IMAGE_DATA_URL_RE)) {
    if (best == null || match[0].length > best.length) best = match[0]
  }
  return best
}

/**
 * 图片富展示源：图片 Read 取输入 file_path（结构化字段，最可靠）；
 * 截图工具依次尝试输出中的 dataUrl 与本地路径。无则返回 null（调用方走通用输出）。
 */
export function getRichImageDisplay(
  name: string,
  toolInput: Record<string, unknown> | undefined,
  output: string | undefined,
): RichImageDisplay | null {
  if (isImageReadToolCall(name, toolInput)) {
    const raw = toolInput?.file_path ?? toolInput?.path
    if (typeof raw === 'string' && raw.length > 0) return { src: raw, filePath: raw }
  }
  if (isScreenshotToolCall(name)) {
    const dataUrl = getScreenshotDataUrl(output)
    if (dataUrl != null) return { src: dataUrl, filePath: null }
    const path = extractLocalImagePath(output)
    if (path != null) return { src: path, filePath: path }
  }
  return null
}

/**
 * 联网搜索类工具的来源链接富展示；非搜索类工具或无可提取链接时返回
 * null（调用方回退到通用文本输出）。
 */
export function getRichSourceLinks(
  name: string,
  output: string | undefined,
): RichSourceLink[] | null {
  if (!isWebSearchToolCall(name)) return null
  const links = extractHttpLinks(output)
  return links.length > 0 ? links : null
}
