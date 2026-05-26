/**
 * SkillsView — Skill 卡片网格
 */
import { Icons } from '../Icons'

type Skill = {
  letter: string
  name: string
  scope: string
  desc: string
  version: string
  triggers: string
  perms: string[]
}

const SKILLS: Skill[] = [
  { letter: 'C', name: 'code-review', scope: 'System', desc: '按严重度排序的代码审查报告，输出可修复 patch', version: '1.4.2', triggers: '/review', perms: ['fs:read'] },
  { letter: 'T', name: 'test-runner', scope: 'System', desc: '检测项目测试框架，运行并解析失败堆栈', version: '1.2.0', triggers: '/test', perms: ['shell'] },
  { letter: 'P', name: 'pdf-reader', scope: 'User', desc: '解析 PDF 为结构化 markdown，含表格识别', version: '0.7.1', triggers: '/read-pdf', perms: ['fs:read'] },
  { letter: 'D', name: 'deck-builder', scope: 'User', desc: '从大纲生成 keynote / pptx 风格幻灯片', version: '0.5.0', triggers: '/deck', perms: ['fs:write'] },
  { letter: 'M', name: 'migration', scope: 'Team', desc: '团队规范的数据库迁移脚本生成器', version: '2.0.0-rc1', triggers: '/migrate', perms: ['fs:write', 'shell'] },
  { letter: 'R', name: 'release-notes', scope: 'Team', desc: '从 git log 生成发布说明（中英双语）', version: '1.1.0', triggers: '/release', perms: ['shell'] },
  { letter: 'A', name: 'arch-diagram', scope: 'Project', desc: '从代码扫描结果生成 Mermaid 架构图', version: '0.3.4', triggers: '/diagram', perms: ['fs:read'] },
  { letter: 'B', name: 'bug-triage', scope: 'Project', desc: 'GitHub Issue 自动分类与责任人推荐', version: '0.2.0', triggers: '/triage', perms: ['net'] },
]

export function SkillsView() {
  return (
    <div className="page">
      <div className="row" style={{ gap: 12, marginBottom: 18 }}>
        <div className="flex1">
          <div className="strong" style={{ fontSize: 18 }}>Skills</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>8 个已安装 · 由 Spark Agent 系统、用户和项目提供</div>
        </div>
        <div className="search-input"><Icons.Search /><input placeholder="搜索 Skill..." /></div>
        <button className="btn"><Icons.Globe size={12} /> Skill 商店</button>
        <button className="btn primary"><Icons.Plus size={12} /> 创建 Skill</button>
      </div>

      <div className="skill-grid">
        {SKILLS.map((s) => <SkillCard key={s.name} skill={s} />)}
      </div>
    </div>
  )
}

function SkillCard({ skill }: { skill: Skill }) {
  return (
    <div className="skill-card">
      <div className="icon-wrap">{skill.letter}</div>
      <div className="row" style={{ gap: 6 }}>
        <span className="name">{skill.name}</span>
        <span className="badge" style={{ fontSize: 10 }}>{skill.scope}</span>
      </div>
      <div className="desc">{skill.desc}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="mono-sm faint" style={{ fontSize: 11 }}>{skill.triggers}</span>
        {skill.perms.map((p) => (
          <span key={p} className="badge" style={{ fontSize: 9.5, height: 16 }}>{p}</span>
        ))}
      </div>
      <div className="foot">
        <span>v{skill.version}</span>
        <div className="flex1" />
        <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.Play size={11} /></button>
        <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.More size={11} /></button>
      </div>
    </div>
  )
}
