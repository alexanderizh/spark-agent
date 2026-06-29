import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 把「权限审批 / Rules / Hooks / 用量账本 / 审计」作为治理面（Governance）的核心。
      它的目标：让 Agent 自动化既能扩展，也能被审查、可回退、可解释。
    </p>

    <h2 id="approval">1. 高风险操作审批</h2>
    <p>
      Agent 默认不会自动执行高风险操作 — 删除文件、格式化、推送代码、联网下载可执行文件等会先弹窗让你确认。
      你可以在「设置 → 权限」调整每类操作的策略：
    </p>
    <ul>
      <li><strong>Always Ask</strong>：每次都问。</li>
      <li><strong>Allow Session</strong>：本次会话允许。</li>
      <li><strong>Allow Always</strong>：长期允许。</li>
      <li><strong>Deny</strong>：禁止。</li>
    </ul>
    <p>
      审批粒度按工具名（<code>bash</code> / <code>edit_file</code> / <code>write_file</code> / <code>browser_navigate</code> ...）
      与「危险模式」（如 <code>rm -rf</code> / <code>git push --force</code>）。
    </p>

    <h2 id="rules">2. Rules：约束 Agent 行为边界</h2>
    <p>
      Rules 是「注入 prompt 的策略」。与 Hooks 不同，Rules 不写代码，只是在 prompt 里告诉 Agent
      「不要做什么、必须按什么顺序做」。例如：
    </p>
    <pre>{`# Rule: 不要直接 push 到 main

每次涉及 git push 时，必须先确认当前分支。
如果当前分支是 main / master，先 git checkout 到一个 feat/* 分支再操作。`}</pre>
    <p>Rules 按作用域分：</p>
    <ul>
      <li><strong>System Rules</strong>：所有会话默认生效。</li>
      <li><strong>Project Rules</strong>：与项目绑定（存在 <code>.spark/rules/</code>）。</li>
      <li><strong>Agent Rules</strong>：Agent 配置里勾选。</li>
      <li><strong>Workflow Node Rules</strong>：Workflow 节点的「阶段策略」。</li>
    </ul>

    <h2 id="hooks">3. Hooks：事件回调</h2>
    <p>
      Hooks 在工具调用前后插入自定义逻辑（参见 <a href="/docs/agents-workflows#hooks">Agent 工作流 / Hooks</a>）：
    </p>
    <ul>
      <li><strong>permission-request</strong>：拦截高风险操作前提示。</li>
      <li><strong>user-question</strong>：自动补全或校验用户问题。</li>
      <li><strong>session-complete</strong>：会话结束时跑总结 / 归档。</li>
      <li><strong>failure</strong>：失败时跑兜底逻辑（重试 / 报警）。</li>
    </ul>
    <p>
      Agent 级 Hook 优先级高于全局 Hook；未配置时回退到全局设置。
    </p>

    <h2 id="usage">4. 用量账本</h2>
    <p>
      Spark Agent 记录每次会话的模型调用：
    </p>
    <ul>
      <li>Provider / Model / 角色（user / assistant / tool）。</li>
      <li>输入 / 输出 tokens、缓存命中、工具调用次数。</li>
      <li>按会话、按 Agent、按项目、按时间窗口聚合。</li>
      <li>导出为 CSV / JSON 便于自托管分析。</li>
    </ul>
    <p>
      设置页提供按 Provider / 模型 / 时间段查看用量，支持设置月度预算提醒。
    </p>

    <h2 id="audit">5. 审计事件</h2>
    <p>
      Spark Agent 把所有可观察事件写入审计日志：
    </p>
    <ul>
      <li>文件写入、删除、改名。</li>
      <li>终端命令执行（命令、退出码、耗时）。</li>
      <li>网络请求（fetch / MCP 调用 / WebSocket）。</li>
      <li>权限请求 + 用户决策（allow / deny / always）。</li>
      <li>Skill / MCP / Provider / Agent / Workflow / Team 配置变更。</li>
    </ul>
    <p>
      在「设置 → 审计」可按会话、时间、事件类型筛选；支持导出与一键清理。
    </p>

    <h2 id="best-practices">6. 最佳实践</h2>
    <ul>
      <li>把「删除文件 / 推送代码 / 联网下载可执行文件」放在「Always Ask」。</li>
      <li>团队场景：把 Rules 放进项目仓库（<code>.spark/rules/</code>），团队成员自动继承。</li>
      <li>高频重复审批：在弹窗里选「Always Allow」而非每次点 Allow，减少打扰。</li>
      <li>Hooks 写最小代码：复杂的预处理 / 后处理放 Workflow 节点。</li>
      <li>定期导出审计：可作为团队复盘与合规审查依据。</li>
    </ul>
  </>
)

export const governance: DocsPageContent = {
  slug: 'governance',
  toc: [
    { id: 'approval', title: '1. 高风险操作审批', level: 2 },
    { id: 'rules', title: '2. Rules', level: 2 },
    { id: 'hooks', title: '3. Hooks', level: 2 },
    { id: 'usage', title: '4. 用量账本', level: 2 },
    { id: 'audit', title: '5. 审计事件', level: 2 },
    { id: 'best-practices', title: '6. 最佳实践', level: 2 },
  ],
  faq: [
    {
      question: 'Rules 和 Hooks 的区别？',
      answer: 'Rule 是「注入 prompt 的策略」（告诉 Agent 不要做什么）；Hook 是「事件回调」（在工具调用前后跑代码）。',
    },
    {
      question: '审批策略会被 Agent 自己改吗？',
      answer: '理论上 Admin 角色的 Agent 可通过 spark_platform 修改审批策略；普通 Agent 没有这个权限。',
    },
    {
      question: '用量账本准确吗？',
      answer: '基于模型返回的 token usage 字段累加；缓存命中按供应商返回的 cached_tokens 单独统计。',
    },
    {
      question: '审计日志会同步到云端吗？',
      answer: '默认仅本地 SQLite；可选开启云端同步（企业版 / 自托管部署）。',
    },
  ],
  quickReference: [
    { key: '审批粒度', value: '工具名 + 危险模式（rm -rf / git push --force 等）' },
    { key: 'Rule 作用域', value: 'System / Project / Agent / Workflow Node' },
    { key: 'Hook 事件', value: 'permission-request / user-question / session-complete / failure' },
    { key: '用量账本', value: 'Provider / Model / 角色 / token / 工具调用，可导出 CSV / JSON' },
    { key: '审计事件', value: '文件 / 终端 / 网络 / 权限 / 配置变更' },
    { key: '默认存储', value: '本地 SQLite（可启用云端同步）' },
  ],
  howTo: {
    name: '为团队 Agent 配置权限治理',
    description: '从启用审批到写第一个项目 Rule',
    totalTime: 'PT10M',
    steps: [
      '在「设置 → 权限」给 Agent 启用「Always Ask」类目（删除、推送、联网下载可执行文件）',
      '在项目根目录创建 .spark/rules/no-push-main.md，写入分支检查规则',
      '提交 .spark/rules/ 到 git，团队成员 clone 后自动继承',
      '在「设置 → 审计」打开「自动导出」并选一个本地目录',
      '给 Agent 跑一个测试任务，确认审计事件被记录、用量账本正常累加',
    ],
  },
  aiSummary:
    'Spark Agent 权限治理：高风险操作审批（Always Ask / Allow Session / Allow Always / Deny，按工具名+危险模式粒度），' +
    'Rules（System / Project / Agent / Workflow Node 四级作用域，注入 prompt 的策略），' +
    'Hooks（permission-request / user-question / session-complete / failure 事件回调，Agent 级覆盖全局），' +
    '用量账本（Provider/Model/角色/token/工具调用，按会话/Agent/项目/时间聚合，可导出 CSV/JSON），' +
    '审计事件（文件 / 终端 / 网络 / 权限 / 配置变更，本地 SQLite 存储，可选云端同步）。' +
    '最佳实践：Always Ask 删除/推送/联网下载可执行文件，团队场景把 Rules 放进 .spark/rules/。',
  Body,
}

export default governance
