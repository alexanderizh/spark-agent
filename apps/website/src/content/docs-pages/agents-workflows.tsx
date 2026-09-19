import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Agent 是 Spark Work 里「会用工具的模型角色」。它是一份可复用配置：绑哪个 Provider 和模型、
      用哪个执行器、权限和推理强度多大、带哪些 Skills / Rules / Hook、要不要挂工作流。
      会话启动时，运行时把这些配置连同项目上下文一起拼成系统提示词注入模型。
    </p>

    <h2 id="agent-fields">1. Agent 的真实字段</h2>
    <p>
      入口：左侧导航「助手」→ 顶部 <strong>Agents</strong> 标签 → 点开某个 Agent 进入编辑页
      （同一个页面还有 <strong>Teams</strong> 标签，见「团队模式」一篇）。
    </p>

    <h3 id="fields-core">1.1 基本信息与执行器</h3>
    <table>
      <thead>
        <tr>
          <th>界面标签</th>
          <th>真实字段</th>
          <th>取值与说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>名称 / 描述</td>
          <td>
            <code>name</code> / <code>description</code>
          </td>
          <td>
            名称最长 30 字、描述最长 200 字（<code>AGENT_NAME_MAX</code> = 30 /{' '}
            <code>AGENT_DESC_MAX</code> = 200）。
          </td>
        </tr>
        <tr>
          <td>状态</td>
          <td>
            <code>enabled</code>
          </td>
          <td>停用后 Agent 不出现在选择器里，也不会被工作流或团队派发。</td>
        </tr>
        <tr>
          <td>默认 Agent</td>
          <td>
            <code>isDefault</code>
          </td>
          <td>同一时刻只有一个：设为默认时会清掉其他 Agent 的默认标记。</td>
        </tr>
        <tr>
          <td>头像</td>
          <td>
            <code>metadata.avatar</code>
          </td>
          <td>没有自定义头像时按 id/名称派生默认头像。</td>
        </tr>
        <tr>
          <td>Provider</td>
          <td>
            <code>providerProfileId</code>
          </td>
          <td>下拉里含「跟随会话」空值：留空表示用会话当前 Provider。</td>
        </tr>
        <tr>
          <td>默认模型</td>
          <td>
            <code>modelId</code>
          </td>
          <td>可选「Provider 默认」。用的是本地 CLI Provider 时该框只读并显示「跟随本地 CLI」。</td>
        </tr>
        <tr>
          <td>执行器 (SDK)</td>
          <td>
            <code>agentAdapter</code>
          </td>
          <td>
            <code>claude-sdk</code>（推荐）/ <code>codex</code> / <code>spark</code>。 新建默认{' '}
            <code>claude-sdk</code>；切换执行器会把权限模式重置为该执行器的默认值。
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      数据存在本地 SQLite 的 <code>agents</code> 表（<code>provider_profile_id</code>、
      <code>model_id</code>、<code>agent_adapter</code> 等列），平台侧 <code>agents_*</code> MCP
      工具与编辑页写的是同一份数据。
    </p>

    <h3 id="fields-model">1.2 权限模式与推理强度</h3>
    <p>权限模式不是一组通用枚举，而是按执行器分组的：界面只列出当前执行器合法的那几档。</p>
    <table>
      <thead>
        <tr>
          <th>执行器</th>
          <th>可选权限模式</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>claude-sdk</code>
          </td>
          <td>
            <code>claude-ask</code>（请求批准）、<code>claude-plan</code>（计划模式）、
            <code>claude-auto</code>（自动审批）、<code>claude-bypass</code>（完全访问）
          </td>
        </tr>
        <tr>
          <td>
            <code>codex</code>
          </td>
          <td>
            <code>codex-default</code>（按需批准，workspace-write）、
            <code>codex-auto-review</code>（替我批准）、
            <code>codex-full-access</code>（danger-full-access）
          </td>
        </tr>
        <tr>
          <td>
            <code>spark</code>
          </td>
          <td>
            <code>spark-default</code>（手动审批）、<code>spark-auto</code>（自动审批）、
            <code>spark-bypass</code>（完全访问）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      会话工具栏里还有 <code>claude-auto-edits</code>（自动编辑，自动批准文件编辑）；
      <code>spark-accept-edits</code> 与 <code>spark-plan</code> 是旧版残留值，只对存量会话生效，
      新配置里不会出现。
    </p>
    <ul>
      <li>
        <strong>推理强度</strong>：<code>reasoningEffort</code>，六档
        <code>minimal / low / medium / high / xhigh / max</code>。新建 Agent 的草稿默认
        <code>medium</code>；直接经平台 MCP 创建时数据库列默认 <code>max</code>。
      </li>
      <li>
        <strong>推理 Token 预算</strong>：<code>metadata.reasoningBudgetTokens</code>， 范围 1024 ~
        128000，<strong>只对 Claude SDK 的显式 extended thinking 生效</strong>；
        其他执行器上该输入框禁用，留空表示由 SDK / 模型自行决定。
      </li>
      <li>
        <strong>提示词</strong>：<code>prompt</code>，编辑页里标题是「提示词 / System Prompt」，
        支持全屏编辑。它注入成 <code>[Agent Instructions]</code> 段，与终端里 Claude Code 的
        <code>CLAUDE.md</code> 不是一回事。
      </li>
    </ul>

    <h3 id="fields-capability">1.3 能力面：Skills、Rules、Hook、Workflow</h3>
    <ul>
      <li>
        <strong>Skills</strong>：<code>skillIds</code> + <code>disabledSkillIds</code>。 新建 Agent
        会预选 <code>builtin:multi-search-engine</code>、<code>builtin:browser-use</code>、
        <code>builtin:platform-manager</code>、<code>builtin:find-skills</code>；其中
        <code>builtin:platform-manager</code> 由仓储层强制注入，任何 Agent 都摘不掉。
      </li>
      <li>
        <strong>规则</strong>：<code>ruleIds</code>。这里勾选的规则会与工作流节点上配置的
        <code>ruleIds</code> 合并进 <code>[Runtime Rules]</code>。
      </li>
      <li>
        <strong>Hook</strong>：编辑页右栏的「Hook」区块展示的是 Hook 定义的绑定与授权状态 （生效中 /
        待重新授权 / 已停用），可以在这里启用、停用或覆盖本 Agent 的绑定。
      </li>
      <li>
        <strong>工作流</strong>：<code>workflowId</code>，可选。留空时 <code>workflowId</code> 为
        null， Agent 按普通单 Agent 流程跑。
      </li>
    </ul>

    <h3 id="fields-workspace">1.4 工作目录不由 Agent 决定</h3>
    <p>
      Agent 配置里<strong>没有</strong>「工作目录」字段。Agent
      在哪个目录里干活，取决于会话绑定的项目 （<code>workspace</code>）或临时会话目录；这也是同一个
      Agent 在不同项目里表现不同的原因。
      「助手」页的「快速对话」会先让你选项目，或直接进入临时会话。
    </p>

    <h2 id="runtime-injection">2. 会话启动时注入了什么</h2>
    <p>
      一次 turn
      的系统提示词由多个独立段拼成，下面按实际拼装顺序列出主要段落（不适用于当前会话的段会整段跳过）：
    </p>
    <ol>
      <li>应用基础提示词、工具使用指引。</li>
      <li>
        <strong>[Managed Agent]</strong>：Agent 名称与 id、描述、你的 <code>prompt</code>
        （写为 <code>[Agent Instructions]</code>）。
      </li>
      <li>
        <strong>[Workflow Execution Plan]</strong>：仅当该 Agent（或会话覆盖）绑定了工作流时注入，
        这是 [Managed Agent] 段内的一部分；节点按拓扑顺序列出，并附边与条件。
      </li>
      <li>
        团队相关段：[Orchestration Mode]、[Team Roster]、[Team Instructions]（见团队模式一篇）。
      </li>
      <li>工作区与 worktree 状态提示。</li>
      <li>
        <strong>[Runtime Rules]</strong>：应用里启用中的 Rules（按 <code>scope_ref</code>{' '}
        匹配当前项目） + Agent 的 <code>ruleIds</code> + 工作流节点上的 <code>ruleIds</code>
        ，按优先级排序、 去重后编号列出。
      </li>
      <li>
        项目上下文：项目里的 <code>AGENTS.md</code>、<code>CLAUDE.md</code> 等规则文件， 按 token
        预算裁剪后注入。项目级 Skill 走独立的 skill system prompt 通道，不在这一串段落里。
      </li>
      <li>长期记忆摘要与记忆行为引导。</li>
      <li>
        对话历史之后还有一个 <strong>[Current Workflow Binding — Authoritative]</strong> 段：
        声明本轮唯一生效的工作流身份，覆盖提示词或历史里出现的其他工作流名称。
      </li>
    </ol>
    <p>
      另外，工作流有三种执行强度，由「执行器 + 是否有可执行节点」决定：
      <code>workflow_run</code>（Claude SDK 且存在可派发节点，运行时真实驱动图）、
      <code>codex_guided</code>（Codex / Spark 路径，不给 <code>workflow_run</code> 工具，
      由模型按拓扑顺序自己推进）、<code>guided</code>（没有托管执行器或这是 @ 提及轮）。
      界面上的文案分别是「托管执行」「引导执行」「不执行」。
    </p>

    <h2 id="mcp-auto">3. MCP 与工具怎么挂载</h2>
    <p>
      Agent 的 <code>mcpServerIds</code> 是<strong>兼容字段，运行时忽略</strong>。 平台 MCP 的{' '}
      <code>agents_create</code> / <code>agents_update</code> 工具参数里，
      它的描述原文就是「兼容字段，运行时忽略；所有已启用 MCP 会自动对 Agent 可用」。 编辑页的「MCP
      服务」区块也只列出当前已启用的服务器并写明「所有已启用的 MCP 对该 Agent 自动可用，
      无需单独绑定」。
    </p>
    <p>实际规则：</p>
    <ul>
      <li>
        会话、团队成员、<code>agent/subagent/skill/tool/mcp</code> 节点的 MCP 服务器集合都来自
        「应用级已启用 MCP」这一处开关。
      </li>
      <li>
        <strong>唯一例外是只读原子节点</strong>：
        <code>input / route / plan / review / artifact</code>
        运行时从空能力集起步，<strong>不挂任何 MCP</strong>，也不注入项目级 Skill 提示词——
        它们只负责解析、计划与复核，不接触外部系统。
      </li>
      <li>
        想缩小能力面，不要去找 Agent 白名单，而是到 MCP 管理页停用服务；在工作流节点上用
        <code>toolIds</code> 收窄内置工具（见工作流编排一篇）。
      </li>
      <li>
        工作流节点上残留的 <code>config.mcpServerIds</code> 字段旧数据仍会被读取成「该 worker 的 MCP
        选择」， 但编辑器已经不提供这个入口，新图不要再依赖它。
      </li>
      <li>
        Agent 选中的 Skill 会进入运行时技能目录，模型按需加载；Skill 与 MCP 是两套独立能力来源。
      </li>
    </ul>

    <h2 id="hooks">4. Hook：生命周期事件与经典通知</h2>
    <p>
      Hook 现在是宿主确定性调度的「观察型」机制：事件发生了才执行动作，不改变已经发生的结果。
      配置入口有两处：<strong>设置 → Hooks</strong>（定义、绑定、运行记录），以及
      <strong>Agent 编辑页 → Hook</strong>（该 Agent 的绑定与授权状态）。
    </p>
    <table>
      <thead>
        <tr>
          <th>事件名</th>
          <th>界面文案</th>
          <th>触发时机</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>turn.started</code>
          </td>
          <td>Turn 开始</td>
          <td>Turn 已建立、准备进入执行管线</td>
        </tr>
        <tr>
          <td>
            <code>permission.requested</code>
          </td>
          <td>权限请求</td>
          <td>权限请求进入等待审批</td>
        </tr>
        <tr>
          <td>
            <code>question.requested</code>
          </td>
          <td>Agent 提问</td>
          <td>Agent 提问进入等待用户输入</td>
        </tr>
        <tr>
          <td>
            <code>response.committed</code>
          </td>
          <td>回答已提交</td>
          <td>最终回答成功落库、正文确定</td>
        </tr>
        <tr>
          <td>
            <code>turn.completed</code>
          </td>
          <td>Turn 完成</td>
          <td>Turn 成功终态已持久化</td>
        </tr>
        <tr>
          <td>
            <code>turn.failed</code>
          </td>
          <td>Turn 失败</td>
          <td>Turn 进入不可恢复失败终态</td>
        </tr>
        <tr>
          <td>
            <code>turn.cancelled</code>
          </td>
          <td>Turn 已取消</td>
          <td>用户或系统明确取消 Turn</td>
        </tr>
      </tbody>
    </table>
    <ul>
      <li>
        <strong>动作</strong>：<code>builtin.notification</code>（系统通知）、
        <code>builtin.sound</code>（提示音）、
        <code>tool.invoke</code>（调用连接器 / 自定义工具 / 工具包里的某个工具）。
      </li>
      <li>
        <strong>条件与取值</strong>：支持 <code>eq / notEq / exists / contains / startsWith</code>与{' '}
        <code>and / or / not</code> 组合；取值表达式只有常量、事件路径、模板字符串三种，
        不会执行用户脚本。
      </li>
      <li>
        <strong>执行策略</strong>：超时默认 15 秒；重试策略 <code>mode</code> 为
        <code>safe / keyed / unsafe</code>（默认 <code>unsafe</code>）、默认最多 3 次、退避基数
        1000ms； 并发策略 <code>serial_per_session</code> 或 <code>parallel</code>。
      </li>
      <li>
        <strong>绑定与授权</strong>：作用域分 <code>application / workspace / agent / session</code>{' '}
        四级， 绑定必须带授权（<code>authorizeExecutionHash</code>）才会执行；定义改动后哈希不一致，
        绑定会退回「待重新授权」。
      </li>
      <li>
        <strong>经典通知</strong>：设置 → Hooks 页底部还保留旧的 sound/notification 配置 （节点为{' '}
        <code>permission_request / ask_user_question / session_end / session_fail</code>）， 它与 V2
        并联但不会双发；<code>permission_request</code> 这条仍走旧路径。 Agent 表里的{' '}
        <code>hook_config</code> 列就是这份旧配置。
      </li>
    </ul>

    <h2 id="platform-tools">5. spark_platform：Agent 能管理平台自己</h2>
    <p>
      每个会话都挂载内置 MCP <code>spark_platform</code>，工具全名为
      <code>mcp__spark_platform__&lt;tool&gt;</code>。按工具族划分：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具族</th>
          <th>能力</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>skills_*</code>
          </td>
          <td>
            list / load / search / search_github / install / install_github / uninstall / toggle
          </td>
        </tr>
        <tr>
          <td>
            <code>mcp_*</code>
          </td>
          <td>list / create / update / delete / status</td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_*</code>
          </td>
          <td>
            guide / list / get / validate / create_draft / save_draft / test / publish / set_enabled
            / rollback / delete
          </td>
        </tr>
        <tr>
          <td>
            <code>tool_packages_*</code>
          </td>
          <td>
            guide / list / get / inspect / create_project / install_* / set_permission / test /
            uninstall 等
          </td>
        </tr>
        <tr>
          <td>
            <code>providers_*</code>
          </td>
          <td>
            list / get / create / update / delete / health_check / set_default /
            set_default_model，另有 providers_media_* 渠道校验与诊断
          </td>
        </tr>
        <tr>
          <td>
            <code>workflows_*</code>
          </td>
          <td>list / get / create / update / delete</td>
        </tr>
        <tr>
          <td>
            <code>agents_*</code>
          </td>
          <td>list / get / create / update / delete</td>
        </tr>
        <tr>
          <td>
            <code>teams_*</code>
          </td>
          <td>list / get / create / update / delete</td>
        </tr>
        <tr>
          <td>
            <code>board_*</code>
          </td>
          <td>
            list / get / create / update / delete / batch_create / batch_update / batch_delete /
            restore / permanent_delete
          </td>
        </tr>
        <tr>
          <td>
            <code>settings_*</code>
          </td>
          <td>get / set / get_category / get_all</td>
        </tr>
        <tr>
          <td>
            <code>sessions_*</code>
          </td>
          <td>
            get / switch_model / switch_provider / switch_mode / switch_permission /
            switch_reasoning_effort
          </td>
        </tr>
        <tr>
          <td>
            <code>session_schedule_*</code>
          </td>
          <td>list / get / create / update / delete（仅当前会话）</td>
        </tr>
        <tr>
          <td>
            <code>session_history_*</code>
          </td>
          <td>list / read / search（本会话压缩前的完整历史）</td>
        </tr>
        <tr>
          <td>
            <code>referenced_sessions_list</code> / <code>referenced_session_*</code>
          </td>
          <td>列出并读取已授权的参考会话</td>
        </tr>
        <tr>
          <td>
            <code>artifacts_*</code>
          </td>
          <td>list / resolve（自建安装源里的运行时与依赖包）</td>
        </tr>
        <tr>
          <td>
            <code>github_*</code>
          </td>
          <td>status / 仓库读取 / 建分支 / 写文件 / Issue 与 PR 读写</td>
        </tr>
        <tr>
          <td>
            <code>codex_runtime_*</code>
          </td>
          <td>diagnostics / restart_idle</td>
        </tr>
      </tbody>
    </table>
    <p>
      长期团队定义存在 <code>agent_teams</code> 表，用 <code>teams_*</code> 增删改查；创建团队前先用
      <code>agents_list</code> 拿到 host / member 的真实 agent id。
    </p>

    <h2 id="common-mistakes">6. 常见坑</h2>
    <ul>
      <li>
        <strong>以为 Agent 能限制 MCP</strong>：<code>mcpServerIds</code> 是兼容字段，填了也不生效。
        要收窄就停用 MCP 服务，或改用工作流节点的工具白名单。
      </li>
      <li>
        <strong>权限模式写错执行器</strong>：<code>claude-*</code>、<code>codex-*</code>、
        <code>spark-*</code> 三组互不通用。切执行器后表单会重置权限模式，但通过
        <code>agents_update</code> 直接写值时不会自动纠正。
      </li>
      <li>
        <strong>
          把 <code>spark-plan</code> / <code>spark-accept-edits</code> 当成现行枚举
        </strong>
        ： 它们是旧值，只在存量会话里被识别。
      </li>
      <li>
        <strong>把推理 Token 预算配给非 Claude SDK 的 Agent</strong>：不生效。
      </li>
      <li>
        <strong>在 Agent 里找「工作目录」</strong>：没有这个字段，目录来自会话绑定的项目。
      </li>
      <li>
        <strong>把 Hook 当成 Rule 用</strong>：Rule 是注入提示词的策略，Hook 是事件回调， 观察型
        Hook 无法改变已经发生的结果。
      </li>
    </ul>
  </>
)

export const agentsWorkflows: DocsPageContent = {
  slug: 'agents-workflows',
  toc: [
    { id: 'agent-fields', title: '1. Agent 的真实字段', level: 2 },
    { id: 'fields-core', title: '1.1 基本信息与执行器', level: 3 },
    { id: 'fields-model', title: '1.2 权限与推理强度', level: 3 },
    { id: 'fields-capability', title: '1.3 能力面与工作流绑定', level: 3 },
    { id: 'fields-workspace', title: '1.4 工作目录从哪来', level: 3 },
    { id: 'runtime-injection', title: '2. 会话启动时注入了什么', level: 2 },
    { id: 'mcp-auto', title: '3. MCP 与工具怎么挂载', level: 2 },
    { id: 'hooks', title: '4. Hook：生命周期事件与经典通知', level: 2 },
    { id: 'platform-tools', title: '5. spark_platform 管理工具', level: 2 },
    { id: 'common-mistakes', title: '6. 常见坑', level: 2 },
  ],
  faq: [
    {
      question: 'Agent 和会话（Session）是什么关系？',
      answer:
        'Agent 是配置模板（模型、执行器、权限、Skills、Rules、Hook、工作流绑定），会话是一次具体的对话。一个 Agent 可以被多个会话复用；工作目录、团队配置这类运行期状态挂在会话上，不在 Agent 上。',
    },
    {
      question: '我改了全局 MCP，为什么所有 Agent 都变了？',
      answer:
        '因为 Agent 的 mcpServerIds 是兼容字段、运行时忽略。所有已启用的 MCP 会自动挂载到会话、团队成员和工作流节点，停用一个 MCP 服务是全局生效的；要按节点收窄能力，用工作流节点的 toolIds。',
    },
    {
      question: 'Agent 里能单独给我配的模型设权限模式吗？',
      answer:
        '权限模式是 Agent 级字段（permissionMode），按执行器分组：claude-sdk 有 claude-ask/claude-plan/claude-auto/claude-bypass，codex 有 codex-default/codex-auto-review/codex-full-access，spark 有 spark-default/spark-auto/spark-bypass。切执行器时表单会自动把权限模式重置为对应默认值。',
    },
    {
      question: 'Workflow 是必填的吗？绑定后会怎样？',
      answer:
        '不是必填。workflowId 留空时 Agent 按普通流程跑。绑定后系统提示词里会多出 [Workflow Execution Plan]，并且 Claude SDK 路径在有可派发节点时会变成「托管执行」，由 workflow_run 真实驱动整张图。',
    },
    {
      question: 'Hook 写在哪里？和 Rule 有什么区别？',
      answer:
        'Hook 定义在「设置 → Hooks」创建，再绑定到 application/workspace/agent/session 作用域并授权；Agent 编辑页的 Hook 区块管的是本 Agent 的绑定状态。Rule 是注入提示词的策略，Hook 是事件发生后的动作（通知、提示音、调用工具），两者不要互相替代。',
    },
    {
      question: '为什么 Agent 的推理强度设置了却没感觉？',
      answer:
        '先确认执行器。推理强度对三种执行器都生效，但「推理 Token 预算」（reasoningBudgetTokens）只对 Claude SDK 的显式 extended thinking 有效，其他执行器上输入框是禁用的。',
    },
  ],
  quickReference: [
    { key: '默认 Agent', value: 'Spark助手（platform-manager-agent，内置、不可删除）' },
    { key: '编辑入口', value: '左侧「助手」→ Agents 标签' },
    { key: '执行器', value: 'claude-sdk / codex / spark（默认 claude-sdk）' },
    {
      key: '权限模式',
      value: 'claude 四档 / codex 三档 / spark 三档（按执行器分组）',
    },
    { key: '推理强度', value: 'minimal / low / medium / high / xhigh / max' },
    { key: 'MCP', value: 'mcpServerIds 为兼容字段被忽略；应用级已启用 MCP 全局自动挂载' },
    {
      key: 'Hook 事件',
      value:
        'turn.started / permission.requested / question.requested / response.committed / turn.completed / turn.failed / turn.cancelled',
    },
    { key: '平台 MCP', value: 'spark_platform（mcp__spark_platform__*）' },
    { key: '工作目录', value: '不在 Agent 上，来自会话绑定的项目或临时会话目录' },
  ],
  howTo: {
    name: '创建一个能跑真实任务的专属 Agent',
    description: '在「助手 → Agents」里配置模型、权限、技能与工作流绑定',
    totalTime: 'PT5M',
    steps: [
      '打开左侧「助手」，切到 Agents 标签，点「新建 Agent」',
      '填名称与描述，设好状态与「默认 Agent」开关',
      '在「执行配置」里选 Provider 与默认模型；默认模型可留空表示用 Provider 默认',
      '选「执行器 (SDK)」：Claude SDK / Codex / Spark；选完权限模式会自动重置为该执行器的默认档',
      '按需调整权限、推理强度；只有 Claude SDK 需要时再填推理 Token 预算（1024~128000）',
      '在右栏「Skills / 规则」里勾选能力与约束；MCP 不需要在这里绑定',
      '可选：在「工作流」下拉里绑定一个工作流，让这个 Agent 走托管执行',
      '可选：在「Hook」区块启用或覆盖该 Agent 的 Hook 绑定',
      '保存后回到会话，在输入栏的 Agent 选择器里就能选到它',
    ],
  },
  aiSummary:
    'Spark Work 的 Agent 是一份可复用配置：agents 表里的 provider_profile_id / model_id / agent_adapter / permission_mode / reasoning_effort / prompt / skill_ids / disabled_skill_ids / rule_ids / hook_config / workflow_id / metadata，编辑入口是左侧「助手」的 Agents 标签。' +
    '执行器有 claude-sdk、codex、spark 三种，权限模式按执行器分组（claude-ask/claude-plan/claude-auto/claude-bypass、codex-default/codex-auto-review/codex-full-access、spark-default/spark-auto/spark-bypass），推理强度为 minimal/low/medium/high/xhigh/max 六档，推理 Token 预算 1024~128000 仅 Claude SDK 有效。' +
    'Agent 的 mcpServerIds 是兼容字段、运行时忽略：所有已启用的 MCP 自动挂载到会话、团队成员和工作流节点，要收窄能力请停用 MCP 服务或使用工作流节点的 toolIds。' +
    '系统提示词按 [Managed Agent]（含 prompt 与 [Workflow Execution Plan]）、团队段、[Runtime Rules]、项目上下文（AGENTS.md/CLAUDE.md）、记忆、[Current Workflow Binding — Authoritative] 的顺序拼装；工作流执行强度分 workflow_run（托管执行）、codex_guided（引导执行）与 guided。' +
    'Hook 是宿主确定性调度的观察型机制，事件为 turn.started / permission.requested / question.requested / response.committed / turn.completed / turn.failed / turn.cancelled，动作支持系统通知、提示音与调用工具，作用域分 application/workspace/agent/session；设置 → Hooks 页底部仍保留旧的 sound/notification 经典通知。',
  Body,
}

export default agentsWorkflows
