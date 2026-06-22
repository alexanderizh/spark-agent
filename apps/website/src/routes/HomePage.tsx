import { ArchitectureMap } from '../components/ArchitectureMap'
import { CanvasWorkflow } from '../components/CanvasWorkflow'
import { DownloadPanel } from '../components/DownloadPanel'
import { FAQ, faqJsonLd } from '../components/FAQ'
import { FeatureCard } from '../components/FeatureCard'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { featureGroups } from '../content/features'
import { GITHUB_URL } from '../lib/links'

export function HomePage() {
  return (
    <>
      <Seo jsonLd={faqJsonLd()} />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Local-first AI Content Creation Workbench</p>
          <h1>Spark Agent</h1>
          <p className="hero-subtitle">
            本地优先的 AI 内容创作工作台。写代码、写文档、做
            PPT、做网页、处理文件、制作影视内容，都在一个无限画布工作台里完成。
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
        <div className="hero-canvas" aria-label="产品概念图占位">
          <div className="canvas-center">Infinite Canvas</div>
          {['Code', 'Docs', 'PPT', 'Web', 'Files', 'Images', 'Video', 'Agents', 'MCP'].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </section>
      <Section
        eyebrow="Core"
        title="一个工作台，覆盖跨行业创作生产"
        intro="Spark Agent 不是单一聊天窗口，而是把模型、Agent、MCP、Skills、文件、代码和无限画布组织在一起的桌面应用。"
      >
        <div className="grid cards">
          {featureGroups.slice(0, 3).map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
      </Section>
      <Section
        eyebrow="Architecture"
        title="基于代码静态分析的真实架构"
        intro="官网内容来自 Electron、Renderer、Agent Runtime、Storage、Protocol、Canvas 与 Media Runtime 代码结构，而不是只复述 README。"
      >
        <ArchitectureMap />
      </Section>
      <Section
        eyebrow="Canvas"
        title="影视创作，从无限画布开始"
        intro="把剧本、角色、场景、镜头、分镜、图片、视频和 AI 任务放在同一张画布上，让每次生成都保留上下文与来源。"
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
