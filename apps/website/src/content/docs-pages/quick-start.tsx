import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      这份指南带你从零跑通 Spark Work：装好应用、接入一个可用的模型服务、确认助手配置，
      然后完成第一个真实任务。全程不需要写代码，但你需要准备下面任意一种模型来源： 第三方模型的 API
      Key、Spark 账号，或本机已经登录好的 Claude Code / Codex。
    </p>

    <h2 id="install">1. 下载与安装</h2>
    <p>
      从 <a href="/download">下载页</a> 取安装包。下载页按当前系统自动推荐版本，
      当前提供的产物是三条：
    </p>
    <table>
      <thead>
        <tr>
          <th>平台</th>
          <th>格式</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>macOS Apple Silicon（arm64）</td>
          <td>
            <code>.dmg</code>
          </td>
          <td>M 系列芯片，推荐版本</td>
        </tr>
        <tr>
          <td>macOS Intel（x64）</td>
          <td>
            <code>.dmg</code>
          </td>
          <td>Intel 机型备用包</td>
        </tr>
        <tr>
          <td>Windows（x64）</td>
          <td>
            <code>.exe</code>
          </td>
          <td>NSIS 安装向导，支持 Windows 10 / 11 x64</td>
        </tr>
      </tbody>
    </table>
    <p>根据你的系统选择对应条目即可：</p>
    <ul>
      <li>
        <strong>macOS</strong>：打开 DMG，把应用拖进「应用程序」。应用在 Finder 与程序坞里显示的
        名字是 <code>SparkWork</code>（可执行文件与安装包名仍为 Spark Agent，属正常现象）。
        首次打开如果被系统拦下，去「系统设置 → 隐私与安全性」点「仍要打开」。
      </li>
      <li>
        <strong>Windows</strong>：运行 <code>.exe</code>。安装向导会让你选择安装位置，
        应用文件固定落在所选目录下的 <code>spark-worker</code> 子目录里；卸载项显示为
        <code>SparkWork &lt;版本号&gt;</code>。安装目录可随时在向导里改，不要手动移动子目录。
      </li>
    </ul>
    <p>
      <strong>首次启动会发生什么</strong>：应用会打开「新手引导」，依次问你
      「你想先做些什么」→「选择你的 AI 模型」→ 连接测试 → 起一个助手 → 发送第一句任务。
      引导页上有「稍后再说」，任何时候都能跳过； 之后想重来，去{' '}
      <strong>设置 → 通用 → 新手引导</strong> 点「重新打开」。
    </p>
    <div className="docs-callout">
      <strong>关于系统权限</strong>：基础会话不需要任何系统权限。下面这些是按需申请的，
      不授权不会阻塞主流程：
      <ul>
        <li>
          <strong>屏幕录制、辅助功能与输入控制</strong>：只有「电脑操作（Computer Use）」
          和窗口快照需要。入口在 <strong>设置 → 电脑操作</strong>，可以逐项授权并跑一次诊断。
        </li>
        <li>
          <strong>麦克风</strong>：只有语音输入需要，按 <code>Ctrl+Shift+D</code>
          （macOS 上是 <code>⌃⇧D</code>）切换语音输入时才会申请。
        </li>
      </ul>
    </div>
    <p>
      <strong>可选功能组件</strong>：Codex 本地运行时、离线 Office 预览、本地深度处理（深度视频）、
      FFmpeg、Chromium、语音输入资源都不在基础安装包里，按需下载。 入口在{' '}
      <strong>设置 → 完整性 → 可选功能组件</strong>，未安装时对应功能会给出明确的安装提示，
      也可以在功能首次使用时按提示安装。
    </p>

    <h2 id="provider">2. 接入模型服务</h2>
    <p>有两条路，任选一条：</p>
    <ol>
      <li>
        <strong>跟着新手引导走</strong>：在「选择你的 AI 模型」页选 「第三方模型」（推荐，仅需 API
        Key）、「Spark 账号」（登录即用，无需 Key） 或「本机 AI 工具」（复用本机已登录的 Claude Code
        / Codex）。
      </li>
      <li>
        <strong>手动配置</strong>：点侧边栏的 <strong>「模型」</strong> 页
        （不是「设置」里的子项），点「添加 Provider」。
      </li>
    </ol>
    <p>手动添加 Provider 时，抽屉里的字段就是下面这些：</p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>可选值 / 说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>模型类型</td>
          <td>
            对话模型、生图模型、语音模型、视频模型。只有对话模型会出现协议、BaseURL、 测试连接等选项
          </td>
        </tr>
        <tr>
          <td>API 协议格式</td>
          <td>
            <code>Anthropic 格式</code> 或 <code>OpenAI 格式</code>；只有对话模型需要选
          </td>
        </tr>
        <tr>
          <td>供应商模板</td>
          <td>
            内置预设（OpenAI、Anthropic、Google Gemini、DeepSeek API、通义千问、Kimi
            (Moonshot)、火山方舟等）会自动填好 BaseURL 与默认模型；自建 /
            代理网关选「自定义」后手动填
          </td>
        </tr>
        <tr>
          <td>显示名称</td>
          <td>
            列表里展示的名字，例如 <code>Anthropic · Claude</code>
          </td>
        </tr>
        <tr>
          <td>BaseURL</td>
          <td>
            服务基础地址。OpenAI 官方预设是 <code>https://api.openai.com/v1</code>， Anthropic
            预设是 <code>https://api.anthropic.com</code>
          </td>
        </tr>
        <tr>
          <td>API Key</td>
          <td>密钥输入框右侧若有「获取密钥」链接，说明该渠道已知控制台地址</td>
        </tr>
        <tr>
          <td>默认模型 ID</td>
          <td>
            填模型 ID（如 <code>gpt-5.5</code>、<code>claude-sonnet-4-20250514</code>），
            也可以点「获取模型」从服务商拉取真实模型列表后选择
          </td>
        </tr>
        <tr>
          <td>测试连接</td>
          <td>对话模型专有，会真的发一次请求验证 Key 与模型名</td>
        </tr>
        <tr>
          <td>默认 Provider</td>
          <td>打开后新会话默认用它（媒体类型显示为「默认调用模型」）</td>
        </tr>
      </tbody>
    </table>
    <p>
      引导页的表单更短，只有<strong>服务商</strong>、<strong>密钥</strong>、<strong>模型 ID</strong>
      （可点「获取模型」）、<strong>API URL</strong> 四项，
      底部按钮是「测试并保存」——按下就会同时创建 Provider 并跑一次连接测试。
    </p>
    <p>
      <strong>用本地模型</strong>：走「自定义 + OpenAI 格式 + BaseURL」这条路。 Ollama 的 OpenAI
      兼容入口通常是 <code>http://localhost:11434/v1</code>， 模型 ID 填你本地{' '}
      <code>ollama list</code> 里的名字（例如 <code>qwen3:14b</code>）。 仓库里保留了 Ollama
      模板但当前默认注释掉，因此界面上不会直接出现这个预设。
    </p>
    <p>
      <strong>密钥存在哪</strong>：所有 API Key 都走统一的凭据存储（keytar）， macOS
      上集中保存为一个由系统加密能力保护的文件
      <code>credential-vault-v1.enc</code>（权限 0600），Windows 上落到系统凭据管理器。
      密钥不会写进数据库明文，也不会出现在项目配置文件里。
    </p>

    <h2 id="first-agent">3. 认识与创建 Agent</h2>
    <p>开箱就有两个内置助手，不需要你配置也能用：</p>
    <ul>
      <li>
        <strong>Spark助手</strong>（稳定 ID <code>platform-manager-agent</code>）：默认助手，
        同时负责平台管理（Skills / MCP / Provider / 工作流 / 看板等）和全栈开发任务。
      </li>
      <li>
        <strong>画布助手</strong>（<code>canvas-assistant-agent</code>）：只在无限画布的 Agent
        面板里用，熟悉节点、分组、影视流水线和多媒体生成。
      </li>
    </ul>
    <p>
      新手引导里选完模型后，会按你选的用途建一个属于你的助手，名字形如 「我的通用助手 / 我的文档助手
      / 我的工作助理 / 我的开发助手」。 想改或新建，去侧边栏的 <strong>「助手」</strong>{' '}
      页，点进编辑抽屉。抽屉分六个区：
    </p>
    <ul>
      <li>
        <strong>基本信息</strong>：名称、状态（启用 / 停用）、描述、是否为默认 Agent。
      </li>
      <li>
        <strong>执行配置</strong>：Provider（可选「跟随会话」）、执行器（Claude SDK / Codex /
        Spark）、 默认模型、权限、推理强度、推理 Token 预算（仅 Claude SDK）、工作流， 以及这个
        Agent 的系统提示词。
      </li>
      <li>
        <strong>Skills</strong>：按需加载哪些工作说明书。
      </li>
      <li>
        <strong>MCP 服务</strong>：挂在它名下的 MCP 服务器。
      </li>
      <li>
        <strong>规则</strong>：这个 Agent 必须遵守的项目约束。
      </li>
      <li>
        <strong>Hook</strong>：Agent 专属的事件钩子覆盖。
      </li>
    </ul>
    <p>
      <strong>权限模式不是一个固定列表，它跟着执行器走</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>执行器</th>
          <th>可选权限</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Claude SDK</td>
          <td>请求批准 / 计划模式 / 自动编辑 / 自动审批 / 完全访问</td>
        </tr>
        <tr>
          <td>Codex</td>
          <td>按需批准 / 替我批准 / 完全访问</td>
        </tr>
        <tr>
          <td>Spark</td>
          <td>手动审批 / 自动审批 / 完全访问</td>
        </tr>
      </tbody>
    </table>
    <p>
      推理强度的可选值是 <code>minimal</code>、<code>low</code>、<code>medium</code>、
      <code>high</code>、<code>xhigh</code>、<code>max</code>； 新手引导创建的助手统一用{' '}
      <code>medium</code>。
    </p>
    <p>
      简单记法：<strong>先挑模型和执行器，再决定它能用哪些能力，最后收紧权限</strong>。
      不确定时保持默认即可——「请求批准」下每个有副作用的工具调用都会先弹审批卡。
    </p>

    <h2 id="first-task">4. 跑通第一个任务</h2>
    <p>能跑通的最小配置只需要两样：一个可用的对话模型 Provider，一个启用的 Agent。</p>
    <ol>
      <li>点侧边栏的「新建任务」按钮，或在空会话首页直接输入。</li>
      <li>
        用一句自然语言描述目标，例如「把这个目录里的 README 整理成一份 300 字的产品介绍」。
        需要的话把文件、目录、图片拖进输入框或粘贴进来。
      </li>
      <li>
        发送后，Agent 会在会话里展示执行过程：工具调用卡片（带参数与耗时）、 代码
        diff、图表、生成的文件都会内联出现。
      </li>
      <li>
        涉及写文件、跑命令、访问网络时，输入框上方会弹出<strong>审批卡</strong>，
        显示工具名、参数摘要和风险等级（低 / 中 / 高），四个按钮是
        「拒绝」「会话拒绝」「会话允许」「允许」。
      </li>
      <li>
        想看细节就打开右侧面板：<strong>终端</strong>、<strong>代码</strong>、
        <strong>浏览器</strong>、<strong>审查</strong>、<strong>计划</strong>、<strong>侧聊</strong>{' '}
        都可以和对话并排。
      </li>
    </ol>
    <p>几个立刻用得上的输入区快捷键：</p>
    <ul>
      <li>
        <code>Enter</code> 发送，<code>Shift+Enter</code> 换行。
      </li>
      <li>
        <code>Shift+Tab</code> 切换本次会话的权限模式。
      </li>
      <li>Agent 忙的时候继续输入会自动进入队列，可拖动排序、编辑、单条立即执行。</li>
      <li>
        <code>/</code> 打开内置命令与自定义命令列表。
      </li>
      <li>
        <code>Ctrl+Shift+D</code>（macOS 为 <code>⌃⇧D</code>）开关语音输入，实时转写追加到草稿。
      </li>
    </ul>
    <p>
      任务跑歪了不用重来：右侧 <strong>会话检查器</strong> 里有「代码还原点」区块 （仅 Git
      仓库可用），点「打开时间线」后开启记录，之后点「回到这一步」
      就能把工作区文件还原到该轮之前。跑通一个真实任务之后， 再读{' '}
      <a href="/docs/code-development">代码开发</a>、<a href="/docs/canvas-mvp">无限画布</a>、
      <a href="/docs/agents-workflows">Agent 工作流</a> 会顺很多。
    </p>

    <h2 id="cli">5. Spark CLI（可选）</h2>
    <p>
      桌面应用<strong>已经内置了完整的 spark 引擎</strong>（以 SDK 形式在进程内运行），
      日常使用不需要装任何命令行工具。只有你想在终端里用 <code>spark</code> 命令和 TUI 时，
      才需要单独装 CLI。
    </p>
    <p>
      安装前提是 Node.js <code>&gt;=22.14.0 &lt;23</code>。三条等价路径选一条：
    </p>
    <pre>
      {`# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases/install.sh | sh

# Windows PowerShell
irm https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases/install.ps1 | iex

# 或者用 npm 全局安装
npm install -g @spark/agent

# 已经有一份包（克隆的仓库 / 解压的 tarball）：把启动器链接到 ~/.spark/bin
spark install`}
    </pre>
    <p>装完之后先验环境，再看当前状态：</p>
    <pre>
      {`spark --version          # 版本
spark doctor             # PATH 上的 spark、版本漂移、Node 版本、SparkWork bridge 状态
spark update --check     # 只检查有没有新版本
spark update             # 事务式自更新，失败自动回滚
spark login              # 登录 Spark 账号（logout / whoami 配套）
spark sessions           # 列出当前目录的历史会话
spark --continue         # 继续当前目录最近一次会话`}
    </pre>
    <p>
      <strong>
        CLI 与桌面应用共用 <code>~/.spark</code> 数据根
      </strong>
      ，因此两边能看到同一批配置。 桌面应用运行时会在 <code>~/.spark/hosts/sparkwork/</code>{' '}
      下写一份
      <code>bridge-&lt;实例 id&gt;.json</code> 描述文件（含本机回环地址与一次性 token）， CLI
      启动时据此把桌面端已配置的渠道列进模型选择器；桌面退出后这些描述会变成 「陈旧
      bridge」并被自动忽略，<code>spark doctor</code> 会同时报告已连接状态与陈旧描述数量。
    </p>
    <p>交互式 TUI 里常用的是这些斜杠命令：</p>
    <table>
      <thead>
        <tr>
          <th>命令</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>/model</code>
          </td>
          <td>打开模型选择器（SparkWork 路由 + 本地渠道）</td>
        </tr>
        <tr>
          <td>
            <code>/perm</code>
          </td>
          <td>切换本会话权限：manual → auto → bypass</td>
        </tr>
        <tr>
          <td>
            <code>/effort</code>
          </td>
          <td>切换推理强度：low → medium → high → max → off</td>
        </tr>
        <tr>
          <td>
            <code>/status</code>
          </td>
          <td>会话 id、排队轮次、事件数、当前控件</td>
        </tr>
        <tr>
          <td>
            <code>/clear</code>
          </td>
          <td>开一个新会话</td>
        </tr>
        <tr>
          <td>
            <code>/help</code>
          </td>
          <td>命令参考（Tab 可补全前缀）</td>
        </tr>
      </tbody>
    </table>
    <p>
      提示：<code>bypass</code>（完全访问）在 TUI 里必须经过选择器并二次回车确认，
      单键循环不会碰到它；通过 <code>--permission-mode bypass</code> 启动则是显式选择。
    </p>

    <h2 id="troubleshoot">6. 常见问题排查</h2>
    <ul>
      <li>
        <strong>模型调用失败</strong>：先去「模型」页点「测试连接」，拿到的是服务商真实响应。 401 /
        403 一般是 Key 不对或没有该模型权限，404 多数是 BaseURL 或模型 ID 写错， 429
        是限流。测试连接只对对话模型显示。
      </li>
      <li>
        <strong>点发送没反应</strong>：检查当前会话绑定的 Agent 是否被停用， 以及它绑定的 Provider
        是否被禁用——两者任一不可用都不会有可用的模型配置。
      </li>
      <li>
        <strong>AI 一直卡在审批</strong>：审批卡在输入框上方，需要你点「允许」或「会话允许」； 按{' '}
        <code>Esc</code> 等价于拒绝。长时间无响应会自动拒绝并让 Agent 跳过该操作。
      </li>
      <li>
        <strong>提示 FFmpeg / Codex / Office 预览缺失</strong>：这些是可选功能组件， 去{' '}
        <strong>设置 → 完整性</strong> 安装即可，基础安装包不携带它们。
      </li>
      <li>
        <strong>电脑操作无法启动</strong>：在 <strong>设置 → 电脑操作</strong> 里检查
        「屏幕录制」和「辅助功能与输入控制」两项授权，再用同一个页面里的诊断功能排查。
      </li>
      <li>
        <strong>想回到初始状态重来一遍</strong>：<strong>设置 → 通用 → 新手引导</strong>
        点「重新打开」。这只会重放引导，不会删除数据。
      </li>
    </ul>
  </>
)

export const quickStart: DocsPageContent = {
  slug: 'quick-start',
  toc: [
    { id: 'install', title: '1. 下载与安装', level: 2 },
    { id: 'provider', title: '2. 接入模型服务', level: 2 },
    { id: 'first-agent', title: '3. 认识与创建 Agent', level: 2 },
    { id: 'first-task', title: '4. 跑通第一个任务', level: 2 },
    { id: 'cli', title: '5. Spark CLI（可选）', level: 2 },
    { id: 'troubleshoot', title: '6. 常见问题排查', level: 2 },
  ],
  faq: [
    {
      question: 'Spark Work 支持哪些操作系统？',
      answer:
        '下载页当前提供 macOS（Apple Silicon 与 Intel 的 .dmg）和 Windows 10/11 x64 的 .exe 安装向导。',
    },
    {
      question: '不装 Spark CLI 能用吗？',
      answer:
        '能。桌面应用内置了完整的 spark 引擎（SDK 在进程内运行），CLI 只在你想用终端命令和 TUI 时才需要单独安装。',
    },
    {
      question: '可以用本地模型吗？',
      answer:
        '可以。在「模型」页新建 Provider，模型类型选对话模型、API 协议格式选 OpenAI 格式，BaseURL 填本地服务的 OpenAI 兼容地址（例如 Ollama 的 http://localhost:11434/v1），模型 ID 填本地实际模型名。',
    },
    {
      question: 'API Key 存在哪里？',
      answer:
        '统一走系统的凭据存储：macOS 上是一个由系统加密能力保护的文件 credential-vault-v1.enc（权限 0600），Windows 上落到系统凭据管理器。不会明文写进数据库或项目配置。',
    },
    {
      question: '可以不填 API Key，直接复用本机已登录的 Claude Code / Codex 吗？',
      answer:
        '可以。新手引导的「本机 AI 工具」会检测本机是否装了并登录过 Claude Code 或 Codex，检测到就直接复用，不需要填 Key。',
    },
    {
      question: '误关了新手引导，怎么重新打开？',
      answer: '设置 → 通用 → 新手引导 → 「重新打开」。只重放引导，不删除任何数据。',
    },
  ],
  quickReference: [
    { key: '安装包产物', value: 'macOS arm64 / x64 .dmg、Windows x64 .exe（NSIS 向导）' },
    { key: 'Windows 应用目录', value: '所选安装目录下的 spark-worker 子目录' },
    { key: '下载数据来源', value: '/download 页 + /api/v1/desktop/releases/latest?channel=stable' },
    { key: '模型类型枚举', value: 'multimodal / image / voice / video' },
    { key: 'API 协议枚举', value: 'anthropic / openai' },
    { key: '凭据存储', value: 'keytar（macOS 集中为 safeStorage 加密的 credential-vault-v1.enc）' },
    { key: '内置助手', value: 'Spark助手 platform-manager-agent、画布助手 canvas-assistant-agent' },
    {
      key: '可选功能组件',
      value: '设置 → 完整性（Codex 运行时 / Office 预览 / 本地深度 / FFmpeg / Chromium / 语音包）',
    },
    { key: 'CLI 数据根', value: '~/.spark（与桌面应用共用）' },
    { key: 'CLI Node 要求', value: '>=22.14.0 <23' },
    { key: '重开新手引导', value: '设置 → 通用 → 新手引导 → 重新打开' },
  ],
  howTo: {
    name: 'Spark Work 首次跑通',
    description: '下载安装 → 接入模型 → 确认助手 → 完成第一个任务',
    totalTime: 'PT10M',
    steps: [
      '在 /download 选择与你系统匹配的安装包并完成安装（macOS 拖入「应用程序」，Windows 走安装向导）',
      '首次启动跟随新手引导，在「选择你的 AI 模型」里选第三方模型 / Spark 账号 / 本机 AI 工具',
      '第三方模型：填服务商、密钥、模型 ID（可点「获取模型」拉取），按「测试并保存」',
      '想手动配置就打开侧边栏「模型」页，添加 Provider 并点「测试连接」',
      '在侧边栏「助手」页确认或新建 Agent，选好执行器、模型与权限模式',
      '新建任务，用一句自然语言描述目标并发送；在审批卡上允许写文件、跑命令等操作',
      '需要边看边聊时打开右侧的终端 / 代码 / 浏览器 / 审查面板',
    ],
  },
  aiSummary:
    'Spark Work 快速开始：macOS（arm64/x64 dmg）与 Windows（x64 exe，装到 spark-worker 目录）安装、首次启动的新手引导流程、' +
    'Provider 接入的三条路径（第三方 API Key / Spark 账号 / 本机 Claude Code 与 Codex）与真实表单字段（模型类型 multimodal|image|voice|video、协议 anthropic|openai、BaseURL、默认模型 ID、测试连接）、' +
    '内置 Spark助手（platform-manager-agent）与画布助手，Agent 编辑抽屉的六区结构与按执行器区分的权限模式，' +
    '第一个任务的发送、四档审批卡与代码还原点，可选的 Spark CLI（安装、update、doctor、login/whoami、与桌面共用 ~/.spark 及本地 bridge 路由），' +
    '以及按需安装的可选功能组件（Codex 运行时 / Office 预览 / 本地深度 / FFmpeg / Chromium / 语音包）。',
  Body,
}

export default quickStart
