import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { docEntryLinks, docSections } from '../content/docs'
import { docLinks } from '../lib/links'
export function DocsPage() {
  return (
    <>
      <Seo
        seo={{
          title: '使用文档 - Spark Agent 教程',
          description:
            'Spark Agent 使用文档：快速开始、内容创作、无限画布、代码开发、Provider、MCP、Skills、权限与常见问题。',
          path: '/docs',
          keywords: ['Spark Agent 使用文档', 'AI Agent 教程', 'MCP 教程', '无限画布教程'],
        }}
      />
      <Section
        eyebrow="Docs"
        title="从下载到完成第一个项目"
        intro="文档按真实工作流组织：先配置模型和 Agent，再进入代码、团队协作或影视画布工作流。"
      >
        <div className="grid cards">
          {docSections.map((s) => (
            <article className="card" key={s.title}>
              <h3>{s.title}</h3>
              <ol>
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </Section>
      <Section title="文档入口">
        <div className="grid cards doc-link-grid">
          {docEntryLinks.map((item) => (
            <a className="card doc-link-card" href={docLinks[item.href as keyof typeof docLinks]} key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </a>
          ))}
        </div>
      </Section>
      <Section title="关键配置">
        <div className="doc-long">
          <h3>Provider 配置</h3>
          <p>
            支持 OpenAI、Anthropic、OpenRouter、Ollama 以及可配置的兼容服务商；多媒体能力取决于
            Provider manifest。
          </p>
          <h3>MCP / Skills</h3>
          <p>
            可以添加 MCP Server、安装 Skill、导入本地
            Skill，并使用内置搜索、媒体、调试和平台管理工具。
          </p>
          <h3>数据位置与治理</h3>
          <p>
            本地 SQLite、workspace 文件、系统凭据存储、权限审批、用量账本、规则与 Hooks
            共同构成可审计工作台。
          </p>
        </div>
      </Section>
    </>
  )
}
