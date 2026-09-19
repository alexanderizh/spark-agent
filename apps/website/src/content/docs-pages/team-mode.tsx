import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      团队模式（Team Mode）让一个 <strong>Host</strong> Agent 把子任务分派给多个
      <strong>Member</strong> Agent，协作过程以群聊式事件流呈现。Host 和 Member 不是主从关系：
      每个成员是一个独立 Agent，有自己的 Provider、模型、Skills 和提示词，跑自己的 turn。
    </p>

    <h2 id="enable">1. 启用团队模式</h2>
    <p>入口在会话本身，不在设置里：</p>
    <ol>
      <li>
        在会话输入栏的 Agent 选择器里选<strong>「团队模式」</strong>。
      </li>
      <li>
        输入栏上方会出现团队横幅：<code>团队模式 · Host：&lt;主持人名&gt; · 成员 N</code>，
        右侧「管理成员」按钮直接打开右侧 Inspector。
      </li>
      <li>
        Inspector 顶部是<strong>「团队成员」</strong>区块：主持人单独一行（点击可换主持人），
        成员逐行开关，底部「邀请成员」加入候补 Agent。
      </li>
    </ol>
    <p>
      团队模式下输入栏会隐藏模型切换：Host 和各成员一律用自己在 Agent 里配置的模型。
      <code>@</code> 提及只在团队模式生效：被 @ 的成员会直接执行这一轮， 此时不会给它挂{' '}
      <code>spark_team</code> 派发工具（避免「被点名的人再转派」）。
    </p>
    <p>
      团队配置的持久化是两层的：<code>sessions.metadata.team</code> 是会话级权威来源 （写库走{' '}
      <code>team:update</code>）；localStorage 里的 <code>spark-agent:composer-prefs</code>
      只记住「上次用过的 Host 和成员」，作为下次显式开启团队时的预填，
      <strong>
        不会把 <code>enabled</code> 带过去
      </strong>
      ——这也是新会话默认单 Agent 起步的原因。
    </p>

    <h2 id="team-config">2. 团队配置字段与默认值</h2>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>含义</th>
          <th>默认值 / 限制</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>enabled</code>
          </td>
          <td>该会话是否处于团队模式</td>
          <td>
            默认 <code>false</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>hostAgentId</code>
          </td>
          <td>用户直接对话的主持 Agent</td>
          <td>
            缺失时回落 <code>platform-manager-agent</code>（Spark助手）
          </td>
        </tr>
        <tr>
          <td>
            <code>memberAgentIds</code>
          </td>
          <td>本会话授权可被派发的成员（不含 Host）</td>
          <td>IPC 校验最多 20 个</td>
        </tr>
        <tr>
          <td>
            <code>maxDepth</code>
          </td>
          <td>最大链式派发深度</td>
          <td>默认 1；界面与 IPC 只允许 1 / 2 / 3</td>
        </tr>
        <tr>
          <td>
            <code>allowNesting</code>
          </td>
          <td>成员能否再派发下一层</td>
          <td>
            默认 <code>false</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>dispatchTimeoutMs</code>
          </td>
          <td>单次派发超时</td>
          <td>
            缺省 600000（10 分钟），上限 1800000（30 分钟）；<strong>会话级字段，界面不暴露</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>maxDiscussionRounds</code>
          </td>
          <td>一场讨论最多推进多少轮</td>
          <td>默认 6，硬上限 20；界面可选 1/3/4/6/8/12/20</td>
        </tr>
        <tr>
          <td>
            <code>enablePeerMessaging</code>
          </td>
          <td>是否允许成员之间互发消息</td>
          <td>
            默认 <code>false</code>（实验性，界面文案「允许成员互相留言（实验性）」）
          </td>
        </tr>
        <tr>
          <td>
            <code>threadContextTokenBudget</code>
          </td>
          <td>注入成员的讨论快照 token 预算</td>
          <td>
            默认 6000，可配 500 ~ 40000；<strong>会话级字段，界面不暴露</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>teamId</code>
          </td>
          <td>来源的长期团队 id</td>
          <td>
            临时团队为 <code>undefined</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      注意 <code>maxDepth</code> 有个细微差别：界面和 IPC schema 卡在
      3，但读取会话配置时会把数值钳到
      1~10。也就是说存量数据里若出现过更大的值，运行时仍会按读到的值执行，只有新写入受 3 限制。
    </p>

    <h2 id="save-team">3. 长期团队（可复用预设）</h2>
    <p>
      入口：左侧<strong>「助手」→ Teams 标签</strong>（与 Agents 标签并列）。字段包括团队名、描述、
      头像、主持人、成员、团队专属 Prompt、是否启用。
    </p>
    <ul>
      <li>
        <strong>团队专属 Prompt</strong>：会作为 <code>[Team Instructions]</code> 段注入主持人，
        位置紧跟 <code>[Team Roster]</code> 之后。长期团队被删除时该段自动消失，不报错。
      </li>
      <li>
        <strong>嵌套调用</strong>：勾选「允许成员发起下一层 dispatch」后才可选最大深度（1/2/3）。
      </li>
      <li>
        <strong>讨论协作</strong>：讨论轮次上限与「允许成员互相留言（实验性）」。
      </li>
      <li>
        会话侧也能反向操作：Inspector 的「团队成员」区块支持把当前成员/嵌套配置
        <strong>保存为长期团队</strong>（创建新团队）或<strong>写回来源团队</strong>
        ，以及解除关联变成临时团队。
      </li>
    </ul>
    <p>
      长期团队存在 <code>agent_teams</code> 表（平台 MCP 的 <code>teams_*</code>{' '}
      工具管理同一份数据）。 应用一个已保存团队后，会话的 <code>teamId</code>{' '}
      指向它，但运行期仍以会话自己的
      <code>sessions.metadata.team</code> 为准。
    </p>

    <h2 id="dispatch">4. 分派链路</h2>
    <h3 id="dispatch-flow">4.1 Host 的一次派发发生了什么</h3>
    <ol>
      <li>
        运行时给 Host 注入进程内 MCP server <code>spark_team</code>，工具名形如
        <code>mcp__spark_team__agent_dispatch</code>。同时注入
        <code>[Orchestration Mode]</code> 提示词和 <code>orchestration_status</code> 事件，
        告诉它「本轮你是编排宿主」。
      </li>
      <li>
        <strong>Host 工具集不会被剥夺</strong>：提示词明确说 Host 保留完整工具（Edit/Write/Bash
        等）， 但职责是协调——实质工作优先派给成员，自己只做汇总、跑快速验证和小修。
      </li>
      <li>
        <code>agent_dispatch</code>（串行）与 <code>agent_dispatch_batch</code>（一次最多 10
        个并行任务） 把任务交给 <code>TeamDispatchService</code>
        。校验项：成员是否在本会话授权名单里、 嵌套深度是否超限、本 turn 预算是否用完。
      </li>
      <li>
        校验通过后写入 <code>team_dispatches</code> 表，发出
        <code>team_dispatch_requested</code> 与 <code>team_member_status</code>。 串行派发先入 turn
        队列（状态 <code>pending</code>，出队才转 <code>working</code>）， 批次派发走{' '}
        <code>parallel</code> 路径真正并发。
      </li>
      <li>
        成员跑自己的 turn，流式输出被打上 <code>team_member_message</code>（带{' '}
        <code>dispatchId</code>）， UI 渲染成独立的群成员消息气泡。
      </li>
      <li>
        完成后发出 <code>team_dispatch_completed</code>，Host 拿到结构化 <code>TeamA2AReply</code>（
        <code>state</code> / <code>content</code> / <code>error</code> / <code>usage</code>），
        决定继续派发还是合成最终答复。
      </li>
    </ol>
    <p>
      <code>agent_dispatch</code> 的参数：
      <code>targetAgentId</code>（支持用成员名模糊解析）、<code>instruction</code>（最长 8000 字）、
      <code>inputs</code>、<code>attachments</code>（最多 10 条）、
      <code>expectedOutput</code>（<code>text / json / code / mixed</code>）、
      <code>timeoutMs</code>（5000 ~ 600000）。
    </p>

    <h3 id="member-context">4.2 成员这一轮看到什么</h3>
    <ul>
      <li>
        Host 给的 <code>instruction</code>；<code>inputs</code> 以 <code>[Inputs]</code> 段落成 JSON
        正文。
      </li>
      <li>
        <code>[Attachments]</code>：文本直接内联，file_ref / image_ref 提示用 Read 工具读取。
      </li>
      <li>
        <code>[Expected output]</code>：期望产出形态。
      </li>
      <li>
        <code>[Discussion So Far]</code>：当前讨论线程的截断快照，按
        <code>threadContextTokenBudget</code> 裁剪（默认 6000 token）。
      </li>
      <li>
        <strong>Living Ledger 摘要</strong>：当前 discussion 里未过期的 active
        事实，带状态、权威等级、 版本号和来源。
      </li>
      <li>
        成员的 <code>Task</code> 与 <code>SendMessage</code> 工具<strong>始终禁用</strong>： A2A
        只走 <code>spark_team</code>，避免模型用 SDK 原生子代理体系抢走协作流量。
      </li>
    </ul>

    <h3 id="model-resolution">4.3 成员的模型与执行器怎么定</h3>
    <p>成员这一轮生效的 Provider / 模型按固定优先级解析：</p>
    <ol>
      <li>
        Provider：<code>member.providerProfileId</code> 优先；没配就沿用会话当前的 Provider。
      </li>
      <li>
        模型：成员的 <code>modelId</code> 优先；没配时看会话当前模型——只有它在该 Provider 的
        <code>modelIds</code> 白名单里（或白名单为空）才继承，否则回退到 Provider 的
        <code>defaultModel</code>。
      </li>
      <li>本地 CLI Provider 例外：直接沿用宿主机 CLI 自己的模型配置。</li>
      <li>执行器和权限模式同理：成员自己配了就用成员的，否则跟着会话（团队模式即主持人）走。</li>
    </ol>
    <p>
      讨论内同一成员的 SDK 会话可以续接（<code>continueSession</code>）：无讨论、Codex 成员或 resume
      gate 判定不安全时，每次派发用全新的 <code>sdkSessionId</code>。
    </p>

    <h2 id="limits">5. 预算、超时与嵌套限制</h2>
    <table>
      <thead>
        <tr>
          <th>限制</th>
          <th>真实数值</th>
          <th>超出后的行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Host 每 turn 派发次数</td>
          <td>
            10 次（<code>batch</code> 里每个任务各计一次）
          </td>
          <td>
            返回错误文案 <code>Dispatch budget exceeded (10 per turn)</code>，
            并发通知宿主准备一个续跑 turn
          </td>
        </tr>
        <tr>
          <td>成员同步咨询次数（peer call）</td>
          <td>20 次 / turn，独立预算，不挤占派发预算</td>
          <td>
            返回 <code>Peer call budget exceeded (20 per turn)</code>
          </td>
        </tr>
        <tr>
          <td>单次派发超时</td>
          <td>
            任务级 <code>timeoutMs</code> &gt; 会话 <code>dispatchTimeoutMs</code> &gt; 默认 600
            秒；上限 1800 秒
          </td>
          <td>
            该次派发以 <code>timeout</code> 失败
          </td>
        </tr>
        <tr>
          <td>嵌套深度</td>
          <td>
            <code>currentDepth &gt; 0</code> 时需要 <code>allowNesting</code>，且
            <code>depth &lt; maxDepth</code>
          </td>
          <td>
            返回 <code>depth_exceeded</code>，文案带最大深度
          </td>
        </tr>
        <tr>
          <td>单讨论消息总量</td>
          <td>40 条（广播 + 定向 @ 累计）</td>
          <td>
            返回 <code>message_budget_exceeded</code>
          </td>
        </tr>
        <tr>
          <td>
            正文 <code>@</code> 自动转发跳数
          </td>
          <td>6 跳（约 3 个完整往返）</td>
          <td>
            停止自动转发，需要模型显式调用 <code>agent_message</code>
          </td>
        </tr>
        <tr>
          <td>同轮同一对成员往返</td>
          <td>双向合计 8 条</td>
          <td>拒绝继续互 ping，提示推进轮次或收尾</td>
        </tr>
        <tr>
          <td>同步咨询链深</td>
          <td>3 层</td>
          <td>不再向下传递咨询</td>
        </tr>
      </tbody>
    </table>
    <p>
      取消会话或点「停止」会中止该会话所有在飞的派发：取消句柄按 <code>sessionId</code> 归属，
      不会误伤其他会话正在跑的成员。
    </p>

    <h2 id="events">6. 事件流与界面呈现</h2>
    <p>
      团队模式相关的 AgentEvent（与 SDK 原生的 <code>subagent_*</code> 无关）：
    </p>
    <table>
      <thead>
        <tr>
          <th>事件</th>
          <th>作用</th>
          <th>界面表现</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>team_dispatch_requested</code>
          </td>
          <td>
            Host 发起一次派发，带 <code>task</code>
          </td>
          <td>「Host → Member」调用卡片</td>
        </tr>
        <tr>
          <td>
            <code>team_member_status</code>
          </td>
          <td>
            <code>pending / working / idle / completed / failed</code>
          </td>
          <td>成员状态行 / 运行中标记</td>
        </tr>
        <tr>
          <td>
            <code>team_member_message</code>
          </td>
          <td>
            成员流式与完整输出，带 <code>dispatchId</code>、<code>mode</code>、
            <code>segmentId</code>
          </td>
          <td>
            成员消息气泡，按 <code>dispatchId</code> 合并 delta
          </td>
        </tr>
        <tr>
          <td>
            <code>team_dispatch_completed</code>
          </td>
          <td>
            收尾，带结构化 <code>reply</code>
          </td>
          <td>状态 chip 收口</td>
        </tr>
        <tr>
          <td>
            <code>team_peer_message</code>
          </td>
          <td>成员之间的对等消息（广播或定向 @）</td>
          <td>成员互发气泡；自动转发产生的副本降级为轻量提示</td>
        </tr>
        <tr>
          <td>
            <code>team_round_advanced</code>
          </td>
          <td>
            讨论轮次推进，带 <code>round</code> 与 <code>maxRounds</code>
          </td>
          <td>轮次分割线</td>
        </tr>
        <tr>
          <td>
            <code>team_discussion_concluded</code>
          </td>
          <td>
            收尾原因 <code>concluded / canceled / max_rounds</code>
          </td>
          <td>讨论结束态</td>
        </tr>
        <tr>
          <td>
            <code>orchestration_status</code>
          </td>
          <td>
            本轮是否处于编排宿主态（<code>source: team | workflow</code>）
          </td>
          <td>编排态标识</td>
        </tr>
      </tbody>
    </table>
    <p>
      历史派发可以按会话或按 turn 查：IPC 通道是 <code>team:list-dispatches</code>（
      <code>sessionId</code> + 可选 <code>turnId</code> + <code>limit</code>，默认 50、上限 200），
      返回每次派发的入参、状态、回复与起止时间。
    </p>
    <p>
      Inspector
      里还有一个「显示团队思考、命令和工具日志」开关：关掉后主持人消息里的纯过程段会被隐藏，
      只保留结论，群聊视图更干净。
    </p>

    <h2 id="discussions">7. 讨论线程、轮次与成员互聊</h2>
    <p>
      每个「Host + 成员 + 主题」组合对应一条讨论记录：<code>team_discussions</code> 表， 状态{' '}
      <code>active → concluded | canceled</code>，主题取当轮用户消息前 240 字。 讨论线程存在{' '}
      <code>team_thread_messages</code> 表，消息分四类：
      <code>host_dispatch</code>、<code>member_reply</code>、<code>peer_message</code>、
      <code>round_summary</code>。
    </p>
    <ul>
      <li>
        <strong>推进轮次</strong>：Host 调 <code>team_round_advance</code>，<code>round_index</code>{' '}
        加一并写入一条 本轮小结。超过 <code>maxDiscussionRounds</code>（默认 6，硬上限
        20）会被拒绝。
      </li>
      <li>
        <strong>收尾</strong>：Host 调 <code>team_conclude</code>；会话取消时也会收尾。收尾后的
        discussion 不再接受推进或对等消息。
      </li>
      <li>
        <strong>互聊</strong>：<code>enablePeerMessaging=true</code> 时成员才会拿到
        <code>agent_message</code>。它的投递语义有两种：<code>call</code> 同步触发对方执行一次
        turn，
        <code>note</code> 只写线程不定向唤醒。
      </li>
      <li>
        <strong>翻历史</strong>：<code>team_thread_read</code> 支持按轮次、按发送者、分页读全文，
        用于补上快照里被裁掉的部分。这个工具只要存在真实讨论就会注入，不受互聊开关限制。
      </li>
      <li>
        成员能否拿到派发工具，是三个条件各自独立的：嵌套（<code>allowNesting</code> &&
        <code>depth &lt; maxDepth</code>）决定 <code>agent_dispatch*</code>；互聊开关决定
        <code>agent_message</code>；有讨论就决定 <code>team_thread_read</code>。
      </li>
    </ul>

    <h2 id="ledger">8. Outcome Room 与 Living Ledger</h2>
    <p>
      团队共识不散落在聊天流里，而是写进结构化「活账本」。面板位置：右侧 Inspector 中
      「团队成员」区块<strong>正下方</strong>的 Outcome Room 面板，随会话里第一个真实讨论出现。
    </p>
    <ul>
      <li>
        <strong>Room 与作用域</strong>：每个会话一个 room，id 为
        <code>team-room:&#123;sessionId&#125;</code>；记录再按 discussion 隔离。
      </li>
      <li>
        <strong>记录字段</strong>：
        <code>logicalKey / value / status / authority / confidence / sourceRefs</code>
        、版本号、操作者与时间、过期时间与纠错关联。事件日志追加写入，
        当前投影可在事务内重放重建，历史不物理删除。
      </li>
      <li>
        <strong>状态</strong>：
        <code>
          proposed / active / rejected / superseded / invalid / expired / deleted / conflict
        </code>
        。默认上下文只返回未过期的 active 与 proposed 记录； 每个 (room, discussion) 的当前 key 上限
        100 条。
      </li>
      <li>
        <strong>权威等级</strong>：
        <code>user-confirmed &gt; system-observed &gt; agent-inferred</code>。 低等级 actor
        不能改更高等级记录的当前版本；成员 turn 一律以
        <code>agent-inferred</code> 身份落账。
      </li>
      <li>
        <strong>面板动作</strong>：proposed 可 <code>confirm / reject / correct / invalidate</code>
        ； active 可 <code>correct / invalidate</code>；终态（rejected / invalid / expired /
        deleted）可
        <code>restore</code>。每次提交都带 <code>expectedVersion</code>，版本不匹配直接冲突，
        不静默覆盖。
      </li>
      <li>
        <strong>Agent 侧工具</strong>：<code>spark_team</code> 暴露 8 个账本工具——
        <code>
          team_ledger_read / team_ledger_propose / team_ledger_confirm / team_ledger_reject /
          team_ledger_correct / team_ledger_invalidate / team_ledger_tombstone / team_ledger_restore
        </code>
        。<strong>成员只拿到 read 与 propose</strong>，其余治理工具只有可信的 host / system / user
        上下文可见。
      </li>
      <li>
        <strong>写入限额</strong>：账本值必须是纯 JSON，嵌套深度 ≤ 10、节点数 ≤ 200、序列化 体积 ≤
        8000 字节。
      </li>
    </ul>

    <h2 id="handoff-gate">9. 类型化交接与 Steering Gate</h2>
    <ul>
      <li>
        <strong>Typed Handoff</strong>：字段为
        <code>purpose / inputs / expectedOutput / acceptanceCriteria / deadline / sensitivity</code>
        （sensitivity 取值 <code>public / internal / confidential / restricted</code>）， 并可带{' '}
        <code>artifactRefs / evidenceRefs</code> 与附件引用。 状态机：
        <code>draft → submitted → accepted</code>，接受方可
        <code>request_clarification</code> 或 <code>reject</code>，完成后 <code>complete</code>，
        过程中可 <code>cancel</code>。
      </li>
      <li>
        <strong>Steering Gate</strong>：针对{' '}
        <code>ledger / record / artifact / handoff / task</code>
        五类目标创建闸门，带触发条件、影响等级（<code>low / medium / high / critical</code>）、
        预算快照与推荐动作。状态机：<code>waiting → approved | revise | stopped | expired</code>。
      </li>
      <li>
        <strong>工具面</strong>：<code>team_p1_read</code>、<code>team_handoff_create</code>、
        <code>team_steering_gate_create</code>，以及交接迁移工具
        <code>
          team_handoff_submit / accept / request_clarification / reject / complete / cancel
        </code>
        、 闸门决策工具 <code>team_steering_gate_approve / revise / stop / expire</code>。
      </li>
      <li>
        <strong>权限边界</strong>：<code>capability = 'agent'</code> 时只返回 read + create
        三个工具； 执行治理迁移必须由 system 或 user capability 完成。每次迁移带
        <code>expectedVersion</code>，并以唯一 <code>opId</code> 幂等。
      </li>
      <li>
        数据落在 <code>team_handoffs</code> / <code>team_handoff_events</code> 与
        <code>team_steering_gates</code> / <code>team_steering_gate_events</code>， 均由{' '}
        <code>session_id + room_id + discussion_id</code> 限定作用域。
      </li>
    </ul>

    <h2 id="runtime-tooling">10. 其它讨论级工具族</h2>
    <p>
      只要存在真实讨论，<code>spark_team</code> 还会挂上这几组工具（数量按讨论粒度）：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具族</th>
          <th>工具</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>任务图</td>
          <td>
            <code>team_task_graph_read / create_node / add_edge / retry / reassign</code>（
            <code>reassign</code> 需要 user 或 system 权限）
          </td>
        </tr>
        <tr>
          <td>审议</td>
          <td>
            <code>
              team_deliberation_read / propose / add_evidence / add_alternative / add_risk / vote /
              decide / resolve
            </code>
            （<code>decide</code>、<code>resolve</code> 需要治理权限）
          </td>
        </tr>
        <tr>
          <td>证据与成本</td>
          <td>
            <code>
              team_evidence_cost_read / team_evidence_add / team_evidence_verify /
              team_evidence_invalidate / team_cost_record_usage / team_cost_set_budget
            </code>
          </td>
        </tr>
        <tr>
          <td>回放与剧本</td>
          <td>
            <code>team_replay_read / diff / fork</code>、
            <code>team_playbook_list / propose / publish / apply / archive</code>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="best-practices">11. 最佳实践与排查</h2>
    <ul>
      <li>成员控制在 3~5 个：每次派发都是一次真实 turn，数量和成本线性增长。</li>
      <li>把每个成员的定位写进它的 Agent 提示词，避免 Host 与成员互相抢活。</li>
      <li>在团队专属 Prompt 里写清派工规则（先派谁、什么时候汇总），比在聊天里反复纠正便宜。</li>
      <li>
        成员没被派发时依次检查：会话 <code>memberAgentIds</code> 里有没有它、Agent 是否启用、
        嵌套场景下 <code>allowNesting</code> 与 <code>maxDepth</code> 是否放行。
      </li>
      <li>
        出现 <code>Dispatch budget exceeded</code> 说明单 turn 10 次已经用满：
        拆小任务粒度，或等宿主发起续跑 turn，而不是继续加派发。
      </li>
      <li>想让长期策略可复用，把配置「保存为长期团队」，而不是每次在 Inspector 里重勾成员。</li>
    </ul>
  </>
)

export const teamMode: DocsPageContent = {
  slug: 'team-mode',
  toc: [
    { id: 'enable', title: '1. 启用团队模式', level: 2 },
    { id: 'team-config', title: '2. 团队配置字段与默认值', level: 2 },
    { id: 'save-team', title: '3. 长期团队（可复用预设）', level: 2 },
    { id: 'dispatch', title: '4. 分派链路', level: 2 },
    { id: 'dispatch-flow', title: '4.1 一次派发发生了什么', level: 3 },
    { id: 'member-context', title: '4.2 成员看到什么上下文', level: 3 },
    { id: 'model-resolution', title: '4.3 成员的模型与执行器', level: 3 },
    { id: 'limits', title: '5. 预算、超时与嵌套限制', level: 2 },
    { id: 'events', title: '6. 事件流与界面呈现', level: 2 },
    { id: 'discussions', title: '7. 讨论线程、轮次与成员互聊', level: 2 },
    { id: 'ledger', title: '8. Outcome Room 与 Living Ledger', level: 2 },
    { id: 'handoff-gate', title: '9. 类型化交接与 Steering Gate', level: 2 },
    { id: 'runtime-tooling', title: '10. 其它讨论级工具族', level: 2 },
    { id: 'best-practices', title: '11. 最佳实践与排查', level: 2 },
  ],
  faq: [
    {
      question: 'Host 和 Member 会共享上下文吗？',
      answer:
        '不会自动共享完整对话。成员拿到的是 Host 写的 instruction、inputs、附件、期望产出，加上当前讨论线程的截断快照和 Living Ledger 摘要。在真实讨论里，同一成员的 SDK 会话可以续接（continueSession），但 Host 与成员的对话历史是各自独立的。',
    },
    {
      question: '成员之间能互相派发任务吗？',
      answer:
        '要看两个开关。嵌套派发需要 allowNesting=true 且 depth < maxDepth（界面最多 3 层）；成员之间的对等消息需要 enablePeerMessaging=true，此时成员才拿到 agent_message 工具。两者互相独立：开了互聊但没有嵌套，成员也只能拿到 agent_message 和 team_thread_read。',
    },
    {
      question: '为什么我的成员没被调度？',
      answer:
        '按顺序检查：该 Agent 是否启用、是否在会话的 memberAgentIds 里（Inspector「团队成员」勾选）、是否是嵌套场景但 allowNesting 为 false 或已到 maxDepth、本轮派发是否已经用满 10 次预算。失败原因会作为错误文案返回给 Host，也可以在群聊时间线里看到失败状态行。',
    },
    {
      question: '一次能派发多少个任务？',
      answer:
        'agent_dispatch_batch 一次最多提交 10 个任务，但每个任务各计一次预算，而单 turn 派发预算正好是 10 次；超出的派发会返回 Dispatch budget exceeded 并触发续跑。serial 的 agent_dispatch 每个 turn 也共享同一份预算。',
    },
    {
      question: '成员模型为什么和我选的不一样？',
      answer:
        '成员生效模型优先级是：成员 Agent 自己的 modelId → 会话当前模型（仅当它在该 Provider 的模型白名单里）→ Provider 默认模型。本地 CLI Provider 直接沿用 CLI 自己的模型。Provider 同理：成员没配就用会话的。',
    },
    {
      question: 'Outcome Room 的账本和聊天记录有什么区别？',
      answer:
        '聊天记录是线性时间流；账本是带版本的结构化状态。每条记录有 status、authority（user-confirmed > system-observed > agent-inferred）、来源和 version，支持 confirm / reject / correct / invalidate / restore，写入用 expectedVersion 做 CAS 防并发覆盖，历史事件只追加不删除。',
    },
  ],
  quickReference: [
    { key: '分派工具', value: 'mcp__spark_team__agent_dispatch / agent_dispatch_batch' },
    { key: '单轮派发预算', value: '10 次 / turn（batch 里每个任务各计一次）' },
    { key: '成员互聊预算', value: '20 次 peer call / turn；单讨论消息上限 40 条' },
    { key: '派发超时', value: '默认 600s，上限 1800s；工具参数 timeoutMs 范围 5000~600000' },
    { key: '嵌套', value: 'allowNesting 默认 false；maxDepth 默认 1，界面与 IPC 最多 3' },
    { key: '讨论轮次', value: 'maxDiscussionRounds 默认 6，硬上限 20' },
    { key: '讨论快照预算', value: 'threadContextTokenBudget 默认 6000（500~40000）' },
    {
      key: '持久化',
      value: 'sessions.metadata.team / agent_teams / team_dispatches / team_discussions',
    },
    {
      key: '账本 room',
      value: 'team-room:{sessionId}（每个 (room, discussion) 当前 key 上限 100）',
    },
  ],
  howTo: {
    name: '在 Spark Work 里跑一场团队协作',
    description: '开启团队模式、勾选成员、让 Host 派发并查看事件流与账本',
    totalTime: 'PT5M',
    steps: [
      '先在「助手 → Agents」里准备好成员 Agent，各自配好模型、Skills 与提示词',
      '在会话输入栏的 Agent 选择器里选「团队模式」，确认主持人',
      '点横幅上的「管理成员」或打开右侧 Inspector，在「团队成员」里邀请成员',
      '需要成员再派发下一层时，展开「高级」勾选「允许 Member 嵌套调用」并选最大深度',
      '需要成员互聊时再勾「允许成员互相留言（实验性）」，并按需调整讨论轮次上限',
      '给 Host 发任务，Host 会通过 mcp__spark_team__agent_dispatch 派发子任务',
      '在群聊时间线里看成员消息、状态行与轮次分割线；必要时关掉团队过程日志只看结论',
      '在 Inspector 的 Outcome Room 面板里 confirm / correct 需要固化的结论',
      '想复用这套配置，在「团队成员」区块保存为长期团队，之后到「助手 → Teams」管理',
    ],
  },
  aiSummary:
    'Spark Work 团队模式：Host Agent 通过 mcp__spark_team__agent_dispatch（串行）与 agent_dispatch_batch（一次最多 10 个并行任务）把子任务派给 Member Agent，每个成员是独立 Agent，按「成员 modelId 优先、会话模型次之、Provider 默认兜底」解析模型，成员 turn 始终禁用 Task/SendMessage。' +
    '配置存在 sessions.metadata.team（enabled / hostAgentId / memberAgentIds / maxDepth / allowNesting / dispatchTimeoutMs / maxDiscussionRounds / enablePeerMessaging / threadContextTokenBudget），长期团队存在 agent_teams 表并在「助手 → Teams」标签维护。' +
    '真实限制：单 turn 派发预算 10 次、peer call 预算 20 次、单讨论消息 40 条、正文 @ 自动转发 6 跳、同轮同对成员 8 条、同步咨询 3 层、派发超时默认 600 秒上限 1800 秒、maxDepth 默认 1（界面与 IPC 最多 3）、讨论轮次默认 6 硬上限 20。' +
    '事件流含 team_dispatch_requested / team_member_status / team_member_message / team_dispatch_completed / team_peer_message / team_round_advanced / team_discussion_concluded 与 orchestration_status，历史可用 team:list-dispatches 查询。' +
    '协作治理由 Living Ledger（Outcome Room，room id 为 team-room:{sessionId}，user-confirmed > system-observed > agent-inferred，8 个 team_ledger_* 工具，成员只有 read 与 propose）与 Typed Handoff / Steering Gate（team_p1_read、team_handoff_*、team_steering_gate_*）承载，另有任务图、审议、证据成本、回放剧本等讨论级工具族。',
  Body,
}

export default teamMode
