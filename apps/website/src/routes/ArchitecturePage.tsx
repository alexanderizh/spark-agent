import { ArchitectureMap } from '../components/ArchitectureMap'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { architectureLinks, runtimeModules } from '../content/architecture'

const runtimeFlow = [
  ['用户与界面', '在桌面工作台里发起会话、查看任务、审查改动和预览结果。'],
  ['Main / IPC', '主进程负责窗口、文件协议、数据库、浏览器桥接和系统服务。'],
  ['Agent Runtime', '会话调度、Provider、Skills、MCP、权限、团队模式和工作流在这里编排。'],
  ['工具与执行器', 'Claude SDK、Codex、spark_browser、搜索、媒体和画布能力按需接入。'],
  ['本地数据层', 'SQLite、Keychain、workspace、worktree 和产物目录持久化状态。'],
]

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
      <Section
        title="一次任务如何穿过系统"
        intro="把它想象成一条固定通道：界面接住需求，主进程提供系统能力，运行时编排工具，再把结果落回本地。"
      >
        <div className="workflow">
          {runtimeFlow.map(([step, detail], index) => (
            <div className="workflow-step" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
              <p>{detail}</p>
            </div>
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
