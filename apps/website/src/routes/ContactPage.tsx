import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import {
  CONTACT_EMAIL,
  DISCUSSIONS_URL,
  GITHUB_URL,
  ISSUES_URL,
  OPEN_SOURCE_ENABLED,
  QQ_GROUP_NO,
  QQ_GROUP_URL,
  RELEASES_URL,
  SECURITY_CONTACT_URL,
} from '../lib/links'
export function ContactPage() {
  return (
    <>
      <Seo
        seo={{
          title: '联系我们 - Spark Work',
          description: '通过邮箱和 QQ 开发讨论群反馈 Spark Work 的产品问题、使用建议和安全问题。',
          path: '/contact',
          keywords: ['联系 Spark Work', 'Spark Work 反馈', 'AI Agent 社区'],
        }}
      />
      {OPEN_SOURCE_ENABLED && (
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
      )}
      <Section eyebrow="直接联系" title="邮箱与社区群" intro="通过邮件和 QQ 开发讨论群直接联系维护者。">
        <div className="grid cards">
          <article className="card">
            <h3>QQ 开发讨论群</h3>
            <img
              src="/qq-group-qrcode.jpg"
              alt="SparkWork QQ 开发讨论群二维码"
              loading="lazy"
              decoding="async"
              style={{ width: 180, height: 'auto', borderRadius: 12, display: 'block', margin: '0 auto' }}
            />
            <p>
              群号：<strong>{QQ_GROUP_NO}</strong>
            </p>
            <p>扫一扫二维码，或点击下方按钮加入群聊。</p>
            <a className="button primary" href={QQ_GROUP_URL} target="_blank" rel="noreferrer">
              一键加群
            </a>
          </article>
          <article className="card">
            <span className="soon-tag">邮件</span>
            <h3>邮箱</h3>
            <p>商务合作、产品建议和不便公开沟通的事项，欢迎直接发邮件给维护者。</p>
            <a className="button primary" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </article>
        </div>
      </Section>
      <Section title="快速入口" intro="常用的发布和文档入口。">
        <div className="link-list large">
          {OPEN_SOURCE_ENABLED && (
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub 仓库
            </a>
          )}
          {OPEN_SOURCE_ENABLED && (
            <a href={RELEASES_URL} target="_blank" rel="noreferrer">
              Releases
            </a>
          )}
          <a href="/docs">使用文档</a>
          <a href="/download">下载</a>
          <a href="/roadmap">开发计划</a>
        </div>
      </Section>
    </>
  )
}
