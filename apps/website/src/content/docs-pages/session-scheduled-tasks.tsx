import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      有时候你希望 Agent「过一会儿再来看看」「每天定时跟进一下」「某件长任务跑完了再叫醒我继续」。
      Spark Work 的<strong>会话内定时任务</strong>
      就是为这类场景准备的：在某个会话作用域里创建持久化任务，
      到点后调度器自动在这个会话里排一轮新对话，沿用会话<em>当时</em>的
      Agent、模型、权限和工作区继续推进。
    </p>

    <h2 id="scope">1. 会话级作用域：任务跟着会话走</h2>
    <p>
      每个定时任务都绑定在创建它的那个会话上：<code>scheduled_tasks</code> 表里的
      <code>scope</code> 为 <code>'session'</code>，<code>session_id</code> 指向会话。 触发时它
      <strong>不会新开会话</strong>，而是往原会话里排一轮 turn （内部标记{' '}
      <code>turnSource: 'scheduled_task'</code>、<code>userMessageVisibility: 'hidden'</code>），
      因此这一轮用的是会话当前的 Agent、Provider/模型、权限模式、推理强度和工作区目录。
      你之后切换模型或调整权限，下一次触发会自动按最新配置执行。
    </p>
    <ul>
      <li>
        <strong>归属校验</strong>：Agent 侧工具用「task id + 当前会话 id」双重校验， 任务必须{' '}
        <code>scope === 'session'</code> 且 <code>sessionId</code> 与当前会话一致才允许读写， 猜 id
        也拿不到别的会话或全局任务。
      </li>
      <li>
        <strong>删除会话即级联清理</strong>：<code>session_id</code> 外键带
        <code>ON DELETE CASCADE</code>，删除会话时它的任务随之删除。
      </li>
      <li>
        <strong>归档会暂停</strong>：会话被归档时，启用中的会话任务进入 paused 状态；
        取消归档时只有归档前启用的那些会被恢复，并重新计算下次执行时间。
      </li>
      <li>
        <strong>会话不存在 / 读不到状态</strong>：任务会被停用并记
        <code>Bound session no longer exists</code>；只是暂时读不到会话状态则推迟重试并记录原因。
      </li>
    </ul>

    <h2 id="entries">2. 两个入口，别搞混作用域</h2>
    <h3 id="entry-session">2.1 会话工具栏：只管理本会话</h3>
    <p>
      会话顶部工具栏有一个时钟图标按钮（提示文案「计划任务」），点开是
      <strong>会话计划任务面板</strong>。有启用中的任务时按钮上会带一个小红点。
      面板支持新建、编辑、启停、立即运行、删除，提交时固定
      <code>scope: 'session'</code> + 当前 <code>sessionId</code> +{' '}
      <code>concurrencyPolicy: 'queue'</code>。
    </p>
    <p>面板表单的默认值：</p>
    <ul>
      <li>
        触发类型 <code>interval</code>，间隔 30 分钟（提交时换算成秒，最小 10 秒）。
      </li>
      <li>
        Cron 预填 <code>0 */1 * * *</code>。
      </li>
      <li>
        <code>skipIfSessionRunning</code> 与 <code>continueOnError</code> 默认勾选。
      </li>
      <li>
        名称与任务正文必填；<code>once</code> 必须选一个合法时间。
      </li>
    </ul>
    <h3 id="entry-global">2.2 侧栏「定时任务」：全局任务，不是会话任务</h3>
    <p>
      左侧导航的 <strong>「定时任务」</strong> 页是另一套作用域：它列出的是
      <code>scope: 'global'</code> 的任务，新建时也按 global 写入（默认{' '}
      <code>concurrencyPolicy: 'skip'</code>）。 全局任务触发时会<strong>新建一个会话</strong>
      （默认落在「无项目对话」目录，标题前缀带任务名），
      而不是续在原会话里。想「在某个会话里继续」就必须用会话面板或 Agent 工具创建。
    </p>
    <p>
      用户侧 IPC 通道：
      <code>
        scheduled-task:list / get / create / update / delete / toggle / run-now / export / import /
        export-to-file / import-from-file
      </code>
      ， 执行记录用 <code>task-execution:list / get / cancel</code>。 「立即运行」会立刻建一条{' '}
      <code>trigger_type: 'manual'</code> 的执行记录， 并在 10 秒内把新会话 id
      还给界面用于跳转，真正的 turn 在后台跑。
    </p>

    <h2 id="fields">3. 字段与默认值</h2>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>含义</th>
          <th>默认值 / 取值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>name</code> / <code>promptTemplate</code>
          </td>
          <td>任务名与任务正文（必填，正文最长 10 万字符）</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>triggerType</code>
          </td>
          <td>触发方式</td>
          <td>
            <code>interval</code> / <code>cron</code> / <code>once</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>intervalSeconds</code>
          </td>
          <td>固定间隔秒数</td>
          <td>最小 10，最大 31536000</td>
        </tr>
        <tr>
          <td>
            <code>cronExpression</code>
          </td>
          <td>Cron 表达式</td>
          <td>必须是 5 字段；非法表达式会在创建/更新时直接报错</td>
        </tr>
        <tr>
          <td>
            <code>runAt</code>
          </td>
          <td>单次执行时间（ISO-8601）</td>
          <td>必须能解析且晚于当前时间</td>
        </tr>
        <tr>
          <td>
            <code>timezone</code>
          </td>
          <td>时区</td>
          <td>
            默认 <code>'system'</code>（跟随本机）；不是 system 时交给 cron-parser 解析
          </td>
        </tr>
        <tr>
          <td>
            <code>startAt</code> / <code>endAt</code>
          </td>
          <td>生效时间窗</td>
          <td>可选；未到 startAt 时下次执行会被推到 startAt</td>
        </tr>
        <tr>
          <td>
            <code>maxExecutions</code>
          </td>
          <td>最多执行多少次</td>
          <td>默认 0（不限）；达到上限后任务自动停用</td>
        </tr>
        <tr>
          <td>
            <code>timeoutSeconds</code>
          </td>
          <td>单次执行超时</td>
          <td>默认 300；Agent 工具可写 10 ~ 86400</td>
        </tr>
        <tr>
          <td>
            <code>maxRetries</code>
          </td>
          <td>失败重试次数</td>
          <td>默认 0（不重试）；上限 100</td>
        </tr>
        <tr>
          <td>
            <code>retryDelaySeconds</code>
          </td>
          <td>重试基础延迟</td>
          <td>默认 60</td>
        </tr>
        <tr>
          <td>
            <code>retryBackoff</code>
          </td>
          <td>退避策略</td>
          <td>
            <code>fixed</code>（默认）/ <code>linear</code> / <code>exponential</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>concurrencyPolicy</code>
          </td>
          <td>上一次还在跑时怎么办</td>
          <td>
            会话面板与 Agent 工具写 <code>queue</code>；数据表与全局页默认 <code>skip</code>； 可选{' '}
            <code>skip</code> / <code>queue</code> / <code>cancel</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>skipIfSessionRunning</code>
          </td>
          <td>会话有运行中/排队中的 turn 时跳过本次</td>
          <td>
            默认 <code>true</code>（数据库列默认 1）
          </td>
        </tr>
        <tr>
          <td>
            <code>continueOnError</code>
          </td>
          <td>会话报错后是否继续后续触发</td>
          <td>
            默认 <code>true</code>；关掉后该任务在会话进入 error 时会被暂停
          </td>
        </tr>
        <tr>
          <td>
            <code>historyRetentionDays</code>
          </td>
          <td>执行记录保留天数</td>
          <td>默认 30；每次执行结束后清理过期记录</td>
        </tr>
        <tr>
          <td>
            <code>tags</code> / <code>notifications</code>
          </td>
          <td>标签 / Webhook 通知配置</td>
          <td>通知可挂 onSuccess / onFailure / onRetry / onDisabled</td>
        </tr>
      </tbody>
    </table>
    <p>
      会话任务的 <code>agent_id</code>、<code>team_id</code>、<code>model_id</code>、
      <code>workspace_id</code>
      一律写 <code>null</code>，<code>permission_mode</code> 写 <code>'auto'</code>：
      这是刻意的设计——会话任务只跟随会话当时的运行时配置，不给自己绑一份会过期的快照。
    </p>

    <h2 id="triggers">4. 三种触发方式怎么选</h2>
    <table>
      <thead>
        <tr>
          <th>触发类型</th>
          <th>用法</th>
          <th>校验与计算</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>interval</strong>
          </td>
          <td>固定间隔轮询，轮询场景建议 ≥ 60 秒</td>
          <td>
            需要 <code>intervalSeconds ≥ 10</code>；下次执行 = 当前时间 + 间隔秒数
          </td>
        </tr>
        <tr>
          <td>
            <strong>cron</strong>
          </td>
          <td>「每天 9 点」「工作日每半小时」这类计划</td>
          <td>
            必须 5 字段并通过 cron-parser 解析；非 <code>system</code> 时区会带 <code>tz</code> 计算
          </td>
        </tr>
        <tr>
          <td>
            <strong>once</strong>
          </td>
          <td>未来某一刻的一次性唤醒</td>
          <td>
            需要未来的 <code>runAt</code>；执行一次后任务自动停用；被跳过的单次任务会在 60 秒后重试
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      会话任务的这层校验只在 <code>scope === 'session'</code> 时强制执行，报错文案分别是 「interval
      must be at least 10 seconds」「requires a valid five-field cron expression」 「runAt must be
      in the future」。
    </p>

    <h2 id="agent-tools">5. Agent 也能自己建任务</h2>
    <p>
      Agent 通过 <code>mcp__spark_platform__session_schedule_*</code> 这组工具自助管理会话定时任务，
      适合「每 5 分钟检查一下部署状态，好了告诉我」这类需求：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>session_schedule_list</code>
          </td>
          <td>列出当前会话的任务（先查再建，避免重复轮询）</td>
        </tr>
        <tr>
          <td>
            <code>session_schedule_create</code>
          </td>
          <td>新建任务（interval / cron / once）</td>
        </tr>
        <tr>
          <td>
            <code>session_schedule_update</code>
          </td>
          <td>改频率、指令、启停</td>
        </tr>
        <tr>
          <td>
            <code>session_schedule_get</code>
          </td>
          <td>查看单个任务详情（同样做归属校验）</td>
        </tr>
        <tr>
          <td>
            <code>session_schedule_delete</code>
          </td>
          <td>删除任务</td>
        </tr>
      </tbody>
    </table>
    <p>这组工具与用户面板的差异：</p>
    <ul>
      <li>
        <strong>会话绑定由运行时提供，模型不能传 sessionId</strong>：参数里没有会话字段，
        工具被注入到哪个会话就只作用于哪个会话；工具说明也明确要求不要询问或编造 session id。
      </li>
      <li>
        <strong>入参是严格 schema</strong>：多传未知字段会直接报错；<code>intervalSeconds</code>、
        <code>cronExpression</code> 等都按上面的上限校验。
      </li>
      <li>
        <strong>默认值偏向安全</strong>：<code>skipIfSessionRunning</code> 与
        <code>continueOnError</code> 默认 true，<code>concurrencyPolicy</code> 默认
        <code>queue</code>，<code>timeoutSeconds</code> 默认 300，<code>historyRetentionDays</code>{' '}
        默认 30。
      </li>
      <li>
        <strong>生命周期要求写进了系统提示词</strong>：创建后简短告知用户并结束本轮；
        每次唤醒先看真实状态，还没完成就留着，任务完成后必须调用
        <code>session_schedule_delete</code> 清理，不能无限空跑。禁用只是暂停，不算清理。
      </li>
    </ul>

    <h2 id="engine">6. 调度引擎的行为</h2>
    <h3 id="engine-concurrency">6.1 并发与会话忙</h3>
    <ul>
      <li>
        调度器是桌面主进程里的定时器，<strong>每 1 秒 tick 一次</strong>：应用没运行时不会触发。
      </li>
      <li>
        同一任务已有 <code>running</code> 的执行记录时：<code>skip</code> 跳过本次并重算下次时间；
        <code>cancel</code> 把旧执行标记为 canceled 再开新的；<code>queue</code> 直接再开一个。
      </li>
      <li>
        <code>skipIfSessionRunning</code> 生效时，只要会话有正在执行或已排队等待的 turn，
        本次触发就顺延（<code>once</code> 任务顺延 60 秒后重试）。
      </li>
      <li>
        会话报 error 且 <code>continueOnError</code> 为 false 时，任务被暂停而不是继续触发。
      </li>
    </ul>
    <h3 id="engine-retry">6.2 重试</h3>
    <p>
      失败后按 <code>maxRetries</code> 与退避策略重试，重试的延迟公式：
    </p>
    <ul>
      <li>
        <code>fixed</code>：<code>baseDelay × 1</code>
      </li>
      <li>
        <code>linear</code>：<code>baseDelay × (attempt + 1)</code>
      </li>
      <li>
        <code>exponential</code>：<code>baseDelay × 2^attempt</code>
      </li>
    </ul>
    <p>
      每次重试都是一条独立执行记录（<code>trigger_type: 'retry'</code>、带
      <code>retry_attempt</code> 与 <code>parent_execution_id</code>
      ），所以你能在记录里看出是第几次尝试。 超过 <code>timeoutSeconds</code> 的执行记为{' '}
      <code>timeout</code> 而不是 <code>failed</code>。
    </p>
    <h3 id="engine-lifecycle">6.3 生命周期与错过的运行</h3>
    <ul>
      <li>
        <strong>错过的运行不补跑</strong>：应用关闭期间到点的会话任务，在下次启动时会被跳过——
        周期任务直接挪到下一个未来时间点，错过的单次任务会被停用。
      </li>
      <li>
        执行状态：<code>running / completed / failed / cancelled / timeout</code>。
      </li>
      <li>
        任务状态：<code>idle / running / disabled / error</code>。
      </li>
      <li>
        达到 <code>maxExecutions</code> 或单次任务执行完成后，任务自动 disabled。
      </li>
      <li>
        每次执行结束按 <code>historyRetentionDays</code> 清理历史执行记录。
      </li>
    </ul>

    <h2 id="prompt">7. 触发时注入了什么</h2>
    <p>
      触发的那一轮不是普通用户消息，系统会把它包成 <code>[Scheduled Task Context]</code>：
    </p>
    <ul>
      <li>说明这轮由调度器发起、不是用户手动发送。</li>
      <li>
        任务名、任务 id（会话任务专属），并提示任务完成后要调用
        <code>session_schedule_delete</code> 清理。
      </li>
      <li>执行触发来源、配置的计划、下次执行时间与时区。</li>
      <li>明确要求「不要反过来问用户间隔 / Cron / 触发时间」，按既有计划执行。</li>
      <li>
        最后跟 <code>[Task Instructions]</code>，即你写的任务正文。
      </li>
    </ul>
    <p>
      任务正文支持模板变量，会在写入提示词前替换：
      <code>&#123;&#123;date&#125;&#125;</code>、<code>&#123;&#123;time&#125;&#125;</code>、
      <code>&#123;&#123;taskName&#125;&#125;</code>、
      <code>&#123;&#123;triggerType&#125;&#125;</code>、
      <code>&#123;&#123;executionCount&#125;&#125;</code>、
      <code>&#123;&#123;interval&#125;&#125;</code>、
      <code>&#123;&#123;cronExpression&#125;&#125;</code>、
      <code>&#123;&#123;runAt&#125;&#125;</code>、<code>&#123;&#123;timezone&#125;&#125;</code>、
      <code>&#123;&#123;nextRunAt&#125;&#125;</code>。 认不出的变量保持原样，方便你发现拼写错误。
    </p>

    <h2 id="rules">8. 使用规范与排查</h2>
    <ul>
      <li>轮询类任务的间隔尽量 ≥ 60 秒，避免空转过快消耗 token。</li>
      <li>
        目标达成（长任务完成、条件满足）后必须调用 <code>session_schedule_delete</code> 清理，
        不要让任务无限空跑；只想临时停机用「停用」。
      </li>
      <li>
        一次性提醒用 <code>once</code>，不要用 interval 模拟。
      </li>
      <li>
        在任务正文里写清「检查什么、状态在哪、什么算完成、还没完成时怎么办、什么时候删任务」，
        无人值守的那一轮才不需要向你追问。
      </li>
      <li>
        任务定义与执行记录都落本地 SQLite（<code>scheduled_tasks</code> /{' '}
        <code>task_executions</code>）；
        触发时复用本会话的模型与权限配置，不会绕过权限模式或注入额外能力。
      </li>
    </ul>
    <p>常见问题对照：</p>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>原因</th>
          <th>处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>到点了但没执行</td>
          <td>应用没运行，或会话有排队/运行中的 turn 被跳过，或任务被停用/暂停</td>
          <td>
            看任务的 <code>status</code>、<code>lastError</code> 与 <code>nextRunAt</code>
            ，确认应用在运行
          </td>
        </tr>
        <tr>
          <td>任务突然自己停了</td>
          <td>
            单次任务已执行、达到 <code>maxExecutions</code>、或会话归档被暂停
          </td>
          <td>检查任务状态；归档场景取消归档后会恢复</td>
        </tr>
        <tr>
          <td>Cron 保存失败</td>
          <td>表达式不是 5 字段或无法解析</td>
          <td>
            改成标准 5 字段，例如 <code>0 9 * * *</code>
          </td>
        </tr>
        <tr>
          <td>Agent 说建好了但找不到</td>
          <td>任务建在别的会话（Agent 工具只作用于当前会话）</td>
          <td>在当前会话的「计划任务」面板里查；会话面板只显示本会话任务</td>
        </tr>
        <tr>
          <td>想跨会话复用同一套计划</td>
          <td>会话任务绑定创建它的会话</td>
          <td>用侧栏「定时任务」的全局任务（会新建会话），或每个会话各建一份</td>
        </tr>
      </tbody>
    </table>
  </>
)

const page: DocsPageContent = {
  slug: 'session-scheduled-tasks',
  toc: [
    { id: 'scope', title: '1. 会话级作用域', level: 2 },
    { id: 'entries', title: '2. 两个入口，别搞混作用域', level: 2 },
    { id: 'entry-session', title: '2.1 会话工具栏：只管理本会话', level: 3 },
    { id: 'entry-global', title: '2.2 侧栏「定时任务」：全局任务', level: 3 },
    { id: 'fields', title: '3. 字段与默认值', level: 2 },
    { id: 'triggers', title: '4. 三种触发方式', level: 2 },
    { id: 'agent-tools', title: '5. Agent 自助管理', level: 2 },
    { id: 'engine', title: '6. 调度引擎的行为', level: 2 },
    { id: 'engine-concurrency', title: '6.1 并发与会话忙', level: 3 },
    { id: 'engine-retry', title: '6.2 重试', level: 3 },
    { id: 'engine-lifecycle', title: '6.3 生命周期与错过的运行', level: 3 },
    { id: 'prompt', title: '7. 触发时注入了什么', level: 2 },
    { id: 'rules', title: '8. 使用规范与排查', level: 2 },
  ],
  faq: [
    {
      question: '定时任务触发时会新开一个会话吗？',
      answer:
        '会话任务不会。它绑定创建它的会话，触发时在原会话里排一轮 turn（内部标记 turnSource=scheduled_task、消息默认隐藏），沿用会话当时的 Agent、模型、权限和工作区。侧栏「定时任务」里的全局任务相反：它会新建一个会话。',
    },
    {
      question: '轮询间隔最小能设多少？',
      answer:
        '会话任务 10 秒（校验文案就是 interval must be at least 10 seconds），Agent 工具上限 31536000 秒。但轮询场景建议 ≥ 60 秒：每次触发都是一轮真实的模型调用。',
    },
    {
      question: 'Agent 能自己管理定时任务吗？',
      answer:
        '能。Agent 通过 mcp__spark_platform__session_schedule_{list,get,create,update,delete} 管理当前会话的任务，参数里没有 sessionId——绑定由运行时提供，不接受模型传入的会话 id。任务完成后 Agent 需要自己 delete 清理。',
    },
    {
      question: '应用关掉的时候会补跑吗？',
      answer:
        '不会。调度器跑在桌面主进程里、每秒 tick，应用关闭期间到点的任务在下次启动时会被跳过：周期任务挪到下一个未来时间点，错过的单次任务直接停用。',
    },
    {
      question: '会话正在执行别的任务时，定时任务会排队还是被跳过？',
      answer:
        '默认会跳过：skipIfSessionRunning 默认 true，只要会话有运行中或排队中的 turn，本次触发就顺延。单次任务顺延 60 秒后重试。另外 concurrencyPolicy 管的是「同一个任务的上一次执行还没跑完」这种情况，取值 skip / queue / cancel。',
    },
    {
      question: '任务里能用变量吗？',
      answer:
        '可以。任务正文支持 {{date}}、{{time}}、{{taskName}}、{{triggerType}}、{{executionCount}}、{{interval}}、{{cronExpression}}、{{runAt}}、{{timezone}}、{{nextRunAt}}，触发时先替换再注入 [Scheduled Task Context]；认不出的变量保持原样。',
    },
  ],
  quickReference: [
    { key: '作用域', value: 'session（scheduled_tasks.scope=session，触发时在原会话续接）' },
    { key: '触发类型', value: 'interval / cron / once' },
    { key: 'interval 下限', value: '10 秒（建议 ≥ 60 秒）' },
    { key: '用户入口', value: '会话顶栏「计划任务」时钟按钮（有启用任务时带红点）' },
    { key: '全局入口', value: '侧栏「定时任务」（scope=global，会新建会话）' },
    {
      key: 'Agent 入口',
      value: 'mcp__spark_platform__session_schedule_{list,get,create,update,delete}',
    },
    { key: '默认超时', value: 'timeoutSeconds = 300' },
    { key: '默认并发策略', value: '会话面板与 Agent 工具写 queue；全局页/数据表默认 skip' },
    { key: '重试', value: 'maxRetries 默认 0；retryBackoff = fixed / linear / exponential' },
    { key: '历史保留', value: 'historyRetentionDays 默认 30 天' },
    { key: '调度精度', value: '主进程每 1 秒 tick；应用未运行不触发、不补跑' },
  ],
  howTo: {
    name: '在一个会话里建定时任务',
    description: '用会话面板或 Agent 工具创建 interval / cron / once 任务，并做好清理',
    totalTime: 'PT3M',
    steps: [
      '打开目标会话，点顶部工具栏的时钟图标打开「计划任务」面板',
      '点新增，填写任务名与任务正文（写清检查什么、什么算完成、没完成时怎么办）',
      '选触发类型：interval 填分钟数（面板允许 1~10080 分钟，提交时再按 10 秒下限兜底）、cron 填 5 字段表达式、once 选未来时间',
      '按需保留 skipIfSessionRunning（会话忙时跳过）与 continueOnError（会话报错后继续）',
      '保存后可在面板里启停、立即运行或删除；有启用任务时工具栏按钮会带红点',
      '在会话里给 Agent 说「完成后请删掉这个定时任务」，或让 Agent 用 session_schedule_delete 自行清理',
    ],
  },
  aiSummary:
    'Spark Work 会话内定时任务：任务存在 scheduled_tasks 表且 scope=session、绑定创建它的会话，触发时用 submitTurn 在原会话排一轮 turn（turnSource=scheduled_task、消息隐藏），因此跟随会话当时的 Agent、模型、权限与工作区；scheduled_tasks.session_id 外键为 ON DELETE CASCADE，会话归档会暂停任务、恢复归档会还原。' +
    '支持 interval（最小 10 秒，建议 ≥ 60 秒）、cron（必须 5 字段，可带 timezone，默认 system）与 once（runAt 必须在未来）三种触发；字段默认值包括 timeoutSeconds=300、maxRetries=0、retryDelaySeconds=60、retryBackoff=fixed、concurrencyPolicy=queue（会话面板与 Agent 工具）或 skip（全局页/数据表）、skipIfSessionRunning=true、continueOnError=true、historyRetentionDays=30、maxExecutions=0。' +
    '两个入口要分清：会话顶栏「计划任务」面板只管理本会话任务；侧栏「定时任务」是 scope=global 的全局任务，触发时会新建会话。Agent 通过 mcp__spark_platform__session_schedule_{list,get,create,update,delete} 自助管理，会话绑定由运行时提供并做归属校验，完成后必须删除任务。' +
    '调度器在主进程每秒 tick，应用不运行不触发且不补跑（错过的周期任务顺延、错过的单次任务停用）；任务正文支持 {{date}}/{{time}}/{{taskName}}/{{triggerType}}/{{executionCount}}/{{interval}}/{{cronExpression}}/{{runAt}}/{{timezone}}/{{nextRunAt}} 模板变量，并在 [Scheduled Task Context] 段落下发给 Agent。',
  Body,
}

export default page
