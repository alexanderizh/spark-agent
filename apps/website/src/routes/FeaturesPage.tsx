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
            '查看 Spark Agent 在内容创作、代码开发、无限画布、影视创作、多媒体生成、多 Agent 协作、MCP 和 Skills 生态上的功能矩阵。',
          path: '/features',
          keywords: ['AI 内容创作', 'AI 办公', 'AI 写代码', 'AI 文档工具', '多 Agent'],
        }}
        jsonLd={faqJsonLd()}
      />
      <Section
        eyebrow="Features"
        title="从创意到交付的完整能力矩阵"
        intro="跨行业内容创作、工程开发与影视资产生产可以在同一个本地优先桌面工作台中协同。"
      >
        <div className="grid cards">
          {featureGroups.map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
      </Section>
      <Section
        title="代码分析依据"
        intro="首版官网明确标注功能来源，避免对 Provider 依赖能力过度承诺。"
      >
        <div className="evidence">
          {codeEvidence.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      </Section>
      <Section title="AI 搜索友好问答">
        <FAQ />
      </Section>
    </>
  )
}
