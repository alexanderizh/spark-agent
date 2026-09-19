import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      这一篇讲的是「一轮对话是怎么跑起来的」——你按下发送之后，消息去了哪里、为什么有时候会排队、
      队列为什么会停下来、目标模式和计划模式各自卡在什么地方等你确认。 这里覆盖三条主线：
      <strong>消息流</strong>（发送 → 排队 → 调度 → 落库）、
      <strong>目标与计划</strong>（验收契约门控、计划审批）、 以及<strong>会话级操作</strong>
      （分叉、参考会话、还原点、历史导入）。
    </p>
    <p>
      所有字段名、枚举值、界面文案与默认值都来自应用仓库的真实代码，不写代码里不存在的东西。
      凡是代码本身就自相矛盾或者存在明显缺口的地方，本文会直接点出来，并在
      <a href="#troubleshooting">18. 排查表</a>里给出判断方法。
    </p>

    <h2 id="model">1. 会话的三层模型</h2>
    <p>
      先把名词对齐。Spark 的对话不是「一个会话 = 一串消息」，而是三层：
      <strong>会话 → 轮次 → 事件</strong>。很多看起来奇怪的行为，根源都在这层结构上。
    </p>
    <table>
      <thead>
        <tr>
          <th>层</th>
          <th>承载表</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>会话 session</td>
          <td>
            <code>sessions</code>
          </td>
          <td>
            一条对话记录。状态枚举 <code>idle</code> / <code>running</code> / <code>disabled</code>{' '}
            / <code>error</code>（<code>packages/storage/migrations/024_scheduled_tasks.sql</code>
            ）。 运行态与「上次运行结果」都挂在会话上。
          </td>
        </tr>
        <tr>
          <td>轮次 turn</td>
          <td>
            <code>turn_requests</code>
          </td>
          <td>
            一次「你发一条 → Agent 回一条」。有一个 UUID 形式的 <code>turnId</code>，
            它是排队、编辑、分叉、删除的共同锚点。
          </td>
        </tr>
        <tr>
          <td>事件 event</td>
          <td>
            <code>agent_events</code>
          </td>
          <td>
            轮次内部的原子记录：<code>user_message</code>、<code>assistant_message</code>、
            <code>tool_call</code>、<code>tool_result</code>、<code>agent_status</code>、
            <code>file_change</code>、<code>checkpoint</code> 等。按 <code>seq</code> 单调递增。
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>为什么要注意这层结构：</strong>因为几乎所有「消息级」操作实际作用在
      <strong>轮次</strong>上， 而不是单条消息上。比如删除一条助手消息，数据库会把同一轮的
      <code>user_message</code> + <code>assistant_message</code> 一起删掉（见
      <a href="#delete-message">13. 删除消息</a>）。
    </p>

    <h3 id="model-turn-identity">1.1 turnId 是这一整套功能的通用语言</h3>
    <p>
      <code>turnId</code> 同时出现在这些地方，理解了它就理解了这一篇的大半：
    </p>
    <ul>
      <li>
        队列里每一项的标识（<code>SessionQueuedTurn.turnId</code>）；
      </li>
      <li>
        分叉的锚点（<code>anchorTurnId</code>，见 <a href="#fork">14. 会话分叉</a>）；
      </li>
      <li>
        编辑最后一轮的入参（<code>session:rewind-last-turn</code>）；
      </li>
      <li>删除消息时用来反查整个轮次；</li>
      <li>
        错误暂停状态里指向「是哪一轮失败」（<code>failedTurnId</code>）。
      </li>
    </ul>

    <h2 id="send">2. 发一条消息会发生什么</h2>
    <p>
      按下发送后，渲染进程调用的是 <code>session:submit-turn</code>。 主进程把它交给{' '}
      <code>SessionService.dispatchTurn()</code>，然后分三种走向。
    </p>

    <h3 id="send-channels">2.1 两个发送通道，持久性不同</h3>
    <table>
      <thead>
        <tr>
          <th>通道</th>
          <th>
            持久化 <code>turn_requests</code>
          </th>
          <th>谁在用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>session:submit-turn</code>
          </td>
          <td>
            是（<code>durable = true</code>），返回 <code>accepted: true</code>
          </td>
          <td>桌面端聊天输入框、计划批准、工作流启动</td>
        </tr>
        <tr>
          <td>
            <code>session:send-turn</code>
          </td>
          <td>
            <strong>否</strong>（<code>durable = false</code>）
          </td>
          <td>IM 远程连接收进来的消息、定时任务执行器</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>这个差异有实际后果。</strong>只有走 <code>submit-turn</code> 的轮次会写进
      <code>turn_requests</code>；应用重启后，恢复逻辑只能找回
      <code>status = 'accepted'</code> 的行。也就是说：
      <strong>IM 消息或定时任务如果恰好排在队列里， 重启后会被静默丢弃</strong>
      ——没有事件、没有报错、界面上也看不到痕迹。
    </p>

    <h3 id="send-started">
      2.2 <code>started</code> 不等于「已经在跑」
    </h3>
    <p>
      <code>SessionSendTurnResponse</code> 的注释写的是「Turn 是否立即开始执行（false
      表示排队中）」， 但代码实际语义更松：持久化路径下，会话空闲时 <code>dispatchTurn</code>{' '}
      会先把轮次
      <strong>入队</strong>，用 <code>setTimeout</code> 调度，然后立刻返回
      <code>started: true</code>。所以 <code>started: true</code> 的真实含义是
      「已受理并即将开跑」，不是「执行器已经在运行」。
    </p>
    <p>
      真正判断「在不在跑」要看 <code>session:get-queue</code> 返回的
      <code>running</code>，或者会话状态 <code>running</code>。
    </p>

    <h3 id="send-queued-bubble">2.3 排队时，你的消息气泡会消失</h3>
    <p>
      这是第一次遇到时最容易困惑的地方：发送时消息会立刻以半透明的「乐观气泡」出现，
      但如果轮次判定为排队（<code>started: false</code>），这个气泡<strong>会被移除</strong>。
    </p>
    <ul>
      <li>
        <code>commitOptimisticUserMessage(..., started=false)</code> 直接把气泡过滤掉；
      </li>
      <li>
        队列快照里出现的 <code>turnId</code> 也会让乐观气泡被剥掉；
      </li>
      <li>
        消息此时<strong>只存在于队列面板里</strong>，等轮次真正开跑、写入
        <code>user_message</code> 事件后，才作为正式消息回到对话流。
      </li>
    </ul>
    <p>所以「我发的消息不见了」通常不是丢了，而是去看队列面板（见下一节）。</p>

    <h2 id="queue-model">3. 排队：两层结构</h2>
    <p>
      队列不是一个对象，而是两层——一层在内存里，一层在数据库里。两者覆盖范围不同，
      这是理解后面所有队列行为的关键。
    </p>
    <table>
      <thead>
        <tr>
          <th>层</th>
          <th>位置</th>
          <th>持久</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>内存 FIFO</td>
          <td>
            <code>SessionService.pendingTurns</code>（
            <code>Map&lt;sessionId, PendingTurn[]&gt;</code>）
          </td>
          <td>否。进程结束即消失</td>
        </tr>
        <tr>
          <td>持久受理行</td>
          <td>
            <code>turn_requests</code> 表
          </td>
          <td>
            是，
            <strong>
              但只对 <code>session:submit-turn</code> 生效
            </strong>
          </td>
        </tr>
      </tbody>
    </table>
    <h3 id="queue-row">3.1 持久行的完整字段</h3>
    <pre>
      <code>{`turn_requests (
id             TEXT PRIMARY KEY,   -- 就是 turnId
session_id     TEXT NOT NULL,      -- FK -> sessions(id) ON DELETE CASCADE
payload_json   TEXT NOT NULL,      -- JSON.stringify(PendingTurn)
status         TEXT NOT NULL DEFAULT 'accepted',
error_message  TEXT,
created_at     TEXT NOT NULL,
updated_at     TEXT NOT NULL
)`}</code>
    </pre>
    <p>
      <code>status</code> 枚举：<code>accepted</code> / <code>running</code> /{' '}
      <code>completed</code> / <code>failed</code> / <code>cancelled</code>。 轮次进入终态时{' '}
      <code>payload_json</code> 会被清空成 <code>'{}'</code>， 所以
      <strong>事后无法从这张表回读出当时的消息原文</strong>。
    </p>
    <div className="docs-callout">
      <p>
        <strong>注意：</strong>
        <code>status</code> 只在轮次排队到开跑这段时间代表「队列」。 一旦开跑就变成{' '}
        <code>running</code>，终态后只剩一条历史记录。 它不是一张「消息表」。
      </p>
    </div>

    <h2 id="queue-panel">4. 队列面板能做什么</h2>
    <p>
      队列面板出现在输入框上方。默认可折叠，折叠按钮文案是
      <code>显示队列</code> / <code>隐藏队列</code>，带当前条数。 并且
      <strong>只在瞬间上有两条以上排队项时</strong>才显示头部的拖拽提示与「清空队列」按钮。
    </p>

    <h3 id="queue-actions">4.1 单项操作</h3>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>提示文案</th>
          <th>真实行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>拖拽手柄</td>
          <td>
            <code>拖动调整任务顺序</code>
          </td>
          <td>基于 dnd-kit 的纵向排序，拖动阈值 6px</td>
        </tr>
        <tr>
          <td>编辑</td>
          <td>
            <code>编辑</code>
          </td>
          <td>
            把内容/附件/参考会话<strong>回填到输入框</strong>，然后取消该排队项。
            需要你重新按发送——会生成一个<strong>新的 turnId</strong>
          </td>
        </tr>
        <tr>
          <td>立即执行</td>
          <td>
            <code>立即执行</code>
          </td>
          <td>中断当前正在跑的轮次，把这一项提到最前并立即起跑</td>
        </tr>
        <tr>
          <td>移除</td>
          <td>
            <code>移除</code>
          </td>
          <td>取消该排队项</td>
        </tr>
      </tbody>
    </table>
    <p>
      每一项右侧还会显示该排队轮次<strong>起跑时将使用的模型</strong>（<code>模型：X</code> 或
      <code>Provider：X · 模型：Y</code>）。这个快照是在入队时冻结的。
    </p>

    <h3 id="queue-bulk">4.2 批量操作</h3>
    <ul>
      <li>
        头部提示 <code>拖动调整执行顺序</code>；
      </li>
      <li>
        <code>清空队列</code>（执行中显示 <code>清空中…</code>）， 提示为{' '}
        <code>取消全部排队消息，不影响当前正在执行的任务</code>——
        这句话是准确的：清空只动队列数组，不碰正在运行的执行器。
      </li>
    </ul>

    <h3 id="queue-reorder-volatile">4.3 拖拽排序在重启后会丢失</h3>
    <p>
      这是本篇最需要记住的队列行为之一。
      <code>reorderQueuedTurns</code> 只重排内存里的 <code>pendingTurns</code> 数组并广播，
      <strong>不写数据库</strong>，也不更新 <code>updated_at</code>。 而重启恢复是按{' '}
      <code>created_at ASC, id ASC</code> 重新入队的。
    </p>
    <p>
      <strong>结论：</strong>你把第 3 项拖到第 1 项，在应用本次运行期间有效；
      重启应用后顺序会回到按入队时间排列。
    </p>

    <h3 id="queue-edit-queued">4.4 「编辑」排队项后模型可能变</h3>
    <p>
      排队项在入队时冻结了一份运行配置快照。但「编辑」是把内容取回输入框、
      取消原项、由你重新发送——新轮次用的是<strong>输入框当前的</strong> Provider / 模型，
      不是原来那一项的快照。如果中间换过模型，重新发送时会用新模型。
    </p>

    <h2 id="queue-pause">5. 队列出错暂停与恢复</h2>

    <h3 id="queue-pause-trigger">5.1 什么会暂停队列</h3>
    <p>
      只有一个触发条件：出现 <code>status: 'error'</code> 的 <code>agent_status</code> 事件，
      <strong>且此时内存队列非空</strong>。
    </p>
    <p>暂停状态的结构是：</p>
    <pre>
      <code>{`SessionQueuePauseState {
reason: 'turn_error'      // 目前是单值字面量
failedTurnId?: string
errorMessage?: string
pausedAt: string
}`}</code>
    </pre>
    <div className="docs-callout">
      <p>
        <strong>容易误判的一点：</strong>下面这些情况会让队列<strong>卡住不动</strong>， 但
        <strong>不会</strong>产生暂停状态，所以<strong>不会显示任何横幅</strong>：
      </p>
      <ul>
        <li>
          有等待用户审批的计划（<a href="#plan">计划模式</a>）；
        </li>
        <li>有等待回答的提问（结构化问答闸门）；</li>
        <li>执行器忙、或全局并发已达上限。</li>
      </ul>
      <p>
        也就是说「队列没动静但也没有错误提示」是<strong>预期行为</strong>，
        需要你去处理那个前置条件，而不是等它自己恢复。
      </p>
    </div>

    <h3 id="queue-pause-ui">5.2 暂停时你会看到什么</h3>
    <p>
      队列面板顶部出现一条横幅：
      <code>当前回复出错，队列已暂停（内容未丢失）</code>。后面有两个按钮：
    </p>
    <table>
      <thead>
        <tr>
          <th>按钮</th>
          <th>悬停提示</th>
          <th>真实行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>重试</code> / <code>重试中…</code>
          </td>
          <td>
            <code>使用当前模型重试失败消息</code>
          </td>
          <td>
            从本地对话流重建那一轮的用户输入，<strong>作为新轮次重新发送</strong>， 并带{' '}
            <code>resumePausedQueue: true</code> 让它排到队首
          </td>
        </tr>
        <tr>
          <td>
            <code>跳过继续</code> / <code>继续中…</code>
          </td>
          <td>
            <code>跳过失败消息，并使用当前模型继续剩余队列</code>
          </td>
          <td>解除暂停，用当前模型路由重快照剩余队列后继续</td>
        </tr>
      </tbody>
    </table>
    <p>
      如果失败的那条消息无法安全还原（内部隐藏轮次、远程消息、或原文已取不到），
      <code>重试</code> 会被禁用，提示变成 <code>失败消息无法安全还原</code>，
      此时只能选「跳过继续」或手动重发。
    </p>

    <h3 id="queue-pause-lift">5.3 发送一条新消息也会解除暂停</h3>
    <p>
      协议注释里写的是「普通发送路径不受影响」，但代码实际上是这样的： 只要发出的是
      <strong>可见的用户轮次</strong>，就判定为「队列已恢复」， 然后解除暂停、把会话状态改回{' '}
      <code>idle</code>。<code>resumePausedQueue</code> 这个标志控制的是
      <strong>排在队首还是队尾</strong>， 不是「是否解除暂停」。
    </p>
    <p>
      所以横幅挂着的时候直接输入新消息并发送，也会让队列继续跑——新消息排在队尾。
      顺序是安全的：重快照和持久化写入都发生在解除暂停之前。
    </p>

    <h3 id="queue-pause-restart">5.4 重启后的恢复</h3>
    <p>应用启动时会跑一遍恢复，顺序是：</p>
    <ol>
      <li>
        <code>status = 'running'</code> 的行统一标记为失败，错误信息
        <code>Turn interrupted by application restart</code>，<strong>不重新排队</strong>；
      </li>
      <li>
        <code>status = 'accepted'</code> 的行解析回 <code>PendingTurn</code> 重新入队，
        <code>enqueuedAt</code> 取 <code>created_at</code>；
      </li>
      <li>
        对会话状态为 <code>error</code> 的会话，读最近 32 条 <code>agent_status</code> 事件，
        回溯出暂停原因并重建暂停态；
      </li>
      <li>然后调度下一轮。</li>
    </ol>
    <p>
      暂停在重启后的权威来源是<strong>会话状态</strong>（<code>sessions.status = 'error'</code>），
      而不只是内存里的闸门对象。
    </p>

    <h2 id="scheduler">6. 调度与并发</h2>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>规则</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>单会话并发</td>
          <td>
            <strong>严格 1</strong>。有活跃执行器或处于 <code>starting</code> 中间态时，
            新轮次一律入队
          </td>
        </tr>
        <tr>
          <td>全局并发</td>
          <td>
            <strong>硬编码 6</strong>（<code>DEFAULT_MAX_CONCURRENT_SESSIONS</code>）。
            每个执行器约等于一个 SDK 查询或 CLI 子进程
          </td>
        </tr>
        <tr>
          <td>跨会话公平性</td>
          <td>
            全局调度按各会话队首的 <code>enqueuedAt</code> 升序，即跨会话 FIFO
          </td>
        </tr>
        <tr>
          <td>会话内顺序</td>
          <td>纯数组顺序（FIFO），例外：出错重试排到队首</td>
        </tr>
      </tbody>
    </table>
    <p>
      全局并发 6 <strong>没有任何设置项或 IPC 可以调</strong>——它是个常量。
      如果第六个会话在跑、第七个会话的消息进来了，它就会排队等待。
    </p>
    <p>
      另外，队列<strong>没有深度上限</strong>：<code>pendingTurns</code> 和
      <code>turn_requests</code> 都不限条数。
    </p>
    <p>
      顺带区分一个容易混淆的名字：<code>skipIfSessionRunning</code> 是<strong>定时任务</strong>
      的开关，不是队列开关。它默认开启，判断「忙不忙」时会把 排队中的轮次也算作忙。
    </p>
    <h2 id="goal">7. 目标模式（Goal）与验收契约</h2>
    <p>
      目标模式让会话持续围绕一个目标自我迭代，而不是一轮一问一答。 它的核心设计是
      <strong>先定验收标准再开工</strong>——没有明确验收标准就不允许开始执行。
    </p>

    <h3 id="goal-command">
      7.1 <code>/goal</code> 命令族
    </h3>
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
            <code>/goal &lt;objective&gt;</code>
          </td>
          <td>创建目标</td>
        </tr>
        <tr>
          <td>
            <code>/goal pause</code> / <code>resume</code>
          </td>
          <td>暂停 / 恢复迭代循环</td>
        </tr>
        <tr>
          <td>
            <code>/goal clear</code>
          </td>
          <td>清除当前目标</td>
        </tr>
        <tr>
          <td>
            <code>/goal complete</code>
          </td>
          <td>手动标记完成</td>
        </tr>
        <tr>
          <td>
            <code>/goal confirm</code>
          </td>
          <td>确认验收契约，开始执行</td>
        </tr>
        <tr>
          <td>
            <code>/goal reject</code>
          </td>
          <td>拒绝验收契约，目标被清除</td>
        </tr>
        <tr>
          <td>
            <code>/goal status</code> 或裸 <code>/goal</code>
          </td>
          <td>查看当前目标状态</td>
        </tr>
      </tbody>
    </table>
    <p>
      目标存在 <code>session_goals</code> 表里，状态枚举共 7 个：
      <code>active</code> / <code>paused</code> / <code>completed</code> / <code>failed</code> /{' '}
      <code>cleared</code> / <code>stopped_by_budget</code> / <code>pending_contract</code>
      。其中前四个是「当前目标」的判定集合。
    </p>

    <div className="docs-callout">
      <p>
        <strong>命令解析的坑（务必知道）：</strong>
        <code>/goal</code> 的处理器用
        <code>action = cmd.subcommand ?? cmd.args[0]</code> 来取动作， 而命令解析器
        <strong>永远不会产生 subcommand</strong>——
        <code>parseCommand</code> 里那行是 <code>args.length &gt; 0 ? undefined : undefined</code>，
        恒为 <code>undefined</code>。
      </p>
      <p>
        后果：<strong>目标描述的第一个词如果恰好是控制词，就会被当成子命令执行。</strong>
        例如 <code>/goal clear all TODOs</code> 会直接<strong>清除当前目标</strong>，
        <code>/goal complete the docs</code> 会直接标记完成。
      </p>
      <p>
        规避：目标描述避免以 <code>pause</code> / <code>resume</code> / <code>clear</code> /{' '}
        <code>complete</code> / <code>confirm</code> / <code>reject</code> / <code>status</code>{' '}
        这几个词开头，或者换个说法（如 <code>/goal 清理所有 TODO</code>）。
      </p>
    </div>

    <h3 id="goal-contract">7.2 验收契约门控</h3>
    <p>
      触发条件是<strong>唯一的</strong>：运行模式为 <code>spark-loop</code>（默认）
      <strong>且</strong>没有显式提供 <code>successCriteria</code>。
    </p>
    <p>
      因为 <code>/goal</code> 命令只能传「目标描述 + 附件」，传不了验收标准， 所以
      <strong>从界面创建的目标都会走契约门控</strong>。流程是：
    </p>
    <ol>
      <li>
        目标状态置为 <code>pending_contract</code>；
      </li>
      <li>
        发出一条 <code>goal_contract_drafting</code> 事件；
      </li>
      <li>
        跑一次<strong>隐藏轮次</strong>起草契约（该轮次在对话流里显示为
        <code>目标模式：生成验收标准</code>）；
      </li>
      <li>起草提示词明确要求「先不要动手实现」，并必须以一个机器可读代码块结尾。</li>
    </ol>
    <p>契约块的格式是固定的三行：</p>
    <pre>
      <code>
        {
          '```spark-goal-contract\nsuccess_criteria: <逗号分隔的可验收条件>\nconstraints: <逗号分隔的约束，可为空>\nvalidation: <逗号分隔的验证命令，可为空>\n```'
        }
      </code>
    </pre>
    <p>
      <strong>解析规则</strong>（这些细节决定了契约能不能被识别）：
    </p>
    <ul>
      <li>
        正则不区分大小写、非贪婪——<strong>第一个结束围栏就收尾</strong>；
      </li>
      <li>
        键名大小写不敏感并去空格；<code>success_criteria</code> 也接受
        <code>successcriteria</code> 这种连写；
      </li>
      <li>值是逗号切分、去空格、去空项；</li>
      <li>
        每行以<strong>第一个冒号</strong>切分键值，所以行首的 <code>-</code> 项目符号会 让这一行
        <strong>被静默忽略</strong>；
      </li>
      <li>
        <strong>
          没有 <code>success_criteria</code> 或它为空 → 整个契约解析失败
        </strong>
        。 失败后目标
        <strong>
          停留在 <code>pending_contract</code>
        </strong>
        ，<code>goal_contract_proposed</code> 事件也不会发出。
      </li>
    </ul>
    <p>
      另外，<code>validation.checklist</code> 这个字段虽然类型和卡片里都有， 但
      <strong>没有任何代码会写入它</strong>——契约解析器只产出 <code>commands</code>。
      所以契约卡片上的「检查清单」区块实际上不会出现。
    </p>

    <h3 id="goal-contract-card">7.3 契约卡片</h3>
    <p>
      契约起草完成后，对话流里出现一张内联卡片，标题是
      <code>目标验收契约</code>，右上角徽标三态：
      <code>待确认</code> / <code>已确认</code> / <code>已拒绝</code>。
    </p>
    <p>
      卡片按字段展示：<code>目标</code>、<code>验收标准</code>、<code>约束</code>、
      <code>验证命令</code>、<code>检查清单</code>（后者不会出现，见上）。
    </p>
    <table>
      <thead>
        <tr>
          <th>按钮</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>拒绝</code>（执行中显示 <code>清除中…</code>）
          </td>
          <td>
            取消当前运行中的执行器，目标置为 <code>cleared</code>，不启动循环
          </td>
        </tr>
        <tr>
          <td>
            <code>确认并开始执行</code>（执行中显示 <code>启动中…</code>）
          </td>
          <td>
            校验验收标准非空 → 状态置 <code>active</code> → 发 <code>goal_started</code> →
            启动迭代循环
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      如果点确认时契约缺验收标准，会提示
      <code>契约缺少验收标准或已失效，未能启动目标。</code>，目标
      <strong>继续停在 pending_contract</strong>。
    </p>
    <p>
      会话的 Git 面板里也有一份目标区块，按钮文案不同： 待确认时是 <code>确认契约</code> /{' '}
      <code>拒绝</code>， 之后是 <code>暂停</code>、<code>恢复</code>（或预算停止后显示{' '}
      <code>继续</code>）、
      <code>完成</code>、<code>清除</code>。
    </p>

    <h3 id="goal-status-block">
      7.4 <code>spark-goal-status</code> 块
    </h3>
    <p>目标进入执行循环后，每一轮迭代的提示词都要求模型以这样一个块结尾：</p>
    <pre>
      <code>
        {
          '```spark-goal-status\nstatus: continue|completed|blocked|failed\nphase: review|act|validate\nsummary: <一句话>\nevidence: <逗号分隔的证据>\nnext_step: <下一步或留空>\n```'
        }
      </code>
    </pre>
    <p>
      <strong>
        <code>status</code> 只接受这四个值
      </strong>
      ——写成别的（或漏写）会导致整块被丢弃， 本轮<strong>什么记录都不会产生</strong>。
    </p>
    <table>
      <thead>
        <tr>
          <th>解析到的 status</th>
          <th>目标状态变化</th>
          <th>发出的事件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>continue</code>
          </td>
          <td>
            不变（仍 <code>active</code>）
          </td>
          <td>
            <code>goal_progress</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>completed</code>
          </td>
          <td>
            <code>completed</code>
          </td>
          <td>
            <code>goal_completed</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>failed</code>
          </td>
          <td>
            <code>failed</code>，并写入 <code>last_error</code>
          </td>
          <td>
            <code>goal_failed</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>blocked</code>
          </td>
          <td>
            <strong>
              <code>paused</code>
            </strong>
            （不是单独的状态）
          </td>
          <td>
            <code>goal_paused</code>
          </td>
        </tr>
        <tr>
          <td>缺失或非法</td>
          <td>不变</td>
          <td>无</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>phase</code> 写错不会导致整块失败——会被<strong>静默强制成</strong> <code>validate</code>
      。界面上的阶段文案是<code>复盘</code> / <code>执行</code> / <code>验证</code>。
    </p>
    <p>
      这个块只在轮次<strong>正常完成</strong>（<code>completed</code>）时才会被解析； 轮次以{' '}
      <code>error</code> 或 <code>cancelled</code> 结束时不会走这段后处理。
    </p>

    <h3 id="goal-vs-queue">7.5 目标与队列的关系</h3>
    <p>
      目标激活（<code>active</code> 且 <code>spark-loop</code>）时，<strong>用户消息会排队</strong>
      ， 不会插进迭代中间。下一个迭代开始时，队列里的消息会被「排空」并注入到迭代提示词里，
      标注为「上一轮迭代以来收到的补充指令（当作目标更新，不是重置）」。
    </p>
    <p>
      能被注入的只有<strong>纯文本用户轮次</strong>，以下情况会留在队列里等正常执行：
    </p>
    <ul>
      <li>
        命令轮次（<code>/</code> 开头的命令）；
      </li>
      <li>隐藏轮次（内部自动执行的）；</li>
      <li>
        带附件的、带 Skill 的、带参考会话的、带 <code>@</code> 指定 Agent 的；
      </li>
      <li>运行时配置（Agent / 适配器 / 权限模式 / 推理强度等）与基线不一致的。</li>
    </ul>
    <p>
      每次迭代最多注入 <strong>8 条</strong>消息，每条截断到 <strong>2000 字符</strong>。
    </p>
    <p>
      另外，<strong>只要存在「当前目标」，就不能修改会话的工作流绑定</strong>， 提示是
      <code>当前目标仍在进行中，暂时不能修改工作流。</code>
      注意 <code>pending_contract</code> 也算「当前目标」——契约没确认前同样改不了工作流。
    </p>

    <h2 id="goal-budget">8. 目标的预算与熔断</h2>
    <p>
      默认预算是 <code>{'{ maxConsecutiveFailures: 3, noProgressLimit: 3 }'}</code>，
      <strong>不设轮次上限、不设运行时长上限、不设费用上限</strong>——
      设计取向是让模型自驱跑到完成，只保留两个「卡死」熔断。
    </p>
    <table>
      <thead>
        <tr>
          <th>预算字段</th>
          <th>触发条件</th>
          <th>允许范围</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>maxIterations</code>
          </td>
          <td>本轮次迭代数 ≥ 该值</td>
          <td>1–500</td>
        </tr>
        <tr>
          <td>
            <code>maxRuntimeMinutes</code>
          </td>
          <td>扣除暂停时长后的运行分钟数 ≥ 该值</td>
          <td>1–10080</td>
        </tr>
        <tr>
          <td>
            <code>maxBudgetUsd</code>
          </td>
          <td>会话用量账本累计费用 ≥ 该值</td>
          <td>0–10000</td>
        </tr>
        <tr>
          <td>
            <code>maxConsecutiveFailures</code>
          </td>
          <td>
            末尾连续 <code>failed</code> / <code>blocked</code> / <code>paused</code> 条目 ≥ 该值
          </td>
          <td>1–50</td>
        </tr>
        <tr>
          <td>
            <code>noProgressLimit</code>
          </td>
          <td>
            末尾连续无证据且 <code>next_step</code> 未变的 <code>continue</code> 条目 ≥ 该值
          </td>
          <td>1–50</td>
        </tr>
      </tbody>
    </table>
    <p>
      命中任何一个后，目标置为 <code>stopped_by_budget</code> 并发
      <code>goal_budget_stopped</code> 事件，之后<strong>不会自动继续</strong>——
      需要你手动恢复，恢复后开始一个新的预算周期。
    </p>
    <div className="docs-callout">
      <p>
        <strong>一个真实的缺口：</strong>两个默认熔断（连续失败、无进展）的计数
        <strong>完全来自进度日志</strong>，而进度日志只在「轮次正常完成 + 解析到合法
        <code>spark-goal-status</code> 块」时才会追加。
      </p>
      <p>
        因此如果模型始终不产出合法状态块，或者每一轮都以 <code>error</code> / <code>cancelled</code>{' '}
        结束，进度日志就一直不变，<strong>五个判断全部为假， 循环会一轮接一轮地跑下去</strong>。
      </p>
      <p>
        队列的错误暂停闸门<strong>不覆盖这种情况</strong>——它只在会话队列非空时才生效。
        遇到疑似空转，请手动 <code>/goal pause</code> 或 <code>/goal clear</code>。
      </p>
    </div>
    <p>
      另外提醒：<code>codex-native</code> 模式与自定义预算<strong>从界面走不到</strong>。 只有{' '}
      <code>session:set-goal</code> 这个 IPC 能传 <code>mode</code> / <code>budget</code> /{' '}
      <code>constraints</code>，而<strong>渲染进程没有任何地方调用它</strong>。
      实际用起来，所有目标都是 <code>spark-loop</code> + 上面的默认预算。
    </p>

    <h2 id="plan">9. 计划模式审批</h2>
    <p>
      在 <code>claude-plan</code> 模式下，Agent 不会直接动手：它先调研、产出一份实施计划、
      提交，然后<strong>立即停止</strong>等你审批。
    </p>
    <h3 id="plan-events">9.1 事件</h3>
    <ul>
      <li>
        <code>plan_proposed</code>：携带 Markdown 格式的计划文本。当前轮次<strong>就此结束</strong>
        （状态 <code>completed</code>），不会再调用工具。
      </li>
      <li>
        <code>plan_rejected</code>：拒绝是一个「已决议」标记，会写入事件流。
        历史回放（切换会话、重开会话）时据此清掉待审批状态，
        <strong>避免已拒绝的计划重新弹出审批面板</strong>。
      </li>
    </ul>
    <p>
      计划文本的来源有两处：优先取工具入参里的 <code>plan</code> 字段； 新版 CLI 是把计划写到{' '}
      <code>.claude/plans/*.md</code> 文件，这时会回退到 本轮的<strong>计划文件内容</strong>
      。完全相同的重复提交会被折叠。
    </p>

    <h3 id="plan-panel">9.2 审批面板</h3>
    <table>
      <thead>
        <tr>
          <th>按钮</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>批准执行</code>
          </td>
          <td>
            以 <code>批准上述计划。请按如下计划继续执行：</code> + 计划正文发出一条新轮次， 带{' '}
            <code>permissionMode: claude-auto-edits</code> 与 <code>interruptActive: true</code>
            （中断当前 loop 立即起跑）， 同时把本地默认权限模式切到自动执行
          </td>
        </tr>
        <tr>
          <td>
            <code>拒绝</code>
          </td>
          <td>
            调用 <code>session:reject-plan</code>，解除审批闸门并写入 <code>plan_rejected</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>编辑</code> → <code>保存编辑</code>
          </td>
          <td>就地编辑计划文本后再批准（即「编辑后批准」）</td>
        </tr>
        <tr>
          <td>
            <code>恢复原计划</code>
          </td>
          <td>编辑过之后才出现，把文本还原成 Agent 原稿</td>
        </tr>
        <tr>
          <td>
            <code>放弃修改</code>
          </td>
          <td>退出编辑态</td>
        </tr>
      </tbody>
    </table>
    <p>
      批准成功的提示是<code>计划已批准，已切换为自动执行模式</code>； 拒绝的提示是
      <code>已拒绝计划，未执行</code>。
    </p>

    <h3 id="plan-gate">9.3 审批闸门会阻塞队列</h3>
    <p>
      存在待审批计划时，会话被加入一个「等待计划审批」集合，
      <strong>队列不会自动推进</strong>。这个闸门在三个地方被检查：
      队列调度、全局调度、以及轮次结束后的续跑判断。
    </p>
    <p>闸门的解除方式有两条，任选其一即可：</p>
    <ul>
      <li>
        调用 <code>session:reject-plan</code> 拒绝计划；
      </li>
      <li>
        直接切换权限模式——代码把「切换 permissionMode」视为用户已做出选择，
        会顺带解除闸门并推进队列。
      </li>
    </ul>
    <p>
      这是个<strong>很实用的逃生口</strong>：如果计划面板因为某种原因点不动了，
      在输入框切一下权限模式，被卡住的队列就会继续跑。
    </p>
    <p>
      注意拒绝后<strong>不需要你补发一条消息</strong>——闸门解除时就会去调度队列。
    </p>
    <h2 id="message-actions">10. 消息级操作</h2>
    <p>
      把鼠标悬停到任意一条消息上，会出现一条操作栏。操作栏在鼠标移入前
      <code>opacity: 0</code> 且 <code>pointer-events: none</code>， 用户消息靠右、助手消息靠左。
      <strong>进入多选模式时整条栏会被隐藏。</strong>
    </p>

    <h3 id="hover-bar">10.1 悬停操作栏</h3>
    <p>
      按钮的渲染顺序是固定的，但<strong>是否出现取决于消息角色</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>按钮</th>
          <th>提示文案</th>
          <th>出现条件</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>重发</td>
          <td>
            <code>重发</code>
          </td>
          <td>仅用户消息</td>
          <td>
            把文本 + 附件 + 参考会话<strong>回填到输入框</strong>，<strong>不会自动发送</strong>
          </td>
        </tr>
        <tr>
          <td>复制</td>
          <td>
            <code>复制</code>
          </td>
          <td>有文本内容时</td>
          <td>写剪贴板，1.5 秒内图标变成对勾</td>
        </tr>
        <tr>
          <td>编辑消息</td>
          <td>
            <code>编辑消息</code>
          </td>
          <td>
            仅<strong>最后一轮</strong>的用户消息
          </td>
          <td>就地进入行内编辑器</td>
        </tr>
        <tr>
          <td>从此处分支</td>
          <td>
            <code>从此处分支</code>
          </td>
          <td>
            仅助手消息，且是<strong>轮次末尾</strong>且非流式中
          </td>
          <td>打开分叉对话框</td>
        </tr>
        <tr>
          <td>删除</td>
          <td>
            <code>删除</code>
          </td>
          <td>用户消息或非流式助手消息</td>
          <td>硬删除数据库事件</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>助手消息没有「编辑」和「重发」，这是设计如此</strong>—— 你只能编辑自己发出去的内容。
    </p>
    <p>
      值得强调：<strong>「重发」和「重试」都不会自动重跑</strong>。
      悬停栏的重发、发送失败气泡上的重试、错误卡片上的重新尝试，
      走的都是同一条路径：把内容塞回输入框并聚焦，等你按发送。 失败的那一轮仍然留在历史里。
    </p>
    <p>
      另外，<strong>没有「重新生成」这个功能</strong>——应用里不存在这个动作。
    </p>

    <h3 id="context-menu">10.2 右键菜单</h3>
    <p>右键消息弹出的菜单结构是固定的，用户消息和助手消息使用同一套构建逻辑：</p>
    <table>
      <thead>
        <tr>
          <th>顺序</th>
          <th>菜单项</th>
          <th>出现条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <code>复制图片</code>
          </td>
          <td>仅当指针正好在图片上</td>
        </tr>
        <tr>
          <td>2</td>
          <td>
            <code>复制内容</code> / <code>复制选中</code>
          </td>
          <td>总是</td>
        </tr>
        <tr>
          <td>3</td>
          <td>
            <code>回复</code> / <code>引用选中</code>
          </td>
          <td>总是</td>
        </tr>
        <tr>
          <td>4</td>
          <td>
            <code>多选</code>
          </td>
          <td>总是</td>
        </tr>
        <tr>
          <td>5</td>
          <td>
            <code>删除</code>（危险样式）
          </td>
          <td>总是</td>
        </tr>
      </tbody>
    </table>
    <p>
      菜单项点击后<strong>立即执行并关闭菜单</strong>，没有二级确认。
      另外在消息气泡之外的普通文本选区上右键，会多出一个<code>引用对话</code>
      ，用于把选中的文字带进下一轮。
    </p>

    <h3 id="multi-select">10.3 多选</h3>
    <p>从右键菜单进入多选后，出现一条工具栏：</p>
    <ul>
      <li>
        左侧计数：<code>已选 N 条</code>；
      </li>
      <li>
        <code>全选</code> —— 注意它<strong>故意排除仍在流式输出的消息</strong>；
      </li>
      <li>
        <code>全不选</code>；
      </li>
      <li>
        <code>复制</code>（成功后变 <code>已复制</code>）——批量复制格式是
        <code>发言对象：正文</code>，条目之间空行分隔；
      </li>
      <li>
        <code>删除</code>（危险样式）；
      </li>
      <li>
        <code>取消</code>。
      </li>
    </ul>

    <h3 id="optimistic-bubble">10.4 乐观气泡与发送失败</h3>
    <p>
      发送时先插入一个<strong>乐观气泡</strong>再发请求，这样界面不会卡顿。 它的状态机是：
    </p>
    <table>
      <thead>
        <tr>
          <th>状态</th>
          <th>发生时机</th>
          <th>气泡表现</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>submitting</code>
          </td>
          <td>刚发出请求</td>
          <td>正常显示</td>
        </tr>
        <tr>
          <td>
            <code>accepted</code>
          </td>
          <td>轮次已受理并开跑</td>
          <td>与落库消息合并，不重复显示</td>
        </tr>
        <tr>
          <td>—</td>
          <td>
            轮次被判定为排队（<code>started: false</code>）
          </td>
          <td>
            <strong>气泡被移除</strong>，只存在于队列面板
          </td>
        </tr>
        <tr>
          <td>
            <code>failed</code>
          </td>
          <td>请求抛错</td>
          <td>
            <strong>气泡保留</strong>，显示<code>发送失败 · &lt;错误&gt;</code>与一个
            <code>重试</code>按钮
          </td>
        </tr>
        <tr>
          <td>
            <code>cancelled</code>
          </td>
          <td>你手动取消</td>
          <td>按时间戳锚定位置，不会被挤到列表底部</td>
        </tr>
      </tbody>
    </table>
    <p>
      发送失败时输入框里的草稿会<strong>恢复</strong>，所以内容不会丢。
    </p>

    <h2 id="internal-turns">11. 内部轮次的可见性</h2>
    <p>
      定时任务、目标迭代、命令续跑这些<strong>系统自动发起</strong>的轮次也会进对话流，
      但它们的输入提示词通常不应该给你看。处理规则是「<strong>投影式脱敏</strong>」：
      只在渲染时替换，<strong>不改动原始数据</strong>。
    </p>
    <table>
      <thead>
        <tr>
          <th>轮次来源</th>
          <th>对话流里显示的标签</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>scheduled_task</code>
          </td>
          <td>
            <code>定时任务自动执行</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>goal_contract_draft</code>
          </td>
          <td>
            <code>目标模式：生成验收标准</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>goal_iteration</code>
          </td>
          <td>
            <code>目标模式自动执行</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>command_follow_up</code>
          </td>
          <td>
            <code>命令自动执行</code>
          </td>
        </tr>
        <tr>
          <td>其他</td>
          <td>
            <code>内部任务自动执行</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>具体投影规则：</p>
    <ul>
      <li>
        如果轮次提供了<strong>安全的展示文本</strong>（<code>userMessageDisplayContent</code>），
        原始内容块会被替换成这段文本；
      </li>
      <li>
        如果标记为隐藏<strong>且</strong>没有安全展示文本，这条用户消息
        <strong>从对话流里整条消失</strong>（助手回复仍然保留）；
      </li>
      <li>
        提示词检查器里，取不到安全文本时统一显示
        <code>内部提示已隐藏</code>；
      </li>
      <li>历史上 Telegram 远程连接的固定提示词前缀会被专门脱敏。</li>
    </ul>

    <h2 id="edit-last-turn">12. 编辑最后一轮消息</h2>
    <p>
      <strong>只能编辑最后一轮</strong>。这不是限制没做完，而是刻意的设计：
      编辑采用的是「前缀回退并删除被替换轮」的做法，如果允许编辑历史中间某一轮，
      就必须处理「后面那些轮怎么办」——当前实现选择直接拒绝。
    </p>
    <p>
      行内编辑器的键盘约定：<code>Enter</code> 提交、<code>Shift+Enter</code> 换行、
      <code>Esc</code> 取消；按钮是 <code>取消</code> / <code>发送</code>
      （提交中显示 <code>发送中…</code>）。
    </p>

    <h3 id="edit-what-happens">12.1 点发送之后到底发生了什么</h3>
    <p>
      调用 <code>session:rewind-last-turn</code>，它会<strong>先删后发</strong>：
    </p>
    <ol>
      <li>
        删除该轮<strong>全部</strong> <code>agent_events</code>；
      </li>
      <li>
        删除该轮的 <code>turn_requests</code> 记录；
      </li>
      <li>
        删除该轮的 <code>turn_perf_metrics</code>；
      </li>
      <li>轮转 Codex 原生线程代号、清空 Spark 账本绑定；</li>
      <li>删除该会话的全部摘要；</li>
      <li>
        会话状态置回 <code>idle</code> 并清掉「上次运行结果」；
      </li>
      <li>最后才用新文本发出新轮次。</li>
    </ol>
    <p>
      渲染进程会收到一条 <code>transcript_retraction</code> 事件，据此把这一轮从本地列表里摘掉。
    </p>
    <div className="docs-callout">
      <p>
        <strong>没有二次确认。</strong>整条链路上不存在任何确认弹窗—— 按下发送（或
        Enter）就直接执行删除。这是一个<strong>不可撤销</strong>的操作。
      </p>
      <p>
        <strong>工作区文件不会被回滚。</strong>代码里明确注释了「这里故意不修改工作区文件」，
        所以编辑消息不会撤销 Agent 已经改过的文件，只是把对话历史退掉。
      </p>
    </div>

    <h3 id="edit-guards">12.2 会被拒绝的情况</h3>
    <table>
      <thead>
        <tr>
          <th>拒绝原因</th>
          <th>提示文案</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>会话正在运行或有活跃执行器</td>
          <td>
            <code>Agent 正在执行，请结束本轮后再编辑消息</code>
          </td>
        </tr>
        <tr>
          <td>
            队列里还有 <code>accepted</code> / <code>running</code> 的轮次
          </td>
          <td>
            <code>会话仍有待处理消息，请先处理或清空队列</code>
          </td>
        </tr>
        <tr>
          <td>不是最后一轮用户消息</td>
          <td>
            <code>只能编辑当前会话最后一轮用户消息</code>
          </td>
        </tr>
        <tr>
          <td>轮次是内部隐藏轮次</td>
          <td>
            <code>内部续轮消息不能编辑</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>一个体验上的坑：</strong>界面判断「忙不忙」时<strong>不看队列</strong>，
      所以队列里有活时编辑按钮<strong>照样显示</strong>。 你要等到敲完新文本按发送，才会收到
      <code>会话仍有待处理消息，请先处理或清空队列</code> 的报错（草稿会保留）。
    </p>

    <h2 id="delete-message">13. 删除消息</h2>
    <p>
      删除是<strong>硬删除</strong>——直接 <code>DELETE FROM agent_events</code>，
      没有软删标记、没有回收站、没有撤销。
    </p>

    <h3 id="delete-widen">13.1 删一条消息会连带整轮</h3>
    <p>
      如果你删的是 <code>user_message</code> 或 <code>assistant_message</code>， 系统会把
      <strong>同一轮的所有消息事件</strong>一起删掉，避免留下半截轮次。 纯工具事件（
      <code>tool_call</code> / <code>tool_result</code> / <code>file_change</code>）
      可以单独删，因为它们不影响轮次边界。
    </p>
    <div className="docs-callout">
      <p>
        <strong>已知的界面/数据不一致：</strong>删一条助手消息时，数据库会连带删掉同一轮的
        用户消息，但界面<strong>只移除你点的那一条</strong>。
        这个差异要等会话重新加载才会显现——那时你会发现用户消息也不见了。
      </p>
    </div>

    <h3 id="delete-vs-edit">13.2 删除是「浅」的，编辑是「深」的</h3>
    <p>
      两者对连续性数据的处理<strong>完全不同</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>动作</th>
          <th>删事件</th>
          <th>清摘要</th>
          <th>轮转原生线程</th>
          <th>清账本绑定</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>删除消息</td>
          <td>是</td>
          <td>否</td>
          <td>否</td>
          <td>否</td>
        </tr>
        <tr>
          <td>编辑最后一轮</td>
          <td>是</td>
          <td>是</td>
          <td>是</td>
          <td>是</td>
        </tr>
      </tbody>
    </table>
    <p>
      编辑路径的代码注释里写得很清楚：只删事件是不够的，否则下一轮会继续 resume 到
      包含旧轮次的上游上下文。这个论断同样适用于删除路径——但删除路径没有做这些清理。
    </p>
    <p>
      <strong>实践建议：</strong>如果你希望「这条消息及其上下文影响一起消失」， 用
      <strong>编辑</strong>而不是<strong>删除</strong>。删除更适合清掉一段不该留在记录里的内容。
    </p>
    <h2 id="fork">14. 会话分叉与血缘</h2>
    <p>
      分叉会创建一个<strong>独立的会话副本</strong>，把源会话到某个锚点为止的已完成历史
      物化复制过去。两个会话之后各自独立演进。
    </p>

    <h3 id="fork-entry">14.1 两个入口</h3>
    <table>
      <thead>
        <tr>
          <th>入口</th>
          <th>位置</th>
          <th>锚点</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>复制会话</code>
          </td>
          <td>侧栏会话右键菜单</td>
          <td>
            最后一个已完成轮次，<strong>无对话框</strong>，标题固定加后缀
          </td>
        </tr>
        <tr>
          <td>
            <code>从此处分支</code>
          </td>
          <td>助手消息悬停栏</td>
          <td>
            该消息所在轮次，<strong>弹出对话框</strong>可改标题
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      对话框标题是<code>从此处分支</code>，正文说明 「创建一个独立会话副本 ……
      将复制《某会话》从开始到第 N 轮的已完成历史」，
      底部提示「新会话会继承当前会话的工作区和运行配置，但不会继续源会话正在执行的任务」，
      确认按钮是<code>复制会话</code>。
    </p>
    <p>
      新会话标题默认是 <code>源标题 · 分支</code>，最多 200 字符。
    </p>

    <h3 id="fork-anchor">14.2 锚点是「轮次」，不是「消息」</h3>
    <p>
      虽然按钮叫「从此处分支」并挂在某条消息上，实际传的是<strong>该消息所属的 turnId</strong>
      。这带来两条重要规则：
    </p>
    <ul>
      <li>
        不指定锚点时，取<strong>最后一个已完成轮次</strong>；
      </li>
      <li>
        指定的轮次如果没有「完成」（仍在运行，或根本不存在），会直接报错
        <code>只能从已完成的会话轮次处分支；当前轮次仍在运行或不存在</code>。
      </li>
    </ul>
    <p>
      什么叫「已完成轮次」有严格定义：必须有终态 <code>agent_status</code>（<code>idle</code> /{' '}
      <code>completed</code> / <code>cancelled</code> / <code>error</code>）、 必须有用户消息、
      <strong>且该用户消息不是隐藏轮次</strong>。 所以目标迭代、定时任务这类内部轮次
      <strong>永远不会成为分叉锚点</strong>。
    </p>
    <p>
      <strong>一个反直觉的行为：</strong>源会话正在运行时也能分叉，但此时
      <strong>副本是空的</strong>——因为没有任何已完成的轮次，<code>fork_cutoff_seq</code> 为 0。
      界面会提示<code>源会话仍在运行；副本只复制到最近一个已完成轮次。</code>
    </p>

    <h3 id="fork-copy">14.3 复制了什么、没复制什么</h3>
    <p>
      <strong>复制的：</strong>
    </p>
    <ul>
      <li>
        会话行上的：<code>kind</code>、<code>project_id</code>、工作区、 规则包、权限配置，以及
        <strong>整套运行配置</strong>
        （Provider、模型、Agent 适配器、Agent、权限模式、聊天模式、推理强度）；
      </li>
      <li>
        事件白名单：用户/助手/团队成员/子代理消息、工具调用与结果、终态状态事件、
        文件变更、终端输出、产物文件、计划提案与拒绝、错误、运行时信号、重试轨迹；
      </li>
      <li>
        附件——附件是内嵌在用户消息事件里的，所以跟着一起过去，且<strong>指向同一批磁盘文件</strong>
        ；
      </li>
      <li>
        工作流<strong>绑定</strong>（会生成新的绑定实例标识，但不复制历史运行记录）。
      </li>
    </ul>
    <p>
      <strong>不复制的：</strong>
    </p>
    <table>
      <thead>
        <tr>
          <th>内容</th>
          <th>原因</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>排队中的轮次</td>
          <td>分叉事务完全不碰队列表</td>
        </tr>
        <tr>
          <td>目标状态</td>
          <td>目标按会话存储，不参与复制</td>
        </tr>
        <tr>
          <td>还原点（事件与 git ref）</td>
          <td>事件类型在复制时被显式排除，ref 按会话隔离</td>
        </tr>
        <tr>
          <td>会话摘要</td>
          <td>不复制</td>
        </tr>
        <tr>
          <td>团队运行态、任务图、交接记录</td>
          <td>不复制</td>
        </tr>
        <tr>
          <td>工作流历史运行</td>
          <td>只复制绑定，不复制 runs</td>
        </tr>
      </tbody>
    </table>
    <p>
      事件复制时会<strong>重新编号</strong>：新事件 ID、<code>seq</code> 从 0 重排、
      <code>sdkSessionId</code> 被删除；但源会话的 <code>run_id</code> 与 <code>turn_id</code>{' '}
      会保留，便于追溯。
    </p>
    <p>
      记忆<strong>不需要复制</strong>——记忆是按 user/project/agent 作用域存的，
      不是按会话，两个会话看到的是同一份。
    </p>

    <h3 id="fork-metadata">14.4 元数据会被整体继承（一个真实的坑）</h3>
    <p>
      分叉时 <code>metadata_json</code> 是<strong>原样复制</strong>的。这会带来几个副作用：
    </p>
    <ul>
      <li>
        源会话如果打过彩色标签，副本会继承标签，因而出现在<strong>置顶区</strong>—— 尽管{' '}
        <code>pinned_at</code> 已经被重置为 <code>null</code>， 但侧栏的置顶判定是「有置顶时间
        <strong>或</strong>有标签」；
      </li>
      <li>副本会继承源会话的「上次运行结果」，侧栏按结果筛选时新副本可能被错误归类；</li>
      <li>
        副本会继承 worktree 信息，于是标题栏会显示「运行在隔离 worktree」， 并且
        <strong>和源会话共用同一个物理工作目录</strong>；
      </li>
      <li>副本会继承「已开启还原点」标志，但还原点事件并没有复制——见下一节。</li>
    </ul>

    <h3 id="fork-lineage">14.5 血缘关系</h3>
    <p>
      <code>session_lineage</code> 表的字段：
    </p>
    <pre>
      <code>{`session_lineage (
child_session_id      TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
parent_session_id     TEXT NOT NULL,        -- 刻意不加外键
fork_anchor_turn_id   TEXT,
fork_cutoff_seq       INTEGER NOT NULL CHECK (fork_cutoff_seq >= 0),
source_title_snapshot TEXT NOT NULL,
created_at            TEXT NOT NULL
)`}</code>
    </pre>
    <p>
      父会话<strong>刻意不加外键</strong>：删掉源会话，副本的血缘记录仍在，
      界面显示「来源不可用」；血缘是<strong>链式</strong>的——从副本再分叉，
      指向的是副本而不是最初的根。
    </p>
    <p>
      分叉会同时写入 <code>stream:session:created</code> 事件并把新会话返回给调用方，
      两边都会做去重，不会出现重复条目。
    </p>
    <p>
      <strong>没有的功能：</strong>会话不支持导出、分享、另存为模板；
      也没有任何斜杠命令或工具能分叉会话——只有上面那两个界面入口。
    </p>

    <h2 id="references">15. 参考会话</h2>
    <p>
      参考会话让另一个会话的内容<strong>作为只读资料</strong>被当前会话引用，
      解决「我不想把两边合并成一条对话流，但希望 Agent 能读到那边的结论」。
    </p>
    <p>
      入口：侧栏会话右键菜单里的<code>添加到对话</code>。
    </p>
    <h3 id="references-fields">15.1 结构与约束</h3>
    <p>
      每条参考记录钉在源会话的<strong>某个已完成轮次边界</strong>（<code>snapshot_seq</code>），
      状态枚举 <code>active</code> / <code>revoked</code> / <code>unavailable</code>。
    </p>
    <p>
      <strong>上限是每个目标会话 10 条 active 记录</strong>，超出会报错。 这个额度是
      <strong>累计</strong>的，而界面里的选择器只检查「本次选了几条」， 并且
      <strong>界面没有任何撤销或刷新参考的入口</strong>。 因此理论上存在死路：分散在多轮里累计挂满
      10 条之后，你既加不了新的、也删不掉旧的。
    </p>
    <p>
      参考内容<strong>不会自动注入提示词</strong>。Agent 只有通过三个只读工具才能读到：
      <code>referenced_sessions_list</code>、<code>referenced_session_read</code>、
      <code>referenced_session_search</code>。
    </p>
    <p>
      另有一张 <code>session_reference_audit</code> 审计表记录
      <code>attach</code> / <code>update_snapshot</code> / <code>revoke</code> / <code>read</code>{' '}
      动作与操作者，但<strong>它只有写入方、没有读取方</strong>——
      目前没有任何界面或接口会展示这份审计。
    </p>

    <h2 id="checkpoint">16. 代码还原点</h2>
    <p>
      还原点<strong>不是会话快照</strong>，而是<strong>工作区文件系统的 git 快照</strong>， 用来撤销
      Agent 对代码的改动。两者很容易被混淆。
    </p>
    <h3 id="checkpoint-how">16.1 怎么工作</h3>
    <ul>
      <li>
        实现方式：临时索引 + <code>git add -A</code> + <code>write-tree</code> +{' '}
        <code>commit-tree</code>，然后写一个
        <code>refs/spark/checkpoints/&lt;sessionId&gt;/&lt;checkpointId&gt;</code> 引用。
        <strong>不会碰你真实的索引和 HEAD</strong>，也天然遵守 <code>.gitignore</code>。
      </li>
      <li>
        每个会话最多保留 <strong>20 个</strong>还原点，超出会被裁掉。
      </li>
      <li>
        捕获时机是<strong>每个轮次执行器开跑之前</strong>，并且要同时满足三个条件：
        会话打开了还原点开关（<strong>默认关闭</strong>）、工作区是 git 仓库、
        工作树相对上一个还原点有变化。
      </li>
      <li>
        捕获失败<strong>不会影响轮次执行</strong>，只记录日志。
      </li>
      <li>标签用的是你当轮的消息文本（截断到 80 字符）。</li>
    </ul>
    <h3 id="checkpoint-restore">16.2 还原</h3>
    <p>
      还原前会<strong>自动先做一次备份</strong>，标签是<code>还原前自动备份</code>； 然后用{' '}
      <code>git restore --source=&lt;ref&gt; --worktree -- .</code>， 这是<strong>非破坏性</strong>
      的。
    </p>
    <p>
      会被阻止的情况：工作区不再是 git 仓库、ref 已不存在、 或者
      <strong>另一个会话正用同一工作区且有活跃轮次</strong>。
    </p>
    <p>
      操作入口：<code>代码还原点</code>时间线面板、对话流里的还原点卡片， 以及{' '}
      <code>/checkpoint</code> 命令族（别名 <code>cp</code>）：
      <code>on</code> / <code>off</code> / <code>status</code> / <code>list</code> /{' '}
      <code>restore</code>。
    </p>
    <p>
      <strong>
        没有 <code>session:restore-checkpoint</code> 这样的 IPC 通道
      </strong>
      —— 还原是走斜杠命令路径执行的。
    </p>
    <div className="docs-callout">
      <p>
        <strong>与分叉的交互坑：</strong>分叉会复制「还原点已开启」这个标志， 但
        <strong>不会复制还原点事件</strong>。所以副本会显示「已开启」而时间线是空的，
        并且副本的第一个轮次会对它继承来的工作区做一次快照。
      </p>
    </div>

    <h2 id="history-import">17. 历史导入</h2>
    <p>
      「导入对话历史」把你在其他 CLI / 桌面里跑过的会话搬进 Spark， 之后可以继续对话。支持三个来源。
    </p>

    <h3 id="import-entry">17.1 三个入口</h3>
    <ul>
      <li>侧栏项目工具栏的上传图标，提示「从 Claude、Codex、ZCode 导入继续会话」；</li>
      <li>
        命令面板里的<code>导入对话历史</code>；
      </li>
      <li>
        设置 → 导入与恢复 → <code>导入</code>。
      </li>
    </ul>

    <h3 id="import-sources">17.2 扫描哪些路径</h3>
    <table>
      <thead>
        <tr>
          <th>来源</th>
          <th>路径</th>
          <th>筛选规则</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Claude Code</td>
          <td>
            <code>~/.claude/projects</code>
          </td>
          <td>
            下一级项目目录里的顶层 <code>*.jsonl</code>；排除 <code>subagents</code> 子目录
          </td>
        </tr>
        <tr>
          <td>Codex</td>
          <td>
            <code>~/.codex/sessions</code>（递归）+ <code>~/.codex/session_index.jsonl</code>
          </td>
          <td>
            只认 <code>rollout-*.jsonl</code>
          </td>
        </tr>
        <tr>
          <td>ZCode（桌面）</td>
          <td>
            <code>~/.zcode/v2/sessions/&lt;工作区哈希&gt;/&lt;任务ID&gt;.json</code>
          </td>
          <td>
            下一级哈希目录、只认 <code>*.json</code>
          </td>
        </tr>
        <tr>
          <td>ZCode（CLI）</td>
          <td>
            <code>~/.zcode/cli/db/db.sqlite</code>
          </td>
          <td>
            以只读方式打开 SQLite，从 <code>session</code> / <code>message</code> /{' '}
            <code>part</code> 表枚举
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      大文件做了保护：超过 <strong>8 MiB</strong> 的文件只读头部 512 KiB + 尾部 128 KiB 来取元信息；
      ZCode 桌面版的 JSON 因为不能截断，超过 <strong>64 MiB</strong> 会被<strong>静默跳过</strong>
      （只写日志，界面不会提示，来源仍然显示「可用」）。
    </p>

    <h3 id="import-flow">17.3 四步流程</h3>
    <ol>
      <li>
        <strong>扫描</strong>：打开即自动并行扫三个来源，画面显示
        <code>正在检索本机会话</code>，三张来源卡片分别显示
        <code>扫描会话索引</code> / <code>扫描完成</code> / <code>来源不可用</code>。
        扫描有无缓存决定是否直接跳到选择页。
      </li>
      <li>
        <strong>选择</strong>：来源页签带数量、搜索框（匹配标题、项目、 源会话
        ID、工作目录）、项目筛选、时间筛选 （<code>全部时间</code> / <code>最近 7 天</code> /{' '}
        <code>最近 30 天</code> / <code>最近 90 天</code>）、<code>显示已导入</code>复选框、
        <code>重新检索本机会话</code>。右侧预览面板可以<code>仅看用户消息</code>、
        <code>专注预览</code>，并提供<code>加载完整会话</code>。
      </li>
      <li>
        <strong>导入</strong>：显示<code>正在导入会话</code>与进度条，逐条上报
        <code>&lt;当前&gt; / &lt;总数&gt; · &lt;标题&gt;</code>。
      </li>
      <li>
        <strong>完成</strong>：显示 <code>成功导入</code> / <code>跳过（已导入）</code> /{' '}
        <code>失败</code> 三行统计，以及 <code>继续导入</code> / <code>完成</code>。
      </li>
    </ol>

    <h3 id="import-result">17.4 导入后的会话长什么样</h3>
    <ul>
      <li>
        事件会<strong>重新生成 ID、seq 从 0 重排、按用户轮次生成新的 turnId</strong>；
      </li>
      <li>
        有活动但缺终态的轮次会补一条<code>agent_status: completed</code>， 摘要文本是{' '}
        <code>Imported history turn completed</code>；
      </li>
      <li>会话的创建/更新时间会被改写成原始对话的首末时间戳，这样侧栏能按原始时间排序；</li>
      <li>
        来源信息写进元数据：<code>importedFrom</code> 加 <code>importHistory</code>（含来源、源会话
        ID、源文件、导入时间）；
      </li>
      <li>
        工作目录按原对话的 <code>cwd</code> 匹配，不存在就自动创建， 标为{' '}
        <code>projectKind: 'imported'</code>；取不到 <code>cwd</code> 时落到一个叫
        <code>导入历史</code> 的兜底工作区；
      </li>
      <li>
        Provider 按来源挑：Claude 优先本地 Claude CLI，Codex 优先本地 Codex CLI， ZCode
        按里面的提示字段分流。一个都找不到时直接报错
        <code>没有可用的 Provider，请先在「Providers」中添加</code>。
      </li>
    </ul>

    <h3 id="import-caveats">17.5 几个需要注意的点</h3>
    <ul>
      <li>
        <strong>导入后的会话在界面上没有任何标记。</strong>
        <code>importedFrom</code> 数据是写了的，也通过会话摘要暴露出来了， 但渲染进程里
        <strong>零处引用</strong>——你分不清哪条是导入的，除非点进去看内容。
      </li>
      <li>
        <strong>去重不区分来源。</strong>已导入集合是一个扁平的「源会话 ID」集合，
        不按来源分组。极小概率下不同来源的 ID 撞车，会被误判为「已导入」。
      </li>
      <li>
        <strong>扫描结果有进程级缓存，不会自动失效。</strong>
        重新打开对话框会直接复用上次结果，需要手动点<code>重新检索本机会话</code>。
      </li>
      <li>
        <strong>自己 Spark 产生的会话会出现在 Codex 页签里</strong>，
        并标记为已导入（无法再次导入）。看着奇怪，但这是刻意处理—— 避免把自己刚跑过的会话又导一遍。
      </li>
      <li>
        <strong>导入的轮次是可以编辑的。</strong>导入器不写
        <code>turnSource</code> / <code>userMessageVisibility</code>，
        而这两个字段正是「不可编辑」的判据。所以对导入会话的最后一轮做编辑，
        会把那一轮从库里真删掉再重发。
      </li>
    </ul>

    <h2 id="troubleshooting">18. 排查表</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>原因</th>
          <th>怎么办</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>发出去的消息不见了</td>
          <td>轮次判定为排队，乐观气泡被移除</td>
          <td>看输入框上方的队列面板，展开即可看到</td>
        </tr>
        <tr>
          <td>队列不动，但也没有报错横幅</td>
          <td>不是错误暂停——可能有待审批计划、待回答问题，或并发满了</td>
          <td>检查计划面板 / 待回答问题；若都没有，切一下权限模式可解除计划闸门</td>
        </tr>
        <tr>
          <td>拖拽排序重启后乱了</td>
          <td>排序只改内存，不落库</td>
          <td>重启后重新拖一次；需要严格顺序就不要重启</td>
        </tr>
        <tr>
          <td>队列卡在暂停横幅不动</td>
          <td>失败轮次需要你决定重试还是跳过</td>
          <td>
            点<code>重试</code>或<code>跳过继续</code>；直接发新消息也会解除暂停
          </td>
        </tr>
        <tr>
          <td>
            <code>重试</code>按钮是灰的
          </td>
          <td>失败消息无法安全还原（内部轮次 / 远程消息 / 原文不可取）</td>
          <td>
            用<code>跳过继续</code>，或手动重发
          </td>
        </tr>
        <tr>
          <td>重启后排队消息没了</td>
          <td>
            该轮次不是走 <code>submit-turn</code> 进来的（IM / 定时任务），没有持久行
          </td>
          <td>行为符合当前实现；重要消息建议在桌面端发送</td>
        </tr>
        <tr>
          <td>
            <code>/goal clear xxx</code> 把目标清了
          </td>
          <td>目标描述首词被当成子命令</td>
          <td>
            换个不以控制词开头的描述，例如<code>/goal 清理 xxx</code>
          </td>
        </tr>
        <tr>
          <td>契约卡片不出现</td>
          <td>
            起草轮次没产出合法的 <code>spark-goal-contract</code> 块
          </td>
          <td>
            用<code>/goal status</code>看是否停在待确认；重新起草或手动<code>/goal confirm</code>
          </td>
        </tr>
        <tr>
          <td>契约里没有验收标准</td>
          <td>
            块里缺 <code>success_criteria</code>，整块被丢弃
          </td>
          <td>缺这一项契约一律视为无效，必须重新起草</td>
        </tr>
        <tr>
          <td>目标一直跑不完</td>
          <td>模型不产出合法状态块 → 熔断计数永远不动</td>
          <td>
            手动<code>/goal pause</code>或<code>/goal clear</code>
          </td>
        </tr>
        <tr>
          <td>改不了会话的工作流</td>
          <td>存在「当前目标」，未确认的契约也算</td>
          <td>
            先<code>/goal clear</code>或完成目标
          </td>
        </tr>
        <tr>
          <td>编辑按钮点了报「仍有待处理消息」</td>
          <td>界面判断忙不忙时没看队列，后端才拦</td>
          <td>先清空队列再编辑</td>
        </tr>
        <tr>
          <td>删了一条消息，另一条也消失了</td>
          <td>删除按轮次扩大范围</td>
          <td>预期行为；不想连带就用编辑</td>
        </tr>
        <tr>
          <td>删除后 Agent 还记得旧内容</td>
          <td>删除不清理摘要与上游恢复上下文</td>
          <td>用编辑代替删除，或开新会话</td>
        </tr>
        <tr>
          <td>分叉出来的会话是空的</td>
          <td>源会话当时没有已完成轮次</td>
          <td>等一轮跑完再分叉</td>
        </tr>
        <tr>
          <td>分叉后显示「运行在隔离 worktree」</td>
          <td>元数据被整体继承</td>
          <td>预期行为；注意它与源会话共用同一物理目录</td>
        </tr>
        <tr>
          <td>加不了更多参考会话</td>
          <td>累计 10 条上限，且界面无撤销入口</td>
          <td>当前实现下无解，需要换会话或等修复</td>
        </tr>
        <tr>
          <td>还原点时间线是空的但显示已开启</td>
          <td>分叉复制了开关但没复制还原点事件</td>
          <td>在新会话里重新产生还原点</td>
        </tr>
        <tr>
          <td>大体积 ZCode 会话在列表里找不到</td>
          <td>超过 64 MiB 被静默跳过</td>
          <td>当前实现下无法导入</td>
        </tr>
        <tr>
          <td>导入后分不清哪些是导入的</td>
          <td>
            渲染进程未消费 <code>importedFrom</code>
          </td>
          <td>打开会话内容辨认；这只是展示缺失，数据是完整的</td>
        </tr>
      </tbody>
    </table>
  </>
)

const sessionFlow: DocsPageContent = {
  slug: 'session-flow',
  toc: [
    { id: 'model', title: '1. 会话的三层模型', level: 2 },
    { id: 'model-turn-identity', title: '1.1 turnId 是这一整套功能的通用语言', level: 3 },
    { id: 'send', title: '2. 发一条消息会发生什么', level: 2 },
    { id: 'send-channels', title: '2.1 两个发送通道，持久性不同', level: 3 },
    { id: 'send-started', title: '2.2 started 不等于「已经在跑」', level: 3 },
    { id: 'send-queued-bubble', title: '2.3 排队时，你的消息气泡会消失', level: 3 },
    { id: 'queue-model', title: '3. 排队：两层结构', level: 2 },
    { id: 'queue-row', title: '3.1 持久行的完整字段', level: 3 },
    { id: 'queue-panel', title: '4. 队列面板能做什么', level: 2 },
    { id: 'queue-actions', title: '4.1 单项操作', level: 3 },
    { id: 'queue-bulk', title: '4.2 批量操作', level: 3 },
    { id: 'queue-reorder-volatile', title: '4.3 拖拽排序在重启后会丢失', level: 3 },
    { id: 'queue-edit-queued', title: '4.4 「编辑」排队项后模型可能变', level: 3 },
    { id: 'queue-pause', title: '5. 队列出错暂停与恢复', level: 2 },
    { id: 'queue-pause-trigger', title: '5.1 什么会暂停队列', level: 3 },
    { id: 'queue-pause-ui', title: '5.2 暂停时你会看到什么', level: 3 },
    { id: 'queue-pause-lift', title: '5.3 发送一条新消息也会解除暂停', level: 3 },
    { id: 'queue-pause-restart', title: '5.4 重启后的恢复', level: 3 },
    { id: 'scheduler', title: '6. 调度与并发', level: 2 },
    { id: 'goal', title: '7. 目标模式（Goal）与验收契约', level: 2 },
    { id: 'goal-command', title: '7.1 /goal 命令族', level: 3 },
    { id: 'goal-contract', title: '7.2 验收契约门控', level: 3 },
    { id: 'goal-contract-card', title: '7.3 契约卡片', level: 3 },
    { id: 'goal-status-block', title: '7.4 spark-goal-status 块', level: 3 },
    { id: 'goal-vs-queue', title: '7.5 目标与队列的关系', level: 3 },
    { id: 'goal-budget', title: '8. 目标的预算与熔断', level: 2 },
    { id: 'plan', title: '9. 计划模式审批', level: 2 },
    { id: 'plan-events', title: '9.1 事件', level: 3 },
    { id: 'plan-panel', title: '9.2 审批面板', level: 3 },
    { id: 'plan-gate', title: '9.3 审批闸门会阻塞队列', level: 3 },
    { id: 'message-actions', title: '10. 消息级操作', level: 2 },
    { id: 'hover-bar', title: '10.1 悬停操作栏', level: 3 },
    { id: 'context-menu', title: '10.2 右键菜单', level: 3 },
    { id: 'multi-select', title: '10.3 多选', level: 3 },
    { id: 'optimistic-bubble', title: '10.4 乐观气泡与发送失败', level: 3 },
    { id: 'internal-turns', title: '11. 内部轮次的可见性', level: 2 },
    { id: 'edit-last-turn', title: '12. 编辑最后一轮消息', level: 2 },
    { id: 'edit-what-happens', title: '12.1 点发送之后到底发生了什么', level: 3 },
    { id: 'edit-guards', title: '12.2 会被拒绝的情况', level: 3 },
    { id: 'delete-message', title: '13. 删除消息', level: 2 },
    { id: 'delete-widen', title: '13.1 删一条消息会连带整轮', level: 3 },
    { id: 'delete-vs-edit', title: '13.2 删除是「浅」的，编辑是「深」的', level: 3 },
    { id: 'fork', title: '14. 会话分叉与血缘', level: 2 },
    { id: 'fork-entry', title: '14.1 两个入口', level: 3 },
    { id: 'fork-anchor', title: '14.2 锚点是「轮次」，不是「消息」', level: 3 },
    { id: 'fork-copy', title: '14.3 复制了什么、没复制什么', level: 3 },
    { id: 'fork-metadata', title: '14.4 元数据会被整体继承（一个真实的坑）', level: 3 },
    { id: 'fork-lineage', title: '14.5 血缘关系', level: 3 },
    { id: 'references', title: '15. 参考会话', level: 2 },
    { id: 'references-fields', title: '15.1 结构与约束', level: 3 },
    { id: 'checkpoint', title: '16. 代码还原点', level: 2 },
    { id: 'checkpoint-how', title: '16.1 怎么工作', level: 3 },
    { id: 'checkpoint-restore', title: '16.2 还原', level: 3 },
    { id: 'history-import', title: '17. 历史导入', level: 2 },
    { id: 'import-entry', title: '17.1 三个入口', level: 3 },
    { id: 'import-sources', title: '17.2 扫描哪些路径', level: 3 },
    { id: 'import-flow', title: '17.3 四步流程', level: 3 },
    { id: 'import-result', title: '17.4 导入后的会话长什么样', level: 3 },
    { id: 'import-caveats', title: '17.5 几个需要注意的点', level: 3 },
    { id: 'troubleshooting', title: '18. 排查表', level: 2 },
  ],
  faq: [
    {
      question: '队列里的消息会不会因为应用重启而丢失？',
      answer:
        '取决于它是怎么发出来的。走 session:submit-turn 的轮次会写进 turn_requests 表，重启后会按 created_at 顺序恢复。走 session:send-turn 的（IM 远程连接收进来的消息、定时任务执行器发起的）没有持久行，重启后会静默丢弃，界面上不会有任何提示。另外重启时 status 仍是 running 的轮次会被标记为失败（错误信息 Turn interrupted by application restart），不会重新排队。',
    },
    {
      question: '为什么我拖拽调整了队列顺序，重启后又变回去了？',
      answer:
        '因为队列排序只改内存里的 pendingTurns 数组，不写数据库，也不更新 updated_at。重启恢复是按 created_at ASC, id ASC 重建队列的，所以顺序会回到按入队时间排列。这是当前实现的行为，不是偶发故障。',
    },
    {
      question: '队列卡住了但没有任何错误提示，是怎么回事？',
      answer:
        '错误暂停横幅只在「出现 error 状态事件且队列非空」时才会出现。其他会让队列停滞的原因——有待审批的计划、有等待回答的提问、执行器忙或全局并发到上限——都不会产生暂停状态，因此没有任何横幅。全局并发上限是硬编码的 6，没有设置项可调。如果是计划审批导致的卡住，直接切换一下权限模式就能解除闸门并推进队列。',
    },
    {
      question: '编辑最后一条消息，之前的对话会被删掉吗？',
      answer:
        '编辑只作用于最后一轮，并且会先删除该轮的全部事件、turn_requests 记录、性能指标，轮转 Codex 原生线程代号、清空账本绑定、删除会话摘要，然后再发送新内容。整个过程没有任何二次确认。它不会回滚工作区文件——代码里明确注释了这一点，Agent 改过的文件仍然保持改动后的状态。',
    },
    {
      question: '删除一条消息和编辑一条消息有什么区别？',
      answer:
        '删除是硬删 agent_events 行，无软删标记、无撤销，而且删用户或助手消息时会连带把同一轮的所有消息事件一起删掉。但删除不做连续性清理：不轮转原生线程、不清摘要、不清账本绑定。编辑则会把这些都做掉。所以如果目的是「让这段内容及其上下文影响彻底消失」，应该用编辑而不是删除。',
    },
    {
      question: '目标模式会不会一直跑下去停不下来？',
      answer:
        '默认预算只设了两个熔断：连续失败 3 次、连续无进展 3 次，不设轮次上限、运行时长上限和费用上限。问题在于这两个熔断的计数完全依赖进度日志，而进度日志只在「轮次正常完成并且解析到合法的 spark-goal-status 块」时才追加。如果模型始终不产出合法状态块，或者每轮都以 error / cancelled 结束，计数永远不动，循环就会一直运行。队列的错误暂停闸门不覆盖这种情况，需要手动 /goal pause 或 /goal clear。',
    },
  ],
  aiSummary:
    '会话与消息流的完整实操指南：先讲清「会话 → 轮次 → 事件」三层模型与 turnId 的作用，再逐层展开消息流的真实链路（submit-turn 与 send-turn 的持久性差异、started 的真实语义、排队时消息气泡为何消失），队列的两层结构与面板操作（含「拖拽排序重启后丢失」这个真实缺口）、出错暂停与两种恢复方式、调度并发（单会话 1 / 全局硬编码 6）。目标与计划部分覆盖 /goal 命令族、验收契约门控的完整解析规则（含 success_criteria 缺失即作废）、契约卡片、spark-goal-status 块的四种状态映射、五项预算熔断及其「计数依赖进度日志」的真实缺口、计划模式审批与闸门解除。会话级操作部分覆盖消息级操作（悬停栏五个按钮的真实出现条件、右键菜单、多选、乐观气泡状态机）、编辑最后一轮的先删后发语义、删除的按轮扩大与「浅清理」、会话分叉的轮次级锚点与元数据继承坑、参考会话的 10 条上限死路、代码还原点的 git 实现，以及历史导入的四个来源路径与四步流程。文末附 20 行排查表。',
  quickReference: [
    { key: '单会话并发', value: '严格 1（有活跃执行器时新轮次一律入队）' },
    { key: '全局并发上限', value: '6（硬编码常量，无设置项可调）' },
    { key: '队列深度上限', value: '无' },
    { key: '队列排序持久性', value: '不持久，重启后按 created_at 重建' },
    { key: '持久发送通道', value: 'session:submit-turn（session:send-turn 不落库）' },
    { key: '队列暂停触发条件', value: "agent_status 事件 status='error' 且队列非空" },
    { key: '暂停状态字段', value: 'reason / failedTurnId / errorMessage / pausedAt' },
    {
      key: '目标状态枚举',
      value:
        'active、paused、completed、failed、cleared、stopped_by_budget、pending_contract（7 个）',
    },
    { key: '目标模式枚举', value: 'spark-loop、codex-native' },
    { key: '目标阶段枚举', value: 'review、act、validate' },
    {
      key: '默认目标预算',
      value: 'maxConsecutiveFailures 3 + noProgressLimit 3（无轮次/时长/费用上限）',
    },
    { key: '迭代注入消息上限', value: '8 条，每条截断 2000 字符' },
    { key: '契约块', value: 'spark-goal-contract（success_criteria 必填，缺失即整块作废）' },
    {
      key: '状态块',
      value: 'spark-goal-status（status 只接受 continue/completed/blocked/failed）',
    },
    {
      key: '计划批准',
      value: 'send-turn + permissionMode=claude-auto-edits + interruptActive=true',
    },
    { key: '消息悬停按钮', value: '重发、复制、编辑消息、从此处分支、删除' },
    { key: '可编辑范围', value: '只有最后一轮用户消息' },
    { key: '分叉锚点', value: 'turnId（不是消息 ID）' },
    { key: '分叉标题默认值', value: '「源标题 · 分支」，上限 200 字符' },
    { key: '参考会话上限', value: '每个目标会话 10 条 active' },
    { key: '还原点上限', value: '每会话 20 个，存储为 refs/spark/checkpoints/<sessionId>/<id>' },
    { key: '还原点默认状态', value: '关闭' },
    { key: '历史导入来源', value: 'claude-code、codex、zcode' },
    { key: '大文件保护', value: '扫描元信息 >8 MiB 只读头尾；ZCode 桌面版 >64 MiB 静默跳过' },
  ],
  howTo: {
    name: '让一个会话在目标模式下安全地自我迭代',
    description: '从零创建带验收契约的持久目标，并知道什么情况下该手动接管。',
    totalTime: 'PT10M',
    steps: [
      '用 /goal <目标描述> 创建目标。描述不要以 pause、resume、clear、complete、confirm、reject、status 这几个词开头，否则会被当成子命令执行。',
      '目标会进入 pending_contract 状态，并发出一条隐藏的起草轮次（对话流里显示为「目标模式：生成验收标准」）。',
      '等契约卡片出现，检查「验收标准」是否具体可验证、「验证命令」是否是能真正跑的命令。',
      '如果起草结果不合格，点「拒绝」会直接清除目标；想保留目标就重新起草，而不是点确认。',
      '点「确认并开始执行」，目标转为 active 并开始迭代。每轮结束时会向对话流写入一条迭代分隔。',
      '需要追加要求时直接发消息——目标激活期间它们会进队列，并在下一轮迭代开始时被注入（每次最多 8 条、每条 2000 字符）。',
      '注意工作流绑定在目标存在期间无法修改，未确认的契约同样会阻塞。',
      '如果发现目标一直跑不完，先 /goal pause 停下来看进度日志——两个默认熔断的计数依赖状态块，模型不输出合法块时它们不会触发。',
      '确认目标已达成后用 /goal complete 收尾；不想继续就用 /goal clear。两者都会解除工作流绑定的阻塞。',
    ],
  },
  Body,
}

export default sessionFlow
