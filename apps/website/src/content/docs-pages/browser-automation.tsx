import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 内置注册了一个 <strong>managed MCP server</strong>（名称 <code>playwright</code>，scope=<code>managed</code>，不可删除）。
      当启用时，Claude SDK 自动发现全部 <code>mcp__playwright__browser_*</code> 工具，
      Agent 可以像调用其他工具一样调用它们。
    </p>

    <h2 id="how-it-works">1. 工作原理</h2>
    <pre>
{`┌──────────────┐   IPC    ┌──────────────────┐  stdio  ┌──────────────────────┐
│  Chat / Agent│ ───────▶ │ Spark Main Proc  │ ──────▶ │ @playwright/mcp      │
│  (renderer)  │          │  + managed row   │         │ (subprocess)         │
└──────────────┘          │  in mcp_servers  │         │                      │
                          └──────────────────┘         └────────┬─────────────┘
                                                                │ CDP
                                                                ▼
                                                ┌──────────────────────────┐
                                                │ Embedded BrowserWindow   │
                                                │ (or Playwright's own     │
                                                │  Chromium if view closed)│
                                                └──────────────────────────┘`}
    </pre>
    <p>浏览器放在哪？</p>
    <ul>
      <li><strong>嵌入式窗口（默认）</strong>：在 Chat view 右侧的「浏览器自动化」面板里点「+ 打开浏览器视图」，会弹出独立 Chromium 窗口。Agent 操作的页面在这里，并通过 CDP（端口 9223）让 Playwright 连接。</li>
      <li><strong>Playwright 自带 Chromium</strong>：如果未打开嵌入式视图，Playwright 启动自己下载的 chromium（headful / headless 取决于 mode 设置）。</li>
    </ul>

    <h2 id="setup">2. 启用流程</h2>
    <p>进入 <strong>设置 → 浏览器自动化</strong>：</p>
    <ol>
      <li>点「安装 MCP」—— 等待 <code>pnpm add @playwright/mcp playwright</code> 完成。</li>
      <li>点「下载浏览器」—— 等待 <code>playwright install chromium</code> 完成（约 150 MB）。</li>
      <li>确认「MCP 已启用」按钮亮起（toggle 默认启用）。</li>
      <li>选择 headful / headless 模式。</li>
    </ol>
    <p>
      下载过程中设置页会显示当前阶段、百分比（当 Playwright 输出提供时）与最近一行安装日志。
      如果状态显示「使用系统浏览器」，说明当前只找到了本机 Chrome / Edge 回退；当前默认打包流程不会随包内置 Chromium，开发环境可手动运行 <code>pnpm --filter @spark/desktop download-browser</code> 下载到本地 <code>apps/desktop/browsers/</code>。
    </p>

    <h2 id="mode">3. 运行模式</h2>
    <table>
      <thead><tr><th>模式</th><th>适用场景</th><th>显示</th></tr></thead>
      <tbody>
        <tr><td><code>headful</code>（默认）</td><td>调试、演示、需要看 Agent 在干什么</td><td>嵌入式窗口可见</td></tr>
        <tr><td><code>headless</code></td><td>后台批量任务、信息采集</td><td>无窗口，速度更快</td></tr>
      </tbody>
    </table>

    <h2 id="examples">4. 使用示例</h2>
    <p><strong>例 1：网页信息采集</strong></p>
    <pre>{`请帮我打开 https://news.ycombinator.com，把首页前 10 条新闻的
标题、链接、得分整理成 Markdown 表格。`}</pre>
    <p>Agent 会：</p>
    <ol>
      <li><code>browser_navigate</code> → 打开页面</li>
      <li><code>browser_snapshot</code> → 获取可访问性树 + ref 编号</li>
      <li>按 ref 依次 <code>browser_click</code> / 提取文本</li>
      <li>完成后 <code>browser_close</code></li>
    </ol>
    <p><strong>例 2：登录后采集</strong></p>
    <pre>{`我需要从公司内网 https://intranet.example.com/dashboard 导出
本月报表。账号在弹出的页面里输入 user=demo、pass=demo123，
登录后点 Monthly Report，选 June 2026，下载 CSV。`}</pre>
    <p>⚠️ <strong>安全提示</strong>：涉及账号密码时 Agent 会在执行前用 AskUserQuestion 弹窗确认。</p>
    <p><strong>例 3：UI 验证（搭配前端开发）</strong></p>
    <pre>{`我刚改完登录页样式，请帮我打开 http://localhost:3000/login，
用 3 组账号（test1/test1、test2/test2、admin/admin）尝试登录，
把每组的实际表现（成功/失败提示、跳转页面）截图发给我。`}</pre>

    <h2 id="best-practices">5. 工作流最佳实践</h2>
    <ol>
      <li><strong>总是先 snapshot</strong>：让 Agent 看到页面结构再操作，避免猜 CSS selector。</li>
      <li><strong>基于 ref</strong>：snapshot 返回的 <code>ref=N</code> 是最稳定的定位方式。</li>
      <li><strong>每步后再次 snapshot</strong>：表单填写、按钮点击后都要回看效果。</li>
      <li><strong>错误恢复</strong>：Agent 卡住时让它 <code>browser_close</code> 重新开始。</li>
    </ol>

    <h2 id="troubleshoot">6. 故障排查</h2>
    <table>
      <thead><tr><th>现象</th><th>排查</th></tr></thead>
      <tbody>
        <tr><td>MCP 工具未在 Agent 工具列表出现</td><td>设置 → 浏览器自动化：确认「MCP 已启用」按钮亮起；重启会话</td></tr>
        <tr><td><code>browser_navigate</code> 报错「Failed to launch browser」</td><td>没下载浏览器。点「下载浏览器」</td></tr>
        <tr><td>日志提示 No chromium found, falling back to system chrome</td><td>安装包内未检测到可用 Chromium。开发环境可手动运行 <code>pnpm --filter @spark/desktop download-browser</code></td></tr>
        <tr><td>Agent 调用 <code>browser_*</code> 卡住不动</td><td>可能是前一个会话没 <code>browser_close</code>。重启应用</td></tr>
        <tr><td>嵌入式窗口里网页加载不出</td><td>检查 CDP 端口 9223 是否被其他进程占用：<code>netstat -ano | findstr 9223</code></td></tr>
        <tr><td>playwright install 失败</td><td>国内网络可设镜像：<code>set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/</code> 后重试</td></tr>
        <tr><td>MCP server 进程残留</td><td>任务管理器搜 <code>playwright</code>，结束孤儿进程</td></tr>
      </tbody>
    </table>

    <h2 id="privacy">7. 隐私与安全</h2>
    <ul>
      <li>嵌入式浏览器窗口<strong>不加载任何 preload 脚本</strong>、<strong>不注入 IPC bridge</strong>，与主 UI 完全隔离。</li>
      <li>Agent 操作浏览器的内容<strong>不会</strong>自动上传到任何第三方服务（CDP 是本地 127.0.0.1 通信）。</li>
      <li>默认 Skill 系统提示<strong>禁止</strong> Agent 访问支付、银行等敏感页面，遇到时弹窗确认。</li>
      <li><code>--remote-allow-origins=*</code> 配合 loopback 绑定，CDP 端口不对外网暴露。</li>
    </ul>

    <h2 id="advanced">8. 进阶</h2>
    <p>
      <code>playwright</code> MCP server 的 <code>configJson</code> 存在 <code>mcp_servers</code> 表里。
      如需手动修改（例如加 <code>--device</code> 模拟手机）：
    </p>
    <ol>
      <li>在「设置 → MCP」找到 <code>playwright</code> 行（<strong>不能 delete</strong>，只能 update）。</li>
      <li>编辑 configJson 的 <code>args</code> 数组。</li>
      <li>或在「浏览器自动化」卡片点「重置 MCP 配置」恢复默认。</li>
    </ol>
    <p>
      <code>playwright</code> 是 managed scope，与用户自建 MCP 完全独立。
      可同时挂载任何其他 MCP server（GitHub、Slack、数据库等），Agent 会同时看到所有工具。
    </p>
  </>
)

export const browserAutomation: DocsPageContent = {
  slug: 'browser-automation',
  toc: [
    { id: 'how-it-works', title: '1. 工作原理', level: 2 },
    { id: 'setup', title: '2. 启用流程', level: 2 },
    { id: 'mode', title: '3. 运行模式', level: 2 },
    { id: 'examples', title: '4. 使用示例', level: 2 },
    { id: 'best-practices', title: '5. 工作流最佳实践', level: 2 },
    { id: 'troubleshoot', title: '6. 故障排查', level: 2 },
    { id: 'privacy', title: '7. 隐私与安全', level: 2 },
    { id: 'advanced', title: '8. 进阶', level: 2 },
  ],
  faq: [
    {
      question: '能在没打开嵌入式视图的情况下用吗？',
      answer: '可以。Playwright 会启动自己下载的 chromium，headful / headless 模式按设置。',
    },
    {
      question: '为什么我的 browser_navigate 一直卡住？',
      answer: '可能是上一个会话没 browser_close。重启应用清理孤儿进程。',
    },
    {
      question: '可以挂多个 Playwright 实例吗？',
      answer: '不建议。系统只允许一个 managed playwright MCP server。',
    },
    {
      question: 'agent 会自己点支付 / 银行页面吗？',
      answer: '默认 Skill 禁止这种行为。遇到敏感页面会 AskUserQuestion 弹窗让你确认。',
    },
  ],
  quickReference: [
    { key: 'MCP 名称', value: 'playwright（managed scope）' },
    { key: '包', value: '@playwright/mcp + playwright' },
    { key: 'CDP 端口', value: '9223（loopback）' },
    { key: '安装命令', value: 'pnpm add @playwright/mcp playwright' },
    { key: '下载浏览器', value: 'playwright install chromium（约 150 MB）' },
    { key: '运行模式', value: 'headful（默认）/ headless' },
  ],
  howTo: {
    name: '让 Agent 完成一次网页信息采集',
    description: '从安装到产出 Markdown 表格',
    totalTime: 'PT5M',
    steps: [
      '进入「设置 → 浏览器自动化」点「安装 MCP」',
      '等 pnpm add @playwright/mcp playwright 完成，点「下载浏览器」',
      '等 playwright install chromium 完成（约 150 MB）',
      '确认「MCP 已启用」按钮亮起，选 headful 模式',
      '新会话里发：「帮我打开 XXX，把首页前 10 条信息整理成 Markdown 表格」',
    ],
  },
  aiSummary:
    'Spark Agent 浏览器自动化：基于 @playwright/mcp 的 managed MCP server（名称 playwright，scope=managed 不可删除），' +
    '工具 mcp__playwright__browser_*（browser_navigate / browser_snapshot / browser_click / browser_close 等）。' +
    '嵌入式 Chromium 窗口（CDP 9223 loopback）或 Playwright 自带 Chromium。安装：pnpm add @playwright/mcp playwright，' +
    'playwright install chromium（约 150 MB）。模式：headful（默认）/ headless。最佳实践：先 snapshot → 基于 ref 操作 → 每步后再次 snapshot → 错误时 browser_close。' +
    '安全：嵌入式窗口不加载 preload / 不注入 IPC、CDP 本地 loopback、默认 Skill 禁止访问支付银行敏感页。',
  Body,
}

export default browserAutomation
