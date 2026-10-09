/**
 * @module dream
 *
 * AutoDream 梦境整理子系统的共享契约（开发计划 todo/2026-10-10-AutoDream空闲知识整理系统开发计划.md）。
 *
 * 为什么放在 protocol：三处必须共用同一份类型与校验 ——
 *   - agent-runtime：DreamOrchestrationService（编排/分流）、dream_propose_* 工具的服务端校验；
 *   - 桌面主进程：dream IPC（手动触发/状态查询/取消）；
 *   - 渲染端：DreamSettingsSection 配置默认值、dreaming 状态条展示。
 *
 * 写通道纪律（计划 §6.2/§6.3）：梦境 Agent 不拿任意写权限，一切写入以
 * DreamProposal 结构化提案进入本模块的校验 → 置信度分流（§7）→ 两侧 candidate
 * 管线。提案必须携带 rationale 与 sourceRefs 溯源，人审面板可见原始依据。
 */

// ─── 轨 / 触发 / 阶段 ───────────────────────────────────────────────────────

export type DreamTrack = 'memory' | 'wiki'
export type DreamTrigger = 'schedule' | 'manual'

/** 四阶段 Prompt（计划 §4.3）；settle = 分流落库阶段（非模型阶段） */
export type DreamPhase = 'orient' | 'gather' | 'consolidate' | 'prune' | 'settle'

export type DreamRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type DreamScheduleTrigger = 'off' | 'interval' | 'cron'

// ─── 提案（梦境 Agent → 服务端结构化写通道）────────────────────────────────

export type DreamProposalOp = 'create' | 'update' | 'merge' | 'delete'

export type DreamMemoryType = 'user' | 'feedback' | 'project' | 'reference'

export type DreamWikiPageKind = 'knowledge' | 'experience' | 'pattern' | 'reference' | 'note'

/** 溯源引用：人审面板据此展示原始依据；至少一条是硬校验 */
export interface DreamSourceRef {
  kind: 'session' | 'memory' | 'wiki' | 'rule'
  /** session id / memory entry id / wiki page id / rule id */
  id: string
  /** 可选定位（turnId、事件 seq、页内锚点等） */
  locator?: string
  /** 人类可读摘要（人审快速判断用） */
  note?: string
}

export interface DreamProposalBase {
  op: DreamProposalOp
  /** 模型自评置信度 0~1；服务端 clamp，分流阈值按百分数配置（默认 85%） */
  confidence: number
  /** 为什么这么改 —— 人审面板第一屏信息 */
  rationale: string
  /** 溯源引用，至少 1 条（防无据提案） */
  sourceRefs: DreamSourceRef[]
}

export interface DreamMemoryPayload {
  type: DreamMemoryType
  name: string
  description: string
  body: string
}

export interface DreamWikiPayload {
  title: string
  summary?: string
  body: string
  kind?: DreamWikiPageKind
  tags?: string[]
}

export interface DreamMemoryProposal extends DreamProposalBase {
  kind: 'memory'
  /** update / merge / delete 必填：目标记忆条目 id */
  targetId?: string
  /** merge 必填：被并入（保留）的条目 id */
  mergeTargetId?: string
  /** create / update 必填 */
  payload?: DreamMemoryPayload
}

export interface DreamWikiProposal extends DreamProposalBase {
  kind: 'wiki'
  /** create 必填：目标空间 id */
  spaceId?: string
  /** update / merge / delete 必填：目标页面 id */
  targetId?: string
  /** merge 必填：被并入（保留）的页面 id */
  mergeTargetId?: string
  /** create / update 必填 */
  payload?: DreamWikiPayload
}

export type DreamProposal = DreamMemoryProposal | DreamWikiProposal

// ─── 分流结果 / 运行状态 / 报告 ─────────────────────────────────────────────

/**
 * 单条提案的去向（计划 §7）：
 * - auto-applied：confidence ≥ 阈值（delete 另需 autoDeleteEnabled）→ 系统代确认落库；
 * - pending-review：进人审候选区；
 * - rejected-invalid：未通过 schema/业务校验，丢弃并记录；
 * - dropped-by-limit：超过 batchLimit，丢弃并记录。
 */
export type DreamProposalOutcome =
  | 'auto-applied'
  | 'pending-review'
  | 'rejected-invalid'
  | 'dropped-by-limit'

export interface DreamProposalResult {
  /** 分流后候选区行 id 或落库目标 id（人审跳转/审计对账用） */
  refId?: string
  outcome: DreamProposalOutcome
  /** rejected-invalid / dropped-by-limit 的原因说明 */
  note?: string
}

export interface DreamRunStats {
  proposals: number
  autoApplied: number
  pendingReview: number
  rejectedInvalid: number
  droppedByLimit: number
}

/** 梦境运行状态（R7）：持久化 + IPC 广播的最小单元 */
export interface DreamRunState {
  track: DreamTrack
  runId: string
  trigger: DreamTrigger
  status: DreamRunStatus
  phase: DreamPhase
  startedAt: number
  updatedAt: number
  /** 梦境 Agent 会话 id（取消/查看进度用） */
  sessionId: string | null
  stats: DreamRunStats
  error?: string
}

/** 运行报告（持久化形态）：只存去向摘要，提案正文留在候选区与审计日志 */
export interface DreamRunReport {
  runId: string
  track: DreamTrack
  trigger: DreamTrigger
  status: DreamRunStatus
  startedAt: number
  finishedAt: number
  durationMs: number
  stats: DreamRunStats
  outcomes: Array<{
    op: DreamProposalOp
    kind: 'memory' | 'wiki'
    targetId?: string
    confidence: number
    outcome: DreamProposalOutcome
  }>
  error?: string
}

// ─── 配置默认值（记忆轨服务端单一事实源；wiki 轨见 WIKI_SETTING_DEFINITIONS）──

/**
 * 梦境配置默认值（计划 §5.1 / §12 已拍板项）。memory 分类无 protocol 设置定义
 * 文件，服务端读取回落以本常量为准；渲染端 DreamSettingsSection 也从这里取默认值，
 * 避免两侧漂移。autoApplyThreshold 按百分数整数存储（0~100），与 wiki 侧
 * number 型设置校验（取整）一致。
 */
export const DREAM_SETTING_DEFAULTS = {
  enabled: false,
  scheduleTrigger: 'off' as DreamScheduleTrigger,
  scheduleIntervalMinutes: 1440,
  scheduleCron: '',
  providerId: '',
  model: '',
  autoApplyThreshold: 85,
  autoDeleteEnabled: false,
  sessionScanDays: 7,
  batchLimit: 50,
} as const

// ─── 提案校验（dream_propose_* 工具的服务端强制口径）───────────────────────

export interface DreamProposalValidation {
  ok: boolean
  proposal?: DreamProposal
  message?: string
}

const SOURCE_REF_KINDS: ReadonlySet<string> = new Set(['session', 'memory', 'wiki', 'rule'])
const MEMORY_TYPES: ReadonlySet<string> = new Set(['user', 'feedback', 'project', 'reference'])
const WIKI_KINDS: ReadonlySet<string> = new Set([
  'knowledge',
  'experience',
  'pattern',
  'reference',
  'note',
])
const OPS: ReadonlySet<string> = new Set(['create', 'update', 'merge', 'delete'])

/** 提案正文/理由长度上限：防梦境失控产出巨型提案撑爆候选区 */
export const DREAM_PROPOSAL_LIMITS = {
  rationaleMaxChars: 2000,
  bodyMaxChars: 20000,
  nameMaxChars: 200,
  descriptionMaxChars: 2000,
  summaryMaxChars: 600,
  tagsMaxCount: 20,
  sourceRefsMax: 20,
} as const

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/**
 * 校验并归一化单条提案（unknown → DreamProposal）。非法提案整条拒绝并给出
 * 人可读原因（进审计日志），不做部分修补 —— 提案是结构化写通道，宁拒勿糊。
 */
export function validateDreamProposal(raw: unknown): DreamProposalValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: '提案必须是对象' }
  }
  const p = raw as Record<string, unknown>
  const kind = p.kind
  if (kind !== 'memory' && kind !== 'wiki') {
    return { ok: false, message: `提案 kind 非法：${String(kind)}` }
  }
  const op = p.op
  if (typeof op !== 'string' || !OPS.has(op)) {
    return { ok: false, message: `提案 op 非法：${String(op)}` }
  }
  const targetId = typeof p.targetId === 'string' && p.targetId.length > 0 ? p.targetId : undefined
  if ((op === 'update' || op === 'merge' || op === 'delete') && targetId == null) {
    return { ok: false, message: `${op} 提案必须携带 targetId` }
  }
  const mergeTargetId =
    typeof p.mergeTargetId === 'string' && p.mergeTargetId.length > 0 ? p.mergeTargetId : undefined
  if (op === 'merge' && mergeTargetId == null) {
    return { ok: false, message: 'merge 提案必须携带 mergeTargetId（保留方条目）' }
  }
  if (op === 'merge' && targetId === mergeTargetId) {
    return { ok: false, message: 'merge 提案的 targetId 与 mergeTargetId 不能相同（自合并）' }
  }

  const rationale = typeof p.rationale === 'string' ? p.rationale.trim() : ''
  if (rationale.length === 0) {
    return { ok: false, message: '提案必须携带 rationale（整理理由）' }
  }
  if (rationale.length > DREAM_PROPOSAL_LIMITS.rationaleMaxChars) {
    return {
      ok: false,
      message: `rationale 超出上限（${DREAM_PROPOSAL_LIMITS.rationaleMaxChars} 字）`,
    }
  }

  // 溯源引用：至少 1 条、上限内、字段形态合法；kind 非法的引用剔除后仍须 ≥1
  const rawRefs = Array.isArray(p.sourceRefs) ? p.sourceRefs : []
  if (rawRefs.length === 0) {
    return { ok: false, message: '提案必须携带至少一条 sourceRefs 溯源引用' }
  }
  const sourceRefs: DreamSourceRef[] = []
  for (const r of rawRefs.slice(0, DREAM_PROPOSAL_LIMITS.sourceRefsMax)) {
    if (typeof r !== 'object' || r == null) continue
    const ref = r as Record<string, unknown>
    const refKind = typeof ref.kind === 'string' ? ref.kind : ''
    const refId = typeof ref.id === 'string' ? ref.id.trim() : ''
    if (!SOURCE_REF_KINDS.has(refKind) || refId.length === 0) continue
    sourceRefs.push({
      kind: refKind as DreamSourceRef['kind'],
      id: refId,
      ...(typeof ref.locator === 'string' && ref.locator.length > 0
        ? { locator: ref.locator }
        : {}),
      ...(typeof ref.note === 'string' && ref.note.length > 0
        ? { note: ref.note.slice(0, 400) }
        : {}),
    })
  }
  if (sourceRefs.length === 0) {
    return { ok: false, message: 'sourceRefs 中没有合法引用（kind/session 等字段形态不对）' }
  }

  // 载荷：create/update 必填且校验形态；merge/delete 不要求载荷
  let payload: DreamMemoryProposal['payload'] | DreamWikiProposal['payload']
  if (op === 'create' || op === 'update') {
    if (typeof p.payload !== 'object' || p.payload == null) {
      return { ok: false, message: `${op} 提案必须携带 payload` }
    }
    const rawPayload = p.payload as Record<string, unknown>
    if (kind === 'memory') {
      const type = typeof rawPayload.type === 'string' ? rawPayload.type : ''
      if (!MEMORY_TYPES.has(type)) {
        return { ok: false, message: `记忆提案 type 非法：${String(rawPayload.type)}` }
      }
      const name = typeof rawPayload.name === 'string' ? rawPayload.name.trim() : ''
      const description =
        typeof rawPayload.description === 'string' ? rawPayload.description.trim() : ''
      const body = typeof rawPayload.body === 'string' ? rawPayload.body.trim() : ''
      if (name.length === 0 || description.length === 0 || body.length === 0) {
        return { ok: false, message: '记忆提案 payload 的 name/description/body 均不能为空' }
      }
      if (name.length > DREAM_PROPOSAL_LIMITS.nameMaxChars) {
        return { ok: false, message: `name 超出上限（${DREAM_PROPOSAL_LIMITS.nameMaxChars} 字）` }
      }
      if (description.length > DREAM_PROPOSAL_LIMITS.descriptionMaxChars) {
        return {
          ok: false,
          message: `description 超出上限（${DREAM_PROPOSAL_LIMITS.descriptionMaxChars} 字）`,
        }
      }
      if (body.length > DREAM_PROPOSAL_LIMITS.bodyMaxChars) {
        return { ok: false, message: `body 超出上限（${DREAM_PROPOSAL_LIMITS.bodyMaxChars} 字）` }
      }
      payload = {
        type: type as DreamMemoryType,
        name,
        description,
        body,
      }
    } else {
      const title = typeof rawPayload.title === 'string' ? rawPayload.title.trim() : ''
      const body = typeof rawPayload.body === 'string' ? rawPayload.body.trim() : ''
      if (title.length === 0 || body.length === 0) {
        return { ok: false, message: '知识库提案 payload 的 title/body 均不能为空' }
      }
      if (title.length > DREAM_PROPOSAL_LIMITS.nameMaxChars) {
        return { ok: false, message: `title 超出上限（${DREAM_PROPOSAL_LIMITS.nameMaxChars} 字）` }
      }
      if (body.length > DREAM_PROPOSAL_LIMITS.bodyMaxChars) {
        return { ok: false, message: `body 超出上限（${DREAM_PROPOSAL_LIMITS.bodyMaxChars} 字）` }
      }
      const pageKind = typeof rawPayload.kind === 'string' ? rawPayload.kind : undefined
      if (pageKind != null && !WIKI_KINDS.has(pageKind)) {
        return { ok: false, message: `知识库提案 kind 非法：${pageKind}` }
      }
      const summary =
        typeof rawPayload.summary === 'string' && rawPayload.summary.trim().length > 0
          ? rawPayload.summary.trim().slice(0, DREAM_PROPOSAL_LIMITS.summaryMaxChars)
          : undefined
      const rawTags = Array.isArray(rawPayload.tags) ? rawPayload.tags : []
      const tags = rawTags
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .slice(0, DREAM_PROPOSAL_LIMITS.tagsMaxCount)
        .map((t) => t.trim().slice(0, 40))
      payload = {
        title,
        ...(summary != null ? { summary } : {}),
        body,
        ...(pageKind != null ? { kind: pageKind as DreamWikiPageKind } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      }
    }
  }

  // wiki create 必须指定空间
  const spaceId = typeof p.spaceId === 'string' && p.spaceId.length > 0 ? p.spaceId : undefined
  if (kind === 'wiki' && op === 'create' && spaceId == null) {
    return { ok: false, message: 'wiki create 提案必须携带 spaceId（目标空间）' }
  }

  const confidence = clamp01(p.confidence)

  if (kind === 'memory') {
    return {
      ok: true,
      proposal: {
        kind: 'memory',
        op: op as DreamProposalOp,
        confidence,
        rationale,
        sourceRefs,
        ...(targetId != null ? { targetId } : {}),
        ...(mergeTargetId != null ? { mergeTargetId } : {}),
        ...(payload != null ? { payload: payload as DreamMemoryPayload } : {}),
      },
    }
  }
  return {
    ok: true,
    proposal: {
      kind: 'wiki',
      op: op as DreamProposalOp,
      confidence,
      rationale,
      sourceRefs,
      ...(spaceId != null ? { spaceId } : {}),
      ...(targetId != null ? { targetId } : {}),
      ...(mergeTargetId != null ? { mergeTargetId } : {}),
      ...(payload != null ? { payload: payload as DreamWikiPayload } : {}),
    },
  }
}

/**
 * 置信度分流判定（计划 §7，纯函数便于单测）：
 * delete 提案在未开 autoDeleteEnabled 时一律人审，无视置信度。
 */
export function resolveDreamProposalOutcome(params: {
  op: DreamProposalOp
  confidence: number
  autoApplyThresholdPct: number
  autoDeleteEnabled: boolean
}): DreamProposalOutcome {
  if (params.op === 'delete' && !params.autoDeleteEnabled) {
    return 'pending-review'
  }
  // +EPSILON 吸收浮点表示误差（如 0.29*100 = 28.999…96 被误判为未达 29）：
  // epsilon 远小于任何真实置信度差距（最小 0.1 档），只回摆表示误差、不放宽
  // 阈值语义——0.849 阈 85 仍是 84.9 < 85，真实未达不进位。
  return params.confidence * 100 + 1e-9 >= params.autoApplyThresholdPct
    ? 'auto-applied'
    : 'pending-review'
}
