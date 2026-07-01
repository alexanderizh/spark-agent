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
    title: '把 AI 工作留在你的项目里',
    text: '对话、代码、终端、文件改动、任务审查和权限审批都在同一个桌面窗口完成，过程清楚可追踪。',
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

export function HomePage() {
  return (
    <>
      <Seo jsonLd={faqJsonLd()} />
      <section className="hero enhanced-hero">
        <div className="hero-text">
          <h1>Spark Agent</h1>
          <p className="hero-subtitle">
            本地优先的桌面端 AI Agent 工作台。把代码开发、办公文档、主题调研和多媒体创作放进同一个可审查的工作台。
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
      <Section
        title="从想法到交付，都在同一处推进"
        intro="Spark Agent 不只是聊天窗口。它把项目上下文、执行工具、治理能力和创作资产放在一起，帮助你更稳地把事情做完。"
      >
        <div className="grid cards feature-grid-wide">
          {featureGroups.map((g) => (
            <FeatureCard key={g.title} {...g} />
          ))}
        </div>
      </Section>
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
