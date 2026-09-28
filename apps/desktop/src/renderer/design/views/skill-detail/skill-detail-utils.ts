/**
 * 技能详情页 —— 纯函数工具集（无 React 依赖，便于单测）。
 *
 * 覆盖三块：
 *   1. 文件树展示辅助：排序、图标分类、路径查找、默认展开
 *   2. 文件类型判定与展示格式：markdown / 图片 / 文本 / 二进制、体积格式化
 *   3. 虚拟技能（表单创建，rootPath = `user://xxx`，磁盘无文件）与磁盘文件之间的
 *      双向转换：把技能定义渲染成一份可视/可编辑的 SKILL.md，保存时再解析回字段
 */

import type { SkillFileNode } from '@spark/protocol'

/** 技能入口文件名（约定俗成，渲染树时置顶） */
export const SKILL_ENTRY_FILE = 'SKILL.md'

/** 单文件预览上限（与主进程 skillFilesUtils.SKILL_FILE_MAX_BYTES 保持一致） */
export const SKILL_FILE_PREVIEW_LIMIT = 2 * 1024 * 1024

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx']
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif']

/** 取小写扩展名（含点）；无扩展名返回空串 */
export function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0) return ''
  return fileName.slice(idx).toLowerCase()
}

export function isMarkdownFile(fileName: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(fileExtension(fileName))
}

export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.includes(fileExtension(fileName))
}

/** 体积展示：1024 → 1 KB，31744 → 31 KB，1556480 → 1.5 MB */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** 触发描述压成单行（frontmatter 里的 description 常含换行，收起后更适合作副标题） */
export function toSingleLine(text: string, maxLength = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= maxLength) return flat
  return `${flat.slice(0, maxLength - 1)}…`
}

/** 统计文件树中的文件数（不含目录） */
export function countFiles(nodes: SkillFileNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.type === 'file') total += 1
    else if (node.children != null) total += countFiles(node.children)
  }
  return total
}

/** 按路径查找节点（DFS，路径为相对技能根的 posix 路径） */
export function findNodeByPath(nodes: SkillFileNode[], path: string): SkillFileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children != null) {
      const hit = findNodeByPath(node.children, path)
      if (hit != null) return hit
    }
  }
  return null
}

/**
 * 展示用排序：目录在前，SKILL.md 永远置顶，其余按名称升序。
 * 主进程已排过序，这里做的是「把入口文件提到最前」这一层 UI 语义。
 */
export function sortSkillNodes(nodes: SkillFileNode[]): SkillFileNode[] {
  const weight = (node: SkillFileNode): number => {
    if (node.name === SKILL_ENTRY_FILE) return -1
    return node.type === 'directory' ? 0 : 1
  }
  return [...nodes]
    .sort((a, b) => {
      const diff = weight(a) - weight(b)
      if (diff !== 0) return diff
      return a.name.localeCompare(b.name)
    })
    .map((node) =>
      node.children != null ? { ...node, children: sortSkillNodes(node.children) } : node,
    )
}

/** 文件路径是否位于某个已展开目录之下（用于默认展开态判断） */
export function isNodeVisible(ancestorPaths: string[], nodePath: string): boolean {
  return ancestorPaths.some((ancestor) => nodePath.startsWith(`${ancestor}/`))
}

/** 相对路径 → `safe-file://x/<base64url>`，与主进程 SafeFileProtocol.toSafeFileUrl 编码一致 */
export function toSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

/** 拼接 posix 路径（技能内路径统一用 `/`，与主进程 posix 语义一致） */
export function joinSkillPath(dir: string, name: string): string {
  return dir.length > 0 ? `${dir}/${name}` : name
}

/**
 * 把技能根目录（平台绝对路径）与相对 posix 路径拼成绝对路径。
 * Windows 根目录用 `\`，这里跟随根目录的分隔符，避免出现 `C:\a/b` 混合写法。
 */
export function joinAbsolutePath(root: string, relPath: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  const trimmed = root.replace(/[\\/]+$/, '')
  return `${trimmed}${separator}${relPath.split('/').join(separator)}`
}

/** 取平台绝对路径的父目录（渲染进程无 node:path，按分隔符截断） */
export function dirnameAbsolute(absolutePath: string): string | null {
  const trimmed = absolutePath.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index <= 0) return null
  return trimmed.slice(0, index)
}

/** UTF-8 字节数（标题栏体积展示用，避免依赖 Buffer） */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/* ────────── 虚拟技能 ↔ SKILL.md 文本 ────────── */

export interface VirtualSkillFields {
  name: string
  description: string
  version: string
  author: string
  category: string
  tags: string[]
  requiredTools: string[]
  body: string
}

/** YAML 标量转义：含特殊字符（: # " 换行 等）时用双引号包裹并转义内部引号 */
function yamlScalar(value: string): string {
  if (value.length === 0) return '""'
  if (/^[A-Za-z0-9\u4e00-\u9fa5 _\-./()]+$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
}

/**
 * 把（表单创建的）虚拟技能定义渲染成一份完整的 SKILL.md 文本。
 * 渲染结果与该技能若被导出/粘贴到磁盘时的文件保持一致的字段结构。
 */
export function composeVirtualSkillMarkdown(fields: VirtualSkillFields): string {
  const lines = ['---', `name: ${yamlScalar(fields.name)}`]
  if (fields.description.trim().length > 0) {
    lines.push(`description: ${yamlScalar(fields.description)}`)
  }
  if (fields.version.trim().length > 0) lines.push(`version: ${yamlScalar(fields.version)}`)
  if (fields.author.trim().length > 0) lines.push(`author: ${yamlScalar(fields.author)}`)
  if (fields.category.trim().length > 0) lines.push(`category: ${yamlScalar(fields.category)}`)
  if (fields.tags.length > 0) lines.push(`tags: ${fields.tags.map(yamlScalar).join(', ')}`)
  if (fields.requiredTools.length > 0) {
    lines.push(`requiredTools: ${fields.requiredTools.map(yamlScalar).join(', ')}`)
  }
  lines.push('---', '')
  const body = fields.body.replace(/\s+$/, '')
  return `${lines.join('\n')}\n${body.length > 0 ? `${body}\n` : ''}`
}

function stripScalarQuotes(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

function splitList(raw: string): string[] {
  // 兼容 `[a, b]` 与 `a, b` 两种写法
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (inner.trim().length === 0) return []
  return inner
    .split(',')
    .map((item) => stripScalarQuotes(item))
    .filter((item) => item.length > 0)
}

/**
 * 解析 SKILL.md 文本（frontmatter + 正文），用于把编辑结果写回技能字段。
 * 仅识别本项目使用的单层 key: value 结构；无法解析的键直接忽略。
 */
export function parseVirtualSkillMarkdown(text: string): VirtualSkillFields {
  const fields: VirtualSkillFields = {
    name: '',
    description: '',
    version: '',
    author: '',
    category: '',
    tags: [],
    requiredTools: [],
    body: text,
  }

  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---')) return fields
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) return fields

  const frontmatter = normalized.slice(3, end)
  const body = normalized.slice(normalized.indexOf('\n', end + 1) + 1)
  fields.body = body.replace(/^\n+/, '').replace(/\s+$/, '')

  for (const line of frontmatter.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (match == null) continue
    const key = match[1]
    const value = match[2] ?? ''
    if (key === 'tags') fields.tags = splitList(value)
    else if (key === 'requiredTools' || key === 'tools') {
      fields.requiredTools = splitList(value)
    } else if (key === 'name') fields.name = stripScalarQuotes(value)
    else if (key === 'description') fields.description = stripScalarQuotes(value)
    else if (key === 'version') fields.version = stripScalarQuotes(value)
    else if (key === 'author') fields.author = stripScalarQuotes(value)
    else if (key === 'category') fields.category = stripScalarQuotes(value)
  }
  return fields
}
