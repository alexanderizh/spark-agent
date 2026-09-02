/**
 * @module HistoryImport/HistoryImportService
 *
 * 检测 + 导入宿主机 Claude Code / Codex / ZCode 对话历史。
 *
 *   scan()    —— 枚举各来源的 transcript，提取轻量元数据 + 去重标记
 *   preview() —— 解析单个 transcript 返回前若干条消息
 *   import()  —— 全量解析所选 transcript → AgentEvent → 建会话 + 批量写事件
 *
 * 导入后的会话写入标准 agent_events，运行时在 sendTurn 时从事件重建对话历史，
 * 因此天然支持「继续对话」。来源/去重信息写入 sessions.metadata_json。
 *
 * ZCode 特有：会话存于中央 SQLite（所有条目共享 db 文件路径，按 sourceSessionId
 * 定位会话）；含 rewind 分支的会话会额外生成「回退分支」独立条目（默认不勾选）。
 */

import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat, open } from 'node:fs/promises'
import { statSync } from 'node:fs'
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
import { deriveTitle } from './types.js'
import { parseZcodeTranscript, splitZcodeRoutes, type ZcodeMessageRow } from './zcodeParser.js'
import {
  assertZcodeSchema,
  getZcodeSessionInfo,
  listZcodeSessions,
  loadZcodeMessages,
  lookupZcodeMessageMeta,
  openZcodeDb,
} from './zcodeStore.js'
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

  private get zcodeDbPath(): string {
    return path.join(this.home, '.zcode', 'cli', 'db', 'db.sqlite')
  }

  // ─── scan ──────────────────────────────────────────────────────────────

  async scan(sources?: HistoryImportSource[]): Promise<HistoryImportScanResponse> {
    const want = new Set<HistoryImportSource>(sources ?? ['claude-code', 'codex', 'zcode'])
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
    if (want.has('zcode')) {
      const summary = this.scanZcode(importedIds, items)
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
      } else if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.endsWith('.jsonl')
      ) {
        try {
          const st = await stat(full)
          out.push({ source: 'codex', filePath: full, sizeBytes: st.size, mtime: st.mtime })
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 扫描 ZCode 中央库：主线程会话各生成一条 item；含 rewind 回退记录的会话
   * 额外生成「回退分支」独立 item（branchOf 指回主线路，去重键独立）。
   * 打不开库 / schema 不兼容时仅置本来源 available:false。
   */
  private scanZcode(
    importedIds: Set<string>,
    out: HistoryImportItem[],
  ): HistoryImportScanResponse['sources'][number] {
    const dbPath = this.zcodeDbPath
    let db: ReturnType<typeof openZcodeDb> | null = null
    let count = 0
    try {
      db = openZcodeDb(dbPath)
      assertZcodeSchema(db)
      const sessions = listZcodeSessions(db)
      let sizeBytes = 0
      try {
        sizeBytes = statSync(dbPath).size
      } catch {
        // ignore
      }

      for (const s of sessions) {
        if (s.messageCount === 0) continue
        const title = deriveTitle(s.title, `Zcode 会话 ${s.id.slice(0, 16)}`)
        const base = {
          source: 'zcode' as const,
          cwd: s.directory,
          project: projectName(s.directory),
          sizeBytes,
          filePath: dbPath,
          firstTimestamp: s.timeCreated > 0 ? new Date(s.timeCreated).toISOString() : null,
          lastTimestamp: s.timeUpdated > 0 ? new Date(s.timeUpdated).toISOString() : null,
        }
        out.push({
          ...base,
          sourceSessionId: s.id,
          title,
          messageCount: s.messageCount,
          alreadyImported: importedIds.has(s.id),
        })
        count++

        const branchItem = this.buildZcodeBranchItem(db, s, title, sizeBytes, dbPath, importedIds)
        if (branchItem != null) {
          out.push(branchItem)
          count++
        }
      }
      return { source: 'zcode', available: true, count, rootPath: dbPath }
    } catch (err) {
      return { source: 'zcode', available: false, count, rootPath: dbPath, error: errMsg(err) }
    } finally {
      db?.close()
    }
  }

  /**
   * 由 revert 记录推导「回退分支」条目：点查边界消息的 sequence/时间计算分支
   * 消息数与时间范围，不载入全会话。messageCount 为近似值（含会被过滤的合成消息）。
   */
  private buildZcodeBranchItem(
    db: ReturnType<typeof openZcodeDb>,
    session: ReturnType<typeof listZcodeSessions>[number],
    mainTitle: string,
    sizeBytes: number,
    dbPath: string,
    importedIds: Set<string>,
  ): HistoryImportItem | null {
    const revert = session.revert
    const targetId = revert?.targetMessageID
    if (revert == null || typeof targetId !== 'string') return null

    const ids = [targetId]
    if (typeof revert.createdMessageID === 'string') ids.push(revert.createdMessageID)
    if (typeof revert.branchCutAfterMessageID === 'string') ids.push(revert.branchCutAfterMessageID)
    const metas = lookupZcodeMessageMeta(db, session.id, ids)
    const target = metas.get(targetId)
    if (target == null) return null

    // 被回退段 = [target.sequence, 边界]：旧格式边界 = rewind 合成消息前一序号；
    // 新格式边界 = branchCutAfter 消息序号本身（见 zcodeParser.splitZcodeRoutes）
    let endSeq: number | undefined
    let endTime: number | undefined
    if (typeof revert.createdMessageID === 'string') {
      const rew = metas.get(revert.createdMessageID)
      if (rew != null && rew.sequence > target.sequence) {
        endSeq = rew.sequence - 1
        endTime = rew.timeCreated
      }
    } else if (typeof revert.branchCutAfterMessageID === 'string') {
      const cut = metas.get(revert.branchCutAfterMessageID)
      if (cut != null && cut.sequence >= target.sequence) {
        endSeq = cut.sequence
        endTime = cut.timeCreated
      }
    }
    if (endSeq == null || endSeq < target.sequence) return null

    const branchCount = endSeq - target.sequence + 1
    if (branchCount <= 0) return null
    const branchKey = zcodeBranchKey(session.id, 1)
    return {
      source: 'zcode',
      sourceSessionId: branchKey,
      title: `${mainTitle}（回退分支）`,
      cwd: session.directory,
      project: projectName(session.directory),
      messageCount: branchCount,
      firstTimestamp: target.timeCreated > 0 ? new Date(target.timeCreated).toISOString() : null,
      lastTimestamp: endTime != null && endTime > 0 ? new Date(endTime).toISOString() : null,
      sizeBytes,
      filePath: dbPath,
      alreadyImported: importedIds.has(branchKey),
      branchOf: session.id,
      branchIndex: 1,
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
    sourceSessionId?: string,
  ): Promise<HistoryImportPreviewResponse> {
    const parsed =
      source === 'zcode'
        ? this.parseZcodeSelection(
            { source, filePath, sourceSessionId: sourceSessionId ?? '', cwd: null, title: '' },
            'preview',
          )
        : this.parse(source, await readFile(filePath, 'utf-8'), filePath)
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
      this.emitProgress({
        phase: 'parsing',
        current: i,
        total,
        currentTitle: sel.title,
        sourceSessionId: sel.sourceSessionId,
      })

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
      this.emitProgress({
        phase: 'writing',
        current: i + 1,
        total,
        currentTitle: sel.title,
        sourceSessionId: sel.sourceSessionId,
      })
    }

    this.emitProgress({ phase: 'done', current: total, total })
    return { imported, skipped, failed, results }
  }

  private async importOne(
    sel: HistoryImportSelection,
    workspaceCache: Map<string, string>,
  ): Promise<string> {
    // 先解析拿到 meta（cwd / 时间），用于 workspace 归属与时间回填
    const probe = await this.loadParsedTranscript(sel, 'pending')
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
    const parsed = await this.loadParsedTranscript(sel, sessionId)
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
      ...(sel.branchOf != null ? { branchOf: sel.branchOf } : {}),
    }
    const sessionRepo = new SessionRepository(this.deps.db)
    sessionRepo.patchMetadata(sessionId, { importedFrom: meta.importedFrom, importHistory: meta })

    // 回填会话时间，使其在侧边栏按原始时间排序
    const created = parsed.meta.firstTimestamp
    const updated = parsed.meta.lastTimestamp
    if (created != null || updated != null) {
      this.deps.db.raw
        .prepare(
          'UPDATE sessions SET created_at = COALESCE(?, created_at), updated_at = COALESCE(?, updated_at) WHERE id = ?',
        )
        .run(toIso(created), toIso(updated), sessionId)
    }

    return sessionId
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  /** 按来源解析所选条目（文件型读文本；zcode 查询 SQLite 并切分线路） */
  private async loadParsedTranscript(
    sel: HistoryImportSelection,
    sessionId: string,
  ): Promise<ParsedTranscript> {
    if (sel.source === 'zcode') {
      return this.parseZcodeSelection(sel, sessionId)
    }
    const text = await readFile(sel.filePath, 'utf-8')
    return this.parse(sel.source, text, sel.filePath, sessionId)
  }

  /**
   * 解析 ZCode 条目：sourceSessionId 形如 `sess_xxx`（主线路）或
   * `sess_xxx#branch-n`（回退分支）。每次打开只读连接，用后即关。
   */
  private parseZcodeSelection(sel: HistoryImportSelection, sessionId: string): ParsedTranscript {
    const { sessionId: zcodeSessionId, route } = parseZcodeSourceId(sel.sourceSessionId)
    const db = openZcodeDb(sel.filePath)
    try {
      const info = getZcodeSessionInfo(db, zcodeSessionId)
      if (info == null) {
        throw new Error(`ZCode 会话不存在: ${zcodeSessionId}`)
      }
      const messages = loadZcodeMessages(db, zcodeSessionId)
      const routes = splitZcodeRoutes(messages, info.revert)
      const rows: ZcodeMessageRow[] =
        route === 'main' ? routes.main : (routes.branches[route.branch - 1]?.rows ?? [])
      return parseZcodeTranscript(rows, {
        sessionId,
        sourceSessionId: sel.sourceSessionId,
        fallbackTimestamp: new Date().toISOString(),
        title: info.title,
        cwd: info.directory ?? sel.cwd,
      })
    } finally {
      db.close()
    }
  }

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
    return parseCodexRollout(text, {
      sessionId,
      sourceSessionId,
      threadName: null,
      fallbackTimestamp,
    })
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
          const meta = JSON.parse(row.metadata_json) as {
            importHistory?: { sourceSessionId?: string }
          }
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
          if (
            typeof obj.id === 'string' &&
            typeof obj.thread_name === 'string' &&
            obj.thread_name.length > 0
          ) {
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

/** ZCode 分支条目去重键：`sess_xxx#branch-n` */
function zcodeBranchKey(sessionId: string, branch: number): string {
  return `${sessionId}#branch-${branch}`
}

function parseZcodeSourceId(id: string): { sessionId: string; route: 'main' | { branch: number } } {
  const marker = '#branch-'
  const idx = id.indexOf(marker)
  if (idx === -1) return { sessionId: id, route: 'main' }
  const n = Number(id.slice(idx + marker.length))
  return {
    sessionId: id.slice(0, idx),
    route: { branch: Number.isInteger(n) && n >= 1 ? n : 1 },
  }
}
