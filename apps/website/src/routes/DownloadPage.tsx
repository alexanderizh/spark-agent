import { DownloadPanel } from '../components/DownloadPanel'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
export function DownloadPage() {
  return (
    <>
      <Seo
        seo={{
          title: '下载 Spark Agent - 跨平台 AI 桌面应用',
          description:
            '下载 Spark Agent macOS、Windows 桌面版本。页面会自动识别系统，并推荐适合当前设备的安装包。',
          path: '/download',
          keywords: [
            'Spark Agent 下载',
            'AI 桌面应用下载',
            '跨平台 AI 工具',
            'macOS AI',
            'Windows AI',
          ],
        }}
      />
      <Section
        eyebrow="桌面客户端下载"
        title="下载适合你设备的 Spark Agent"
        intro="支持 macOS 与 Windows。页面会自动识别当前系统，并高亮推荐对应版本。"
      >
        <DownloadPanel />
      </Section>
      <Section title="安装说明">
        <div className="grid cards">
          <article className="card">
            <h3>macOS</h3>
            <p>下载 DMG 后拖入 Applications。如果系统提示安全确认，请在系统设置中允许打开。</p>
          </article>
          <article className="card">
            <h3>Windows</h3>
            <p>建议使用 Windows 10/11 x64，并优先下载页面推荐的正式安装包。</p>
          </article>
        </div>
      </Section>
    </>
  )
}
