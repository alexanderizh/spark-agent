import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      SparkWork 的「权限与治理」不是一个开关，而是两条独立防线加几条旁路记录：
      <strong>会话权限模式</strong>决定 SDK 层是否把工具调用送到审批（
      <code>apps/desktop/src/renderer/design/utils/permission-options.ts</code>）；
      <strong>权限 Profile 规则</strong>决定到达审批时是自动放行、自动拦截还是弹卡 （
      <code>packages/agent-runtime/src/services/permission.service.ts</code>）。
      规则（Rules）、Hooks、用量账本、本地日志是另外四块独立能力，存储与入口各不相同。
      本文只写代码里真实存在的枚举、入口与默认值，并明确标注哪些旧文档提法在当前代码中
      <strong>不存在</strong>。
    </p>

    <h2 id="approval">1. 第一层：会话权限模式（SDK 层）</h2>
    <p>
      会话权限模式可按执行器（adapter）选择，三种适配器的可选值互斥。真实枚举与界面文案来自
      <code>permission-options.ts</code>，类型定义在 <code>packages/protocol</code> 的{' '}
      <code>SessionPermissionMode</code>。
    </p>
    <table>
      <thead>
        <tr>
          <th>执行器</th>
          <th>模式键名</th>
          <th>界面文案</th>
          <th>界面说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td rowSpan={5}>
            <code>claude-sdk</code> / <code>claude</code>
          </td>
          <td>
            <code>claude-ask</code>
          </td>
          <td>请求批准</td>
          <td>每次工具执行前确认</td>
        </tr>
        <tr>
          <td>
            <code>claude-plan</code>
          </td>
          <td>计划模式</td>
          <td>先产出计划，再批准执行</td>
        </tr>
        <tr>
          <td>
            <code>claude-auto-edits</code>
          </td>
          <td>自动编辑</td>
          <td>自动批准文件编辑</td>
        </tr>
        <tr>
          <td>
            <code>claude-auto</code>
          </td>
          <td>自动审批</td>
          <td>使用自动权限策略</td>
        </tr>
        <tr>
          <td>
            <code>claude-bypass</code>
          </td>
          <td>完全访问</td>
          <td>完全由 agent 执行</td>
        </tr>
        <tr>
          <td rowSpan={3}>
            <code>codex</code>
          </td>
          <td>
            <code>codex-default</code>
          </td>
          <td>按需批准</td>
          <td>
            <code>workspace-write</code>；工作区内安全写入自动执行，越界操作请求批准
          </td>
        </tr>
        <tr>
          <td>
            <code>codex-auto-review</code>
          </td>
          <td>替我批准</td>
          <td>
            <code>workspace-write</code>；越界操作交由 Codex 自动审查
          </td>
        </tr>
        <tr>
          <td>
            <code>codex-full-access</code>
          </td>
          <td>完全访问</td>
          <td>
            <code>danger-full-access</code>；允许修改 <code>.git</code> 和工作区外文件
          </td>
        </tr>
        <tr>
          <td rowSpan={3}>
            <code>spark</code>
          </td>
          <td>
            <code>spark-default</code>
          </td>
          <td>手动审批</td>
          <td>只读工具直接执行；写入与命令逐次确认</td>
        </tr>
        <tr>
          <td>
            <code>spark-auto</code>
          </td>
          <td>自动审批</td>
          <td>所有工具自动执行（显式 deny 规则仍生效）</td>
        </tr>
        <tr>
          <td>
            <code>spark-bypass</code>
          </td>
          <td>完全访问</td>
          <td>跳过全部审批与规则，完全由 agent 执行</td>
        </tr>
      </tbody>
    </table>
    <p>
      协议里还保留了旧值 <code>spark-accept-edits</code>、<code>spark-plan</code>
      （只为已存储会话兼容，
      界面不再提供）。模式不是「每次都要审批」的同义词，它的实际作用是映射到各内核的原生策略：
    </p>
    <ul>
      <li>
        Claude：<code>claude-ask</code> → SDK <code>default</code>；<code>claude-auto-edits</code> →{' '}
        <code>acceptEdits</code>；<code>claude-auto</code> → <code>auto</code>；
        <code>claude-bypass</code> → <code>bypassPermissions</code>；<code>claude-plan</code> →{' '}
        <code>plan</code>（只读 enforcement 交给 SDK 原生 plan 模式，不再把 Write/Edit 放进
        disallowedTools）。
      </li>
      <li>
        Claude 路径还有一组<strong>永远拒绝</strong>的模式：<code>Bash(rm -rf /:*)</code>、 fork
        bomb、<code>Bash(mkfs:*)</code>、<code>Bash(dd if=/dev/zero:*)</code>，以及预设自带的{' '}
        <code>Skill</code> 工具（SparkWork 用自己的 Skill 体系，调用预设 Skill 只会报 Unknown
        skill）。
      </li>
      <li>
        Codex：<code>codex-full-access</code> → <code>sandboxMode: danger-full-access</code> +{' '}
        <code>approvalPolicy: never</code>；<code>codex-auto-review</code> →{' '}
        <code>workspace-write</code> + <code>approvalPolicy: on-request</code> +{' '}
        <code>approvalsReviewer: auto_review</code>；<code>codex-default</code> →{' '}
        <code>workspace-write</code> + <code>on-request</code>
        （无人值守场景降为 <code>never</code>）。
      </li>
    </ul>
    <p>三个真实入口：</p>
    <ul>
      <li>
        <strong>输入框权限下拉</strong>（会话内切换）：主对话框与 Agent 配置复用同一份{' '}
        <code>permission-options.ts</code>，切换后会热更新运行中的 Claude 执行器。
      </li>
      <li>
        <strong>设置 → 权限策略 → SDK 执行默认策略</strong>：可选「默认执行器」（Claude SDK / Codex
        / Spark）与 「默认权限策略」。这份默认值落在 <code>app_settings</code> 的{' '}
        <code>runtime-permissions/defaults</code>，只作用于<strong>新会话</strong>与无会话输入区；
        已有会话保留自己的策略。默认值是 <code>claude-sdk</code> + <code>claude-ask</code>
        （Codex 适配器回落 <code>codex-default</code>，Spark 回落 <code>spark-default</code>）。
      </li>
      <li>
        协议侧 <code>session:update</code> 也带 <code>permissionMode</code>，可对已有会话改模式。
      </li>
    </ul>

    <h2 id="approval-flow">2. 第二层：权限 Profile 规则与审批卡</h2>
    <p>
      规则层在 <strong>设置 → 权限策略</strong>
      （左栏分组「Agent」下的「权限策略」）。它由两部分组成： 选中的 <strong>Profile</strong>
      ，以及该 Profile 下的<strong>动作类目规则</strong>。
    </p>
    <p>动作类目是固定的 7 项，界面名称与说明如下（真实取值就是这些 action 字符串）：</p>
    <table>
      <thead>
        <tr>
          <th>action</th>
          <th>界面名称</th>
          <th>覆盖的工具</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>file_read</code>
          </td>
          <td>读取文件</td>
          <td>Read / Glob / Grep 等读取类工具</td>
        </tr>
        <tr>
          <td>
            <code>file_write</code>
          </td>
          <td>编辑文件</td>
          <td>Write / Edit 等写入类工具</td>
        </tr>
        <tr>
          <td>
            <code>command_exec</code>
          </td>
          <td>执行 shell 命令</td>
          <td>非破坏性命令</td>
        </tr>
        <tr>
          <td>
            <code>command_dangerous</code>
          </td>
          <td>高风险命令</td>
          <td>
            <code>rm -rf</code>、<code>git reset --hard</code>、<code>sudo</code> 等
          </td>
        </tr>
        <tr>
          <td>
            <code>network_known</code>
          </td>
          <td>搜索网络</td>
          <td>WebSearch 等已知安全入口</td>
        </tr>
        <tr>
          <td>
            <code>network_unknown</code>
          </td>
          <td>访问任意网页</td>
          <td>WebFetch 抓取任意 URL</td>
        </tr>
        <tr>
          <td>
            <code>mcp_tool</code>
          </td>
          <td>调用 MCP 工具</td>
          <td>
            所有 <code>mcp__</code> 前缀的第三方工具
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      每条规则有四种模式（下拉里是中文）：<code>allow</code> 允许、<code>ask</code> 询问、
      <code>ask-twice</code> 双重确认、<code>deny</code> 拒绝。三个内置 Profile
      的语义与默认规则种子：
    </p>
    <ul>
      <li>
        <strong>strict</strong>（一切都问）：<code>file_read</code>/<code>file_write</code>/
        <code>command_exec</code>/<code>network_known</code>/<code>network_unknown</code>/
        <code>mcp_tool</code> 均为 <code>ask</code>，<code>command_dangerous</code> 为{' '}
        <code>ask-twice</code>。
      </li>
      <li>
        <strong>project-standard</strong>（工作区写入自动允许，默认 Profile）：
        <code>file_read</code>/<code>file_write</code>/<code>network_known</code>/
        <code>mcp_tool</code> 为 <code>allow</code>，<code>command_exec</code> 为 <code>ask</code>，
        <code>command_dangerous</code> 为 <code>ask-twice</code>，<code>network_unknown</code> 为{' '}
        <code>ask</code>。
      </li>
      <li>
        <strong>trusted</strong>（自动允许大多数）：除 <code>command_dangerous</code> 为{' '}
        <code>ask</code> 外， 其余动作类目都是 <code>allow</code>。
      </li>
    </ul>
    <p>
      存储位置：<code>permission_profiles</code> / <code>permission_rules</code> /{' '}
      <code>permission_settings</code> 三张表，当前激活的 Profile 存在{' '}
      <code>permission_settings</code> 的 <code>permission:active-profile</code>。 IPC 里还有{' '}
      <code>permission:create-profile</code> / <code>permission:delete-profile</code>，
      但设置页目前只用到「列出 Profile / 改规则 / 切换激活 Profile」，没有新建/删除 Profile
      的界面入口。
    </p>
    <p>
      <strong>一次审批的完整判定顺序</strong>（<code>PermissionService.requestApproval</code>）：
    </p>
    <ol>
      <li>
        先把工具名映射成动作类目：<code>mcp__</code>/<code>mcp:</code> 前缀 → <code>mcp_tool</code>
        ；<code>Bash</code>/<code>bash</code>/<code>run_command</code>/<code>git</code> 等 →{' '}
        <code>command_exec</code>， 若命令命中危险正则则升级为 <code>command_dangerous</code>
        ；无法映射的工具兜底为 <code>command_exec</code>，并且拿不到规则时模式默认 <code>ask</code>
        （更安全）。
      </li>
      <li>
        危险命令识别用的是正则，不是关键字列表：<code>rm -rf</code>、<code>git clean -fx</code>、
        <code>git reset --hard</code>、<code>sudo</code>、<code>chmod -r</code>、
        <code>chown -r</code>、<code>dd if=</code>、<code>mkfs</code>、经典 fork bomb。
      </li>
      <li>
        查会话级内存决策（用户点过「会话允许 / 会话拒绝」）→ 查 Profile 规则 → 查{' '}
        <code>permission_decisions</code> 表里的项目/全局记忆（键是 <code>action</code> +{' '}
        <code>toolName</code>）。<code>allow</code> 直接放行、<code>deny</code> 直接拦截。
      </li>
      <li>
        <code>ask</code> / <code>ask-twice</code> 才推审批卡；<code>ask-twice</code> 会
        <strong>连弹两次</strong>， 两次都放行才通过，任一次拒绝即拒绝。
      </li>
    </ol>
    <p>
      <strong>审批卡长什么样（渲染端真实文案）：</strong>
    </p>
    <ul>
      <li>
        标题：<code>允许执行 &lt;toolName&gt;?</code>；副标题显示{' '}
        <code>Session xxxxxxxx · 风险 低/中/高</code>。
      </li>
      <li>
        按钮只有四个：<strong>拒绝</strong>、<strong>会话拒绝</strong>、<strong>会话允许</strong>、
        <strong>允许</strong>；<code>Esc</code> 等同拒绝。
      </li>
      <li>
        正文是人话摘要：<code>修改文件</code> / <code>写入文件</code> / <code>运行命令</code> /{' '}
        <code>访问网络</code> / <code>搜索内容</code> / <code>使用 &lt;toolName&gt;</code>
        ，并列出最多 3 个关键字段 （<code>文件</code>、<code>将要运行</code>、<code>搜索内容</code>
        、<code>网址</code>、<code>用途</code>、<code>任务</code>）； 底部「查看技术详情」折叠原始{' '}
        <code>toolInput</code> JSON。
      </li>
      <li>
        <strong>高风险操作不会无限等待</strong>：30 分钟无人操作即按拒绝继续，同时推{' '}
        <code>stream:permission:approval-resolved</code>（reason <code>timeout</code>）收起卡片，
        并往会话时间线写一条 <code>agent_error</code>（code <code>PERMISSION_TIMEOUT</code>，
        文案如「权限审批「Bash」等待超过 30 分钟已自动拒绝，已跳过该操作」）。会话被取消则写{' '}
        <code>PERMISSION_CANCELLED</code>。
      </li>
      <li>
        卡片已失效后再点按钮，主进程返回 <code>ok:false</code>
        ，界面提示「该权限请求已失效（等待超时或会话已取消）， 你的选择未生效」。
      </li>
      <li>
        协议里还存在 <code>allow-project</code> / <code>allow-global</code>（会落{' '}
        <code>permission_decisions</code>{' '}
        表长期记忆），但当前审批卡只暴露上面四个按钮，用户点不到项目/全局授权。
      </li>
      <li>
        Computer Use 有硬闸：<code>computer_direct_action</code> 与 <code>computer_unknown</code>{' '}
        永远拒绝； 受管的桌面任务 start/resume 等在入口直接放行，不会弹应用内审批。
      </li>
    </ul>

    <h2 id="rules">3. Rules：注入 prompt 的策略片段</h2>
    <p>
      Rules 是存在 SQLite（<code>rules</code> 表）里的文本片段，每条包含 <code>name</code> /{' '}
      <code>content</code> / <code>priority</code> / <code>enabled</code> 与一个作用域。 入口是{' '}
      <strong>设置 → 规则</strong>。
    </p>
    <table>
      <thead>
        <tr>
          <th>作用域 scope</th>
          <th>设置页分组</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>system</code>
          </td>
          <td>System（SYS）</td>
          <td>
            应用内置，只读；只能启用/停用，不能改内容、不能删除。首次会写入两条种子规则「安全约束」「代码风格」
          </td>
        </tr>
        <tr>
          <td>
            <code>team</code>
          </td>
          <td>Team（TEAM）</td>
          <td>团队管理员发布的规则</td>
        </tr>
        <tr>
          <td>
            <code>user</code>
          </td>
          <td>User（USER）</td>
          <td>用户全局偏好</td>
        </tr>
        <tr>
          <td>
            <code>project</code>
          </td>
          <td>Project（PROJ）</td>
          <td>
            可带 <code>scopeRef</code>（工作区 id）；为空时对所有工作区生效
          </td>
        </tr>
        <tr>
          <td>
            <code>session</code>
          </td>
          <td>Session（SESS）</td>
          <td>会话级临时规则</td>
        </tr>
      </tbody>
    </table>
    <p>
      注意设置页 Project 分组下方的说明文案写的是「.spark/rules · 当前工作区」，但代码里
      <strong>
        没有任何地方读取 <code>.spark/rules/</code> 目录
      </strong>
      ：项目规则同样存在 <code>rules</code> 表里。新增/编辑面板只有「名称 / 内容 /
      优先级」三个字段，没有 scopeRef 选择器， 因此从界面新建的 project 规则 <code>scopeRef</code>{' '}
      为空、对所有工作区生效。
    </p>
    <p>
      <strong>真实生效链路（每 turn 组装系统提示词时）：</strong>
    </p>
    <ol>
      <li>
        取所有 <code>enabled</code> 的 <code>system</code> 规则。
      </li>
      <li>
        取 <code>enabled</code> 的 <code>project</code> 规则，且 <code>scopeRef</code>{' '}
        为空或等于当前 primary workspace id。
      </li>
      <li>
        取「受管规则」：Agent 配置里勾选的规则（<code>agent.ruleIds</code>）+ Workflow
        节点配置里勾选的规则 （节点 <code>config.ruleIds</code>），按 <code>priority</code> 降序。
      </li>
      <li>
        以上合并去重后拼成 <code>[Runtime Rules]</code> 段落注入系统提示词。
      </li>
    </ol>
    <p>三个勾选入口都能在界面上找到：</p>
    <ul>
      <li>设置 → 规则：分层列表，System 只读、其余可增删改与启停。</li>
      <li>
        Agent 编辑面板 →「规则」区（描述：约束 Agent 的行为与输出），多选 <code>ruleIds</code>。
      </li>
      <li>
        Workflow 节点 Inspector →「规则」字段，多选 <code>ruleIds</code>。
      </li>
    </ul>
    <p>另外有两条容易混淆的链路：</p>
    <ul>
      <li>
        <strong>项目规则文件</strong>是独立链路：<code>project-context.service.ts</code>{' '}
        会读取工作区里的 <code>AGENTS.md</code> / <code>CLAUDE.md</code>（以及 <code>.claude/</code>
        、<code>.codex/</code>、<code>.agents/</code> 下的同名文件）作为项目上下文，与 rules
        表无关。
      </li>
      <li>
        <code>rules:compose</code>（<code>RuleCompositionEngine</code>，作用域优先级{' '}
        <code>system &lt; team &lt; user &lt; project &lt; session</code>，支持{' '}
        <code>override</code>/<code>merge</code>）<strong>目前只经 IPC 暴露</strong>，没有接进 turn
        组装链路。 也就是说「按作用域优先级合并」是需要显式调用才成立的能力，不是默认行为。
      </li>
    </ul>

    <h2 id="hooks">4. Hooks：两套并存的系统</h2>
    <p>设置里只有一个「Hooks」入口，但它下面挂着两套互不相同的机制，注意别混用名称。</p>
    <p>
      <strong>① 经典 Hooks（通知/提示音）</strong>
    </p>
    <ul>
      <li>
        节点只有四个：<code>permission_request</code>（权限申请）、<code>ask_user_question</code>
        （Agent 提问）、
        <code>session_end</code>（Turn 正常结束）、<code>session_fail</code>（运行出错）。
      </li>
      <li>
        每个节点可分别开关「提示音」与「系统通知」，总开关是 <code>enabled</code>，默认全开。
      </li>
      <li>
        配置存在 <code>app_settings</code> 的 <code>hooks/data</code>（渲染端还同步一份到
        localStorage 以即时渲染）， 触发走 <code>hook:trigger</code> / <code>hook:play-sound</code>{' '}
        / <code>hook:show-notification</code>。
      </li>
      <li>界面位置：设置 → Hooks 页面底部的「经典通知」区块，可逐节点「测试」。</li>
    </ul>
    <p>
      <strong>② Hooks V2（生命周期事件 + 动作）</strong>
    </p>
    <ul>
      <li>
        事件名是点号形式，共 7 个：<code>turn.started</code>、<code>permission.requested</code>、
        <code>question.requested</code>、<code>response.committed</code>、
        <code>turn.completed</code>、<code>turn.failed</code>、<code>turn.cancelled</code>。
      </li>
      <li>
        动作目前三类：<code>builtin.notification</code>（系统通知，可模板化 title/body）、
        <code>builtin.sound</code>（提示音）、<code>tool.invoke</code>（调用统一工具目录里的工具，
        保存的是稳定引用 <code>sourceKind</code> + <code>sourceId</code> + <code>toolName</code>）。
      </li>
      <li>
        作用域是 <code>application</code> / <code>workspace</code> / <code>agent</code> /{' '}
        <code>session</code>； 它们是同一上下文的匹配集合，<strong>不是继承树</strong>
        ，确定性优先级为 <code>session &gt; agent &gt; workspace &gt; application</code>
        。更高优先级可以显式停用低优先级绑定。
      </li>
      <li>
        绑定安全：绑定时记录授权的 <code>executionHash</code>；定义改动后哈希变化，绑定进入{' '}
        <code>needs_review</code> 并不再自动执行，需要重新授权。
      </li>
      <li>
        执行语义：事件先写入 <code>hook_events</code>（outbox），由 dispatcher 派发到{' '}
        <code>hook_runs</code> 队列，worker 每 2 秒轮询领取执行。默认超时 15 秒；重试策略默认{' '}
        <code>unsafe</code>（失败不重试）， 可改为 <code>safe</code>/<code>keyed</code>，最多 10
        次、指数退避。
      </li>
      <li>
        运行状态枚举：<code>queued</code> / <code>running</code> / <code>succeeded</code> /{' '}
        <code>failed</code> / <code>skipped</code> / <code>blocked</code> / <code>cancelled</code> /{' '}
        <code>outcome_unknown</code>。界面可查看运行记录并重试/取消。
      </li>
      <li>
        应用级总开关：关闭 = 停止领取 + 尽力取消运行中的动作；无法确认结果的运行落到{' '}
        <code>outcome_unknown</code>，它<strong>不会</strong>回滚已经发生的外部副作用。
      </li>
      <li>
        关键设计：Hook 由宿主确定性地在生命周期事实上触发（<code>permission.requested</code> 由
        PermissionService 在真实进入等待时发射），不是让模型在提示词里自己决定要不要调 Hook。
      </li>
      <li>
        IPC 前缀是 <code>hookV2:</code>：定义 CRUD、绑定
        upsert、生效列表、运行记录、系统状态与开关、 预览、工具候选、试运行。
      </li>
    </ul>

    <h2 id="usage">5. 用量账本</h2>
    <p>
      用量落在 SQLite 表 <code>usage_ledger</code>，字段为：<code>session_id</code>、
      <code>provider_id</code>、<code>model_id</code>、<code>input_tokens</code>、
      <code>output_tokens</code>、<code>reasoning_output_tokens</code>、
      <code>cache_read_tokens</code>、<code>cache_write_tokens</code>、<code>cost_usd</code>、
      <code>request_timestamp</code>、<code>created_at</code>。写入点是 per-turn 的增量核算（
      <code>session/session-usage-ledger.ts</code>）， 按 turn
      累计基线去重，避免同一份快照重复入账。
    </p>
    <p>界面入口与能看到什么：</p>
    <table>
      <thead>
        <tr>
          <th>入口</th>
          <th>内容</th>
          <th>数据来源</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>设置 → 用量统计</td>
          <td>
            本月概览（请求数 / 输入 / 输出 / 缓存命中 /
            缓存写入）、累计统计、用量排行（模型·渠道两个 tab + 时间区间）、最近请求列表
          </td>
          <td>
            <code>usage:get-dashboard</code>、<code>usage:get-by-date-range</code>
          </td>
        </tr>
        <tr>
          <td>设置 → 用量统计 → 数据管理</td>
          <td>
            刷新数据；「清理旧记录」删除 90 天以前明细（<code>olderThanDays: 90</code>）
          </td>
          <td>
            <code>usage:purge</code>
          </td>
        </tr>
        <tr>
          <td>设置 → 通用（页面顶部）</td>
          <td>用量热力图与模型用量趋势卡</td>
          <td>
            <code>usage:get-by-date-range</code>
          </td>
        </tr>
        <tr>
          <td>同一张「用量排行」卡片的渠道 tab</td>
          <td>渠道维度的用量拆分（由模型分组数据在前端二次聚合）</td>
          <td>
            <code>usage:get-by-date-range</code> 的 modelGroups
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      协议里还有 <code>usage:record</code> 与 <code>usage:get-session</code>（会话级汇总）。
      需要明确的是：<strong>当前没有 CSV/JSON 导出，也没有月度预算提醒</strong>——
      旧文档写过这两项，代码里找不到对应实现。
    </p>

    <h2 id="audit">6. 审计与排错：现在真实存在的记录</h2>
    <p>
      重要事实：<strong>没有「设置 → 审计」这一页，也没有统一的全量审计面板</strong>。
      可追溯性由下面几块拼起来：
    </p>
    <ul>
      <li>
        <strong>本地日志（设置 → 本地日志）</strong>：读写运行时日志文件，视图可切换{' '}
        <code>all</code> / <code>canvas</code>（画布任务）/ <code>tools</code>（工具运行）三个范围，
        按 <code>debug</code>/<code>info</code>/<code>warn</code>/<code>error</code>{' '}
        过滤，支持关键词过滤， 单次最多读 500 行；操作有刷新、导出、在文件夹中显示、清空。对应 IPC：
        <code>log:read</code>、<code>log:clear</code>、<code>log:reveal</code>。
        日志级别与「运行时日志」开关同在设置 → 本地日志页。
      </li>
      <li>
        <strong>会话时间线</strong>：审批超时/会话取消会写 <code>agent_error</code> 事件 （
        <code>PERMISSION_TIMEOUT</code> / <code>PERMISSION_CANCELLED</code>）， 这是回答「Agent
        为什么跳过了这一步」的权威位置。
      </li>
      <li>
        <strong>
          权限记忆表 <code>permission_decisions</code>
        </strong>
        ：记录 scope（project/global）、
        <code>action</code>、<code>tool_name</code>、decision（allow/deny）。目前没有列出它的界面，
        排查时只能查库。
      </li>
      <li>
        <strong>
          Hook 运行记录表 <code>hook_runs</code>
        </strong>
        ：设置 → Hooks 内可查看与重试/取消。
      </li>
      <li>
        <strong>
          插件运行时审计表 <code>plugin_runtime_audit</code>
        </strong>{' '}
        与跨会话引用审计表 <code>session_reference_audit</code>：各自模块内部使用。
      </li>
    </ul>
    <p>
      账号同步（设置 → 账号同步）覆盖的是 customCommands / prompts / memory / assistants / workflows
      / appearance / promptLibrary 这些类目，<strong>不包含权限、用量与审计数据</strong>；
      这些数据都只在本机 SQLite。
    </p>

    <h2 id="pitfalls">7. 常见坑与排查</h2>
    <ul>
      <li>
        <strong>改了规则却感觉没生效</strong>：规则只参与「到达审批时的 allow/ask/deny 判定」，
        而工具是否被送到审批回调由会话权限模式（SDK 层）决定。也是历史 bug 的高发点——
        早期审批回调固定 <code>forcePrompt: true</code>
        ，导致设置页改的规则从不生效，现在已改为先过当前 Profile 规则判定。
      </li>
      <li>
        <strong>「完全访问」不是更聪明，而是不拦</strong>：<code>claude-bypass</code>/
        <code>codex-full-access</code>/<code>spark-bypass</code> 跳过人工审批：Spark 的{' '}
        <code>spark-bypass</code> 界面描述就是「跳过全部审批与规则，完全由 agent 执行」。
        设置页在选中 danger 档位时会显示「当前默认策略会跳过人工审批……」的警告。
      </li>
      <li>
        <strong>新会话没继承你刚改的默认策略</strong>：<code>runtime-permissions/defaults</code>{' '}
        只作用于新会话与 无会话输入区；已有会话请在会话内切换权限下拉，或通过{' '}
        <code>session:update</code> 改。
      </li>
      <li>
        <strong>没登记过的第三方工具被当成命令执行类目</strong>：动作映射里查不到的工具会兜底为{' '}
        <code>command_exec</code>，于是「执行 shell 命令」这条规则会意外约束它。别在设置页找
        「browser_navigate」这种按工具名的开关——不存在。
      </li>
      <li>
        <strong>会话允许/拒绝重启就没了</strong>：这两个决策只在内存中生效；跨重启的长期记忆只有
        project/global 两档（<code>permission_decisions</code> 表）。
      </li>
      <li>
        <strong>长时间离开导致任务被跳过</strong>：审批 30
        分钟自动按拒绝处理，任务会继续走但跳过该操作， 事后到会话时间线看{' '}
        <code>PERMISSION_TIMEOUT</code> 记录即可确认。
      </li>
      <li>
        <strong>
          以为 <code>.spark/rules/</code> 里的文件会被读取
        </strong>
        ：不会。项目规则请用设置 → 规则， 或直接写工作区的 <code>AGENTS.md</code> /{' '}
        <code>CLAUDE.md</code>（那是项目上下文链路）。
      </li>
      <li>
        <strong>Hook 定义改了之后不再执行</strong>：这是有意的安全设计——<code>executionHash</code>{' '}
        变化会让绑定进入
        <code>needs_review</code>，需要在绑定里重新授权。
      </li>
    </ul>

    <h2 id="best-practices">8. 最佳实践</h2>
    <ul>
      <li>
        日常开发用 <code>project-standard</code> + 对应适配器的「自动编辑 / 按需批准」；
        <code>command_dangerous</code> 保持 <code>ask-twice</code>，删除类命令自然会撞上双重确认。
      </li>
      <li>
        团队统一约束不要写在 <code>.spark/rules/</code>：用 <code>team</code> 作用域规则，
        或者把约定写进仓库的 <code>AGENTS.md</code>（项目上下文会读取，且随 git 走）。
      </li>
      <li>
        需要「某个 Agent 只额外遵守这几条规则」时，用 Agent
        编辑面板的「规则」多选，而不是给全局加规则； Workflow 节点同理，用节点 Inspector
        的「规则」字段。
      </li>
      <li>
        Hook 的 <code>tool.invoke</code>{' '}
        动作会真实触发外部副作用，且应用级开关关闭时不回滚已发生的动作；
        先用界面上的「试运行/预览」验证条件与映射。
      </li>
      <li>
        用量清理是有损操作（删除 90 天以前的明细）。需要长期留存请在清理前用数据库备份（设置 →
        存储与备份）。
      </li>
      <li>
        排查顺序建议：会话时间线（是不是被跳过/超时）→ 本地日志（tools 范围看工具调用）→ 权限
        Profile 与 会话权限模式（为什么被拦/为什么没弹卡）→ <code>permission_decisions</code>{' '}
        表（是不是被记住放行了）。
      </li>
    </ul>
  </>
)

export const governance: DocsPageContent = {
  slug: 'governance',
  toc: [
    { id: 'approval', title: '1. 第一层：会话权限模式（SDK 层）', level: 2 },
    { id: 'approval-flow', title: '2. 第二层：权限 Profile 规则与审批卡', level: 2 },
    { id: 'rules', title: '3. Rules：注入 prompt 的策略片段', level: 2 },
    { id: 'hooks', title: '4. Hooks：两套并存的系统', level: 2 },
    { id: 'usage', title: '5. 用量账本', level: 2 },
    { id: 'audit', title: '6. 审计与排错：现在真实存在的记录', level: 2 },
    { id: 'pitfalls', title: '7. 常见坑与排查', level: 2 },
    { id: 'best-practices', title: '8. 最佳实践', level: 2 },
  ],
  faq: [
    {
      question:
        '「请求批准 / 自动编辑 / 完全访问」和设置里的「允许 / 询问 / 双重确认 / 拒绝」是什么关系？',
      answer:
        '前者是会话权限模式（SDK 层，按适配器不同，例如 claude-ask / claude-auto / claude-bypass），决定工具调用是否被送进审批回调；后者是权限 Profile 里的动作类目规则，决定到达审批时是自动放行、自动拦截还是弹卡。两层叠加生效。',
    },
    {
      question: '审批卡上的「会话允许」会写进数据库吗？',
      answer:
        '不会。会话允许/会话拒绝只写内存，重启应用即失效；会落库的是 project/global 两档记忆（permission_decisions 表），但当前审批卡没有提供项目/全局授权按钮。',
    },
    {
      question: '审批一直不点会怎样？',
      answer:
        '30 分钟后按拒绝继续执行，卡片会自动收起，并在会话时间线写入一条 agent_error（PERMISSION_TIMEOUT），文案说明等待了多少分钟、跳过了哪个工具。',
    },
    {
      question: 'Rules 的 System / Team / User / Project / Session 是继承关系吗？',
      answer:
        '不是。Rules 的作用域只是存储与分组维度：每 turn 实际注入的是「启用的 system 规则 + 启用的 project 规则（scopeRef 为空或等于当前工作区）+ Agent 勾选的规则 + Workflow 节点勾选的规则」。带优先级合并语义的 rules:compose 是另一条未接入 turn 链路的 IPC 能力。',
    },
    {
      question: 'Hooks 里怎么在权限弹卡时发通知？',
      answer:
        '用 Hooks V2 的 permission.requested 事件配 builtin.notification 动作（经典 Hooks 的 permission_request 节点只能开提示音/系统通知，不能带条件判断）。注意 Hook 定义改动后绑定会进入 needs_review，需要重新授权才继续执行。',
    },
    {
      question: '用量数据能导出吗？能设置月度预算提醒吗？',
      answer:
        '当前都不能。用量只在设置 → 用量统计与设置 → 通用的热力图/趋势卡里查看，数据管理只有「刷新」与「清理 90 天以前明细」。需要长期留存请用设置 → 存储与备份做数据库备份。',
    },
  ],
  quickReference: [
    {
      key: '权限模式（claude）',
      value:
        'claude-ask 请求批准 / claude-plan 计划模式 / claude-auto-edits 自动编辑 / claude-auto 自动审批 / claude-bypass 完全访问',
    },
    {
      key: '权限模式（codex）',
      value: 'codex-default 按需批准 / codex-auto-review 替我批准 / codex-full-access 完全访问',
    },
    {
      key: '权限模式（spark）',
      value: 'spark-default 手动审批 / spark-auto 自动审批 / spark-bypass 完全访问',
    },
    { key: '规则模式', value: 'allow 允许 / ask 询问 / ask-twice 双重确认 / deny 拒绝' },
    {
      key: '权限 Profile',
      value:
        'strict 一切都问 / project-standard 工作区写入自动允许（默认） / trusted 自动允许大多数',
    },
    {
      key: '动作类目',
      value:
        'file_read · file_write · command_exec · command_dangerous · network_known · network_unknown · mcp_tool',
    },
    { key: '审批超时', value: '30 分钟，超时按拒绝处理并写 PERMISSION_TIMEOUT' },
    {
      key: 'Rules 作用域',
      value: 'system / team / user / project / session（规则存 SQLite，不读 .spark/rules/）',
    },
    {
      key: 'Hook V2 事件',
      value:
        'turn.started · permission.requested · question.requested · response.committed · turn.completed · turn.failed · turn.cancelled',
    },
    {
      key: 'Hook 作用域',
      value:
        'application / workspace / agent / session，优先级 session > agent > workspace > application',
    },
    { key: '用量表', value: 'usage_ledger（tokens / 缓存读写 / cost_usd / request_timestamp）' },
    {
      key: '排错入口',
      value: '设置 → 本地日志（all / canvas / tools，最多 500 行）+ 会话时间线 agent_error',
    },
  ],
  howTo: {
    name: '给一台新机器配好权限治理',
    description: '从默认策略、Profile 到规则与排错入口，一次配齐',
    totalTime: 'PT10M',
    steps: [
      '打开 设置 → 权限策略，在「SDK 执行默认策略」里选默认执行器（Claude SDK / Codex / Spark）与默认权限策略（新会话生效）',
      '在同一页的「权限 Profile」里选中 project-standard；把 command_dangerous 保持「双重确认」，按团队要求调整 file_write / network_unknown',
      '打开 设置 → 规则，在 User 或 Project 分组新增一条规则（名称 + 内容 + 优先级）；System 分组只读，不要指望能改',
      '如果只想让某个 Agent 遵守这几条规则，去 Agent 编辑面板的「规则」区勾选；Workflow 场景在节点 Inspector 的「规则」字段勾选',
      '需要事件回调时打开 设置 → Hooks，用 Hooks V2 建定义（选 permission.requested 或 turn.failed，动作选 builtin.notification），再在绑定里授权 executionHash',
      '验证：跑一个会写文件的任务，确认审批卡出现/不出现的时机符合预期；随后在 设置 → 本地日志（tools 范围）与会话时间线确认记录',
    ],
  },
  aiSummary:
    'SparkWork 权限治理由两层组成：会话权限模式（claude-ask/claude-plan/claude-auto-edits/claude-auto/claude-bypass、codex-default/codex-auto-review/codex-full-access、spark-default/spark-auto/spark-bypass）决定 SDK 是否把工具调用送进审批；' +
    '权限 Profile（strict / project-standard / trusted）与七个动作类目（file_read、file_write、command_exec、command_dangerous、network_known、network_unknown、mcp_tool）的 allow/ask/ask-twice/deny 规则决定自动放行或弹卡，审批卡只有拒绝、会话拒绝、会话允许、允许四个按钮，30 分钟超时按拒绝处理并写会话时间线。' +
    'Rules 存在 SQLite 的 rules 表，作用域为 system/team/user/project/session，每 turn 注入启用的 system + project + Agent 勾选 + Workflow 节点勾选的规则，不读取 .spark/rules/ 目录。' +
    'Hooks 分经典通知节点与 Hooks V2（7 个生命周期事件、内置通知/提示音/tool.invoke 动作、application/workspace/agent/session 作用域、hook_events → hook_runs → worker 链路）。' +
    '用量账本在 usage_ledger 表，入口是设置 → 用量统计（本月/累计/排行/最近请求/清理 90 天）与设置 → 通用的热力图；审计没有统一面板，实际可用的是本地日志、会话时间线 agent_error、permission_decisions、hook_runs 等表。',
  Body,
}

export default governance
