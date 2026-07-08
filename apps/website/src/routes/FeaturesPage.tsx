import { ArchitectureMap } from '../components/ArchitectureMap'
import { FAQ, faqJsonLd } from '../components/FAQ'
import { FeatureCard } from '../components/FeatureCard'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { codeEvidence, featureGroups } from '../content/features'

const featureFlow = [
  ['组织任务', '把一次需求拆成单 Agent、工作流或团队模式。'],
  ['注入能力', '按任务挂载 Provider、MCP、Skills、规则和权限边界。'],
  ['执行真实操作', '读取项目、运行命令、控制浏览器、访问画布与媒体任务。'],
  ['审查过程', '检查 diff、日志、任务面板、审批与审计记录。'],
  ['复用成果', '把稳定做法沉淀为模板、Agent 配置和可复用资产。'],
]

export function FeaturesPage() {
  return (
    <>
      <Seo
        seo={{
          title: '功能 - Spark Agent AI 内容创作工作台',
          description:
            '了解 Spark Agent 如何把可执行工作流、代码开发、团队 Agent、权限治理、无限画布、多媒体生成、MCP 和 Skills 放进一个本地优先工作台。',
          path: '/features',
          keywords: ['AI 工作流', 'AI 内容创作', 'AI 办公', 'AI 写代码', 'AI 文档工具', '多 Agent'],
        }}
        jsonLd={faqJsonLd()}
      />
      <Section
        eyebrow="功能总览"
        title="覆盖工作流、开发、协作和创作的完整工作台"
        intro="从修复代码到生成视觉资产，Spark Agent 把常用 AI 流程做成可执行、可审查、可复用的桌面工作流。"
      >
        <div className="grid cards">
          {featureGroups.map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
      </Section>
      <Section
        title="功能不是散点，而是一条执行流程"
        intro="Spark Agent 的重点不是堆很多按钮，而是把复杂任务稳定地走完。下面这条链路描述的是产品能力如何协同工作。"
      >
        <div className="workflow">
          {featureFlow.map(([step, detail], index) => (
            <div className="workflow-step" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section
        title="能力如何落在系统结构里"
        intro="同一个桌面工作台承接界面、运行时、工具链和本地数据层，所以开发、协作、创作这三类任务可以共用一套执行底座。"
      >
        <ArchitectureMap />
      </Section>
      <Section
        title="为什么值得信任"
        intro="Spark Agent 的核心设计围绕本地优先、过程可见和能力可扩展展开。模型服务能力会按你的配置和服务商限制生效。"
      >
        <div className="evidence">
          {codeEvidence.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      </Section>
      <Section title="常见问题">
        <FAQ />
      </Section>
    </>
  )
}
