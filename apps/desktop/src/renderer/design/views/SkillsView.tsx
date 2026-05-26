/**
 * SkillsView — Skill 卡片网格
 */
import { useCallback, useEffect, useState } from 'react'
import type { SkillItem } from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'

function parseSkillManifest(manifestJson: string): { desc: string; source: string } {
  try {
    const parsed = JSON.parse(manifestJson) as { desc?: string; description?: string; source?: string }
    return {
      desc: parsed.desc ?? parsed.description ?? 'Skill 能力模块',
      source: parsed.source ?? '自定义',
    }
  } catch {
    return { desc: 'Skill 能力模块', source: '自定义' }
  }
}

export function SkillsView() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [error, setError] = useState('')
  const { invoke: listSkills, loading } = useIpcInvoke('skill:list')

  const refresh = useCallback(() => {
    setError('')
    listSkills({})
      .then((res) => setSkills(res.skills))
      .catch((err) => setError(err instanceof Error ? err.message : '加载 Skills 失败'))
  }, [listSkills])

  useEffect(() => {
    refresh()
  }, [refresh])

  const enabledCount = skills.filter((s) => s.enabled).length

  return (
    <div className="page">
      <div className="row" style={{ gap: 12, marginBottom: 18 }}>
        <div className="flex1">
          <div className="strong" style={{ fontSize: 18 }}>Skills</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {skills.length} 个已安装 · {enabledCount} 个已启用
          </div>
        </div>
        <div className="search-input"><Icons.Search /><input placeholder="搜索 Skill..." /></div>
        <button className="btn"><Icons.Globe size={12} /> Skill 商店</button>
        <button className="btn primary"><Icons.Plus size={12} /> 创建 Skill</button>
      </div>

      {error && <div className="card" style={{ marginBottom: 14, padding: '10px 12px', color: 'var(--danger)', fontSize: 12 }}>{error}</div>}

      {loading ? (
        <div className="muted" style={{ textAlign: 'center', padding: '48px 0', fontSize: 13 }}>
          正在加载 Skills...
        </div>
      ) : skills.length === 0 ? (
        <div className="muted" style={{ textAlign: 'center', padding: '48px 0', fontSize: 13 }}>
          暂无 Skill
        </div>
      ) : (
        <div className="skill-grid">
          {skills.map((s) => <SkillCard key={s.id} skill={s} />)}
        </div>
      )}
    </div>
  )
}

function SkillCard({ skill }: { skill: SkillItem }) {
  const meta = parseSkillManifest(skill.manifestJson)
  return (
    <div className="skill-card">
      <div className="icon-wrap">{skill.name.charAt(0).toUpperCase()}</div>
      <div className="row" style={{ gap: 6 }}>
        <span className="name">{skill.name}</span>
        <span className="badge" style={{ fontSize: 10 }}>{meta.source}</span>
      </div>
      <div className="desc">{meta.desc}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className={`badge ${skill.enabled ? 'success' : ''}`} style={{ fontSize: 9.5, height: 16 }}>
          {skill.enabled ? '已启用' : '已禁用'}
        </span>
      </div>
      <div className="foot">
        <span>{meta.source} · {skill.version}</span>
        <div className="flex1" />
        <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.Play size={11} /></button>
        <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.More size={11} /></button>
      </div>
    </div>
  )
}
