/**
 * WikiRepoEnrich — Repo Wiki 页面「AI 导读」块（S0–S2 后端的渲染端收尾）。
 *
 * 页面级状态机（判定输入全部由父级供齐，组件自身无副作用）：
 *   S1 有导读   section != null && !running → 淡底块 + 标签行 + 三小节 markdown
 *   S2 入口行   section == null && !running → 虚线行「生成 AI 导读」
 *   S3 生成中   running && section == null  → 同容器骨架（用户主动 / 空间级增强中）
 *   S4 重生成   running && section != null → 旧内容即刻让位骨架
 *   查询中     section === undefined      → 不渲染（避免入口闪一下又被内容顶掉）
 *
 * 信任标注：标签行承担「AI 生成」身份（Sparkles 主色 + 「AI 导读」），并常显
 * 生成依据的代码版本短 hash（@a1b2c3d）；完整溯源（模型 / 时间 / 版本前进后
 * 自动重生成）收进 ⓘ Tooltip——AI 内容需可溯源，不与人工内容混淆。
 *
 * 图标纪律：全部走 Icons 体系（Sparkles / HelpCircle / Refresh），不使用 emoji。
 */

import { Tooltip } from 'antd'
import type { WikiRepoEnrichmentProgress, WikiRepoEnrichmentSection } from '@spark/protocol'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'

/** 完整 rev → 展示用短 hash（如 a1b2c3d4… → @a1b2c3d）。 */
function revTag(rev: string): string | null {
  if (rev.length === 0) return null
  return `@${rev.slice(0, 7)}`
}

function formatEnrichTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

export interface WikiRepoEnrichBlockProps {
  /** undefined = 查询中（不渲染）；null = 已确认无导读；对象 = 有导读 */
  section: WikiRepoEnrichmentSection | null | undefined
  /** 生成中（S3 骨架 / S4 旧内容让位），入口与 ↻ 同时禁用 */
  running: boolean
  /** 入口行 / ↻ 共用触发：单页强制重跑（不受总闸限制） */
  onRun: () => void
}

export function WikiRepoEnrichBlock({ section, running, onRun }: WikiRepoEnrichBlockProps) {
  if (section === undefined) return null

  // S2：无导读且不在生成 → 虚线入口行（总闸默认关时单页体验的唯一可发现性入口）
  if (section == null && !running) {
    return (
      <button type="button" className="wiki_repo_enrich_entry" onClick={onRun}>
        <Icons.Sparkles size={13} />
        <span className="wiki_repo_enrich_entry_text">生成 AI 导读</span>
        <span className="wiki_repo_enrich_entry_hint">模块职责 / 关键入口 / 依赖关系</span>
      </button>
    )
  }

  const rev = section?.repoRev ?? null
  const tag = rev != null ? revTag(rev) : null
  const origin =
    section != null
      ? `基于代码版本 \`${section.repoRev}\` · ${section.model ?? '默认渠道'} · ${formatEnrichTime(
          section.updatedAt,
        )} 生成；代码版本前进后自动重新生成`
      : 'AI 导读基于模块结构生成，完成后自动展示'

  return (
    <div className="wiki_repo_enrich">
      <div className="wiki_repo_enrich_head">
        <span className="wiki_repo_enrich_label">
          <Icons.Sparkles size={12} />
          {running ? 'AI 导读生成中…' : 'AI 导读'}
        </span>
        {tag != null && (
          <span className="wiki_repo_enrich_rev">
            <i className="wiki_repo_enrich_dot" />
            {tag}
          </span>
        )}
        <span className="wiki_repo_enrich_acts">
          <Tooltip title={origin} overlayStyle={{ maxWidth: 340 }}>
            <button
              type="button"
              className="wiki_repo_enrich_ib"
              aria-label="AI 导读说明"
              onClick={(e) => e.currentTarget.blur()}
            >
              <Icons.HelpCircle size={13} />
            </button>
          </Tooltip>
          <button
            type="button"
            className="wiki_repo_enrich_ib"
            title="重新生成 AI 导读"
            aria-label="重新生成 AI 导读"
            disabled={running}
            onClick={onRun}
          >
            <Icons.Refresh size={13} />
          </button>
        </span>
      </div>
      {running || section == null ? (
        <div className="wiki_repo_enrich_skeleton">
          <div className="wiki_repo_enrich_sk" />
          <div className="wiki_repo_enrich_sk" />
          <div className="wiki_repo_enrich_sk" />
        </div>
      ) : (
        <div className="wiki_repo_enrich_body">
          <MarkdownText content={section.section} />
        </div>
      )}
    </div>
  )
}

/**
 * 空间级进度 pill（顶栏，漂移 pill 左侧）：仅增强进行中由父级渲染。
 * 文案「AI 导读 {已处理}/{总数}」，hover 给就绪 / 失败 / 待生成明细。
 */
export function WikiRepoEnrichPill({ progress }: { progress: WikiRepoEnrichmentProgress }) {
  const done = progress.ready + progress.failed
  const total = done + progress.pending
  return (
    <Tooltip
      title={`AI 导读生成中 — 就绪 ${progress.ready} · 失败 ${progress.failed} · 待生成 ${progress.pending}`}
    >
      <span className="wiki_repo_enrich_pill">
        <Icons.Sparkles size={11} />
        AI 导读 {done}/{total}
      </span>
    </Tooltip>
  )
}
