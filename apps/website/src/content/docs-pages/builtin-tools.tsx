import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 把高频能力的最佳实践打包成「内置 Skill」，随应用一起发布，开箱即用。
      每个 Skill 都是一份 SKILL.md：包含触发场景、推荐工作流和注意事项，Agent 加载后会按里面的方法执行。
      本页列出应用内置的全部 15 个 Skill，便于你按任务挑选合适的工具。
    </p>

    <h2 id="install">1. 怎么用内置 Skill</h2>
    <ol>
      <li>打开新会话，在「Skill 选择器」里勾选要启用的 Skill（可多选）。</li>
      <li>用自然语言描述任务。Agent 会先看启用的 Skill 描述是否匹配，匹配则把该 Skill 的方法注入 prompt。</li>
      <li>运行期间如果某个 Skill 触发，Agent 会按照 SKILL.md 的工作流执行。</li>
      <li>需要切换 Skill 时，结束当前会话重新选择，或在「设置 → Agent」里调整默认 Skill 集。</li>
    </ol>
    <p>
      内置 Skill 的元信息卡片（名字、描述、分类、版本）始终可见；完整 SKILL.md 只在 Agent 决定使用时才注入上下文，
      因此打开多个 Skill 不会立刻占用大量 token。
    </p>

    <h2 id="tooling">2. 编程 / 工程类</h2>
    <h3 id="claude-api">2.1 Claude API（claude-api）</h3>
    <p>
      构建、调试与优化 Claude API / Anthropic SDK 应用：包含 prompt caching、tool use、batch、files、
      citations、memory、thinking、compaction 等；也覆盖模型版本迁移（4.5 → 4.6 → 4.7 与退役模型替换）。
    </p>
    <p>
      <strong>触发场景</strong>：代码 import <code>anthropic</code> / <code>@anthropic-ai/sdk</code>，用户提到 Claude API /
      Anthropic SDK / Managed Agents，调整 prompt caching、thinking、batch、files、citations、memory 等参数。
    </p>
    <p>
      <strong>跳过场景</strong>：import <code>openai</code> 或其它 provider SDK、文件名带 <code>-openai.py</code> /
      <code>-generic.py</code>、provider-neutral 代码。
    </p>

    <h3 id="commit">2.2 Commit（commit）</h3>
    <p>
      Git 提交助手：分析 <code>git diff</code>，生成符合 Conventional Commits 规范的提交信息，支持中英文，
      支持多文件变更的分组提交（同一类改动一次提交）。
    </p>
    <p><strong>典型提示词</strong>：「帮我把当前所有改动按 conventional commits 规范提交」「拆分成多个有意义的 commit」。</p>

    <h3 id="react">2.3 React（react）</h3>
    <p>
      React 组件开发指南，覆盖 .tsx 文件、UI 创建、@lobehub/ui 组件、路由、构建前端特性。
      触发于 React 组件创建 / 修改 / 布局 / 导航任务。
    </p>
    <p>
      <strong>风格约定</strong>：复杂样式用 antd-style，简单场景用 inline <code>style</code>；
      表单 / 列表优先用 @lobehub/ui 现成组件。
    </p>

    <h3 id="frontend-design">2.4 Frontend Design（frontend-design）</h3>
    <p>
      生成有设计感的、生产级别的前端界面。覆盖网页 / landing / dashboard / React 组件 / HTML/CSS 布局，
      重点是「避免通用 AI 烂大街审美」。会给到具体的字体、间距、阴影、色彩细节。
    </p>
    <p><strong>典型场景</strong>：「帮我设计一个有质感的 SaaS landing page」「让这个 dashboard 不那么'AI 风'」。</p>

    <h3 id="skill-creator">2.5 Skill Creator（skill-creator）</h3>
    <p>
      创建新 Skill、修改现有 Skill、衡量 Skill 性能。包含 eval 流程、benchmark（方差分析）、优化 Skill 描述以提升触发准确度。
    </p>
    <p><strong>典型提示词</strong>：「帮我在 <code>resources/skills/</code> 下新建一个 <code>sql-explain</code> Skill」「我的 Skill 总是被错误触发，怎么改 description」。</p>

    <h2 id="browsing">3. 联网 / 浏览器类</h2>
    <h3 id="multi-search-engine">3.1 Multi Search Engine（multi-search-engine）</h3>
    <p>
      用内置 <code>spark_search</code> 工具检索网络信息、抓取网页正文。多源对比，给出有出处的答案。
      适用任意模型供应商（含第三方 OpenAI 兼容 API）。详细见
      <a href="/docs/web-search">联网搜索</a>。
    </p>

    <h3 id="browser-use">3.2 Browser Use（browser-use）</h3>
    <p>
      通过 Playwright MCP 控制浏览器：导航、点击、输入、截图、数据提取。系统优先使用内置 <code>playwright</code> MCP；
      若不可用，Agent 会把 <code>@playwright/mcp</code> + <code>playwright</code> 安装到内置并注册为 project 作用域的 MCP。
      遇到 npm / chromium 下载网络问题自动切 <code>npmmirror</code> 镜像。
    </p>
    <p>
      如果任务需要<strong>应用内可见浏览器窗口</strong>、本地 <code>file://</code> HTML 调试、
      console / network 观察或保留登录 profile，系统会进一步配合内置 <code>spark_browser</code> MCP。
      两者的协作方式见 <a href="/docs/browser-automation">浏览器自动化文档</a>。
    </p>
    <p><strong>典型场景</strong>：网页信息采集、自动填表、UI 验证、网页截图、登录后操作内网系统、本地 HTML 调试。</p>

    <h2 id="canvas">4. 画布 / 内容生产类</h2>
    <h3 id="canvas-studio">4.1 Canvas Studio（canvas-studio）</h3>
    <p>
      用 <code>mcp__spark_canvas__*</code> 工具操作 Spark Agent 的无限画布。
      用户提到画布 / 节点 / 素材 / 影视资产 / 文稿拆章 / 剧本拆解 / 角色 / 场景 / 道具 / 特效 / 分镜 / 关键帧 /
      首尾帧视频 / 360 全景 / 导演台 / 成片清单 时应优先加载。
    </p>
    <p><strong>核心工具</strong>：节点 CRUD、画布任务、AI 操作面板、资产中心、提示词库、时间线、分镜网格。</p>

    <h3 id="multimedia-use">4.2 Multimedia Use（multimedia-use）</h3>
    <p>
      多媒体生成与编辑指南：覆盖文生图、图生图、图片编辑、多图合成、文生视频、图生视频、视频编辑、
      视频扩展、TTS、配音和音频转写。它会指导 Agent 先查看可用模型和参数约束，再通过画布操作节点或
      <code>spark_media</code> 工具提交任务。
    </p>
    <p>
      <strong>典型场景</strong>：为角色生成定妆图、用参考图保持一致性、用首尾帧生成视频、把旁白转成配音、
      把音频转写成字幕或文稿。
    </p>

    <h3 id="spark-web-tool">4.3 Spark Web Tool（spark-web-tool）</h3>
    <p>生成三类高质量内容产物：</p>
    <ol>
      <li>
        <strong>交互式课件（courseware）</strong>：大纲确认 → PPTX / HTML / DOCX / Markdown 多格式输出。
      </li>
      <li>
        <strong>专题讲解（explain）</strong>：5 步流程「理解 → 研究 → 验证 → 脚本 → 输出」，支持 HTML 幻灯片 /
        自定义网页 / PPTX / DOCX。
      </li>
      <li>
        <strong>数据分析（data-analysis）</strong>：读 CSV / Excel → HTML 数据分析报告（含可视化图表）。
      </li>
    </ol>
    <p>
      所有任务在创建前先做一轮「内容 + 视觉设计」问答澄清，确认设计方向后再执行。
    </p>

    <h3 id="echarts">4.4 ECharts（echarts）</h3>
    <p>
      生成高质量 ECharts 配置：折线 / 柱状 / 饼 / 散点 / 地图 / 热力图 / 桑基 等所有常见图表类型，
      含美观的默认样式和交互配置。可单独使用，也可以作为数据分析报告的子任务被 <code>spark-web-tool</code> 调用。
    </p>

    <h2 id="ui">5. UI / 设计 / 体验类</h2>
    <h3 id="ui-ux-pro-max">5.1 UI/UX Pro Max（ui-ux-pro-max）</h3>
    <p>
      UI/UX 设计智能库：50+ 设计风格、161 色板、57 字体配对、161 产品类型、99 条 UX 准则、25 种图表，
      跨 10 个技术栈（React / Next.js / Vue / Svelte / SwiftUI / React Native / Flutter / Tailwind /
      shadcn-ui / HTML/CSS）。
    </p>
    <p>
      <strong>Action</strong>：plan / build / create / design / implement / review / fix / improve / optimize / enhance / refactor / check。
    </p>
    <p>
      <strong>Element</strong>：button / modal / navbar / sidebar / card / table / form / chart。
    </p>
    <p>
      <strong>Style</strong>：glassmorphism / claymorphism / minimalism / brutalism / neumorphism / bento grid /
      dark mode / responsive / skeuomorphism / flat design。
    </p>

    <h2 id="debug">6. 调试 / 平台管理类</h2>
    <h3 id="spark-debug">6.1 Spark Debug（spark-debug）</h3>
    <p>
      交互式调试模式：面对难复现的 bug，Agent 用「假设驱动 + 人在回路」闭环排查——读代码形成假设 →
      插入会上报到本地日志服务的 debug 日志 → 让用户去复现 → 读本轮日志验证 / 推翻假设 → 修复并再插一轮验证
      → 用户确认解决后清除全部插桩交付。<strong>绝不假装自己能复现</strong>，复现永远交给用户。
    </p>

    <h3 id="find-skills">6.2 Find Skills（find-skills）</h3>
    <p>
      技能发现与推荐：根据任务描述，从已安装和远程技能库中搜索匹配的技能，推荐最适合的技能组合。
      帮你发现和安装新技能以增强 Agent 能力。
    </p>

    <h3 id="platform-manager">6.3 Platform Manager（platform-manager）</h3>
    <p>
      内置管理 Skill：管理 Spark Agent 的 Skills / MCP / Providers / Workflows / Agents / Teams / Settings / 看板任务。
      命名空间 <code>mcp__spark_platform__*</code>，所有会话默认挂载。详细见
      <a href="/docs/agents-workflows#platform-tools">Agent 工作流 / Platform 管理工具</a>。
    </p>

    <h2 id="how-to-pick">7. 怎么选合适的 Skill</h2>
    <table>
      <thead>
        <tr>
          <th>你的任务</th>
          <th>优先 Skill</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>查最新技术资料 / 调研报告</td><td>multi-search-engine</td></tr>
        <tr><td>登录网页 / 抓数据 / UI 测试</td><td>browser-use</td></tr>
        <tr><td>写 React 组件 / 修样式</td><td>react + frontend-design</td></tr>
        <tr><td>做交互式网页 / Dashboard</td><td>frontend-design / ui-ux-pro-max</td></tr>
        <tr><td>画布上跑 AI 生成 / 创作流程</td><td>canvas-studio</td></tr>
        <tr><td>图片 / 视频 / 音频生成与编辑</td><td>multimedia-use</td></tr>
        <tr><td>出课件 / 数据分析报告 / 专题讲解</td><td>spark-web-tool</td></tr>
        <tr><td>做数据可视化图表</td><td>echarts（可单独 / 可被 spark-web-tool 调用）</td></tr>
        <tr><td>提交代码 / 生成 commit message</td><td>commit</td></tr>
        <tr><td>难复现 bug 调试</td><td>spark-debug</td></tr>
        <tr><td>管理 Skills / MCP / Agents / Teams</td><td>platform-manager</td></tr>
        <tr><td>新建或改进 Skill 本身</td><td>skill-creator</td></tr>
        <tr><td>不确定该用哪个 Skill</td><td>find-skills</td></tr>
      </tbody>
    </table>

    <h2 id="add-own">8. 添加自己的 Skill</h2>
    <p>
      内置 Skill 的内容在 <code>apps/desktop/resources/skills/&lt;slug&gt;/SKILL.md</code>。
      复制目录、按上面的 frontmatter + markdown 改写即可。
      修改后重启应用，新 Skill 会出现在「Skill 选择器」里。
    </p>
    <p>
      想给第三方用户分发？参见 <a href="/docs/mcp-skills">MCP 与 Skills</a> 里的「可安装技能目录」机制，
      通过 <code>INSTALLABLE_SKILL_CATALOG</code> 一键安装。
    </p>
  </>
)

export const builtinTools: DocsPageContent = {
  slug: 'builtin-tools',
  toc: [
    { id: 'install', title: '1. 怎么用内置 Skill', level: 2 },
    { id: 'tooling', title: '2. 编程 / 工程类', level: 2 },
    { id: 'claude-api', title: '2.1 Claude API', level: 3 },
    { id: 'commit', title: '2.2 Commit', level: 3 },
    { id: 'react', title: '2.3 React', level: 3 },
    { id: 'frontend-design', title: '2.4 Frontend Design', level: 3 },
    { id: 'skill-creator', title: '2.5 Skill Creator', level: 3 },
    { id: 'browsing', title: '3. 联网 / 浏览器类', level: 2 },
    { id: 'multi-search-engine', title: '3.1 Multi Search Engine', level: 3 },
    { id: 'browser-use', title: '3.2 Browser Use', level: 3 },
    { id: 'canvas', title: '4. 画布 / 内容生产类', level: 2 },
    { id: 'canvas-studio', title: '4.1 Canvas Studio', level: 3 },
    { id: 'multimedia-use', title: '4.2 Multimedia Use', level: 3 },
    { id: 'spark-web-tool', title: '4.3 Spark Web Tool', level: 3 },
    { id: 'echarts', title: '4.4 ECharts', level: 3 },
    { id: 'ui', title: '5. UI / 设计 / 体验类', level: 2 },
    { id: 'ui-ux-pro-max', title: '5.1 UI/UX Pro Max', level: 3 },
    { id: 'debug', title: '6. 调试 / 平台管理类', level: 2 },
    { id: 'spark-debug', title: '6.1 Spark Debug', level: 3 },
    { id: 'find-skills', title: '6.2 Find Skills', level: 3 },
    { id: 'platform-manager', title: '6.3 Platform Manager', level: 3 },
    { id: 'how-to-pick', title: '7. 怎么选合适的 Skill', level: 2 },
    { id: 'add-own', title: '8. 添加自己的 Skill', level: 2 },
  ],
  faq: [
    {
      question: '一次能启用多少个 Skill？',
      answer: '技术上不限，但推荐 2~4 个。多个 Skill 同时加载会拉长 system prompt，影响响应速度。',
    },
    {
      question: 'Skill 会被错误触发吗？',
      answer: '会。Skill 通过 description 文本触发匹配，措辞模糊时容易被误触发。用 skill-creator 的 eval 工具可以优化。',
    },
    {
      question: '修改内置 Skill 会影响升级吗？',
      answer: '会。升级时被覆盖。建议把自定义 Skill 放到 {userData}/skills/（与内置同名时优先级更高）或独立 slug。',
    },
    {
      question: 'Skill 和 MCP 是什么关系？',
      answer: 'Skill 是 Agent 读的「说明书」（SKILL.md），MCP 是 Agent 调的「工具集」。Skill 可引用 MCP（如 canvas-studio 引用 spark_canvas MCP）。',
    },
  ],
  quickReference: [
    { key: '内置 Skill 数量', value: '15 个（apps/desktop/resources/skills/）' },
    { key: '分类', value: '编程 / 工程 / 联网 / 浏览器 / 画布 / 内容生产 / UI 设计 / 调试 / 平台管理' },
    { key: '加载策略', value: '元信息常驻；正文按需注入' },
    { key: '自定义位置', value: '{userData}/skills/<slug>/（覆盖内置）' },
    { key: '管理 MCP', value: 'mcp__spark_platform__*（platform-manager Skill）' },
    { key: 'Skill 优化工具', value: 'skill-creator（eval / benchmark / 触发准确度调优）' },
  ],
  howTo: {
    name: '挑选并启用合适的内置 Skill',
    description: '从任务描述出发，在 Skill 选择器中勾选最相关的 Skill',
    totalTime: 'PT2M',
    steps: [
      '打开新会话，看右侧「Skill 选择器」',
      '根据「7. 怎么选合适的 Skill」表，挑出 1~4 个相关 Skill',
      '勾选启用；多个 Skill 会被同时注入 system prompt',
      '用自然语言描述任务，让 Agent 按 Skill 的方法执行',
      '运行中如触发不合适，可在「设置 → Agent」调整默认 Skill 集',
    ],
  },
  aiSummary:
    'Spark Agent 内置 15 个 Skill（apps/desktop/resources/skills/）：编程工程类（claude-api / commit / react / frontend-design / ' +
    'skill-creator）、联网浏览器类（multi-search-engine / browser-use）、画布内容生产类（canvas-studio / multimedia-use / spark-web-tool / echarts）、' +
    'UI 设计类（ui-ux-pro-max）、调试平台管理类（spark-debug / find-skills / platform-manager）。' +
    '每个 Skill 是一份 SKILL.md（frontmatter + markdown 正文），元信息常驻、正文按需注入。' +
    'platform-manager 提供 mcp__spark_platform__* 管理工具（skills/mcp/providers/workflows/agents/teams/settings/board_tasks）。' +
    '加载方式：会话 Skill 选择器勾选启用；推荐 1~4 个相关 Skill 避免 prompt 过长。' +
    '调试场景用 spark-debug 的「假设驱动 + 人在回路」闭环；Skill 触发不准用 skill-creator 优化。' +
    '自定义 Skill 放 {userData}/skills/<slug>/ 覆盖内置。',
  Body,
}

export default builtinTools
