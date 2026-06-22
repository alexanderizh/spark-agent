import { CanvasWorkflow } from '../components/CanvasWorkflow'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
const nodeTypes = [
  '文本节点',
  '图片节点',
  '视频节点',
  'Prompt 节点',
  '文件节点',
  '任务节点',
  '资产节点',
]
const tools = [
  'Film Asset Center',
  'Shot Director',
  'Prompt Library',
  'Timeline',
  'Storyboard Grid',
  'AI Panel',
  'Operation Panel',
]
export function CanvasPage() {
  return (
    <>
      <Seo
        seo={{
          title: '无限画布 - Spark Agent AI 影视创作工作台',
          description:
            'Spark Agent 无限画布用于影视创作，组织剧本、角色、场景、镜头、分镜、Prompt、生成任务和多媒体资产。',
          path: '/canvas',
          keywords: ['AI 无限画布', 'AI 影视创作', 'AI 分镜', 'AI 剧本创作', 'Storyboard'],
        }}
      />
      <Section
        eyebrow="Infinite Canvas"
        title="从一个想法到完整影片资产，全部发生在无限画布上"
        intro="无限画布是 Spark Agent 最有辨识度的创作中枢，尤其适合剧本、分镜、镜头、角色和生成任务并行推进。"
      >
        <CanvasWorkflow />
      </Section>
      <Section title="画布节点与影视工具区">
        <div className="grid cards">
          <article className="card">
            <h3>节点类型</h3>
            <ul>
              {nodeTypes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </article>
          <article className="card">
            <h3>影视工具区</h3>
            <ul>
              {tools.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </article>
          <article className="card placeholder">
            <h3>插图占位</h3>
            <p>预留画布大图、角色资产中心、镜头规划和任务队列截图位置。</p>
          </article>
        </div>
      </Section>
      <Section title="What is Spark Agent infinite canvas?">
        <p className="answer-block">
          It is a visual production surface where scripts, storyboards, prompts, assets, and AI
          generation tasks keep their context and lineage for continuous iteration.
        </p>
      </Section>
    </>
  )
}
