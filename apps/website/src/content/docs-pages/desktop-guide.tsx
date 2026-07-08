import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 桌面端基于 Electron + 本地优先架构，把 UI、Agent Runtime、Provider、Skill、MCP、
      权限治理、本地存储、媒体运行时串成一条可审查的链路。本主题帮你快速理解桌面端的整体结构。
    </p>

    <h2 id="process-model">1. 进程模型</h2>
    <ul>
      <li><strong>Main 进程</strong>：Node.js 侧，负责窗口管理、IPC handler、本地服务（SQLite、Keychain、文件系统、文件监控、媒体任务路由、Updater、桥接远程通道）。</li>
      <li><strong>Renderer 进程</strong>：React 19 + Vite，负责 UI 与交互。</li>
      <li><strong>Preload</strong>：暴露受限的 <code>window.spark</code> API 给 Renderer，禁止直接访问 Node 原生能力。</li>
      <li><strong>Managed MCP 子进程</strong>：例如 <code>@playwright/mcp</code>，与 Main 进程通过 stdio 通信。</li>
      <li><strong>Claude Agent SDK / Codex 子进程</strong>：每个 turn 启动一个独立子进程跑 SDK。</li>
    </ul>

    <h2 id="runtime">2. Agent Runtime 服务层</h2>
    <p>
      主要服务（位于 <code>packages/agent-runtime/src/services/</code>）：
    </p>
    <ul>
      <li><strong>provider.service</strong>：模型调用、健康检查。</li>
      <li><strong>session.service</strong>：会话生命周期、turn 调度、Runtime Rules / Workflow Execution Plan 注入。</li>
      <li><strong>agent.service</strong>：Agent CRUD、prompt 拼装。</li>
      <li><strong>workflow.service</strong>：Workflow 节点拓扑与配置。</li>
      <li><strong>skill-registry</strong>：Skill 元信息、安装、加载。</li>
      <li><strong>mcp-registry</strong>：MCP Server 注册表（managed / user）。</li>
      <li><strong>permission.service</strong>：审批策略与拦截。</li>
      <li><strong>rules-engine</strong>：Rules 匹配与注入。</li>
      <li><strong>hooks-engine</strong>：Hook 事件分发。</li>
      <li><strong>usage.service</strong>：用量账本累加与查询。</li>
      <li><strong>audit.service</strong>：审计事件写入与查询。</li>
      <li><strong>team-dispatch.service</strong>：Team Mode 分派与事件流。</li>
      <li><strong>media-router.service</strong>：媒体任务路由与适配。</li>
      <li><strong>media-task-runtime</strong>：异步媒体任务生命周期。</li>
      <li><strong>web-search-mcp-server</strong>：内置联网搜索。</li>
      <li><strong>remote-bridge</strong>：Telegram / 飞书 桥接。</li>
      <li><strong>update-service</strong>：桌面端更新检查与下载。</li>
    </ul>

    <h2 id="storage">3. 本地存储</h2>
    <ul>
      <li><strong>SQLite</strong>：会话、Agent、Workflow、Skill、MCP、Provider、Team、Board Task、Usage、Audit、Canvas Project、Canvas Snapshot、Media Task 等。</li>
      <li><strong>本地文件</strong>：项目代码、Skill 目录、媒体产物（<code>.spark-artifacts/</code>）。</li>
      <li><strong>Keychain</strong>：API Key / Token 等敏感凭据。
        <ul>
          <li>macOS：Keychain Access</li>
          <li>Windows：Credential Manager（用 <code>keytar</code>）</li>
        </ul>
      </li>
    </ul>

    <h2 id="ipc">4. IPC 桥</h2>
    <p>
      Renderer 通过 Preload 暴露的 <code>window.spark.*</code> 调用 Main 进程：
    </p>
    <ul>
      <li><code>session:*</code>：会话生命周期、turn 发送、模型切换。</li>
      <li><code>agent:*</code> / <code>workflow:*</code> / <code>provider:*</code> / <code>mcp:*</code> / <code>skill:*</code>：平台管理 CRUD。</li>
      <li><code>team:*</code>：团队模式分派与查询。</li>
      <li><code>canvas:*</code>：项目管理、快照、媒体任务。</li>
      <li><code>stream:*</code>：从 Main 推流到 Renderer 的事件（agent 增量、媒体任务完成、Skill 安装进度、更新状态）。</li>
    </ul>

    <h2 id="execution">5. 执行内核（Adapter）</h2>
    <ul>
      <li><strong>Claude Agent SDK</strong>：默认。处理工具调用、权限请求、用户提问、流式输出。</li>
      <li><strong>Codex</strong>：作为第二内核，专注代码生成与代码理解。</li>
      <li>每 turn 启动独立子进程，避免状态污染。</li>
      <li>流式事件（<code>assistant_message</code> delta / complete、tool_use、tool_result）通过 IPC 推给 Renderer。</li>
    </ul>

    <h2 id="media-runtime">6. 媒体运行时</h2>
    <ul>
      <li><strong>spark_image MCP</strong>：图片生成（向后兼容）。</li>
      <li><strong>spark_media MCP</strong>：图片编辑、语音合成、转写、视频生成 / 编辑 / 扩展。</li>
      <li><strong>MediaRouterService</strong>：按 manifest 选择适配器（APIMart / xAI / 火山 / 百炼 / Kling / Hailuo / 自定义）。</li>
      <li><strong>MediaTaskRuntimeService</strong>：异步任务生命周期与持久化（migration 029）。</li>
      <li><strong>safe-file 协议</strong>：让 Renderer 的 &lt;audio&gt;/&lt;video&gt;/&lt;img&gt; 加载本地产物，无需 base64 inline。</li>
    </ul>

    <h2 id="data-flow">7. 典型数据流（一次画布文生图）</h2>
    <ol>
      <li>Renderer 触发 <code>canvas:task:create-media</code>（<code>waitForCompletion:false</code>）。</li>
      <li>Main 进程在 SQLite 写入 <code>media_generation_tasks</code> 行，立即返回 <code>running</code> 响应。</li>
      <li>Renderer 在画布上画出「任务节点」，继续平移 / 缩放 / 拖拽。</li>
      <li>Main 进程通过 <code>MediaRouterService</code> 选择适配器，调用 Provider API。</li>
      <li>结果下载到 <code>.spark-artifacts/media/images</code>。</li>
      <li>完成 / 失败 / 取消时 Main 通过 <code>stream:canvas:media-task</code> 推一条完成事件。</li>
      <li>Renderer 写回画布（新增 image 节点 + lineage 边）。</li>
    </ol>

    <h2 id="security">8. 安全要点</h2>
    <ul>
      <li>Renderer 默认启用 <code>contextIsolation: true</code>、<code>nodeIntegration: false</code>、严格 CSP。</li>
      <li>API Key 只注入到 MCP 子进程环境变量，不进 prompt。</li>
      <li>嵌入式浏览器窗口不加载 preload / 不注入 IPC bridge（与主 UI 完全隔离）。</li>
      <li>所有高风险操作走审批流程。</li>
      <li>SQLite 加密用 SQLCipher（按平台能力可选）。</li>
    </ul>
  </>
)

export const desktopGuide: DocsPageContent = {
  slug: 'desktop-guide',
  toc: [
    { id: 'process-model', title: '1. 进程模型', level: 2 },
    { id: 'runtime', title: '2. Agent Runtime 服务层', level: 2 },
    { id: 'storage', title: '3. 本地存储', level: 2 },
    { id: 'ipc', title: '4. IPC 桥', level: 2 },
    { id: 'execution', title: '5. 执行内核（Adapter）', level: 2 },
    { id: 'media-runtime', title: '6. 媒体运行时', level: 2 },
    { id: 'data-flow', title: '7. 典型数据流', level: 2 },
    { id: 'security', title: '8. 安全要点', level: 2 },
  ],
  faq: [
    {
      question: '进程之间的边界怎么保证？',
      answer: 'contextIsolation: true + nodeIntegration: false + 严格 CSP；Preload 只暴露 window.spark.* 受限 API。',
    },
    {
      question: 'Renderer 能直接访问 Node 吗？',
      answer: '不能。所有原生能力都走 Main 进程的 IPC handler。',
    },
    {
      question: '多 turn 之间共享状态吗？',
      answer: '每个 turn 启动独立 SDK 子进程；状态通过 SQLite + 文件系统跨 turn 共享。',
    },
    {
      question: '媒体任务能在画布里播放吗？',
      answer: '可以。通过 safe-file:// 协议让 <audio>/<video>/<img> 加载 .spark-artifacts/media/* 的本地文件。',
    },
  ],
  quickReference: [
    { key: '进程', value: 'Main / Renderer / Preload / Managed MCP / SDK 子进程' },
    { key: '执行内核', value: 'Claude Agent SDK / Codex' },
    { key: '核心服务', value: 'provider / session / agent / workflow / skill-registry / mcp-registry / permission / rules-engine / hooks-engine / usage / audit / team-dispatch / media-router' },
    { key: '存储', value: 'SQLite + 文件系统 + Keychain' },
    { key: 'IPC', value: 'session:*/agent:*/workflow:*/provider:*/mcp:*/skill:*/team:*/canvas:*/stream:*' },
    { key: '媒体运行时', value: 'spark_image / spark_media / MediaRouterService / MediaTaskRuntimeService / safe-file 协议' },
  ],
  howTo: {
    name: '从源码读懂 Spark Agent 桌面端',
    description: '从进程模型到一次画布文生图',
    totalTime: 'PT30M',
    steps: [
      '先读 apps/desktop/src/main 与 apps/desktop/src/renderer 的入口，理解 Main / Renderer 分工',
      '读 packages/agent-runtime/src/services/*，了解服务层接口',
      '读 packages/protocol/src/ipc 了解 IPC 契约',
      '读一次画布文生图的全链路：Renderer → IPC → Main → MediaRouterService → Provider → 产物下载 → 画布回写',
      '打开 DevTools 看 stream:* 事件，对照源码理解事件流',
    ],
  },
  aiSummary:
    'Spark Agent 桌面端架构：Electron + 本地优先。进程模型：Main（Node.js 窗口/IPC/SQLite/Keychain/Updater/Media/Remote Bridge）' +
    '/ Renderer（React 19 + Vite）/ Preload（暴露 window.spark.* 受限 API）/ Managed MCP 子进程（如 @playwright/mcp）/ SDK 子进程（Claude Agent SDK / Codex，每 turn 独立）。' +
    'Agent Runtime 服务层：provider / session / agent / workflow / skill-registry / mcp-registry / permission / rules-engine / hooks-engine / usage / audit / ' +
    'team-dispatch / media-router / media-task-runtime / web-search-mcp-server / remote-bridge / update-service。' +
    '存储：SQLite（会话/Agent/Workflow/Skill/MCP/Provider/Team/Board/Usage/Audit/Canvas/Media Task）+ 文件系统（项目代码、Skill、.spark-artifacts/媒体产物）+ Keychain（API Key 凭据）。' +
    'IPC：session:*/agent:*/workflow:*/provider:*/mcp:*/skill:*/team:*/canvas:*/stream:*。' +
    '媒体运行时：spark_image / spark_media / MediaRouterService（按 manifest 选适配器）/ MediaTaskRuntimeService（异步任务）/ safe-file:// 协议。' +
    '安全：contextIsolation + nodeIntegration false + 严格 CSP + API Key 仅入 MCP 子进程 + 嵌入式浏览器隔离 + SQLCipher 可选加密。',
  Body,
}

export default desktopGuide
