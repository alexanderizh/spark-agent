import { ArchitectureMap } from '../components/ArchitectureMap'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { architectureLinks, runtimeModules } from '../content/architecture'
export function ArchitecturePage() {
  return (
    <>
      <Seo
        seo={{
          title: '架构 - Spark Agent Agent Runtime 与本地优先设计',
          description:
            '深入了解 Spark Agent 的 Electron 桌面端、React Renderer、Typed IPC、Agent Runtime、MCP、Provider、SQLite 与本地治理架构。',
          path: '/architecture',
          keywords: ['AI Agent Runtime', 'MCP', 'Electron AI 应用', '本地优先 AI', 'SQLite'],
        }}
      />
      <Section
        eyebrow="Architecture"
        title="一个可观察、可扩展、可审计的 Agent Runtime"
        intro="Spark Agent 通过 Electron 桌面端、Agent Runtime、MCP、Provider、Skills、本地 SQLite 和系统凭据存储构成完整工作台。"
      >
        <ArchitectureMap />
      </Section>
      <Section title="Runtime 模块" intro="这些模块共同支撑代码开发、团队调度、权限治理、媒体生成和画布任务。">
        <div className="module-cloud large">
          {runtimeModules.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      </Section>
      <Section title="架构相关入口">
        <div className="link-list large">
          {architectureLinks.map(([label, href]) => (
            <a href={href} key={label}>
              {label}
            </a>
          ))}
        </div>
      </Section>
      <Section title="Team Mode 时序">
        <div className="sequence">
          <span>用户</span>
          <i /> <span>Host Agent</span>
          <i /> <span>Member Agents</span>
          <i /> <span>Tools / MCP</span>
          <i /> <span>汇总输出</span>
        </div>
      </Section>
    </>
  )
}
