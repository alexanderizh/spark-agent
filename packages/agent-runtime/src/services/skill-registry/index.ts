/**
 * @module skill-registry/service
 *
 * Skill Registry Service — Skill 市场源管理 + 搜索/安装/卸载
 */

import crypto from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  RemoteSkillItem,
  SkillItem,
  SkillRegistry,
} from '@spark/protocol'
import type { SparkDatabase } from '@spark/storage'
import {
  SkillRegistryRepository,
  SkillRepository,
} from '@spark/storage'
import type { SkillRegistryAdapter, SkillRegistryAdapterConfig } from './adapter.js'
import { MockSkillRegistryAdapter } from './mock-adapter.js'
import { SkillHubAdapter } from './skillhub-adapter.js'
import { SkillsMPAdapter } from './skillsmp-adapter.js'
import {
  INSTALLABLE_SKILL_CATALOG,
  getInstallableSkillBySlug,
  type InstallableSkillCatalogItem,
} from './installable-catalog.js'
import {
  installFromGithubTarball,
  tarballSourceFingerprint,
  type TarballInstallParams,
} from './tarball-installer.js'

export class SkillRegistryService {
  private registryRepo: SkillRegistryRepository
  private skillRepo: SkillRepository
  private adapters = new Map<string, SkillRegistryAdapter>()

  /**
   * @param db          数据库
   * @param userSkillsDir 用户技能落盘目录（来自 AppSkillsManager.userDir）。
   *   提供时，从市场安装的技能会把 SKILL.md 写到真实磁盘目录，使其能被 agent 运行时
   *   实际加载/原生发现；不提供时回落到虚拟 registry:// 路径（仅元数据，无法加载）。
   */
  constructor(
    private readonly db: SparkDatabase,
    private readonly userSkillsDir?: string,
  ) {
    this.registryRepo = new SkillRegistryRepository(db)
    this.skillRepo = new SkillRepository(db)
  }

  /**
   * 初始化：确保默认市场源存在，并创建 Adapter 实例
   */
  initialize(): void {
    this.registryRepo.ensureDefaults()
    const registries = this.registryRepo.listEnabled()
    for (const reg of registries) {
      if (!this.adapters.has(reg.id)) {
        this.adapters.set(reg.id, this.createAdapter({
          registryId: reg.id,
          apiBaseUrl: reg.api_base_url,
          configJson: reg.config_json,
        }))
      }
    }
  }

  // ─── Registry CRUD ─────────────────────────────────────────────────

  listRegistries(): SkillRegistry[] {
    return this.registryRepo.list().map(toSkillRegistry)
  }

  updateRegistry(id: string, fields: { enabled?: boolean; configJson?: string }): SkillRegistry {
    const updateFields: Record<string, unknown> = {}
    if (fields.enabled !== undefined) updateFields.enabled = fields.enabled
    if (fields.configJson !== undefined) updateFields.configJson = fields.configJson

    const row = this.registryRepo.update(id, updateFields)
    if (row == null) throw new Error(`Registry not found: ${id}`)

    // 如果禁用，移除 adapter；如果启用，重新创建
    if (fields.enabled === false) {
      this.adapters.delete(id)
    } else if (fields.enabled === true && !this.adapters.has(id)) {
      this.adapters.set(id, this.createAdapter({
        registryId: row.id,
        apiBaseUrl: row.api_base_url,
        configJson: row.config_json,
      }))
    }

    return toSkillRegistry(row)
  }

  // ─── Search & Browse ───────────────────────────────────────────────

  /**
   * 跨市场搜索 Skill
   * 如果指定了 registryId，只搜索该市场；否则搜索所有启用的市场
   */
  async search(params: {
    query: string
    registryId?: string
    category?: string
    limit?: number
    offset?: number
  }): Promise<{ skills: RemoteSkillItem[]; total: number }> {
    const installedMap = this.buildInstalledMap()

    if (params.registryId) {
      const adapter = this.getAdapterOrThrow(params.registryId)
      const searchOptions: { category?: string; limit?: number; offset?: number } = {}
      if (params.category !== undefined) searchOptions.category = params.category
      if (params.limit !== undefined) searchOptions.limit = params.limit
      if (params.offset !== undefined) searchOptions.offset = params.offset
      const result = await adapter.search(params.query, searchOptions)
      return {
        skills: result.skills.map((s) => this.enrichWithInstallStatus(s, installedMap)),
        total: result.total,
      }
    }

    // 聚合所有市场
    const allAdapters = Array.from(this.adapters.values())
    const results = await Promise.allSettled(
      allAdapters.map((a) => {
        const searchOptions: { category?: string; limit?: number; offset?: number } = {}
        if (params.category !== undefined) searchOptions.category = params.category
        if (params.limit !== undefined) searchOptions.limit = params.limit
        if (params.offset !== undefined) searchOptions.offset = params.offset
        return a.search(params.query, searchOptions).catch(() => ({ skills: [] as RemoteSkillItem[], total: 0 }))
      }),
    )

    const allSkills: RemoteSkillItem[] = []
    let total = 0
    for (const r of results) {
      if (r.status === 'fulfilled') {
        allSkills.push(...r.value.skills)
        total += r.value.total
      }
    }

    // 按评分排序
    allSkills.sort((a, b) => b.rating - a.rating)

    const offset = params.offset ?? 0
    const limit = params.limit ?? 20
    const paged = allSkills.slice(offset, offset + limit)

    return {
      skills: paged.map((s) => this.enrichWithInstallStatus(s, installedMap)),
      total,
    }
  }

  /**
   * 获取热门/推荐 Skill
   */
  async featured(params: { registryId?: string; limit?: number }): Promise<RemoteSkillItem[]> {
    const installedMap = this.buildInstalledMap()

    if (params.registryId) {
      const adapter = this.getAdapterOrThrow(params.registryId)
      const skills = await adapter.featured(params.limit)
      return skills.map((s) => this.enrichWithInstallStatus(s, installedMap))
    }

    // 聚合所有市场
    const allAdapters = Array.from(this.adapters.values())
    const results = await Promise.allSettled(
      allAdapters.map((a) => a.featured(params.limit).catch(() => [] as RemoteSkillItem[])),
    )

    const allSkills: RemoteSkillItem[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') allSkills.push(...r.value)
    }

    allSkills.sort((a, b) => b.downloadCount - a.downloadCount)
    return allSkills.slice(0, params.limit ?? 12).map((s) => this.enrichWithInstallStatus(s, installedMap))
  }

  /**
   * 获取市场分类列表
   */
  async categories(registryId: string): Promise<string[]> {
    const adapter = this.getAdapterOrThrow(registryId)
    return adapter.categories()
  }

  // ─── Install / Uninstall ────────────────────────────────────────────

  /**
   * 从市场安装 Skill 到本地
   */
  async install(params: { remoteSkillId: string; registryId: string }): Promise<SkillItem> {
    const adapter = this.getAdapterOrThrow(params.registryId)

    // 搜索找到对应的 remote skill
    const searchResult = await adapter.search('')
    const remoteSkill = searchResult.skills.find((s) => s.id === params.remoteSkillId)
    if (!remoteSkill) {
      throw new Error(`Skill not found in registry: ${params.remoteSkillId}`)
    }

    // 检查是否已安装
    const existing = this.skillRepo.list().find(
      (s) => s.registry_id === params.registryId && s.remote_id === params.remoteSkillId,
    )
    if (existing) {
      throw new Error(`Skill already installed: ${existing.name}`)
    }

    // 获取 manifest
    const manifestJson = await adapter.fetchManifest(remoteSkill.manifestUrl)
    const manifest = safeParseJson(manifestJson)

    // 落盘：把技能写成真实目录（SKILL.md + manifest.json），
    // 否则 rootPath 是虚拟 registry:// 路径，agent 运行时无法加载/原生发现。
    const skillBody = extractSkillBody(manifest, remoteSkill)
    const rootPath =
      this.materializeSkill(remoteSkill.name, skillBody, remoteSkill, manifest) ??
      `registry://${params.registryId}/${remoteSkill.id}`

    // 创建本地 Skill 记录
    const id = `skill:${crypto.randomUUID()}`
    const row = this.skillRepo.create({
      id,
      scope: 'user',
      name: remoteSkill.name,
      version: remoteSkill.version,
      rootPath,
      manifestJson: JSON.stringify({
        ...(manifest ?? {}),
        desc: remoteSkill.description,
        description: remoteSkill.description,
        source: remoteSkill.registryName,
        author: remoteSkill.author,
        category: remoteSkill.category,
        tags: remoteSkill.tags,
        // systemPrompt 兜底：即使未落盘，skills_load 也能从 manifest 取到正文
        systemPrompt: skillBody,
        homepage: remoteSkill.homepageUrl,
      }),
      enabled: true,
    })

    // 更新扩展字段
    const extendedFields: {
      registryId?: string | null
      remoteId?: string | null
      author?: string
      category?: string
      tagsJson?: string
      rating?: number
      downloadCount?: number
      homepageUrl?: string | null
      iconUrl?: string | null
    } = {
      registryId: params.registryId,
      remoteId: params.remoteSkillId,
      author: remoteSkill.author,
      category: remoteSkill.category,
      tagsJson: JSON.stringify(remoteSkill.tags),
      rating: remoteSkill.rating,
      downloadCount: remoteSkill.downloadCount,
    }
    if (remoteSkill.homepageUrl !== undefined) extendedFields.homepageUrl = remoteSkill.homepageUrl
    if (remoteSkill.iconUrl !== undefined) extendedFields.iconUrl = remoteSkill.iconUrl
    this.skillRepo.updateExtendedFields(id, extendedFields)

    // 更新 registry 的 last_sync_at
    this.registryRepo.update(params.registryId, { lastSyncAt: new Date().toISOString() })

    return toSkillItem(row)
  }

  /**
   * 卸载本地已安装的 Skill
   */
  uninstall(localSkillId: string): boolean {
    return this.skillRepo.deleteById(localSkillId)
  }

  // ─── 内置可安装技能目录（Installable Catalog） ──────────────────────

  /**
   * 返回内置可安装技能清单，并附上当前是否已安装的状态。
   * 用于技能商店「精选 / 可安装」卡片：新机器开箱即可看到这些卡片（不依赖联网），
   * 点击安装时才从 GitHub 按需下载完整原装技能。
   */
  listInstallableCatalog(): Array<InstallableSkillCatalogItem & { installed: boolean; localId?: string }> {
    const rows = this.skillRepo.list()
    return INSTALLABLE_SKILL_CATALOG.map((item) => {
      // 只按 root_path 精确等于 <userSkillsDir>/<slug> 来判定「本目录技能是否已安装」，
      // 绝不用 name 兜底——否则会把用户手动导入的同名（但不同来源）技能误判为已安装，
      // 进而在卸载时误删用户的同名技能。
      const match = this.findCatalogInstalledRow(item, rows)
      const base: InstallableSkillCatalogItem & { installed: boolean } = {
        ...item,
        installed: match != null,
      }
      // 仅在匹配到时附加 localId，避免 exactOptionalPropertyTypes 下的 undefined 赋值
      return match ? { ...base, localId: match.id } : base
    })
  }

  /**
   * 在 DB 行中找到「由本 catalog 安装」的那一行。
   * 匹配条件（二者满足其一即可，均按真实磁盘路径判定）：
   *   1. root_path 精确等于 <userSkillsDir>/<slug>；
   *   2. id 为 catalog 安装稳定指纹 `skill:catalog:<fp>`（跨 userSkillsDir 重命名等场景的兜底）。
   */
  private findCatalogInstalledRow(
    item: InstallableSkillCatalogItem,
    rows: ReturnType<SkillRepository['list']>,
  ) {
    const slugDir = this.userSkillsDir ? join(this.userSkillsDir, item.slug) : ''
    const catalogId = `skill:catalog:${tarballSourceFingerprint(item.source.repo, item.source.path)}`
    return rows.find((row) => {
      if (row.id === catalogId) return true
      return Boolean(slugDir) && row.root_path === slugDir
    })
  }

  /**
   * 从内置可安装技能目录安装一项。
   * 根据 source.type 分派到 tarball（整库下载，突破 60 文件限制）或 github（逐文件）路径。
   *
   * @param slug 目录条目的 slug
   * @param onProgress 进度回调（已下载字节数 / 总字节数）
   * @returns 安装后的 SkillItem
   */
  async installFromCatalog(
    slug: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<SkillItem> {
    const item = getInstallableSkillBySlug(slug)
    if (!item) throw new Error(`Unknown installable skill slug: ${slug}`)
    if (!this.userSkillsDir) {
      throw new Error('User skills directory not configured; cannot install')
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined

    if (item.source.type === 'tarball') {
      return this.installCatalogTarball(item, token, onProgress)
    }
    // github 逐文件路径（小技能），复用既有 installFromGithub。
    // 注意：installFromGithub 暂不支持进度回调，故 onProgress 在此路径下被忽略；
    // 当前 catalog 内的两项均走 tarball，未受影响。
    const ghParams: { repo: string; ref?: string; path?: string } = { repo: item.source.repo }
    if (item.source.ref) ghParams.ref = item.source.ref
    if (item.source.path) ghParams.path = item.source.path
    return this.installFromGithub(ghParams)
  }

  /**
   * 卸载内置可安装技能目录中的一项（按 slug）。
   * 删除磁盘目录与 DB 记录。仅对「从目录安装」的技能生效，不动内置技能。
   */
  uninstallFromCatalog(slug: string): boolean {
    const item = getInstallableSkillBySlug(slug)
    if (!item) return false
    const match = this.findCatalogInstalledRow(item, this.skillRepo.list())
    if (!match) return false
    // 删除磁盘目录
    if (match.root_path && existsSync(match.root_path)) {
      try {
        rmSync(match.root_path, { recursive: true, force: true })
      } catch {
        // 删除失败不阻断 DB 清理
      }
    }
    return this.skillRepo.deleteById(match.id)
  }

  /** tarball 整库安装路径：下载 → 解压 → 取子目录 → 落盘 → 建/更新 DB 记录。 */
  private async installCatalogTarball(
    item: InstallableSkillCatalogItem,
    token: string | undefined,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<SkillItem> {
    const params: TarballInstallParams = {
      repo: item.source.repo,
      destDirName: item.slug,
      userSkillsDir: this.userSkillsDir!,
    }
    if (item.source.ref) params.ref = item.source.ref
    if (item.source.path) params.path = item.source.path
    if (token) params.token = token
    if (onProgress) params.onProgress = onProgress
    const { destPath, skillMd } = await installFromGithubTarball(params)
    const meta = parseSkillFrontmatter(skillMd)
    const skillName = meta.name || item.name
    const fp = tarballSourceFingerprint(item.source.repo, item.source.path)

    // dedupe by rootPath；id 用稳定的来源指纹，避免重复安装产生多行
    const existing = this.skillRepo.list().find((s) => s.root_path === destPath)
    const id = existing?.id ?? `skill:catalog:${fp}`
    const manifestJson = JSON.stringify({
      desc: meta.description || item.description,
      description: meta.description || item.description,
      source: `Catalog:${item.source.repo}`,
      author: meta.author || item.author,
      category: meta.category || 'utility',
      tags: meta.tags?.length ? meta.tags : item.tags,
      systemPrompt: stripSkillFrontmatter(skillMd).trim(),
      homepage: item.homepageUrl ?? `https://github.com/${item.source.repo}`,
    })
    if (existing) {
      const row = this.skillRepo.update(existing.id, {
        name: skillName,
        version: meta.version || '0.0.0',
        rootPath: destPath,
        manifestJson,
      })
      return toSkillItem(row!)
    }
    const row = this.skillRepo.create({
      id,
      scope: 'user',
      name: skillName,
      version: meta.version || '0.0.0',
      rootPath: destPath,
      manifestJson,
      enabled: true,
    })
    return toSkillItem(row)
  }

  // ─── GitHub 安装 ────────────────────────────────────────────────────

  /**
   * 在 GitHub 上搜索技能仓库（含 SKILL.md 的项目）。
   * 无 token 时走匿名接口（限速 60/h），有 token 走 settings.github.token。
   */
  async searchGithub(query: string, limit = 8): Promise<GithubSkillCandidate[]> {
    const q = `${query} skill SKILL.md`.trim()
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${Math.min(Math.max(limit, 1), 20)}`
    const res = await fetch(url, { headers: this.githubHeaders(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`GitHub search failed: ${res.status} ${res.statusText}`)
    const data = (await res.json()) as { items?: GithubRepoApi[] }
    return (data.items ?? []).map((r) => ({
      repo: r.full_name,
      name: r.name,
      description: r.description ?? '',
      author: r.owner?.login ?? '',
      stars: r.stargazers_count ?? 0,
      homepageUrl: r.html_url,
      defaultBranch: r.default_branch ?? 'main',
      source: 'GitHub',
    }))
  }

  /**
   * 从 GitHub 安装技能：定位含 SKILL.md 的目录并把该目录子树落盘到 userSkillsDir。
   *
   * @param params.repo 形如 "owner/name"
   * @param params.ref  分支/标签/commit（缺省取默认分支）
   * @param params.path 仓库内技能目录（缺省为根；多技能仓库可指定如 "skills/pdf"）
   */
  async installFromGithub(params: { repo: string; ref?: string; path?: string }): Promise<SkillItem> {
    if (!this.userSkillsDir) throw new Error('User skills directory not configured; cannot install')
    const repo = params.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim()
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Invalid repo "${params.repo}"; expected "owner/name"`)

    const ref = params.ref?.trim() || (await this.fetchDefaultBranch(repo))
    const basePath = (params.path ?? '').replace(/^\/+|\/+$/g, '')

    // 收集技能目录下的所有文件（含子目录），带文件数/大小上限
    const files = await this.collectGithubFiles(repo, ref, basePath)
    const skillFile = files.find((f) => /(^|\/)SKILL\.md$/i.test(f.relPath))
    if (!skillFile) {
      throw new Error(`No SKILL.md found under ${repo}${basePath ? '/' + basePath : ''}@${ref}`)
    }
    // 技能根 = SKILL.md 所在目录（去掉文件名）
    const skillRootRel = skillFile.relPath.includes('/')
      ? skillFile.relPath.slice(0, skillFile.relPath.lastIndexOf('/'))
      : ''
    const skillFiles = files.filter((f) => f.relPath === skillRootRel || f.relPath.startsWith(skillRootRel ? skillRootRel + '/' : ''))

    // 解析 SKILL.md 元数据
    const skillMdRes = await fetch(skillFile.downloadUrl, { headers: this.githubHeaders(), signal: AbortSignal.timeout(15000) })
    if (!skillMdRes.ok) throw new Error(`Failed to fetch SKILL.md: ${skillMdRes.status}`)
    const skillMd = await skillMdRes.text()
    const meta = parseSkillFrontmatter(skillMd)
    const skillName = meta.name || repo.split('/')[1] || 'github-skill'

    // 落盘
    const dirName = slugifySkillName(skillName)
    const dest = join(this.userSkillsDir, dirName)
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    for (const f of skillFiles) {
      const rel = skillRootRel ? f.relPath.slice(skillRootRel.length + 1) : f.relPath
      const target = join(dest, rel)
      mkdirSync(join(target, '..'), { recursive: true })
      const buf = await this.downloadGithubFile(f.downloadUrl)
      writeFileSync(target, buf)
    }

    // 创建 DB 记录（dedupe by rootPath）
    const existing = this.skillRepo.list().find((s) => s.root_path === dest)
    const id = existing?.id ?? `skill:github:${crypto.createHash('sha1').update(repo + '/' + basePath).digest('hex').slice(0, 12)}`
    const manifestJson = JSON.stringify({
      desc: meta.description || `从 GitHub ${repo} 安装`,
      description: meta.description || `从 GitHub ${repo} 安装`,
      source: `GitHub:${repo}`,
      author: meta.author || repo.split('/')[0],
      category: meta.category || 'utility',
      tags: meta.tags,
      systemPrompt: stripSkillFrontmatter(skillMd).trim(),
      homepage: `https://github.com/${repo}`,
    })
    if (existing) {
      const row = this.skillRepo.update(existing.id, {
        name: skillName,
        version: meta.version || '0.0.0',
        rootPath: dest,
        manifestJson,
      })
      return toSkillItem(row!)
    }
    const row = this.skillRepo.create({
      id,
      scope: 'user',
      name: skillName,
      version: meta.version || '0.0.0',
      rootPath: dest,
      manifestJson,
      enabled: true,
    })
    return toSkillItem(row)
  }

  // ─── GitHub helpers ─────────────────────────────────────────────────

  private githubHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Spark-Agent',
    }
    const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (envToken) headers.Authorization = `Bearer ${envToken}`
    return headers
  }

  private async fetchDefaultBranch(repo: string): Promise<string> {
    const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: this.githubHeaders(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`Failed to resolve repo ${repo}: ${res.status}`)
    const data = (await res.json()) as { default_branch?: string }
    return data.default_branch || 'main'
  }

  /** 递归收集目录文件（限 60 个文件，单文件 ≤1MB） */
  private async collectGithubFiles(
    repo: string,
    ref: string,
    path: string,
    acc: GithubFile[] = [],
    depth = 0,
  ): Promise<GithubFile[]> {
    if (depth > 6 || acc.length >= 60) return acc
    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`
    const res = await fetch(url, { headers: this.githubHeaders(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`Failed to list ${repo}/${path}: ${res.status}`)
    const data = await res.json()
    const entries: GithubContentApi[] = Array.isArray(data) ? data : [data]
    for (const entry of entries) {
      if (acc.length >= 60) break
      if (entry.type === 'file' && entry.download_url && (entry.size ?? 0) <= 1_000_000) {
        acc.push({ relPath: entry.path, downloadUrl: entry.download_url })
      } else if (entry.type === 'dir') {
        await this.collectGithubFiles(repo, ref, entry.path, acc, depth + 1)
      }
    }
    return acc
  }

  private async downloadGithubFile(downloadUrl: string): Promise<Buffer> {
    const res = await fetch(downloadUrl, { headers: this.githubHeaders(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`Failed to download ${downloadUrl}: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * 把远程技能写到真实磁盘目录：`<userSkillsDir>/<safeName>/{SKILL.md,manifest.json}`。
   * 成功返回真实目录路径；未配置目录或写入失败时返回 null（调用方回落到虚拟路径）。
   */
  private materializeSkill(
    name: string,
    body: string,
    remoteSkill: RemoteSkillItem,
    manifest: Record<string, unknown> | null,
  ): string | null {
    if (!this.userSkillsDir) return null
    const dirName = slugifySkillName(name)
    if (!dirName) return null
    const dest = join(this.userSkillsDir, dirName)
    try {
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
      mkdirSync(dest, { recursive: true })
      writeFileSync(join(dest, 'SKILL.md'), buildSkillMarkdown(name, body, remoteSkill), 'utf-8')
      // 保留来源 manifest，便于后续追溯/重装
      const manifestOut = {
        ...(manifest ?? {}),
        name,
        version: remoteSkill.version,
        category: remoteSkill.category,
        tags: remoteSkill.tags,
        author: remoteSkill.author,
        source: remoteSkill.registryName,
      }
      writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifestOut, null, 2), 'utf-8')
      return dest
    } catch {
      return null
    }
  }

  private getAdapterOrThrow(registryId: string): SkillRegistryAdapter {
    const adapter = this.adapters.get(registryId)
    if (!adapter) throw new Error(`Registry not available: ${registryId}`)
    return adapter
  }

  private createAdapter(config: SkillRegistryAdapterConfig): SkillRegistryAdapter {
    // 根据 registryId 分发到对应 Adapter
    switch (config.registryId) {
      case 'skillhub':
        return new SkillHubAdapter(config)
      case 'skillsmp':
        return new SkillsMPAdapter(config)
      default:
        // 未实现的 registry 类型使用 Mock Adapter
        return new MockSkillRegistryAdapter(config)
    }
  }

  private buildInstalledMap(): Map<string, string> {
    const map = new Map<string, string>() // remoteId → localId
    for (const row of this.skillRepo.list()) {
      if (row.remote_id) {
        // key 用 registry_id:remote_id 组合
        const key = `${row.registry_id}:${row.remote_id}`
        map.set(key, row.id)
      }
    }
    return map
  }

  private enrichWithInstallStatus(skill: RemoteSkillItem, installedMap: Map<string, string>): RemoteSkillItem {
    // remote skill 的 id 格式是 "registryId:xxx"
    const localId = installedMap.get(skill.id)
    const enriched: RemoteSkillItem = {
      ...skill,
      installed: localId != null,
    }
    if (localId !== undefined) enriched.localId = localId
    return enriched
  }
}

// ─── Row → Protocol Type Mappers ──────────────────────────────────────

function toSkillRegistry(row: {
  id: string
  name: string
  description: string
  icon_url: string | null
  api_base_url: string
  enabled: number
  type: string
  local_path: string | null
  last_sync_at: string | null
  created_at: string
  updated_at: string
}): SkillRegistry {
  const registry: SkillRegistry = {
    id: row.id,
    name: row.name,
    description: row.description,
    apiBaseUrl: row.api_base_url,
    enabled: row.enabled === 1,
    type: row.type as 'remote' | 'local',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.icon_url !== null) registry.iconUrl = row.icon_url
  if (row.local_path !== null) registry.localPath = row.local_path
  if (row.last_sync_at !== null) registry.lastSyncAt = row.last_sync_at
  return registry
}

function toSkillItem(row: {
  id: string
  scope: string
  name: string
  version: string
  root_path: string
  manifest_json: string
  enabled: number
  created_at: string
  updated_at: string
}): SkillItem {
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    version: row.version,
    rootPath: row.root_path,
    manifestJson: row.manifest_json,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 从市场 manifest 中提取 SKILL.md 正文（不同市场字段不一，做多重兜底） */
function extractSkillBody(manifest: Record<string, unknown> | null, remoteSkill: RemoteSkillItem): string {
  const m = manifest ?? {}
  const candidate =
    (typeof m.content === 'string' && m.content) ||
    (typeof m.systemPrompt === 'string' && m.systemPrompt) ||
    (typeof m.body === 'string' && m.body) ||
    (typeof m.instructions === 'string' && m.instructions) ||
    ''
  const body = candidate.trim()
  if (body.length > 0) return body
  // 实在没有正文时，用描述兜底生成一个最小可用指令
  return remoteSkill.description?.trim() || remoteSkill.name
}

/** 构建带 frontmatter 的 SKILL.md 文本 */
function buildSkillMarkdown(name: string, body: string, remoteSkill: RemoteSkillItem): string {
  // 若 body 本身已是带 frontmatter 的完整 SKILL.md，直接返回
  if (body.startsWith('---')) return body
  const description = (remoteSkill.description ?? '').replace(/\n/g, ' ').trim()
  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: "${description.replace(/"/g, "'")}"`,
    `version: ${remoteSkill.version || '0.0.0'}`,
    `author: ${remoteSkill.author || 'Unknown'}`,
    `category: ${remoteSkill.category || 'utility'}`,
    `tags: [${(remoteSkill.tags ?? []).join(', ')}]`,
    '---',
    '',
  ].join('\n')
  return frontmatter + body + '\n'
}

/** 技能名 → 安全目录名 */
function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// ─── GitHub 安装相关类型与解析 ─────────────────────────────────────────

export interface GithubSkillCandidate {
  repo: string
  name: string
  description: string
  author: string
  stars: number
  homepageUrl: string
  defaultBranch: string
  source: 'GitHub'
}

interface GithubRepoApi {
  full_name: string
  name: string
  description: string | null
  owner?: { login?: string }
  stargazers_count?: number
  html_url: string
  default_branch?: string
}

interface GithubContentApi {
  type: 'file' | 'dir' | string
  path: string
  size?: number
  download_url?: string | null
}

interface GithubFile {
  relPath: string
  downloadUrl: string
}

function stripSkillFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return raw
  return raw.slice(end + 4)
}

function parseSkillFrontmatter(raw: string): {
  name: string
  description: string
  version: string
  author: string
  category: string
  tags: string[]
} {
  const result = { name: '', description: '', version: '', author: '', category: '', tags: [] as string[] }
  if (!raw.startsWith('---')) return result
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return result
  const fm = raw.slice(3, end)
  for (const line of fm.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]!.toLowerCase()
    const value = match[2]!.trim().replace(/^['"]|['"]$/g, '')
    if (key === 'name') result.name = value
    else if (key === 'description') result.description = value
    else if (key === 'version') result.version = value
    else if (key === 'author') result.author = value
    else if (key === 'category') result.category = value
    else if (key === 'tags') {
      result.tags = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    }
  }
  return result
}
