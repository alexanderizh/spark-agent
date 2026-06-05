/**
 * @module platform-bridge.service
 *
 * Platform Bridge Service
 *
 * A lightweight HTTP server that runs inside the Electron main process,
 * exposing platform management operations to the Platform Management
 * MCP Server child process via localhost JSON-RPC.
 *
 * All handlers delegate to existing Service/Repository instances —
 * no business logic is duplicated.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from '@spark/shared'
import type { SkillService } from './skill.service.js'
import type { SkillLoader } from '../skills/skill-loader.js'
import type { SkillRegistryService } from './skill-registry/index.js'
import type { McpService } from './mcp-server.service.js'
import type { McpServerRepository } from '@spark/storage'
import type { ProviderProfileRepository } from '@spark/storage'
import type { WorkflowRepository } from '@spark/storage'
import type { UpdateWorkflowParams } from '@spark/storage'
import type { AgentRepository } from '@spark/storage'
import type { UpdateAgentParams, CreateProviderParams } from '@spark/storage'
import type { SettingsRepository } from '@spark/storage'

const log = createLogger('platform-bridge')

// ─── Types ────────────────────────────────────────────────────────────

export interface PlatformBridgeDeps {
  skillService: SkillService
  skillLoader: SkillLoader
  skillRegistryService: SkillRegistryService
  mcpService: McpService
  mcpRepo: McpServerRepository
  providerRepo: ProviderProfileRepository
  workflowRepo: WorkflowRepository
  agentRepo: AgentRepository
  settingsRepo: SettingsRepository
}

interface RpcRequest {
  method: string
  params: Record<string, unknown>
}

interface RpcResponse {
  ok: boolean
  data?: unknown
  error?: string
}

// ─── Service ──────────────────────────────────────────────────────────

export class PlatformBridgeService {
  private server: Server | null = null
  private port = 0
  private deps: PlatformBridgeDeps | null = null

  getPort(): number {
    return this.port
  }

  isRunning(): boolean {
    return this.server != null && this.port > 0
  }

  async start(deps: PlatformBridgeDeps): Promise<number> {
    if (this.server != null) return this.port
    this.deps = deps

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.sendJson(res, 500, { ok: false, error: String(err) })
        })
      })

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (typeof addr === 'object' && addr != null) {
          this.port = addr.port
          log.info(`Platform bridge listening on 127.0.0.1:${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('Failed to get bridge port'))
        }
      })

      this.server.on('error', (err) => {
        log.error(`Platform bridge error: ${err}`)
        reject(err)
      })
    })
  }

  async stop(): Promise<void> {
    if (this.server == null) return
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.port = 0
        this.deps = null
        resolve()
      })
    })
  }

  // ── HTTP handling ──

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      this.sendJson(res, 204, { ok: true })
      return
    }

    if (req.method !== 'POST' || req.url !== '/rpc') {
      this.sendJson(res, 404, { ok: false, error: 'Not found' })
      return
    }

    const body = await this.readBody(req)
    let rpc: RpcRequest
    try {
      rpc = JSON.parse(body) as RpcRequest
    } catch {
      this.sendJson(res, 400, { ok: false, error: 'Invalid JSON' })
      return
    }

    try {
      const data = await this.dispatch(rpc.method, rpc.params)
      this.sendJson(res, 200, { ok: true, data })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`RPC error [${rpc.method}]: ${message}`)
      this.sendJson(res, 200, { ok: false, error: message })
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  private sendJson(res: ServerResponse, status: number, body: RpcResponse): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  // ── Dispatch ──

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    const d = this.deps!
    switch (method) {
      // ── Skills ──
      case 'skills.list': return this.skillList(d, params)
      case 'skills.search': return this.skillSearch(d, params)
      case 'skills.install': return this.skillInstall(d, params)
      case 'skills.uninstall': return this.skillUninstall(d, params)
      case 'skills.toggle': return this.skillToggle(d, params)

      // ── MCP ──
      case 'mcp.list': return this.mcpList(d, params)
      case 'mcp.create': return this.mcpCreate(d, params)
      case 'mcp.update': return this.mcpUpdate(d, params)
      case 'mcp.delete': return this.mcpDelete(d, params)
      case 'mcp.status': return this.mcpStatus(d, params)

      // ── Providers ──
      case 'providers.list': return this.providerList(d, params)
      case 'providers.create': return this.providerCreate(d, params)
      case 'providers.update': return this.providerUpdate(d, params)
      case 'providers.delete': return this.providerDelete(d, params)
      case 'providers.health_check': return this.providerHealthCheck(d, params)

      // ── Workflows ──
      case 'workflows.list': return this.workflowList(d, params)
      case 'workflows.get': return this.workflowGet(d, params)
      case 'workflows.create': return this.workflowCreate(d, params)
      case 'workflows.update': return this.workflowUpdate(d, params)
      case 'workflows.delete': return this.workflowDelete(d, params)

      // ── Agents ──
      case 'agents.list': return this.agentList(d, params)
      case 'agents.get': return this.agentGet(d, params)
      case 'agents.create': return this.agentCreate(d, params)
      case 'agents.update': return this.agentUpdate(d, params)
      case 'agents.delete': return this.agentDelete(d, params)

      // ── Settings ──
      case 'settings.get': return this.settingsGet(d, params)
      case 'settings.set': return this.settingsSet(d, params)
      case 'settings.get_category': return this.settingsGetCategory(d, params)
      case 'settings.get_all': return this.settingsGetAll(d, params)

      // ── Board Tasks ──
      case 'board.list': return this.boardList(params)
      case 'board.get': return this.boardGet(params)
      case 'board.create': return this.boardCreate(params)
      case 'board.update': return this.boardUpdate(params)
      case 'board.delete': return this.boardDelete(params)
      case 'board.batch_create': return this.boardBatchCreate(params)
      case 'board.batch_update': return this.boardBatchUpdate(params)
      case 'board.batch_delete': return this.boardBatchDelete(params)
      case 'board.restore': return this.boardRestore(params)
      case 'board.permanent_delete': return this.boardPermanentDelete(params)

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }

  // ── Skill handlers ──

  private skillList(d: PlatformBridgeDeps, _params: Record<string, unknown>) {
    const rows = d.skillLoader.listAll()
    return {
      skills: rows.map((s) => {
        const def = s.definition
        const db = s.dbRecord
        return {
          id: db?.id ?? def?.id ?? '',
          name: db?.name ?? def?.name ?? '',
          description: def?.description ?? '',
          category: def?.category ?? '',
          version: db?.version ?? def?.version ?? '',
          author: def?.author ?? '',
          enabled: db?.enabled ?? true,
        }
      }),
    }
  }

  private async skillSearch(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const query = String(params.query ?? '')
    const limit = Number(params.limit ?? 8)
    const result = await d.skillRegistryService.search({ query, limit })
    return { skills: result.skills, total: result.total }
  }

  private async skillInstall(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const remoteSkillId = String(params.remoteSkillId ?? '')
    const registryId = String(params.registryId ?? '')
    const result = await d.skillRegistryService.install({ remoteSkillId, registryId })
    return { skill: result }
  }

  private skillUninstall(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const ok = d.skillService.deleteSkill(id)
    return { success: ok }
  }

  private skillToggle(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const enabled = d.skillLoader.toggleSkill(id)
    return { enabled }
  }

  // ── MCP handlers ──

  private mcpList(d: PlatformBridgeDeps, _params: Record<string, unknown>) {
    const servers = d.mcpRepo.listAll()
    return {
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        scope: s.scope,
        enabled: s.enabled === 1,
        config: JSON.parse(s.config_json),
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
    }
  }

  private mcpCreate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const name = String(params.name ?? '')
    const scope = String(params.scope ?? 'user')
    const configJson = typeof params.configJson === 'string'
      ? params.configJson
      : JSON.stringify(params.configJson ?? {})
    const enabled = params.enabled !== false
    const row = d.mcpRepo.create({ name, scope, configJson, enabled })
    return {
      server: {
        id: row.id,
        name: row.name,
        scope: row.scope,
        enabled: row.enabled === 1,
        config: JSON.parse(row.config_json),
      },
    }
  }

  private mcpUpdate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const fields: Partial<{ name: string; configJson: string; enabled: boolean }> = {}
    if (params.name != null) fields.name = String(params.name)
    if (params.configJson != null) {
      fields.configJson = typeof params.configJson === 'string'
        ? params.configJson
        : JSON.stringify(params.configJson)
    }
    if (params.enabled != null) fields.enabled = Boolean(params.enabled)
    const row = d.mcpRepo.update(id, fields)
    if (!row) throw new Error(`MCP server not found: ${id}`)
    return {
      server: {
        id: row.id,
        name: row.name,
        scope: row.scope,
        enabled: row.enabled === 1,
        config: JSON.parse(row.config_json),
      },
    }
  }

  private mcpDelete(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const ok = d.mcpRepo.deleteById(id)
    return { success: ok }
  }

  private mcpStatus(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = params.id != null ? String(params.id) : undefined
    const servers = d.mcpRepo.listAll()
    const statuses: Record<string, string> = {}
    for (const s of servers) {
      if (id != null && s.id !== id) continue
      statuses[s.id] = s.enabled === 1 ? 'enabled' : 'disabled'
    }
    return { statuses }
  }

  // ── Provider handlers ──

  private providerList(d: PlatformBridgeDeps, _params: Record<string, unknown>) {
    const rows = d.providerRepo.listAll()
    return {
      providers: rows.map((r) => {
        const config = JSON.parse(r.config_json) as Record<string, unknown>
        return {
          id: r.id,
          name: r.name,
          providerType: r.provider_type,
          enabled: r.enabled === 1,
          isDefault: r.is_default === 1,
          defaultModel: (config as { defaultModel?: string }).defaultModel ?? '',
          apiEndpoint: (config as { apiEndpoint?: string }).apiEndpoint ?? '',
          // mask keystore ref
          hasApiKey: r.keystore_ref != null && r.keystore_ref.length > 0,
        }
      }),
    }
  }

  private providerCreate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? `provider-${Date.now()}`)
    const name = String(params.name ?? '')
    const providerType = String(params.providerType ?? 'anthropic')
    const config = (params.config ?? { defaultModel: '' }) as Record<string, unknown>
    const keystoreRef = String(params.keystoreRef ?? '')
    const isDefault = Boolean(params.isDefault)
    const row = d.providerRepo.create({
      id,
      providerType,
      name,
      config: config as CreateProviderParams['config'],
      keystoreRef,
      isDefault,
    })
    return {
      provider: {
        id: row.id,
        name: row.name,
        providerType: row.provider_type,
        enabled: row.enabled === 1,
      },
    }
  }

  private providerUpdate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const fields: Partial<{ name: string; config: Record<string, unknown>; enabled: boolean }> = {}
    if (params.name != null) fields.name = String(params.name)
    if (params.config != null) fields.config = params.config as Record<string, unknown>
    if (params.enabled != null) fields.enabled = Boolean(params.enabled)
    d.providerRepo.update(id, fields)
    const row = d.providerRepo.get(id)
    if (!row) throw new Error(`Provider not found: ${id}`)
    return {
      provider: {
        id: row.id,
        name: row.name,
        providerType: row.provider_type,
        enabled: row.enabled === 1,
      },
    }
  }

  private providerDelete(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const ok = d.providerRepo.delete(id)
    return { success: ok }
  }

  private providerHealthCheck(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    // Basic health check — verify provider exists and has API key configured
    const id = String(params.id ?? '')
    const row = d.providerRepo.get(id)
    if (!row) throw new Error(`Provider not found: ${id}`)
    const hasApiKey = row.keystore_ref != null && row.keystore_ref.length > 0
    return { healthy: hasApiKey, providerId: id, name: row.name }
  }

  // ── Workflow handlers ──

  private workflowList(d: PlatformBridgeDeps, _params: Record<string, unknown>) {
    const items = d.workflowRepo.list({ includeArchived: false })
    return {
      workflows: items.map((w) => ({
        id: w.id,
        name: w.name,
        scope: w.scope,
        status: w.status,
        description: w.description,
        enabled: w.enabled,
      })),
    }
  }

  private workflowGet(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const item = d.workflowRepo.get(id)
    if (!item) throw new Error(`Workflow not found: ${id}`)
    return { workflow: item }
  }

  private workflowCreate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const item = d.workflowRepo.create({
      name: String(params.name ?? 'Untitled'),
      description: String(params.description ?? ''),
      status: (params.status as 'draft' | 'active' | 'archived') ?? 'draft',
      graph: (params.graph as Record<string, unknown>) ?? {},
    })
    return { workflow: item }
  }

  private workflowUpdate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const fields: Record<string, unknown> = {}
    if (params.name != null) fields.name = String(params.name)
    if (params.description != null) fields.description = String(params.description)
    if (params.status != null) fields.status = params.status
    if (params.graph != null) fields.graph = params.graph
    if (params.enabled != null) fields.enabled = Boolean(params.enabled)
    const item = d.workflowRepo.update(id, fields as UpdateWorkflowParams)
    if (!item) throw new Error(`Workflow not found: ${id}`)
    return { workflow: item }
  }

  private workflowDelete(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const ok = d.workflowRepo.delete(id)
    return { success: ok }
  }

  // ── Agent handlers ──

  private agentList(d: PlatformBridgeDeps, _params: Record<string, unknown>) {
    const items = d.agentRepo.list({ includeDisabled: true })
    return {
      agents: items.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        agentAdapter: a.agentAdapter,
        permissionMode: a.permissionMode,
        enabled: a.enabled,
        builtIn: a.builtIn,
      })),
    }
  }

  private agentGet(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const item = d.agentRepo.get(id)
    if (!item) throw new Error(`Agent not found: ${id}`)
    return { agent: item }
  }

  private agentCreate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const item = d.agentRepo.create({
      name: String(params.name ?? 'New Agent'),
      description: String(params.description ?? ''),
      enabled: params.enabled !== false,
      agentAdapter: String(params.agentAdapter ?? 'claude-sdk'),
      permissionMode: String(params.permissionMode ?? 'default'),
      reasoningEffort: String(params.reasoningEffort ?? 'medium'),
      prompt: String(params.prompt ?? ''),
      skillIds: (params.skillIds as string[]) ?? [],
      mcpServerIds: (params.mcpServerIds as string[]) ?? [],
    })
    return { agent: item }
  }

  private agentUpdate(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const fields: Record<string, unknown> = {}
    if (params.name != null) fields.name = String(params.name)
    if (params.description != null) fields.description = String(params.description)
    if (params.enabled != null) fields.enabled = Boolean(params.enabled)
    if (params.agentAdapter != null) fields.agentAdapter = String(params.agentAdapter)
    if (params.permissionMode != null) fields.permissionMode = String(params.permissionMode)
    if (params.prompt != null) fields.prompt = String(params.prompt)
    if (params.skillIds != null) fields.skillIds = params.skillIds
    if (params.mcpServerIds != null) fields.mcpServerIds = params.mcpServerIds
    const item = d.agentRepo.update(id, fields as UpdateAgentParams)
    if (!item) throw new Error(`Agent not found: ${id}`)
    return { agent: item }
  }

  private agentDelete(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const id = String(params.id ?? '')
    const ok = d.agentRepo.delete(id)
    return { success: ok }
  }

  // ── Settings handlers ──

  private settingsGet(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const category = String(params.category ?? 'general')
    const key = String(params.key ?? '')
    if (!key) throw new Error('Missing parameter: key')
    const value = d.settingsRepo.get(category, key)
    return { value }
  }

  private settingsSet(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const category = String(params.category ?? 'general')
    const key = String(params.key ?? '')
    const value = params.value
    if (!key) throw new Error('Missing parameter: key')
    d.settingsRepo.set(category, key, value)
    return { success: true }
  }

  private settingsGetCategory(d: PlatformBridgeDeps, params: Record<string, unknown>) {
    const category = String(params.category ?? 'general')
    const settings = d.settingsRepo.getByCategory(category)
    return { settings }
  }

  private settingsGetAll(d: PlatformBridgeDeps, _params: Record<string, unknown>) {
    const settings = d.settingsRepo.getAll()
    return { settings }
  }

  // ── Board Task handlers (file-backed store) ──

  private boardFilePath = join(homedir(), '.spark-agent', 'board-tasks.json')

  private readBoardTasks(): any[] {
    try {
      if (!existsSync(this.boardFilePath)) return []
      return JSON.parse(readFileSync(this.boardFilePath, 'utf-8'))
    } catch { return [] }
  }

  private writeBoardTasks(tasks: any[]): void {
    const dir = dirname(this.boardFilePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.boardFilePath, JSON.stringify(tasks), 'utf-8')
  }

  private boardList(params: Record<string, unknown>) {
    let tasks = this.readBoardTasks()
    const includeDeleted = params.includeDeleted === true
    if (!includeDeleted) tasks = tasks.filter((t: any) => !t.deletedAt)
    if (params.status) tasks = tasks.filter((t: any) => t.status === params.status)
    if (params.priority) tasks = tasks.filter((t: any) => t.priority === params.priority)
    if (params.assignee) {
      const a = String(params.assignee).toLowerCase()
      tasks = tasks.filter((t: any) => t.assignee?.toLowerCase().includes(a))
    }
    if (params.query) {
      const q = String(params.query).toLowerCase()
      tasks = tasks.filter((t: any) =>
        t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
      )
    }
    return { tasks, total: tasks.length }
  }

  private boardGet(params: Record<string, unknown>) {
    const tasks = this.readBoardTasks()
    const task = tasks.find((t: any) => t.id === params.id)
    if (!task) throw new Error(`Task not found: ${params.id}`)
    return { task }
  }

  private boardCreate(params: Record<string, unknown>) {
    const tasks = this.readBoardTasks()
    const now = new Date().toISOString()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const task = {
      id,
      title: String(params.title ?? ''),
      description: String(params.description ?? ''),
      status: String(params.status ?? 'todo'),
      priority: String(params.priority ?? 'medium'),
      assignee: String(params.assignee ?? ''),
      tags: Array.isArray(params.tags) ? params.tags : [],
      dueDate: String(params.dueDate ?? ''),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    tasks.push(task)
    this.writeBoardTasks(tasks)
    return { task }
  }

  private boardUpdate(params: Record<string, unknown>) {
    const tasks = this.readBoardTasks()
    const idx = tasks.findIndex((t: any) => t.id === params.id)
    if (idx === -1) throw new Error(`Task not found: ${params.id}`)
    const now = new Date().toISOString()
    const updated = { ...tasks[idx], updatedAt: now }
    for (const key of ['title', 'description', 'status', 'priority', 'assignee', 'dueDate']) {
      if (params[key] !== undefined) updated[key] = String(params[key])
    }
    if (params.tags !== undefined) updated.tags = Array.isArray(params.tags) ? params.tags : []
    tasks[idx] = updated
    this.writeBoardTasks(tasks)
    return { task: updated }
  }

  private boardDelete(params: Record<string, unknown>) {
    const tasks = this.readBoardTasks()
    const idx = tasks.findIndex((t: any) => t.id === params.id)
    if (idx === -1) throw new Error(`Task not found: ${params.id}`)
    tasks[idx] = { ...tasks[idx], deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    this.writeBoardTasks(tasks)
    return { success: true }
  }

  private boardBatchCreate(params: Record<string, unknown>) {
    const items = Array.isArray(params.tasks) ? params.tasks : []
    const tasks = this.readBoardTasks()
    const created: any[] = []
    for (const item of items) {
      const now = new Date().toISOString()
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const task = {
        id,
        title: String(item.title ?? ''),
        description: String(item.description ?? ''),
        status: String(item.status ?? 'todo'),
        priority: String(item.priority ?? 'medium'),
        assignee: String(item.assignee ?? ''),
        tags: Array.isArray(item.tags) ? item.tags : [],
        dueDate: String(item.dueDate ?? ''),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }
      tasks.push(task)
      created.push(task)
    }
    this.writeBoardTasks(tasks)
    return { created: created.length, tasks: created }
  }

  private boardBatchUpdate(params: Record<string, unknown>) {
    const updates = Array.isArray(params.updates) ? params.updates : []
    const tasks = this.readBoardTasks()
    const updated: any[] = []
    for (const upd of updates) {
      const idx = tasks.findIndex((t: any) => t.id === upd.id)
      if (idx === -1) continue
      const now = new Date().toISOString()
      const task = { ...tasks[idx], updatedAt: now }
      for (const key of ['title', 'description', 'status', 'priority', 'assignee', 'dueDate']) {
        if (upd[key] !== undefined) task[key] = String(upd[key])
      }
      if (upd.tags !== undefined) task.tags = Array.isArray(upd.tags) ? upd.tags : []
      tasks[idx] = task
      updated.push(task)
    }
    this.writeBoardTasks(tasks)
    return { updated: updated.length, tasks: updated }
  }

  private boardBatchDelete(params: Record<string, unknown>) {
    const ids = Array.isArray(params.ids) ? params.ids.map(String) : []
    const tasks = this.readBoardTasks()
    const now = new Date().toISOString()
    let count = 0
    for (const id of ids) {
      const idx = tasks.findIndex((t: any) => t.id === id)
      if (idx !== -1) {
        tasks[idx] = { ...tasks[idx], deletedAt: now, updatedAt: now }
        count++
      }
    }
    this.writeBoardTasks(tasks)
    return { deleted: count }
  }

  private boardRestore(params: Record<string, unknown>) {
    const tasks = this.readBoardTasks()
    const idx = tasks.findIndex((t: any) => t.id === params.id)
    if (idx === -1) throw new Error(`Task not found: ${params.id}`)
    tasks[idx] = { ...tasks[idx], deletedAt: null, updatedAt: new Date().toISOString() }
    this.writeBoardTasks(tasks)
    return { task: tasks[idx] }
  }

  private boardPermanentDelete(params: Record<string, unknown>) {
    const tasks = this.readBoardTasks()
    const filtered = tasks.filter((t: any) => t.id !== params.id)
    this.writeBoardTasks(filtered)
    return { success: true }
  }
}
