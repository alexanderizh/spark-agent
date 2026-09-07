/**
 * 工作流包全流程测试 — 真实 SQLite + 临时技能目录
 * 导出(脱敏/校验和)→ 预览 → 导入(隔离落位/引用改写)→ 激活(密钥校验)→ 验证 → 卸载
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'path'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  SparkDatabase,
  McpServerRepository,
  SkillRepository,
  WorkflowBundleRepository,
  WorkflowRepository,
} from '@spark/storage'
import { WorkflowBundleService } from './workflow-bundle.service.js'
import { sha256Hex, unzipBundle, zipEntries } from './bundle-fs.js'

let testDir: string
let db: SparkDatabase
let workflowRepo: WorkflowRepository
let skillRepo: SkillRepository
let mcpRepo: McpServerRepository
let bundleRepo: WorkflowBundleRepository
let service: WorkflowBundleService
let userSkillsDir: string
const archivePath = () => join(testDir, 'out', 'bundle.sparkflow')

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), 'wf-bundle-'))
  userSkillsDir = join(testDir, 'skills')
  mkdirSync(join(userSkillsDir, 'web-search'), { recursive: true })
  mkdirSync(join(testDir, 'out'), { recursive: true })
  writeFileSync(
    join(userSkillsDir, 'web-search', 'SKILL.md'),
    '---\nname: web-search\n---\n# Web Search',
  )
  writeFileSync(join(userSkillsDir, 'web-search', 'guide.md'), '# Guide')

  db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
  workflowRepo = new WorkflowRepository(db)
  skillRepo = new SkillRepository(db)
  mcpRepo = new McpServerRepository(db)
  bundleRepo = new WorkflowBundleRepository(db)
  service = new WorkflowBundleService(
    workflowRepo,
    skillRepo,
    mcpRepo,
    bundleRepo,
    userSkillsDir,
    null,
  )

  // 随包技能(市场来源)与内置影子行
  skillRepo.create({
    id: 'skill:skillhub:web-search',
    scope: 'user',
    name: 'web-search',
    version: '1.0.0',
    rootPath: join(userSkillsDir, 'web-search'),
    manifestJson: JSON.stringify({ description: '联网搜索', systemPrompt: 'Do search' }),
    enabled: true,
  })
  // 工作流引用技能 + MCP + 一个不可迁移的 agent
  workflowRepo.create({
    id: 'wf-1',
    name: '舆情分析',
    description: 'demo',
    graph: {
      nodes: [
        {
          id: 'n1',
          kind: 'skill',
          title: '搜索',
          x: 0,
          y: 0,
          config: {
            skillIds: ['skill:skillhub:web-search'],
            mcpServerIds: ['mcp-1'],
            agentId: 'agent-9',
            ruleIds: ['rule-7'],
          },
        },
      ],
      edges: [],
    },
  })
  workflowRepo.create({
    id: 'wf-builtin-skill',
    name: '引用内置技能',
    graph: {
      nodes: [
        {
          id: 'n1',
          kind: 'skill',
          title: 's',
          x: 0,
          y: 0,
          config: { skillIds: ['builtin:commit'] },
        },
      ],
      edges: [],
    },
  })
  // MCP 配置带密钥
  mcpRepo.create({
    id: 'mcp-1',
    scope: 'user',
    name: 'Tavily Search',
    configJson: JSON.stringify({
      transport: 'http',
      url: 'https://api.tavily.example',
      headers: { 'X-API-Key': 'sk-secret-123' },
    }),
    enabled: true,
  })
})

afterAll(() => {
  db.close()
  rmSync(testDir, { recursive: true, force: true })
})

describe('WorkflowBundleService end-to-end', () => {
  it('导出:密钥脱敏、技能随包、校验和齐全', async () => {
    const { manifest } = await service.exportBundle({
      workflowIds: ['wf-1'],
      outputPath: archivePath(),
      name: '舆情包',
    })

    expect(manifest.name).toBe('舆情包')
    expect(manifest.skills).toHaveLength(1)
    expect(manifest.skills[0]?.originSkillId).toBe('skill:skillhub:web-search')
    expect(manifest.mcpServers).toHaveLength(1)
    expect(manifest.mcpServers[0]?.requiredSecrets.map((s) => s.path)).toContain(
      'headers.X-API-Key',
    )
    // agent / rule 不可迁移,显式列入 unresolved
    expect(manifest.unresolved.map((u) => u.type)).toEqual(
      expect.arrayContaining(['agent', 'rule']),
    )
    // 解包检查:MCP 配置内容不含明文密钥,占位符在位
    const zipBytes = await import('fs').then((fs) => fs.readFileSync(archivePath()))
    const files = unzipBundle(new Uint8Array(zipBytes))
    const mcpFile = files.get('mcp/Tavily-Search.json')
    expect(mcpFile).toBeDefined()
    const mcpText = new TextDecoder().decode(mcpFile!)
    expect(mcpText).not.toContain('sk-secret-123')
    expect(mcpText).toContain('{{secret:headers.X-API-Key}}')
  })

  it('预览:完整性通过并列出依赖', async () => {
    const preview = await service.previewImport(archivePath())
    expect(preview.integrityOk).toBe(true)
    expect(preview.skills).toHaveLength(1)
    expect(preview.skills[0]?.bundleSkillId).toMatch(/^bundle:wfb-.+:web-search$/)
    expect(preview.mcpServers[0]?.requiredSecrets.length).toBeGreaterThan(0)
    expect(preview.unresolved.length).toBeGreaterThan(0)
  })

  it('导入:隔离落位、graph 引用改写、MCP 默认停用', async () => {
    const result = await service.importBundle(archivePath(), {})
    expect(result.workflowIds).toHaveLength(1)
    expect(result.installedSkillIds).toHaveLength(1)
    expect(result.importedMcpServerIds).toHaveLength(1)

    // 工作流挂 bundle_id,skillIds 已改写为 bundle: 前缀,agentId 保留待重绑
    const imported = workflowRepo.get(result.workflowIds[0]!)!
    expect(imported.bundleId).toMatch(/^wfb-/)
    expect(imported.scope).toBe('user')
    const nodeConfig = (imported.graph as { nodes: Array<{ config: Record<string, unknown> }> })
      .nodes[0]!.config
    expect(nodeConfig.skillIds).toEqual([result.installedSkillIds[0]])
    expect(nodeConfig.mcpServerIds).toEqual(result.importedMcpServerIds)
    expect(nodeConfig.agentId).toBe('agent-9')

    // 技能:DB 行为 bundle: 前缀,目录真实落盘,manifest_json 随包保留
    const skillRow = skillRepo.get(result.installedSkillIds[0]!)!
    expect(existsSync(skillRow.root_path)).toBe(true)
    expect(existsSync(join(skillRow.root_path, 'SKILL.md'))).toBe(true)
    expect(JSON.parse(skillRow.manifest_json)).toMatchObject({ description: '联网搜索' })

    // MCP:enabled=0,占位符仍在(等待补密钥)
    const mcpRow = mcpRepo.get(result.importedMcpServerIds[0]!)!
    expect(mcpRow.enabled).toBe(0)
    expect(mcpRow.bundle_id).toBe(imported.bundleId)
    expect(mcpRow.config_json).toContain('{{secret:headers.X-API-Key}}')
    expect(mcpRow.config_json).not.toContain('sk-secret-123')
  })

  it('激活:未补密钥时拒绝并列出缺失路径;补齐后启用', async () => {
    const bundles = service.listBundles()
    const bundle = bundles[0]!
    const server = bundle.mcpServers[0]!

    const blocked = await service.activateMcp(bundle.id, server.id)
    expect(blocked.started).toBe(false)
    expect(blocked.missingSecrets).toContain('headers.X-API-Key')
    expect(mcpRepo.get(server.id)?.enabled).toBe(0)

    // 模拟用户补密钥(mcp:update 的效果)
    const row = mcpRepo.get(server.id)!
    mcpRepo.update(server.id, {
      configJson: row.config_json.replace('{{secret:headers.X-API-Key}}', 'sk-imported-456'),
    })
    const activated = await service.activateMcp(bundle.id, server.id)
    expect(activated.missingSecrets).toEqual([])
    expect(mcpRepo.get(server.id)?.enabled).toBe(1)
  })

  it('验证:技能/MCP/流程图全部通过', async () => {
    const bundles = service.listBundles()
    const result = await service.validateBundle(bundles[0]!.id)
    expect(result.status).toBe('passed')
    expect(result.checks.every((c) => c.ok)).toBe(true)
    expect(bundleRepo.get(bundles[0]!.id)?.verification_status).toBe('passed')
  })

  it('导入落地失败时回滚已写入的技能、MCP 和工作流', async () => {
    const beforeWorkflows = workflowRepo.list({ includeArchived: true }).map((item) => item.id)
    const beforeSkills = skillRepo.list().map((item) => item.id)
    const beforeMcpServers = mcpRepo.listAll().map((item) => item.id)
    const beforeBundles = bundleRepo.list().map((item) => item.id)
    const bundleRoot = join(userSkillsDir, '_bundles')
    const beforeBundleDirectories = existsSync(bundleRoot) ? readdirSync(bundleRoot).sort() : []
    const originalCreate = bundleRepo.create
    bundleRepo.create = (() => {
      throw new Error('simulated bundle registration failure')
    }) as typeof bundleRepo.create

    try {
      await expect(service.importBundle(archivePath())).rejects.toThrow(
        'simulated bundle registration failure',
      )
    } finally {
      bundleRepo.create = originalCreate
    }

    expect(workflowRepo.list({ includeArchived: true }).map((item) => item.id)).toEqual(
      beforeWorkflows,
    )
    expect(skillRepo.list().map((item) => item.id)).toEqual(beforeSkills)
    expect(mcpRepo.listAll().map((item) => item.id)).toEqual(beforeMcpServers)
    expect(bundleRepo.list().map((item) => item.id)).toEqual(beforeBundles)
    const afterBundleDirectories = existsSync(bundleRoot) ? readdirSync(bundleRoot).sort() : []
    expect(afterBundleDirectories).toEqual(beforeBundleDirectories)
  })

  it('拒绝有环工作流且不写入任何资源', async () => {
    const cyclePath = join(testDir, 'out', 'cycle.sparkflow')
    const workflowBytes = new TextEncoder().encode(
      JSON.stringify({
        name: '有环流程',
        graph: {
          nodes: [
            { id: 'a', kind: 'agent', title: '节点 A', x: 0, y: 0, config: {} },
            { id: 'b', kind: 'agent', title: '节点 B', x: 0, y: 0, config: {} },
          ],
          edges: [
            { id: 'a-b', from: 'a', to: 'b' },
            { id: 'b-a', from: 'b', to: 'a' },
          ],
        },
      }),
    )
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        name: '有环包',
        exportedAt: new Date().toISOString(),
        workflows: [{ file: 'workflows/0.json', name: '有环流程' }],
        skills: [],
        mcpServers: [],
        unresolved: [],
        verification: { status: 'passed', checks: [] },
      }),
    )
    const files = { 'manifest.json': manifestBytes, 'workflows/0.json': workflowBytes }
    const checksums = new TextEncoder().encode(
      JSON.stringify({
        algorithm: 'sha256',
        files: Object.fromEntries(
          Object.entries(files).map(([path, content]) => [path, sha256Hex(content)]),
        ),
      }),
    )
    writeFileSync(cyclePath, zipEntries({ ...files, 'checksums.json': checksums }))

    const beforeWorkflowIds = workflowRepo.list({ includeArchived: true }).map((item) => item.id)
    await expect(service.importBundle(cyclePath)).rejects.toThrow('循环依赖')
    expect(workflowRepo.list({ includeArchived: true }).map((item) => item.id)).toEqual(
      beforeWorkflowIds,
    )
    expect(bundleRepo.list()).toHaveLength(1)
  })

  it('卸载整包:工作流/技能/MCP/目录/登记全部清除', async () => {
    const bundles = service.listBundles()
    const bundle = bundles[0]!
    const bundleId = bundle.id

    const uninstalled = await service.uninstallBundle(bundleId)
    expect(uninstalled).toBe(true)

    expect(
      workflowRepo.list({ includeArchived: true }).filter((w) => w.bundleId === bundleId),
    ).toHaveLength(0)
    expect(skillRepo.list().filter((s) => s.id.startsWith(`bundle:${bundleId}:`))).toHaveLength(0)
    expect(mcpRepo.findByBundleId(bundleId)).toHaveLength(0)
    expect(bundleRepo.get(bundleId)).toBeNull()
    const skillDir = join(userSkillsDir, '_bundles', bundleId)
    expect(existsSync(skillDir)).toBe(false)

    // 导出方的原始环境不受影响
    expect(workflowRepo.get('wf-1')).not.toBeNull()
    expect(mcpRepo.get('mcp-1')?.config_json).toContain('sk-secret-123')
  })
})
