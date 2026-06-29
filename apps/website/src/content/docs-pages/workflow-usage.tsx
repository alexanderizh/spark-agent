import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      「工作流」是 Spark Agent 中的可视化 Agent 编排：把一个复杂任务拆成「节点 + 边」，每个节点代表一个阶段
      （计划 / 执行 / 调 Skill / 调 MCP / 审批 / 验证 / 复核 / 产物），节点之间的边表达执行顺序。
      工作流可以绑定到 Agent，会话启动时按拓扑顺序注入 <code>[Workflow Execution Plan]</code> 给模型。
    </p>

    <h2 id="two-screens">1. 两个屏幕</h2>
    <p>工作流视图拆成两层：</p>
    <ul>
      <li>
        <strong>卡片列表（list）</strong>：创建 / 刷新 / 选择 Workflow。展示所有工作流的名称、状态、最近修改。
      </li>
      <li>
        <strong>编排详情（detail）</strong>：单个 Workflow 的图编辑器（节点面板 + 画布 + Inspector）。
        这里做实际的节点拖拽、连线、配置。
      </li>
    </ul>
    <p>把「选 Workflow」和「编辑 Workflow」分离，保证画布有足够空间做实际编排。</p>

    <h2 id="node-kinds">2. 11 种节点类型</h2>
    <p>
      每个节点有 5 个字段：<code>kind</code>（类型）、<code>label</code>（显示名）、<code>icon</code>（图标）、
      <code>accent</code>（主题色）、<code>defaultPrompt</code>（默认提示）、<code>hint</code>（使用提示）。
    </p>
    <table>
      <thead>
        <tr><th>kind</th><th>标签</th><th>用途</th></tr>
      </thead>
      <tbody>
        <tr><td><code>input</code></td><td>需求输入</td><td>入口节点：解析用户消息，提炼目标、约束和交付物</td></tr>
        <tr><td><code>plan</code></td><td>计划节点</td><td>EnterPlanMode：先规划再动手</td></tr>
        <tr><td><code>agent</code></td><td>执行节点</td><td>主 Agent 执行阶段</td></tr>
        <tr><td><code>subagent</code></td><td>子代理派发</td><td>Task / 并行子代理</td></tr>
        <tr><td><code>skill</code></td><td>Skill</td><td>调用 Skill 提供的方法</td></tr>
        <tr><td><code>tool</code></td><td>工具</td><td>调用内置工具，记录输入、输出和异常</td></tr>
        <tr><td><code>mcp</code></td><td>MCP</td><td>外部 MCP 服务</td></tr>
        <tr><td><code>approval</code></td><td>审批</td><td>人在回路：用户确认关键计划或高风险动作</td></tr>
        <tr><td><code>verify</code></td><td>验证</td><td>运行验证命令并确认输出（verification-before-completion）</td></tr>
        <tr><td><code>review</code></td><td>复核</td><td>复核上一阶段结果，总结风险</td></tr>
        <tr><td><code>artifact</code></td><td>产物</td><td>终点：整理最终交付物、变更摘要和后续建议</td></tr>
      </tbody>
    </table>

    <h2 id="create-workflow">3. 创建第一个工作流</h2>
    <ol>
      <li>打开「工作流」视图，点击「新建工作流」。</li>
      <li>输入名称（如「代码审查流水线」），点「创建」。</li>
      <li>进入编排详情，从左侧「节点面板」拖一个 <code>input</code> 节点到画布。</li>
      <li>依次拖 <code>plan</code> → <code>agent</code> → <code>verify</code> → <code>review</code> → <code>artifact</code>。</li>
      <li>按住节点底部的连接点拖到下一个节点，建立执行顺序。</li>
      <li>点击任一节点，在右侧 Inspector 配置：</li>
    </ol>
    <ul>
      <li><strong>基础</strong>：节点标题、阶段元数据（phase / retryCount）。</li>
      <li><strong>模型</strong>：选 Provider / Model（覆盖 Agent 默认）。</li>
      <li><strong>提示词</strong>：默认使用 <code>defaultPrompt</code>，可改写。</li>
      <li><strong>能力</strong>：选 Skill ID / Rule ID / MCP server ID / 内置工具 ID。</li>
      <li><strong>权限</strong>：节点级 permissionMode（如「只读」「可编辑」）。</li>
    </ul>
    <ol start={7}>
      <li>点「保存」回到列表，工作流出现在卡片列表里。</li>
    </ol>

    <h2 id="bind-agent">4. 绑定到 Agent</h2>
    <p>创建好的 Workflow 不会自动跑，需要让 Agent 知道它存在：</p>
    <ol>
      <li>打开「设置 → Agents」，编辑目标 Agent。</li>
      <li>在「Workflow」下拉里选刚才创建的工作流。</li>
      <li>保存。</li>
      <li>用该 Agent 开新会话，会话启动时 system prompt 会注入：
        <pre>{`[Workflow Execution Plan]
1. 需求输入 — 读取用户需求，提炼目标、约束和交付物。
2. 计划节点 — 拆解任务，给出可执行步骤。
3. 执行节点 — 按计划完成实现，并记录关键决策。
4. 验证 — 运行验证命令并确认输出，证据先行。
5. 复核 — 复核上一阶段结果，总结风险和结果。
6. 产物 — 整理最终交付物、变更摘要和后续建议。`}</pre>
      </li>
    </ol>

    <h2 id="examples">5. 三个常用编排模板</h2>

    <h3 id="tpl-code-review">5.1 代码审查流水线</h3>
    <p>适合 PR / 变更包级别的代码审查。</p>
    <pre>{`需求输入 → 计划节点 → 执行节点 → 验证 → 复核 → 产物`}</pre>
    <ul>
      <li><strong>计划节点</strong>：拆解要审查的模块和文件。</li>
      <li><strong>执行节点</strong>：逐文件读 diff，按重要性分类。</li>
      <li><strong>验证</strong>：跑项目自带的 lint / test 确认改动通过。</li>
      <li><strong>复核</strong>：生成审查报告（高 / 中 / 低风险点）。</li>
      <li><strong>产物</strong>：最终报告（含复现建议、可合并性结论）。</li>
    </ul>

    <h3 id="tpl-research">5.2 调研报告流水线</h3>
    <p>适合查资料、出报告的场景。</p>
    <pre>{`需求输入 → 计划节点 → 多次 Skill(联网搜索) → 复核 → 产物`}</pre>
    <ul>
      <li><strong>Skill 节点</strong>：选 <code>multi-search-engine</code>，提示词：「检索 X 主题的最近一周资料」。</li>
      <li>可串联多个 Skill 节点做多源对比。</li>
      <li><strong>复核</strong>：检查出处是否齐全、是否有矛盾来源。</li>
      <li><strong>产物</strong>：结构化报告（要点 + 出处 + 反方观点）。</li>
    </ul>

    <h3 id="tpl-release">5.3 发布前自检流水线</h3>
    <p>适合发版本前的人工把关。</p>
    <pre>{`需求输入 → 执行节点 → 验证 → 审批（人在回路） → 复核 → 产物`}</pre>
    <ul>
      <li><strong>执行</strong>：跑变更摘要、生成 release notes 草稿。</li>
      <li><strong>验证</strong>：CI 全绿 + 关键 e2e 通过。</li>
      <li><strong>审批</strong>：用户必须确认后才继续 —— 高风险动作卡住。</li>
      <li><strong>复核</strong>：交叉检查 release notes 与代码改动一致性。</li>
      <li><strong>产物</strong>：最终 release notes + 发布清单。</li>
    </ul>

    <h2 id="runtime">6. 运行时怎么跑</h2>
    <p>
      当前 SDK 一轮执行一次用户消息，因此工作流节点的「执行」是按拓扑顺序在一轮 prompt 里的「执行指引」：
    </p>
    <ul>
      <li>节点模型切换作为「请用 X 模型做这个阶段」写入 prompt，不是独立子运行。</li>
      <li>节点 Skill / Rule / Tool / MCP 选择会注入运行时能力。</li>
      <li>节点级权限模式会覆盖 Agent 默认。</li>
    </ul>
    <p>
      未来可扩展多轮执行的 executor —— 模型编排和节点逻辑可以保留。
    </p>

    <h2 id="best-practices">7. 最佳实践</h2>
    <ul>
      <li><strong>入口必须 input</strong>：所有工作流以 <code>input</code> 节点为起点，明确「要做什么」。</li>
      <li><strong>高风险用 approval</strong>：删除文件 / 推送代码 / 联网下载可执行文件等节点前加 <code>approval</code>，卡住用户确认。</li>
      <li><strong>验证先于产物</strong>：<code>artifact</code> 节点前必须有 <code>verify</code>，避免「看起来完成其实没验证」。</li>
      <li><strong>子代理适度</strong>：过多 <code>subagent</code> 节点会让调度成本陡增；按模块切 3~5 个就够。</li>
      <li><strong>复用优于新建</strong>：常见模式（代码审查、调研、发布）先复用模板再改。</li>
    </ul>
  </>
)

export const workflowUsage: DocsPageContent = {
  slug: 'workflow-usage',
  toc: [
    { id: 'two-screens', title: '1. 两个屏幕', level: 2 },
    { id: 'node-kinds', title: '2. 11 种节点类型', level: 2 },
    { id: 'create-workflow', title: '3. 创建第一个工作流', level: 2 },
    { id: 'bind-agent', title: '4. 绑定到 Agent', level: 2 },
    { id: 'examples', title: '5. 三个常用编排模板', level: 2 },
    { id: 'tpl-code-review', title: '5.1 代码审查流水线', level: 3 },
    { id: 'tpl-research', title: '5.2 调研报告流水线', level: 3 },
    { id: 'tpl-release', title: '5.3 发布前自检流水线', level: 3 },
    { id: 'runtime', title: '6. 运行时怎么跑', level: 2 },
    { id: 'best-practices', title: '7. 最佳实践', level: 2 },
  ],
  faq: [
    {
      question: '工作流是必填的吗？',
      answer: '不是。没绑 Workflow 的 Agent 按单 Agent 模式跑，只注入 [Runtime Rules] 和 [Platform Tools]。',
    },
    {
      question: '节点切换模型真的会起独立子 SDK 吗？',
      answer: '当前不会。节点模型切换作为 prompt 内的执行指引；未来可扩展多轮 executor。',
    },
    {
      question: 'Workflow 嵌套支持吗？',
      answer: '不支持。一个工作流是一个有向图，子任务用节点表达。',
    },
    {
      question: '能导入 / 导出工作流吗？',
      answer: 'workflows.graph_json 可手写。建议从模板复用，再按需调整。',
    },
  ],
  quickReference: [
    { key: '视图', value: 'list（卡片列表）+ detail（图编辑器）' },
    { key: '节点类型', value: 'input / plan / agent / subagent / skill / tool / mcp / approval / verify / review / artifact（11 种）' },
    { key: '图编辑器', value: 'ReactFlow（@xyflow/react）' },
    { key: '绑定方式', value: 'Agent 元数据 workflow 字段 + 启动时注入 [Workflow Execution Plan]' },
    { key: '持久化', value: 'workflows.graph_json' },
    { key: '运行时', value: '当前一轮 prompt 内的拓扑执行指引，非独立子运行' },
  ],
  howTo: {
    name: '用 Spark Agent 创建一个「代码审查」工作流',
    description: '从新建工作流到绑定 Agent 的完整流程',
    totalTime: 'PT10M',
    steps: [
      '打开「工作流」视图，点「新建工作流」并命名（如「代码审查」）',
      '进入详情页，从节点面板拖出 input → plan → agent → verify → review → artifact',
      '逐节点连线：在每个节点底部连接点拖到下一个节点',
      '点击节点在右侧 Inspector 配置（默认 prompt / 模型 / Skill）',
      '点保存，回到列表',
      '打开「设置 → Agents」，编辑目标 Agent，在「Workflow」下拉里选「代码审查」',
      '保存 Agent，用该 Agent 开新会话，session 启动时自动注入执行计划',
    ],
  },
  aiSummary:
    'Spark Agent 工作流（Workflow）使用教程：视图拆成 list（卡片列表）和 detail（图编辑器）两层。' +
    '11 种节点类型：input（需求输入）、plan（计划）、agent（执行）、subagent（子代理派发）、skill（调 Skill）、' +
    'tool（调工具）、mcp（外部 MCP）、approval（人在回路）、verify（验证）、review（复核）、artifact（产物）。' +
    '每个节点 5 字段：kind/label/icon/accent/defaultPrompt/hint。' +
    '创建流程：新建 → 拖节点 → 连线 → Inspector 配置（基础 / 模型 / 提示词 / 能力 / 权限）→ 保存。' +
    '绑定到 Agent：编辑 Agent metadata.workflow，会话启动时按拓扑顺序注入 [Workflow Execution Plan] 到 system prompt。' +
    '三个常用模板：代码审查流水线（input→plan→agent→verify→review→artifact）、' +
    '调研报告流水线（input→plan→多次 Skill(联网搜索)→review→artifact）、' +
    '发布前自检流水线（input→agent→verify→approval→review→artifact）。' +
    '运行时：当前一轮 prompt 内的拓扑执行指引，节点模型切换作为 prompt 指令而非独立子 SDK 运行。' +
    '最佳实践：入口必须 input；高风险动作前用 approval 卡住用户；artifact 前必须有 verify；subagent 控制在 3~5 个。',
  Body,
}

export default workflowUsage
