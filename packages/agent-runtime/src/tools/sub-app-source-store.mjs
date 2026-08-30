import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { writeContentAddressedWorkspaceFile } from './workspace-content-store.mjs'

const SOURCE_PREVIEW_LIMIT = 2000
const SOURCE_CHAR_LIMIT = 5_000_000
const SOURCE_BYTE_LIMIT = SOURCE_CHAR_LIMIT * 4
const ALLOWED_SOURCE_EXTENSIONS = new Set(['.htm', '.html'])

export function describeSubAppSource(source) {
  if (typeof source !== 'string') return null
  return {
    sha256: createHash('sha256').update(source, 'utf8').digest('hex'),
    characters: source.length,
    bytes: Buffer.byteLength(source, 'utf8'),
  }
}

export function compactSubAppDetails(details, options = {}) {
  if (details == null || typeof details !== 'object') return details
  const includePreview = options.includePreview === true
  return {
    ...details,
    ...(details.draft != null && typeof details.draft === 'object'
      ? { draft: compactSourceOwner(details.draft, includePreview) }
      : {}),
    ...(details.publishedRelease != null && typeof details.publishedRelease === 'object'
      ? { publishedRelease: compactSourceOwner(details.publishedRelease, includePreview) }
      : {}),
  }
}

export async function readWorkspaceSubAppSource(filePath, workspaceRoot) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('draftFilePath 必须是工作区内的 HTML 文件路径。')
  }
  const root = await resolveWorkspaceRoot(workspaceRoot)
  const candidate = isAbsolute(filePath) ? filePath : resolve(root, filePath)
  const resolvedFile = await realpath(candidate).catch(() => null)
  if (resolvedFile == null) throw new Error(`draftFilePath 不存在：${filePath}`)
  assertInsideWorkspace(root, resolvedFile)

  const extension = extname(resolvedFile).toLowerCase()
  if (!ALLOWED_SOURCE_EXTENSIONS.has(extension)) {
    throw new Error('draftFilePath 仅支持 .html 或 .htm 文件。')
  }

  const fileStat = await stat(resolvedFile)
  if (!fileStat.isFile()) throw new Error('draftFilePath 必须指向普通文件。')
  if (fileStat.size > SOURCE_BYTE_LIMIT) {
    throw new Error(`draftFilePath 超过 ${SOURCE_BYTE_LIMIT} bytes 的安全读取上限。`)
  }

  const source = await readFile(resolvedFile, 'utf8')
  if (source.length > SOURCE_CHAR_LIMIT) {
    throw new Error(`子应用源码超过 ${SOURCE_CHAR_LIMIT} 字符上限。`)
  }
  return source
}

export async function exportWorkspaceSubAppSource(params) {
  if (typeof params.source !== 'string') throw new Error('子应用源码不存在，无法导出。')
  const root = await resolveWorkspaceRoot(params.workspaceRoot)
  const appId = safePathSegment(params.appId, 'app')
  const sourceInfo = describeSubAppSource(params.source)
  if (sourceInfo == null) throw new Error('子应用源码不存在，无法导出。')
  const stored = writeContentAddressedWorkspaceFile({
    workspaceRoot: root,
    directorySegments: ['.spark-agent', 'sub-app-sources', appId],
    content: params.source,
    extension: '.html',
    maxBytes: SOURCE_BYTE_LIMIT,
    label: '内容寻址源码文件',
  })

  return {
    path: stored.path,
    relativePath: stored.relativePath,
    sourceInfo,
    reused: stored.reused,
  }
}

function compactSourceOwner(owner, includePreview) {
  const { source, ...rest } = owner
  if (typeof source !== 'string') return owner
  return {
    ...rest,
    sourceInfo: describeSubAppSource(source),
    ...(includePreview ? { sourcePreview: previewSource(source) } : {}),
  }
}

function previewSource(source) {
  if (source.length <= SOURCE_PREVIEW_LIMIT) return source
  const headLength = Math.ceil(SOURCE_PREVIEW_LIMIT / 2)
  const tailLength = Math.floor(SOURCE_PREVIEW_LIMIT / 2)
  return [
    source.slice(0, headLength),
    `\n…[源码预览已截断：完整长度 ${source.length} 字符；用 spark_app_export_source 导出完整源码]…\n`,
    source.slice(-tailLength),
  ].join('')
}

async function resolveWorkspaceRoot(workspaceRoot) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    throw new Error('当前会话未提供工作区根目录，无法安全读取或导出子应用源码文件。')
  }
  const root = await realpath(workspaceRoot).catch(() => null)
  if (root == null) throw new Error('当前会话工作区根目录不存在。')
  return root
}

function assertInsideWorkspace(workspaceRoot, candidate) {
  const rel = relative(workspaceRoot, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('源码文件必须位于当前工作区内。')
  }
}

function safePathSegment(value, fallback) {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}
