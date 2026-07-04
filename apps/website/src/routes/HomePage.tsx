import { ArchitectureMap } from '../components/ArchitectureMap'
import { CanvasWorkflow } from '../components/CanvasWorkflow'
import { DownloadPanel } from '../components/DownloadPanel'
import { FAQ, faqJsonLd } from '../components/FAQ'
import { FeatureCard } from '../components/FeatureCard'
import { HeroDownloadButton } from '../components/HeroDownloadButton'
import { HeroAppMockup } from '../components/HeroAppMockup'
import { ProviderMarquee } from '../components/ProviderMarquee'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { codeEvidence, featureGroups } from '../content/features'

const executionFlow = [
  ['提出目标', '在桌面会话里直接说需求，或从工作流模板开始。'],
  ['选择执行方式', '单 Agent、团队模式、工作流节点执行都可以混用。'],
  ['调用真实工具', '文件、终端、搜索、浏览器、画布、媒体能力在同一运行时里协同。'],
  ['审查与回退', '检查终端输出、文件预览、Git diff、任务状态，必要时回退到稳定点。'],
  ['沉淀为资产', '把结果留下来：代码、文档、网页、幻灯片、媒体产物和长期记忆。'],
]

const docsRoadmap = [
  ['快速开始', '/docs/quick-start'],
  ['代码开发', '/docs/code-development'],
  ['Agent 工作流', '/docs/agents-workflows'],
  ['团队模式', '/docs/team-mode'],
  ['浏览器自动化', '/docs/browser-automation'],
  ['桌面端架构', '/docs/desktop-guide'],
]

const taskExecutionFeatureTitles = new Set([
  '可真实执行的工作流编排',
  '360 全景面板统一方案',
  'A2A 团队模式',
  '双内核执行体系',
  '调试模式与内置工具链',
  '透明审计与可控自动化',
  '多层级环境、规则与权限',
])

const taskExecutionFeatures = featureGroups.filter((g) => taskExecutionFeatureTitles.has(g.title))
const canvasCreationFeatures = featureGroups.filter((g) => !taskExecutionFeatureTitles.has(g.title))

export function HomePage() {
  return (
    <>
      <Seo jsonLd={faqJsonLd()} />
      <section className="hero enhanced-hero">
        <div className="hero-text">
          <h1>Spark Agent</h1>
          <p className="hero-subtitle">
            本地优先的桌面端 AI Agent 工作台。把代码开发、办公文档、主题调研、多媒体创作和可重复执行的工作流放进同一个可审查的工作台。
          </p>
          <div className="cta">
            <HeroDownloadButton />
          </div>
        </div>
        <HeroAppMockup />
      </section>
      <section className="pmq-band" aria-label="已接入的大模型平台">
        <ProviderMarquee />
      </section>
      <section className="section">
        <div className="feature-groups">
          <div className="feature-group-block">
            <div className="feature-group-heading">
              <h2>任务执行工作台</h2>
            </div>
            <div className="grid cards feature-grid-wide">
              {taskExecutionFeatures.map((g) => (
                <FeatureCard key={g.title} {...g} />
              ))}
            </div>
          </div>

          <div className="feature-group-block">
            <div className="feature-group-heading">
              <h2>画布与内容创作</h2>
            </div>
            <div className="grid cards feature-grid-wide">
              {canvasCreationFeatures.map((g) => (
                <FeatureCard key={g.title} {...g} />
              ))}
            </div>
          </div>
        </div>
      </section>
      <Section
        title="从目标到交付的执行链路"
        intro="官网先讲结构，不靠过时截图。你可以把 Spark Agent 理解为一个把任务描述、真实执行、过程审查和结果沉淀串起来的桌面运行时。"
      >
        <div className="workflow">
          {executionFlow.map(([step, detail], index) => (
            <div className="workflow-step" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section
        title="面向长期使用的本地架构"
        intro="桌面端、Agent Runtime、权限治理、画布和媒体运行时协同工作，让自动化过程既能扩展，也能被审查和回退。"
      >
        <ArchitectureMap />
        <div className="evidence">
          <h3>可信基础</h3>
          <ul>
            {codeEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </Section>
      <Section
        title="代码、内容和资产可以连续流转"
        intro="你可以先让 Agent 修改代码、跑验证和整理结论，再把项目素材放入画布，继续生成视觉资产、视频和交付物。"
      >
        <CanvasWorkflow />
      </Section>
      <Section
        title="推荐阅读路径"
        intro="如果你第一次接触 Spark Agent，按这条路径读官网文档会更快建立整体心智模型。"
      >
        <div className="link-list large">
          {docsRoadmap.map(([label, href]) => (
            <a href={href} key={label}>
              {label}
            </a>
          ))}
        </div>
      </Section>
      <Section
        title="选择你的桌面版本"
        intro="支持 macOS 与 Windows。页面会识别当前系统，并优先推荐对应安装包。"
      >
        <DownloadPanel />
      </Section>
      <Section title="常见问题">
        <FAQ />
      </Section>
    </>
  )
}
