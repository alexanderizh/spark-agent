/**
 * @module wiki-store.service
 *
 * Wiki 文件系统存储服务 — 管理 markdown 正文文件与版本快照。
 *
 * 职责（范式对齐 memory-store.service）：
 *   - 在 scope 目录下创建 / 读取 / 删除页面正文文件（原子 tmp → rename）
 *   - 版本快照写入受控命名空间 revisions/<page_id>/<version>.md（可枚举清理）
 *   - S0 不维护 INDEX.md 导出投影（设置项 wiki/store/exportIndex 生效于 S1）
 *
 * 存储路径约定（方案 §5.2）：
 *   user    : ~/.spark-agent/wiki/user/<space_id>/<page_id>.md
 *   project : <workspace>/.spark-agent/wiki/<space_id>/<page_id>.md
 *   agent   : ~/.spark-agent/wiki/agent/<agentId>/<space_id>/<page_id>.md
 *   revisions: ~/.spark-agent/wiki/revisions/<page_id>/<version>.md（全 scope 统一）
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { createLogger } from '@spark/shared'
import type { WikiScope } from '@spark/storage'

const log = createLogger('wiki:store')

export class WikiStoreService {
  private readonly homeDir: string

  constructor(
    /** 应用 home 目录，默认 ~/.spark-agent */
    private readonly appHomeDir?: string,
    /** 当前 workspace 根路径（project scope 用） */
    private readonly workspaceRootPath?: string,
  ) {
    this.homeDir = appHomeDir ?? path.join(os.homedir(), '.spark-agent')
  }

  /** 空间正文目录（scope 决定根，space 决定子目录）。 */
  getSpaceDir(scope: WikiScope, scopeRef: string | null, spaceId: string): string {
    switch (scope) {
      case 'user':
        return path.join(this.homeDir, 'wiki', 'user', spaceId)
      case 'project':
        if (this.workspaceRootPath == null) {
          // project 空间在无 workspace 的会话中不可写正文；读取场景由上层校验，
          // 此处返回 home 侧路径保持函数完整（写入前服务层已拒绝）。
          return path.join(this.homeDir, 'wiki', 'project-orphan', spaceId)
        }
        return path.join(this.workspaceRootPath, '.spark-agent', 'wiki', spaceId)
      case 'agent':
        if (scopeRef == null) {
          return path.join(this.homeDir, 'wiki', 'agent-orphan', spaceId)
        }
        return path.join(this.homeDir, 'wiki', 'agent', scopeRef, spaceId)
      case 'team':
        // 首期不建团队功能；落 home 侧保留字面路径以防误写 DB 后可清理。
        return path.join(this.homeDir, 'wiki', 'team', scopeRef ?? 'default', spaceId)
    }
  }

  /** 页面正文文件绝对路径。 */
  getFilePath(scope: WikiScope, scopeRef: string | null, spaceId: string, pageId: string): string {
    return path.join(this.getSpaceDir(scope, scopeRef, spaceId), `${pageId}.md`)
  }

  /** 版本快照目录（受控命名空间，与 scope 无关，便于删除屏障枚举清理）。 */
  getRevisionDir(pageId: string): string {
    return path.join(this.homeDir, 'wiki', 'revisions', pageId)
  }

  /** 原子写入正文文件（tmp → rename），返回绝对路径。 */
  async writeBody(
    scope: WikiScope,
    scopeRef: string | null,
    spaceId: string,
    pageId: string,
    body: string,
  ): Promise<string> {
    const filePath = this.getFilePath(scope, scopeRef, spaceId, pageId)
    await this.writeBodyAt(filePath, body)
    return filePath
  }

  /**
   * 原子写入「指定路径」的正文文件（tmp → rename）。
   *
   * 与 writeBody 的区别：不回推路径，而是直接写 DB 行里记录的那条路径。
   * CAS 失配回滚（WikiWriteService.restoreOverwrittenBody）必须写回权威行
   * 指向的文件，路径口径以 DB 为准而不是重新推导，避免存量/异常路径下
   * 回滚写偏到另一个文件。
   */
  async writeBodyAt(filePath: string, body: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmpPath = `${filePath}.tmp`
    await fs.writeFile(tmpPath, body, 'utf-8')
    await fs.rename(tmpPath, filePath)
    log.debug(`Wiki body written: ${filePath}`)
  }

  /** 读取正文文件（正文是纯 markdown，无 frontmatter）。 */
  async readBody(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8')
  }

  /** 写入版本快照（受控命名空间），返回快照路径。 */
  async writeRevisionSnapshot(pageId: string, version: number, body: string): Promise<string> {
    const dir = this.getRevisionDir(pageId)
    await fs.mkdir(dir, { recursive: true })
    const snapshotPath = path.join(dir, `${version}.md`)
    const tmpPath = `${snapshotPath}.tmp`
    await fs.writeFile(tmpPath, body, 'utf-8')
    await fs.rename(tmpPath, snapshotPath)
    return snapshotPath
  }

  /** 删除正文文件（不存在时静默，可能已被手动清理）。 */
  async deleteBody(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  /** 删除某页面全部版本快照（删除屏障；目录不存在时静默）。 */
  async deleteRevisions(pageId: string): Promise<void> {
    try {
      await fs.rm(this.getRevisionDir(pageId), { recursive: true, force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}
