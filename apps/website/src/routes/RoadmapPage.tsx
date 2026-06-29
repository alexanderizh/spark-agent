import { RoadmapTimeline } from '../components/RoadmapTimeline'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
export function RoadmapPage() {
  return (
    <>
      <Seo
        seo={{
          title: '开发计划 - Spark Agent Roadmap',
          description: '了解 Spark Agent 的产品路线：桌面工作台、创作工作流模板、生态扩展和团队协作能力。',
          path: '/roadmap',
          keywords: ['Spark Agent Roadmap', 'AI 工具开发计划', '无限画布路线图'],
        }}
      />
      <Section eyebrow="路线图" title="产品路线">
        <RoadmapTimeline />
      </Section>
      <Section title="路线图原则" intro="我们优先交付可验证、可长期维护的能力；依赖第三方模型服务的功能会保留清晰边界。">
        <div className="grid cards">
          <article className="card">
            <h3>先打磨核心工作台</h3>
            <p>优先完善代码开发、任务面板、模型配置、画布任务和跨平台安装体验。</p>
          </article>
          <article className="card">
            <h3>再沉淀高频工作流</h3>
            <p>把影视、演示文稿、文档、网页和文件处理沉淀成可复用模板。</p>
          </article>
          <article className="card">
            <h3>持续扩展生态</h3>
            <p>围绕 Skills、MCP、团队配置、可选同步和发布市场逐步开放。</p>
          </article>
        </div>
      </Section>
    </>
  )
}
