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

const showcase = [
  {
    src: '/showcase/workbench-overview.png',
    title: '把 AI 工作流留在你的项目里',
    text: '对话、工作流、代码、终端、文件改动、任务审查和权限审批都在同一个桌面窗口完成，过程清楚可追踪。',
  },
  {
    src: '/showcase/workflow-orchestration.png',
    title: '像搭积木一样安排复杂任务',
    text: '把需求输入、计划、执行、审批、验证、复核和交付物做成可复用工作流，常用流程下次直接运行。',
  },
  {
    src: '/showcase/code-review.png',
    title: '内建代码审计与变更审查',
    text: '桌面端直接对比 develop 与 origin/develop 的差异，逐文件确认改动；关键步骤会保留代码还原点，出问题时可回到稳定版本后再继续提交或生成 Pull Request。',
  },
  {
    src: '/showcase/agents.png',
    title: '为不同任务配置专属 Agent',
    text: '按项目选择模型、技能、工具和工作目录，让编码、审查、调研和内容任务交给合适的助手。',
  },
  {
    src: '/showcase/providers.png',
    title: '统一管理模型与服务商',
    text: '把文本、图片、视频和本地模型接入到同一套 Provider 配置里，团队工作流不用反复切换工具。',
  },
  {
    src: '/showcase/infinite-canvas.png',
    title: '让创作过程可视化',
    text: '剧本、角色、场景、分镜、提示词和生成结果保留在画布上，方便复用、追溯和继续迭代。',
  },
  {
    src: '/showcase/ppt-docs.png',
    title: '一句话生成可交付的文档与幻灯片',
    text: '在会话里直接产出 PPT 与文档草稿，左侧对话驱动生成、右侧实时预览幻灯片，满意即可导出 HTML 使用。',
  },
  {
    src: '/showcase/remote-connection.png',
    title: '把远程会话接进桌面端',
    text: '通过 Telegram、飞书在远程桌面或移动端继续与 Spark Agent 通信，消息按平台路由进入默认会话，跨设备也能保持上下文。',
  },
]

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
  '会沉淀会进化的长期记忆',
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
        title="功能展示"
        intro="下面展示的是桌面端实际界面：从开发任务到内容生产，你看到的就是日常使用时的工作方式。"
      >
        <div className="showcase-grid">
          {showcase.map((item) => (
            <article className="showcase-card" key={item.title}>
              <img src={item.src} alt={item.title} loading="lazy" decoding="async" />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </Section>
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
