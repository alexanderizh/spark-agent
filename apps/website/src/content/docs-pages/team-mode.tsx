import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      团队模式（Team Mode）让一个 Host Agent 把子任务分派给多个 Member Agent，
      协作过程以 IM 群聊的方式呈现：Host 与 Member 都是平等的「发言者」。
    </p>

    <h2 id="enable">1. 启用团队模式</h2>
    <p>
      在「会话输入区 → Agent 选择器」里选 <strong>团队模式（多 Agent 协作）</strong>。
      选完后：
    </p>
    <ul>
      <li>选择器标签变成 <code>团队模式 · &lt;Host&gt;</code>。</li>
      <li>右上角出现「成员 N」徽章。</li>
      <li>右侧 Inspector 出现「团队成员」配置面板，按需勾选可用 Member。</li>
    </ul>
    <div className="docs-callout">
      <strong>给非 IT 用户的解释</strong>：
      团队模式就像「公司接了一个大项目，招了一群各有专长的员工一起干」：
      <ul>
        <li>Host（主持人）= 项目经理 —— 用户直接对话的角色，把任务拆开分给成员。</li>
        <li>Member（成员）= 各专长员工 —— 各自有模型、工具、技能，专注一类任务。</li>
        <li>用户在会话里只跟 Host 说话，Host 决定要不要叫人、需要哪些人。</li>
      </ul>
    </div>

    <h2 id="save-team">2. 创建并保存一个团队预设</h2>
    <p>
      想把「这个团队配置」存下来反复用？在「设置 → Agents → Teams 标签」新建：
    </p>
    <ul>
      <li>基本信息：团队名、头像、一句话说明团队适合什么场景。</li>
      <li>主持人（Host）：选哪个 Agent 担任。用户会话里直接对话的就是它。</li>
      <li>成员（Member）：勾选本团队能调度的 Agent。Host 本人不出现在此列表。</li>
    </ul>
    <p>
      <img
        src="/docs/img/teams-edit.png"
        alt="Teams 编辑页面：基本信息 + 主持人 + 成员"
        loading="lazy"
      />
    </p>
    <p>
      团队配置存在 <code>sessions.metadata.team</code>（包含 <code>enabled / hostAgentId /
      memberAgentIds / maxDepth / allowNesting</code>），并镜像到 <code>composer-prefs</code>
      作为「上次使用」的全局默认值。每次 <code>session:send-turn</code> 会带上 <code>teamConfig</code>。
    </p>
    <p>
      长期可复用的 Team 存在 <code>agent_teams</code> 表。可以从「设置 → Agents → Teams 标签」创建，
      也可由 <code>spark_platform</code> MCP 创建；之后在 Agent 选择器作为 Team Mode 预设选用。
    </p>

    <h2 id="dispatch">2. 分派机制</h2>
    <p>Host 调一次任务，团队模式会走这套流程：</p>
    <ol>
      <li>
        Spark 给 Host 这一轮注入进程内 MCP server <code>spark_team</code>，暴露唯一一个工具
        <code>mcp__spark_team__agent_dispatch</code>；同时把内置 <code>Task</code> 工具禁用，
        让所有 A2A 都走 dispatcher。
      </li>
      <li>
        Host 调用 <code>agent_dispatch</code>，<code>TeamDispatchService</code> 校验（成员是否启用、
        嵌套深度、单轮预算 5 次），把请求写入 <code>team_dispatches</code> 表，并发出
        <code>team_dispatch_requested</code> 事件。每个 turn 的多次 dispatch 排队执行，
        避免抢同一 workspace / session 文件。
      </li>
      <li>
        Member 跑一次性 turn，使用独立的 Provider / Model / Skills / MCP 与隔离的 Claude SDK
        <code>sdkSessionId</code>。流式 <code>assistant_message</code> 事件被重打标签为
        <code>team_member_message</code>（带 <code>dispatchId</code>），UI 把每个 Member
        渲染成独立的「群成员消息」，左侧方形头像 + 名字 + 正文。
      </li>
      <li>
        完成后返回结构化 <code>TeamA2AReply</code> 给 Host（同时发出
        <code>team_dispatch_completed</code>）。Host 决定继续分派还是合成最终答案。
      </li>
    </ol>

    <h2 id="avatar-timeline">3. 头像与时间线 UI</h2>
    <ul>
      <li>Agent 头像存在 <code>agents.metadata.avatar</code>；用户头像存在 <code>general.data.userAvatar</code>。</li>
      <li>默认头像来自 DiceBear URL（<code>https://api.dicebear.com/9.x/&#123;style&#125;/svg?seed=&#123;nickname&#125;</code>），也可以本地上传 256×256 的 data URL。</li>
      <li>Team Member 输出不再视觉嵌套在 Host 下，dispatch 事件显示为轻量状态行，
          原始的 <code>mcp__spark_team__agent_dispatch</code> 工具 JSON 在主时间线里被隐藏。</li>
      <li><code>team_member_message</code> 的 delta / complete 按 <code>dispatchId</code> 合并，避免重复显示。</li>
    </ul>

    <h2 id="nesting-budget">4. 嵌套与预算</h2>
    <ul>
      <li><strong>allowNesting=false（默认）</strong>：Member 不能继续分派。</li>
      <li><strong>allowNesting=true</strong>：Member 收到 <code>spark_team</code>（深度 +1），当 <code>depth &lt; maxDepth</code> 时可继续 dispatch；最大 3 层。</li>
      <li><strong>软预算</strong>：每 turn 5 次 dispatch 上限，超出返回 <code>Dispatch budget exceeded</code> 给 Host。</li>
      <li><strong>超时</strong>：单次 dispatch 默认 120s（最大 600s）。</li>
      <li>取消会话会立即中止所有在飞的 dispatch。</li>
    </ul>

    <h2 id="events">5. 事件</h2>
    <p>
      团队模式新增 4 个 <code>AgentEvent</code> 联合类型成员（区别于 SDK 内置的 <code>subagent_*</code>）：
    </p>
    <ul>
      <li><code>team_dispatch_requested</code></li>
      <li><code>team_member_message</code></li>
      <li><code>team_member_status</code></li>
      <li><code>team_dispatch_completed</code></li>
    </ul>
    <p>
      历史可经 <code>team:list-dispatches</code> 查询。
    </p>

    <h2 id="best-practices">6. 最佳实践</h2>
    <ul>
      <li>Member 数量控制在 3~5 个：超过后 dispatch 调度成本陡增。</li>
      <li>把每个 Member 的定位写在 Agent Prompt 里，避免与 Host 抢任务。</li>
      <li>不要把「一次性研究」放 Host 自己做，让专门的 research Member 跑。</li>
      <li>代码 / 审查 / 验证分别交给不同 Member，并行起来比单 Agent 快很多。</li>
    </ul>
  </>
)

export const teamMode: DocsPageContent = {
  slug: 'team-mode',
  toc: [
    { id: 'enable', title: '1. 启用团队模式', level: 2 },
    { id: 'save-team', title: '2. 创建并保存一个团队预设', level: 2 },
    { id: 'dispatch', title: '3. 分派机制', level: 2 },
    { id: 'avatar-timeline', title: '4. 头像与时间线 UI', level: 2 },
    { id: 'nesting-budget', title: '5. 嵌套与预算', level: 2 },
    { id: 'events', title: '6. 事件', level: 2 },
    { id: 'best-practices', title: '7. 最佳实践', level: 2 },
  ],
  faq: [
    {
      question: 'Member 之间会共享上下文吗？',
      answer:
        '不共享。每个 Member 跑的是独立 turn，使用独立的 sdkSessionId。Host 通过 TeamA2AReply 把上下文显式传给 Member。',
    },
    {
      question: '为什么我的 Member 没被调度？',
      answer:
        '检查三件事：Member 是不是「启用」、Host 的 Inspector「团队成员」是否勾选、Member 是否启用了 allowNesting（被嵌套时）。',
    },
    {
      question: 'Member 之间能相互 dispatch 吗？',
      answer: '可以，但需要 allowNesting=true 且 depth < maxDepth（最多 3 层）。',
    },
    {
      question: '可以查看历史分派吗？',
      answer:
        '可以。团队模式提供 team:list-dispatches 接口，能看到每次分派的入参、状态、产物。',
    },
  ],
  quickReference: [
    { key: '分派工具', value: 'mcp__spark_team__agent_dispatch' },
    { key: '默认嵌套', value: 'allowNesting=false（Member 不能 dispatch）' },
    { key: '单轮预算', value: '5 次 dispatch / turn' },
    { key: '默认超时', value: '120s / 次（最大 600s）' },
    { key: '最大嵌套', value: '3 层' },
    { key: '持久化', value: 'agent_teams / team_dispatches' },
  ],
  howTo: {
    name: '在 Spark Agent 中使用团队模式',
    description: '把一个复杂任务拆给多个 Agent 并行执行',
    totalTime: 'PT3M',
    steps: [
      '在「Agents」视图创建 1 个 Host Agent 与若干 Member Agent（每个 Member 设定自己的模型 / Skills / MCP）',
      '进入新会话，在 Agent 选择器选「团队模式」并绑定 Host',
      '在右侧 Inspector 勾选本会话可用的 Member Agent',
      '给 Host 发任务，Host 会自动通过 mcp__spark_team__agent_dispatch 把子任务分派给 Member',
      '在群聊式时间线里查看 Member 输出，Host 合成最终答案',
    ],
  },
  aiSummary:
    'Spark Agent 团队模式（Team Mode / Agent-to-Agent）：Host Agent 通过 mcp__spark_team__agent_dispatch 把子任务分派给 Member Agent，' +
    '每个 Member 使用独立的 Provider/Model/Skills/MCP 与隔离的 sdkSessionId，事件流（team_dispatch_requested / team_member_message / ' +
    'team_member_status / team_dispatch_completed）以群聊方式呈现。嵌套（allowNesting/maxDepth=3）、单轮预算（5 次 / turn）、' +
    '超时（默认 120s，最大 600s）、agent_teams 持久化与 team:list-dispatches 历史查询、群成员头像（DiceBear URL）。',
  Body,
}

export default teamMode
