/**
 * @module registerSessionJourneyIpc
 *
 * 会话经历聚合 IPC（`session:get-journey`）—— 检查器「会话经历」区块的数据源。
 *
 * 一次请求聚合五组清单，SQL 层完成、不受聊天窗口化影响：
 *   - 技能与 MCP：审计账本（tool_invocations）分组；技能名 / 网页 URL 从
 *     脱敏输入载荷内联读取（小载荷直取，超阈值或未归档时兜底工具名）。
 *   - 网页查阅：搜索 / 抓取类工具行，提取检索词与 URL。
 *   - 过程产物：事件流 file_change + presented_files 按路径去重合并，
 *     仅收集文档 / 多媒体扩展名（isJourneyArtifactPath 白名单，代码类不进清单）。
 *   - 输入来源：user_message 事件的附件。
 *
 * 只读通道；各清单有扫描预算上限，触顶时 truncated=true（前端明示）。
 */

import { isAbsolute, join } from 'node:path'
import {
  EventRepository,
  McpServerRepository,
  SessionRepository,
  ToolInvocationRepository,
  WorkspaceRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { readAuditedPayloadInline } from '@spark/agent-runtime'
import type {
  SessionJourneyArtifact,
  SessionJourneyInputSource,
  SessionJourneyMcpServer,
  SessionJourneyResponse,
  SessionJourneySkill,
  SessionJourneyWebEntry,
} from '@spark/protocol'
import { typedIpcHandle } from './typed-ipc.js'
import { getDatabase } from '../db.js'
import { createLogger } from '@spark/shared'
import {
  baseNameOf,
  extractSkillName,
  extractWebEntry,
  hostOfUrl,
  isJourneyArtifactPath,
  isSkillToolName,
  isWebToolName,
} from './session-journey-helpers.js'

const log = createLogger('ipc.session-journey')

// ── 扫描预算（触顶置 truncated，前端明示「仅统计最近记录」） ──
const SKILL_ROWS_LIMIT = 120
const WEB_ROWS_LIMIT = 240
const FILE_CHANGE_EVENT_LIMIT = 400
const PRESENTED_FILES_EVENT_LIMIT = 200
const USER_MESSAGE_EVENT_LIMIT = 400
// ── 返回清单上限 ──
const SKILL_MAX = 30
const MCP_MAX = 30
const WEB_MAX = 40
const ARTIFACT_MAX = 60
const INPUT_SOURCE_MAX = 40

/** 相对路径按首个工作区根解析为绝对路径（多根会话取首个；解析不到为 null）。 */
function resolveAbsolutePath(filePath: string, workspaceRoots: Array<string>): string | null {
  if (isAbsolute(filePath)) return filePath
  const root = workspaceRoots[0]
  return root != null && root !== '' ? join(root, filePath) : null
}

interface ParsedJourneyEvent {
  timestamp: string | null
  value: Record<string, unknown>
}

/** 事件行 JSON 解析（坏行静默跳过；时间戳优先事件自身 timestamp）。 */
function parseEvent(row: { event_json: string; created_at: string }): ParsedJourneyEvent | null {
  try {
    const value = JSON.parse(row.event_json) as unknown
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : row.created_at
    return { timestamp, value: record }
  } catch {
    return null
  }
}

const CHANGE_TYPES = ['create', 'modify', 'delete', 'rename'] as const
type ChangeType = (typeof CHANGE_TYPES)[number]

function isChangeType(value: unknown): value is ChangeType {
  return typeof value === 'string' && (CHANGE_TYPES as readonly string[]).includes(value)
}

interface ArtifactAccumulator {
  path: string
  changeTypes: Set<ChangeType>
  presented: boolean
  title: string | null
  lastChangedAt: string | null
}

export function registerSessionJourneyIpc(): void {
  const db: SparkDatabase = getDatabase()
  const ledgerRepo = new ToolInvocationRepository(db)
  const eventRepo = new EventRepository(db)
  const sessionRepo = new SessionRepository(db)
  const workspaceRepo = new WorkspaceRepository(db)
  const mcpRepo = new McpServerRepository(db)

  /** 会话的候选工作区根（载荷归档定位与相对路径解析；解析失败静默跳过）。 */
  const workspaceRootsOf = (sessionId: string): string[] => {
    try {
      const session = sessionRepo.get(sessionId)
      if (session == null) return []
      return sessionRepo.getWorkspaceIds(sessionId).flatMap((workspaceId) => {
        const workspace = workspaceRepo.get(workspaceId)
        return workspace?.root_path != null && workspace.root_path !== ''
          ? [workspace.root_path]
          : []
      })
    } catch (error) {
      log.warn('session-journey workspace roots resolve failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  typedIpcHandle('session:get-journey', async (request): Promise<SessionJourneyResponse> => {
    const sessionId = request.sessionId
    const workspaceRoots = workspaceRootsOf(sessionId)
    let truncated = false

    // ── 技能 ──
    const stats = ledgerRepo.statsBySession(sessionId)
    const skillToolNames = stats.byTool.map(({ toolName }) => toolName).filter(isSkillToolName)
    const webToolNames = stats.byTool.map(({ toolName }) => toolName).filter(isWebToolName)

    const skillRows = ledgerRepo.listRecentByToolNames(sessionId, skillToolNames, SKILL_ROWS_LIMIT)
    if (skillRows.length >= SKILL_ROWS_LIMIT) truncated = true
    const skillByName = new Map<string, { skill: SessionJourneySkill; lastSeq: number }>()
    for (const row of skillRows) {
      const payload =
        row.input_artifact_id != null
          ? readAuditedPayloadInline(row.input_artifact_id, workspaceRoots)
          : null
      const name = extractSkillName(payload, row.tool_name)
      const existing = skillByName.get(name)
      if (existing == null) {
        skillByName.set(name, {
          skill: { name, toolName: row.tool_name, calls: 1, lastUsedAt: row.started_at },
          lastSeq: row.ledger_seq,
        })
      } else {
        existing.skill.calls += 1
        if (row.ledger_seq > existing.lastSeq) {
          existing.lastSeq = row.ledger_seq
          existing.skill.lastUsedAt = row.started_at
          existing.skill.toolName = row.tool_name
        }
      }
    }
    const skills = [...skillByName.values()]
      .sort((a, b) => b.skill.calls - a.skill.calls || a.skill.name.localeCompare(b.skill.name))
      .slice(0, SKILL_MAX)
      .map(({ skill }) => skill)
    if (skillByName.size > SKILL_MAX) truncated = true

    // ── MCP 服务器 ──
    const mcpServers: SessionJourneyMcpServer[] = ledgerRepo
      .listMcpUsageBySession(sessionId)
      .slice(0, MCP_MAX)
      .map((usage) => ({
        serverId: usage.serverId,
        displayName: mcpRepo.get(usage.serverId)?.name ?? usage.serverId,
        tools: usage.tools,
        calls: usage.calls,
        lastUsedAt: usage.lastStartedAt,
      }))

    // ── 网页查阅 ──
    const webRows = ledgerRepo.listRecentByToolNames(sessionId, webToolNames, WEB_ROWS_LIMIT)
    if (webRows.length >= WEB_ROWS_LIMIT) truncated = true
    const webByKey = new Map<string, { entry: SessionJourneyWebEntry; lastSeq: number }>()
    for (const row of webRows) {
      const payload =
        row.input_artifact_id != null
          ? readAuditedPayloadInline(row.input_artifact_id, workspaceRoots)
          : null
      const extracted = extractWebEntry(payload)
      if (extracted == null) continue
      const key = `${extracted.kind}:${extracted.text}`
      const existing = webByKey.get(key)
      if (existing == null) {
        webByKey.set(key, {
          entry: {
            kind: extracted.kind,
            text: extracted.text,
            host: extracted.kind === 'page' ? hostOfUrl(extracted.text) : null,
            toolName: row.tool_name,
            calls: 1,
            lastUsedAt: row.started_at,
          },
          lastSeq: row.ledger_seq,
        })
      } else {
        existing.entry.calls += 1
        if (row.ledger_seq > existing.lastSeq) {
          existing.lastSeq = row.ledger_seq
          existing.entry.lastUsedAt = row.started_at
          existing.entry.toolName = row.tool_name
        }
      }
    }
    const web = [...webByKey.values()]
      .sort((a, b) => b.entry.calls - a.entry.calls)
      .slice(0, WEB_MAX)
      .map(({ entry }) => entry)
    if (webByKey.size > WEB_MAX) truncated = true

    // ── 过程产物（file_change + presented_files 合并） ──
    const fileChangePage = eventRepo.queryBySession({
      sessionId,
      eventType: 'file_change',
      limit: FILE_CHANGE_EVENT_LIMIT,
    })
    const presentedPage = eventRepo.queryBySession({
      sessionId,
      eventType: 'presented_files',
      limit: PRESENTED_FILES_EVENT_LIMIT,
    })
    if (fileChangePage.hasMore || presentedPage.hasMore) truncated = true

    const artifactsByPath = new Map<string, ArtifactAccumulator>()
    const touchArtifact = (filePath: string, mutate: (acc: ArtifactAccumulator) => void): void => {
      const key = filePath
      let acc = artifactsByPath.get(key)
      if (acc == null) {
        acc = {
          path: filePath,
          changeTypes: new Set(),
          presented: false,
          title: null,
          lastChangedAt: null,
        }
        artifactsByPath.set(key, acc)
      }
      mutate(acc)
    }
    for (const row of fileChangePage.events) {
      const parsed = parseEvent(row)
      if (parsed == null) continue
      const path = parsed.value.path
      if (typeof path !== 'string' || path === '') continue
      if (!isJourneyArtifactPath(path)) continue
      touchArtifact(path, (acc) => {
        if (isChangeType(parsed.value.changeType)) acc.changeTypes.add(parsed.value.changeType)
        if (parsed.timestamp != null) {
          acc.lastChangedAt =
            acc.lastChangedAt != null && acc.lastChangedAt > parsed.timestamp
              ? acc.lastChangedAt
              : parsed.timestamp
        }
      })
    }
    for (const row of presentedPage.events) {
      const parsed = parseEvent(row)
      if (parsed == null) continue
      const files = parsed.value.files
      if (!Array.isArray(files)) continue
      for (const file of files) {
        if (file == null || typeof file !== 'object') continue
        const filePath = (file as Record<string, unknown>).path
        if (typeof filePath !== 'string' || filePath === '') continue
        if (!isJourneyArtifactPath(filePath)) continue
        const title = (file as Record<string, unknown>).title
        touchArtifact(filePath, (acc) => {
          acc.presented = true
          if (typeof title === 'string' && title !== '' && acc.title == null) acc.title = title
          if (parsed.timestamp != null) {
            acc.lastChangedAt =
              acc.lastChangedAt != null && acc.lastChangedAt > parsed.timestamp
                ? acc.lastChangedAt
                : parsed.timestamp
          }
        })
      }
    }
    const artifacts: SessionJourneyArtifact[] = [...artifactsByPath.values()]
      .sort((a, b) => (b.lastChangedAt ?? '').localeCompare(a.lastChangedAt ?? ''))
      .slice(0, ARTIFACT_MAX)
      .map((acc) => ({
        path: acc.path,
        name: baseNameOf(acc.path),
        changeTypes: CHANGE_TYPES.filter((type) => acc.changeTypes.has(type)),
        presented: acc.presented,
        title: acc.title,
        absolutePath: resolveAbsolutePath(acc.path, workspaceRoots),
        lastChangedAt: acc.lastChangedAt,
      }))
    if (artifactsByPath.size > ARTIFACT_MAX) truncated = true

    // ── 输入来源（user_message 附件） ──
    const userMessagePage = eventRepo.queryBySession({
      sessionId,
      eventType: 'user_message',
      limit: USER_MESSAGE_EVENT_LIMIT,
    })
    if (userMessagePage.hasMore) truncated = true
    const sourcesByPath = new Map<string, SessionJourneyInputSource>()
    for (const row of userMessagePage.events) {
      const parsed = parseEvent(row)
      if (parsed == null) continue
      const attachments = parsed.value.attachments
      if (!Array.isArray(attachments)) continue
      for (const attachment of attachments) {
        if (attachment == null || typeof attachment !== 'object') continue
        const record = attachment as Record<string, unknown>
        const path = record.path
        if (typeof path !== 'string' || path === '') continue
        const kind = record.type === 'image' || record.type === 'directory' ? record.type : 'file'
        const mimeType = typeof record.mimeType === 'string' ? record.mimeType : null
        const existing = sourcesByPath.get(path)
        if (existing == null) {
          sourcesByPath.set(path, {
            kind,
            path,
            name:
              typeof record.name === 'string' && record.name !== ''
                ? record.name
                : baseNameOf(path),
            mimeType,
            occurrences: 1,
            lastUsedAt: parsed.timestamp,
          })
        } else {
          existing.occurrences += 1
          if (parsed.timestamp != null) {
            existing.lastUsedAt =
              existing.lastUsedAt != null && existing.lastUsedAt > parsed.timestamp
                ? existing.lastUsedAt
                : parsed.timestamp
          }
        }
      }
    }
    const inputSources = [...sourcesByPath.values()]
      .sort(
        (a, b) =>
          b.occurrences - a.occurrences || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''),
      )
      .slice(0, INPUT_SOURCE_MAX)

    return { skills, mcpServers, web, artifacts, inputSources, truncated }
  })
}
