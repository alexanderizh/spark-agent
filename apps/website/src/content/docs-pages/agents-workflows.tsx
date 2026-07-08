import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Agent 是 Spark Agent 中「会用工具的 LLM 角色」。一个 Agent 由 <em>Provider / Model / Adapter /
      Permission Mode / Reasoning Effort / Prompt / Skills / Rules / MCP / Hooks</em> 等组成，
      可以按项目复用，也可以按会话临时覆盖。
    </p>

    <h2 id="agent-profile">1. Agent Profile</h2>
    <p>
      每个 Agent 的核心字段：
    </p>
    <ul>
      <li><strong>Provider / Model</strong>：默认文本模型。</li>
      <li><strong>Adapter</strong>：执行内核（Claude Agent SDK / Codex / 自定义）。</li>
      <li><strong>Permission Mode</strong>：默认 / 接受编辑 / 不接受编辑 / 计划模式。</li>
      <li><strong>Reasoning Effort</strong>：低 / 中 / 高（决定思考深度）。</li>
      <li><strong>Agent Prompt</strong>：系统级 prompt（区别于会话 prompt）。</li>
      <li><strong>Rules</strong>：选中的项目级规则集。</li>
      <li><strong>Skills</strong>：可启用的技能（builtin / 用户安装）。</li>
      <li><strong>MCP Allow-list</strong>：允许使用的 MCP 服务器。</li>
      <li><strong>Hooks</strong>：在权限请求、用户提问、会话结束、失败时的钩子覆盖。</li>
      <li><strong>Workflow</strong>：可选的工作流绑定（见下文）。</li>
    </ul>
    <p>
      内置默认 <code>platform-manager-agent</code> 负责所有「平台管理」类操作（Skills / MCP /
      Provider / Workflow / Agent / Team / Settings / Session / Board Task 等）。
      自定义 Agent 可以聚焦到具体工作，例如「React 审查 Agent」「i18n 重构 Agent」。
    </p>

    <h2 id="runtime-injection">2. 运行时注入</h2>
    <p>
      当会话启动时，Spark Agent 会按以下顺序构造系统 prompt：
    </p>
    <ol>
      <li><strong>[Runtime Rules]</strong>：激活的系统/项目规则 + 项目指令文件 + Agent 规则 + Workflow 节点规则。</li>
      <li><strong>[Workflow Execution Plan]</strong>：如果 Agent 绑定了 Workflow，按拓扑顺序展示节点配置。</li>
      <li><strong>Agent Prompt</strong>：用户配置的 system prompt。</li>
      <li><strong>[Platform Tools]</strong>：注入 <code>spark_platform</code> MCP 的工具描述（管理员可见）。</li>
    </ol>
    <p>
      Agent 级别选中的 Skill 会进入运行时「技能目录」，MCP Allow-list 会过滤实际传给 SDK 的服务器。
      如果没有 MCP Allow-list，则所有「已启用」的 MCP 都可用。
    </p>

    <h2 id="workflow-graphs">3. Workflow Graphs</h2>
    <p>
      Workflow 是节点（Nodes） + 边（Edges）的有向图，存为 <code>workflows.graph_json</code>。你可以把它当作
      「给 Agent 看的流程图」：节点代表阶段，连线代表顺序，节点配置决定这一阶段使用哪个 Agent、模型、工具、Skill 或 MCP。
    </p>
    <pre>
{`{
  "nodes": [
    { "id": "n1", "kind": "plan",   "title": "需求拆解", "position": {"x": 0, "y": 0}, "config": {} },
    { "id": "n2", "kind": "code",   "title": "编码",     "position": {"x": 0, "y": 1}, "config": {"providerId": "..."} },
    { "id": "n3", "kind": "review", "title": "审查",     "position": {"x": 0, "y": 2}, "config": {} }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3" }
  ]
}`}
    </pre>
    <p>节点支持 11 种 <code>kind</code>：</p>
    <ul>
      <li><strong>input</strong>：整理用户需求、目标、约束和交付物。</li>
      <li><strong>plan</strong>：只读规划，先想清楚再执行。</li>
      <li><strong>agent</strong>：派发给一个已配置 Agent，适合真实执行代码、文档或内容任务。</li>
      <li><strong>subagent</strong>：创建临时子 Agent 处理局部任务。</li>
      <li><strong>skill</strong>：把某一步限制到指定 Skill 能力。</li>
      <li><strong>tool</strong>：把某一步限制到指定内置工具，如 Read / Edit / Bash。</li>
      <li><strong>mcp</strong>：把某一步限制到指定 MCP 服务。</li>
      <li><strong>approval</strong>：暂停等待用户确认。</li>
      <li><strong>verify</strong>：运行验证命令。</li>
      <li><strong>review</strong>：只读复核结果与风险。</li>
      <li><strong>artifact</strong>：整理最终交付物，可导出文件。</li>
    </ul>
    <p>
      节点配置支持 Provider / Model 偏好、Agent ID、Skill ID、Rule ID、内置工具 ID、MCP ID、
      重试次数、执行模式和导出路径。未配置 <code>toolIds</code> 表示不额外限制；一旦配置，
      运行时会把未选择工具放入禁用列表。
    </p>
    <p>
      在 Claude SDK 路径上，含可执行节点的工作流会暴露 <code>workflow_run</code>，
      由运行时真实驱动图执行、派发 Agent / Subagent、执行 input / approval / verify 等原子节点，并保存
      <code>workflow_runs</code> 快照用于恢复和审计。在 Codex 路径上，工作流保持为结构化执行计划。
    </p>

    <h2 id="workflow-ui">4. Workflow 视图</h2>
    <p>
      Workflow 视图拆成两层：
    </p>
    <ul>
      <li><strong>卡片列表</strong>：创建 / 刷新 / 选择 Workflow。</li>
      <li><strong>编排详情</strong>：单个 Workflow 的图编辑器（节点面板 + 画布 + Inspector）。</li>
    </ul>
    <p>
      把「选 Workflow」和「编辑 Workflow」分离，保证画布有足够空间。
    </p>

    <h2 id="hooks">5. Hooks</h2>
    <p>
      Hooks 让你在「工具调用 / 权限请求 / 用户提问 / 会话结束 / 失败」等节点插入自定义逻辑：
    </p>
    <ul>
      <li><strong>permission-request</strong>：拦截高风险操作前提示。</li>
      <li><strong>user-question</strong>：自动补全或校验用户问题。</li>
      <li><strong>session-complete</strong>：会话结束时跑总结 / 归档。</li>
      <li><strong>failure</strong>：失败时跑兜底逻辑（重试 / 报警）。</li>
    </ul>
    <p>
      Agent 级 Hook 优先级高于全局 Hook；未配置时回退到全局设置。
    </p>

    <h2 id="platform-tools">6. Platform 管理工具</h2>
    <p>
      每个会话都内置 <code>spark_platform</code> MCP，命名空间 <code>mcp__spark_platform__*</code>：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具族</th>
          <th>能力</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>skills_*</td><td>list / load / search / install / GitHub install / uninstall / toggle</td></tr>
        <tr><td>mcp_servers_*</td><td>list / create / update / delete / status</td></tr>
        <tr><td>providers_*</td><td>list / get / create / update / delete / health-check / set-default / set-default-model</td></tr>
        <tr><td>workflows_*</td><td>list / get / create / update / delete</td></tr>
        <tr><td>agents_*</td><td>list / get / create / update / delete</td></tr>
        <tr><td>teams_*</td><td>list / get / create / update / delete</td></tr>
        <tr><td>settings_*</td><td>get / set / category get / get-all</td></tr>
        <tr><td>sessions_*</td><td>get / switch-model-provider-mode-permission-reasoning</td></tr>
        <tr><td>board_tasks_*</td><td>list / get / create / update / delete / batch / restore / permanent-delete</td></tr>
      </tbody>
    </table>
    <p>
      Team CRUD 通过 <code>teams_*</code> 暴露，长期定义存在 <code>agent_teams</code> 表；
      调用前用 <code>agents_list</code> 解析 host / member ID。
    </p>

    <h2 id="common-mistakes">7. 常见踩坑</h2>
    <ul>
      <li><strong>把所有节点都当成可写节点</strong>：<code>plan</code> / <code>input</code> / <code>review</code> 默认只读，代码修改应放在 <code>agent</code> / <code>subagent</code> / <code>tool</code> 节点。</li>
      <li><strong>配置了 toolIds 却漏选编辑工具</strong>：一旦配置 toolIds，未选择工具会被禁用。要改代码请包含 Edit / MultiEdit / Write；要跑命令请包含 Bash 或使用 verify 节点。</li>
      <li><strong>Hook 与 Rule 混用</strong>：Rule 是「注入 prompt 的策略」，Hook 是「事件回调」；二者不要重叠。</li>
      <li><strong>Agent Prompt 写得太长</strong>：把通用部分下沉到 Rule，把与项目相关的内容放进 Prompt。</li>
    </ul>
  </>
)

export const agentsWorkflows: DocsPageContent = {
  slug: 'agents-workflows',
  toc: [
    { id: 'agent-profile', title: '1. Agent Profile', level: 2 },
    { id: 'runtime-injection', title: '2. 运行时注入', level: 2 },
    { id: 'workflow-graphs', title: '3. Workflow Graphs', level: 2 },
    { id: 'workflow-ui', title: '4. Workflow 视图', level: 2 },
    { id: 'hooks', title: '5. Hooks', level: 2 },
    { id: 'platform-tools', title: '6. Platform 管理工具', level: 2 },
    { id: 'common-mistakes', title: '7. 常见踩坑', level: 2 },
  ],
  faq: [
    {
      question: 'Agent 和会话（Session）有什么区别？',
      answer:
        'Agent 是「会用工具的角色」模板；Session 是「一次具体的对话」。一个 Agent 可以被多个 Session 复用。',
    },
    {
      question: 'Workflow 是必填的吗？',
      answer: '不是。没有 Workflow 的 Agent 会按常规单 Agent 模式运行，注入 [Runtime Rules] 与 [Platform Tools]。',
    },
    {
      question: '可以把多个 Workflow 嵌套吗？',
      answer: '不支持嵌套。Workflow 是一个有向图，子任务用「节点」表达，不在节点里再嵌图。',
    },
    {
      question: 'Hook 写在哪里？',
      answer: 'Hook 配置存在 App Settings 的 hooks 分类，按事件类型分项。Agent 级别覆盖存在 Agent 的 metadata.hooks。',
    },
  ],
  quickReference: [
    { key: '默认 Agent', value: 'platform-manager-agent' },
    { key: '运行时 prompt 段', value: '[Runtime Rules] / [Workflow Execution Plan] / [Platform Tools]' },
    { key: 'Workflow 存储', value: 'workflows.graph_json + workflow_runs 快照' },
    { key: '平台 MCP', value: 'spark_platform（命名空间 mcp__spark_platform__*）' },
    { key: '执行内核', value: 'Claude Agent SDK / Codex / 自定义' },
    { key: '权限模式', value: 'default / accept-edits / plan / dont-ask' },
  ],
  howTo: {
    name: '用 Spark Agent 创建并使用自定义 Agent',
    description: '在「设置 → Agents」创建一个绑定特定模型、Skills、MCP 的 Agent',
    totalTime: 'PT5M',
    steps: [
      '打开「设置 → Agents」，点「新建 Agent」',
      '填入名称、描述、Agent Prompt',
      '选择默认 Provider / Model 与 Adapter',
      '在 Skills / Rules / MCP 三个标签里勾选允许使用的资源',
      '设置 Hooks（可选）与权限模式',
      '保存后在新会话的 Agent 选择器里即可使用',
    ],
  },
  aiSummary:
    'Spark Agent 工作流核心机制：Agent Profile（Provider/Model/Adapter/Permission Mode/Prompt/Skills/Rules/MCP/Hooks/Workflow）、' +
    '运行时注入顺序（[Runtime Rules] → [Workflow Execution Plan] → [Platform Tools]）、Workflow Graphs (nodes + edges, 11 种节点 input/plan/agent/subagent/skill/tool/mcp/approval/verify/review/artifact)、' +
    'Workflow 视图（卡片列表 + 图编辑器）、Hooks（permission-request/user-question/session-complete/failure）、' +
    'Platform 管理 MCP（mcp__spark_platform__*: skills/mcp_servers/providers/workflows/agents/teams/settings/sessions/board_tasks）、' +
    'Agent 与 Session 的区别、常见踩坑（Workflow 不嵌套、Hook 与 Rule 不重叠）。',
  Body,
}

export default agentsWorkflows
