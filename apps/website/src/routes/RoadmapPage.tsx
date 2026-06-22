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
    </>
  )
}
