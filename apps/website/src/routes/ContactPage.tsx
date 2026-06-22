import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { DISCUSSIONS_URL, ISSUES_URL } from '../lib/links'
export function ContactPage() {
  return (
    <>
      <Seo
        seo={{
          title: '联系我们 - Spark Agent',
          description: '通过 GitHub Issue、Discussions、邮箱和社群占位联系 Spark Agent 团队。',
          path: '/contact',
          keywords: ['联系 Spark Agent', 'Spark Agent 反馈', 'AI Agent 社区'],
        }}
      />
      <Section eyebrow="Contact" title="联系我们">
        <div className="grid cards">
          <article className="card">
            <h3>产品反馈</h3>
            <p>功能建议、Bug 与兼容性问题请优先提交 GitHub Issue。</p>
            <a className="button primary" href={ISSUES_URL}>
              GitHub Issue
            </a>
          </article>
          <article className="card">
            <h3>社区讨论</h3>
            <p>Discussions 开启后可用于工作流、模板、Provider 与影视创作交流。</p>
            <a className="button" href={DISCUSSIONS_URL}>
              GitHub Discussions
            </a>
          </article>
          <article className="card placeholder">
            <h3>商务 / 社群占位</h3>
            <p>邮箱、微信、Discord、反馈表单等联系入口后续补充。</p>
          </article>
        </div>
      </Section>
    </>
  )
}
