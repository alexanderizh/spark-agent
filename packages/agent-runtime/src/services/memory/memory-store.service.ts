/**
 * @module memory-store.service
 *
 * 记忆文件系统存储服务 — 管理 markdown 文件读写和 MEMORY.md 索引文件维护
 *
 * 职责：
 *   - 在指定 scope 目录下创建 / 读取 / 删除 markdown 记忆文件
 *   - 维护各 scope 目录下的 MEMORY.md 索引文件
 *   - 文件写入使用 .tmp → rename 原子替换策略
 *
 * 存储路径约定：
 *   user    : ~/.spark-agent/memory/user/<id>.md
 *   project : <workspace>/.spark-agent/memory/<id>.md
 *   agent   : ~/.spark-agent/memory/agent/<agentId>/<id>.md
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { createLogger, SparkError } from '@spark/shared'

const log = createLogger('memory:store')

export interface MemoryFileMeta {
  id: string
  scope: 'user' | 'project' | 'agent'
  scopeRef: string | null
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  description: string
  confidence: number
  createdAt: number
  updatedAt: number
  hitCount: number
  lastHitAt: number | null
  sourceSessionId: string | null
  links: string[]
  archived: boolean
}

export interface WriteMemoryFileParams {
  meta: MemoryFileMeta
  body: string
}

const MEMORY_INDEX_FILENAME = 'MEMORY.md'

export class MemoryStoreService {
  private readonly homeDir: string

  constructor(
    /** 应用 home 目录，默认 ~/.spark-agent */
    private readonly appHomeDir?: string,
    /** 当前 workspace 根路径（project scope 用） */
    private readonly workspaceRootPath?: string,
  ) {
    this.homeDir = appHomeDir ?? path.join(os.homedir(), '.spark-agent')
  }

  /**
   * 获取指定 scope 目录的绝对路径
   */
  getScopeDir(scope: 'user' | 'project' | 'agent', scopeRef: string | null): string {
    switch (scope) {
      case 'user':
        return path.join(this.homeDir, 'memory', 'user')
      case 'project':
        if (this.workspaceRootPath == null) {
          throw new SparkError('VALIDATION_FAILED', 'project scope 记忆需要 workspaceRootPath，当前会话未关联工作区。')
        }
        return path.join(this.workspaceRootPath, '.spark-agent', 'memory')
      case 'agent':
        if (scopeRef == null) {
          throw new SparkError('VALIDATION_FAILED', 'agent scope 记忆需要 scopeRef (agentId)，请指定具体 agent。')
        }
        return path.join(this.homeDir, 'memory', 'agent', scopeRef)
    }
  }

  /**
   * 获取记忆文件的绝对路径
   */
  getFilePath(scope: 'user' | 'project' | 'agent', scopeRef: string | null, id: string): string {
    return path.join(this.getScopeDir(scope, scopeRef), `${id}.md`)
  }

  /**
   * 将记忆写入 markdown 文件（原子写入）
   */
  async writeFile(params: WriteMemoryFileParams): Promise<string> {
    const { meta, body } = params
    const dir = this.getScopeDir(meta.scope, meta.scopeRef)
    const filePath = path.join(dir, `${meta.id}.md`)

    await fs.mkdir(dir, { recursive: true })

    const content = renderMemoryFile(meta, body)

    // 原子写入：先写 .tmp，再 rename
    const tmpPath = `${filePath}.tmp`
    await fs.writeFile(tmpPath, content, 'utf-8')
    await fs.rename(tmpPath, filePath)

    log.debug(`Memory file written: ${filePath}`)
    return filePath
  }

  /**
   * 读取记忆文件的完整正文（跳过 frontmatter）
   */
  async readFile(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8')
    return extractBody(content)
  }

  /**
   * 删除记忆文件
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath)
      log.debug(`Memory file deleted: ${filePath}`)
    } catch (err) {
      // 文件不存在也不报错（可能已经被手动删了）
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  /**
   * 更新 MEMORY.md 索引文件
   * 格式：每行 `- [name](file.md) — description`
   */
  async updateIndexFile(scope: 'user' | 'project' | 'agent', scopeRef: string | null, entries: Array<{ name: string; description: string; id: string }>): Promise<void> {
    const dir = this.getScopeDir(scope, scopeRef)
    const indexPath = path.join(dir, MEMORY_INDEX_FILENAME)

    await fs.mkdir(dir, { recursive: true })

    const lines = entries.map((e) => `- [${e.name}](${e.id}.md) — ${e.description}`)
    const content = `# Memory Index\n\n${lines.join('\n')}\n`

    const tmpPath = `${indexPath}.tmp`
    await fs.writeFile(tmpPath, content, 'utf-8')
    await fs.rename(tmpPath, indexPath)

    log.debug(`Memory index updated: ${indexPath}`)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * 渲染完整的记忆 markdown 文件（含 frontmatter）
 */
function renderMemoryFile(meta: MemoryFileMeta, body: string): string {
  const frontmatter = [
    '---',
    `id: ${meta.id}`,
    `scope: ${meta.scope}`,
    `scope_ref: ${meta.scopeRef ?? 'null'}`,
    `type: ${meta.type}`,
    `name: ${meta.name}`,
    `description: ${meta.description}`,
    `confidence: ${meta.confidence}`,
    `created_at: ${new Date(meta.createdAt).toISOString()}`,
    `updated_at: ${new Date(meta.updatedAt).toISOString()}`,
    `hit_count: ${meta.hitCount}`,
    `last_hit_at: ${meta.lastHitAt != null ? new Date(meta.lastHitAt).toISOString() : 'null'}`,
    `source_session_id: ${meta.sourceSessionId ?? 'null'}`,
    `links: [${meta.links.join(', ')}]`,
    `archived: ${meta.archived}`,
    '---',
    '',
  ].join('\n')

  return `${frontmatter}${body}\n`
}

/**
 * 从 markdown 文件中提取正文（跳过 frontmatter）
 */
function extractBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n\n?/)
  if (match == null) return content
  return content.slice(match[0].length)
}
