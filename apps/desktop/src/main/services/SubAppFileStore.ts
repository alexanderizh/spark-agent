import { promises as fs } from 'node:fs'
import path from 'node:path'
import { SparkError } from '@spark/shared'

/**
 * 子应用 files 能力域的文件空间：`<root>/<appId>/` 下的相对路径文本文件。
 *
 * 安全边界：
 *   - 相对路径在协议层已做格式校验（无 `..` 段/盘符/反斜杠），这里再做
 *     join + resolve 二次校验，最终绝对路径必须落在应用目录内；
 *   - 单文件内容上限 2MB（与协议 schema 一致），目录文件数列出上限 500；
 *   - 只读写文本（UTF-8）：与 data 域（结构化 KV）互补，面向导出快照、
 *     生成的 markdown 等文件型内容，不提供任意二进制/任意路径访问。
 */
export class SubAppFileStore {
  private readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  /** 解析并校验应用空间内路径；逃逸直接拒绝（不回退到目录内其他路径）。 */
  private resolveAppPath(appId: string, relPath: string): string {
    const appRoot = path.resolve(this.rootDir, appId)
    const resolved = path.resolve(appRoot, relPath)
    if (resolved !== appRoot && !resolved.startsWith(appRoot + path.sep)) {
      throw new SparkError('PERMISSION_DENIED', '文件路径超出应用专属目录。')
    }
    return resolved
  }

  async read(
    appId: string,
    relPath: string,
  ): Promise<{
    content: string
    byteLength: number
    updatedAt: string
  }> {
    const target = this.resolveAppPath(appId, relPath)
    let stat: Awaited<ReturnType<typeof fs.stat>>
    let content: string
    try {
      stat = await fs.stat(target)
      if (!stat.isFile()) throw new Error('not a file')
      content = await fs.readFile(target, 'utf8')
    } catch {
      throw new SparkError('NOT_FOUND', `应用文件不存在：${relPath}`)
    }
    return {
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      updatedAt: stat.mtime.toISOString(),
    }
  }

  async write(
    appId: string,
    relPath: string,
    content: string,
  ): Promise<{
    byteLength: number
    updatedAt: string
  }> {
    const target = this.resolveAppPath(appId, relPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
    const stat = await fs.stat(target)
    return {
      byteLength: Buffer.byteLength(content, 'utf8'),
      updatedAt: stat.mtime.toISOString(),
    }
  }

  async list(
    appId: string,
    prefix?: string,
  ): Promise<{
    files: Array<{ path: string; size: number; updatedAt: string }>
  }> {
    const appRoot = path.resolve(this.rootDir, appId)
    let entries: Array<string>
    try {
      await fs.stat(appRoot)
      entries = await this.walkFiles(appRoot, appRoot, 0)
    } catch {
      return { files: [] }
    }
    const normalizedPrefix = prefix == null || prefix.length === 0 ? '' : prefix
    const files: Array<{ path: string; size: number; updatedAt: string }> = []
    for (const entry of entries) {
      if (normalizedPrefix.length > 0 && !entry.startsWith(normalizedPrefix)) continue
      const stat = await fs.stat(path.join(appRoot, entry))
      files.push({ path: entry, size: stat.size, updatedAt: stat.mtime.toISOString() })
      if (files.length >= 500) break
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    return { files }
  }

  async delete(appId: string, relPath: string): Promise<{ deleted: true }> {
    const target = this.resolveAppPath(appId, relPath)
    try {
      const stat = await fs.stat(target)
      if (!stat.isFile()) throw new Error('not a file')
    } catch {
      throw new SparkError('NOT_FOUND', `应用文件不存在：${relPath}`)
    }
    await fs.unlink(target)
    return { deleted: true }
  }

  /** 删除应用的整个文件空间（应用删除时调用；目录不存在时静默成功）。 */
  async removeApp(appId: string): Promise<void> {
    const appRoot = path.resolve(this.rootDir, appId)
    await fs.rm(appRoot, { recursive: true, force: true })
  }

  /** 深度优先收集相对路径；深度/数量双上限防符号环与超大目录。 */
  private async walkFiles(
    appRoot: string,
    currentDir: string,
    depth: number,
  ): Promise<Array<string>> {
    if (depth > 8) return []
    const dirents = await fs.readdir(currentDir, { withFileTypes: true })
    const out: Array<string> = []
    for (const dirent of dirents) {
      if (out.length >= 2000) break
      const childPath = path.join(currentDir, dirent.name)
      if (dirent.isDirectory()) {
        const nested = await this.walkFiles(appRoot, childPath, depth + 1)
        out.push(...nested)
      } else if (dirent.isFile()) {
        out.push(path.relative(appRoot, childPath).split(path.sep).join('/'))
      }
    }
    return out
  }
}
