/**
 * @module HistoryImport/HistoryImportService
 *
 * 检测 + 导入宿主机 Claude Code / Codex 对话历史。
 *
 *   scan()    —— 枚举各来源的 transcript，提取轻量元数据 + 去重标记
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
import type { Dirent } from 'node:fs'
import { EventRepository, SessionRepository, WorkspaceRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import type {
  AgentEvent,
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
import { extractZcodeV2Meta, parseZcodeV2Transcript } from './zcodeV2Parser.js'
import { parseZcodeCliTranscript } from './zcodeCliParser.js'
import { listZcodeCliSessions, loadZcodeCliSessionText } from './zcodeCliStore.js'
import {
  completeImportedTurns,
  deriveTitle,
  type ParsedTranscript,
  type TranscriptMeta,
} from './types.js'
import type { ZcodeImportOrigin } from '@spark/protocol'

const log = createLogger('history-import')

/** 单个文件超过此大小时只读首尾块做元数据提取（避免 OOM） */
const LARGE_FILE_BYTES = 8 * 1024 * 1024
const HEAD_BYTES = 512 * 1024
const TAIL_BYTES = 128 * 1024
/** zcode 桌面会话是单个完整 JSON（不可截断读取），超此大小直接跳过（防 OOM） */
const ZCODE_V2_MAX_BYTES = 64 * 1024 * 1024
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
  /**
   * 按来源解析使用的 Provider/adapter（claude→claude provider，codex→codex provider）。
   * providerHint：zcode 专属的后端引擎提示（glm/claude/codex），用于映射续聊 adapter。
   */
  resolveProvider: (
    source: HistoryImportSource,
    providerHint?: string,
  ) => Promise<ImportProviderResolution>
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

/** scanCodex 中同一 thread 的一个 rollout 快照（文件 + 解析出的轻量元数据） */
interface CodexRolloutCandidate {
  file: ScannedFile
  meta: TranscriptMeta
}

export class HistoryImportService {
  private readonly home: string
  /**
   * cwd → mainRepoRoot 的实例级缓存，避免对同一 cwd（尤其同一主仓库的多个 worktree）
   * 重复 spawn git 进程做归一化。在一次 import 批次内有效。
   */
  private readonly mainRootCache = new Map<string, string | null>()
  /**
   * threadId → 主线（时间衔接链）rollout 文件路径列表。scan/import 入口失效重建；
   * 供 codex 导入/预览的拼接解析复用，避免对每个选中条目重复枚举 sessions 目录。
   */
  private codexMainlineCache: Map<string, string[]> | null = null

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

  /**
   * zcode 数据根目录候选。zcode 自身逻辑为 join(homedir(), ".zcode")，
   * 但支持 HOME 环境变量覆盖（resolveZcodeHome 优先读 HOME），故两处都探测。
   * 三平台（macOS/Linux/Windows）目录结构一致，无需平台分支。
   */
  private get zcodeRootCandidates(): string[] {
    const candidates = [path.join(this.home, '.zcode')]
    const homeEnv = process.env.HOME?.trim()
    if (homeEnv != null && homeEnv.length > 0) {
      const alt = path.join(homeEnv, '.zcode')
      if (!candidates.includes(alt)) candidates.push(alt)
    }
    return candidates
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
      const summary = await this.scanZcode(importedIds, items)
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
      // 先按 thread id（最后一条 session_meta 的 id，见 codexParser.collectMeta）
      // 分组：同一会话 resume 出的各代 rollout 快照必须归并为一个条目，
      // 否则同 thread 会在列表里重复出现且 sourceSessionId 全部撞车（勾选联动 +
      // 导入去重静默丢弃其余快照）。
      const byThread = new Map<string, CodexRolloutCandidate[]>()
      for (const file of files) {
        try {
          const text = await this.readForMeta(file.filePath, file.sizeBytes)
          const fallbackId = codexIdFromFilename(file.filePath)
          const meta = extractCodexMeta(text, null, fallbackId)
          if (meta.messageCount === 0) continue
          const list = byThread.get(meta.sourceSessionId)
          if (list != null) list.push({ file, meta })
          else byThread.set(meta.sourceSessionId, [{ file, meta }])
        } catch (err) {
          log.warn(`scan codex file failed: ${file.filePath}: ${errMsg(err)}`)
        }
      }
      // 主线（时间衔接链）写入实例缓存：preview 直接复用 scan 的枚举结果；
      // 每次扫描重建新 Map（而非复用旧实例），避免残留已删除 thread 的失效路径；
      // import 入口失效重建，保证与磁盘最新一致
      const mainlineCache = new Map<string, string[]>()
      for (const [threadId, candidates] of byThread) {
        const mainline = pickCodexMainline(candidates)
        out.push(this.buildCodexThreadItem(mainline, candidates, threadNames, importedIds))
        mainlineCache.set(
          threadId,
          mainline.map((c) => c.file.filePath),
        )
        count++
      }
      this.codexMainlineCache = mainlineCache
      return { source: 'codex', available: true, count, rootPath: root }
    } catch (err) {
      return { source: 'codex', available: false, count, rootPath: root, error: errMsg(err) }
    }
  }

  /**
   * 把同一 thread 的多个 rollout 文件归并为一个导入条目。
   *
   * Codex 的 resume 机制让同一 thread 在磁盘上以多个 rollout 文件存在，实测两种形态：
   *   1. 增量衔接——resume 后的新文件只记录新增内容，与前一文件时间精确衔接
   *      （thread 的连续历史分布在多个文件里）；
   *   2. 并行重叠——多个进程同时 resume 同一 thread，各自文件的时间窗互相重叠
   *      （内容是并行的两条工作线，拼接会重复）。
   * 条目的 messageCount 用主线（形态 1 贪心衔接链）文件计数之和；firstTimestamp /
   * lastTimestamp 聚合为组内完整跨度；filePath 指向最全文件（单文件兜底导入源）。
   */
  private buildCodexThreadItem(
    mainline: CodexRolloutCandidate[],
    candidates: CodexRolloutCandidate[],
    threadNames: Map<string, string>,
    importedIds: Set<string>,
  ): HistoryImportItem {
    const best = pickMostCompleteRollout(candidates)
    const threadName = threadNames.get(best.meta.sourceSessionId) ?? null
    const meta: TranscriptMeta = {
      ...best.meta,
      ...(threadName != null ? { title: threadName } : {}),
      messageCount: mainline.reduce((sum, c) => sum + c.meta.messageCount, 0),
      firstTimestamp: earliestTs(candidates.map((c) => c.meta.firstTimestamp)),
      lastTimestamp: latestTs(candidates.map((c) => c.meta.lastTimestamp)),
    }
    return this.toItem('codex', best.file, meta, importedIds)
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

  // ─── zcode（桌面 App v2 JSON + zcode CLI sqlite） ─────────────────────────

  /**
   * zcode 聚合扫描：桌面通道遍历 v2/sessions/<hash>/<taskId>.json，
   * CLI 通道从 cli/db/db.sqlite 枚举会话摘要。两通道独立容错，
   * 至少一个产出条目即视为可用。
   */
  private async scanZcode(
    importedIds: Set<string>,
    out: HistoryImportItem[],
  ): Promise<HistoryImportScanResponse['sources'][number]> {
    let count = 0
    const errors: string[] = []
    let rootPath = ''

    for (const root of this.zcodeRootCandidates) {
      rootPath = rootPath || root
      // ── 桌面 App：v2/sessions/<workspace-hash>/<taskId>.json ──
      const v2Root = path.join(root, 'v2', 'sessions')
      let v2Dirs: Dirent[] | null = null
      try {
        v2Dirs = await readdir(v2Root, { withFileTypes: true })
      } catch {
        // 目录不存在：该机器未用过桌面通道
      }
      if (v2Dirs != null) {
        for (const dir of v2Dirs) {
          if (!dir.isDirectory()) continue
          const dirPath = path.join(v2Root, dir.name)
          let entries
          try {
            entries = await readdir(dirPath, { withFileTypes: true })
          } catch {
            continue
          }
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue
            const filePath = path.join(dirPath, entry.name)
            try {
              const st = await stat(filePath)
              // v2 是单个完整 JSON（非 JSONL，不能截断头尾），超硬上限直接跳过防 OOM
              if (st.size > ZCODE_V2_MAX_BYTES) {
                log.warn(`skip oversized zcode v2 session: ${filePath} (${st.size} bytes)`)
                continue
              }
              const text = await readFile(filePath, 'utf-8')
              const fallbackId = path.basename(entry.name, '.json')
              const meta = extractZcodeV2Meta(text, fallbackId)
              if (meta == null || meta.messageCount === 0) continue
              out.push(
                this.toItem(
                  'zcode',
                  { source: 'zcode', filePath, sizeBytes: st.size, mtime: st.mtime },
                  meta,
                  importedIds,
                  'desktop',
                ),
              )
              count++
            } catch (err) {
              log.warn(`scan zcode v2 file failed: ${filePath}: ${errMsg(err)}`)
            }
          }
        }
      }

      // ── zcode CLI：cli/db/db.sqlite（单文件多会话） ──
      const dbPath = path.join(root, 'cli', 'db', 'db.sqlite')
      try {
        const st = await stat(dbPath)
        const sessions = listZcodeCliSessions(dbPath)
        if (sessions != null) {
          for (const session of sessions) {
            if (session.messageCount === 0) continue
            const firstTs = msToIsoOrNull(session.createdAt)
            const lastTs = msToIsoOrNull(session.updatedAt) ?? st.mtime.toISOString()
            out.push({
              source: 'zcode',
              origin: 'cli',
              sourceSessionId: session.sessionId,
              title: deriveTitle(session.title, `zcode-cli-${session.sessionId.slice(0, 12)}`),
              cwd: session.cwd,
              project: projectName(session.cwd),
              messageCount: session.messageCount,
              firstTimestamp: firstTs,
              lastTimestamp: lastTs,
              sizeBytes: st.size,
              filePath: dbPath,
              alreadyImported: importedIds.has(session.sessionId),
            })
            count++
          }
        }
      } catch (err) {
        // 库文件不存在（未装/未用 CLI）静默跳过；打开/查询失败记录为通道错误
        const msg = errMsg(err)
        if (!msg.includes('does not exist') && !msg.includes('ENOENT')) {
          errors.push(`cli: ${msg}`)
        }
      }
    }

    if (count > 0)
      return {
        source: 'zcode',
        available: true,
        count,
        rootPath: rootPath || path.join(this.home, '.zcode'),
      }
    if (errors.length > 0) {
      return {
        source: 'zcode',
        available: false,
        count,
        rootPath: rootPath,
        error: errors.join('; '),
      }
    }
    // 两侧数据都为空（未安装/未使用）：不显示为错误，标记不可用即可
    return {
      source: 'zcode',
      available: false,
      count,
      rootPath: rootPath || path.join(this.home, '.zcode'),
    }
  }

  private toItem(
    source: HistoryImportSource,
    file: ScannedFile,
    meta: TranscriptMeta,
    importedIds: Set<string>,
    origin?: ZcodeImportOrigin,
  ): HistoryImportItem {
    return {
      source,
      ...(origin != null ? { origin } : {}),
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
    origin?: ZcodeImportOrigin,
  ): Promise<HistoryImportPreviewResponse> {
    const parsed =
      source === 'codex' && sourceSessionId != null && sourceSessionId.length > 0
        ? await this.parseCodexThread(sourceSessionId, filePath, 'preview')
        : this.parse(
            source,
            await this.loadRaw(source, filePath, sourceSessionId, origin),
            filePath,
            'preview',
            {
              ...(sourceSessionId != null ? { sourceSessionId } : {}),
              ...(origin != null ? { origin } : {}),
            },
          )
    return toPreviewResponse(parsed, limit)
  }

  // ─── import ──────────────────────────────────────────────────────────────

  async import(selections: HistoryImportSelection[]): Promise<HistoryImportResponse> {
    // codex 主线缓存按 import 批次失效，保证拼接用到的文件列表与磁盘最新一致
    this.codexMainlineCache = null
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
    // 单次解析（codex 走 thread 主线拼接）：meta 决定 workspace / 标题，
    // 建会话后仅重绑 sessionId 落库，避免对大 transcript 二次全量解析
    const parsed = await this.parseForImport(sel)
    if (parsed.events.length === 0) {
      throw new Error('transcript 解析为空（无可导入消息）')
    }

    const provider = await this.deps.resolveProvider(sel.source, parsed.meta.providerHint)
    const cwd = sel.cwd ?? parsed.meta.cwd
    const workspaceId = await this.resolveWorkspaceId(cwd, workspaceCache)

    const { sessionId } = await this.deps.createSession({
      title: sel.title || parsed.meta.title,
      workspaceId,
      providerProfileId: provider.providerProfileId,
      agentAdapter: provider.agentAdapter,
      permissionMode: provider.permissionMode,
      ...(provider.modelId != null ? { modelId: provider.modelId } : {}),
    })

    const events = parsed.events.map((e) => ({ ...e, sessionId }) as AgentEvent)
    const eventRepo = new EventRepository(this.deps.db)
    eventRepo.insertBatch(
      events.map((e) => ({
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
        .prepare(
          'UPDATE sessions SET created_at = COALESCE(?, created_at), updated_at = COALESCE(?, updated_at) WHERE id = ?',
        )
        .run(toIso(created), toIso(updated), sessionId)
    }

    return sessionId
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  /**
   * 导入/预览前的统一解析入口：codex 走 thread 主线拼接（连续历史分布在
   * 多个 rollout 文件），其余来源单文件解析。
   */
  private async parseForImport(sel: HistoryImportSelection): Promise<ParsedTranscript> {
    if (sel.source === 'codex' && sel.sourceSessionId.length > 0) {
      return this.parseCodexThread(sel.sourceSessionId, sel.filePath, 'pending')
    }
    const text = await this.loadRaw(sel.source, sel.filePath, sel.sourceSessionId, sel.origin)
    return this.parse(sel.source, text, sel.filePath, 'pending', {
      sourceSessionId: sel.sourceSessionId,
      ...(sel.origin != null ? { origin: sel.origin } : {}),
    })
  }

  /**
   * 读取原始 transcript 文本。zcode CLI 来源的 filePath 指向 sqlite 库文件，
   * 需按 sourceSessionId 从库中重组会话载荷；其余来源直接读文件。
   */
  private async loadRaw(
    source: HistoryImportSource,
    filePath: string,
    sourceSessionId?: string,
    origin?: ZcodeImportOrigin,
  ): Promise<string> {
    if (source === 'zcode' && origin === 'cli') {
      if (sourceSessionId == null || sourceSessionId.length === 0) {
        throw new Error('zcode CLI 来源缺少 sourceSessionId，无法定位会话')
      }
      const text = loadZcodeCliSessionText(filePath, sourceSessionId)
      if (text == null) throw new Error(`zcode CLI 会话不存在：${sourceSessionId}`)
      return text
    }
    return readFile(filePath, 'utf-8')
  }

  /**
   * 解析 codex thread 的完整对话：主线 rollout 文件逐个全量解析后按序拼接事件。
   *
   * thread 的连续历史可能分布在多个 rollout 文件（每次 resume 一个新文件），
   * 单读条目 filePath（最全文件）会丢失它之前的衔接段，因此按与 scanCodex
   * 相同的分组规则重新枚举主线并逐文件解析拼接。拼接时做一处跨文件去重：
   * Codex resume 会把 thread 最后一条 user message 重放进新 rollout 开头
   * （作为续聊请求记录，时间戳为衔接时刻），后继文件首个 user_message 与已
   * 拼接部分最后一条 user_message 文本相同时丢弃，避免「继续」这类续聊指令
   * 在衔接处重复。meta 取首文件（cwd / 标题），时间聚合为主线跨度，
   * messageCount 按拼接后事件实数统计（全量解析，无截断低估）。
   */
  private async parseCodexThread(
    threadId: string,
    fallbackFilePath: string,
    sessionId: string,
  ): Promise<ParsedTranscript> {
    let paths: string[]
    try {
      paths = await this.listCodexMainlinePaths(threadId)
    } catch (err) {
      log.warn(`list codex mainline failed: ${threadId}: ${errMsg(err)}`)
      paths = []
    }
    if (paths.length === 0) {
      const text = await readFile(fallbackFilePath, 'utf-8')
      return parseCodexRollout(text, {
        sessionId,
        sourceSessionId: threadId,
        threadName: null,
        fallbackTimestamp: new Date().toISOString(),
      })
    }
    const fallbackTimestamp = new Date().toISOString()
    const events: AgentEvent[] = []
    const firsts: Array<string | null> = []
    const lasts: Array<string | null> = []
    let headMeta: TranscriptMeta | null = null
    let lastUserText: string | null = null
    for (const p of paths) {
      const text = await readFile(p, 'utf-8')
      const parsed = parseCodexRollout(text, {
        sessionId,
        sourceSessionId: threadId,
        threadName: null,
        fallbackTimestamp,
      })
      if (headMeta == null) headMeta = parsed.meta
      firsts.push(parsed.meta.firstTimestamp)
      lasts.push(parsed.meta.lastTimestamp)
      let firstUserSeen = false
      for (const event of parsed.events) {
        if (event.type === 'user_message') {
          // 比较用 trim 后文本：重放消息与源消息可能仅差尾换行
          const content = event.content.trim()
          if (!firstUserSeen) {
            firstUserSeen = true
            // 首文件无前置，直接保留；后继文件首条与已拼接末条相同 → resume 重放，丢弃
            if (headMeta !== parsed.meta && content.length > 0 && content === lastUserText) {
              continue
            }
          }
          lastUserText = content
        }
        events.push(event)
      }
    }
    const messageCount = events.filter(
      (e) => e.type === 'user_message' || e.type === 'assistant_message',
    ).length
    return {
      // 单文件解析各自从 0 编 seq，拼接后统一经 completeImportedTurns 重排
      events: completeImportedTurns(events),
      meta: {
        sourceSessionId: threadId,
        title: headMeta?.title ?? deriveTitle(null, '未命名 Codex 会话'),
        cwd: headMeta?.cwd ?? null,
        firstTimestamp: earliestTs(firsts),
        lastTimestamp: latestTs(lasts),
        messageCount,
      },
    }
  }

  /** threadId → 主线文件路径（枚举 sessions 目录一次并缓存；scan/import 入口失效） */
  private async listCodexMainlinePaths(threadId: string): Promise<string[]> {
    let cache = this.codexMainlineCache
    if (cache == null) {
      cache = new Map<string, string[]>()
      const files: ScannedFile[] = []
      await this.walkCodex(this.codexRoot, files)
      const byThread = new Map<string, CodexRolloutCandidate[]>()
      for (const file of files) {
        try {
          const text = await this.readForMeta(file.filePath, file.sizeBytes)
          const meta = extractCodexMeta(text, null, codexIdFromFilename(file.filePath))
          if (meta.messageCount === 0) continue
          const list = byThread.get(meta.sourceSessionId)
          if (list != null) list.push({ file, meta })
          else byThread.set(meta.sourceSessionId, [{ file, meta }])
        } catch (err) {
          log.warn(`scan codex file failed: ${file.filePath}: ${errMsg(err)}`)
        }
      }
      for (const [id, candidates] of byThread) {
        cache.set(
          id,
          pickCodexMainline(candidates).map((c) => c.file.filePath),
        )
      }
      this.codexMainlineCache = cache
    }
    return cache.get(threadId) ?? []
  }

  private parse(
    source: HistoryImportSource,
    text: string,
    filePath: string,
    sessionId = 'preview',
    opts?: { sourceSessionId?: string; origin?: ZcodeImportOrigin },
  ): ParsedTranscript {
    const fallbackTimestamp = new Date().toISOString()
    if (source === 'claude-code') {
      const sourceSessionId = path.basename(filePath, '.jsonl')
      return parseClaudeCodeTranscript(text, { sessionId, sourceSessionId, fallbackTimestamp })
    }
    if (source === 'zcode') {
      const sourceSessionId = opts?.sourceSessionId ?? path.basename(filePath, '.json')
      if (opts?.origin === 'cli') {
        return parseZcodeCliTranscript(text, { sessionId, sourceSessionId, fallbackTimestamp })
      }
      return parseZcodeV2Transcript(text, { sessionId, sourceSessionId, fallbackTimestamp })
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

/** ms epoch → ISO 8601；非法/缺失返回 null */
function msToIsoOrNull(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** 从 cwd 取末段作为项目名 */
function projectName(cwd: string | null): string {
  if (cwd == null || cwd.trim().length === 0) return '导入历史'
  const norm = cwd.replace(/[\\/]+$/, '')
  const seg = norm.split(/[\\/]/).pop()
  return seg != null && seg.length > 0 ? seg : '导入历史'
}

/**
 * 同一 thread 的快照中选导入代表：sizeBytes ↓，lastTimestamp ↓，messageCount ↓。
 *
 * sizeBytes 优先而不是 messageCount：组内快照是 Codex resume 的复制叠加产物，
 * 字节数单调反映完整度（新快照 ⊇ 被复制历史 + 追加内容）；而超过 8MB 的快照
 * scan 阶段只读首尾块（readForMeta），messageCount 是严重低估的下界——按消息数
 * 选代表会把最全的大快照输给完整读取的小快照。lastTimestamp / messageCount
 * 仅在字节完全相等时兜底裁决。
 */
function pickMostCompleteRollout(candidates: CodexRolloutCandidate[]): CodexRolloutCandidate {
  return candidates.reduce((best, cur) => {
    const bySize = cur.file.sizeBytes - best.file.sizeBytes
    if (bySize !== 0) return bySize > 0 ? cur : best
    const byTime = (cur.meta.lastTimestamp ?? '').localeCompare(best.meta.lastTimestamp ?? '')
    if (byTime !== 0) return byTime > 0 ? cur : best
    return cur.meta.messageCount > best.meta.messageCount ? cur : best
  })
}

/**
 * 主线衔接容差：resume 可能重写上一段尾部少量内容使新文件起点略早于当前
 * 覆盖末尾，衔接判定允许该重叠；远小于并行 resume 文件的重叠深度（分钟级），
 * 不会误纳入。
 */
const CODEX_MAINLINE_OVERLAP_TOLERANCE_MS = 60_000

/**
 * 从同 thread 的 rollout 文件中贪心选出时间衔接的主线（增量链）。
 *
 * 文件按内容时间窗 [firstTimestamp, lastTimestamp] 排序，从内容最早的文件
 * （thread 创建文件）出发，每步在「起点不早于当前覆盖末尾（含容差）」的候选
 * 中选终点最远者——标准区间覆盖贪心。时间窗互相重叠的并行 resume 文件因终点
 * 更近而被自然淘汰：拼接它们会重复记录同一段 thread 历史。
 */
function pickCodexMainline(candidates: CodexRolloutCandidate[]): CodexRolloutCandidate[] {
  if (candidates.length === 0) return []
  const keyed = candidates
    .map((cand) => ({
      cand,
      start: cand.meta.firstTimestamp ?? cand.file.mtime.toISOString(),
      end: cand.meta.lastTimestamp ?? cand.file.mtime.toISOString(),
    }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  const first = keyed[0]!
  const mainline: CodexRolloutCandidate[] = [first.cand]
  const used = new Set([first])
  let curEnd = first.end
  for (;;) {
    const floor = new Date(
      new Date(curEnd).getTime() + CODEX_MAINLINE_OVERLAP_TOLERANCE_MS,
    ).toISOString()
    let pick: (typeof keyed)[number] | null = null
    for (const k of keyed) {
      if (used.has(k) || k.start > floor) continue
      if (pick == null || k.end > pick.end) pick = k
    }
    // 无可衔接候选，或最佳候选整体落在已覆盖区间内（拼接只会重复）→ 结束
    if (pick == null || pick.end <= curEnd) break
    mainline.push(pick.cand)
    used.add(pick)
    curEnd = pick.end
  }
  return mainline
}

/** 解析结果 → 预览消息列表（多取 1 条用于 truncated 判定） */
function toPreviewResponse(parsed: ParsedTranscript, limit: number): HistoryImportPreviewResponse {
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

/** ISO 时间戳取最早（全部缺失返回 null），用于聚合 thread 的起始时间 */
function earliestTs(values: Array<string | null>): string | null {
  let min: string | null = null
  for (const v of values) {
    if (v == null) continue
    if (min == null || v.localeCompare(min) < 0) min = v
  }
  return min
}

/** ISO 时间戳取最新（全部缺失返回 null），用于聚合 thread 的最后活动时间 */
function latestTs(values: Array<string | null>): string | null {
  let max: string | null = null
  for (const v of values) {
    if (v == null) continue
    if (max == null || v.localeCompare(max) > 0) max = v
  }
  return max
}

/** rollout-<ts>-<uuid>.jsonl → uuid */
function codexIdFromFilename(filePath: string): string {
  const base = path.basename(filePath, '.jsonl')
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return match?.[1] ?? base
}
