import { Section } from '../components/Section'
import { Seo } from '../components/Seo'

export function NotFoundPage() {
  return (
    <>
      <Seo
        seo={{
          title: '页面未找到 - Spark Work',
          description: '你访问的 Spark Work 页面不存在或已被移动。',
          path: '/404',
          keywords: ['Spark Work'],
          robots: 'noindex, follow',
        }}
      />
      <Section
        eyebrow="404"
        headingLevel={1}
        title="没有找到这个页面"
        intro="地址可能有误，或者页面已经移动。"
      >
        <div className="link-list large">
          <a href="/">返回首页</a>
          <a href="/docs">浏览使用文档</a>
          <a href="/download">下载 Spark Work</a>
        </div>
      </Section>
    </>
  )
}
