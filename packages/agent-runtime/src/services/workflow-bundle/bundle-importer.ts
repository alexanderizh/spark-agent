/**
 * 工作流包导入 — 解压校验 → 依赖预览 → 隔离落位(bundle: 前缀技能 / bundle_id 标记 / MCP 默认禁用)
 */

import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import {
  BUNDLE_SKILL_ID_PREFIX,
  BUNDLE_SKILLS_DIR_NAME,
  WorkflowBundleChecksumsSchema,
  WorkflowBundleManifestSchema,
  WorkflowBundleWorkflowFileSchema,
  type WorkflowBundleChecksums,
  type WorkflowBundleImportOptions,
  type WorkflowBundleImportPreview,
  type WorkflowBundleImportResult,
  type WorkflowBundleManifest,
  type WorkflowBundleWorkflowFile,
} from '@spark/protocol'
import type { WorkflowGraph } from '@spark/protocol'
import type {
  McpServerRepository,
  SkillRepository,
  WorkflowBundleRepository,
  WorkflowRepository,
} from '@spark/storage'
import { rewriteGraphReferences, type RewriteMapping } from './graph-deps.js'
import { hashDirectoryEntries, sha256Hex, unzipBundle } from './bundle-fs.js'
import {
  detectWorkflowConditionReferenceErrors,
  detectWorkflowGraphCycles,
  formatWorkflowConditionReferenceError,
  formatWorkflowCycleError,
  normalizeWorkflowGraph,
} from '../workflow-executor.js'

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

interface PreparedSkill {
  entry: WorkflowBundleManifest['skills'][number]
  files: Map<string, Uint8Array>
  manifestJson: string
}

interface PreparedMcpServer {
  entry: WorkflowBundleManifest['mcpServers'][number]
  configJson: string
}

interface PreparedWorkflow {
  entry: WorkflowBundleManifest['workflows'][number]
  file: WorkflowBundleWorkflowFile
}

interface PreparedBundleContents {
  workflows: PreparedWorkflow[]
  skills: PreparedSkill[]
  mcpServers: PreparedMcpServer[]
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
      parseJson(manifestBytes, 'manifest.json'),
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
      let checksumValue: unknown
      try {
        checksumValue = parseJson(checksumBytes, 'checksums.json')
      } catch {
        checksumValue = undefined
      }
      const parsed = WorkflowBundleChecksumsSchema.safeParse(checksumValue)
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
    const bundle = await this.readBundle(filePath)
    const contentErrors = this.getContentErrors(bundle.manifest, bundle.files)
    const bundleId = newBundleId()
    const existingSkillNames = new Set(this.skillRepo.list().map((row) => row.name))
    const existingMcpNames = new Set(this.mcpRepo.listAll().map((row) => row.name))
    const integrityErrors = [...bundle.integrityErrors, ...contentErrors].slice(0, 100)
    return {
      bundleId,
      manifest: bundle.manifest,
      workflows: bundle.manifest.workflows,
      skills: bundle.manifest.skills.map((entry) => ({
        slug: entry.slug,
        bundleSkillId: bundleSkillId(bundleId, entry.slug),
        nameConflict: existingSkillNames.has(entryNameFromSlug(entry.slug)),
      })),
      mcpServers: bundle.manifest.mcpServers.map((entry) => ({
        refId: entry.refId,
        name: entry.name,
        transport: entry.transport,
        requiredSecrets: entry.requiredSecrets,
        nameConflict: existingMcpNames.has(entry.name),
      })),
      unresolved: bundle.manifest.unresolved,
      integrityOk: bundle.integrityOk && integrityErrors.length === 0,
      integrityErrors,
    }
  }

  /** 落地导入:先完整解析内容,再写文件/数据库;失败时回滚已写入的资源。 */
  async importBundle(
    filePath: string,
    options?: Partial<WorkflowBundleImportOptions>,
  ): Promise<WorkflowBundleImportResult> {
    const opts = { ...DEFAULT_IMPORT_OPTIONS, ...options }
    const bundle = await this.readBundle(filePath)
    if (!bundle.integrityOk) {
      throw new Error(`包完整性校验未通过,已拒绝导入: ${bundle.integrityErrors[0] ?? '未知错误'}`)
    }
    const prepared = this.prepareContents(bundle.manifest, bundle.files)
    const bundleId = newBundleId()
    const skillIdMap = new Map<string, string>()
    const mcpServerIdMap = new Map<string, string>()
    const installedSkillIds: string[] = []
    const importedMcpServerIds: string[] = []
    const workflowIds: string[] = []

    try {
      // —— 技能:解包到 _bundles/<bundleId>/<slug>/,DB 行 id = bundle:<bundleId>:<slug> ——
      if (opts.installSkills) {
        for (const { entry, files: skillFiles, manifestJson } of prepared.skills) {
          const targetDir = join(this.userSkillsDir, BUNDLE_SKILLS_DIR_NAME, bundleId, entry.slug)
          for (const [rel, content] of skillFiles) {
            const abs = join(targetDir, rel)
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
        for (const { entry, configJson } of prepared.mcpServers) {
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
      for (const { entry, file: workflowFile } of prepared.workflows) {
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
          scope: opts.scope?.trim() || 'user',
        })
        workflowIds.push(created.id)
      }

      // —— 包登记 ——
      this.bundleRepo.create({
        id: bundleId,
        name: bundle.manifest.name,
        version: bundle.manifest.version,
        author: bundle.manifest.author ?? null,
        description: bundle.manifest.description ?? null,
        manifestJson: JSON.stringify(bundle.manifest),
        source: filePath,
        verificationStatus: 'unverified',
      })

      return {
        bundleId,
        workflowIds,
        installedSkillIds,
        importedMcpServerIds,
        unresolved: bundle.manifest.unresolved,
      }
    } catch (err) {
      for (const id of workflowIds) this.workflowRepo.delete(id)
      for (const id of importedMcpServerIds) this.mcpRepo.deleteById(id)
      for (const id of installedSkillIds) this.skillRepo.deleteById(id)
      await rm(join(this.userSkillsDir, BUNDLE_SKILLS_DIR_NAME, bundleId), {
        recursive: true,
        force: true,
      })
      this.bundleRepo.delete(bundleId)
      throw err
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
      if (skill.id.startsWith(prefix)) this.skillRepo.deleteById(skill.id)
    }
    await rm(join(this.userSkillsDir, BUNDLE_SKILLS_DIR_NAME, bundleId), {
      recursive: true,
      force: true,
    })
    // 包登记
    this.bundleRepo.delete(bundleId)
    return true
  }

  private getContentErrors(
    manifest: WorkflowBundleManifest,
    files: Map<string, Uint8Array>,
  ): string[] {
    try {
      this.prepareContents(manifest, files)
      return []
    } catch (err) {
      return [err instanceof Error ? err.message : String(err)]
    }
  }

  private prepareContents(
    manifest: WorkflowBundleManifest,
    files: Map<string, Uint8Array>,
  ): PreparedBundleContents {
    assertUnique(
      manifest.workflows.map((entry) => entry.file),
      '工作流文件路径',
    )
    assertUnique(
      manifest.skills.map((entry) => entry.slug),
      '技能 slug',
    )
    assertUnique(
      manifest.skills.map((entry) => entry.path),
      '技能目录路径',
    )
    assertUnique(
      manifest.mcpServers.map((entry) => entry.refId),
      'MCP refId',
    )
    assertUnique(
      manifest.mcpServers.map((entry) => entry.file),
      'MCP 配置文件路径',
    )

    const workflows = manifest.workflows.map((entry) => {
      requirePathPrefix(entry.file, 'workflows/', `工作流文件 ${entry.file}`)
      const fileBytes = requireFile(files, entry.file)
      const parsed = WorkflowBundleWorkflowFileSchema.safeParse(parseJson(fileBytes, entry.file))
      if (!parsed.success) {
        throw new Error(
          `工作流文件结构无效(${entry.file}): ${parsed.error.issues[0]?.message ?? '未知错误'}`,
        )
      }
      const graph = parsed.data.graph as unknown as WorkflowGraph
      validateGraphEntries(graph, entry.file)
      const normalized = normalizeWorkflowGraph(graph)
      const cycles = detectWorkflowGraphCycles(normalized)
      if (cycles.length > 0) throw new Error(formatWorkflowCycleError(cycles))
      const references = detectWorkflowConditionReferenceErrors(normalized)
      if (references.length > 0) throw new Error(formatWorkflowConditionReferenceError(references))
      return { entry, file: parsed.data }
    })

    const skills = manifest.skills.map((entry) => {
      if (entry.path !== `skills/${entry.slug}`) {
        throw new Error(`技能目录路径与 slug 不匹配: ${entry.path}`)
      }
      const prefix = `${entry.path}/`
      const skillFiles = new Map<string, Uint8Array>()
      for (const [path, content] of files) {
        if (path.startsWith(prefix)) skillFiles.set(path.slice(prefix.length), content)
      }
      if (!skillFiles.has('SKILL.md')) {
        throw new Error(`技能 ${entry.slug} 缺少 SKILL.md`)
      }
      if (hashDirectoryEntries(skillFiles) !== entry.sha256) {
        throw new Error(`技能 ${entry.slug} 的目录校验和不匹配`)
      }
      let manifestJson = '{}'
      const manifestBytes = skillFiles.get('.spark-skill-manifest.json')
      if (manifestBytes != null) {
        const manifestValue = parseJson(manifestBytes, `${entry.path}/.spark-skill-manifest.json`)
        if (!isJsonObject(manifestValue)) {
          throw new Error(`技能 ${entry.slug} 的 manifest 必须是 JSON 对象`)
        }
        manifestJson = new TextDecoder().decode(manifestBytes)
      }
      return { entry, files: skillFiles, manifestJson }
    })

    const mcpServers = manifest.mcpServers.map((entry) => {
      requirePathPrefix(entry.file, 'mcp/', `MCP 配置文件 ${entry.file}`)
      const configValue = parseJson(requireFile(files, entry.file), entry.file)
      if (!isJsonObject(configValue)) throw new Error(`MCP 配置必须是 JSON 对象: ${entry.file}`)
      return { entry, configJson: JSON.stringify(configValue) }
    })

    return { workflows, skills, mcpServers }
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

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (err) {
    throw new Error(`${label} 不是有效 JSON`, { cause: err })
  }
}

function requireFile(files: Map<string, Uint8Array>, path: string): Uint8Array {
  const content = files.get(path)
  if (content == null) throw new Error(`包内缺失文件: ${path}`)
  return content
}

function requirePathPrefix(path: string, prefix: string, label: string): void {
  if (!path.startsWith(prefix) || path.length === prefix.length) {
    throw new Error(`${label}必须位于 ${prefix} 目录下`)
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label}重复: ${value}`)
    seen.add(value)
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function validateGraphEntries(graph: WorkflowGraph, label: string): void {
  if (
    graph.nodes.some(
      (node) => !isJsonObject(node) || typeof node.id !== 'string' || node.id.trim().length === 0,
    )
  ) {
    throw new Error(`工作流文件结构无效(${label}): nodes 中存在无效节点`)
  }
  if (
    graph.edges.some(
      (edge) =>
        !isJsonObject(edge) ||
        typeof edge.from !== 'string' ||
        typeof edge.to !== 'string' ||
        edge.from.trim().length === 0 ||
        edge.to.trim().length === 0,
    )
  ) {
    throw new Error(`工作流文件结构无效(${label}): edges 中存在无效连线`)
  }
}
