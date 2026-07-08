import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      这份快速开始指南帮你在 5 分钟内完成 Spark Agent 的首次安装、模型配置并跑通第一个真实任务。
      整个过程不需要写代码，但请准备一个你常用的模型服务 API Key（OpenAI、Anthropic、OpenRouter、
      Ollama 或任何兼容 OpenAI 协议的供应商均可）。
    </p>

    <h2 id="install">1. 下载与安装</h2>
    <p>
      前往 <a href="/download">下载页</a>，选择与你系统匹配的安装包：
    </p>
    <ul>
      <li>
        <strong>macOS</strong>：区分 Apple Silicon（arm64）与 Intel（x64），
        把 <code>.dmg</code> 拖入「应用程序」即可。
      </li>
      <li>
        <strong>Windows</strong>：推荐 <code>.exe</code> 安装包，默认安装到
        <code>%LOCALAPPDATA%\\Programs\\Spark Agent</code>。
      </li>
    </ul>
    <p>
      首次启动会要求授予「辅助功能 / 输入监控 / 屏幕录制」等权限（用于终端、浏览器自动化、截图等内建工具）。
      这些权限按需启用即可，缺失时相关功能会给出明确提示，不会阻塞主流程。
    </p>

    <h2 id="provider">2. 接入模型服务（Provider）</h2>
    <p>
      Spark Agent 用 Provider 统一管理所有模型服务。打开 <strong>设置 → Provider</strong>，
      新建一条配置，至少填写：
    </p>
    <ol>
      <li><strong>模型类型</strong>：文本模型 / 生图模型 / 语音模型 / 视频模型。</li>
      <li>
        <strong>协议</strong>：OpenAI Compatible / Anthropic Native / Ollama / 自定义网关，
        内置常见供应商的预设。
      </li>
      <li><strong>模型 ID</strong>：例如 <code>gpt-4o</code>、<code>claude-opus-4-20250514</code>、<code>qwen-max</code>。</li>
      <li>
        <strong>API Key</strong>：通过 Keychain（macOS）/ Credential Manager（Windows）
        安全存储，不会写入数据库或明文落盘。
      </li>
    </ol>
    <p>
      保存后点「测试连接」，成功后这条 Provider 会出现在新会话的模型下拉框里。
      你可以同时挂多个 Provider，文本 / 生图 / 视频分别用不同服务。
    </p>

    <h2 id="first-agent">3. 创建第一个 Agent</h2>
    <p>
      默认会有一个 <code>platform-manager-agent</code> 负责全局管理任务。
      你可以在 <strong>设置 → Agents</strong> 新建专属 Agent：
    </p>
    <ul>
      <li>绑定默认 Provider / Model（也可以让用户在会话里临时切换）。</li>
      <li>写一段 system prompt 描述 Agent 擅长的工作。</li>
      <li>选择启用的 Skills、Rules、MCP 服务器。</li>
      <li>设置权限模式（默认 / 接受编辑 / 不接受编辑 / 计划模式）。</li>
    </ul>
    <p>Agent 编辑页可以按下面这个结构理解：</p>
    <ol>
      <li><strong>基本信息</strong>：名字、头像、简介，决定它在列表里怎么被识别。</li>
      <li><strong>执行配置</strong>：默认模型、权限模式、是否允许主动编辑。</li>
      <li><strong>Skills</strong>：让它按需读取哪些工作说明书。</li>
      <li><strong>MCP</strong>：让它能调用哪些工具与服务，例如搜索、浏览器、媒体能力。</li>
      <li><strong>规则</strong>：补充这个 Agent 必须遵守的项目约束。</li>
    </ol>
    <div className="docs-callout">
      <strong>给非 IT 用户的解释</strong>：
      <ul>
        <li>「基本信息」= 这个 Agent 的名字、头像、一句话描述（告诉别人它是干嘛的）。</li>
        <li>「Skills」= 它会读哪些「说明书」（如联网搜索、写 PPT）。</li>
        <li>「MCP」= 它能调哪些「外部工具」（如 Playwright 浏览器）。</li>
        <li>「规则」= 它的行为准则（如「不能删文件」「代码要写注释」）。</li>
      <li>「执行配置」= 用哪个 AI 模型、要不要先问再动手。</li>
      </ul>
    </div>
    <p>
      一个简单的理解方式是：<strong>先定义角色，再决定它能用哪些能力，最后收紧边界</strong>。
      这样即使团队里有多个 Agent，也比较容易看清谁负责什么、谁能动什么。
    </p>

    <h2 id="first-task">4. 跑通第一个任务</h2>
    <p>
      打开主页会话，输入一句自然语言描述。Spark Agent 会：
    </p>
    <ol>
      <li>解析任务，按需调度工具（文件、终端、搜索、画布）。</li>
      <li>在侧边对话里展示思考与执行过程。</li>
      <li>产出可审查的改动（代码 diff / 文件预览 / 生成资产）。</li>
      <li>把运行结果落库，便于后续会话引用。</li>
    </ol>
    <p>
      完成一个真实任务后再回来读后面几个主题，会更有体感：
      <a href="/docs/code-development">代码开发</a>、
      <a href="/docs/canvas-mvp">无限画布</a>、
      <a href="/docs/team-mode">团队模式</a>。
    </p>

    <h2 id="troubleshoot">5. 常见问题排查</h2>
    <ul>
      <li>
        <strong>启动后看不到窗口</strong>：检查 dock / 任务栏里 Spark Agent 是否被最小化，或在「窗口」菜单里重新唤起。
      </li>
      <li>
        <strong>模型调用失败</strong>：在 Provider 列表点「测试连接」拿到准确错误码；
        第三方网关 401 多半是 Key 不匹配，404 多数是模型名写错。
      </li>
      <li>
        <strong>终端工具不可用</strong>：在「设置 → 权限与治理」里为当前 Agent 授予「终端执行」权限。
      </li>
      <li>
        <strong>中文渲染异常</strong>：在「设置 → 通用」切换字体回退栈，或更新系统字体缓存。
      </li>
    </ul>
  </>
)

export const quickStart: DocsPageContent = {
  slug: 'quick-start',
  toc: [
    { id: 'install', title: '1. 下载与安装', level: 2 },
    { id: 'provider', title: '2. 接入模型服务', level: 2 },
    { id: 'first-agent', title: '3. 创建第一个 Agent', level: 2 },
    { id: 'first-task', title: '4. 跑通第一个任务', level: 2 },
    { id: 'troubleshoot', title: '5. 常见问题排查', level: 2 },
  ],
  faq: [
    {
      question: 'Spark Agent 支持哪些操作系统？',
      answer: 'macOS（Apple Silicon 与 Intel）、Windows 10/11（x64）。',
    },
    {
      question: '第一次安装需要联网吗？',
      answer:
        '需要。首次启动会下载增量资源（浏览器、媒体技能等），之后可离线使用已缓存的本地模型与已缓存的 Skills。',
    },
    {
      question: '可以使用本地模型吗？',
      answer:
        '可以。通过 Ollama / LM Studio / vLLM 等兼容 OpenAI 协议的本地服务新建一个 Provider 即可。',
    },
    {
      question: '可以同时挂多个 Provider 吗？',
      answer:
        '可以。文本 / 生图 / 语音 / 视频可以分别用不同服务，Agent 与会话都可以临时切换。',
    },
  ],
  quickReference: [
    { key: '最低 macOS 版本', value: 'macOS 12 Monterey' },
    { key: '最低 Windows 版本', value: 'Windows 10 1909' },
    { key: '最低内存', value: '8 GB（建议 16 GB）' },
    { key: '磁盘占用', value: '~600 MB（不含 Skills / 浏览器）' },
    { key: '凭据存储', value: 'macOS Keychain / Windows Credential Manager' },
    { key: '项目数据库', value: 'SQLite（本地文件）' },
  ],
  howTo: {
    name: 'Spark Agent 首次跑通',
    description: '下载安装 → 接入模型 → 创建 Agent → 跑通第一个任务',
    totalTime: 'PT5M',
    steps: [
      '前往 /download 选择与你系统匹配的安装包并完成安装',
      '打开「设置 → Provider」新建一条配置，填写模型类型、协议、模型 ID 与 API Key',
      '点「测试连接」确认 Provider 可用',
      '在「设置 → Agents」创建你的第一个 Agent 并绑定默认 Provider / Model',
      '打开主页会话，用自然语言描述你的第一个任务',
    ],
  },
  aiSummary:
    'Spark Agent 快速开始指南：macOS / Windows 两平台安装步骤，首次启动权限申请说明，Provider 配置（模型类型、协议、模型 ID、API Key），' +
    '默认 Agent 与自定义 Agent 创建，权限模式（默认 / 接受编辑 / 计划模式），第一个真实任务的端到端流程，' +
    '常见问题排查清单（窗口、模型 401/404、终端权限、字体）。',
  Body,
}

export default quickStart
