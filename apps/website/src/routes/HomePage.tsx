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
import { GITHUB_URL } from '../lib/links'

const showcase = [
  {
    src: '/showcase/workbench-overview.png',
    title: '统一工作台',
    text: '聊天、代码、终端、文件改动、Git Review 与权限面板在同一桌面上下文里协同。',
  },
  {
    src: '/showcase/agents.png',
    title: '团队 Agent 管理',
    text: '为每个项目挑选或自定义 Agent，挂载 Skills、模型与工作目录，把不同任务交给最合适的 Agent。',
  },
  {
    src: '/showcase/providers.png',
    title: '模型与 Provider 配置',
    text: 'GLM、Claude、DeepSeek、Codex、Grok、xAI 图像 / 视频模型一处配置，所有 Agent 即时可用。',
  },
  {
    src: '/showcase/infinite-canvas.png',
    title: '无限画布创作',
    text: '剧本、角色、场景、镜头、生成任务与媒体产物在画布上形成可视化生产线。',
  },
]

export function HomePage() {
  return (
    <>
      <Seo jsonLd={faqJsonLd()} />
      <section className="hero enhanced-hero">
        <div className="hero-text">
          <h1>Spark Agent</h1>
          <p className="hero-subtitle">
            一个本地优先的桌面工作台，把代码开发、团队 Agent、运行时治理和无限画布放在一起。
          </p>
          <div className="cta">
            <HeroDownloadButton />
          </div>
        </div>
        <HeroAppMockup />
      </section>
      <section className="pmq-band" aria-label="已接入的大模型平台">
        <div className="pmq-head">
          <p className="eyebrow">已接入</p>
          <h2>原生支持主流大模型平台</h2>
          <p className="section-intro">
            30+ 平台一键接入，覆盖国际与国内主流大模型，OpenAI / Anthropic 兼容协议自动适配，本地模型同样可用。
          </p>
        </div>
        <ProviderMarquee />
      </section>
      <Section
        title="一个工作台，四条主线"
        intro="Spark Agent 的定位不是单点聊天，而是把开发闭环、团队 Agent、平台治理和无限画布创作放在一起。"
      >
        <div className="grid cards feature-grid-wide">
          {featureGroups.map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
      </Section>
      <Section
        title="从统一开发面板到画布生产线"
        intro="同一个桌面工作台，从写第一行代码到产出第一支视频——以下是真实运行界面，所见即所得。"
      >
        <div className="showcase-grid">
          {showcase.map((item) => (
            <article className="showcase-card" key={item.title}>
              <img src={item.src} alt={item.title} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section
        title="基于最新代码结构的真实架构"
        intro="从 Electron、Renderer、Agent Runtime、Storage、Protocol、Canvas 与 Media Runtime 出发，说明双内核、团队 dispatch 和本地优先数据层。"
      >
        <ArchitectureMap />
        <div className="evidence">
          <h3>代码证据</h3>
          <ul>
            {codeEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </Section>
      <Section
        title="从代码任务到内容生产"
        intro="同一个任务可以先让 Agent 修改代码、跑验证和审查，再进入画布生成资产、视频和项目物料。"
      >
        <CanvasWorkflow />
      </Section>
      <Section
        title="跨平台下载，自动推荐"
        intro="支持 macOS、Windows 与 Linux，下载链接优先来自版本中心返回的安装包直链。"
      >
        <DownloadPanel />
      </Section>
      <Section title="常见问题">
        <FAQ />
      </Section>
    </>
  )
}
