/**
 * 工作流包落地后复验 — 技能可加载 / MCP 可启动列出工具 / 流程图结构可执行
 */

import { access } from 'fs/promises'
import {
  BUNDLE_SKILL_ID_PREFIX,
  type WorkflowBundleManifest,
  type WorkflowBundleVerificationCheck,
  type WorkflowBundleVerificationStatus,
} from '@spark/protocol'
import type { WorkflowGraph } from '@spark/protocol'
import type {
  McpServerRepository,
  SkillRepository,
  WorkflowBundleRepository,
  WorkflowRepository,
} from '@spark/storage'
import type { McpService } from '../mcp-server.service.js'
import { collectGraphDependencies } from './graph-deps.js'

export interface ValidateBundleResult {
  bundleId: string
  status: WorkflowBundleVerificationStatus
  checks: WorkflowBundleVerificationCheck[]
}

export class WorkflowBundleValidator {
  constructor(
    private readonly workflowRepo: WorkflowRepository,
    private readonly skillRepo: SkillRepository,
    private readonly mcpRepo: McpServerRepository,
    private readonly bundleRepo: WorkflowBundleRepository,
    private readonly mcpService: McpService | null,
  ) {}

  async validateBundle(bundleId: string): Promise<ValidateBundleResult> {
    const row = this.bundleRepo.get(bundleId)
    if (row == null) throw new Error(`工作流包不存在: ${bundleId}`)
    let manifest: WorkflowBundleManifest
    try {
      manifest = JSON.parse(row.manifest_json) as WorkflowBundleManifest
    } catch {
      throw new Error(`工作流包 ${bundleId} 的 manifest 快照损坏`)
    }

    const checks: WorkflowBundleVerificationCheck[] = []
    checks.push(...(await this.validateSkills(bundleId, manifest)))
    checks.push(...(await this.validateMcpServers(bundleId, manifest)))
    checks.push(...this.validateWorkflows(bundleId))

    const status: WorkflowBundleVerificationStatus = checks.some(
      (c) => !c.ok && c.level === 'error',
    )
      ? 'failed'
      : checks.some((c) => !c.ok)
        ? 'warned'
        : 'passed'

    // 回写验证状态 + manifest 快照的 verification 区
    this.bundleRepo.update(bundleId, { verificationStatus: status })
    try {
      const parsed = JSON.parse(row.manifest_json) as Record<string, unknown>
      parsed.verification = { status, checkedAt: new Date().toISOString(), checks }
      this.bundleRepo.update(bundleId, { manifestJson: JSON.stringify(parsed) })
    } catch {
      /* 快照已损坏的场景上面已抛错;此处防御性忽略 */
    }

    return { bundleId, status, checks }
  }

  private async validateSkills(
    bundleId: string,
    manifest: WorkflowBundleManifest,
  ): Promise<WorkflowBundleVerificationCheck[]> {
    const prefix = `${BUNDLE_SKILL_ID_PREFIX}${bundleId}:`
    if (manifest.skills.length === 0) return []
    return Promise.all(
      manifest.skills.map(async (entry) => {
        const id = `${prefix}${entry.slug}`
        const skillRow = this.skillRepo.get(id)
        if (skillRow == null) {
          return {
            id: `skill:${entry.slug}`,
            ok: false,
            level: 'error' as const,
            message: '技能记录缺失',
          }
        }
        const dirOk = await access(skillRow.root_path)
          .then(() => true)
          .catch(() => false)
        if (!dirOk) {
          return {
            id: `skill:${entry.slug}`,
            ok: false,
            level: 'error' as const,
            message: `技能目录不存在: ${skillRow.root_path}`,
          }
        }
        return {
          id: `skill:${entry.slug}`,
          ok: true,
          level: 'info' as const,
          message: '技能记录与目录就绪',
        }
      }),
    )
  }

  private async validateMcpServers(
    bundleId: string,
    manifest: WorkflowBundleManifest,
  ): Promise<WorkflowBundleVerificationCheck[]> {
    const rows = this.mcpRepo.findByBundleId(bundleId)
    if (manifest.mcpServers.length === 0) return []
    const checks: WorkflowBundleVerificationCheck[] = []
    for (const entry of manifest.mcpServers) {
      const row = rows.find((r) => r.name === entry.name)
      if (row == null) {
        checks.push({
          id: `mcp:${entry.refId}`,
          ok: false,
          level: 'error' as const,
          message: 'MCP 配置记录缺失',
        })
        continue
      }
      if (row.enabled === 0) {
        checks.push({
          id: `mcp:${entry.refId}`,
          ok: false,
          level: 'warn' as const,
          message: '尚未激活(需补齐密钥后启用)',
        })
        continue
      }
      if (this.mcpService != null) {
        try {
          await this.mcpService.startServer(row.id)
          const tools = await this.mcpService.listServerTools(row.id)
          checks.push({
            id: `mcp:${entry.refId}`,
            ok: true,
            level: 'info' as const,
            message: `连接成功,列出 ${Array.isArray(tools) ? tools.length : 0} 个工具`,
          })
        } catch (err) {
          checks.push({
            id: `mcp:${entry.refId}`,
            ok: false,
            level: 'error' as const,
            message: `启动失败: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      } else {
        checks.push({
          id: `mcp:${entry.refId}`,
          ok: true,
          level: 'info' as const,
          message: '已启用(未做启动测试)',
        })
      }
    }
    return checks
  }

  private validateWorkflows(bundleId: string): WorkflowBundleVerificationCheck[] {
    const knownSkillIds = new Set(this.skillRepo.list().map((r) => r.id))
    const checks: WorkflowBundleVerificationCheck[] = []
    for (const workflow of this.workflowRepo.list({ includeArchived: true })) {
      if (workflow.bundleId !== bundleId) continue
      const graph = workflow.graph as unknown as WorkflowGraph
      if (graph == null || !Array.isArray(graph.nodes)) {
        checks.push({
          id: `workflow:${workflow.id}`,
          ok: false,
          level: 'error' as const,
          message: `「${workflow.name}」流程图结构无效`,
        })
        continue
      }
      const nodeIds = new Set(graph.nodes.map((n) => n.id))
      const problems: string[] = []
      for (const edge of graph.edges ?? []) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          problems.push(`连线 ${edge.id} 端点缺失`)
        }
      }
      const deps = collectGraphDependencies(graph)
      for (const skillId of deps.skillIds) {
        if (skillId.startsWith(BUNDLE_SKILL_ID_PREFIX) && !knownSkillIds.has(skillId)) {
          problems.push(`引用的包内技能缺失: ${skillId}`)
        }
      }
      checks.push(
        problems.length === 0
          ? {
              id: `workflow:${workflow.id}`,
              ok: true,
              level: 'info' as const,
              message: workflow.name,
            }
          : {
              id: `workflow:${workflow.id}`,
              ok: false,
              level: 'error' as const,
              message: `「${workflow.name}」:${problems.join(';')}`,
            },
      )
    }
    return checks
  }
}
