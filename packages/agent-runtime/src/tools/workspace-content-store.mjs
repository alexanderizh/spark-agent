import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/
const SAFE_EXTENSION = /^\.[A-Za-z0-9]+$/

export function resolveWorkspaceRoot(workspaceRoot) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    throw new Error('当前会话未提供工作区根目录。')
  }
  let root
  try {
    root = realpathSync(workspaceRoot)
  } catch (error) {
    throw new Error('当前会话工作区根目录不存在。', { cause: error })
  }
  if (!statSync(root).isDirectory()) throw new Error('当前会话工作区根路径不是目录。')
  return root
}

export function ensureTrustedWorkspaceDirectory(workspaceRoot, directorySegments) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  let current = root
  for (const segment of directorySegments) {
    assertSafeSegment(segment)
    const candidate = resolve(current, segment)
    assertInsideWorkspace(root, candidate)
    try {
      mkdirSync(candidate, { mode: 0o700 })
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    }

    const item = lstatSync(candidate)
    if (item.isSymbolicLink() || !item.isDirectory()) {
      throw new Error(`工作区内容目录不能是符号链接或普通文件：${segment}`)
    }
    const resolved = realpathSync(candidate)
    assertInsideWorkspace(root, resolved)
    current = resolved
  }
  return { root, directory: current }
}

export function resolveTrustedWorkspaceDirectory(workspaceRoot, directorySegments) {
  const root = resolveWorkspaceRoot(workspaceRoot)
  let current = root
  for (const segment of directorySegments) {
    assertSafeSegment(segment)
    const candidate = resolve(current, segment)
    assertInsideWorkspace(root, candidate)
    let item
    try {
      item = lstatSync(candidate)
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null
      throw error
    }
    if (item.isSymbolicLink() || !item.isDirectory()) {
      throw new Error(`工作区内容目录不能是符号链接或普通文件：${segment}`)
    }
    const resolved = realpathSync(candidate)
    assertInsideWorkspace(root, resolved)
    current = resolved
  }
  return { root, directory: current }
}

export function writeContentAddressedWorkspaceFile(params) {
  if (typeof params.content !== 'string') throw new Error('内容寻址文件内容必须是字符串。')
  if (!SAFE_EXTENSION.test(params.extension)) throw new Error('内容寻址文件扩展名无效。')
  const bytes = Buffer.byteLength(params.content, 'utf8')
  if (params.maxBytes != null && bytes > params.maxBytes) {
    throw new Error(`内容超过 ${params.maxBytes} bytes 的落盘上限。`)
  }

  const { root, directory } = ensureTrustedWorkspaceDirectory(
    params.workspaceRoot,
    params.directorySegments,
  )
  const sha256 = createHash('sha256').update(params.content, 'utf8').digest('hex')
  const fileName = `${sha256}${params.extension}`
  const targetPath = resolve(directory, fileName)
  assertInsideWorkspace(root, targetPath)
  let reused = false

  try {
    writeFileSync(targetPath, params.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error
    const item = lstatSync(targetPath)
    const label = params.label ?? '内容寻址文件'
    if (!item.isFile() || item.isSymbolicLink()) {
      throw new Error(`${label}路径已被非普通文件占用。`, { cause: error })
    }
    if (readFileSync(targetPath, 'utf8') !== params.content) {
      throw new Error(`${label}与其 SHA-256 不一致，拒绝复用。`, { cause: error })
    }
    reused = true
  }

  const resolvedTarget = realpathSync(targetPath)
  assertInsideWorkspace(root, resolvedTarget)
  return {
    path: resolvedTarget,
    relativePath: relative(root, resolvedTarget),
    sha256,
    bytes,
    reused,
  }
}

export function resolveContentAddressedWorkspaceFile(params) {
  if (typeof params.artifactId !== 'string' || !/^[a-f0-9]{64}$/.test(params.artifactId)) {
    throw new Error('artifactId 必须是完整的 SHA-256。')
  }
  const resolvedDirectory = resolveTrustedWorkspaceDirectory(
    params.workspaceRoot,
    params.directorySegments,
  )
  if (resolvedDirectory == null) return null

  for (const extension of params.extensions) {
    if (!SAFE_EXTENSION.test(extension)) continue
    const candidate = resolve(resolvedDirectory.directory, `${params.artifactId}${extension}`)
    assertInsideWorkspace(resolvedDirectory.root, candidate)
    let item
    try {
      item = lstatSync(candidate)
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) continue
      throw error
    }
    if (!item.isFile() || item.isSymbolicLink()) {
      throw new Error('工具结果制品路径不是普通文件。')
    }
    const resolved = realpathSync(candidate)
    assertInsideWorkspace(resolvedDirectory.root, resolved)
    return {
      root: resolvedDirectory.root,
      directory: resolvedDirectory.directory,
      path: resolved,
      relativePath: relative(resolvedDirectory.root, resolved),
      extension,
      bytes: item.size,
    }
  }
  return null
}

export function assertInsideWorkspace(workspaceRoot, candidate) {
  const rel = relative(workspaceRoot, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('内容路径必须位于当前工作区内。')
  }
}

function assertSafeSegment(segment) {
  if (
    typeof segment !== 'string' ||
    !SAFE_SEGMENT.test(segment) ||
    segment === '.' ||
    segment === '..'
  ) {
    throw new Error('工作区内容目录名称无效。')
  }
}

function hasErrorCode(error, code) {
  return error != null && typeof error === 'object' && error.code === code
}
