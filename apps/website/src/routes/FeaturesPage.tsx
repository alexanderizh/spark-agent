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
        title="从代码到创作的能力矩阵"
        intro="每组能力都标出入口、依赖模块和适用场景，方便判断哪些已经落地，哪些依赖 Provider 能力。"
      >
        <div className="grid cards">
          {featureGroups.map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
      </Section>
      <Section
        title="代码分析依据"
        intro="官网文案按当前仓库结构整理，Provider 相关能力保留能力边界说明。"
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
