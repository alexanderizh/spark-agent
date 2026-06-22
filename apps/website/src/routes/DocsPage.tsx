import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { docSections } from '../content/docs'
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
        intro="文档按真实工作流组织：先配置模型和 Agent，再进入内容、代码或影视画布工作流。"
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
      <Section title="使用文档内容规划">
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
