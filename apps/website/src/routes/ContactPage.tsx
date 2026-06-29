import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { DISCUSSIONS_URL, GITHUB_URL, ISSUES_URL, RELEASES_URL, SECURITY_CONTACT_URL } from '../lib/links'
export function ContactPage() {
  return (
    <>
      <Seo
        seo={{
          title: '联系我们 - Spark Agent',
          description: '通过 GitHub Issue、Discussions 和私有安全报告反馈 Spark Agent 的产品问题、使用建议和安全问题。',
          path: '/contact',
          keywords: ['联系 Spark Agent', 'Spark Agent 反馈', 'AI Agent 社区'],
        }}
      />
      <Section eyebrow="联系我们" title="反馈与支持" intro="选择最合适的渠道，让问题、建议或安全报告更快到达维护者。">
        <div className="grid cards">
          <article className="card">
            <span className="soon-tag">推荐</span>
            <h3>产品反馈 / Bug</h3>
            <p>功能建议、Bug、兼容性问题和安装问题，请优先提交 GitHub Issue，并附上系统版本、截图和复现步骤。</p>
            <a className="button primary" href={ISSUES_URL} target="_blank" rel="noreferrer">
              提交 GitHub Issue
            </a>
          </article>
          <article className="card">
            <span className="soon-tag">社区</span>
            <h3>社区讨论</h3>
            <p>工作流、模板、Provider、Skills 和创作经验，欢迎在 Discussions 中分享、提问和讨论。</p>
            <a className="button primary" href={DISCUSSIONS_URL} target="_blank" rel="noreferrer">
              加入 GitHub Discussions
            </a>
          </article>
          <article className="card">
            <span className="soon-tag">私密</span>
            <h3>安全问题</h3>
            <p>请不要在公开 Issue 中披露敏感细节，先通过 GitHub 私有安全报告沟通。</p>
            <a className="button" href={SECURITY_CONTACT_URL} target="_blank" rel="noreferrer">
              提交安全报告
            </a>
          </article>
        </div>
      </Section>
      <Section title="快速入口" intro="常用的仓库、发布和文档入口。">
        <div className="link-list large">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub 仓库
          </a>
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">
            Releases
          </a>
          <a href="/docs">使用文档</a>
          <a href="/download">下载</a>
          <a href="/roadmap">开发计划</a>
        </div>
      </Section>
    </>
  )
}
