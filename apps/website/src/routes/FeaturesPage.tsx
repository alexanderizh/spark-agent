import { FAQ, faqJsonLd } from '../components/FAQ'
import { FeatureCard } from '../components/FeatureCard'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { codeEvidence, featureGroups } from '../content/features'
export function FeaturesPage() {
  return (
    <>
      <Seo
        seo={{
          title: '功能 - Spark Agent AI 内容创作工作台',
          description:
            '了解 Spark Agent 如何把代码开发、团队 Agent、权限治理、无限画布、多媒体生成、MCP 和 Skills 放进一个本地优先工作台。',
          path: '/features',
          keywords: ['AI 内容创作', 'AI 办公', 'AI 写代码', 'AI 文档工具', '多 Agent'],
        }}
        jsonLd={faqJsonLd()}
      />
      <Section
        eyebrow="功能总览"
        title="覆盖开发、协作和创作的完整工作台"
        intro="从修复代码到生成视觉资产，Spark Agent 把常用 AI 工作流放到可审查、可扩展、可长期使用的桌面环境里。"
      >
        <div className="grid cards">
          {featureGroups.map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
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
