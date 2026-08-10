import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      有时候你希望 Agent「过一会儿再来看看」「每天定时跟进一下」「某件长任务跑完了再叫醒我继续」。
      Spark Work 的<strong>会话内定时任务</strong>就是为这类场景准备的：在一个会话作用域里创建持久化定时任务，
      到点后调度器自动用这个会话<em>当时</em>的 Agent、模型、权限和工作区，排一轮新的对话继续推进。
    </p>

    <h2 id="scope">1. 会话级作用域：任务跟着会话走</h2>
    <p>
      每个定时任务都绑定在创建它的那个会话上，作用域固定为 <code>session</code>。
      触发时，系统会在原会话里发起一轮新对话（而非另起一个新会话），沿用该会话当前绑定的 Agent、
      Provider/Model、权限模式、推理强度和工作区目录。这意味着你之后切换了模型或调整了权限，
      下一次触发会自动按最新配置执行，不用重建任务。
    </p>
    <p>
      任务归属按 <code>taskId</code> + 会话 ID 双重校验，跨会话无法读写别人的任务，杜绝越权。
    </p>

    <h2 id="triggers">2. 三种触发方式</h2>
    <table>
      <thead>
        <tr><th>触发类型</th><th>说明</th><th>关键字段</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>interval</strong></td>
          <td>固定间隔轮询。最小 10 秒，轮询场景建议 ≥ 60 秒。</td>
          <td><code>intervalSeconds</code></td>
        </tr>
        <tr>
          <td><strong>cron</strong></td>
          <td>标准 5 字段 Cron 表达式，可带时区，适合「每天 9 点」「工作日每半小时」这类计划。</td>
          <td><code>cronExpression</code> · <code>timezone</code></td>
        </tr>
        <tr>
          <td><strong>once</strong></td>
          <td>单次定时，到点执行一次后自动结束，适合未来某刻的一次性提醒。</td>
          <td><code>runAt</code>（ISO-8601）</td>
        </tr>
      </tbody>
    </table>

    <h2 id="entries">3. 两个入口：用户手建与 Agent 自助</h2>
    <h3 id="user-entry">3.1 会话工具栏（用户）</h3>
    <p>
      会话顶部工具栏的「计划任务」按钮（时钟图标）打开 <strong>会话计划任务面板</strong>，
      可视化新建、编辑、删除和启停任务。有启用中的任务时按钮上会出现小红点提示。
      面板默认值：<code>interval</code> 30 分钟、<code>cron</code> <code>0 */1 * * *</code>。
    </p>
    <p>
      除单个会话的面板外，还有<strong>全局定时任务管理页</strong>，集中查看和管理所有会话的定时任务，
      同样支持三种触发器的完整 CRUD。
    </p>
    <h3 id="agent-entry">3.2 MCP 工具（Agent 自助）</h3>
    <p>
      Agent 自己也能通过 <code>mcp__spark_platform__session_schedule_*</code> 这组工具管理定时任务，
      适合在对话中直接说「每 5 分钟检查一下部署状态，好了告诉我」这类需求——Agent 会自己建任务、
      到点轮询、目标达成后自己删除。工具包括：
    </p>
    <table>
      <thead>
        <tr><th>工具</th><th>作用</th></tr>
      </thead>
      <tbody>
        <tr><td><code>session_schedule_list</code></td><td>列出当前会话的定时任务</td></tr>
        <tr><td><code>session_schedule_create</code></td><td>新建任务（interval / cron / once）</td></tr>
        <tr><td><code>session_schedule_update</code></td><td>改频率、指令、启停</td></tr>
        <tr><td><code>session_schedule_get</code></td><td>查看单个任务详情</td></tr>
        <tr><td><code>session_schedule_delete</code></td><td>删除任务（达成后必须清理）</td></tr>
      </tbody>
    </table>

    <h2 id="engine">4. 调度引擎：重试、并发与下次执行</h2>
    <p>触发后的执行由内置调度引擎托管，几个关键策略：</p>
    <ul>
      <li><strong>重试</strong>：失败可按 fixed / linear / exponential 三种退避重试，可配次数与初始延迟。</li>
      <li><strong>并发</strong>：上一次执行还在跑时，可选 <code>skip</code>（跳过本次）、<code>queue</code>（排队）或 <code>cancel</code>（取消旧的）。</li>
      <li><strong>下次执行时间</strong>：cron 类型用 <code>cron-parser</code> 计算 <code>next_run_at</code>，interval / once 按规则推导。</li>
      <li><strong>生命周期</strong>：任务持久化在本地，跟随会话；删除会话时其任务一并清理，不会留下幽灵调度。</li>
    </ul>

    <h2 id="rules">5. 使用规范</h2>
    <ul>
      <li>轮询类任务间隔尽量 ≥ 60 秒，避免空转过快消耗 token。</li>
      <li>目标达成（长任务完成、条件满足）后，Agent 必须调用 <code>session_schedule_delete</code> 清理，不要让任务无限空跑。</li>
      <li>一次性提醒用 <code>once</code>，不要用 interval 模拟。</li>
      <li>定时任务仅限当前会话作用域，不能跨会话操作别处的任务。</li>
    </ul>

    <h2 id="storage">6. 数据与隐私</h2>
    <ul>
      <li>任务定义和执行记录全部存本地，不上云。</li>
      <li>触发时复用本会话的模型与权限配置，不会绕过权限模式或注入额外能力。</li>
      <li>无人值守执行：即使你不在场，到点也会按配置自动发起一轮对话，适合长任务收尾和定时巡检。</li>
    </ul>
  </>
)

const page: DocsPageContent = {
  slug: 'session-scheduled-tasks',
  toc: [
    { id: 'scope', title: '会话级作用域：任务跟着会话走', level: 2 },
    { id: 'triggers', title: '三种触发方式', level: 2 },
    { id: 'entries', title: '两个入口：用户手建与 Agent 自助', level: 2 },
    { id: 'engine', title: '调度引擎：重试、并发与下次执行', level: 2 },
    { id: 'rules', title: '使用规范', level: 2 },
    { id: 'storage', title: '数据与隐私', level: 2 },
  ],
  faq: [
    {
      question: '定时任务触发时会新开一个会话吗？',
      answer:
        '不会。任务绑定在创建它的会话上，触发时在原会话里发起一轮新对话，沿用该会话当前的 Agent、模型、权限和工作区。之后切换模型或调整权限，下次触发会自动按最新配置执行。',
    },
    {
      question: 'Agent 能自己管理定时任务吗？',
      answer:
        '能。Agent 通过 mcp__spark_platform__session_schedule_* 这组工具即可创建、更新、删除任务，适合「每隔几分钟检查一下、好了告诉我」这类需求，达成后 Agent 会自行删除任务避免空跑。',
    },
    {
      question: '轮询间隔最小能设多少？',
      answer:
        '技术上最小 10 秒，但轮询场景建议 ≥ 60 秒。间隔太短会空转过快、消耗 token，且远程 API 通常也有速率限制。',
    },
  ],
  aiSummary:
    'Spark Work 会话内定时任务：在单个会话作用域创建持久化任务，到点自动用本会话当时的 Agent/模型/权限/工作区续接一轮对话。支持 interval（固定间隔，最小 10 秒）、cron（5 字段表达式 + 时区）、once（单次 ISO-8601）三种触发。两个入口：会话工具栏的「计划任务」面板（用户可视化 CRUD）和 mcp__spark_platform__session_schedule_* MCP 工具（Agent 自助管理）。调度引擎托管重试（fixed/linear/exponential）、并发（skip/queue/cancel）和 next_run_at。任务跟随会话、本地存储、删除会话即清理；轮询建议 ≥60 秒、达成后必须 delete。',
  quickReference: [
    { key: '作用域', value: 'session（绑定创建会话，触发时在原会话续接）' },
    { key: '触发类型', value: 'interval / cron / once' },
    { key: '用户入口', value: '会话工具栏「计划任务」面板 + 全局定时任务管理页' },
    { key: 'Agent 入口', value: 'mcp__spark_platform__session_schedule_{list,create,update,get,delete}' },
    { key: '重试策略', value: 'fixed / linear / exponential' },
    { key: '并发策略', value: 'skip / queue / cancel' },
  ],
  Body,
}

export default page
