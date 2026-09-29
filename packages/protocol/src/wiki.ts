/**
 * @module wiki
 *
 * 知识库 / Wiki 协议 — AI-Native 知识库的统一数据模型与 IPC 契约。
 *
 * 设计原则（对应方案 §4/§7/§8）：
 *   - 零预注入：wiki 内容绝不进入常驻上下文，Agent 按五级渐进披露取用
 *     （目录 → 摘要 → 正文 → 关联）；返回体量由服务端强制裁剪。
 *   - 所有返回携带 tokens 估计；写入回执区分 ok（持久化）与 indexReady（索引就绪）。
 *   - Agent 工具返回结构（mcp__spark_wiki__ 命名空间）与 IPC 结构共用本模块类型，
 *     保证内置 / MCP 两形态语义一致。
 *
 * 契约冻结于 S0（方案 §5）；S1 扩页面写入口，S2 扩候选确认区与抽取回执；
 * 变更须显式说明原因与影响。
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* 基础枚举                                                            */
/* ------------------------------------------------------------------ */

/** 空间 scope（谁的知识）。team 枚举首期只保留值，不建功能。 */
export type WikiScope = 'user' | 'project' | 'agent' | 'team'

/** 空间类型（知识从哪来，决定 UI 归属 Tab）。manual=知识库；repo=Repo Wiki（可重建）。 */
export type WikiSpaceType = 'manual' | 'repo'

/** 条目类型（是什么知识）。 */
export type WikiPageKind = 'knowledge' | 'experience' | 'pattern' | 'reference' | 'note'

export type WikiPageStatus = 'draft' | 'published' | 'archived'

/* ------------------------------------------------------------------ */
/* 域模型（IPC 侧视图；存储行类型在 @spark/storage）                      */
/* ------------------------------------------------------------------ */

export interface WikiSpaceSummary {
  id: string
  scope: WikiScope
  scopeRef: string | null
  spaceType: WikiSpaceType
  name: string
  description: string
  icon: string | null
  visibility: 'private' | 'shared'
  repoPath: string | null
  repoRev: string | null
  archived: boolean
  createdAt: number
  updatedAt: number
  /** 活跃页面计数（列表视图统计列） */
  pageCount: number
}

export interface WikiPageMeta {
  id: string
  spaceId: string
  parentId: string | null
  kind: WikiPageKind
  title: string
  slug: string
  summary: string
  tags: string[]
  status: WikiPageStatus
  version: number
  sortOrder: number
  sourceType: string | null
  authorRole: string | null
  hitCount: number
  createdAt: number
  updatedAt: number
}

export interface WikiPageDetail extends WikiPageMeta {
  body: string
  truncated: boolean
  /** 续读偏移（truncated=true 时存在；下一页从该 token 偏移续读） */
  nextOffset: number | null
  tokens: number
}

export interface WikiSearchHitItem {
  id: string
  title: string
  kind: WikiPageKind
  summary: string
  tags: string[]
  tokens: number
}

export interface WikiSearchResponse {
  items: WikiSearchHitItem[]
  total: number
  truncated: boolean
}

/** 统一写入回执（不回显正文） */
export interface WikiWriteReceipt {
  ok: boolean
  id: string
  title: string
  version: number
  /** FTS 索引是否就绪（false 时检索暂不可见，不谎报） */
  indexReady: boolean
}

/** 反向链接条目（L4 / 详情页右栏） */
export interface WikiBacklinkEntry {
  fromPage: string
  fromTitle: string
  fromKind: WikiPageKind
  linkType: 'wiki' | 'reference'
  createdAt: number
}

/** 历史版本正文（版本预览 / diff 用；正文只在用户显式请求时返回） */
export interface WikiRevisionDetail {
  pageId: string
  version: number
  title: string
  summary: string
  contentHash: string
  changeKind: 'create' | 'edit' | 'restore' | 'delete'
  changeNote: string | null
  actor: string | null
  createdAt: number
  /** 快照正文；快照缺失时为 null（如实告知，不假装有内容） */
  body: string | null
  unavailableReason: string | null
}

/** 物理删除回执（删除屏障：如实标注文件与快照是否清理完成） */
export interface WikiDeleteReceipt {
  ok: boolean
  id: string
  title: string
  fileCleaned: boolean
  revisionsCleaned: boolean
}

export interface WikiPageVersionEntry {
  version: number
  contentHash: string
  title: string
  summary: string
  changeKind: 'create' | 'edit' | 'restore' | 'delete'
  changeNote: string | null
  actor: string | null
  createdAt: number
}

/* ------------------------------------------------------------------ */
/* 候选确认区（S2 抽取管道）                                             */
/* ------------------------------------------------------------------ */

/** 候选状态（与 storage 的 CHECK 约束一致） */
export type WikiCandidateStatus = 'pending' | 'confirmed' | 'rejected' | 'expired'

/** 候选依据片段（强制溯源：无来源不入库） */
export interface WikiCandidateSourceView {
  sessionId: string
  /** 对话内第几轮（从 1 开始） */
  turnIndex: number
  /** 依据片段（不复制整段轨迹） */
  excerpt: string
}

/** 候选区条目（payload 已解析；UI 只读展示 + 结构化确认） */
export interface WikiCandidateItem {
  id: number
  scope: WikiScope
  scopeRef: string | null
  /** 目标空间（null = 确认时由用户选择 / 新建） */
  spaceId: string | null
  kind: WikiPageKind
  title: string
  summary: string
  body: string
  tags: string[]
  /** 模型自评分 0~1（低置信在 UI 标注"模型推断"） */
  confidence: number
  /** 入选理由（UI 展示，不作为知识内容） */
  rationale: string | null
  sources: WikiCandidateSourceView[]
  status: WikiCandidateStatus
  createdAt: number
  expiresAt: number
  /** 展示内容摘要（确认时必须回传，绑定"所见即所存"） */
  digest: string
  /** 已晋级创建的页面 id */
  pageId: string | null
}

/** 抽取触发方式（进日志与回执，便于成本归因） */
export type WikiExtractionTrigger = 'manual' | 'milestone' | 'idle' | 'schedule'

/** 抽取结果回执（不含正文片段：只报计数与失败原因） */
export interface WikiExtractionReceipt {
  ok: boolean
  /** 采样轮次数（成本归因） */
  sampledTurns: number
  /** 新增候选条数 */
  inserted: number
  /** 被同摘要去重跳过的条数 */
  duplicates: number
  /** 失败时原因（machine readable） */
  reason?:
    | 'disabled'
    | 'no_provider'
    | 'dialogue_empty'
    | 'model_failed'
    | 'quota'
    | 'invalid_output'
  message?: string
}

/* ------------------------------------------------------------------ */
/* 技能提议区（S3：知识 → 技能，带溯源）                                  */
/* ------------------------------------------------------------------ */

/** 提议状态（与 storage 的 CHECK 约束一致） */
export type WikiSkillProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

/** 提议区条目（草稿已解析；UI 只读展示 + 结构化决策） */
export interface WikiSkillProposalItem {
  id: string
  scope: WikiScope
  scopeRef: string | null
  name: string
  /** PURPOSE：为何创建 / 解决哪个 pattern */
  purpose: string
  /** SKILL.md 草稿全文 */
  skillMd: string
  description: string
  triggers: string[]
  /** 溯源：来自哪些 wiki_page（至少一个） */
  sourcePageIds: string[]
  status: WikiSkillProposalStatus
  /** 被拒原因（知识保留；下一轮提议可读，避免重蹈） */
  rejectReason: string | null
  /** 接受后生成的 skills.id */
  skillId: string | null
  createdAt: number
  decidedAt: number | null
  /** 溯源页面标题（UI 展示用，一次查询取全，避免 N+1） */
  sourcePages: Array<{ id: string; title: string; kind: WikiPageKind }>
}

/* ------------------------------------------------------------------ */
/* Repo Wiki（S4：代码仓库 → 结构化知识页，可重建）                       */
/* ------------------------------------------------------------------ */

/** 扫描回执（计数如实回报：截断/跳过都不静默） */
export interface WikiRepoScanReceipt {
  ok: boolean
  spaceId?: string
  /** 本次扫描记录的代码版本（漂移检测基线） */
  repoRev?: string | null
  pagesCreated: number
  pagesUpdated: number
  /** 被跳过（人工接管 / 已忽略）的页面数 */
  pagesSkipped: number
  filesScanned: number
  /** 是否因文件数上限截断 */
  truncated: boolean
  message?: string
}

/** 页面所有权（决定重建时是否覆写） */
export type WikiRepoPageOwnership = 'generated' | 'manual' | 'ignored'

/** 漂移状态（生成版本 vs 当前 HEAD） */
export interface WikiRepoDriftStatus {
  spaceId: string
  repoPath: string | null
  generatedRev: string | null
  currentRev: string | null
  /** generatedRev 落后 currentRev 多少个提交（无法判定时为 null） */
  commitsBehind: number | null
  stale: boolean
  threshold: number
}

/* ------------------------------------------------------------------ */
/* IPC 契约（S0 骨架：空间 + 页面核心闭环 + 检索；S1-S4 逐步扩展）          */
/* ------------------------------------------------------------------ */

export interface WikiIpcChannelMap {
  'wiki:space:list': [
    { scope?: WikiScope; scopeRef?: string | null; spaceType?: WikiSpaceType },
    { spaces: WikiSpaceSummary[] },
  ]
  'wiki:space:create': [
    {
      scope: WikiScope
      scopeRef?: string | null
      spaceType?: WikiSpaceType
      name: string
      description?: string
      icon?: string | null
    },
    WikiWriteReceipt & { spaceId: string },
  ]
  'wiki:space:archive': [{ spaceId: string }, WikiWriteReceipt]
  'wiki:space:update': [
    { spaceId: string; name?: string; description?: string; icon?: string | null },
    { space: WikiSpaceSummary },
  ]

  'wiki:page:list': [
    { spaceId: string; parentId?: string | null; kind?: WikiPageKind; includeArchived?: boolean },
    { pages: WikiPageMeta[] },
  ]
  'wiki:page:get': [{ pageId: string }, { page: WikiPageDetail }]
  'wiki:page:create': [
    {
      spaceId: string
      parentId?: string | null
      kind?: WikiPageKind
      title: string
      summary?: string
      body: string
      tags?: string[]
      status?: 'draft' | 'published'
    },
    WikiWriteReceipt,
  ]
  'wiki:page:update': [
    {
      pageId: string
      expectedVersion: number
      title?: string
      summary?: string
      body?: string
      tags?: string[]
      kind?: WikiPageKind
      parentId?: string | null
      status?: 'draft' | 'published'
    },
    WikiWriteReceipt,
  ]
  'wiki:page:archive': [{ pageId: string }, WikiWriteReceipt]
  'wiki:page:restore': [{ pageId: string }, WikiWriteReceipt]
  'wiki:page:delete': [{ pageId: string }, WikiDeleteReceipt]
  'wiki:page:move': [
    { pageId: string; parentId: string | null; sortOrder?: number; expectedVersion: number },
    WikiWriteReceipt,
  ]
  'wiki:page:history': [{ pageId: string }, { versions: WikiPageVersionEntry[] }]
  'wiki:page:revision:read': [{ pageId: string; version: number }, { revision: WikiRevisionDetail }]
  'wiki:page:revision:restore': [
    { pageId: string; version: number; expectedVersion: number },
    WikiWriteReceipt,
  ]
  'wiki:page:backlinks': [{ pageId: string }, { items: WikiBacklinkEntry[]; total: number }]
  'wiki:page:link': [
    { fromPageId: string; toPageId: string; remove?: boolean },
    { ok: boolean; changed: boolean },
  ]

  'wiki:search': [
    { query: string; spaceIds?: string[]; kind?: WikiPageKind; limit?: number },
    WikiSearchResponse,
  ]

  'wiki:candidate:list': [
    { scope?: WikiScope; scopeRef?: string | null; status?: WikiCandidateStatus },
    { items: WikiCandidateItem[]; pendingTotal: number },
  ]

  'wiki:candidate:confirm': [
    { id: number; digest: string; spaceId?: string | null },
    (
      | { ok: true; pageId: string; title: string; indexReady: boolean }
      | { ok: false; message: string }
    ),
  ]

  'wiki:candidate:reject': [{ id: number }, { ok: boolean; message?: string }]

  'wiki:extract:distill': [
    {
      sessionId: string
      trigger?: WikiExtractionTrigger
      scope?: WikiScope
      scopeRef?: string | null
      spaceId?: string | null
    },
    WikiExtractionReceipt,
  ]

  'wiki:skill:list': [
    { scope?: WikiScope; scopeRef?: string | null; status?: WikiSkillProposalStatus },
    { items: WikiSkillProposalItem[]; pendingTotal: number },
  ]

  'wiki:skill:accept': [
    { id: string },
    { ok: true; skillId: string; name: string; rootPath: string } | { ok: false; message: string },
  ]

  'wiki:skill:reject': [{ id: string; reason: string }, { ok: boolean; message?: string }]

  'wiki:repo:scan': [
    { repoPath: string; spaceId?: string; ignoreGlobs?: string[]; maxFiles?: number },
    WikiRepoScanReceipt,
  ]

  'wiki:repo:rebuild': [{ spaceId: string }, WikiRepoScanReceipt]

  'wiki:repo:status': [{ spaceId: string }, WikiRepoDriftStatus]

  'wiki:repo:page:ownership': [
    { pageId: string; ownership: WikiRepoPageOwnership },
    { ok: boolean; message?: string },
  ]
}

/* ------------------------------------------------------------------ */
/* Zod schemas（IPC 运行时校验）                                        */
/* ------------------------------------------------------------------ */

const WikiScopeSchema = z.enum(['user', 'project', 'agent', 'team'])
const WikiSpaceTypeSchema = z.enum(['manual', 'repo'])
const WikiPageKindSchema = z.enum(['knowledge', 'experience', 'pattern', 'reference', 'note'])
const WikiPageStatusSchema = z.enum(['draft', 'published', 'archived'])

export const WikiIpcSchemaRegistry = {
  'wiki:space:list': z.object({
    scope: WikiScopeSchema.optional(),
    scopeRef: z.string().nullable().optional(),
    spaceType: WikiSpaceTypeSchema.optional(),
  }),
  'wiki:space:create': z.object({
    scope: WikiScopeSchema,
    scopeRef: z.string().nullable().optional(),
    spaceType: WikiSpaceTypeSchema.optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(400).optional(),
    icon: z.string().max(64).nullable().optional(),
  }),
  'wiki:space:archive': z.object({
    spaceId: z.string().min(1).max(64),
  }),

  'wiki:space:update': z.object({
    spaceId: z.string().min(1).max(64),
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(400).optional(),
    icon: z.string().max(64).nullable().optional(),
  }),

  'wiki:page:list': z.object({
    spaceId: z.string().min(1).max(64),
    parentId: z.string().nullable().optional(),
    kind: WikiPageKindSchema.optional(),
    includeArchived: z.boolean().optional(),
  }),
  'wiki:page:get': z.object({
    pageId: z.string().min(1).max(64),
  }),
  'wiki:page:create': z.object({
    spaceId: z.string().min(1).max(64),
    parentId: z.string().nullable().optional(),
    kind: WikiPageKindSchema.optional(),
    title: z.string().min(1).max(200),
    summary: z.string().max(600).optional(),
    body: z.string().max(2_000_000),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    status: z.enum(['draft', 'published']).optional(),
  }),
  'wiki:page:update': z.object({
    pageId: z.string().min(1).max(64),
    expectedVersion: z.number().int().min(1),
    title: z.string().min(1).max(200).optional(),
    summary: z.string().max(600).optional(),
    body: z.string().max(2_000_000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    kind: WikiPageKindSchema.optional(),
    parentId: z.string().nullable().optional(),
    status: z.enum(['draft', 'published']).optional(),
  }),
  'wiki:page:archive': z.object({
    pageId: z.string().min(1).max(64),
  }),
  'wiki:page:restore': z.object({
    pageId: z.string().min(1).max(64),
  }),
  'wiki:page:delete': z.object({
    pageId: z.string().min(1).max(64),
  }),
  'wiki:page:move': z.object({
    pageId: z.string().min(1).max(64),
    parentId: z.string().min(1).max(64).nullable(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    expectedVersion: z.number().int().min(1),
  }),
  'wiki:page:history': z.object({
    pageId: z.string().min(1).max(64),
  }),
  'wiki:page:revision:read': z.object({
    pageId: z.string().min(1).max(64),
    version: z.number().int().min(1),
  }),
  'wiki:page:revision:restore': z.object({
    pageId: z.string().min(1).max(64),
    version: z.number().int().min(1),
    expectedVersion: z.number().int().min(1),
  }),
  'wiki:page:backlinks': z.object({
    pageId: z.string().min(1).max(64),
  }),
  'wiki:page:link': z.object({
    fromPageId: z.string().min(1).max(64),
    toPageId: z.string().min(1).max(64),
    remove: z.boolean().optional(),
  }),

  'wiki:search': z.object({
    query: z.string().min(1).max(500),
    spaceIds: z.array(z.string().min(1).max(64)).max(50).optional(),
    kind: WikiPageKindSchema.optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),

  'wiki:candidate:list': z.object({
    scope: WikiScopeSchema.optional(),
    scopeRef: z.string().nullable().optional(),
    status: z.enum(['pending', 'confirmed', 'rejected', 'expired']).optional(),
  }),
  'wiki:candidate:confirm': z.object({
    id: z.number().int().positive(),
    digest: z.string().min(8).max(64),
    spaceId: z.string().min(1).max(64).nullable().optional(),
  }),
  'wiki:candidate:reject': z.object({
    id: z.number().int().positive(),
  }),
  'wiki:extract:distill': z.object({
    sessionId: z.string().min(1).max(64),
    trigger: z.enum(['manual', 'milestone', 'idle', 'schedule']).optional(),
    scope: WikiScopeSchema.optional(),
    scopeRef: z.string().nullable().optional(),
    spaceId: z.string().min(1).max(64).nullable().optional(),
  }),

  'wiki:skill:list': z.object({
    scope: WikiScopeSchema.optional(),
    scopeRef: z.string().nullable().optional(),
    status: z.enum(['pending', 'accepted', 'rejected', 'superseded']).optional(),
  }),
  'wiki:skill:accept': z.object({
    id: z.string().min(1).max(64),
  }),
  'wiki:skill:reject': z.object({
    id: z.string().min(1).max(64),
    // 拒绝原因必填：这是留给下一轮提议的唯一反馈信号
    reason: z.string().min(1).max(500),
  }),

  'wiki:repo:scan': z.object({
    repoPath: z.string().min(1).max(1000),
    spaceId: z.string().min(1).max(64).optional(),
    ignoreGlobs: z.array(z.string().min(1).max(200)).max(100).optional(),
    maxFiles: z.number().int().min(1).max(200_000).optional(),
  }),
  'wiki:repo:rebuild': z.object({
    spaceId: z.string().min(1).max(64),
  }),
  'wiki:repo:status': z.object({
    spaceId: z.string().min(1).max(64),
  }),
  'wiki:repo:page:ownership': z.object({
    pageId: z.string().min(1).max(64),
    ownership: z.enum(['generated', 'manual', 'ignored']),
  }),
} as const
