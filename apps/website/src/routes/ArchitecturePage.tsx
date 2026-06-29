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
            '了解 Spark Agent 如何用本地优先架构、Agent Runtime、MCP、Provider、权限治理和 SQLite 数据层支撑可信 AI 工作流。',
          path: '/architecture',
          keywords: ['AI Agent Runtime', 'MCP', 'Electron AI 应用', '本地优先 AI', 'SQLite'],
        }}
      />
      <Section
        eyebrow="架构设计"
        title="为可信 AI 工作流设计的本地架构"
        intro="Spark Agent 把桌面端、Agent Runtime、MCP、Provider、Skills、本地数据和权限治理组合在一起，让自动化过程可见、可控、可扩展。"
      >
        <ArchitectureMap />
      </Section>
      <Section title="核心能力模块" intro="这些模块共同支撑代码开发、团队调度、权限治理、媒体生成和画布任务。">
        <div className="module-cloud large">
          {runtimeModules.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      </Section>
      <Section title="继续了解">
        <div className="link-list large">
          {architectureLinks.map(([label, href]) => (
            <a href={href} key={label}>
              {label}
            </a>
          ))}
        </div>
      </Section>
      <Section title="团队协作流程">
        <div className="sequence">
          <span>用户</span>
          <i /> <span>主 Agent</span>
          <i /> <span>成员 Agent</span>
          <i /> <span>工具 / MCP</span>
          <i /> <span>汇总输出</span>
        </div>
      </Section>
    </>
  )
}
