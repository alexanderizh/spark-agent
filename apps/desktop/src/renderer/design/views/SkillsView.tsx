/**
 * SkillsView — Skill 卡片网格
 */
import { useEffect, useState } from 'react'
import { Icons } from '../Icons'

type SkillSetting = {
  id: string
  name: string
  desc: string
  source: string
  enabled: boolean
}

const SKILLS_KEY = 'spark-skills'

export function SkillsView() {
  const [skills, setSkills] = useState<SkillSetting[]>(() => {
    const saved = localStorage.getItem(SKILLS_KEY)
    return saved ? (JSON.parse(saved) as SkillSetting[]) : []
  })

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === SKILLS_KEY && e.newValue) {
        setSkills(JSON.parse(e.newValue) as SkillSetting[])
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

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

      {skills.length === 0 ? (
        <div className="muted" style={{ textAlign: 'center', padding: '48px 0', fontSize: 13 }}>
          暂无 Skill，请在设置中管理
        </div>
      ) : (
        <div className="skill-grid">
          {skills.map((s) => <SkillCard key={s.id} skill={s} />)}
        </div>
      )}
    </div>
  )
}

function SkillCard({ skill }: { skill: SkillSetting }) {
  return (
    <div className="skill-card">
      <div className="icon-wrap">{skill.name.charAt(0).toUpperCase()}</div>
      <div className="row" style={{ gap: 6 }}>
        <span className="name">{skill.name}</span>
        <span className="badge" style={{ fontSize: 10 }}>{skill.source}</span>
      </div>
      <div className="desc">{skill.desc}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className={`badge ${skill.enabled ? 'success' : ''}`} style={{ fontSize: 9.5, height: 16 }}>
          {skill.enabled ? '已启用' : '已禁用'}
        </span>
      </div>
      <div className="foot">
        <span>{skill.source}</span>
        <div className="flex1" />
        <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.Play size={11} /></button>
        <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.More size={11} /></button>
      </div>
    </div>
  )
}
