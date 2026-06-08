/**
 * AppSkillsManager — 应用内技能目录管理服务
 *
 * 管理三种技能来源：
 *   1. **Bundled（内置）**：打包在 resources/skills/ 中的内置技能，只读
 *   2. **User-installed（用户安装）**：安装到 {userData}/skills/ 的技能，可读写
 *   3. **Linked（软链接）**：通过软链接引入的宿主机技能目录，链接存放在 {userData}/skills/_links/
 *
 * 职责：
 *   - 解析各种技能路径
 *   - 扫描内置和用户技能目录
 *   - 安装技能（复制到用户目录）
 *   - 创建/删除软链接
 *   - 提供技能目录路径给 SkillService
 */

import { app } from 'electron'
import { existsSync, mkdirSync, cpSync, lstatSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { createLogger } from '@spark/shared'

const log = createLogger('AppSkillsManager')

let instance: AppSkillsManager | null = null

export function getAppSkillsManager(): AppSkillsManager {
  if (!instance) {
    instance = new AppSkillsManager()
  }
  return instance
}

export class AppSkillsManager {
  /** Bundled skills 目录（resources/skills） */
  readonly bundledDir: string
  /** User-installed skills 目录（userData/skills） */
  readonly userDir: string
  /** Symlinks 目录（userData/skills/_links） */
  readonly linksDir: string

  constructor() {
    // dev: 项目 resources/skills，prod: process.resourcesPath/skills
    this.bundledDir = is.dev
      ? join(__dirname, '../../resources/skills')
      : join(process.resourcesPath, 'skills')

    const userData = app.getPath('userData')
    this.userDir = join(userData, 'skills')
    this.linksDir = join(userData, 'skills', '_links')

    // 确保用户目录存在
    mkdirSync(this.userDir, { recursive: true })
    mkdirSync(this.linksDir, { recursive: true })
  }

  // ─── Path Resolvers ────────────────────────────────────────────────

  /**
   * 获取所有应该被扫描的技能根目录
   * 顺序：内置 → 用户安装 → 软链接
   */
  getSkillRoots(): string[] {
    return [this.bundledDir, this.userDir]
  }

  /**
   * 获取内置技能目录中的所有子目录名
   */
  listBundledSkillNames(): string[] {
    return this.listSkillDirs(this.bundledDir)
  }

  /**
   * 获取用户安装的技能目录中的所有子目录名
   */
  listUserSkillNames(): string[] {
    return this.listSkillDirs(this.userDir).filter((n) => n !== '_links')
  }

  /**
   * 获取所有软链接的技能名
   */
  listLinkedSkillNames(): string[] {
    if (!existsSync(this.linksDir)) return []
    const names: string[] = []
    for (const entry of readdirSync(this.linksDir)) {
      const linkPath = join(this.linksDir, entry)
      if (lstatSync(linkPath).isSymbolicLink()) {
        names.push(entry)
      }
    }
    return names
  }

  // ─── Install (copy to user dir) ────────────────────────────────────

  /**
   * 安装技能到用户目录
   * 将源目录完整复制到 {userData}/skills/{name}/
   *
   * @param sourcePath 技能源目录路径
   * @returns 安装后的技能目录路径
   */
  installSkill(sourcePath: string): string {
    const name = basename(sourcePath)
    const dest = join(this.userDir, name)

    // 如果已存在，先删除
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true })
    }

    cpSync(sourcePath, dest, { recursive: true })
    log.info(`Skill installed: ${name} → ${dest}`)
    return dest
  }

  /**
   * 卸载用户安装的技能
   */
  uninstallSkill(name: string): boolean {
    const dest = join(this.userDir, name)
    if (!existsSync(dest)) return false

    rmSync(dest, { recursive: true, force: true })
    log.info(`Skill uninstalled: ${name}`)
    return true
  }

  // ─── Symlink Management ────────────────────────────────────────────

  /**
   * 创建软链接，将宿主机技能目录引入应用
   *
   * @param targetPath 宿主机上的技能目录路径
   * @param name 可选的链接名（默认使用目录名）
   * @returns 链接路径
   */
  linkSkill(targetPath: string, name?: string): string {
    const linkName = name ?? basename(targetPath)
    const linkPath = join(this.linksDir, linkName)

    // 如果链接已存在，先删除
    if (existsSync(linkPath)) {
      rmSync(linkPath, { force: true })
    }

    const resolvedTarget = resolve(targetPath)
    symlinkSync(resolvedTarget, linkPath, 'junction')
    log.info(`Skill linked: ${linkName} → ${resolvedTarget}`)
    return linkPath
  }

  /**
   * 删除软链接
   */
  unlinkSkill(name: string): boolean {
    const linkPath = join(this.linksDir, name)
    if (!existsSync(linkPath)) return false
    if (!lstatSync(linkPath).isSymbolicLink()) return false

    rmSync(linkPath, { force: true })
    log.info(`Skill unlinked: ${name}`)
    return true
  }

  /**
   * 获取软链接指向的真实路径
   */
  getLinkTarget(name: string): string | null {
    const linkPath = join(this.linksDir, name)
    if (!existsSync(linkPath)) return null
    try {
      return resolve(lstatSync(linkPath).isSymbolicLink() ? linkPath : null as unknown as string)
    } catch {
      return null
    }
  }

  // ─── Query ─────────────────────────────────────────────────────────

  /**
   * 检查技能名是否在内置目录中
   */
  isBundled(name: string): boolean {
    return existsSync(join(this.bundledDir, name, 'SKILL.md'))
  }

  /**
   * 检查技能名是否在用户安装目录中
   */
  isUserInstalled(name: string): boolean {
    return existsSync(join(this.userDir, name, 'SKILL.md'))
  }

  /**
   * 获取技能的绝对路径（按优先级查找：用户安装 → 内置）
   */
  resolveSkillPath(name: string): string | null {
    const userPath = join(this.userDir, name)
    if (existsSync(join(userPath, 'SKILL.md'))) return userPath

    const bundledPath = join(this.bundledDir, name)
    if (existsSync(join(bundledPath, 'SKILL.md'))) return bundledPath

    return null
  }

  // ─── Private ───────────────────────────────────────────────────────

  private listSkillDirs(root: string): string[] {
    if (!existsSync(root)) return []
    const names: string[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name === '_links') continue
      // 检查子目录是否有 SKILL.md（支持软链接目录）
      const subDir = join(root, entry.name)
      if (!existsSync(join(subDir, 'SKILL.md'))) continue
      names.push(entry.name)
    }
    return names
  }
}
