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
  'Claude SDK',
  'Codex',
  'Terminal',
  'Git Review',
  'Debug',
  'Team A2A',
  'Worktree',
  'Canvas',
  'Assets',
]
const showcase = [
  {
    src: '/showcase/dev-first-unified-panel.svg',
    title: '代码开发优先',
    text: '侧边聊天、终端、审查、还原点和 worktree 在同一工作台完成。',
  },
  {
    src: '/showcase/canvas-production-line.svg',
    title: '无限画布创作',
    text: '剧本、资产、AI 操作节点与视频产物在画布中形成生产线。',
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
            本地优先的 AI Agent
            工作台：先覆盖代码开发、调试审查、团队模式、双内核、远程连接和任务治理，再把无限画布、资产中心、3D
            导演台与多媒体生成接入同一生产界面。
          </p>
          <div className="cta">
            <a className="button primary" href="/download">
              免费下载
            </a>
            <a className="button" href={GITHUB_URL}>
              查看 GitHub
            </a>
            <a className="button ghost" href="/docs">
              阅读文档
            </a>
          </div>
        </div>
        <div className="hero-canvas hero-console" aria-label="Spark Agent 动态工作台概念图">
          <div className="hero-orbit" />
          <div className="canvas-center">Agent Runtime</div>
          {heroNodes.map((n) => (
            <span key={n}>{n}</span>
          ))}
          <div className="hero-dock">
            <b>Ask · Edit · Run</b>
            <small>worktree · debug · review · canvas</small>
          </div>
        </div>
      </section>
      <Section
        eyebrow="Core"
        title="功能顺序重排：代码开发在前，内容创作在后"
        intro="Spark Agent 的定位不是单点聊天，而是一个把开发闭环、团队 Agent、平台治理和无限画布创作放在一起的生产工作台。"
      >
        <div className="grid cards feature-grid-wide">
          {featureGroups.map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
      </Section>
      <Section
        eyebrow="Showcase"
        title="配图：从统一开发面板到画布生产线"
        intro="截图展示暗色主题；产品同时支持多色主题和浅色主题。官网使用可版本化 SVG 展示核心信息架构，后续可替换为真实产品截图。"
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
        eyebrow="Architecture"
        title="基于最新代码结构的真实架构"
        intro="从 Electron、Renderer、Agent Runtime、Storage、Protocol、Canvas 与 Media Runtime 出发，强调双内核、开发治理闭环、团队 dispatch 和本地优先数据层。"
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
        eyebrow="Workflow"
        title="从代码任务到内容生产的一条闭环"
        intro="同一个任务可以先让 Agent 修改代码、跑验证和审查，再进入画布生成资产、视频和项目物料。"
      >
        <CanvasWorkflow />
      </Section>
      <Section
        eyebrow="Download"
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
