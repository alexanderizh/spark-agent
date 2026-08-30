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
import { existsSync, mkdirSync, cpSync, lstatSync, readdirSync, readlinkSync, rmSync, symlinkSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
  /**
   * 托管插件目录（userData/skills/_plugin）。
   * 以 Claude Code「本地插件」结构暴露所有已启用技能，供 Claude Agent SDK 原生
   * 渐进式披露（注入 name+description 并提供 Skill 工具自主加载）。
   */
  readonly managedPluginDir: string

  constructor() {
    // dev: 项目 resources/skills，prod: process.resourcesPath/skills
    this.bundledDir = is.dev
      ? join(__dirname, '../../resources/skills')
      : join(process.resourcesPath, 'skills')

    const userData = app.getPath('userData')
    this.userDir = join(userData, 'skills')
    this.linksDir = join(userData, 'skills', '_links')
    this.managedPluginDir = join(userData, 'skills', '_plugin')

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
    return [this.bundledDir, this.userDir, this.linksDir]
  }

  /** 宿主机上 Claude / Codex 的技能目录（自动软链导入的来源） */
  getHostSkillRoots(): string[] {
    const home = homedir()
    return [
      join(home, '.claude', 'skills'),
      join(home, '.codex', 'skills'),
    ]
  }

  // ─── Host Auto-Import ──────────────────────────────────────────────

  /**
   * 扫描宿主机 ~/.claude/skills 与 ~/.codex/skills，把其中每个技能目录
   * 软链接到 {userData}/skills/_links/ 下，实现「应用打开时自动导入、默认可用」。
   *
   * 幂等：已存在且指向同一目标的链接跳过；指向变化则重建。
   *
   * @returns 本次有效的链接路径列表（供上层登记到数据库）
   */
  autoImportHostSkills(): Array<{ linkPath: string; targetPath: string; source: 'claude' | 'codex' }> {
    const results: Array<{ linkPath: string; targetPath: string; source: 'claude' | 'codex' }> = []
    const roots: Array<{ root: string; source: 'claude' | 'codex' }> = [
      { root: join(homedir(), '.claude', 'skills'), source: 'claude' },
      { root: join(homedir(), '.codex', 'skills'), source: 'codex' },
    ]

    for (const { root, source } of roots) {
      if (!existsSync(root)) continue
      let entries: string[]
      try {
        entries = readdirSync(root)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const targetPath = join(root, entry)
        // 必须是含 SKILL.md 的技能目录（跟随软链接判断）
        if (!this.isSkillDir(targetPath)) continue

        // 链接名加来源前缀，避免 claude/codex 同名技能冲突
        const linkName = `${source}-${entry}`
        const linkPath = join(this.linksDir, linkName)
        try {
          if (existsSync(linkPath) || this.isBrokenSymlink(linkPath)) {
            const current = this.safeReadlinkTarget(linkPath)
            if (current === resolve(targetPath)) {
              results.push({ linkPath, targetPath: resolve(targetPath), source })
              continue
            }
            rmSync(linkPath, { force: true })
          }
          symlinkSync(resolve(targetPath), linkPath, 'junction')
          log.info(`Host skill linked: ${linkName} → ${targetPath}`)
          results.push({ linkPath, targetPath: resolve(targetPath), source })
        } catch (err) {
          log.warn(`Failed to link host skill ${targetPath}: ${String(err)}`)
        }
      }
    }
    return results
  }

  // ─── Managed Plugin (SDK 原生渐进式披露) ───────────────────────────

  /**
   * 用已启用技能重建托管插件目录：
   *   {managedPluginDir}/
   *     .claude-plugin/plugin.json
   *     skills/<name> -> 软链接到各技能真实 rootPath
   *
   * 仅纳入磁盘上真实存在 SKILL.md 的技能（虚拟 registry:// 等跳过）。
   *
   * @returns 实际纳入的技能名列表
   */
  buildManagedPluginDir(skills: Array<{ name: string; rootPath: string }>): string[] {
    const skillsDir = join(this.managedPluginDir, 'skills')
    const metaDir = join(this.managedPluginDir, '.claude-plugin')
    // 全量重建，确保禁用/卸载的技能不残留
    try {
      if (existsSync(this.managedPluginDir)) rmSync(this.managedPluginDir, { recursive: true, force: true })
    } catch {
      // 忽略，下面继续尝试创建
    }
    mkdirSync(skillsDir, { recursive: true })
    mkdirSync(metaDir, { recursive: true })

    writeFileSync(
      join(metaDir, 'plugin.json'),
      JSON.stringify(
        {
          name: 'spark-managed-skills',
          version: '1.0.0',
          description: 'SparkWork 托管技能集合（内置 / 应用内安装 / 宿主软链）',
        },
        null,
        2,
      ),
      'utf-8',
    )

    const linked: string[] = []
    const used = new Set<string>()
    for (const skill of skills) {
      const root = skill.rootPath
      if (!root || root.includes('://')) continue
      if (!this.isSkillDir(root)) continue
      const dirName = sanitizeDirName(skill.name) || sanitizeDirName(basename(root))
      if (!dirName) continue
      // 同名去重
      let unique = dirName
      let i = 2
      while (used.has(unique)) unique = `${dirName}-${i++}`
      used.add(unique)
      try {
        symlinkSync(resolve(root), join(skillsDir, unique), 'junction')
        linked.push(unique)
      } catch (err) {
        log.warn(`Failed to link managed skill ${root}: ${String(err)}`)
      }
    }
    log.info(`Managed skills plugin rebuilt: ${linked.length} skill(s)`)
    return linked
  }

  /** 判断目录是否为技能目录（跟随软链接，含 SKILL.md） */
  private isSkillDir(dirPath: string): boolean {
    try {
      const st = statSync(dirPath) // 跟随软链接
      if (!st.isDirectory()) return false
      return existsSync(join(dirPath, 'SKILL.md'))
    } catch {
      return false
    }
  }

  private isBrokenSymlink(p: string): boolean {
    try {
      return lstatSync(p).isSymbolicLink() && !existsSync(p)
    } catch {
      return false
    }
  }

  private safeReadlinkTarget(linkPath: string): string | null {
    try {
      if (!lstatSync(linkPath).isSymbolicLink()) return null
      return resolve(readlinkSync(linkPath))
    } catch {
      return null
    }
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
      if (entry.name.startsWith('.')) continue
      if (entry.name === '_links' || entry.name === '_plugin') continue
      // 跟随软链接判断是否为含 SKILL.md 的目录
      if (!this.isSkillDir(join(root, entry.name))) continue
      names.push(entry.name)
    }
    return names
  }
}

/** 技能名 → 安全目录名（保留中文、字母数字，其余转连字符） */
function sanitizeDirName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9一-龥._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
}
