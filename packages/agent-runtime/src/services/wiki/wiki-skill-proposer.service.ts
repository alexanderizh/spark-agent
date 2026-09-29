/**
 * @module wiki-skill-proposer.service
 *
 * 技能提议区服务（S3）—— 知识 → 技能的人工晋级闸门。
 *
 * 铁律（方案 §4 设计原则 1「知识永不随技能回滚」）：
 *   - `propose` 只写**草案**（wiki_skill_proposal / pending），不创建技能，
 *     也不改动任何 wiki_page —— 提议失败的成本为零，知识零损失；
 *   - `accept` 才落地技能（SKILL.md + PURPOSE.md + skills 表登记），
 *     且必须来自可信界面（`wiki:skill:accept` IPC），模型自称接受无效；
 *   - `reject` 只记原因：源知识页原样保留，原因进入决策史，
 *     下一轮 `propose` 会读到它，避免同一思路反复被拒。
 *
 * 溯源闭环：PURPOSE.md 内写 `wiki_page.id` 列表，技能被删/回滚后
 * 仍可按 id 找回催生它的那几页知识。
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@spark/shared'
import type {
  SkillRepository,
  WikiPageRepository,
  WikiSkillProposalRepository,
  WikiSkillProposalRow,
  WikiScope,
} from '@spark/storage'
import type { WikiSkillProposalItem, WikiSkillProposalStatus } from '@spark/protocol'
import { parseSkillDocument } from '../../skills/skill-document.js'

const log = createLogger('wiki:skill-proposer')

/** 技能名 → 安全目录名（与 skill-registry 的 slugifySkillName 同口径，避免跨模块耦合） */
export function slugifyWikiSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** PURPOSE.md 上限：溯源是索引不是正文副本 */
const PURPOSE_MAX_CHARS = 4000
/** SKILL.md 草稿上限（与页面正文同级量纲，防异常大载荷） */
const SKILL_MD_MAX_CHARS = 200_000

export interface WikiSkillProposalListResult {
  items: WikiSkillProposalItem[]
  pendingTotal: number
}

export interface WikiSkillProposalAcceptResult {
  ok: boolean
  skillId?: string
  name?: string
  rootPath?: string
  message?: string
}

export interface WikiSkillProposerServiceOptions {
  /** 用户技能落盘根目录（AppSkillsManager.userDir）；缺省时拒绝接受（不猜路径） */
  skillsRootDir?: string
}

export class WikiSkillProposerService {
  constructor(
    private readonly proposalRepo: WikiSkillProposalRepository,
    private readonly pageRepo: WikiPageRepository,
    private readonly skillRepo: SkillRepository,
    private readonly options: WikiSkillProposerServiceOptions = {},
  ) {}

  /**
   * 提议一个技能（Agent 工具 `wiki_propose_skill` 的唯一入口）。
   *
   * 强制溯源：sourcePageIds 必须至少解析到一个真实存在的页面 ——
   * 无知识依据的技能提议一律拒绝（方案 §9.4 同源纪律）。
   * 返回既往拒绝原因，让调用方（模型）在生成草稿前就知道"上次为何被拒"。
   */
  propose(input: {
    scope: WikiScope
    scopeRef: string | null
    name: string
    purpose: string
    skillMd: string
    description?: string
    triggers?: string[]
    sourcePageIds: string[]
  }): {
    ok: boolean
    id?: string
    superseded?: string[]
    rejectionHistory?: string[]
    message?: string
  } {
    const name = input.name.trim()
    if (name.length === 0) return { ok: false, message: '技能名称不能为空' }
    if (name.length > 120) return { ok: false, message: '技能名称过长（≤120 字符）' }
    const purpose = input.purpose.trim()
    if (purpose.length === 0) return { ok: false, message: 'PURPOSE（为何创建）不能为空' }
    if (input.skillMd.trim().length === 0) return { ok: false, message: 'SKILL.md 草稿不能为空' }
    if (input.skillMd.length > SKILL_MD_MAX_CHARS) {
      return { ok: false, message: `SKILL.md 草稿过大（≤${SKILL_MD_MAX_CHARS} 字符）` }
    }

    // 强制溯源：页面必须真实存在（防止模型编造 id 造出无依据的技能）
    const existingPages = input.sourcePageIds
      .map((id) => this.pageRepo.getById(id))
      .filter((row): row is NonNullable<typeof row> => row != null)
    if (existingPages.length === 0) {
      return { ok: false, message: '至少需要一个真实存在的溯源页面（source_page_ids）' }
    }

    const skillMd = ensureFrontmatter(input.skillMd, name, input.description?.trim() ?? purpose)
    const parsed = parseSkillDocument(skillMd)
    if (!parsed.valid) {
      // 草稿不可解析 = 技能不可加载；在提议阶段就拒绝，比接受后失败更好
      return { ok: false, message: `SKILL.md 草稿无法解析：${parsed.issue.message}` }
    }

    const superseded = this.proposalRepo
      .listByStatus('pending', { scope: input.scope, scopeRef: input.scopeRef })
      .filter((row) => row.name.toLowerCase() === name.toLowerCase())
      .map((row) => row.id)

    const id = `wskp_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    this.proposalRepo.insert({
      id,
      scope: input.scope,
      scopeRef: input.scopeRef,
      name,
      purpose: purpose.slice(0, PURPOSE_MAX_CHARS),
      draft: {
        skillMd,
        description: input.description?.trim() || parsed.description || purpose,
        triggers: input.triggers ?? [],
      },
      sourcePageIds: existingPages.map((row) => row.id),
    })

    const rejectionHistory = this.proposalRepo
      .findDecisionHistory(input.scope, input.scopeRef, name)
      .filter((row) => row.status === 'rejected' && row.reject_reason != null)
      .map((row) => row.reject_reason as string)

    log.info(
      `wiki skill proposed: id=${id} name="${name}" pages=${existingPages.length} superseded=${superseded.length}`,
    )
    return { ok: true, id, superseded, rejectionHistory }
  }

  /** 提议区列表（按状态）；附带溯源页面标题，避免 UI 逐条查询。 */
  list(
    status: WikiSkillProposalStatus,
    scope?: { scope: WikiScope; scopeRef: string | null },
  ): WikiSkillProposalListResult {
    const rows = this.proposalRepo.listByStatus(status, scope)
    const items: WikiSkillProposalItem[] = []
    for (const row of rows) {
      const view = toProposalView(row, this.proposalRepo, this.pageRepo)
      if (view == null) {
        log.warn(`wiki skill proposal draft unreadable: id=${row.id}`)
        continue
      }
      items.push(view)
    }
    const pendingTotal =
      scope != null
        ? this.proposalRepo.countPending(scope.scope, scope.scopeRef)
        : this.proposalRepo.listByStatus('pending').length
    return { items, pendingTotal }
  }

  /** 待处理提议总数（左栏 Badge）。 */
  pendingTotal(): number {
    return this.proposalRepo.listByStatus('pending').length
  }

  /**
   * 用户接受 → 落地技能。
   *
   * 顺序（对齐候选区范式）：先一次性状态迁移（accept），再落盘 + 登记，
   * 成功才回填 skill_id；任一步失败即条件回滚为 pending，用户可重试。
   * 这样并发接受只有一次成功，且不会留下"已接受但无技能"的死角。
   */
  async accept(id: string): Promise<WikiSkillProposalAcceptResult> {
    const row = this.proposalRepo.getById(id)
    if (row == null) return { ok: false, message: '提议不存在' }
    if (row.status !== 'pending') return { ok: false, message: `提议已是 ${row.status} 状态` }

    const draft = this.proposalRepo.parseDraft(row)
    if (draft == null) {
      return { ok: false, message: '技能草稿已损坏，无法落地' }
    }

    const migrated = this.proposalRepo.accept(id)
    if (!migrated.ok) {
      return { ok: false, message: '提议已被处理，请刷新提议区' }
    }

    try {
      const materialized = await this.materialize(row, draft)
      this.proposalRepo.attachSkill(id, materialized.skillId)
      log.info(
        `wiki skill accepted: id=${id} skill=${materialized.skillId} root=${materialized.rootPath}`,
      )
      return {
        ok: true,
        skillId: materialized.skillId,
        name: row.name,
        rootPath: materialized.rootPath,
      }
    } catch (err) {
      // 落地失败：回滚提议，让用户可以重试（不留"已接受但无技能"死角）
      this.proposalRepo.revertToPendingIfUnregistered(id)
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`wiki skill materialize failed: id=${id} err=${message}`)
      return { ok: false, message: `技能落地失败：${message}` }
    }
  }

  /** 用户拒绝（原因必填：留给下一轮提议的唯一反馈信号）。 */
  reject(id: string, reason: string): { ok: boolean; message?: string } {
    const row = this.proposalRepo.getById(id)
    if (row == null) return { ok: false, message: '提议不存在' }
    if (row.status !== 'pending') return { ok: false, message: `提议已是 ${row.status} 状态` }
    const trimmed = reason.trim()
    if (trimmed.length === 0) return { ok: false, message: '拒绝原因不能为空' }
    this.proposalRepo.reject(id, trimmed.slice(0, 500))
    log.info(`wiki skill rejected: id=${id} reason="${trimmed.slice(0, 80)}"`)
    return { ok: true }
  }

  /**
   * 落盘技能：`<skillsRootDir>/<slug>/{SKILL.md, PURPOSE.md}` + skills 表登记。
   *
   * 幂等：同 root_path 的技能已登记则复用其 id（重复接受不产生重复技能）；
   * 目录已存在但内容不同时覆写文件（草案是最新的，用户看到什么就存什么）。
   */
  private async materialize(
    row: WikiSkillProposalRow,
    draft: { skillMd: string; description: string; triggers: string[] },
  ): Promise<{ skillId: string; rootPath: string }> {
    const rootDir = this.options.skillsRootDir
    if (rootDir == null || rootDir.length === 0) {
      throw new Error('未配置用户技能目录，无法落盘技能')
    }
    const slug = slugifyWikiSkillName(row.name)
    if (slug.length === 0) throw new Error('技能名称无法转换为合法目录名')
    const rootPath = path.join(rootDir, slug)
    const sourcePageIds = this.proposalRepo.parseSourcePageIds(row)

    await fs.mkdir(rootPath, { recursive: true })
    await writeFileAtomic(path.join(rootPath, 'SKILL.md'), draft.skillMd)
    await writeFileAtomic(
      path.join(rootPath, 'PURPOSE.md'),
      buildPurposeMarkdown(row, draft, sourcePageIds, this.pageRepo),
    )

    const existing = this.skillRepo.getByRootPath(rootPath)
    if (existing != null) {
      // 已登记：只刷新 manifest（技能 id 稳定，避免重复条目）
      this.skillRepo.update(existing.id, {
        name: row.name,
        version: existing.version,
        rootPath,
        manifestJson: buildManifestJson(row, draft, sourcePageIds),
      })
      return { skillId: existing.id, rootPath }
    }

    const skillId = `wiki_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    this.skillRepo.create({
      id: skillId,
      scope: 'user',
      name: row.name,
      version: '1.0.0',
      rootPath,
      manifestJson: buildManifestJson(row, draft, sourcePageIds),
      enabled: true,
    })
    return { skillId, rootPath }
  }
}

/** 无 frontmatter 的草稿补一份最小 frontmatter（name + description 是解析器必填项）。 */
function ensureFrontmatter(skillMd: string, name: string, description: string): string {
  if (skillMd.trimStart().startsWith('---')) return skillMd
  const desc = (description || name).replace(/\n/g, ' ').replace(/"/g, "'").slice(0, 400)
  return `---\nname: ${name}\ndescription: "${desc}"\n---\n\n${skillMd.trimStart()}`
}

/** PURPOSE.md：溯源回 wiki_page.id，技能回滚后仍能找回催生它的知识。 */
function buildPurposeMarkdown(
  row: WikiSkillProposalRow,
  draft: { description: string; triggers: string[] },
  sourcePageIds: string[],
  pageRepo: WikiPageRepository,
): string {
  const lines: string[] = [
    '---',
    `name: ${row.name}`,
    `purpose: ${row.purpose.replace(/\n/g, ' ').slice(0, 400)}`,
    `proposal_id: ${row.id}`,
    `created_at: ${new Date(row.created_at).toISOString()}`,
    '---',
    '',
    `# ${row.name} 的创建目的`,
    '',
    row.purpose,
    '',
    '## 溯源：催生本技能的知识页',
    '',
  ]
  if (sourcePageIds.length === 0) {
    lines.push('- （无溯源页面记录）')
  } else {
    for (const id of sourcePageIds) {
      const page = pageRepo.getById(id)
      lines.push(page != null ? `- \`${id}\` — ${page.title}` : `- \`${id}\``)
    }
  }
  if (draft.triggers.length > 0) {
    lines.push('', '## 触发场景', '', draft.triggers.map((t) => `- ${t}`).join('\n'))
  }
  lines.push('')
  return lines.join('\n').slice(0, PURPOSE_MAX_CHARS + 2000)
}

/** skills.manifest_json：与本地导入技能的 manifest 结构兼容（id/desc/source/...） */
function buildManifestJson(
  row: WikiSkillProposalRow,
  draft: { description: string; triggers: string[] },
  sourcePageIds: string[],
): string {
  return JSON.stringify({
    id: `wiki:${row.id}`,
    desc: draft.description,
    description: draft.description,
    source: 'wiki-proposal',
    author: 'wiki',
    category: 'wiki',
    tags: draft.triggers,
    proposalId: row.id,
    sourcePageIds,
    purpose: row.purpose.slice(0, 400),
    importedFrom: 'wiki-skill-proposal',
  })
}

/** 原子写文件（tmp → rename），与 WikiStoreService 同口径。 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`
  await fs.writeFile(tmpPath, content, 'utf-8')
  await fs.rename(tmpPath, filePath)
}

function toProposalView(
  row: WikiSkillProposalRow,
  repo: WikiSkillProposalRepository,
  pageRepo: WikiPageRepository,
): WikiSkillProposalItem | null {
  const draft = repo.parseDraft(row)
  if (draft == null) return null
  const sourcePageIds = repo.parseSourcePageIds(row)
  const sourcePages = sourcePageIds.map((id) => {
    const page = pageRepo.getById(id)
    return {
      id,
      title: page?.title ?? '（页面已删除）',
      kind: (page?.kind ?? 'note') as WikiSkillProposalItem['sourcePages'][number]['kind'],
    }
  })
  return {
    id: row.id,
    scope: row.scope as WikiScope,
    scopeRef: row.scope_ref,
    name: row.name,
    purpose: row.purpose,
    skillMd: draft.skillMd,
    description: draft.description,
    triggers: draft.triggers,
    sourcePageIds,
    status: row.status,
    rejectReason: row.reject_reason,
    skillId: row.skill_id,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    sourcePages,
  }
}
