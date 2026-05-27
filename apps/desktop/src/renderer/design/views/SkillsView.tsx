/**
 * SkillsView — Skill 卡片网格
 *
 * Data source: real IPC via shared useSkills hook.
 */
import { useState } from 'react'
import type { SkillItem } from '@spark/protocol'
import { Icons } from '../Icons'
import { SparkInput } from '../components/FormControls'
import { useApp } from '../AppContext'
import {
  useSkills,
  parseSkillManifest,
  filterSkills,
} from '../utils/skills-data'

export function SkillsView() {
  const { setTweak } = useApp()
  const { skills, loading, error, toggleSkill, total, enabledCount } =
    useSkills()
  const [search, setSearch] = useState('')

  const filtered = filterSkills(skills, search)

  return (
    <div className="view-body">
      <div className="page">
        {/* ── Header row ── */}
        <div className="row section-header-row">
          <div className="flex1">
            <div className="strong header-title-lg">
              Skills
            </div>
            <div className="muted header-desc">
              {total} 个已安装 · {enabledCount} 个已启用
            </div>
          </div>

          <div className="search-input">
            <Icons.Search />
            <SparkInput
              placeholder="搜索 Skill..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon-btn skills-spinner-sm"
                onClick={() => setSearch('')}
              >
                <Icons.X size={10} />
              </button>
            )}
          </div>

          <button className="btn" onClick={() => setTweak('view', 'skill-store')}>
            <Icons.Globe size={12} /> Skill 商店
          </button>
          <button className="btn primary" onClick={() => setTweak('view', 'skill-store')}>
            <Icons.Plus size={12} /> 创建 Skill
          </button>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div
            className="card card-error"
          >
            {error}
          </div>
        )}

        {/* ── Content ── */}
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Icons.Sparkles />
            </div>
            <div className="empty-title">正在加载 Skills...</div>
          </div>
        ) : total === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Icons.Zap />
            </div>
            <div className="empty-title">暂无 Skill</div>
            <div className="empty-desc">
              安装 Skill 以扩展 Agent 能力，支持代码生成、文件操作等场景
            </div>
            <div className="empty-actions">
              <button className="empty-action-btn">
                <Icons.Plus size={12} /> 创建 Skill
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Icons.Search />
            </div>
            <div className="empty-title">未找到匹配的 Skill</div>
            <div className="empty-desc">
              尝试其他关键词搜索
            </div>
          </div>
        ) : (
          <div className="skill-grid">
            {filtered.map((s) => (
              <SkillCard key={s.id} skill={s} onToggle={toggleSkill} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SkillCard({
  skill,
  onToggle,
}: {
  skill: SkillItem
  onToggle: (skill: SkillItem) => void
}) {
  const meta = parseSkillManifest(skill.manifestJson)
  return (
    <div className="skill-card">
      <div className="icon-wrap">{skill.name.charAt(0).toUpperCase()}</div>
      <div className="row row-gap-xs">
        <span className="name">{skill.name}</span>
        <span className="badge badge-font-sm">
          {meta.source}
        </span>
      </div>
      <div className="desc">{meta.desc}</div>
      <div className="row skill-scope-row skill-tools-row">
        <span
          className={`badge ${skill.enabled ? 'success' : ''} tool-chip-sm`}
          onClick={() => onToggle(skill)}
        >
          {skill.enabled ? '系统可见' : '系统隐藏'}
        </span>
        {skill.id === 'builtin:superpowers' && <span className="badge">可在会话关闭</span>}
      </div>
      <div className="foot">
        <span>
          {meta.source} · {skill.version}
        </span>
        <div className="flex1" />
        <button className="icon-btn skill-card-detail-btn">
          <Icons.Play size={11} />
        </button>
        <button className="icon-btn skill-card-toggle">
          <Icons.More size={11} />
        </button>
      </div>
    </div>
  )
}
