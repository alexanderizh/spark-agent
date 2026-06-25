import { ArchitectureMap } from '../components/ArchitectureMap'
import { CanvasWorkflow } from '../components/CanvasWorkflow'
import { DownloadPanel } from '../components/DownloadPanel'
import { FAQ, faqJsonLd } from '../components/FAQ'
import { FeatureCard } from '../components/FeatureCard'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { codeEvidence, featureGroups } from '../content/features'
import { GITHUB_URL } from '../lib/links'

const heroNodes = [
  '代码开发',
  '调试审查',
  '团队 Agent',
  '运行时治理',
  '无限画布',
  '多媒体节点',
]
const showcase = [
  {
    src: '/showcase/workbench-overview.png',
    title: '统一工作台',
    text: '聊天、任务、文件、终端和审查面板在同一桌面上下文里协同。',
  },
  {
    src: '/showcase/code-development.png',
    title: '代码开发优先',
    text: '侧边聊天、内置终端、Git Review、Worktree 隔离和环境变更同屏展示。',
  },
  {
    src: '/showcase/infinite-canvas.png',
    title: '无限画布创作',
    text: '剧本、角色、场景、AI 操作节点与媒体产物在画布上形成可视化生产线。',
  },
]

export function HomePage() {
  return (
    <>
      <Seo jsonLd={faqJsonLd()} />
      <section className="hero enhanced-hero">
        <div className="hero-copy">
          <p className="eyebrow">Local-first AI Agent Workbench</p>
          <h1>Spark Agent</h1>
          <p className="hero-subtitle">
            一个本地优先的桌面工作台，把代码开发、团队 Agent、运行时治理和无限画布放在一起。
          </p>
          <div className="cta">
            <a className="button primary" href="/download">
              免费下载
            </a>
            <a className="button" href={GITHUB_URL}>
              查看 GitHub
            </a>
          </div>
          <div className="hero-tags" aria-label="核心能力">
            {heroNodes.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
        </div>
        <figure className="hero-product">
          <img src="/showcase/workbench-overview.png" alt="Spark Agent 桌面工作台总览" />
        </figure>
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
        intro="官网优先展示真实产品截图，避免把未落地能力包装成抽象概念图。"
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
        intro="支持 macOS、Windows 与 Linux，当前下载链接集中到 GitHub Releases，后续可替换为具体安装包。"
      >
        <DownloadPanel />
      </Section>
      <Section title="常见问题">
        <FAQ />
      </Section>
    </>
  )
}
