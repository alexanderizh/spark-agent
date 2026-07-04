import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 提供两套互补浏览器能力：managed <code>playwright</code> MCP
      负责成熟网页自动化；内置 <code>spark_browser</code> MCP 负责应用内可见独立窗口、
      本地 HTML 调试、持久脚本、profile 登录态、console 与网络观察。
    </p>

    <h2 id="how-it-works">1. 工作原理</h2>
    <pre>
{`┌──────────────┐          ┌──────────────────────┐
│ Agent Runtime│ ───────▶ │ playwright managed MCP│ ──▶ Playwright 自启动 Chromium
└──────────────┘          └──────────────────────┘
        │
        │ stdio MCP + loopback bridge
        ▼
┌──────────────────────┐     ┌─────────────────────────────┐
│ spark_browser MCP     │ ──▶ │ Spark Main Process BrowserWindow│
└──────────────────────┘     └─────────────────────────────┘`}
    </pre>
    <ul>
      <li><strong>Playwright MCP</strong>：适合点击、输入、snapshot/ref、采集和 E2E 验证。</li>
      <li><strong>spark_browser</strong>：适合用户可见窗口、本地 <code>file://</code> HTML、持久注入、profile 登录态、console/network 调试。</li>
      <li>旧的 CDP 9223 嵌入式视图已经移除，Playwright 不再复用 Electron BrowserWindow。</li>
    </ul>

    <h2 id="setup">2. 设置页</h2>
    <p>进入 <strong>设置 → 浏览器自动化</strong>：</p>
    <ol>
      <li>安装或重新安装 <code>@playwright/mcp</code>。</li>
      <li>下载 Playwright 使用的 Chromium。</li>
      <li>启用 managed <code>playwright</code> MCP。</li>
      <li>选择 headful / headless 模式。</li>
    </ol>
    <p>
      应用内可见窗口由 Agent 在需要时通过 <code>mcp__spark_browser__open</code> 打开。
      远程连接里的「使用内置浏览器窗口」默认关闭，开启后远程会话才应允许使用该能力。
    </p>

    <h2 id="mode">3. 选择工具</h2>
    <table>
      <thead><tr><th>任务</th><th>推荐工具</th></tr></thead>
      <tbody>
        <tr><td>可靠点击、输入、表单、snapshot/ref</td><td><code>playwright</code></td></tr>
        <tr><td>网页采集、下载、E2E 验证</td><td><code>playwright</code></td></tr>
        <tr><td>用户可见同一窗口、本地 HTML 调试</td><td><code>spark_browser</code></td></tr>
        <tr><td>持久脚本、console、network、profile 登录态</td><td><code>spark_browser</code></td></tr>
      </tbody>
    </table>

    <h2 id="spark-browser">4. spark_browser 工具</h2>
    <ul>
      <li><code>open</code> / <code>navigate</code> / <code>close</code>：管理可见窗口。</li>
      <li><code>eval</code>：执行一次 JS，返回可 JSON 序列化结果。</li>
      <li><code>inject_script</code> / <code>remove_script</code>：跨导航持久注入和清理。</li>
      <li><code>console_start</code> / <code>console_events</code>：捕获页面日志、警告、错误。</li>
      <li><code>network_set_rules</code> / <code>network_events</code>：记录、阻断、重定向、修改请求头。</li>
      <li><code>clear_profile</code>：清理指定 profile 的 cookies/cache/localStorage/IndexedDB。</li>
    </ul>

    <h2 id="examples">5. 使用示例</h2>
    <p><strong>网页信息采集</strong></p>
    <pre>{`请打开 https://news.ycombinator.com，把首页前 10 条新闻整理成 Markdown 表格。`}</pre>
    <p>优先用 Playwright 的 navigate / snapshot / click / evaluate。</p>
    <p><strong>本地 HTML 调试</strong></p>
    <pre>{`请用应用内可见浏览器打开 file:///.../demo.html，读取 console 错误，截图并指出布局问题。`}</pre>
    <p>优先用 spark_browser 的 open / console_start / console_events / screenshot。</p>

    <h2 id="troubleshoot">6. 故障排查</h2>
    <table>
      <thead><tr><th>现象</th><th>排查</th></tr></thead>
      <tbody>
        <tr><td>Playwright 工具未出现</td><td>设置 → 浏览器自动化：确认 MCP 已启用；重启会话。</td></tr>
        <tr><td><code>browser_navigate</code> 启动失败</td><td>下载 Chromium，或确认系统 Chrome/Edge 可用。</td></tr>
        <tr><td><code>spark_browser</code> 没有打开窗口</td><td>确认当前是桌面本机会话；远程会话需开启「使用内置浏览器窗口」。</td></tr>
        <tr><td><code>mock_response</code> 不可用</td><td>当前仅支持 record/block/redirect/set_headers，响应体 mock 会返回 unsupported。</td></tr>
      </tbody>
    </table>

    <h2 id="privacy">7. 隐私与安全</h2>
    <ul>
      <li><code>spark_browser</code> 页面保持 sandbox、无 Node、无 Electron IPC。</li>
      <li>profile 会保留登录态，按需用 <code>clear_profile</code> 清理。</li>
      <li>远程连接默认不能使用内置浏览器窗口。</li>
      <li>任务结束应清理持久脚本、网络规则、console 缓冲并关闭窗口。</li>
    </ul>
  </>
)

export const browserAutomation: DocsPageContent = {
  slug: 'browser-automation',
  toc: [
    { id: 'how-it-works', title: '1. 工作原理', level: 2 },
    { id: 'setup', title: '2. 设置页', level: 2 },
    { id: 'mode', title: '3. 选择工具', level: 2 },
    { id: 'spark-browser', title: '4. spark_browser 工具', level: 2 },
    { id: 'examples', title: '5. 使用示例', level: 2 },
    { id: 'troubleshoot', title: '6. 故障排查', level: 2 },
    { id: 'privacy', title: '7. 隐私与安全', level: 2 },
  ],
  faq: [
    {
      question: 'Playwright 和 spark_browser 是替代关系吗？',
      answer: '不是。Playwright 负责成熟网页自动化，spark_browser 负责应用内可见窗口和调试能力。',
    },
    {
      question: '还能使用 CDP 9223 嵌入式视图吗？',
      answer: '不能。旧视图已经移除，Playwright 会自启动浏览器，应用内可见窗口由 spark_browser 提供。',
    },
    {
      question: 'spark_browser 会给网页 Node 权限吗？',
      answer: '不会。页面保持 sandbox，Agent 通过主进程受控工具执行 eval、截图、console 和网络观察。',
    },
  ],
  quickReference: [
    { key: 'Playwright MCP', value: 'playwright（managed scope）' },
    { key: '可见窗口 MCP', value: 'spark_browser（内置）' },
    { key: 'Playwright 工具', value: 'mcp__playwright__browser_*' },
    { key: 'spark_browser 工具', value: 'open / eval / inject_script / console_events / network_events' },
    { key: '运行模式', value: 'Playwright headful / headless' },
  ],
  aiSummary:
    'Spark Agent 浏览器自动化由 playwright managed MCP 与 spark_browser 内置 MCP 并存提供。' +
    'playwright 适合 snapshot/ref、点击输入、采集和 E2E；spark_browser 打开应用内可见 BrowserWindow，支持 file:// HTML、eval、持久脚本、profile 登录态、console 捕获和 webRequest 级网络规则。' +
    '旧 CDP 9223 嵌入式视图已移除。远程使用 spark_browser 默认关闭，需开启 useInternalBrowser。',
  Body,
}

export default browserAutomation
