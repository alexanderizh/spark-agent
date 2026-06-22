import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { GITHUB_URL, ISSUES_URL } from '../lib/links'
export function OpenSourcePage() {
  return (
    <>
      <Seo
        seo={{
          title: '开源 - Spark Agent',
          description:
            'Spark Agent 开源、透明、可扩展。了解 GitHub 仓库、贡献方式、本地开发和技术栈。',
          path: '/open-source',
          keywords: ['Spark Agent 开源', 'AI Agent GitHub', 'MCP 开源', 'Electron AI'],
        }}
      />
      <Section
        eyebrow="Open Source"
        title="开源、透明、可扩展"
        intro="你可以审计运行逻辑，接入自己的模型服务，添加 MCP Server，编写 Skills，或者参与产品路线共建。"
      >
        <div className="grid cards">
          <article className="card">
            <h3>GitHub 仓库</h3>
            <p>查看源码、Release、Issue 与 PR。</p>
            <a className="button primary" href={GITHUB_URL}>
              打开 GitHub
            </a>
          </article>
          <article className="card">
            <h3>如何贡献</h3>
            <p>从 Issue 开始讨论，提交可复现问题、文档改进、Provider、MCP 或 Skill 适配。</p>
            <a className="button" href={ISSUES_URL}>
              提交 Issue
            </a>
          </article>
          <article className="card">
            <h3>技术栈</h3>
            <p>Electron、React、TypeScript、Agent Runtime、SQLite、MCP、Provider、Skills。</p>
          </article>
        </div>
      </Section>
    </>
  )
}
