/**
 * WorkflowBundleService — 工作流包导入导出门面
 *
 * 隔离约定:bundle 技能 ID 以 `bundle:` 为前缀,运行时全量回落(runtime-composition)
 * 已排除该前缀;包内 MCP 导入后 enabled=0,激活是显式动作(activateMcp)。
 */

import type { WorkflowBundleRecord, WorkflowBundleVerificationStatus } from '@spark/protocol'
import type { WorkflowBundleImportOptions } from '@spark/protocol'
import type {
  McpServerRepository,
  SkillRepository,
  WorkflowBundleRepository,
  WorkflowRepository,
} from '@spark/storage'
import type { McpService } from '../mcp-server.service.js'
import {
  WorkflowBundleExporter,
  type ExportBundleParams,
  type ExportBundleResult,
} from './bundle-exporter.js'
import { WorkflowBundleImporter } from './bundle-importer.js'
import { WorkflowBundleValidator, type ValidateBundleResult } from './bundle-validator.js'
import { collectMissingSecretPaths } from './secret-redact.js'

export interface ActivateMcpResult {
  started: boolean
  missingSecrets: string[]
}

export class WorkflowBundleService {
  private readonly exporter: WorkflowBundleExporter
  private readonly importer: WorkflowBundleImporter
  private readonly validator: WorkflowBundleValidator

  constructor(
    private readonly workflowRepo: WorkflowRepository,
    private readonly skillRepo: SkillRepository,
    private readonly mcpRepo: McpServerRepository,
    private readonly bundleRepo: WorkflowBundleRepository,
    private readonly userSkillsDir: string,
    private readonly mcpService: McpService | null = null,
  ) {
    this.exporter = new WorkflowBundleExporter(workflowRepo, skillRepo, mcpRepo)
    this.importer = new WorkflowBundleImporter(
      workflowRepo,
      skillRepo,
      mcpRepo,
      bundleRepo,
      userSkillsDir,
    )
    this.validator = new WorkflowBundleValidator(
      workflowRepo,
      skillRepo,
      mcpRepo,
      bundleRepo,
      mcpService,
    )
  }

  listBundles(query?: string): WorkflowBundleRecord[] {
    const rows = this.bundleRepo.list()
    const filtered =
      query != null && query.trim().length > 0
        ? rows.filter((row) => {
            const q = query.trim().toLowerCase()
            return (
              row.name.toLowerCase().includes(q) ||
              (row.description ?? '').toLowerCase().includes(q)
            )
          })
        : rows
    return filtered.map((row) => this.toRecord(row))
  }

  exportBundle(params: ExportBundleParams): Promise<ExportBundleResult> {
    return this.exporter.exportBundle(params)
  }

  previewImport(filePath: string) {
    return this.importer.previewImport(filePath)
  }

  importBundle(filePath: string, options?: Partial<WorkflowBundleImportOptions>) {
    return this.importer.importBundle(filePath, options)
  }

  validateBundle(bundleId: string): Promise<ValidateBundleResult> {
    return this.validator.validateBundle(bundleId)
  }

  uninstallBundle(bundleId: string): Promise<boolean> {
    return this.importer.uninstallBundle(bundleId)
  }

  /**
   * 激活包内 MCP:占位符密钥未补齐时拒绝启动并返回缺失清单;
   * 补齐后置 enabled=1 并尝试启动。密钥补录走现有 mcp:update 通道。
   */
  async activateMcp(bundleId: string, mcpServerId: string): Promise<ActivateMcpResult> {
    const row = this.mcpRepo.get(mcpServerId)
    if (row == null) throw new Error(`MCP 配置不存在: ${mcpServerId}`)
    if (row.bundle_id !== bundleId) {
      throw new Error('该 MCP 配置不属于指定工作流包')
    }
    const missingSecrets = collectMissingSecretPaths(row.config_json)
    if (missingSecrets.length > 0) {
      return { started: false, missingSecrets }
    }
    this.mcpRepo.update(mcpServerId, { enabled: true })
    if (this.mcpService != null) {
      try {
        await this.mcpService.startServer(mcpServerId)
        return { started: true, missingSecrets: [] }
      } catch {
        // 启动失败不回滚启用态:配置已就绪,下次 startAllEnabled 会重试
        return { started: false, missingSecrets: [] }
      }
    }
    return { started: false, missingSecrets: [] }
  }

  private toRecord(row: {
    id: string
    name: string
    version: string
    author: string | null
    description: string | null
    manifest_json: string
    source: string | null
    verification_status: WorkflowBundleVerificationStatus
    created_at: string
    updated_at: string
  }): WorkflowBundleRecord {
    let manifest: ReturnType<typeof JSON.parse> | null
    try {
      manifest = JSON.parse(row.manifest_json) as ReturnType<typeof JSON.parse>
    } catch {
      manifest = null
    }
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      author: row.author,
      description: row.description,
      manifest,
      source: row.source,
      verificationStatus: row.verification_status,
      workflowCount: this.workflowRepo
        .list({ includeArchived: true })
        .filter((w) => w.bundleId === row.id).length,
      skillCount: this.skillRepo.list().filter((s) => s.id.startsWith(`bundle:${row.id}:`)).length,
      mcpServerCount: this.mcpRepo.findByBundleId(row.id).length,
      mcpServers: this.mcpRepo.findByBundleId(row.id).map((m) => ({
        id: m.id,
        name: m.name,
        enabled: m.enabled === 1,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export { WorkflowBundleExporter } from './bundle-exporter.js'
export { WorkflowBundleImporter } from './bundle-importer.js'
export { WorkflowBundleValidator } from './bundle-validator.js'
export type { ExportBundleParams, ExportBundleResult } from './bundle-exporter.js'
export type { ValidateBundleResult } from './bundle-validator.js'
