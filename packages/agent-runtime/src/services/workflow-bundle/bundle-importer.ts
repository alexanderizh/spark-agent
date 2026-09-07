/**
 * 工作流包导入 — 解压校验 → 依赖预览 → 隔离落位(bundle: 前缀技能 / bundle_id 标记 / MCP 默认禁用)
 */

import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import {
  BUNDLE_SKILL_ID_PREFIX,
  WorkflowBundleChecksumsSchema,
  WorkflowBundleManifestSchema,
  WorkflowBundleWorkflowFileSchema,
  type WorkflowBundleChecksums,
  type WorkflowBundleImportOptions,
  type WorkflowBundleImportPreview,
  type WorkflowBundleImportResult,
  type WorkflowBundleManifest,
} from '@spark/protocol'
import type { WorkflowGraph } from '@spark/protocol'
import type {
  McpServerRepository,
  SkillRepository,
  WorkflowBundleRepository,
  WorkflowRepository,
} from '@spark/storage'
import { rewriteGraphReferences, type RewriteMapping } from './graph-deps.js'
import { sha256Hex, unzipBundle } from './bundle-fs.js'

const DEFAULT_IMPORT_OPTIONS: WorkflowBundleImportOptions = {
  installSkills: true,
  importMcpServers: true,
  reinstall: false,
  scope: undefined,
}

export interface ReadBundleResult {
  manifest: WorkflowBundleManifest
  checksums: WorkflowBundleChecksums | null
  files: Map<string, Uint8Array>
  integrityOk: boolean
  integrityErrors: string[]
}

export class WorkflowBundleImporter {
  constructor(
    private readonly workflowRepo: WorkflowRepository,
    private readonly skillRepo: SkillRepository,
    private readonly mcpRepo: McpServerRepository,
    private readonly bundleRepo: WorkflowBundleRepository,
    private readonly userSkillsDir: string,
  ) {}

  /** 解压 + manifest/checksums 双校验。结构坏包直接抛错;校验失败走 integrityErrors。 */
  async readBundle(filePath: string): Promise<ReadBundleResult> {
    const raw = await readFile(filePath)
    const files = unzipBundle(new Uint8Array(raw))
    const integrityErrors: string[] = []

    const manifestBytes = files.get('manifest.json')
    if (manifestBytes == null)
      throw new Error('包内缺少 manifest.json,不是有效的 .sparkflow 工作流包')
    const manifestParsed = WorkflowBundleManifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(manifestBytes)),
    )
    if (!manifestParsed.success) {
      throw new Error(
        `manifest.json 结构无效: ${manifestParsed.error.issues[0]?.message ?? '未知错误'}`,
      )
    }
    const manifest = manifestParsed.data

    let checksums: WorkflowBundleChecksums | null = null
    const checksumBytes = files.get('checksums.json')
    if (checksumBytes != null) {
      const parsed = WorkflowBundleChecksumsSchema.safeParse(
        JSON.parse(new TextDecoder().decode(checksumBytes)),
      )
      if (parsed.success) checksums = parsed.data
      else integrityErrors.push('checksums.json 结构无效,跳过完整性校验')
    } else {
      integrityErrors.push('缺少 checksums.json,跳过完整性校验')
    }

    if (checksums != null) {
      for (const [path, expected] of Object.entries(checksums.files)) {
        const content = files.get(path)
        if (content == null) {
          integrityErrors.push(`包内缺失文件: ${path}`)
          continue
        }
        if (sha256Hex(content) !== expected) {
          integrityErrors.push(`文件校验和不匹配(可能被篡改): ${path}`)
        }
      }
      for (const path of files.keys()) {
        if (path === 'checksums.json') continue
        if (!(path in checksums.files)) integrityErrors.push(`包内存在未登记文件: ${path}`)
      }
    }

    return {
      manifest,
      checksums,
      files,
      integrityOk: integrityErrors.length === 0,
      integrityErrors,
    }
  }

  /** 依赖预览:不写库,只给出将发生的变更。 */
  async previewImport(filePath: string): Promise<WorkflowBundleImportPreview> {
    const { manifest, integrityOk, integrityErrors } = await this.readBundle(filePath)
    const bundleId = newBundleId()
    const existingSkillNames = new Set(this.skillRepo.list().map((row) => row.name))
    const existingMcpNames = new Set(this.mcpRepo.listAll().map((row) => row.name))
    return {
      bundleId,
      manifest,
      workflows: manifest.workflows,
      skills: manifest.skills.map((entry) => ({
        slug: entry.slug,
        bundleSkillId: bundleSkillId(bundleId, entry.slug),
        nameConflict: existingSkillNames.has(entryNameFromSlug(entry.slug)),
      })),
      mcpServers: manifest.mcpServers.map((entry) => ({
        refId: entry.refId,
        name: entry.name,
        transport: entry.transport,
        requiredSecrets: entry.requiredSecrets,
        nameConflict: existingMcpNames.has(entry.name),
      })),
      unresolved: manifest.unresolved,
      integrityOk,
      integrityErrors,
    }
  }

  /** 落地导入:技能解包 + DB 行 + 图引用改写 + 包登记。 */
  async importBundle(
    filePath: string,
    options?: Partial<WorkflowBundleImportOptions>,
  ): Promise<WorkflowBundleImportResult> {
    const opts = { ...DEFAULT_IMPORT_OPTIONS, ...options }
    const { manifest, files, integrityOk, integrityErrors } = await this.readBundle(filePath)
    if (!integrityOk) {
      throw new Error(`包完整性校验未通过,已拒绝导入: ${integrityErrors[0] ?? '未知错误'}`)
    }
    const bundleId = newBundleId()
    const skillIdMap = new Map<string, string>()
    const mcpServerIdMap = new Map<string, string>()
    const installedSkillIds: string[] = []
    const importedMcpServerIds: string[] = []

    // —— 技能:解包到 _bundles/<bundleId>/<slug>/,DB 行 id = bundle:<bundleId>:<slug> ——
    if (opts.installSkills) {
      for (const entry of manifest.skills) {
        const targetDir = join(this.userSkillsDir, '_bundles', bundleId, entry.slug)
        let manifestJson = '{}'
        for (const [path, content] of files.entries()) {
          if (!path.startsWith(`${entry.path}/`)) continue
          const rel = path.slice(entry.path.length + 1)
          const abs = join(targetDir, rel)
          if (rel === '.spark-skill-manifest.json') {
            manifestJson = new TextDecoder().decode(content)
            continue
          }
          await mkdir(dirname(abs), { recursive: true })
          await writeFile(abs, content)
        }
        const newId = bundleSkillId(bundleId, entry.slug)
        const existing = this.skillRepo.get(newId)
        if (existing != null) {
          this.skillRepo.update(newId, { rootPath: targetDir, manifestJson, enabled: true })
        } else {
          this.skillRepo.create({
            id: newId,
            scope: 'user',
            name: entryNameFromSlug(entry.slug),
            version: '1.0.0',
            rootPath: targetDir,
            manifestJson,
            enabled: true,
          })
        }
        installedSkillIds.push(newId)
        if (entry.originSkillId != null) skillIdMap.set(entry.originSkillId, newId)
      }
    }

    // —— MCP:写 DB(enabled=0,bundle_id 标记),config 保留占位符待激活补密钥 ——
    if (opts.importMcpServers) {
      for (const entry of manifest.mcpServers) {
        const configBytes = files.get(entry.file)
        let configJson = '{}'
        if (configBytes != null) {
          // 结构宽松校验:必须是 JSON 对象
          const parsed: unknown = JSON.parse(new TextDecoder().decode(configBytes))
          if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            configJson = JSON.stringify(parsed)
          }
        }
        const row = this.mcpRepo.create({
          scope: 'user',
          name: entry.name,
          configJson,
          enabled: false,
          bundleId,
        })
        importedMcpServerIds.push(row.id)
        if (entry.originServerId != null) mcpServerIdMap.set(entry.originServerId, row.id)
      }
    }

    // —— 工作流:图引用改写(bundle 技能/MCP 新 ID)后落库 ——
    const workflowIds: string[] = []
    for (const entry of manifest.workflows) {
      const fileBytes = files.get(entry.file)
      if (fileBytes == null) throw new Error(`包内缺失工作流文件: ${entry.file}`)
      const parsed = WorkflowBundleWorkflowFileSchema.safeParse(
        JSON.parse(new TextDecoder().decode(fileBytes)),
      )
      if (!parsed.success) {
        throw new Error(
          `工作流文件结构无效(${entry.file}): ${parsed.error.issues[0]?.message ?? '未知错误'}`,
        )
      }
      const workflowFile = parsed.data
      const graph = rewriteGraphReferences(workflowFile.graph as unknown as WorkflowGraph, {
        skillIdMap,
        mcpServerIdMap,
      } satisfies RewriteMapping)
      const created = this.workflowRepo.create({
        name: workflowFile.name || entry.name,
        description: workflowFile.description,
        status: workflowFile.status,
        tags: workflowFile.tags,
        graph: graph as unknown as Record<string, unknown>,
        bundleId,
        ...(opts.scope != null ? { scope: opts.scope } : {}),
      })
      workflowIds.push(created.id)
    }

    // —— 包登记 ——
    this.bundleRepo.create({
      id: bundleId,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author ?? null,
      description: manifest.description ?? null,
      manifestJson: JSON.stringify(manifest),
      source: filePath,
      verificationStatus: 'unverified',
    })

    return {
      bundleId,
      workflowIds,
      installedSkillIds,
      importedMcpServerIds,
      unresolved: manifest.unresolved,
    }
  }

  /** 卸载整包:工作流 + MCP + bundle 技能行 + 技能目录 + 包登记,零残留。 */
  async uninstallBundle(bundleId: string): Promise<boolean> {
    const row = this.bundleRepo.get(bundleId)
    if (row == null) return false

    // 包内工作流
    for (const workflow of this.workflowRepo.list({ includeArchived: true })) {
      if (workflow.bundleId === bundleId) this.workflowRepo.delete(workflow.id)
    }
    // 包内 MCP
    for (const server of this.mcpRepo.findByBundleId(bundleId)) {
      this.mcpRepo.deleteById(server.id)
    }
    // bundle 技能行 + 目录
    const prefix = `${BUNDLE_SKILL_ID_PREFIX}${bundleId}:`
    for (const skill of this.skillRepo.list()) {
      if (skill.id.startsWith(prefix)) {
        this.skillRepo.deleteById(skill.id)
      }
    }
    await rm(join(this.userSkillsDir, '_bundles', bundleId), { recursive: true, force: true })
    // 包登记
    this.bundleRepo.delete(bundleId)
    return true
  }
}

function newBundleId(): string {
  return `wfb-${randomUUID()}`
}

function bundleSkillId(bundleId: string, slug: string): string {
  return `${BUNDLE_SKILL_ID_PREFIX}${bundleId}:${slug}`
}

/** 从 slug 还原可读名(导入落库用;slug 是导出时从原 name 安全化来的)。 */
function entryNameFromSlug(slug: string): string {
  return slug
}
