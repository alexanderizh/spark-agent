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
  'Film Asset Center：角色、场景、道具、分镜与产物归档',
  'Shot Director：相机、角色站位、画幅和运动描述',
  'Prompt Library：镜头、光圈、运镜、色彩、质感提示词',
  'Timeline：镜头顺序、任务状态和版本结果',
  'Storyboard Grid：分镜图、参考图和生成图对照',
  'AI Panel：在画布上下文内拆解任务和创建节点',
  'Operation Panel：文生图、图生图、图生视频、语音等节点化执行',
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
        title="把剧本、镜头和生成任务放回同一张画布"
        intro="无限画布适合剧本、分镜、角色、场景、Prompt、参考素材和生成任务并行推进。"
      >
        <CanvasWorkflow />
      </Section>
      <Section title="画布节点与影视工具区" intro="节点负责组织上下文，工具区负责把上下文转换为可执行任务。">
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
          <article className="card image-card" id="film">
            <img src="/showcase/director-stage.png" alt="Spark Agent 3D 导演台截图" />
            <h3>3D 导演台</h3>
            <p>把角色、站位、相机和构图转换为稳定的镜头描述，再进入图片或视频节点。</p>
          </article>
        </div>
      </Section>
      <Section title="What is Spark Agent infinite canvas?">
        <p className="answer-block">
          It is a visual production surface where scripts, storyboards, prompts, assets, and AI generation
          tasks keep their context and lineage for continuous iteration.
        </p>
      </Section>
    </>
  )
}
