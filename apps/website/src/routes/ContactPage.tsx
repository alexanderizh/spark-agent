import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { DISCUSSIONS_URL, ISSUES_URL, SECURITY_CONTACT_URL } from '../lib/links'
export function ContactPage() {
  return (
    <>
      <Seo
        seo={{
          title: '联系我们 - Spark Agent',
          description: '通过 GitHub Issue、Discussions 和私有安全报告联系 Spark Agent 团队。',
          path: '/contact',
          keywords: ['联系 Spark Agent', 'Spark Agent 反馈', 'AI Agent 社区'],
        }}
      />
      <Section eyebrow="Contact" title="联系我们">
        <div className="grid cards">
          <article className="card">
            <h3>产品反馈</h3>
            <p>功能建议、Bug、兼容性问题和安装问题请优先提交 GitHub Issue。</p>
            <a className="button primary" href={ISSUES_URL}>
              GitHub Issue
            </a>
          </article>
          <article className="card">
            <h3>社区讨论</h3>
            <p>工作流、模板、Provider、Skills 和影视创作经验适合放到 Discussions。</p>
            <a className="button" href={DISCUSSIONS_URL}>
              GitHub Discussions
            </a>
          </article>
          <article className="card">
            <h3>安全问题</h3>
            <p>请不要在公开 Issue 中披露敏感细节，先通过 GitHub 私有安全报告沟通。</p>
            <a className="button" href={SECURITY_CONTACT_URL}>
              提交安全报告
            </a>
          </article>
        </div>
      </Section>
    </>
  )
}
