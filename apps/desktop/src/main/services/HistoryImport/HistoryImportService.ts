/**
 * @module HistoryImport/HistoryImportService
 *
 * 检测 + 导入宿主机 Claude Code / Codex 对话历史。
 *
 *   scan()    —— 枚举两个来源的 transcript，提取轻量元数据 + 去重标记
 *   preview() —— 解析单个 transcript 返回前若干条消息
 *   import()  —— 全量解析所选 transcript → AgentEvent → 建会话 + 批量写事件
 *
 * 导入后的会话写入标准 agent_events，运行时在 sendTurn 时从事件重建对话历史，
 * 因此天然支持「继续对话」。来源/去重信息写入 sessions.metadata_json。
 */

import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat, open } from 'node:fs/promises'
import { EventRepository, SessionRepository, WorkspaceRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import type {
  HistoryImportSource,
  HistoryImportItem,
  HistoryImportScanResponse,
  HistoryImportPreviewMessage,
  HistoryImportPreviewResponse,
  HistoryImportSelection,
  HistoryImportResponse,
  HistoryImportResultEntry,
  HistoryImportProgress,
  HistoryImportMetadata,
  SessionAgentAdapter,
  SessionPermissionMode,
} from '@spark/protocol'
import { extractClaudeCodeMeta, parseClaudeCodeTranscript } from './claudeCodeParser.js'
import { extractCodexMeta, parseCodexRollout } from './codexParser.js'
import type { ParsedTranscript, TranscriptMeta } from './types.js'

const log = createLogger('history-import')

/** 单个文件超过此大小时只读首尾块做元数据提取（避免 OOM） */
const LARGE_FILE_BYTES = 8 * 1024 * 1024
const HEAD_BYTES = 512 * 1024
const TAIL_BYTES = 128 * 1024
/** 同名 sentinel：cwd 不可用时归入的「导入历史」工作区 root_path */
const IMPORTED_WORKSPACE_ROOT = '<imported-history>'

/** 创建会话的回调（由 IPC 层用 SessionService 实现） */
export interface CreateImportedSessionParams {
  title: string
  workspaceId: string
  providerProfileId: string
  agentAdapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
  modelId?: string
}

export interface ImportProviderResolution {
  providerProfileId: string
  agentAdapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
  modelId?: string
}

export interface HistoryImportDeps {
  db: SparkDatabase
  /** 按来源解析使用的 Provider/adapter（claude→claude provider，codex→codex provider） */
  resolveProvider: (source: HistoryImportSource) => Promise<ImportProviderResolution>
  /** 建会话（包装 SessionService.createSession） */
  createSession: (params: CreateImportedSessionParams) => Promise<{ sessionId: string }>
  /** 进度推送 */
  onProgress?: (progress: HistoryImportProgress) => void
  /** 宿主机 home 目录（测试可注入） */
  homeDir?: string
  /**
   * 将任意 git 路径（含 worktree）推导为主仓库根路径。
   * 用于导入时把 worktree cwd 归一化到主仓库，使 worktree 会话归并到主项目分组。
   * 非 git 目录或推导失败时应返回 null（调用方回落到原始 cwd）。测试可注入 mock。
   */
  resolveMainRepoRoot?: (cwd: string) => Promise<string | null>
}

interface ScannedFile {
  source: HistoryImportSource
  filePath: string
  sizeBytes: number
  mtime: Date
}

export class HistoryImportService {
  private readonly home: string
  /**
   * cwd → mainRepoRoot 的实例级缓存，避免对同一 cwd（尤其同一主仓库的多个 worktree）
   * 重复 spawn git 进程做归一化。在一次 import 批次内有效。
   */
  private readonly mainRootCache = new Map<string, string | null>()

  constructor(private readonly deps: HistoryImportDeps) {
    this.home = deps.homeDir ?? homedir()
  }

  private get claudeRoot(): string {
    return path.join(this.home, '.claude', 'projects')
  }

  private get codexRoot(): string {
    return path.join(this.home, '.codex', 'sessions')
  }

  private get codexIndexPath(): string {
    return path.join(this.home, '.codex', 'session_index.jsonl')
  }

  // ─── scan ──────────────────────────────────────────────────────────────

  async scan(sources?: HistoryImportSource[]): Promise<HistoryImportScanResponse> {
    const want = new Set<HistoryImportSource>(sources ?? ['claude-code', 'codex'])
    const importedIds = this.loadImportedSourceIds()
    const items: HistoryImportItem[] = []
    const sourceSummaries: HistoryImportScanResponse['sources'] = []

    if (want.has('claude-code')) {
      const summary = await this.scanClaudeCode(importedIds, items)
      sourceSummaries.push(summary)
    }
    if (want.has('codex')) {
      const summary = await this.scanCodex(importedIds, items)
      sourceSummaries.push(summary)
    }

    items.sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''))
    return { items, scannedAt: new Date().toISOString(), sources: sourceSummaries }
  }

  private async scanClaudeCode(
    importedIds: Set<string>,
    out: HistoryImportItem[],
  ): Promise<HistoryImportScanResponse['sources'][number]> {
    const root = this.claudeRoot
    let count = 0
    try {
      const projectDirs = await readdir(root, { withFileTypes: true })
      const files: ScannedFile[] = []
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue
        const projectPath = path.join(root, dir.name)
        let entries
        try {
          entries = await readdir(projectPath, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          // 只取项目目录下的顶层 <sessionId>.jsonl，排除 subagents 子目录
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
          const filePath = path.join(projectPath, entry.name)
          try {
            const st = await stat(filePath)
            files.push({ source: 'claude-code', filePath, sizeBytes: st.size, mtime: st.mtime })
          } catch {
            // ignore
          }
        }
      }
      for (const file of files) {
        const item = await this.buildClaudeItem(file, importedIds)
        if (item != null) {
          out.push(item)
          count++
        }
      }
      return { source: 'claude-code', available: true, count, rootPath: root }
    } catch (err) {
      return { source: 'claude-code', available: false, count, rootPath: root, error: errMsg(err) }
    }
  }

  private async buildClaudeItem(
    file: ScannedFile,
    importedIds: Set<string>,
  ): Promise<HistoryImportItem | null> {
    try {
      const text = await this.readForMeta(file.filePath, file.sizeBytes)
      const fallbackId = path.basename(file.filePath, '.jsonl')
      const meta = extractClaudeCodeMeta(text, fallbackId)
      if (meta.messageCount === 0) return null
      return this.toItem('claude-code', file, meta, importedIds)
    } catch (err) {
      log.warn(`scan claude file failed: ${file.filePath}: ${errMsg(err)}`)
      return null
    }
  }

  private async scanCodex(
    importedIds: Set<string>,
    out: HistoryImportItem[],
  ): Promise<HistoryImportScanResponse['sources'][number]> {
    const root = this.codexRoot
    let count = 0
    try {
      const threadNames = await this.loadCodexThreadNames()
      const files: ScannedFile[] = []
      await this.walkCodex(root, files)
      for (const file of files) {
        try {
          const text = await this.readForMeta(file.filePath, file.sizeBytes)
          const fallbackId = codexIdFromFilename(file.filePath)
          const provisional = extractCodexMeta(text, null, fallbackId)
          const threadName = threadNames.get(provisional.sourceSessionId) ?? null
          const meta = threadName != null ? { ...provisional, title: threadName } : provisional
          if (meta.messageCount === 0) continue
          out.push(this.toItem('codex', file, meta, importedIds))
          count++
        } catch (err) {
          log.warn(`scan codex file failed: ${file.filePath}: ${errMsg(err)}`)
        }
      }
      return { source: 'codex', available: true, count, rootPath: root }
    } catch (err) {
      return { source: 'codex', available: false, count, rootPath: root, error: errMsg(err) }
    }
  }

  private async walkCodex(dir: string, out: ScannedFile[]): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.walkCodex(full, out)
      } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        try {
          const st = await stat(full)
          out.push({ source: 'codex', filePath: full, sizeBytes: st.size, mtime: st.mtime })
        } catch {
          // ignore
        }
      }
    }
  }

  private toItem(
    source: HistoryImportSource,
    file: ScannedFile,
    meta: TranscriptMeta,
    importedIds: Set<string>,
  ): HistoryImportItem {
    return {
      source,
      sourceSessionId: meta.sourceSessionId,
      title: meta.title,
      cwd: meta.cwd,
      project: projectName(meta.cwd),
      messageCount: meta.messageCount,
      firstTimestamp: meta.firstTimestamp,
      lastTimestamp: meta.lastTimestamp ?? file.mtime.toISOString(),
      sizeBytes: file.sizeBytes,
      filePath: file.filePath,
      alreadyImported: importedIds.has(meta.sourceSessionId),
    }
  }

  // ─── preview ─────────────────────────────────────────────────────────────

  async preview(
    source: HistoryImportSource,
    filePath: string,
    limit = 20,
  ): Promise<HistoryImportPreviewResponse> {
    const text = await readFile(filePath, 'utf-8')
    const parsed = this.parse(source, text, filePath)
    const messages: HistoryImportPreviewMessage[] = []
    for (const event of parsed.events) {
      let msg: HistoryImportPreviewMessage | null = null
      if (event.type === 'user_message') {
        msg = { role: 'user', text: event.content, timestamp: event.timestamp }
      } else if (event.type === 'assistant_message') {
        msg = { role: 'assistant', text: event.content, timestamp: event.timestamp }
      } else if (event.type === 'agent_thinking') {
        msg = { role: 'thinking', text: event.content, timestamp: event.timestamp }
      } else if (event.type === 'tool_call') {
        msg = { role: 'tool', text: event.toolName, timestamp: event.timestamp }
      }
      if (msg != null) messages.push(msg)
      if (messages.length >= limit + 1) break
    }
    const truncated = messages.length > limit
    return { messages: messages.slice(0, limit), truncated }
  }

  // ─── import ──────────────────────────────────────────────────────────────

  async import(selections: HistoryImportSelection[]): Promise<HistoryImportResponse> {
    const results: HistoryImportResultEntry[] = []
    const importedIds = this.loadImportedSourceIds()
    const workspaceCache = new Map<string, string>()
    let imported = 0
    let skipped = 0
    let failed = 0
    const total = selections.length

    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i]!
      this.emitProgress({ phase: 'parsing', current: i, total, currentTitle: sel.title, sourceSessionId: sel.sourceSessionId })

      if (importedIds.has(sel.sourceSessionId)) {
        skipped++
        results.push({ sourceSessionId: sel.sourceSessionId, status: 'skipped' })
        continue
      }

      try {
        const sessionId = await this.importOne(sel, workspaceCache)
        importedIds.add(sel.sourceSessionId)
        imported++
        results.push({ sourceSessionId: sel.sourceSessionId, sessionId, status: 'imported' })
      } catch (err) {
        failed++
        log.error(`import failed for ${sel.sourceSessionId}: ${errMsg(err)}`)
        results.push({ sourceSessionId: sel.sourceSessionId, status: 'failed', error: errMsg(err) })
      }
      this.emitProgress({ phase: 'writing', current: i + 1, total, currentTitle: sel.title, sourceSessionId: sel.sourceSessionId })
    }

    this.emitProgress({ phase: 'done', current: total, total })
    return { imported, skipped, failed, results }
  }

  private async importOne(
    sel: HistoryImportSelection,
    workspaceCache: Map<string, string>,
  ): Promise<string> {
    const text = await readFile(sel.filePath, 'utf-8')
    const tempSessionId = 'pending'
    // 先解析拿到 meta（cwd / 时间），用于 workspace 归属与时间回填
    const probe = this.parse(sel.source, text, sel.filePath, tempSessionId)
    if (probe.events.length === 0) {
      throw new Error('transcript 解析为空（无可导入消息）')
    }

    const provider = await this.deps.resolveProvider(sel.source)
    const cwd = sel.cwd ?? probe.meta.cwd
    const workspaceId = await this.resolveWorkspaceId(cwd, workspaceCache)

    const { sessionId } = await this.deps.createSession({
      title: sel.title || probe.meta.title,
      workspaceId,
      providerProfileId: provider.providerProfileId,
      agentAdapter: provider.agentAdapter,
      permissionMode: provider.permissionMode,
      ...(provider.modelId != null ? { modelId: provider.modelId } : {}),
    })

    // 用真实 sessionId 重新解析（事件需绑定 sessionId）
    const parsed = this.parse(sel.source, text, sel.filePath, sessionId)
    const eventRepo = new EventRepository(this.deps.db)
    eventRepo.insertBatch(
      parsed.events.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        turnId: e.turnId,
        eventType: e.type,
        eventJson: JSON.stringify(e),
      })),
    )

    // 写入溯源元数据（去重依据）
    const meta: HistoryImportMetadata = {
      importedFrom: sel.source,
      sourceSessionId: sel.sourceSessionId,
      sourceFile: sel.filePath,
      importedAt: new Date().toISOString(),
    }
    const sessionRepo = new SessionRepository(this.deps.db)
    sessionRepo.patchMetadata(sessionId, { importedFrom: meta.importedFrom, importHistory: meta })

    // 回填会话时间，使其在侧边栏按原始时间排序
    const created = parsed.meta.firstTimestamp
    const updated = parsed.meta.lastTimestamp
    if (created != null || updated != null) {
      this.deps.db.raw
        .prepare('UPDATE sessions SET created_at = COALESCE(?, created_at), updated_at = COALESCE(?, updated_at) WHERE id = ?')
        .run(toIso(created), toIso(updated), sessionId)
    }

    return sessionId
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private parse(
    source: HistoryImportSource,
    text: string,
    filePath: string,
    sessionId = 'preview',
  ): ParsedTranscript {
    const fallbackTimestamp = new Date().toISOString()
    if (source === 'claude-code') {
      const sourceSessionId = path.basename(filePath, '.jsonl')
      return parseClaudeCodeTranscript(text, { sessionId, sourceSessionId, fallbackTimestamp })
    }
    const sourceSessionId = codexIdFromFilename(filePath)
    return parseCodexRollout(text, { sessionId, sourceSessionId, threadName: null, fallbackTimestamp })
  }

  /**
   * cwd → workspaceId（缓存）；cwd 不可用 / 无效时归入「导入历史」工作区。
   *
   * 若注入了 resolveMainRepoRoot，会先把 worktree 路径归一化到主仓库根——
   * 这样 worktree 中产生的会话不会单独成项目，而是归并到主仓库 workspace 分组下。
   * mainRootCache 避免对同一 cwd 重复 spawn git 进程。
   */
  private async resolveWorkspaceId(
    cwd: string | null,
    cache: Map<string, string>,
  ): Promise<string> {
    const rawKey = cwd != null && cwd.trim().length > 0 ? cwd.trim() : IMPORTED_WORKSPACE_ROOT

    // worktree 归一化：尝试把 cwd 推导为主仓库根路径（带实例级缓存避免重复 spawn git）
    let key = rawKey
    if (this.deps.resolveMainRepoRoot != null && rawKey !== IMPORTED_WORKSPACE_ROOT) {
      let mainRoot: string | null
      const cachedRoot = this.mainRootCache.get(rawKey)
      if (cachedRoot !== undefined) {
        mainRoot = cachedRoot
      } else {
        try {
          mainRoot = await this.deps.resolveMainRepoRoot(rawKey)
        } catch {
          // 非 git 目录或 git 不可用：回落到原始 cwd
          mainRoot = null
        }
        this.mainRootCache.set(rawKey, mainRoot)
      }
      if (mainRoot != null && mainRoot.trim().length > 0 && mainRoot !== rawKey) {
        key = mainRoot.trim()
      }
    }

    const cached = cache.get(key)
    if (cached != null) return cached

    const repo = new WorkspaceRepository(this.deps.db)
    const existing = repo.findByRootPath(key)
    if (existing != null) {
      cache.set(key, existing.id)
      return existing.id
    }
    const name = key === IMPORTED_WORKSPACE_ROOT ? '导入历史' : projectName(key)
    const created = repo.create({ id: randomUUID(), name, rootPath: key, projectKind: 'imported' })
    cache.set(key, created.id)
    return created.id
  }

  /** 已导入过的 sourceSessionId 集合（去重） */
  private loadImportedSourceIds(): Set<string> {
    const set = new Set<string>()
    try {
      const rows = this.deps.db.raw
        .prepare("SELECT metadata_json FROM sessions WHERE metadata_json LIKE '%importHistory%'")
        .all() as Array<{ metadata_json: string }>
      for (const row of rows) {
        try {
          const meta = JSON.parse(row.metadata_json) as { importHistory?: { sourceSessionId?: string } }
          const id = meta.importHistory?.sourceSessionId
          if (typeof id === 'string') set.add(id)
        } catch {
          // ignore
        }
      }
    } catch (err) {
      log.warn(`loadImportedSourceIds failed: ${errMsg(err)}`)
    }
    return set
  }

  private async loadCodexThreadNames(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    try {
      const text = await readFile(this.codexIndexPath, 'utf-8')
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (line.length === 0) continue
        try {
          const obj = JSON.parse(line) as { id?: string; thread_name?: string }
          if (typeof obj.id === 'string' && typeof obj.thread_name === 'string' && obj.thread_name.length > 0) {
            map.set(obj.id, obj.thread_name)
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // index 不存在则跳过
    }
    return map
  }

  /** 读取文件做元数据提取；超大文件只读首尾块 */
  private async readForMeta(filePath: string, sizeBytes: number): Promise<string> {
    if (sizeBytes <= LARGE_FILE_BYTES) {
      return readFile(filePath, 'utf-8')
    }
    const handle = await open(filePath, 'r')
    try {
      const head = Buffer.alloc(HEAD_BYTES)
      const tail = Buffer.alloc(TAIL_BYTES)
      await handle.read(head, 0, HEAD_BYTES, 0)
      await handle.read(tail, 0, TAIL_BYTES, Math.max(0, sizeBytes - TAIL_BYTES))
      return `${head.toString('utf-8')}\n${tail.toString('utf-8')}`
    } finally {
      await handle.close()
    }
  }

  private emitProgress(progress: HistoryImportProgress): void {
    this.deps.onProgress?.(progress)
  }
}

// ─── module helpers ──────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toIso(ts: string | null | undefined): string | null {
  if (ts == null || ts === '') return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 从 cwd 取末段作为项目名 */
function projectName(cwd: string | null): string {
  if (cwd == null || cwd.trim().length === 0) return '导入历史'
  const norm = cwd.replace(/[\\/]+$/, '')
  const seg = norm.split(/[\\/]/).pop()
  return seg != null && seg.length > 0 ? seg : '导入历史'
}

/** rollout-<ts>-<uuid>.jsonl → uuid */
function codexIdFromFilename(filePath: string): string {
  const base = path.basename(filePath, '.jsonl')
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return match?.[1] ?? base
}
