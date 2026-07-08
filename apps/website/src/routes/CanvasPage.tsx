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
  '资产中心：归档角色、场景、道具、分镜和生成结果',
  '导演台：规划相机、角色站位、画幅和运动描述',
  '提示词库：沉淀镜头、光圈、运镜、色彩和质感语言',
  '时间线：查看镜头顺序、任务状态和版本结果',
  '分镜网格：对照分镜图、参考图和生成图',
  'AI 面板：在画布上下文内拆解任务并创建节点',
  '操作面板：节点化执行文生图、图生图、图生视频和语音任务',
]
export function CanvasPage() {
  return (
    <>
      <Seo
        seo={{
          title: '无限画布 - Spark Agent AI 影视创作工作台',
          description:
            'Spark Agent 无限画布帮助团队组织剧本、角色、场景、镜头、分镜、Prompt、生成任务和多媒体资产。',
          path: '/canvas',
          keywords: ['AI 无限画布', 'AI 影视创作', 'AI 分镜', 'AI 剧本创作', 'Storyboard'],
        }}
      />
      <Section
        eyebrow="无限画布"
        title="把创作素材和生成任务放回同一张画布"
        intro="适合影视分镜、营销视觉、课程内容和多媒体项目：剧本、参考素材、Prompt、任务和结果都能在画布上连续推进。"
      >
        <CanvasWorkflow />
      </Section>
      <Section title="用节点组织上下文，用工具推进生产" intro="节点记录素材和关系，工具把这些上下文转换成可执行、可复盘的生成任务。">
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
            <h3>创作工具区</h3>
            <ul>
              {tools.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </article>
        </div>
      </Section>
      <Section title="画布里的真实工作场景" intro="下面是 Spark Agent 桌面端截图，展示导演台、资产中心和 360 全景预览如何服务同一个项目。">
        <div className="grid cards canvas-gallery">
          <article className="card image-card" id="film">
            <img src="/showcase/director-stage.png" alt="Spark Agent 3D 导演台截图" loading="lazy" decoding="async" />
            <h3>3D 导演台</h3>
            <p>先规划角色站位、相机和构图，再生成稳定的镜头描述，减少反复试错。</p>
          </article>
          <article className="card image-card">
            <img src="/showcase/asset-center.png" alt="Spark Agent 画布资产中心截图" loading="lazy" decoding="async" />
            <h3>画布资产中心</h3>
            <p>集中查看每条分镜的角色、场景、镜头描述与生成结果，方便比较版本并沉淀可复用资产。</p>
          </article>
          <article className="card image-card">
            <img src="/showcase/panorama-360.png" alt="Spark Agent 360 全景预览截图" loading="lazy" decoding="async" />
            <h3>360 全景预览</h3>
            <p>在继续生成前确认空间关系、光线方向和材质细节，让后续镜头保持一致。</p>
          </article>
        </div>
      </Section>
      <Section title="Spark Agent 无限画布是什么？">
        <p className="answer-block">
          它是一张可持续迭代的视觉生产台：剧本、分镜、提示词、素材和 AI 生成任务会保留上下文与来源关系，方便团队继续修改、派生和复用。
        </p>
      </Section>
    </>
  )
}
