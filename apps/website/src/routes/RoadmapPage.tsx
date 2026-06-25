import { RoadmapTimeline } from '../components/RoadmapTimeline'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
export function RoadmapPage() {
  return (
    <>
      <Seo
        seo={{
          title: '开发计划 - Spark Agent Roadmap',
          description: 'Spark Agent 开发计划：桌面工作台强化、创作工作流模板、生态与协作能力。',
          path: '/roadmap',
          keywords: ['Spark Agent Roadmap', 'AI 工具开发计划', '无限画布路线图'],
        }}
      />
      <Section eyebrow="Roadmap" title="开发计划">
        <RoadmapTimeline />
      </Section>
      <Section title="路线图原则" intro="路线图按可验证能力组织，不把 Provider 依赖能力写成固定承诺。">
        <div className="grid cards">
          <article className="card">
            <h3>先稳工作台</h3>
            <p>优先完善代码开发、任务面板、Provider 配置、画布任务和跨平台打包。</p>
          </article>
          <article className="card">
            <h3>再补模板</h3>
            <p>把影视、PPT、文档、网页和文件处理沉淀成可复用工作流。</p>
          </article>
          <article className="card">
            <h3>最后扩生态</h3>
            <p>围绕 Skills、MCP、团队配置、可选同步和发布市场逐步开放。</p>
          </article>
        </div>
      </Section>
    </>
  )
}
