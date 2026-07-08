import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { GITHUB_URL, ISSUES_URL, LICENSE_URL, README_URL, REPO_DOCS_URL } from '../lib/links'
export function OpenSourcePage() {
  return (
    <>
      <Seo
        seo={{
          title: '开源 - Spark Agent',
          description:
            'Spark Agent 开源、透明、可扩展。了解源码仓库、贡献方式、本地开发、许可证和技术栈。',
          path: '/open-source',
          keywords: ['Spark Agent 开源', 'AI Agent GitHub', 'MCP 开源', 'Electron AI'],
        }}
      />
      <Section
        eyebrow="开源项目"
        title="开源透明，方便审计和扩展"
        intro="你可以查看源码、审计运行逻辑，接入自己的模型服务，添加 MCP Server，编写 Skills，或参与产品路线共建。"
      >
        <div className="grid cards">
          <article className="card">
            <h3>GitHub 仓库</h3>
            <p>查看源码、发布版本、Issue、PR 和本地开发说明。</p>
            <a className="button primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
              打开 GitHub
            </a>
          </article>
          <article className="card">
            <h3>如何贡献</h3>
            <p>从 Issue 开始讨论，提交可复现问题、文档改进、Provider、MCP 或 Skill 适配建议。</p>
            <a className="button" href={ISSUES_URL} target="_blank" rel="noreferrer">
              提交 Issue
            </a>
          </article>
          <article className="card">
            <h3>开源资料</h3>
            <p>README、docs 和许可证是了解项目能力、边界和使用条件的主要入口。</p>
            <div className="link-list">
              <a href={README_URL} target="_blank" rel="noreferrer">
                README
              </a>
              <a href={REPO_DOCS_URL} target="_blank" rel="noreferrer">
                docs/
              </a>
              <a href={LICENSE_URL} target="_blank" rel="noreferrer">
                License
              </a>
            </div>
          </article>
        </div>
      </Section>
      <Section title="本地开发" intro="克隆仓库后，你可以分别启动桌面端和官网项目进行开发与验证。">
        <div className="doc-long">
          <h3>环境要求</h3>
          <p>Node.js 22+、pnpm、Git；桌面端构建还需各平台原生工具链（Windows 下 Visual Studio Build Tools）。</p>
          <h3>常用命令</h3>
          <p>
            <code>pnpm install</code> 安装依赖；<code>pnpm dev</code>（apps/desktop）启动桌面端；官网在
            apps/website 下 <code>pnpm dev</code> 启动本地预览。
          </p>
          <h3>扩展点</h3>
          <p>新增模型服务可从 Provider 适配入手；新增工具优先做成 MCP Server 或 Skill；UI 改动遵循现有样式约定。</p>
        </div>
      </Section>
      <Section title="技术栈" intro="核心依赖与运行时一览，便于评估接入、审计和二次开发成本。">
        <div className="module-cloud large">
          {['Electron', 'React 19', 'TypeScript', 'Claude Agent SDK', 'Codex', 'SQLite', 'MCP', 'Vite', 'pnpm'].map(
            (m) => (
              <span key={m}>{m}</span>
            ),
          )}
        </div>
      </Section>
    </>
  )
}
