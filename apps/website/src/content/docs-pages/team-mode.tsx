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
    <p>
      模型与适配器按「成员 Agent 配置优先、当前会话选择兜底」解析：Host/Member 自己配置了 Provider 或模型时使用自己的配置；未配置模型时沿用切换团队前会话中的模型，若该模型不属于所选 Provider，则回退到 Provider 默认模型。
      顶部团队状态条和右侧成员详情会标出当前生效模型及其来源。
    </p>
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
        Member 跑一次性 turn，使用独立的 Provider / Model / Skills 与隔离的 Claude SDK；应用中所有已启用 MCP 自动挂载，
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

    <h2 id="outcome-room">6. 成果作业间（Outcome Room）与 Living Ledger</h2>
    <p>
      团队协作的共识和成果不散落在聊天流里，而是结构化落入一张「活账本」（Living Ledger）：
      每条记录都有版本、权威等级、状态和来源，成员可以在同一份账本上对齐，而不是靠翻聊天记录。
    </p>
    <ul>
      <li>
        <strong>入口</strong>：右侧 Inspector → 团队成员区，即 Outcome Room 面板；每个团队会话对应一个
        room（<code>team-room:&#123;sessionId&#125;</code>），按 discussion 讨论线程隔离作用域。
      </li>
      <li>
        <strong>记录模型</strong>：每条记录包含 <code>logicalKey / value / status / authority /
        confidence / sourceRefs</code>、版本号、操作者与时间、过期时间和纠错关联；事件日志追加写入，
        当前投影可在事务内重放重建，历史永不物理删除。
      </li>
      <li>
        <strong>状态机</strong>：<code>proposed → active → superseded | invalid | expired | deleted</code>，
        提案也可 <code>proposed → rejected</code>；终态记录可 <code>restore</code> 回到 active。
        默认上下文只返回未过期的 active / proposed 记录，每个 (room, discussion) 最多保留 100 个当前 key。
      </li>
      <li>
        <strong>权威等级</strong>：<code>user &gt; system &gt; agent</code> 三级固定排序，落账权威由
        服务端 capability 绑定决定（<code>user-confirmed / system-observed / agent-inferred</code>），
        低等级 actor 不能修改更高等级记录的 current 版本。
      </li>
      <li>
        <strong>治理动作</strong>：用户在面板上可对提案执行
        <code>confirm / reject / correct / invalidate / restore</code>；所有动作带 discussion、
        记录 ID 和版本快照，由主进程用 user capability 校验后落账。
      </li>
      <li>
        <strong>并发防覆盖</strong>：写入用 <code>expectedVersion</code> 做 CAS 乐观锁，
        版本不匹配抛冲突而不是静默覆盖，冲突时 UI 提示可恢复并保留最后一次有效快照。
      </li>
      <li>
        <strong>成员可见</strong>：Host 派发任务前，会把当前 discussion 的 active、未过期 Ledger
        摘要自动注入成员 prompt（含权威、版本、来源），成员能基于账本共识干活。
      </li>
      <li>
        <strong>Agent 侧工具</strong>：<code>spark_team</code> 暴露 8 个账本工具——
        <code>team_ledger_read / team_ledger_propose / confirm / reject / correct / invalidate /
        tombstone / restore</code>；成员只可见读取与 propose 增量，治理工具仅对可信 host/system 上下文可见。
      </li>
    </ul>

    <h2 id="handoff-gate">7. 类型化交接与 Steering Gate</h2>
    <p>成员之间的交接不再是一句「我干完了」，而是带验收标准、产物引用和敏感度的结构化交接单；高风险动作先过闸门再执行。</p>
    <ul>
      <li>
        <strong>Typed Handoff（类型化交接）</strong>：交接单包含
        <code>purpose / inputs / expectedOutput / acceptanceCriteria / deadline / sensitivity</code>
        （sensitivity 分 <code>public / internal / confidential / restricted</code>），
        并携带 <code>artifactRefs / evidenceRefs</code> 产物与证据引用。
        状态机：<code>draft → submitted → accepted</code>，接收方可
        <code>request_clarification / reject</code>，完成后 <code>complete</code>，随时可 <code>cancel</code>。
      </li>
      <li>
        <strong>Steering Gate（转向闸门）</strong>：针对
        <code>ledger / record / artifact / handoff / task</code> 五类目标设置闸门，
        带触发条件、影响等级（<code>low / medium / high / critical</code>）与推荐动作。
        状态机：<code>waiting → approved | revise | stopped | expired</code>，
        由主持人在成员收尾前把关，approve 放行、revise 打回修改、stop 中止、expire 过期失效。
      </li>
      <li>
        <strong>权限边界</strong>：agent 只能读取和创建草稿/等待闸门，执行治理迁移
        （accept / approve / revise / stop 等）必须由 system 或 user capability 完成；
        每次迁移带 <code>expectedVersion</code> 防并发冲突，操作以唯一 <code>opId</code> 幂等。
      </li>
      <li>
        会话内可经 <code>team-p1:get</code> 读取交接与闸门快照，主进程在
        <code>team-p1:mutate</code> 时重新解析可信 discussion 并校验版本后落库。
      </li>
    </ul>

    <h2 id="best-practices">8. 最佳实践</h2>
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
    { id: 'outcome-room', title: '7. 成果作业间（Outcome Room）与 Living Ledger', level: 2 },
    { id: 'handoff-gate', title: '8. 类型化交接与 Steering Gate', level: 2 },
    { id: 'best-practices', title: '9. 最佳实践', level: 2 },
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
    {
      question: 'Outcome Room 的账本和普通聊天记录有什么区别？',
      answer:
        '聊天记录是线性时间流，账本是结构化状态：每条记录有版本、权威等级（user > system > agent）、状态和来源，支持 confirm / reject / correct / invalidate / restore 治理动作，并用版本号 CAS 防止并发覆盖。共识以账本为准，而不是翻聊天。',
    },
    {
      question: 'Typed Handoff 和 Steering Gate 是谁在用？',
      answer:
        '两者都是成员交接/收尾环节的把关机制：Typed Handoff 让交接带验收标准和产物引用（draft → submitted → accepted），Steering Gate 让主持人在成员收尾前 approve / revise / stop / expire。Agent 只能创建草稿和等待闸门，治理动作由用户或系统执行。',
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
    name: '在 Spark Work 中使用团队模式',
    description: '把一个复杂任务拆给多个 Agent 并行执行',
    totalTime: 'PT3M',
    steps: [
      '在「Agents」视图创建 1 个 Host Agent 与若干 Member Agent（每个 Member 可设定自己的模型 / Skills；已启用 MCP 自动可用）',
      '进入新会话，在 Agent 选择器选「团队模式」并绑定 Host',
      '在右侧 Inspector 勾选本会话可用的 Member Agent',
      '给 Host 发任务，Host 会自动通过 mcp__spark_team__agent_dispatch 把子任务分派给 Member',
      '在群聊式时间线里查看 Member 输出，Host 合成最终答案',
    ],
  },
  aiSummary:
    'Spark Work 团队模式（Team Mode / Agent-to-Agent）：Host Agent 通过 mcp__spark_team__agent_dispatch 把子任务分派给 Member Agent，' +
    '每个 Member 使用独立的 Provider/Model/Skills 与隔离的 sdkSessionId，应用中所有已启用 MCP 自动对 Host 和 Member 可用；事件流（team_dispatch_requested / team_member_message / ' +
    'team_member_status / team_dispatch_completed）以群聊方式呈现。嵌套（allowNesting/maxDepth=3）、单轮预算（5 次 / turn）、' +
    '超时（默认 120s，最大 600s）、agent_teams 持久化与 team:list-dispatches 历史查询、群成员头像（DiceBear URL）。',
  Body,
}

export default teamMode
