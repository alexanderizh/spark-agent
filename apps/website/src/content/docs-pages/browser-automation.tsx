import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Work 有两条互不替代的浏览器能力：managed <code>playwright</code> MCP
      负责成熟网页自动化， 内置 <code>spark_browser</code> MCP 负责应用内可见独立窗口、本地 HTML
      调试、持久脚本、profile 登录态以及 console / network 观察。前者是外挂 Playwright
      自己拉起的浏览器，后者是主进程里真实可见的 Electron 窗口。
    </p>

    <h2 id="how-it-works">1. 两套能力的真实分界</h2>
    <pre>
      {`Agent Runtime
  ├─ stdio MCP "playwright"（managed，自动注册并启用）
  │     └─ Playwright 自启动 Chromium / 系统 Chrome / Edge
  └─ stdio MCP "spark_browser"（内置脚本 + 主进程 bridge）
        └─ Electron BrowserWindow（应用内可见）
              ▲ HTTP 127.0.0.1:<随机端口>，每次调用带 sessionId 校验`}
    </pre>
    <ul>
      <li>
        <strong>playwright</strong>：MCP 记录是 <code>scope=managed</code>、
        <code>name=playwright</code>， 默认 <code>enabled=1</code>，默认 headful。工具名是{' '}
        <code>mcp__playwright__browser_*</code>。
      </li>
      <li>
        <strong>spark_browser</strong>：工具名是 <code>mcp__spark_browser__*</code>，共 17 个；
        只有桌面端注入了 bridge provider 才会挂载。
      </li>
      <li>
        旧的 CDP 9223 嵌入式视图已经移除：协议里的 <code>cdpEndpoint</code> 字段保留为兼容输入，
        正常注册时传 <code>null</code>，Playwright 不再复用 Electron 窗口。
      </li>
    </ul>

    <h2 id="playwright">2. Playwright MCP</h2>
    <p>
      注册逻辑集中在 <code>apps/desktop/src/main/services/PlaywrightMcpRegistration.ts</code>，
      它是这份 configJson 的唯一来源（设置页的「重置配置」也走它）。构造出的 MCP 配置形如：
    </p>
    <pre>
      {`{
  type: "stdio",
  command: "<内置独立 Node 运行时>",
  args: [
    "<@playwright/mcp 的 cli.js>",
    // 仅在用系统浏览器时追加：--browser chrome | --browser msedge
    // 仅在 headless 模式追加：--headless
    // 兼容参数（当前不传）：--cdp-endpoint=<url>
  ],
  env: { PLAYWRIGHT_BROWSERS_PATH: "<内置 Chromium 目录>" }   // 命中内置 Chromium 时才注入
}`}
    </pre>
    <p>
      注册是幂等的，重复注册会保留你手动切换过的 <code>enabled</code> 状态。
    </p>

    <h3 id="playwright-tools">2.1 默认暴露的工具</h3>
    <p>
      注册时没有传 <code>--caps</code>，所以拿到的是 <code>@playwright/mcp</code> 的默认能力集
      （core automation + tab 管理），共 24 个工具：
    </p>
    <pre>
      {`browser_navigate       browser_navigate_back    browser_snapshot        browser_find
browser_click          browser_type             browser_press_key       browser_hover
browser_select_option  browser_fill_form        browser_drag            browser_drop
browser_file_upload    browser_handle_dialog    browser_wait_for        browser_resize
browser_evaluate       browser_run_code_unsafe  browser_take_screenshot browser_console_messages
browser_network_requests  browser_network_request  browser_tabs         browser_close`}
    </pre>
    <p>
      cookie / localStorage / sessionStorage / route / tracing / video / PDF /
      断言类工具属于可选能力， 需要启动时加对应的 <code>--caps</code> 才会出现，当前注册没有开启。
    </p>
    <p>
      内置技能 <code>builtin:browser-use</code> 把工作方式写成了硬约束：先{' '}
      <code>browser_navigate</code> 再 <code>browser_snapshot</code>，基于 snapshot 返回的{' '}
      <code>ref=N</code> 操作（<code>element="ref=3"</code>），不要写 CSS 选择器；每步动作后重新
      snapshot；结束时调 <code>browser_close</code> 释放资源。
    </p>

    <h2 id="setup">3. 设置页与 Chromium 修复</h2>
    <p>
      入口是 <strong>设置 → 浏览器自动化</strong>
      （左侧「系统」分组）。页面标题就是「浏览器自动化」， 包含四行：
    </p>
    <table>
      <thead>
        <tr>
          <th>行</th>
          <th>文案与操作</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>@playwright/mcp</code>
          </td>
          <td>
            显示「已安装 &lt;版本&gt;」或「未安装」；按钮是「安装 MCP」/「重新安装」，内部执行{' '}
            <code>pnpm add @playwright/mcp playwright</code>（工作目录 apps/desktop）
          </td>
        </tr>
        <tr>
          <td>Chromium 浏览器</td>
          <td>
            徽标为「Chromium 已就绪」/「使用系统浏览器」/「Chromium
            未下载」；按钮为「下载浏览器」/「重新下载」，带下载进度
          </td>
        </tr>
        <tr>
          <td>运行模式</td>
          <td>
            headful / headless 分段开关；headful 显示 Playwright 自启动浏览器，headless 后台运行
          </td>
        </tr>
        <tr>
          <td>应用内可见浏览器窗口</td>
          <td>
            说明「Agent 会通过内置 spark_browser MCP 工具按需打开」；按钮「重置配置」重建 MCP
            configJson
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      右上角还有「重新检查」与「MCP 已启用 / 启用 MCP」开关。安装 Chromium
      使用的命令是：打包版执行内置 Node + 打包后的 <code>cli.js install chromium</code>；开发版执行{' '}
      <code>pnpm exec playwright install chromium</code>（Windows 上是 <code>pnpm.cmd</code>），
      超时 5 分钟。
    </p>

    <h3 id="browser-source">3.1 浏览器来源与优先级</h3>
    <p>Playwright 用哪个浏览器是自动判定的，优先级固定：</p>
    <ol>
      <li>
        <strong>随应用下载的 Chromium</strong>：开发态 <code>apps/desktop/browsers/</code>，打包态{' '}
        <code>&lt;userData&gt;/browsers</code> 或 <code>resources/browsers</code>；命中时通过{' '}
        <code>PLAYWRIGHT_BROWSERS_PATH</code> 指给子进程。
      </li>
      <li>
        <strong>Playwright 自己的缓存</strong>（<code>~/.cache/ms-playwright</code>{' '}
        等）：命中时不覆盖 环境变量，交给 Playwright 自动发现。
      </li>
      <li>
        <strong>系统 Chrome / Edge</strong>：作为最后兜底，注册时追加 <code>--browser chrome</code>{' '}
        或 <code>--browser msedge</code>。
      </li>
      <li>
        都没有时状态为 <code>none</code>，设置页提示「未检测到可用浏览器，可点击右侧按钮手动下载约
        150MB 的 Chromium」。
      </li>
    </ol>
    <p>
      不要给 <code>--browser</code> 传 <code>chromium</code>——该参数只接受 <code>chrome</code> /{' '}
      <code>firefox</code> / <code>webkit</code> / <code>msedge</code>；用内置 Chromium
      时是不传这个参数、靠 <code>PLAYWRIGHT_BROWSERS_PATH</code> 路由的。
    </p>

    <h2 id="spark-browser">4. spark_browser：17 个工具</h2>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>关键参数</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>open</code>
          </td>
          <td>
            <code>url</code>（必填）· <code>show</code>（默认 true）· <code>profileId</code> ·{' '}
            <code>reuse</code>
          </td>
          <td>
            打开可见窗口；支持 http/https/file/data URL；<code>reuse=true</code> 时复用同 profile
            的已有窗口
          </td>
        </tr>
        <tr>
          <td>
            <code>navigate</code>
          </td>
          <td>
            <code>url</code>（必填）· <code>windowId</code>
          </td>
          <td>让已有窗口跳转</td>
        </tr>
        <tr>
          <td>
            <code>eval</code>
          </td>
          <td>
            <code>code</code>（必填）· <code>windowId</code>
          </td>
          <td>执行一次 JS，返回 JSON 可序列化结果；DOM 节点要自己 stringify</td>
        </tr>
        <tr>
          <td>
            <code>inject_script</code>
          </td>
          <td>
            <code>code</code>（必填）· <code>scriptId</code> · <code>windowId</code>
          </td>
          <td>持久注入，后续导航会自动重跑</td>
        </tr>
        <tr>
          <td>
            <code>remove_script</code>
          </td>
          <td>
            <code>scriptId</code>（必填）· <code>windowId</code>
          </td>
          <td>移除持久脚本</td>
        </tr>
        <tr>
          <td>
            <code>screenshot</code>
          </td>
          <td>
            <code>windowId</code>
          </td>
          <td>返回 PNG dataUrl 与当前 url / title</td>
        </tr>
        <tr>
          <td>
            <code>get_url</code> / <code>get_title</code>
          </td>
          <td>
            <code>windowId</code>
          </td>
          <td>读取当前地址与标题（包含用户手动导航后的状态）</td>
        </tr>
        <tr>
          <td>
            <code>list_windows</code>
          </td>
          <td>无</td>
          <td>列出窗口的 profile、可见性、url/title、脚本数、网络规则数、console 缓冲条数</td>
        </tr>
        <tr>
          <td>
            <code>close</code>
          </td>
          <td>
            <code>windowId</code>
          </td>
          <td>关窗并清掉该窗口的脚本、网络规则与事件缓冲；profile 存储保留</td>
        </tr>
        <tr>
          <td>
            <code>console_start</code>
          </td>
          <td>
            <code>windowId</code>
          </td>
          <td>开始捕获 log / warn / error</td>
        </tr>
        <tr>
          <td>
            <code>console_events</code> / <code>console_clear</code>
          </td>
          <td>
            <code>windowId</code> · <code>sinceSeq</code>
          </td>
          <td>
            增量读取（用 <code>sinceSeq</code> 轮询）或清空
          </td>
        </tr>
        <tr>
          <td>
            <code>network_set_rules</code>
          </td>
          <td>
            <code>rules[]</code>，每条 <code>match</code>（URL 子串或正则）+ <code>action</code>
            （必填）
          </td>
          <td>
            action 支持 <code>record</code> / <code>block</code> / <code>redirect</code>（
            <code>redirectUrl</code>）/ <code>set_headers</code>（<code>headers</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>network_events</code> / <code>network_clear</code>
          </td>
          <td>
            <code>windowId</code> · <code>sinceSeq</code> / <code>ruleIds</code>
          </td>
          <td>增量读取请求/完成/错误事件，或清理全部/指定规则</td>
        </tr>
        <tr>
          <td>
            <code>clear_profile</code>
          </td>
          <td>
            <code>profileId</code> · <code>scope</code>（cookies / cache / localStorage / indexedDB
            / all）
          </td>
          <td>清空该 profile 的持久数据，会让页面退出登录</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>windowId</code> 全部可省略，省略时作用于第一个打开的窗口。
      <code>mock_response</code> 这个 action 虽然在 schema
      里，但当前构建不支持响应体改写，调用会返回 <code>NETWORK_RULE_UNSUPPORTED</code>。
    </p>

    <h3 id="prebuilt-behavior">4.1 profile、缓冲与桥接</h3>
    <ul>
      <li>
        <strong>profile</strong>：不传 <code>profileId</code> 时用共享的 <code>default</code>{' '}
        分区，登录态、cookie、localStorage、IndexedDB、缓存跨轮次跨重启保留。每个自定义{' '}
        <code>profileId</code>{' '}
        都是全新的空分区（站点全部未登录），只适合确实需要干净环境时用，并且要按用途起 稳定名字（如{' '}
        <code>clean-test</code>），不要按任务临时造名字。分区名形如{' '}
        <code>persist:spark-browser:&lt;profileId&gt;</code>，<code>profileId</code> 只允许{' '}
        <code>[a-zA-Z0-9_.-]</code> 且不超过 80 字符。
      </li>
      <li>
        <strong>窗口</strong>：1280×820、标题 <code>SparkWork Browser</code>，默认可见。
      </li>
      <li>
        <strong>事件缓冲</strong>：console 与 network 各自是环形缓冲，最多保留 500 条，用{' '}
        <code>sinceSeq</code> 增量拉取，别指望能翻很久以前的历史。
      </li>
      <li>
        <strong>桥接</strong>：<code>spark_browser</code> MCP 子进程本身很薄，只把调用代理到主进程的{' '}
        <code>BrowserBridgeServer</code>（监听 127.0.0.1 的随机端口）。每次请求都要带当前
        sessionId， 不在允许集合里的请求直接 403；请求体上限 256 KB。
      </li>
    </ul>

    <h2 id="panel">5. 另一条线：用户手动用的浏览器面板</h2>
    <p>
      除了 Agent 驱动的两个
      MCP，应用里还有一个给用户自己用的浏览器面板（多标签、地址栏、视口预设、开发者
      工具）与「在独立窗口中打开」。其中「<strong>选择元素加入会话</strong>
      」开关会把页面上拾取到的元素 以引用形式（页面 URL + CSS 选择器 + 元素摘要）加到输入框，发给
      Agent 后它可以直接用 spark_browser 定位该元素。这条链路由{' '}
      <code>BrowserPanelWindowService</code> 与 <code>BrowserChrome</code> /{' '}
      <code>useElementPicker</code> 实现，面板与独立窗口共用同一套 chrome，与{' '}
      <code>spark_browser</code> 的自动化窗口是两套窗口。已知限制：元素拾取只覆盖主 frame， 跨域
      iframe 里的点击不会被捕获。
    </p>

    <h2 id="choose">6. 怎么选</h2>
    <table>
      <thead>
        <tr>
          <th>任务</th>
          <th>推荐</th>
          <th>原因</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>稳定点击 / 填表 / 表单流程</td>
          <td>
            <code>playwright</code>
          </td>
          <td>snapshot 的 ref 定位比 CSS 选择器稳，且自带等待</td>
        </tr>
        <tr>
          <td>批量采集、E2E 式验证</td>
          <td>
            <code>playwright</code>
          </td>
          <td>
            可 <code>browser_evaluate</code> 批量取数、可多标签、可上传文件
          </td>
        </tr>
        <tr>
          <td>需要用户看得见、可共享的窗口</td>
          <td>
            <code>spark_browser</code>
          </td>
          <td>就在应用内的 BrowserWindow 里</td>
        </tr>
        <tr>
          <td>
            本地 <code>file://</code> HTML 调试
          </td>
          <td>
            <code>spark_browser</code>
          </td>
          <td>可直接开本地文件，配合 console 捕获与截图</td>
        </tr>
        <tr>
          <td>持久注入脚本、复登录态 profile</td>
          <td>
            <code>spark_browser</code>
          </td>
          <td>
            <code>inject_script</code> 跨导航重跑，profile 分区持久
          </td>
        </tr>
        <tr>
          <td>观察 / 阻断 / 重定向 / 改请求头</td>
          <td>
            <code>spark_browser</code>
          </td>
          <td>主进程 webRequest 级规则 + 事件流</td>
        </tr>
      </tbody>
    </table>
    <p>两者互补：一边被阻断时就换另一边，并说明原因——注入的 system prompt 就是这么要求的。</p>

    <h2 id="security">7. 安全模型与远程限制</h2>
    <ul>
      <li>
        <code>spark_browser</code> 的页面保持 <code>sandbox: true</code>、{' '}
        <code>nodeIntegration: false</code>、<code>contextIsolation: true</code>、{' '}
        <code>webSecurity: true</code>，页面里没有 Node / Electron API。Agent 的能力来自主进程受控的
        eval、webRequest、截图、console 与 profile 工具。
      </li>
      <li>bridge 只绑定 127.0.0.1 且要 sessionId 校验，外部进程无法直接调用。</li>
      <li>
        <strong>远程连接默认不能用内置浏览器</strong>：远程连接能力里的{' '}
        <code>useInternalBrowser</code>
        （界面文案「使用内置浏览器窗口」）默认关闭；只要当前会话绑定的远程 连接没开启它，
        <code>spark_browser</code> 整套 MCP 都不会注入。
      </li>
      <li>
        URL 白名单：只允许 <code>http</code> / <code>https</code> / <code>file</code> /{' '}
        <code>data</code>，其它字符串会被当成域名补 <code>https://</code>。
      </li>
      <li>
        任务结束应主动清理：<code>network_clear</code>、<code>console_clear</code>、
        <code>remove_script</code>、<code>close</code>。<code>clear_profile</code>{' '}
        只在确实要清登录态时用，清 <code>default</code> 会抹掉用户所有登录，必须先确认。
      </li>
    </ul>

    <h2 id="troubleshoot">8. 故障排查</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>排查</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            看不到 <code>mcp__playwright__browser_*</code> 工具
          </td>
          <td>
            到设置 → 浏览器自动化确认 MCP 已安装且「MCP 已启用」；只是 disabled
            时在这里启用即可，不要重启进程；然后刷新会话。
          </td>
        </tr>
        <tr>
          <td>启动报浏览器可执行文件缺失 / 版本不匹配</td>
          <td>
            先复用系统 Chrome / Edge 或已有
            Chromium；都没有时再下载。恢复策略是任务驱动的：应用或会话启动时<strong>不会</strong>
            自动下载。
          </td>
        </tr>
        <tr>
          <td>需要手动下载 Chromium</td>
          <td>
            设置 → 浏览器自动化点「下载浏览器」（约 150MB）。命令行等价物：
            <code>pnpm exec playwright install chromium</code>。
          </td>
        </tr>
        <tr>
          <td>下载卡住 / 404</td>
          <td>
            切国内镜像，只对当前 shell 生效、不要写进全局配置：
            <code>npm config set registry https://registry.npmmirror.com</code> 与{' '}
            <code>export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright</code>
            ，再执行 install。
          </td>
        </tr>
        <tr>
          <td>
            <code>spark_browser</code> 没有打开窗口
          </td>
          <td>
            确认是桌面本机会话；如果是远程会话，需要在远程连接能力里开启「使用内置浏览器窗口」。
          </td>
        </tr>
        <tr>
          <td>
            <code>mock_response</code> 报 unsupported
          </td>
          <td>当前构建只支持 record / block / redirect / set_headers，响应体 mock 未实现。</td>
        </tr>
        <tr>
          <td>每次都要重新登录</td>
          <td>
            多半是给 <code>open</code> 传了新的 <code>profileId</code>
            。省略该参数才会用带登录态的共享 <code>default</code> 分区。
          </td>
        </tr>
        <tr>
          <td>console 事件读不全</td>
          <td>
            先确认已调过 <code>console_start</code>；缓冲上限 500 条，需要增量请用{' '}
            <code>sinceSeq</code>。
          </td>
        </tr>
      </tbody>
    </table>
  </>
)

export const browserAutomation: DocsPageContent = {
  slug: 'browser-automation',
  toc: [
    { id: 'how-it-works', title: '1. 两套能力的真实分界', level: 2 },
    { id: 'playwright', title: '2. Playwright MCP', level: 2 },
    { id: 'playwright-tools', title: '2.1 默认暴露的工具', level: 3 },
    { id: 'setup', title: '3. 设置页与 Chromium 修复', level: 2 },
    { id: 'browser-source', title: '3.1 浏览器来源与优先级', level: 3 },
    { id: 'spark-browser', title: '4. spark_browser：17 个工具', level: 2 },
    { id: 'prebuilt-behavior', title: '4.1 profile、缓冲与桥接', level: 3 },
    { id: 'panel', title: '5. 另一条线：用户手动用的浏览器面板', level: 2 },
    { id: 'choose', title: '6. 怎么选', level: 2 },
    { id: 'security', title: '7. 安全模型与远程限制', level: 2 },
    { id: 'troubleshoot', title: '8. 故障排查', level: 2 },
  ],
  faq: [
    {
      question: 'Playwright 和 spark_browser 是替代关系吗？',
      answer:
        '不是。Playwright MCP 负责成熟网页自动化（ref 定位、等待、多标签、文件上传），spark_browser 负责应用内可见窗口、本地 file:// 调试、持久脚本、profile 登录态和 console/network 观察。一边不可用就换另一边。',
    },
    {
      question: '还能使用 CDP 9223 嵌入式视图吗？',
      answer:
        '不能。旧视图已移除，cdpEndpoint 只作为兼容输入保留，正常注册传 null；Playwright 会自己拉起浏览器，应用内可见窗口由 spark_browser 提供。',
    },
    {
      question: 'spark_browser 会给网页 Node 权限吗？',
      answer:
        '不会。窗口以 sandbox、nodeIntegration=false、contextIsolation=true、webSecurity=true 创建，页面没有 Node/Electron API。',
    },
    {
      question: 'Chromium 没下载会自动安装吗？',
      answer:
        '不会。应用或会话启动时不会触发下载；只有任务真的需要浏览器且没有可用浏览器时才会按需下载（约 150MB），你也可以在 设置 → 浏览器自动化 手动下载。',
    },
    {
      question: '远程连接里能用内置浏览器吗？',
      answer:
        '默认不能。远程连接能力项 useInternalBrowser（「使用内置浏览器窗口」）默认关闭，未开启时该会话连 spark_browser MCP 都不会注入。',
    },
    {
      question: '为什么 Agent 每次都要重新登录网站？',
      answer:
        '通常是因为 open 时传了新的 profileId。每个自定义 profileId 都是空分区；省略 profileId 才会使用带用户登录态的共享 default 分区。',
    },
  ],
  quickReference: [
    { key: 'Playwright MCP', value: 'managed scope，name=playwright，默认 enabled、默认 headful' },
    {
      key: 'Playwright 默认工具',
      value:
        '24 个 mcp__playwright__browser_*（未开启 --caps）；内置技能 builtin:browser-use 要求“先 snapshot 再按 ref 操作”',
    },
    {
      key: 'spark_browser 工具',
      value:
        '17 个：open/navigate/eval/inject_script/remove_script/screenshot/get_url/get_title/list_windows/close/console_start/console_events/console_clear/network_set_rules/network_events/network_clear/clear_profile',
    },
    {
      key: '浏览器优先级',
      value: '内置 Chromium → Playwright 缓存(~/.cache/ms-playwright) → 系统 Chrome/Edge → none',
    },
    {
      key: '手动装 Chromium',
      value:
        '设置 → 浏览器自动化 →「下载浏览器」（约 150MB）；命令行 pnpm exec playwright install chromium',
    },
    {
      key: 'spark_browser profile',
      value: '省略 profileId 用共享 default 分区（保留登录态）；自定义 profileId 是空分区',
    },
    { key: '事件缓冲', value: 'console / network 各保留最多 500 条，用 sinceSeq 增量读取' },
    { key: '远程开关', value: '远程连接能力 useInternalBrowser（默认 false）' },
  ],
  howTo: {
    name: '用 spark_browser 调试本地 HTML 页面',
    description: '打开本地文件、抓 console 错误并截图',
    totalTime: 'PT3M',
    steps: [
      '让 Agent 用 mcp__spark_browser__open 打开 file:///绝对路径/demo.html（省略 profileId 用共享登录态）',
      '调用 mcp__spark_browser__console_start 开始捕获日志',
      '调用 mcp__spark_browser__get_url / get_title 确认实际加载的页面',
      '调用 mcp__spark_browser__console_events 读取 error / warn（用 sinceSeq 增量轮询）',
      '调用 mcp__spark_browser__screenshot 拿 PNG 并定位布局问题',
      '结束时依次 console_clear、network_clear、remove_script、close 清理',
    ],
  },
  aiSummary:
    'Spark Work 浏览器自动化由 managed playwright MCP 与内置 spark_browser MCP 并存提供。' +
    'playwright 以 scope=managed / name=playwright 自动注册并默认启用（默认 headful），工具为 mcp__playwright__browser_*，未加 --caps 时暴露 24 个默认工具；浏览器选择优先级是内置 Chromium（PLAYWRIGHT_BROWSERS_PATH）→ Playwright 缓存 → 系统 Chrome/Edge（--browser chrome|msedge）。' +
    'spark_browser 提供 17 个工具：open/navigate/eval/inject_script/remove_script/screenshot/get_url/get_title/list_windows/close/console_*/network_*（record、block、redirect、set_headers，mock_response 不支持）/clear_profile；窗口以 sandbox 且无 Node API 创建，经 127.0.0.1 随机端口 + sessionId 校验的 bridge 代理到主进程；省略 profileId 用共享登录态 default 分区，console/network 缓冲各 500 条。' +
    'Chromium 约 150MB，仅在任务需要时按需下载，也可在 设置 → 浏览器自动化 手动安装；远程连接需开启 useInternalBrowser 才可用 spark_browser。',
  Body,
}

export default browserAutomation
