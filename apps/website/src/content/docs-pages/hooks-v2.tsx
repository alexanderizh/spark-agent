import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Hooks 让你在 Agent
      生命周期的固定节点上自动做一件事：弹系统通知、响一声，或者调用统一工具目录里的工具。
      它由宿主确定性触发，不依赖模型在提示词里自觉调用；也已明确是<strong>观察型</strong>
      机制——动作发生在事件之后，不能改变已经发生的结果。
    </p>
    <p>
      这一页是实操手册：先分清产品里有三套叫「Hook」的东西，再讲清七个事件、条件表达式、输入映射、三种动作、
      作用域与授权、执行管线、重试与幂等，最后给出真实排查路径。
    </p>

    <h2 id="three-kinds">1. 三套 Hook：先分清你在配哪一套</h2>
    <p>
      产品里同时存在三套互不相干的机制，都叫「Hook」。混写是这一块最常见的错误，
      所以先做对照，后面各章默认只讲桌面端的 <strong>Hooks V2</strong>。
    </p>

    <h3 id="compare">1.1 三者对照</h3>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>桌面 Hooks V2</th>
          <th>经典通知（V1）</th>
          <th>spark-engine shell hooks</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>事件数</td>
          <td>7 个生命周期事件</td>
          <td>4 个固定节点</td>
          <td>4 个闭集事件</td>
        </tr>
        <tr>
          <td>事件名</td>
          <td>
            <code>turn.started</code> / <code>permission.requested</code> /{' '}
            <code>question.requested</code> / <code>response.committed</code> /{' '}
            <code>turn.completed</code> / <code>turn.failed</code> / <code>turn.cancelled</code>
          </td>
          <td>
            <code>permission_request</code> / <code>ask_user_question</code> /{' '}
            <code>session_end</code> / <code>session_fail</code>
          </td>
          <td>
            <code>UserPromptSubmit</code> / <code>PreToolUse</code> / <code>PostToolUse</code> /{' '}
            <code>Stop</code>
          </td>
        </tr>
        <tr>
          <td>动作</td>
          <td>系统通知、提示音、调用工具</td>
          <td>系统通知、提示音（布尔开关）</td>
          <td>执行 shell 命令</td>
        </tr>
        <tr>
          <td>有界面吗</td>
          <td>设置 → Hooks</td>
          <td>设置 → Hooks 底部「经典通知（兼容）」</td>
          <td>
            <strong>没有任何界面</strong>
          </td>
        </tr>
        <tr>
          <td>配置存在哪</td>
          <td>
            SQLite 四张 <code>hook_*</code> 表
          </td>
          <td>
            <code>app_settings</code> 的 <code>hooks/config</code>，回退 <code>hooks/data</code>
          </td>
          <td>
            <code>~/.spark/settings.json</code> 与项目内 <code>.spark/settings.json</code>、
            <code>.spark/settings.local.json</code>
          </td>
        </tr>
        <tr>
          <td>能改结果吗</td>
          <td>不能</td>
          <td>不能</td>
          <td>
            <strong>能</strong>：退出码 2 或 <code>&#123;"decision":"block"&#125;</code> 可拦截
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="v2-position">1.2 桌面 Hooks V2 的定位</h3>
    <p>
      协议文件开头的注释把设计边界写得很直白：首期只做<strong>观察型</strong>
      事件，即「事件发生后执行动作，不能改变已发生的结果」。
      宿主在生命周期事实落库之后再发射事件，动作失败也不会把 Turn 变成失败——Hook
      执行失败被隔离在会话主流程之外。
    </p>
    <p>
      另一条关键决策是「不依赖模型自行决定是否调用」：事件由 <code>HookLifecycleBridge</code>{' '}
      在真实业务点发射， 例如 <code>permission.requested</code> 是 <code>PermissionService</code>{' '}
      真正进入等待审批时发出的，而不是模型读提示词后选择调用的。
    </p>

    <h3 id="engine-hooks">1.3 spark-engine 的 shell hooks：一个常见盲区</h3>
    <p>
      <code>spark-engine/src/hooks/</code> 下是另一套实现：Claude Code 风格的 shell 命令 hook，
      与桌面 Hooks V2 <strong>没有共享代码，也不互相 import</strong>。它的动作配置形如命令字符串，
      单条命令上限 8192 字符，超时上限 600000 毫秒、默认 60000 毫秒，每个 matcher 最多 16
      条命令、每个事件最多 32 个 matcher。
    </p>
    <p>
      它的配置文件按 scope 升序<strong>全部执行</strong>（不是覆盖合并），matcher 数组直接拼接：
    </p>
    <pre>
      <code>
        &#123;userSettingsDir&#125;/settings.json // scope: user &lt;cwd&gt;/.spark/settings.json //
        scope: project &lt;cwd&gt;/.spark/settings.local.json // scope: local
      </code>
    </pre>
    <p>
      阻塞判定：命令退出码为 <code>2</code>，或 stdout 输出{' '}
      <code>&#123;"decision":"block"&#125;</code>，即视为拦截，并携带 reason； 输出{' '}
      <code>&#123;"decision":"approve"&#125;</code> 视为批准。任一条被拦截就立即返回，不再执行后续
      hook。其他失败一律不阻塞。
      <code>matcher</code> 只对 <code>PreToolUse</code> / <code>PostToolUse</code> 生效。
    </p>
    <p>
      <strong>最需要知道的一点</strong>：桌面端用 Spark 引擎跑会话时也会加载这套 shell hooks——
      <code>spark-engine-executor.ts</code> 调用{' '}
      <code>createDefaultEnvWithMcp(&#123; cwd: workspaceRoot &#125;)</code>， 内部{' '}
      <code>buildDefaultEnv</code> 再调 <code>loadHookRunner</code>。也就是说，
      <strong>
        项目目录下的 <code>.spark/settings.json</code> 里的 shell
        命令会被执行，而桌面端没有任何界面管理它
      </strong>
      。 排查「桌面端为什么跑了我没配的命令」时，先去项目目录看这几个文件。
    </p>
    <p>
      注意：本页后续所有「事件」「作用域」「重试」等描述，指的都是桌面 Hooks V2，不适用于这一节。
    </p>

    <h2 id="entry">2. 界面入口与一次完整配置</h2>

    <h3 id="entries">2.1 三处入口</h3>
    <table>
      <thead>
        <tr>
          <th>入口</th>
          <th>位置</th>
          <th>能做什么</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>设置 → 系统 → Hooks</td>
          <td>设置页左侧「系统」分组，排在「本地日志」与「存储与备份」之间，图标是铃铛</td>
          <td>应用级总开关、定义增删改、作用域绑定与授权、运行记录、经典通知兼容区</td>
        </tr>
        <tr>
          <td>Agent 编辑页 → Hook 区块</td>
          <td>助手 → Agents → 打开某个 Agent 后右栏</td>
          <td>只看该 Agent 的生效来源（Agent 覆盖 / 继承应用级），并就地启用、停用</td>
        </tr>
        <tr>
          <td>会话检查器 → Hooks</td>
          <td>会话右侧检查器面板内（默认收起，可展开）</td>
          <td>看当前会话的最终生效列表与覆盖关系，会话级临时停用或恢复</td>
        </tr>
      </tbody>
    </table>
    <p>
      三处的定位不同：设置页管<strong>定义</strong>，Agent 页与会话检查器管
      <strong>生效与覆盖</strong>。 一个常见误解是「在 Agent 页能新建
      Hook」——不能，那里没有新建入口，定义只能在设置页建。
    </p>

    <h3 id="settings-layout">2.2 设置页的真实结构</h3>
    <p>「设置 → Hooks」自上而下的顺序是固定的：</p>
    <ol>
      <li>
        标题 <code>Hooks</code> + 副文案「在 Agent
        生命周期的明确节点上自动执行动作：通知、提示音或统一工具目录中受治理的工具调用。」+{' '}
        <strong>应用总开关</strong>（Switch）。
      </li>
      <li>
        工具条：<strong>「新建 Hook」</strong>
        按钮，右侧提示「总开关关闭时暂停新的自动执行，已入队任务保留待恢复。」
      </li>
      <li>
        定义列表。空态文案「还没有 Hook
        定义」，并给一条示例：「例如：新建一个「回答已提交」Hook，把最终回答正文发送到 Webhook
        工具。」
      </li>
      <li>运行记录面板。</li>
      <li>「经典通知（兼容）」区块（V1 双轨区）。</li>
    </ol>
    <p>
      每条定义显示：名称、停用标记（若 <code>enabled=false</code> 会显示「定义已停用」标签）、
      副行「事件中文名 · 动作描述 · rev N」，以及「编辑」「删除」两个按钮。
    </p>
    <p>总开关切换后的提示文案是固定的两句：</p>
    <ul>
      <li>开启：「已恢复自动执行」</li>
      <li>关闭：「已暂停新的自动执行（不撤回已发生的外部副作用）」</li>
    </ul>

    <h3 id="walkthrough">2.3 七步配完一个 Hook</h3>
    <p>以下步骤与界面控件一一对应，照着做即可跑通第一个 Hook。</p>
    <ol>
      <li>
        <strong>打开 设置 → Hooks</strong>，确认顶部总开关是开启状态。
      </li>
      <li>
        <strong>点「新建 Hook」</strong>，在弹出的 Modal（宽度 720）里填名称与描述。
      </li>
      <li>
        <strong>选事件</strong>。下拉里每项长这样：<code>回答已提交 · response.committed</code>，
        选中后字段下方会显示该事件的中文说明。
      </li>
      <li>
        <strong>选动作</strong>。三个分段选项：<code>系统通知</code> / <code>提示音</code> /{' '}
        <code>调用工具</code>。 选「调用工具」时下方会出现工具下拉与输入映射区。
      </li>
      <li>
        <strong>（可选）加触发条件</strong>
        。「触发条件（可选）」折叠区里打开「仅当条件满足时执行」，
        选操作符与事件路径。需要更复杂的组合条件时见第 4 章——界面只暴露 5 个叶子操作符。
      </li>
      <li>
        <strong>（调用工具时）填输入映射</strong>。每行是一个三元组：参数名 /
        值类型（路径·常量·模板）/ 值。
        点「添加映射」继续加行。空映射时提示「暂无映射，工具将以空参数调用」。
      </li>
      <li>
        <strong>先「预览」再「创建」</strong>
        。预览只做求值、不执行动作，会显示条件判定结果与「将发送的字段」。
        保存后再去「作用域绑定」区点「添加绑定」完成授权——
        <strong>没有绑定授权的定义不会执行</strong>。
      </li>
    </ol>
    <p>
      想验证真实效果，用编辑器底部的<strong>「测试运行」</strong>。它会走完整链路并产生独立记录，
      因此会弹二次确认「执行测试运行？」，正文写明「测试运行会按当前配置真实执行动作（例如向外部工具发送数据），
      并产生独立的测试运行记录。此操作不可撤销。」。测试运行<strong>不受绑定授权门控</strong>，
      它用当前定义的快照直接入队，所以没绑定也能测，但会产生真实外部副作用。
    </p>

    <h2 id="events">3. 七个生命周期事件</h2>

    <h3 id="event-table">3.1 事件表与真实发射点</h3>
    <p>
      七个事件全部有生产发射点，没有「声明了但从不触发」的事件。触发时机都是「事实先落库，再发事件」。
    </p>
    <table>
      <thead>
        <tr>
          <th>事件</th>
          <th>界面文案</th>
          <th>何时发射</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>turn.started</code>
          </td>
          <td>Turn 开始 · Turn 已建立并准备进入执行管线</td>
          <td>Turn 注册事务持久化完成之后</td>
        </tr>
        <tr>
          <td>
            <code>permission.requested</code>
          </td>
          <td>权限请求 · 权限请求进入等待审批</td>
          <td>真实权限请求已创建并进入等待，先于推送给宿主监听器</td>
        </tr>
        <tr>
          <td>
            <code>question.requested</code>
          </td>
          <td>Agent 提问 · Agent 提问进入等待用户输入</td>
          <td>两条提问回调分支（受监督 / 无人值守）各一处</td>
        </tr>
        <tr>
          <td>
            <code>response.committed</code>
          </td>
          <td>回答已提交 · 最终回答成功落库，正文已确定</td>
          <td>assistant 消息为 complete 且 isFinal</td>
        </tr>
        <tr>
          <td>
            <code>turn.completed</code>
          </td>
          <td>Turn 完成 · Turn 成功终态已持久化</td>
          <td>状态为 completed</td>
        </tr>
        <tr>
          <td>
            <code>turn.failed</code>
          </td>
          <td>Turn 失败 · Turn 进入不可恢复失败终态</td>
          <td>状态为 error</td>
        </tr>
        <tr>
          <td>
            <code>turn.cancelled</code>
          </td>
          <td>Turn 已取消 · 用户或系统明确取消 Turn</td>
          <td>状态为 cancelled</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>response.committed</code> 与 <code>turn.completed</code>{' '}
      不能互相替代：前者是「最终可见回答成功持久化」， 后者是「Turn 成功终态持久化」。一次 Turn
      可能先发前者再发后者。
    </p>
    <p>
      还有一个细节：<code>permission.requested</code> 的 <code>turn.id</code> 可能是字符串{' '}
      <code>'unknown'</code>—— 这是全仓唯一一处把 turn 标识写成非 turnId 的地方。如果你的 Hook
      条件里按 turn.id 做匹配，需要为它留一个例外。
    </p>

    <h3 id="event-id">3.2 事件 ID 与两级去重</h3>
    <p>
      事件 ID 是<strong>确定性</strong>派生，不是随机 UUID：
    </p>
    <pre>
      <code>eventId = "hev_" + sha256(eventName + ":" + sourceId)</code>
    </pre>
    <p>各事件的稳定源 ID：</p>
    <ul>
      <li>
        <code>turn.started</code> / <code>turn.completed</code> / <code>turn.failed</code> /{' '}
        <code>turn.cancelled</code> → turnId
      </li>
      <li>
        <code>response.committed</code> → messageId
      </li>
      <li>
        <code>permission.requested</code> → requestId
      </li>
      <li>
        <code>question.requested</code> → questionId，缺省回退 requestId，再缺省才用随机 UUID
      </li>
    </ul>
    <p>这带来两级去重：</p>
    <table>
      <thead>
        <tr>
          <th>层级</th>
          <th>唯一键</th>
          <th>重复投递的行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>事件（outbox）</td>
          <td>
            <code>hook_events.event_id</code> 主键
          </td>
          <td>
            <code>INSERT OR IGNORE</code>：静默忽略，不报错、不替换、不比对内容
          </td>
        </tr>
        <tr>
          <td>运行（队列）</td>
          <td>
            <code>UNIQUE (event_id, hook_id)</code>
          </td>
          <td>已存在则返回 null，不新建。迁移注释写明「跨 revision 也不自动重跑」</td>
        </tr>
      </tbody>
    </table>
    <p>
      「不比对内容」这条要留意：即使第二次投递带着不同的
      envelope，也会被静默丢弃，原来那行的内容不会被覆盖， 也不会有任何告警。代码里没有检测「同 ID
      不同内容」的机制。
    </p>

    <h3 id="emit-shortcut">3.3 发射端短路：未使用 Hook 的应用零额外写入</h3>
    <p>
      每次要发事件前，宿主先查「这个事件有没有启用中的定义」。一个都没有就直接返回，不写 outbox。
      所以没用 Hook 的应用不会因为这套机制产生任何额外写入。
    </p>
    <p>
      注意这个短路判据是「有没有启用中的<strong>定义</strong>」，与「应用级总开关」
      <strong>无关</strong>。 总开关关闭时，只要还存在启用的定义，事件照样会写进 outbox——详见第 12
      章。
    </p>

    <h3 id="payload">3.4 每个事件能读到什么</h3>
    <p>信封（envelope）是所有条件与映射的取值来源，结构固定：</p>
    <pre>
      <code>
        &#123; "schemaVersion": 1, "eventId": "hev_...", "eventName": "turn.failed", "occurredAt":
        "2026-09-19T...", "source": "host", "session": &#123; "id": "...", "title": "..." &#125;,
        "turn": &#123; "id": "..." &#125;, "agent": &#123; "id": "...", "name": "..." &#125;,
        "workspaces": [ &#123; "id": "...", "name": "..." &#125; ], "primaryWorkspaceId": "...",
        "payload": &#123; ... &#125; &#125;
      </code>
    </pre>
    <p>各事件的 payload 形状：</p>
    <table>
      <thead>
        <tr>
          <th>事件</th>
          <th>payload</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>turn.started</code>
          </td>
          <td>
            <code>&#123;&#125;</code> 空对象
          </td>
        </tr>
        <tr>
          <td>
            <code>permission.requested</code>
          </td>
          <td>
            <code>&#123; requestId, toolName, action, riskLevel &#125;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>question.requested</code>
          </td>
          <td>
            <code>
              &#123; questionId, questions: [&#123; label?, title?, description? &#125;] &#125;
            </code>
          </td>
        </tr>
        <tr>
          <td>
            <code>response.committed</code>
          </td>
          <td>
            <code>&#123; response: &#123; messageId, finalText &#125; &#125;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>turn.completed</code> / <code>turn.failed</code> / <code>turn.cancelled</code>
          </td>
          <td>
            <code>&#123; message? &#125;</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      只有 <code>response.committed</code> 带正文，且只含<strong>最终展示正文</strong>
      ——不含推理过程、系统提示词或工具原始结果。
      <code>agent</code> 字段在某些系统维护任务里可能不存在（无可解析 Agent 时省略），
      会话不存在则整条事件不发。
    </p>

    <h2 id="condition">4. 条件表达式</h2>
    <p>
      条件决定「这个 Hook 这次要不要执行」。不匹配时不会报错，而是写一条 <code>skipped</code> +{' '}
      <code>condition_not_matched</code> 的运行记录， 让「最终生效列表」保持可解释。
    </p>

    <h3 id="path-whitelist">4.1 路径语法与白名单</h3>
    <p>
      条件与映射里读事件字段用 <code>path</code> 表达式，语法是固定正则：
    </p>
    <pre>
      <code>^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$</code>
    </pre>
    <p>
      首段必须以字母或下划线开头，后续段允许<strong>纯数字</strong>——这就是数组下标的实现方式，例如{' '}
      <code>workspaces.1.name</code>。<code>__proto__</code>、<code>constructor</code>、
      <code>$foo</code> 都会因为首段规则被判非法。
    </p>
    <p>路径必须落在白名单内，白名单由三部分组成：</p>
    <ol>
      <li>
        <strong>公共路径</strong>：<code>schemaVersion</code>、<code>eventId</code>、
        <code>eventName</code>、<code>occurredAt</code>、<code>source</code>、<code>session</code>、
        <code>turn</code>、<code>agent</code>、<code>workspaces</code>、
        <code>primaryWorkspaceId</code>，以及它们下面的常规字段。
      </li>
      <li>
        <strong>按事件划分的 payload 路径</strong>，例如 <code>turn.failed</code> 允许{' '}
        <code>payload.message</code>。
      </li>
      <li>
        <strong>两条与事件无关的下标正则</strong>，这两条不检查事件名。
      </li>
    </ol>
    <p>
      判定顺序是：正则 → 公共集合 → 两条下标正则 → 该事件的 payload 列表。两条下标正则放行的是：
    </p>
    <pre>
      <code>
        workspaces.&lt;n&gt;.(id|name) payload.questions.&lt;n&gt;.(label|title|description)
      </code>
    </pre>
    <p>
      因为这两条不绑定事件名，所以 <code>payload.questions.0.title</code> 在<strong>任何</strong>
      事件下都被判为合法路径， 哪怕该事件的 payload 根本没有 <code>questions</code>
      。这是静态允许、运行时取不到的典型情形。
    </p>
    <p>
      <code>turn.started</code> 更特殊：它的 payload 路径列表是<strong>空数组</strong>，
      所以这个事件连 <code>payload</code> 本身都读不到。想让 Turn 开始时发通知可以，
      但别想在条件里判断 Turn 开始时的内容——那时确实也没有内容。
    </p>
    <p>
      <code>session</code> / <code>turn</code> / <code>agent</code> / <code>workspaces</code> /{' '}
      <code>payload</code> 可以整对象取值， 取到的对象会原样透传。
    </p>
    <p>
      <strong>白名单是静态的</strong>，只做语法与权限校验，不检查数组下标是否越界。
      <code>workspaces.9.name</code> 静态合法，但若事件只有 1 个 workspace，运行时取到的就是{' '}
      <code>undefined</code>。
      后者是否算错误取决于用在哪：条件里退化为假，映射里抛错，模板里替换成空串。
    </p>

    <h3 id="operators">4.2 八个操作符的真实语义</h3>
    <p>
      协议层支持 8 个操作符。下面这张表是<strong>实测结果</strong>
      ，不是推断——其中三条与直觉不符，是最容易写错的地方。
    </p>
    <table>
      <thead>
        <tr>
          <th>表达式</th>
          <th>结果</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>eq(0,0)</code>、<code>eq(false,false)</code>
          </td>
          <td>
            <code>true</code>
          </td>
          <td>标量走严格相等</td>
        </tr>
        <tr>
          <td>
            <code>eq("0",0)</code>、<code>eq(true,1)</code>
          </td>
          <td>
            <code>false</code>
          </td>
          <td>没有隐式类型转换</td>
        </tr>
        <tr>
          <td>
            <strong>
              <code>eq(null,null)</code>
            </strong>
          </td>
          <td>
            <strong>
              <code>false</code>
            </strong>
          </td>
          <td>
            任一侧是 object 就提前返回 false，而 <code>typeof null</code> 正是 <code>"object"</code>
          </td>
        </tr>
        <tr>
          <td>
            <strong>
              <code>notEq(null,null)</code>
            </strong>
          </td>
          <td>
            <strong>
              <code>true</code>
            </strong>
          </td>
          <td>与上一条互为反相，会把「两边都缺」误判成「不相同」</td>
        </tr>
        <tr>
          <td>
            <code>eq([1,2],[1,2])</code>、<code>eq(&#123;a:1&#125;,&#123;a:1&#125;)</code>
          </td>
          <td>
            <code>false</code>
          </td>
          <td>数组也算 object</td>
        </tr>
        <tr>
          <td>
            <code>contains("a1b",1)</code>
          </td>
          <td>
            <code>true</code>
          </td>
          <td>
            数字被字符串化为 <code>"1"</code>
          </td>
        </tr>
        <tr>
          <td>
            <strong>
              <code>contains([1,2],1)</code>
            </strong>
          </td>
          <td>
            <strong>
              <code>false</code>
            </strong>
          </td>
          <td>
            数组经可比文本转换后为 null，<strong>contains 不支持数组</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>startsWith(12,1)</code>
          </td>
          <td>
            <code>true</code>
          </td>
          <td>同样是字符串前缀语义</td>
        </tr>
        <tr>
          <td>
            <code>exists(path payload.message)</code>
          </td>
          <td>
            <code>true</code>
          </td>
          <td>判定为「取值不为 null/undefined」</td>
        </tr>
        <tr>
          <td>
            <code>exists(path agent.missing)</code>
          </td>
          <td>
            <code>false</code>
          </td>
          <td>路径取不到值</td>
        </tr>
        <tr>
          <td>
            <code>exists(const "x")</code>
          </td>
          <td>
            <code>false</code>
          </td>
          <td>
            <code>exists</code> 的左侧必须是 path 表达式，用常量会被静态校验判非法
          </td>
        </tr>
        <tr>
          <td>未知操作符</td>
          <td>
            <code>false</code>
          </td>
          <td>落到默认分支</td>
        </tr>
      </tbody>
    </table>
    <p>由此得到两条实操结论：</p>
    <ul>
      <li>
        <strong>
          判空只能用 <code>exists</code>
        </strong>
        ，不能用 <code>eq … null</code>——后者恒为 false，条件永远不匹配。
      </li>
      <li>
        <strong>
          <code>contains</code> 只做字符串包含
        </strong>
        。想匹配数组元素，只能先把数组映射成模板字符串再比较。
      </li>
    </ul>
    <p>
      组合操作符 <code>and</code> / <code>or</code> / <code>not</code>{' '}
      只在协议层存在，界面配置不到（见下一节）。
    </p>

    <h3 id="ui-operators">4.3 界面只暴露五个叶子操作符</h3>
    <p>定义编辑器里的操作符下拉只有五项，与协议的 8 个不对等：</p>
    <table>
      <thead>
        <tr>
          <th>界面文案</th>
          <th>操作符</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>等于</td>
          <td>
            <code>eq</code>
          </td>
        </tr>
        <tr>
          <td>不等于</td>
          <td>
            <code>notEq</code>
          </td>
        </tr>
        <tr>
          <td>包含</td>
          <td>
            <code>contains</code>
          </td>
        </tr>
        <tr>
          <td>前缀为</td>
          <td>
            <code>startsWith</code>
          </td>
        </tr>
        <tr>
          <td>字段存在</td>
          <td>
            <code>exists</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      编辑器载入定义时只认<strong>叶子</strong>条件（有 <code>left</code> 且没有{' '}
      <code>conditions</code> 的那种）。 用 API
      或迁移脚本写进去的嵌套条件，在界面上会显示成「条件开关关闭」。
    </p>
    <p>
      <strong>这不是「条件被删掉了」</strong>。更新走的是合并语义，编辑器省略 <code>condition</code>{' '}
      字段时服务端会保留原条件，
      所以会出现「界面显示无条件、实际仍在过滤」的现象。要真正移除条件，目前没有可用路径——这是已知缺口，见第
      14 章。
    </p>
    <p>
      同一处还会丢类型：条件比较值和映射常量载入时统一转成字符串，提交时也恒为字符串。 协议允许{' '}
      <code>string | number | boolean | null</code> 四种常量，但经界面往返后只剩字符串。
      想写数字或布尔常量，需要通过迁移或 API。
    </p>

    <h3 id="limits">4.4 限制与边界</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>限制</th>
          <th>在哪一层强制</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>and</code> / <code>or</code> 的条件条数
          </td>
          <td>1 ~ 16</td>
          <td>只在协议校验；求值与静态校验都不检查条数</td>
        </tr>
        <tr>
          <td>条件嵌套深度</td>
          <td>没有上限</td>
          <td>递归求值，只受调用栈限制</td>
        </tr>
        <tr>
          <td>值表达式的键</td>
          <td>
            必须<strong>恰好一个</strong>
          </td>
          <td>
            <code>const</code> / <code>path</code> / <code>template</code> 三选一，协议强制
          </td>
        </tr>
        <tr>
          <td>映射参数名</td>
          <td>1 ~ 120 字符</td>
          <td>协议</td>
        </tr>
        <tr>
          <td>模板字符串</td>
          <td>至少 1 字符，无上限</td>
          <td>协议</td>
        </tr>
        <tr>
          <td>
            <code>name</code> / <code>description</code>
          </td>
          <td>1 ~ 120 / ≤ 2000</td>
          <td>协议</td>
        </tr>
        <tr>
          <td>
            <code>timeoutMs</code>
          </td>
          <td>1000 ~ 120000</td>
          <td>协议</td>
        </tr>
        <tr>
          <td>
            <code>maxAttempts</code> / <code>backoffMs</code>
          </td>
          <td>1 ~ 10 / 0 ~ 600000</td>
          <td>协议</td>
        </tr>
      </tbody>
    </table>
    <p>
      静态校验函数只查 5
      类问题：工具引用的三个必填字符串、条件里的路径、映射里的路径、通知标题与正文里的路径。 它
      <strong>不查工具是否真实存在</strong>，也不查条件条数与嵌套深度。
    </p>

    <h2 id="mapping">5. 输入映射</h2>
    <p>
      输入映射把事件字段转成工具入参。它是这个子系统与外部世界之间的唯一数据通道，因此值得单独讲清。
    </p>

    <h3 id="value-expr">5.1 三种值表达式</h3>
    <table>
      <thead>
        <tr>
          <th>类型</th>
          <th>写法</th>
          <th>用途</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>常量</td>
          <td>
            <code>&#123; const: "固定值" &#125;</code>
          </td>
          <td>写死一个值，例如固定 channel</td>
        </tr>
        <tr>
          <td>路径</td>
          <td>
            <code>&#123; path: "payload.response.finalText" &#125;</code>
          </td>
          <td>直接取事件字段，保持原始类型</td>
        </tr>
        <tr>
          <td>模板</td>
          <td>
            <code>&#123; template: "回答：$&#123;payload.response.finalText&#125;" &#125;</code>
          </td>
          <td>把多个字段拼成一段文本</td>
        </tr>
      </tbody>
    </table>
    <p>
      界面上每行是一个三元组：左边填参数名，中间选「路径 / 常量 / 模板」，右边填对应内容。
      映射区上方的提示是「事件字段 → 工具入参；映射的字段将随动作离开
      SparkWork」——这句话应当被认真对待， 因为映射出去的字段会真的发到外部。
    </p>
    <p>
      <code>path</code> 保持原始类型（对象原样透传）；<code>template</code> 永远返回字符串。
    </p>

    <h3 id="template">5.2 模板占位符</h3>
    <p>
      模板用 <code>$&#123;...&#125;</code> 嵌入路径，正则等价于：
    </p>
    <pre>
      <code>/\$\&#123;([^&#125;]+)\&#125;/g</code>
    </pre>
    <p>行为细则：</p>
    <ul>
      <li>
        占位符内的路径会先做 trim，所以 <code>$&#123; payload.message &#125;</code> 与{' '}
        <code>$&#123;payload.message&#125;</code> 等价。
      </li>
      <li>
        取值是 null 或 undefined 时替换为<strong>空串</strong>，不是字面量 <code>"undefined"</code>
        。
      </li>
      <li>取到对象或数组时用 JSON 序列化，其余用字符串转换。</li>
      <li>
        整个模板<strong>总是返回字符串</strong>，不会因为占位符只有一个就还原成原始类型——这点与{' '}
        <code>path</code> 不同。
      </li>
      <li>
        不存在的路径在保存前的静态校验就会被拦下（判非法），所以线上很少见到「模板生成空串」的情况。
      </li>
    </ul>
    <p>
      <strong>模板没有转义机制</strong>。反斜杠不是转义符，<code>\$&#123;eventId&#125;</code>{' '}
      里的占位符照样会被展开， 反斜杠原样保留。因此无法在模板里输出字面量{' '}
      <code>$&#123;...&#125;</code>。
    </p>
    <p>
      未闭合的 <code>$&#123;</code>（没有右花括号）不会被匹配，原样输出；空占位符{' '}
      <code>$&#123;&#125;</code> 因为正则要求至少一个字符也不会被匹配。
    </p>

    <h3 id="mapping-failure">5.3 映射失败会发生什么</h3>
    <p>
      映射求值抛错时，运行会记成 <code>failed</code> + <code>mapping_failed</code>，
      <strong>并且不会调用动作</strong>
      ——这一点在集成测试里有明确断言。所以映射写错不会造成「半个副作用」。
    </p>
    <p>两类错误共用一个异常类型，但消息不同，都带字段名：</p>
    <table>
      <thead>
        <tr>
          <th>情形</th>
          <th>消息形态</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>路径不在白名单</td>
          <td>「映射路径越权：&lt;path&gt;」</td>
        </tr>
        <tr>
          <td>路径合法但取不到值</td>
          <td>「映射字段 &lt;field&gt; 在事件中不存在」</td>
        </tr>
      </tbody>
    </table>
    <p>
      注意一个反直觉之处：像 <code>payload.nil</code> 这种「合法前缀 + 不存在的子字段」也会被判成
      <strong>越权</strong>， 因为它不在白名单里。真正的「取值为
      undefined」只发生在静态合法但运行时数据缺失时，例如越界的数组下标。
    </p>

    <h2 id="action">6. 动作：通知、提示音、调用工具</h2>
    <p>
      三种动作都受同一个超时约束，超时时间取自定义的 <code>timeoutMs</code>
      。动作执行器本身不写数据库，只返回执行结果。
    </p>

    <h3 id="notification">6.1 系统通知</h3>
    <p>通知的标题与正文都是值表达式，会先求值再发。两条兜底规则：</p>
    <ul>
      <li>
        标题为空或纯空白时，回退到<strong>按事件名硬编码</strong>的文案，格式是{' '}
        <code>SparkWork - 中文短语</code>
        。七条映射：任务开始、需要审批、需要您的输入、回答已生成、任务完成、任务失败、任务已取消。
      </li>
      <li>
        正文为空或纯空白时，<strong>整个字段不传</strong>（而不是传空串）。
      </li>
    </ul>
    <p>实际发送时的行为：</p>
    <ul>
      <li>
        会话窗口已聚焦时通知会被抑制——由未读角标服务统一判定，避免你在看这个会话时还弹它的通知。
      </li>
      <li>
        系统不支持通知时（<code>Notification.isSupported()</code> 为假）记一条警告并跳过。
      </li>
      <li>
        通知本身以静音方式发送，点击后会恢复并聚焦主窗口，同时推送一条跳转事件让界面切到对应会话。
      </li>
    </ul>
    <p>
      <strong>一个容易误判的点</strong>：宿主处理函数会返回布尔值表示「是否真的发出去了」， 但执行器
      <strong>不读取这个返回值</strong>，一律记成功。所以「通知被抑制」或「系统不支持通知」时，
      运行记录仍然是 <code>succeeded</code>
      。排查「为什么没弹通知」时不能只看运行状态，要去看会话是否聚焦、系统通知权限是否打开。
    </p>

    <h3 id="sound">6.2 提示音</h3>
    <p>
      提示音是最简单的动作：调用 Electron 的 <code>shell.beep()</code>。
      它不接受任何自定义参数——没有音量、没有音效选择、没有自定义音频文件。
      与通知同理，运行记录反映的是「动作执行器跑完了」，不代表你确实听见了声音（系统可能静音）。
    </p>

    <h3 id="tool-invoke">6.3 调用工具与工具候选</h3>
    <p>
      「调用工具」是唯一会产生外部副作用的动作类型。它保存的不是工具显示名，而是一份
      <strong>稳定引用</strong>：
    </p>
    <pre>
      <code>
        &#123; "sourceKind": "connector" | "custom-tool" | "tool-package", "sourceId": "…",
        "version": "…", // 可选 "toolName": "…", "qualifiedName": "…" &#125;
      </code>
    </pre>
    <p>
      运行时按 <code>sourceKind</code> + <code>sourceId</code> + （<code>toolName</code>{' '}
      <strong>或</strong> <code>qualifiedName</code> 二选一）匹配。
      <code>version</code> 不参与匹配，但参与版本漂移校验。
    </p>
    <p>
      <strong>哪些工具能被选：</strong>
    </p>
    <table>
      <thead>
        <tr>
          <th>风险等级</th>
          <th>可选</th>
          <th>不可选原因文案</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>read</code>
          </td>
          <td>可选</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>low-write</code>
          </td>
          <td>可选</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>high-write</code>
          </td>
          <td>不可选</td>
          <td>「high-write 工具默认不开放给 Hook 自动调用」</td>
        </tr>
        <tr>
          <td>
            <code>destructive</code>
          </td>
          <td>不可选</td>
          <td>「观察型 Hook 禁止 destructive 工具」</td>
        </tr>
      </tbody>
    </table>
    <p>
      不可选的条目<strong>仍会列在下拉里</strong>
      ，只是标成禁用并附上原因，所以你能看到「为什么这个工具用不了」。
      除风险等级外的其他维度（幂等性、effect、版本、账号是否已连接）都不影响可选性。
    </p>
    <p>
      下拉里的工具来自统一工具目录，调用时会带上 <code>invocationSource: 'hook'</code> 归因，
      并在统一工具审计里写入 Hook 与运行的对应关系，所以事后能追出「这个外部调用是哪个 Hook
      发起的」。
    </p>
    <p>
      编辑器里的展示形态是：选项文案 <code>&lt;工具名&gt;（不可选：&lt;原因&gt;）</code>
      ，选中后展示四个标签 「风险 / 幂等 / effect / 版本」。
    </p>
    <p>
      <strong>工具调用会被拦在哪些情况：</strong>
    </p>
    <table>
      <thead>
        <tr>
          <th>错误码</th>
          <th>触发条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>trust_required</code>
          </td>
          <td>绑定处于待重新授权状态，或信任哈希与当前定义不一致</td>
        </tr>
        <tr>
          <td>
            <code>tool_not_found</code>
          </td>
          <td>工具目录里找不到匹配项（也可能是一次性目录快照不一致）</td>
        </tr>
        <tr>
          <td>
            <code>tool_version_changed</code>
          </td>
          <td>定义里存的版本与当前工具版本都非空且不相等</td>
        </tr>
        <tr>
          <td>
            <code>policy_blocked</code>
          </td>
          <td>风险等级为 destructive，或为 high-write 且未开放</td>
        </tr>
      </tbody>
    </table>
    <p>
      失败归一化规则：网关返回失败但没给错误码时降级为 <code>action_failed</code>；
      抛出超时错误映射为 <code>timeout</code>；其余异常映射为 <code>action_failed</code>。
    </p>
    <p>
      另外，宿主网关做「调用前复核」时传的上下文少于真正调用时传的，两者看到的工具目录快照可能不同。
      如果你的 Hook
      依赖连接器账号，可能出现「复核通过但调用时找不到工具」或反之，排查时注意这个差异。
    </p>

    <h2 id="binding">7. 作用域与绑定授权</h2>
    <p>
      定义只是「模板」，必须绑定到作用域并完成授权才会真正执行。这个设计解决的是「我改了一行配置，它就能悄悄往外部发数据」的风险。
    </p>

    <h3 id="scopes">7.1 四种作用域与优先级</h3>
    <p>四个作用域，界面上的真实标签是：</p>
    <table>
      <thead>
        <tr>
          <th>作用域</th>
          <th>界面标签</th>
          <th>scopeId</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>application</code>
          </td>
          <td>应用（全局）</td>
          <td>固定为空串</td>
        </tr>
        <tr>
          <td>
            <code>workspace</code>
          </td>
          <td>项目（主 Workspace）</td>
          <td>主 workspace 的 id</td>
        </tr>
        <tr>
          <td>
            <code>agent</code>
          </td>
          <td>Agent</td>
          <td>Agent id</td>
        </tr>
        <tr>
          <td>
            <code>session</code>
          </td>
          <td>会话</td>
          <td>会话 id</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>application</code> 的 <code>scopeId</code> 被强制写成空串，这样唯一约束
      <code>(hook_id, scope_kind, scope_id)</code> 才能可靠工作。
    </p>
    <p>
      优先级是确定性的：<strong>session &gt; agent &gt; workspace &gt; application</strong>。 同一个
      Hook 命中多个作用域时，取优先级最高的那个作为「最终生效绑定」， 其余记入{' '}
      <code>shadowedBy</code> 仅作展示。界面上会显示成「覆盖 X/Y」。
    </p>
    <p>
      一个容易误解的表述：四者<strong>不是继承树</strong>，而是「当前执行上下文的匹配集合」。
      优先级只决定同一 Hook 的多个绑定里哪个算数，不做逐层配置合并。
    </p>
    <p>
      实际匹配规则：<code>application</code> 要求 <code>scopeId === ''</code>；
      <code>workspace</code> 要求信封里有 <code>primaryWorkspaceId</code> 且相等；
      <code>agent</code> 要求信封里有 <code>agent</code> 且 id 相等；<code>session</code>{' '}
      直接比对会话 id。 所以信封里缺 <code>agent</code> 时，Agent 作用域的绑定不会命中。
    </p>

    <h3 id="binding-state">7.2 三种绑定状态</h3>
    <table>
      <thead>
        <tr>
          <th>状态</th>
          <th>界面文案</th>
          <th>含义</th>
          <th>会执行吗</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>active</code>
          </td>
          <td>生效中</td>
          <td>已授权，且信任哈希与当前定义一致</td>
          <td>会</td>
        </tr>
        <tr>
          <td>
            <code>needs_review</code>
          </td>
          <td>待重新授权</td>
          <td>定义执行属性变了，旧授权失效</td>
          <td>不会，但会留一条 blocked 记录</td>
        </tr>
        <tr>
          <td>
            <code>disabled</code>
          </td>
          <td>已停用</td>
          <td>绑定被关掉</td>
          <td>不会，且不留记录</td>
        </tr>
      </tbody>
    </table>
    <p>
      状态由「是否启用」与「是否授权」两个布尔量决定：启用且已授权是 <code>active</code>，
      启用但未授权是 <code>needs_review</code>，未启用一律 <code>disabled</code>（与是否授权无关）。
    </p>
    <p>
      <code>needs_review</code> 的绑定<strong>仍会进入队列</strong>，只是被执行前的复核拦下并记为{' '}
      <code>blocked</code> + <code>trust_required</code>。
      这是刻意的——让「授权缺失」在审计里可见，而不是静默不执行。
    </p>

    <h3 id="authorize">7.3 授权流程</h3>
    <p>
      在「作用域绑定」区点「添加绑定」时，会弹出确认框，标题是「授权执行该
      Hook？」，正文列出三件事：
    </p>
    <ol>
      <li>
        <strong>授权对象</strong>：Hook 名称与它监听的事件
      </li>
      <li>
        <strong>动作</strong>：调用工具 X / 系统通知 / 提示音
      </li>
      <li>
        <strong>将随动作外发的字段</strong>：以标签形式列出输入映射里配置的全部参数名
      </li>
    </ol>
    <p>
      确认框还会写明「授权与当前定义的执行哈希绑定；之后任何执行属性（事件/条件/映射/动作/策略）变化都会使授权失效。」，确认按钮是「确认授权」。
    </p>
    <p>
      <strong>新增绑定即自动授权并启用</strong>
      ：点「添加绑定」会一次性带上启用标记与当前执行哈希，成功后提示「绑定已创建并授权」。 非
      application 作用域必须填 scopeId，否则提示「请填写作用域对象 ID」。
    </p>
    <p>后续的授权保留规则有两条路径：</p>
    <ul>
      <li>
        <strong>显式重新授权</strong>
        ：传入的哈希等于当前定义哈希才通过。传了不匹配的哈希会被当成「明确的重新授权意图」，降级为待重新授权，而不是静默保留旧的。
      </li>
      <li>
        <strong>保留既有信任</strong>
        ：不传授权参数、且既有绑定信任的哈希仍等于当前定义哈希时，视为继续信任。
      </li>
    </ul>
    <p>
      第二条是为了让「单纯切换启用开关」不失效——开关属于非执行性变更，不该让既有授权作废。
      界面上的表现是：待重新授权时显示「重新授权」按钮，其他情况显示启用开关。
    </p>
    <p>
      绑定列表按 application → workspace → agent → session 排序显示。授权信息行显示 「授权哈希
      &lt;前 12 位&gt;…」或「未授权」，有授权时间时追加日期。
    </p>

    <h3 id="no-record">7.4 三种「没有运行记录」的情形</h3>
    <p>排查「事件发生了但看不到记录」时，先分清是哪一类：</p>
    <table>
      <thead>
        <tr>
          <th>情形</th>
          <th>有记录吗</th>
          <th>在哪能看到</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>条件不匹配</td>
          <td>
            有：<code>skipped</code> + <code>condition_not_matched</code>
          </td>
          <td>运行记录面板</td>
        </tr>
        <tr>
          <td>授权缺失或策略拒绝</td>
          <td>
            有：<code>blocked</code> + 对应错误码
          </td>
          <td>运行记录面板</td>
        </tr>
        <tr>
          <td>定义停用 / 绑定停用</td>
          <td>
            <strong>没有</strong>
          </td>
          <td>只能从定义或绑定的启用状态判断</td>
        </tr>
        <tr>
          <td>该事件没有任何启用中的定义</td>
          <td>
            <strong>没有</strong>（事件都没写进 outbox）
          </td>
          <td>看不到</td>
        </tr>
      </tbody>
    </table>
    <p>前两类是「跑了但没成功」，后两类是「根本没进队列」。这个区分能省下大量排查时间。</p>

    <h2 id="execution-hash">8. executionHash：什么改动会让授权失效</h2>
    <p>
      这是整个子系统最容易被写错、也最影响使用体验的一块。搞懂它，你就知道为什么「只改了个名字，授权怎么没了」这种问题不会发生——以及反过来，「只把超时从
      15 秒改成 20 秒，为什么绑定全部要重新授权」是对的。
    </p>

    <h3 id="hash-fields">8.1 参与哈希的七个字段</h3>
    <p>
      执行哈希是规范化后的 SHA-256，输入<strong>只有 7 个键</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>参与哈希</th>
          <th>不参与哈希</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>eventName</code>
          </td>
          <td>
            <code>id</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>condition</code>
          </td>
          <td>
            <code>name</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>action</code>（含 target 的每个字段，因此 <code>target.version</code> 也参与）
          </td>
          <td>
            <code>description</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>inputMapping</code>
          </td>
          <td>
            <code>enabled</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>timeoutMs</code>
          </td>
          <td>
            <code>revision</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>retryPolicy</code>（mode / maxAttempts / backoffMs）
          </td>
          <td>
            <code>createdAt</code> / <code>updatedAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>concurrencyPolicy</code>
          </td>
          <td>任何多传的额外键</td>
        </tr>
      </tbody>
    </table>
    <p>
      「不参与」是<strong>编译期保证</strong>而不是运行时过滤：计算函数的入参类型就直接是这 7
      个字段的 Pick 类型，
      <code>id</code> / <code>name</code> / <code>enabled</code> 根本传不进去。
    </p>
    <p>
      规范化规则：键递归排序并按字典序序列化、丢弃值为 undefined 的键、数组保持顺序、标量用 JSON
      序列化。所以<strong>键的书写顺序不影响哈希</strong>，同语义定义必然同哈希。
    </p>
    <p>
      一处细节差异：<code>condition</code> 省略与显式 <code>null</code> 得到相同哈希，
      <code>inputMapping</code> 省略与 <code>&#123;&#125;</code> 也相同； 但 <code>timeoutMs</code>{' '}
      省略与显式 15000 会得到<strong>不同</strong>哈希，因为它是直接透传的。
      仓库内所有调用方都会在计算前补默认值，所以生产路径不受影响；只有自己手搓哈希输入的代码需要留意。
    </p>

    <h3 id="invalidate">8.2 什么改动会让授权失效</h3>
    <p>
      更新定义时的逻辑是：算出新哈希 → 与旧的比较 →{' '}
      <strong>只有变了才 +1 revision 并写新哈希</strong>，同时把该定义下所有绑定置为待重新授权。
    </p>
    <table>
      <thead>
        <tr>
          <th>你改了什么</th>
          <th>哈希变吗</th>
          <th>revision</th>
          <th>绑定要重新授权吗</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>名称、描述</td>
          <td>不变</td>
          <td>不变</td>
          <td>
            <strong>不用</strong>
          </td>
        </tr>
        <tr>
          <td>启用开关</td>
          <td>不变</td>
          <td>不变</td>
          <td>
            <strong>不用</strong>
          </td>
        </tr>
        <tr>
          <td>事件</td>
          <td>变</td>
          <td>+1</td>
          <td>要</td>
        </tr>
        <tr>
          <td>条件</td>
          <td>变</td>
          <td>+1</td>
          <td>要</td>
        </tr>
        <tr>
          <td>动作或工具引用</td>
          <td>变</td>
          <td>+1</td>
          <td>要</td>
        </tr>
        <tr>
          <td>输入映射</td>
          <td>变</td>
          <td>+1</td>
          <td>要</td>
        </tr>
        <tr>
          <td>超时</td>
          <td>变</td>
          <td>+1</td>
          <td>要</td>
        </tr>
        <tr>
          <td>重试策略（任一字段）</td>
          <td>变</td>
          <td>+1</td>
          <td>要</td>
        </tr>
        <tr>
          <td>并发策略</td>
          <td>变</td>
          <td>+1</td>
          <td>要</td>
        </tr>
      </tbody>
    </table>
    <p>保存后界面会给出对应反馈：</p>
    <ul>
      <li>新建：「Hook 定义已创建；启用前请在「作用域绑定」中完成授权」</li>
      <li>更新且哈希变化：「执行属性变化，N 个绑定需重新授权后才会执行」</li>
    </ul>
    <p>
      这里的 <strong>N 是「被改成待重新授权」的绑定行数</strong>，并且
      <strong>不含已停用的绑定</strong>—— 已经被你停用的绑定不会被计入，所以 N 为 0
      不代表这个定义没有绑定。
    </p>
    <p>
      授权失效是 fail-closed 的：集成测试里明确断言，改掉 <code>timeoutMs</code> 后运行会变成
      <code>blocked</code> + <code>trust_required</code>，而且<strong>工具调用次数为 0</strong>——
      在重新授权之前，不会有任何外部调用发生。
    </p>

    <h2 id="pipeline">9. 执行管线</h2>

    <h3 id="chain">9.1 四段链路</h3>
    <pre>
      <code>
        生命周期事实（SessionService / PermissionService） ↓ HookLifecycleBridge 构造信封
        hook_events（outbox，幂等入队） ↓ HookDispatcher 解析绑定、建运行快照（同一事务里标
        resolved） hook_runs（队列 + 调度） ↓ HookWorker 定时领取、前置复核、执行
        HookActionExecutor（超时包裹下的通知 / 提示音 / 工具调用） ↓ 写终态或重新入队
      </code>
    </pre>
    <p>
      几个关键性质：事件先落库再派发，派发失败会把事件释放回待处理状态而不是丢掉； 「建运行快照 +
      标记事件已解析」在同一个事务里，不会出现半完成状态； 每条运行有 <strong>确定性幂等</strong>
      ，同一个事件对同一个定义只产生一条记录。
    </p>

    <h3 id="tables">9.2 四张表</h3>
    <table>
      <thead>
        <tr>
          <th>表</th>
          <th>作用</th>
          <th>关键约束</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>hook_definitions</code>
          </td>
          <td>定义（事件、条件、动作、映射、策略、revision、execution_hash）</td>
          <td>
            主键 <code>id</code>；索引 <code>(event_name, enabled)</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>hook_bindings</code>
          </td>
          <td>作用域绑定与授权</td>
          <td>
            <code>UNIQUE (hook_id, scope_kind, scope_id)</code>；<code>hook_id</code> 外键级联删除
          </td>
        </tr>
        <tr>
          <td>
            <code>hook_events</code>
          </td>
          <td>事件 outbox</td>
          <td>
            主键 <code>event_id</code>；状态 <code>pending / resolving / resolved / failed</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>hook_runs</code>
          </td>
          <td>运行记录与调度队列</td>
          <td>
            <code>UNIQUE (event_id, hook_id)</code>；状态 8 值
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      所有 JSON 字段（条件、动作、映射、重试策略、信封、各类快照与摘要）都以文本列存储，共 11 个。
      时间列全部是 ISO 字符串。<code>execution_hash</code> <strong>没有索引也没有唯一约束</strong>
      ，它只作为授权凭据使用。
    </p>
    <p>删除语义值得单独记住：</p>
    <ul>
      <li>
        删定义 → 绑定<strong>级联删除</strong>，运行记录<strong>保留</strong>
        （它持有定义快照，界面文案也这么写）。
      </li>
      <li>
        运行记录唯一的按时间之外的清理路径是<strong>删除会话</strong>，会按 session_id
        清掉运行与事件。
      </li>
      <li>队列里已解析的事件保留 7 天后回收，每次最多 500 条。</li>
    </ul>
    <p>
      界面上的删除确认会显示「将删除 N 个作用域绑定；历史运行记录（M
      条）默认保留定义快照，不随定义删除。」， 其中 M 来自另一次查询，不是删除接口的返回值。
    </p>

    <h3 id="timers">9.3 三个定时器</h3>
    <p>整个子系统由三个定时器驱动，理解它们就能解释大多数「为什么没立刻执行」的疑问：</p>
    <table>
      <thead>
        <tr>
          <th>组件</th>
          <th>间隔</th>
          <th>职责</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Worker 轮询</td>
          <td>2 秒</td>
          <td>领取并执行队列里的运行；单次最多连续处理 16 条</td>
        </tr>
        <tr>
          <td>Dispatcher 维护扫描</td>
          <td>5 秒</td>
          <td>回收过期租约、派发积压事件、按保留期清理</td>
        </tr>
        <tr>
          <td>Compensator 补偿扫描</td>
          <td>60 秒</td>
          <td>按稳定事实源补发崩溃窗口内可能丢失的事件</td>
        </tr>
      </tbody>
    </table>
    <p>
      除定时器外还有两个即时触发点：事件落库时会立刻叫醒派发器（一次最多 8 条），
      以及启动时与重新开启总开关时各派发一次。
    </p>
    <p>
      <strong>注意 Worker 没有事件驱动的唤醒通道</strong>：事件落库只叫醒派发器，不叫醒 Worker。
      因此新入队的运行最坏要等约 2 秒才会被领取。写「实时执行」并不准确。
    </p>
    <p>
      补偿扫描器补的是「事实已落库但事件没写进 outbox」这个很窄的崩溃窗口。 它按 turn 请求表与最终
      assistant 消息重放事件，靠确定性事件 ID 与主键去重保证幂等。 两个限制：
      <strong>首次运行只初始化游标、不回溯历史</strong>（所以首次扫描要等 60 秒后）；
      <strong>只覆盖 4 个事件</strong>——<code>permission.requested</code> 与{' '}
      <code>question.requested</code> 的事实源在内存里， 官方注释明确说这两个事件不承诺崩溃不丢。
    </p>
    <p>
      顺带解释一个历史问题：迁移 101 给 <code>agent_events(event_type, created_at)</code> 与
      <code>turn_requests(created_at)</code> 建索引，正是为了这个 60 秒扫描。
      迁移注释记录了当时的症状：这两条查询走全表扫描加临时排序，在主进程同步阻塞事件循环 0.7~1.4
      秒， 造成界面间歇性转圈、点 Dock 图标无法置前。它<strong>不是 hook 表的索引</strong>
      ，别混进上一节的表结构里。
    </p>

    <h3 id="lease">9.4 租约与崩溃恢复</h3>
    <p>事件与运行都用租约防重复处理：</p>
    <table>
      <thead>
        <tr>
          <th>对象</th>
          <th>租约时长</th>
          <th>过期后的处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            事件（<code>resolving</code>）
          </td>
          <td>60 秒</td>
          <td>
            释放回 <code>pending</code>，下次扫描重派
          </td>
        </tr>
        <tr>
          <td>
            运行（<code>running</code>）
          </td>
          <td>5 分钟</td>
          <td>
            回收为终态 <code>outcome_unknown</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      两者处理方式不同，原因是风险性质不同：事件没被派发是安全的，重来一次即可；
      而动作可能已经发出去了，无法确认，所以不能自动重投，只能标成结果未知让你人工判断。
    </p>
    <p>
      启动时会做一次恢复：把过期的运行标为结果未知，并把滞留的事件重新派发。
      这个过程在会话服务构建时执行，且整段包在异常隔离里——
      <strong>Hook 基础设施启动失败不会阻断会话服务</strong>，
      只记一条错误日志。退出时也有对应的清理步骤。
    </p>
    <p>
      运行在工作过程中会定期续租，且续租前会先给自己的在途运行续期，避免把正在跑的自己误判成僵尸。
    </p>

    <h2 id="retry">10. 重试、超时与并发</h2>

    <h3 id="timeout">10.1 超时</h3>
    <p>
      <code>timeoutMs</code> 默认 <strong>15000</strong>，可设范围 1000 ~ 120000。 三种动作
      <strong>都</strong>被同一个超时包裹，包括提示音和系统通知。 超时会被映射成错误码{' '}
      <code>timeout</code>。
    </p>
    <p>
      界面上「执行策略」折叠区默认收起，只有当你把某项改成非默认值时才自动展开。可编辑项与默认值：
    </p>
    <table>
      <thead>
        <tr>
          <th>控件</th>
          <th>范围</th>
          <th>默认</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>超时（毫秒）</td>
          <td>1000 ~ 120000，步进 1000</td>
          <td>15000</td>
        </tr>
        <tr>
          <td>最大尝试次数</td>
          <td>1 ~ 10</td>
          <td>3</td>
        </tr>
        <tr>
          <td>退避基数（毫秒）</td>
          <td>0 ~ 600000，步进 500</td>
          <td>1000</td>
        </tr>
        <tr>
          <td>重试策略</td>
          <td>safe / keyed / unsafe</td>
          <td>unsafe</td>
        </tr>
        <tr>
          <td>并发策略</td>
          <td>会话内串行 / 并行</td>
          <td>serial_per_session</td>
        </tr>
      </tbody>
    </table>

    <h3 id="retry-mode">10.2 三种重试策略</h3>
    <p>
      <strong>
        默认是 <code>unsafe</code>，意味着默认不自动重试。
      </strong>
      这点与很多人的预期相反，所以「失败了一次就再没动静」是符合设计的。
    </p>
    <table>
      <thead>
        <tr>
          <th>策略</th>
          <th>界面文案</th>
          <th>自动重试条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>safe</code>
          </td>
          <td>safe · 仅瞬态错误自动重试</td>
          <td>错误码是瞬态即可</td>
        </tr>
        <tr>
          <td>
            <code>keyed</code>
          </td>
          <td>keyed · 注入幂等键自动重试</td>
          <td>
            错误码是瞬态<strong>且</strong>成功注入了幂等键
          </td>
        </tr>
        <tr>
          <td>
            <code>unsafe</code>
          </td>
          <td>unsafe · 失败不自动重试</td>
          <td>永不</td>
        </tr>
      </tbody>
    </table>
    <p>三者共同还需满足「已尝试次数小于最大尝试次数」。</p>
    <p>
      <strong>瞬态错误码只有两个</strong>：<code>transient_failure</code> 与 <code>timeout</code>。
      这意味着 <code>action_failed</code> 即使在 <code>safe</code> 模式下也<strong>不会</strong>
      重试。 唯一会把工具异常归到 <code>transient_failure</code>{' '}
      的地方，是宿主按错误消息正则匹配网络类关键字 （连接重置、连接被拒、超时、DNS 解析失败、socket
      挂断、network、fetch failed、aborted、timeout）。 非网络类的确定性失败一律归为{' '}
      <code>action_failed</code>，不重试。
    </p>
    <p>
      授权失效、策略拒绝这类 <code>blocked</code> 也不会自动重试——它们不是执行失败，而是根本没执行。
    </p>

    <h3 id="backoff">10.3 退避与 attemptCount</h3>
    <p>退避是指数增长：第 N 次尝试失败后的等待时间是</p>
    <pre>
      <code>backoffMs × 2^(attemptCount − 1)</code>
    </pre>
    <p>
      因为领取时就会把计数 +1，所以首次失败时计数已经是 1，退避恰好等于 <code>backoffMs</code>；
      第二次失败是 2 倍，依次类推。集成测试对这条有明确断言： 首次失败后状态回到排队、计数为 1，
      <strong>立刻再取一次会取不到</strong>（因为退避时间还没到），计数也保持不变。
    </p>
    <p>
      两个与 <code>attemptCount</code> 有关、容易看错的点：
    </p>
    <ul>
      <li>
        它是<strong>领取计数</strong>而不是失败计数——每次被领取就 +1，用户手动重试后继续累加。
      </li>
      <li>
        运行记录里的时长是从<strong>首次</strong>开始算的（起始时间只在第一次领取时写入），
        所以重试过的运行，其时长<strong>包含退避等待时间</strong>
        ，不是最后一次尝试的耗时。排查性能问题时别把它当单次耗时。
      </li>
    </ul>
    <p>
      还有一处兜底：如果 Worker 管线本身崩了（不是动作失败），会固定 60 秒后重新入队并记为
      <code>transient_failure</code>，这个重试不乘退避倍数。
    </p>

    <h3 id="idempotency">10.4 幂等键：keyed 的真实前提</h3>
    <p>
      <code>keyed</code> 模式需要<strong>两件事同时成立</strong>：
    </p>
    <ol>
      <li>
        定义的重试策略设为 <code>keyed</code>；
      </li>
      <li>
        目标工具在统一工具目录里自报幂等性为 <code>keyed</code>。
      </li>
    </ol>
    <p>幂等键的派生方式是：</p>
    <pre>
      <code>sha256(stableStringify(&#123; eventId, hookId, action &#125;))</code>
    </pre>
    <p>
      它<strong>不含尝试序号</strong>
      ，所以同一事件的所有重试复用同一个键——这正是幂等去重能成立的前提。
    </p>
    <p>
      <strong>降级是静默的</strong>：工具没有自报 <code>keyed</code> 时，幂等键为空，
      自动重试条件恒不成立，表现为「配了 keyed 但就是不重试」，
      而且不会有任何错误码或提示告诉你原因。排查时先去看工具的幂等声明。
    </p>

    <h3 id="concurrency">10.5 并发策略：serial 与 parallel 的真实差别</h3>
    <p>这块有一个非常容易写错的地方，先说结论：</p>
    <p>
      <strong>
        <code>parallel</code> 不等于「同时执行多个动作」。
      </strong>
      Worker 只有一个实例，内部是逐条串行领取并等待完成，还有重入守卫。 也就是说，
      <strong>同一时刻进程内最多只有 1 个 Hook 动作在执行</strong>。<code>parallel</code> 的作用只是
      <strong>移除「同 Hook + 同会话」的串行闸门</strong>， 让不同
      Hook、不同会话的运行可以依次快速通过，而不是真正并行跑。
    </p>
    <p>两种策略的差别：</p>
    <table>
      <thead>
        <tr>
          <th>策略</th>
          <th>调度行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>serial_per_session</code>
          </td>
          <td>同一 Hook + 同一会话内，存在更早入队且仍处于排队或运行中的记录时，跳过当前候选</td>
        </tr>
        <tr>
          <td>
            <code>parallel</code>
          </td>
          <td>不做这个检查，直接领取</td>
        </tr>
      </tbody>
    </table>
    <p>
      串行的判定范围是<strong>同一个 Hook 加同一个会话</strong>，不是「同一会话里的所有 Hook」。
      不同 Hook 在同一会话里互不阻塞。
    </p>
    <p>排队顺序用插入序（rowid）而不是时间戳，这样即使同一毫秒内插入多条也能保持稳定顺序。</p>
    <p>
      <strong>一个值得注意的副作用</strong>：等待重试的运行状态是「排队」，
      而串行判定把「排队」也算作阻塞者。所以一次失败进入退避等待后，会顶住同一个 Hook
      在同一会话里后续的所有运行， 直到退避结束并执行完。这也是为什么把 <code>maxAttempts</code>{' '}
      调大时要留意对同会话其他触发的影响。
    </p>
    <p>
      关于显式重试与取消的差异：自动重试会<strong>保留</strong>上次的错误码与消息；
      用户手动重试则会清空错误码、错误消息、结束时间与时长。
    </p>

    <h2 id="runs">11. 运行记录与排查</h2>

    <h3 id="status">11.1 八种状态</h3>
    <table>
      <thead>
        <tr>
          <th>状态</th>
          <th>界面文案</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>queued</code>
          </td>
          <td>排队中</td>
          <td>已入队，等待被领取（含等待退避的重试）</td>
        </tr>
        <tr>
          <td>
            <code>running</code>
          </td>
          <td>执行中</td>
          <td>已被领取</td>
        </tr>
        <tr>
          <td>
            <code>succeeded</code>
          </td>
          <td>成功</td>
          <td>动作执行器正常返回</td>
        </tr>
        <tr>
          <td>
            <code>failed</code>
          </td>
          <td>失败</td>
          <td>映射失败或动作失败</td>
        </tr>
        <tr>
          <td>
            <code>skipped</code>
          </td>
          <td>已跳过</td>
          <td>条件不匹配（派发阶段就已判定）</td>
        </tr>
        <tr>
          <td>
            <code>blocked</code>
          </td>
          <td>被阻止</td>
          <td>执行前复核拒绝（停用、待授权、工具策略）</td>
        </tr>
        <tr>
          <td>
            <code>cancelled</code>
          </td>
          <td>已取消</td>
          <td>用户显式取消（仅排队中的可取消）</td>
        </tr>
        <tr>
          <td>
            <code>outcome_unknown</code>
          </td>
          <td>结果未知</td>
          <td>在途被取消或租约过期——可能已产生副作用，不自动重投</td>
        </tr>
      </tbody>
    </table>
    <p>
      调度器内部还有一个返回值字面量 <code>retry_scheduled</code>，它<strong>不是</strong>
      数据库状态、也不会出现在界面上， 落库时状态是「排队中」。
    </p>

    <h3 id="panel">11.2 面板能做什么</h3>
    <p>
      列表每行显示：展开箭头、状态标签、测试运行标记、事件名、时间、尝试次数、时长与错误中文标签。展开后能看到运行
      ID、事件 ID、定义与修订号、会话与
      Turn、错误消息，以及「输入摘要（已脱敏）」与「输出摘要（已脱敏）」两段 JSON。
    </p>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>可用条件</th>
          <th>不可用时的提示</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>重试</td>
          <td>状态是 失败 / 被阻止 / 已取消 / 结果未知</td>
          <td>「该运行不在可重试的终态」</td>
        </tr>
        <tr>
          <td>取消</td>
          <td>状态是排队中</td>
          <td>「仅排队中的运行可取消」</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>取消不能终止正在执行的动作</strong>——只有排队中的运行能被取消。
      想中断在途动作，只能关应用级总开关或退出应用，那条路径的结果是「结果未知」（见下一章）。
    </p>
    <p>面板还有几个使用上的限制，值得提前知道：</p>
    <ul>
      <li>
        状态筛选只有「全部状态 + 八个状态」，没有时间范围、事件名或会话筛选，也没有分页；固定取最近
        50 条。
      </li>
      <li>虽然接口支持按定义过滤，但面板恒为「全部 Hook」。</li>
      <li>
        <strong>没有实时推送</strong>：列表不会自动刷新，需要点「刷新」或操作后手动刷新。
      </li>
    </ul>

    <h3 id="redaction">11.3 脱敏边界</h3>
    <p>摘要两列会做脱敏与截断，规则是：</p>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>规则</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>敏感键名</td>
          <td>
            匹配 authorization / cookie / token / secret / password / passphrase / api key /
            credential / private key（忽略大小写）时，<strong>值</strong>替换为 <code>***</code>
            ，键名保留
          </td>
        </tr>
        <tr>
          <td>字符串长度</td>
          <td>
            超过 512 字符截断并追加 <code>…[truncated]</code>
          </td>
        </tr>
        <tr>
          <td>嵌套深度</td>
          <td>
            超过 6 层返回 <code>[depth-limit]</code>
          </td>
        </tr>
        <tr>
          <td>条目数量</td>
          <td>
            超过 64 条截断；对象被截断时额外写一个 <code>[truncated]: true</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>但要清楚脱敏的作用范围只有摘要两列。</strong>
      真实入参（映射求值后的结果）会以<strong>未脱敏</strong>形式单独存进运行记录的映射输入字段里，
      而且这个字段没有任何读出口——界面不展示、域模型也不映射它，它只是留在库里。
      所以不要把「摘要已脱敏」理解成「运行记录不含敏感正文」。
    </p>
    <p>
      相应地，如果映射里包含了敏感字段，它会随动作真实发往目标工具——这是设计使然（动作正文由你的映射决定），
      但意味着「把 token 映射进工具入参」是你不该做的事。
    </p>

    <h2 id="system-switch">12. 应用级总开关</h2>

    <h3 id="switch-scope">12.1 开关实际拦住什么</h3>
    <p>
      总开关存在设置里的 <code>hooks-v2 / enabled</code>，缺省视为<strong>开启</strong>
      。它只在两个地方生效，且都在「领取」这一侧：
    </p>
    <ul>
      <li>派发器：关闭时不领取新的待处理事件</li>
      <li>Worker：关闭时不领取新的待运行记录</li>
    </ul>
    <p>
      <strong>它不拦的地方同样重要：</strong>
    </p>
    <table>
      <thead>
        <tr>
          <th>环节</th>
          <th>关闭时是否继续</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>事件写入 outbox</td>
          <td>
            <strong>继续</strong>——判据是「有没有启用中的定义」，与总开关无关
          </td>
        </tr>
        <tr>
          <td>补偿扫描器</td>
          <td>
            <strong>继续</strong>按 60 秒重放事实
          </td>
        </tr>
        <tr>
          <td>派发器维护扫描与 Worker 定时器</td>
          <td>定时器仍在跑，只是各自提前返回</td>
        </tr>
      </tbody>
    </table>
    <p>
      由此得出一个实用结论：<strong>长期关闭总开关、但保留启用中的定义，outbox 会持续堆积</strong>。
      因为清理只回收「已解析」的事件，而待处理的事件在没有派发的情况下不会被解析。
      如果打算长期停用，更干净的做法是把定义停用（那样连事件都不会写）。
    </p>

    <h3 id="switch-effects">12.2 关闭后的行为</h3>
    <table>
      <thead>
        <tr>
          <th>对象</th>
          <th>关闭后</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>已排队的运行</td>
          <td>
            <strong>保持排队</strong>，不会被取消；重新开启后按插入顺序继续执行
          </td>
        </tr>
        <tr>
          <td>正在执行的动作</td>
          <td>
            尽力取消：中断在途动作，无法确认结果的记为<strong>结果未知</strong>，不自动重投
          </td>
        </tr>
        <tr>
          <td>已发生的外部副作用</td>
          <td>
            <strong>不撤回</strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      「尽力取消」和「不回滚」这两点代码注释和界面文案都写明了。界面提示是
      「已暂停新的自动执行（不撤回已发生的外部副作用）」。
      所以关闭总开关是「刹车」而不是「倒车」——已经发出去的请求不会因为关闭而消失。
    </p>
    <p>重新开启时会立即派发一次积压事件，并恢复 Worker 领取。</p>

    <h2 id="migration">13. 旧配置迁移</h2>
    <p>
      首次启动时会把「经典通知」的配置迁移成 Hooks V2 的内置定义，让旧用户不用重新配一遍。
      迁移只在进程首次启动时执行一次，且有幂等保护。
    </p>
    <p>
      <strong>配置来源</strong>是 <code>hooks/config</code>，取不到时回退 <code>hooks/data</code>
      ——主进程的事实源是前者，后者是渲染层的历史键。
    </p>
    <p>
      <strong>节点到事件的映射</strong>（注意第三个节点会裂成两个事件）：
    </p>
    <table>
      <thead>
        <tr>
          <th>旧节点</th>
          <th>迁移成的事件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>ask_user_question</code>
          </td>
          <td>
            <code>question.requested</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>session_end</code>
          </td>
          <td>
            <code>turn.completed</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>session_fail</code>
          </td>
          <td>
            <code>turn.failed</code> + <code>turn.cancelled</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>permission_request</code>
          </td>
          <td>
            <strong>不迁移</strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>permission_request</code> 明确不迁移，原因是避免与既有的权限请求回调路径重复通知。
      迁移只搬 sound 与 notification 两类动作，旧节点里的两个开关都开着时会生成两个定义。
    </p>
    <p>其他关键性质：</p>
    <ul>
      <li>
        定义 ID 是确定性的，形如 <code>builtin-legacy-&lt;节点&gt;-&lt;动作&gt;</code>
        ，所以重复执行不会产生重复定义。
      </li>
      <li>
        迁移写入的绑定<strong>自带授权</strong>
        （状态直接是生效中，信任哈希就是自身哈希），不需要你再确认一次。
      </li>
      <li>
        整个过程在一个数据库事务里，任一步失败就整体回滚，所有权标记保持旧值，旧通知路径不受影响。
      </li>
      <li>
        <strong>旧配置不会被删除或改写</strong>，原样保留以便回滚。
      </li>
      <li>
        Agent 级配置不新建定义，只为已存在的定义写 Agent 作用域绑定；节点关闭时该绑定直接写成停用。
      </li>
    </ul>
    <p>
      两个容易踩的细节：应用级配置缺 <code>enabled</code> 时按「开启」处理， 而 Agent 级配置必须
      <strong>显式</strong>为开启才会迁移——两处默认值不一致。 另外，
      <strong>没有旧配置的全新安装不会写所有权标记</strong>，这些机器上「已迁移」判定会长期为假，
      经典通知区块因此会一直显示「未迁移」的提示文案。这不是故障。
    </p>
    <p>
      界面上的「经典通知（兼容）」区块会根据所有权标记显示两种提示之一：
      已迁移时说明「本区块不再生效，仅保留回滚兼容读取」，未迁移时说明两者并行执行。
      该区块的四个节点各有两个开关（系统通知 / 提示音），并各有一个「测试」按钮可即时验证。
      它自己写的键是 <code>hooks/data</code>，而「是否已迁移」读的是另一个键{' '}
      <code>hooks-v2/ownership</code>，两者不要混为一谈。
    </p>

    <h2 id="gaps">14. 已知缺口与事实边界</h2>
    <p>下面这些不是猜测，而是核对代码后确认的现状。使用前了解它们，能少走很多弯路。</p>

    <h3 id="gaps-policy">14.1 策略与门控</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>现状</th>
          <th>后果</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>high-write 工具白名单</td>
          <td>
            策略层有 <code>allowHighWrite</code> 选项，默认关闭，但
            <strong>生产组装根从未传入</strong>，界面也没有开关
          </td>
          <td>
            high-write 工具在实际使用中<strong>永久不可选</strong>，无法通过任何配置解除
          </td>
        </tr>
        <tr>
          <td>
            <code>tool_disabled</code> 错误码
          </td>
          <td>宿主网关把工具的「已启用」硬编码为真</td>
          <td>
            这个错误码在桌面端<strong>不可达</strong>；实际只会看到工具找不到与版本漂移两类
          </td>
        </tr>
        <tr>
          <td>
            <code>ambiguous_binding</code> 错误码
          </td>
          <td>绑定冲突时只写一行主进程警告日志，不落任何记录</td>
          <td>
            协议与界面文案里虽有这个码，但<strong>永远不会出现在运行记录里</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>permission_changed</code> 错误码
          </td>
          <td>没有任何产生点</td>
          <td>同样不会出现在记录里</td>
        </tr>
        <tr>
          <td>连续失败自动暂停</td>
          <td>
            只在「策略拒绝」这条路径上调用；连续<code>failed</code>不会触发
          </td>
          <td>
            「失败 5 次自动把绑定置为待重新授权」<strong>只对 blocked 成立</strong>
            ，动作连续失败不会自动暂停
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="gaps-data">14.2 数据与保留</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>现状</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>失败事件永不清理</td>
          <td>
            保留期回收只匹配「已解析」状态；解析失败的事件会无界累积，且其错误字段没有任何读取方
          </td>
        </tr>
        <tr>
          <td>运行记录没有按时间清理</td>
          <td>唯一的清理路径是删除会话</td>
        </tr>
        <tr>
          <td>映射输入字段只写不读</td>
          <td>没有读出口——界面不展示、域模型不映射</td>
        </tr>
        <tr>
          <td>归因字段只写不读</td>
          <td>调用关联 id 与调用 id 由 Worker 写入，但界面不可见</td>
        </tr>
        <tr>
          <td>定义的模式版本恒为 1</td>
          <td>写入时硬编码，且不参与读取</td>
        </tr>
      </tbody>
    </table>
    <p>
      与「不清理」相对的一面：队列里已解析的事件保留 7 天，清理操作有 10
      分钟的最小间隔节流，单次最多 500 条。
    </p>

    <h3 id="gaps-ui">14.3 协议支持但界面配不到</h3>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>为什么配不到</th>
          <th>怎么用上</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>组合条件（and / or / not）</td>
          <td>编辑器只给 5 个叶子操作符</td>
          <td>迁移脚本或直接调接口</td>
        </tr>
        <tr>
          <td>常量类型（数字 / 布尔 / null）</td>
          <td>编辑器往返统一转字符串</td>
          <td>迁移脚本或直接调接口</td>
        </tr>
        <tr>
          <td>自定义样例信封</td>
          <td>渲染层封装只接受定义参数</td>
          <td>仅测试路径可用</td>
        </tr>
        <tr>
          <td>按事件过滤定义列表</td>
          <td>界面调用时都不传该参数</td>
          <td>接口支持</td>
        </tr>
        <tr>
          <td>运行记录的时间 / 事件 / 会话筛选</td>
          <td>界面只传定义与状态</td>
          <td>接口支持</td>
        </tr>
        <tr>
          <td>high-write 白名单</td>
          <td>无开关，且组装根未接线</td>
          <td>当前不可用</td>
        </tr>
      </tbody>
    </table>
    <p>
      另外两个 IPC 通道（校验定义、按 id 取运行）已注册并有渲染层封装，但
      <strong>没有任何调用方</strong>
      。校验能力实际由「预览」返回值覆盖，运行详情由列表返回体展开渲染。
    </p>

    <h3 id="gaps-condition">14.4 条件无法移除</h3>
    <p>
      更新定义是合并语义，而合并逻辑<strong>没有任何分支能把条件置为空</strong>：
      传了条件就替换，没传就保留原值，接口也不接受 null。
      编辑器在关闭条件面板时会省略该字段，于是落到「保留原值」分支。
    </p>
    <p>
      结果是：<strong>条件一旦设过就无法通过正常途径移除</strong>，界面还会显示成「条件开关关闭」，
      形成「看着没条件、实际仍在过滤」的状态。规避方法是在改条件而不是删条件——
      或者删掉这个定义重建一个。这是实现层面的缺口，不是产品设计。
    </p>

    <h2 id="troubleshooting">15. 排查表</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>先查什么</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>事件发生了，但一条运行记录都没有</td>
          <td>
            ① 定义是否启用；② 绑定是否启用；③ 该事件是否有启用中的定义（没有就连事件都不写）；④
            绑定作用域是否匹配当前上下文（信封里没有 agent 时 Agent 作用域不命中）
          </td>
        </tr>
        <tr>
          <td>有记录，但状态是「已跳过」</td>
          <td>
            条件不匹配。展开看错误码是否为条件未命中，再核对条件表达式——
            <strong>
              别用 <code>eq</code> 比 null
            </strong>
          </td>
        </tr>
        <tr>
          <td>有记录，但状态是「被阻止」</td>
          <td>
            看错误码：待重新授权 → 去绑定处重新授权；工具找不到 → 工具是否还在目录里；版本漂移 →
            工具升级过；策略阻止 → 风险等级问题
          </td>
        </tr>
        <tr>
          <td>改了定义后就不执行了</td>
          <td>
            看保存提示里的「N
            个绑定需重新授权」。改了条件/动作/映射/超时/重试/并发都会让授权失效，重新授权即可
          </td>
        </tr>
        <tr>
          <td>只改了名称，怎么也提示要重新授权</td>
          <td>
            不应该发生。名称与描述不参与哈希。若确实提示了，说明同时改了别的执行属性（可能是界面里顺手保存了默认值）
          </td>
        </tr>
        <tr>
          <td>配了重试但失败后没有重试</td>
          <td>
            ① 默认策略是 unsafe，确认改成 safe 或 keyed；② 错误码必须是瞬态（仅超时与网络类）；③
            keyed 还要工具自报幂等键
          </td>
        </tr>
        <tr>
          <td>手动重试按钮点不了</td>
          <td>
            只有失败 / 被阻止 / 已取消 /
            结果未知四种终态可重试；排队中、执行中、成功、已跳过都不可重试
          </td>
        </tr>
        <tr>
          <td>想取消正在执行的运行</td>
          <td>不支持。取消只对排队中的运行有效，执行中的只能靠关总开关或退出应用</td>
        </tr>
        <tr>
          <td>通知没弹出来</td>
          <td>
            ① 运行记录的状态不可靠（被抑制也记成功）；② 检查该会话是否正聚焦——聚焦时通知会被抑制；③
            检查系统通知权限；④ 看主进程日志里有没有「系统不支持通知」
          </td>
        </tr>
        <tr>
          <td>提示音响了但记录显示失败</td>
          <td>不可能同时发生，但反过来可能：记录显示成功不代表你听见了（系统可能静音）</td>
        </tr>
        <tr>
          <td>没配任何东西，项目里却跑了命令</td>
          <td>
            去项目目录看 <code>.spark/settings.json</code> 与{' '}
            <code>.spark/settings.local.json</code>——那是 spark-engine 的另一套 shell
            hooks，桌面端没有界面管理它
          </td>
        </tr>
        <tr>
          <td>事件发生很久才执行</td>
          <td>
            Worker 是 2 秒轮询且无唤醒通道，最坏约 2 秒延迟；如果还在退避等待，会按指数退避推迟
          </td>
        </tr>
        <tr>
          <td>同一会话里前一个 Hook 卡住了后面的</td>
          <td>
            该 Hook 是会话内串行策略，且等待重试期间也会占住队列。可改成并行策略或调小重试次数
          </td>
        </tr>
        <tr>
          <td>关掉总开关后数据还在涨</td>
          <td>正常。事件仍会写入 outbox，补偿器也仍在跑。要彻底停掉请停用定义</td>
        </tr>
        <tr>
          <td>关总开关后有些记录变成「结果未知」</td>
          <td>那是尽力取消在途动作的结果。可能已产生副作用，需要人工确认后再决定是否手动重试</td>
        </tr>
        <tr>
          <td>经典通知区块显示「未迁移」</td>
          <td>全新安装不会写所有权标记，属正常。只有当存在旧配置且启用时才会迁移并标记</td>
        </tr>
        <tr>
          <td>界面显示无条件，但动作还是被过滤</td>
          <td>条件无法通过界面移除（见第 14.4 节）。用接口查看该定义的真实条件</td>
        </tr>
        <tr>
          <td>工具下拉是空的</td>
          <td>工具目录不可用时会静默返回空列表，没有错误提示。检查会话服务与工具目录是否正常</td>
        </tr>
        <tr>
          <td>运行记录面板不自动更新</td>
          <td>没有推送订阅，点「刷新」</td>
        </tr>
        <tr>
          <td>想看历史某次运行的完整入参</td>
          <td>界面看不到——映射输入字段没有读出口。只能看已脱敏的输入摘要</td>
        </tr>
      </tbody>
    </table>
  </>
)

const content = {
  slug: 'hooks-v2',
  toc: [
    { id: 'three-kinds', title: '1. 三套 Hook：先分清你在配哪一套', level: 2 },
    { id: 'compare', title: '1.1 三者对照', level: 3 },
    { id: 'v2-position', title: '1.2 桌面 Hooks V2 的定位', level: 3 },
    { id: 'engine-hooks', title: '1.3 spark-engine 的 shell hooks：一个常见盲区', level: 3 },
    { id: 'entry', title: '2. 界面入口与一次完整配置', level: 2 },
    { id: 'entries', title: '2.1 三处入口', level: 3 },
    { id: 'settings-layout', title: '2.2 设置页的真实结构', level: 3 },
    { id: 'walkthrough', title: '2.3 七步配完一个 Hook', level: 3 },
    { id: 'events', title: '3. 七个生命周期事件', level: 2 },
    { id: 'event-table', title: '3.1 事件表与真实发射点', level: 3 },
    { id: 'event-id', title: '3.2 事件 ID 与两级去重', level: 3 },
    { id: 'emit-shortcut', title: '3.3 发射端短路：未使用 Hook 的应用零额外写入', level: 3 },
    { id: 'payload', title: '3.4 每个事件能读到什么', level: 3 },
    { id: 'condition', title: '4. 条件表达式', level: 2 },
    { id: 'path-whitelist', title: '4.1 路径语法与白名单', level: 3 },
    { id: 'operators', title: '4.2 八个操作符的真实语义', level: 3 },
    { id: 'ui-operators', title: '4.3 界面只暴露五个叶子操作符', level: 3 },
    { id: 'limits', title: '4.4 限制与边界', level: 3 },
    { id: 'mapping', title: '5. 输入映射', level: 2 },
    { id: 'value-expr', title: '5.1 三种值表达式', level: 3 },
    { id: 'template', title: '5.2 模板占位符', level: 3 },
    { id: 'mapping-failure', title: '5.3 映射失败会发生什么', level: 3 },
    { id: 'action', title: '6. 动作：通知、提示音、调用工具', level: 2 },
    { id: 'notification', title: '6.1 系统通知', level: 3 },
    { id: 'sound', title: '6.2 提示音', level: 3 },
    { id: 'tool-invoke', title: '6.3 调用工具与工具候选', level: 3 },
    { id: 'binding', title: '7. 作用域与绑定授权', level: 2 },
    { id: 'scopes', title: '7.1 四种作用域与优先级', level: 3 },
    { id: 'binding-state', title: '7.2 三种绑定状态', level: 3 },
    { id: 'authorize', title: '7.3 授权流程', level: 3 },
    { id: 'no-record', title: '7.4 三种「没有运行记录」的情形', level: 3 },
    { id: 'execution-hash', title: '8. executionHash：什么改动会让授权失效', level: 2 },
    { id: 'hash-fields', title: '8.1 参与哈希的七个字段', level: 3 },
    { id: 'invalidate', title: '8.2 什么改动会让授权失效', level: 3 },
    { id: 'pipeline', title: '9. 执行管线', level: 2 },
    { id: 'chain', title: '9.1 四段链路', level: 3 },
    { id: 'tables', title: '9.2 四张表', level: 3 },
    { id: 'timers', title: '9.3 三个定时器', level: 3 },
    { id: 'lease', title: '9.4 租约与崩溃恢复', level: 3 },
    { id: 'retry', title: '10. 重试、超时与并发', level: 2 },
    { id: 'timeout', title: '10.1 超时', level: 3 },
    { id: 'retry-mode', title: '10.2 三种重试策略', level: 3 },
    { id: 'backoff', title: '10.3 退避与 attemptCount', level: 3 },
    { id: 'idempotency', title: '10.4 幂等键：keyed 的真实前提', level: 3 },
    { id: 'concurrency', title: '10.5 并发策略：serial 与 parallel 的真实差别', level: 3 },
    { id: 'runs', title: '11. 运行记录与排查', level: 2 },
    { id: 'status', title: '11.1 八种状态', level: 3 },
    { id: 'panel', title: '11.2 面板能做什么', level: 3 },
    { id: 'redaction', title: '11.3 脱敏边界', level: 3 },
    { id: 'system-switch', title: '12. 应用级总开关', level: 2 },
    { id: 'switch-scope', title: '12.1 开关实际拦住什么', level: 3 },
    { id: 'switch-effects', title: '12.2 关闭后的行为', level: 3 },
    { id: 'migration', title: '13. 旧配置迁移', level: 2 },
    { id: 'gaps', title: '14. 已知缺口与事实边界', level: 2 },
    { id: 'gaps-policy', title: '14.1 策略与门控', level: 3 },
    { id: 'gaps-data', title: '14.2 数据与保留', level: 3 },
    { id: 'gaps-ui', title: '14.3 协议支持但界面配不到', level: 3 },
    { id: 'gaps-condition', title: '14.4 条件无法移除', level: 3 },
    { id: 'troubleshooting', title: '15. 排查表', level: 2 },
  ],
  faq: [
    {
      question: 'Hooks V2 会不会改变 Agent 的执行结果？',
      answer:
        '不会。它是观察型机制：事件在生命周期事实落库之后发射，动作失败也不会把 Turn 变成失败，Hook 基础设施异常也不会阻断会话主流程。想「拦截」只有 spark-engine 那套 shell hooks 能做到（退出码 2 或输出 block 决策），但那套没有界面。',
    },
    {
      question: '为什么我只改了 Hook 的名字，绑定也要重新授权？',
      answer:
        '正常情况下不需要。执行哈希只覆盖事件、条件、动作、映射、超时、重试策略与并发策略这 7 个字段，名称、描述与启用开关都不参与计算，因此改名不会让授权失效。如果确实提示了，说明同时改动了某个执行属性。',
    },
    {
      question: '默认的重试策略是什么？失败了会自动重试吗？',
      answer:
        '默认是 unsafe，也就是不自动重试。要自动重试必须改成 safe 或 keyed，并且错误码必须是瞬态——只有超时和网络类错误算瞬态，其他失败（例如 action_failed）即使在 safe 模式下也不会重试。',
    },
    {
      question: '我关掉了总开关，为什么数据库里还在增加记录？',
      answer:
        '总开关只拦「领取」这一步：派发器不再取新事件、Worker 不再取新运行。但事件是否写入 outbox 取决于「有没有启用中的定义」，与总开关无关，补偿扫描器也照常运行。想彻底停下要先停用定义。',
    },
    {
      question: '条件里怎么判断某个字段为空？',
      answer:
        '用 exists 操作符，不要用 eq 去比较 null。因为实现里任一侧是 object 就提前返回 false，而 typeof null 正是 "object"，所以 eq(null, null) 恒为 false，条件永远不会匹配。',
    },
    {
      question: '为什么 high-write 的工具选了也存不下来？',
      answer:
        '当前版本里 high-write 与 destructive 工具都不开放给 Hook 自动调用，选项会列出但标成禁用。high-write 的白名单开关在生产组装代码里从未传入，界面也没有对应入口，所以无法解除——这是现状而非配置问题。',
    },
  ],
  aiSummary:
    'Hooks V2 是 Spark Agent 的观察型生命周期回调：7 个事件（Turn 开始/结束/失败/取消、权限请求、Agent 提问、回答提交）、3 种动作（系统通知、提示音、调用工具）、4 级作用域与基于执行哈希的授权机制。本文先辨析产品里三套同名机制，再给出条件表达式真实语义、输入映射与模板规则、绑定授权与失效条件、事件到执行的完整管线与三个定时器、重试/超时/幂等/并发的准确行为，以及 20 行排查对照。',
  quickReference: [
    { key: '配置入口', value: '设置 → 系统 → Hooks（另有 Agent 编辑页与会话检查器两处生效视图）' },
    {
      key: '七个事件',
      value:
        'turn.started · permission.requested · question.requested · response.committed · turn.completed · turn.failed · turn.cancelled',
    },
    { key: '三种动作', value: 'builtin.notification · builtin.sound · tool.invoke' },
    { key: '作用域优先级', value: 'session > agent > workspace > application' },
    { key: '绑定状态', value: 'active（生效中）· needs_review（待重新授权）· disabled（已停用）' },
    { key: '事件 ID 规则', value: 'hev_ + sha256(eventName:sourceId)，确定性去重' },
    {
      key: '运行状态',
      value:
        'queued · running · succeeded · failed · skipped · blocked · cancelled · outcome_unknown',
    },
    { key: '默认超时', value: '15000 毫秒（可设 1000 ~ 120000）' },
    { key: '默认重试策略', value: 'unsafe（不自动重试）' },
    { key: '瞬态错误码', value: 'transient_failure · timeout（只有这两个会触发自动重试）' },
    { key: '退避公式', value: 'backoffMs × 2^(attemptCount − 1)' },
    { key: '默认并发策略', value: 'serial_per_session（同 Hook + 同会话串行）' },
    { key: 'Worker 轮询间隔', value: '2 秒（且无事件驱动唤醒）' },
    { key: '派发器扫描间隔', value: '5 秒' },
    { key: '补偿扫描间隔', value: '60 秒（首轮只初始化游标，不回溯历史）' },
    { key: '已解析事件保留', value: '7 天；每次清理最多 500 条' },
    { key: '租约', value: '事件 60 秒（过期回待处理）· 运行 5 分钟（过期记结果未知）' },
    {
      key: '执行哈希字段',
      value:
        'eventName · condition · action · inputMapping · timeoutMs · retryPolicy · concurrencyPolicy',
    },
    { key: '脱敏上限', value: '字符串 512 字符 · 深度 6 层 · 条目 64 个' },
    { key: '总开关键', value: 'app_settings 的 hooks-v2 / enabled（缺省为开启）' },
    { key: '旧配置迁移', value: 'hooks/config 为主、hooks/data 兜底；permission_request 不迁移' },
  ],
  howTo: {
    name: '新建一个 Hook 并在会话里生效',
    description:
      '从设置页创建一个监听 Turn 完成、发送系统通知的 Hook，完成作用域绑定与授权，并验证它在真实会话中执行。',
    totalTime: 'PT5M',
    steps: [
      '打开设置 → 系统 → Hooks，确认顶部应用总开关处于开启状态。',
      '点「新建 Hook」，填写名称与描述。保存后再去配置绑定授权。',
      '在事件下拉里选择「Turn 完成 · turn.completed」，留意字段提示里该事件的中文说明。',
      '选择动作「系统通知」。标题与正文都可以留空，留空时会按事件名回退到内置文案。',
      '（可选）展开「触发条件（可选）」并打开「仅当条件满足时执行」，选操作符与事件路径。要判空请用「字段存在」，不要用「等于」去比空值。',
      '点底部「预览」确认条件判定与将要发送的字段，然后点「创建」保存。',
      '在「作用域绑定」区点「添加绑定」，选择「应用（全局）」并确认授权对话框。新增绑定即自动授权并启用。',
      '想立即验证效果，点编辑器底部的「测试运行」并在二次确认里点「确认执行」——它会真实执行动作并产生一条带测试标记的记录。',
      '回到一个真实会话跑完一轮，然后在 Hooks 页的运行记录里确认出现一条「成功」记录；若没有，按排查表逐项核对。',
    ],
  },
  Body,
} satisfies DocsPageContent

export default content
