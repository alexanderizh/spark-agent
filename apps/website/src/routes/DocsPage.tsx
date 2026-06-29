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
            'Spark Agent 使用文档：从下载安装到模型配置，再到代码开发、团队 Agent、无限画布、Provider、MCP、Skills 和权限治理。',
          path: '/docs',
          keywords: ['Spark Agent 使用文档', 'AI Agent 教程', 'MCP 教程', '无限画布教程'],
        }}
      />
      <Section
        eyebrow="使用文档"
        title="从安装到完成第一个真实任务"
        intro="文档按实际使用路径组织：先完成模型和 Agent 配置，再进入代码开发、团队协作或画布创作工作流。"
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
      <Section title="按主题查阅">
        <div className="grid cards">
          {docEntryLinks.map((item) => (
            <a className="card doc-link-card" href={docLinks[item.href as keyof typeof docLinks]} key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </a>
          ))}
        </div>
      </Section>
      <Section title="上线前建议先确认的配置">
        <div className="doc-long">
          <h3>模型服务</h3>
          <p>
            支持 OpenAI、Anthropic、OpenRouter、Ollama 以及兼容协议服务商；图片、视频和语音能力取决于你接入的服务商配置。
          </p>
          <h3>MCP / Skills</h3>
          <p>
            可以添加 MCP Server、安装或导入本地 Skill，并使用内置搜索、媒体、调试和平台管理工具。
          </p>
          <h3>数据与权限</h3>
          <p>
            本地 SQLite、workspace 文件、系统凭据存储、权限审批、用量账本、规则与 Hooks
            共同构成可审计工作台。
          </p>
        </div>
      </Section>
    </>
  )
}
