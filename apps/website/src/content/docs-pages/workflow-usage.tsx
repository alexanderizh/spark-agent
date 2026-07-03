import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      工作流是 Spark Agent 里用来「把一件复杂事情拆成固定步骤」的可视化流程。你可以把它理解成一张会执行的办事清单：
      先收集需求，再制定计划，然后交给 Agent 执行，中间需要你确认的地方会暂停，最后自动验证、复核并整理交付物。
    </p>
    <p>
      新版工作流已经不只是把步骤写进提示词。Claude SDK 路径会在可执行图中暴露 <code>workflow_run</code>，
      由运行时真实驱动节点、保存运行快照、记录失败节点，并支持后续恢复和审计。Codex 路径会退化为结构化执行指引，
      仍会按图中顺序要求模型推进。
    </p>

    <h2 id="when-to-use">1. 什么时候该用工作流</h2>
    <p>只要一件事需要反复做、多人做、或者做错成本比较高，就适合做成工作流。</p>
    <table>
      <thead>
        <tr><th>场景</th><th>不用工作流时</th><th>使用工作流后</th></tr>
      </thead>
      <tbody>
        <tr><td>代码修复</td><td>每次都重新说明步骤</td><td>固定为「理解需求 → 改代码 → 跑验证 → 总结」</td></tr>
        <tr><td>资料整理</td><td>容易漏掉来源核对</td><td>固定为「检索 → 对比 → 复核 → 输出报告」</td></tr>
        <tr><td>发布自检</td><td>靠人工记清单</td><td>固定为「生成清单 → 跑命令 → 审批 → 产出 release notes」</td></tr>
        <tr><td>内容生产</td><td>角色、脚本、分镜分散</td><td>固定为「输入素材 → 拆分镜 → 生成资产 → 复核交付」</td></tr>
      </tbody>
    </table>

    <h2 id="quick-start">2. 5 分钟创建第一个工作流</h2>
    <ol>
      <li>打开左侧「工作流」。</li>
      <li>点击「新建工作流」，输入一个容易识别的名字，例如「代码修改标准流程」。</li>
      <li>进入详情页后，从左侧节点面板拖出这些节点：<code>input</code> → <code>plan</code> → <code>agent</code> → <code>verify</code> → <code>review</code> → <code>artifact</code>。</li>
      <li>用连线把上一个节点接到下一个节点。连线就是执行顺序。</li>
      <li>点击 <code>agent</code> 节点，在右侧选择真正干活的 Agent，例如「程序开发 Agent」。</li>
      <li>点击 <code>verify</code> 节点，填入验证命令，例如 <code>pnpm typecheck</code> 或 <code>pnpm test:unit</code>。</li>
      <li>保存工作流。</li>
      <li>打开「Agents」，编辑目标 Agent，在 Workflow 下拉框选择刚才保存的工作流。</li>
      <li>回到聊天，用这个 Agent 发起任务，例如「帮我修复登录页按钮错位，并跑验证」。</li>
    </ol>
    <p>
      对非技术用户来说，你只需要记住三件事：节点代表步骤，连线代表顺序，绑定 Agent 代表把这套步骤交给谁执行。
    </p>

    <h2 id="node-kinds">3. 11 种节点怎么选</h2>
    <table>
      <thead>
        <tr><th>节点</th><th>通俗解释</th><th>会不会真实执行</th><th>常见用法</th></tr>
      </thead>
      <tbody>
        <tr><td><code>input</code></td><td>把用户一句话整理成目标、限制和交付物</td><td>会，由系统侧解析</td><td>所有工作流入口</td></tr>
        <tr><td><code>plan</code></td><td>先想清楚怎么做</td><td>会，以只读能力执行</td><td>代码任务、调研、发布前计划</td></tr>
        <tr><td><code>agent</code></td><td>让一个已配置的 Agent 真正干活</td><td>会，派发给指定 Agent</td><td>编码、写报告、整理资料</td></tr>
        <tr><td><code>subagent</code></td><td>临时创建一个子角色处理局部任务</td><td>会，作为子 Agent 派发</td><td>并行调研、分模块检查</td></tr>
        <tr><td><code>skill</code></td><td>限制这一步只使用某些 Skill</td><td>会，通过临时受限 worker 执行</td><td>搜索、写作、前端设计等专业步骤</td></tr>
        <tr><td><code>tool</code></td><td>限制这一步可用的内置工具</td><td>会，通过工具白名单收窄能力</td><td>只允许读文件、只允许编辑、允许执行命令</td></tr>
        <tr><td><code>mcp</code></td><td>限制这一步可连接的 MCP 服务</td><td>会，通过 MCP allow-list 收窄</td><td>只调用搜索、浏览器、媒体或平台工具</td></tr>
        <tr><td><code>approval</code></td><td>需要人确认后再继续</td><td>会，暂停等待用户</td><td>删除、发布、联网下载、批量改动前</td></tr>
        <tr><td><code>verify</code></td><td>跑检查命令，看结果是否通过</td><td>会，由系统侧执行命令</td><td>测试、构建、lint、类型检查</td></tr>
        <tr><td><code>review</code></td><td>复核前面结果，找风险</td><td>会，以只读能力执行</td><td>代码审查、事实核验、发布复核</td></tr>
        <tr><td><code>artifact</code></td><td>整理最终交付物</td><td>会，可导出到工作区文件</td><td>总结、报告、release notes、交付清单</td></tr>
      </tbody>
    </table>

    <h2 id="safe-default">4. 给非 IT 用户的安全默认配置</h2>
    <p>如果你不确定每个选项是什么意思，可以先照这个方式配：</p>
    <ul>
      <li><strong>代码修改流程</strong>：只在 <code>agent</code> 节点允许编辑和执行命令；<code>plan</code> / <code>review</code> 保持只读。</li>
      <li><strong>资料整理流程</strong>：只给搜索、网页抓取和文档输出能力，不给写代码和执行命令能力。</li>
      <li><strong>发布流程</strong>：在真正发布、推送、删除或上传之前加 <code>approval</code> 节点。</li>
      <li><strong>验证流程</strong>：至少放一个 <code>verify</code> 节点，验证命令由懂项目的人先填好。</li>
      <li><strong>交付流程</strong>：最后用 <code>artifact</code> 节点要求 Agent 输出「做了什么、验证结果、还剩什么风险」。</li>
    </ul>

    <h2 id="templates">5. 三套可直接照抄的模板</h2>

    <h3 id="tpl-code">5.1 程序编码开发工作流</h3>
    <pre>{`input → plan → approval → agent → verify → review → artifact`}</pre>
    <ul>
      <li><strong>input</strong>：整理需求、目标文件、验收标准。</li>
      <li><strong>plan</strong>：先读代码并列出修改方案，只读，不改文件。</li>
      <li><strong>approval</strong>：用户确认方案后再进入编辑阶段。</li>
      <li><strong>agent</strong>：绑定「程序开发 Agent」，允许 Read / Grep / Glob / Edit / MultiEdit / Bash。</li>
      <li><strong>verify</strong>：填写项目验证命令，例如 <code>pnpm --filter @spark/website build</code>。</li>
      <li><strong>review</strong>：只读复核 diff、风险和漏测点。</li>
      <li><strong>artifact</strong>：输出变更摘要、验证结果、后续建议。</li>
    </ul>

    <h3 id="tpl-research">5.2 调研报告工作流</h3>
    <pre>{`input → plan → skill(搜索) → mcp(网页/资料) → review → artifact`}</pre>
    <ul>
      <li><strong>skill</strong>：选择搜索或研究类 Skill，让 Agent 明确只做资料收集。</li>
      <li><strong>mcp</strong>：只允许联网搜索、网页抓取或知识库 MCP。</li>
      <li><strong>review</strong>：检查来源是否可靠、是否有互相矛盾的证据。</li>
      <li><strong>artifact</strong>：输出「结论 + 证据 + 风险 + 下一步」。</li>
    </ul>

    <h3 id="tpl-release">5.3 发布前自检工作流</h3>
    <pre>{`input → agent → verify → approval → review → artifact`}</pre>
    <ul>
      <li><strong>agent</strong>：生成发布清单和 release notes 草稿。</li>
      <li><strong>verify</strong>：跑构建、测试或打包命令。</li>
      <li><strong>approval</strong>：验证通过后仍要用户确认，再继续整理最终产物。</li>
      <li><strong>review</strong>：核对变更摘要、版本号、安装包和已知风险。</li>
      <li><strong>artifact</strong>：输出最终发布清单。</li>
    </ul>

    <h2 id="advanced-config">6. 专业配置：工具、模型、MCP 和恢复</h2>
    <p>右侧 Inspector 的配置项可以细调每个节点的能力边界：</p>
    <ul>
      <li><strong>Agent</strong>：给 <code>agent</code> 节点绑定一个已有 Agent。它会继承该 Agent 的模型、权限、Skills、MCP 和 Prompt，也可被节点配置覆盖。</li>
      <li><strong>Provider / Model</strong>：某个节点需要更强模型时单独覆盖，例如计划和复核用更强模型，执行用默认模型。</li>
      <li><strong>toolIds</strong>：用于限制内置工具。未配置代表不额外限制；一旦配置，就只允许你选择的工具，其余会被禁用。</li>
      <li><strong>skillIds</strong>：让某一步只加载指定 Skill，适合把团队经验固定到流程里。</li>
      <li><strong>mcpServerIds</strong>：让某一步只连接指定 MCP，避免 Agent 看到过多外部工具。</li>
      <li><strong>retryCount</strong>：节点失败后的重试次数，适合网络检索、媒体生成这类偶发失败任务。</li>
      <li><strong>execution</strong>：设置为 <code>static</code> 时只做静态回显；默认或 <code>auto</code> 会走真实执行。</li>
      <li><strong>exportPath</strong>：在 <code>artifact</code> 节点配置工作区相对路径，把最终内容写成文件。</li>
    </ul>
    <p>
      运行时会把每次执行写入 <code>workflow_runs</code> 快照：包括已完成节点、正在执行节点、失败节点和节点输出。
      如果流程中断，Spark Agent 可以基于最新可恢复快照继续，而不是从头重跑所有节点。
    </p>

    <h2 id="tool-permissions">7. 为什么有些节点不能改代码</h2>
    <p>
      这是正常设计。<code>plan</code>、<code>input</code>、<code>review</code> 这类节点默认只读，会禁用写文件和执行命令。
      真正需要改代码时，把修改动作放在 <code>agent</code>、<code>subagent</code> 或配置了编辑工具的 <code>tool</code> 节点里。
    </p>
    <table>
      <thead>
        <tr><th>想做的事</th><th>应该放在哪类节点</th><th>建议工具</th></tr>
      </thead>
      <tbody>
        <tr><td>读项目、找文件</td><td>plan / agent / review</td><td>Read / Grep / Glob</td></tr>
        <tr><td>修改代码</td><td>agent / subagent / tool</td><td>Edit / MultiEdit / Write</td></tr>
        <tr><td>运行测试或脚本</td><td>agent / verify</td><td>Bash 或 verifyCommands</td></tr>
        <tr><td>让用户确认</td><td>approval</td><td>审批卡片</td></tr>
        <tr><td>整理最终文档</td><td>artifact</td><td>exportPath 可选</td></tr>
      </tbody>
    </table>

    <h2 id="troubleshooting">8. 常见问题排查</h2>
    <ul>
      <li><strong>工作流没有自动运行</strong>：确认 Agent 已绑定该 Workflow，且当前会话使用的是这个 Agent。</li>
      <li><strong>Agent 不能编辑文件</strong>：检查节点是不是只读节点；再检查 toolIds 是否漏选 Edit / MultiEdit / Write。</li>
      <li><strong>验证没有执行</strong>：确认使用 <code>verify</code> 节点，并在节点里填写了可在项目根目录运行的命令。</li>
      <li><strong>某个节点反复失败</strong>：查看运行快照中的 failedNode，先缩小该节点的 prompt、工具和输入。</li>
      <li><strong>工具太多导致 Agent 乱选</strong>：给关键节点配置 toolIds / mcpServerIds，只暴露这一步需要的能力。</li>
      <li><strong>用户担心自动化越权</strong>：在高风险动作前加 approval，并把 Agent 权限模式设为需要审批。</li>
    </ul>
  </>
)

export const workflowUsage: DocsPageContent = {
  slug: 'workflow-usage',
  toc: [
    { id: 'when-to-use', title: '1. 什么时候该用工作流', level: 2 },
    { id: 'quick-start', title: '2. 5 分钟创建第一个工作流', level: 2 },
    { id: 'node-kinds', title: '3. 11 种节点怎么选', level: 2 },
    { id: 'safe-default', title: '4. 安全默认配置', level: 2 },
    { id: 'templates', title: '5. 三套可直接照抄的模板', level: 2 },
    { id: 'tpl-code', title: '5.1 程序编码开发工作流', level: 3 },
    { id: 'tpl-research', title: '5.2 调研报告工作流', level: 3 },
    { id: 'tpl-release', title: '5.3 发布前自检工作流', level: 3 },
    { id: 'advanced-config', title: '6. 专业配置', level: 2 },
    { id: 'tool-permissions', title: '7. 节点权限说明', level: 2 },
    { id: 'troubleshooting', title: '8. 常见问题排查', level: 2 },
  ],
  faq: [
    {
      question: '工作流是给程序员用的吗？',
      answer: '不是。你可以把工作流理解成可视化办事清单。非技术用户只需要拖节点、连线、选择 Agent；技术用户再深入配置工具、MCP、模型和验证命令。',
    },
    {
      question: '工作流现在会真的执行节点吗？',
      answer: '会。Claude SDK 路径会通过 workflow_run 驱动可执行节点，并保存运行快照。Codex 路径会按结构化执行计划推进。',
    },
    {
      question: '为什么 plan 或 review 节点不能改代码？',
      answer: '这些节点默认只读，目的是先想清楚、再复核风险。真正改代码应放在 agent / subagent / tool 节点中，并给它配置编辑工具。',
    },
    {
      question: '可以做单 Agent 全工具编码工作流吗？',
      answer: '可以。用 input → plan → approval → agent → verify → review → artifact，把 agent 节点绑定 coding agent，并允许 Read / Grep / Glob / Edit / MultiEdit / Bash。',
    },
  ],
  quickReference: [
    { key: '推荐入口', value: 'input → plan → agent → verify → review → artifact' },
    { key: '真实执行', value: 'Claude SDK 路径通过 workflow_run 执行，Codex 路径作为结构化计划' },
    { key: '可执行节点', value: 'agent / subagent / skill / tool / mcp / input / approval / verify / review / artifact' },
    { key: '只读节点', value: 'input / plan / review 默认禁用 Write / Edit / MultiEdit / NotebookEdit / Bash' },
    { key: '能力限制', value: 'toolIds / skillIds / mcpServerIds；未配置 toolIds 表示不额外限制' },
    { key: '运行记录', value: 'workflow_runs 快照记录完成节点、失败节点和恢复信息' },
  ],
  howTo: {
    name: '创建一个可执行的「程序编码开发」工作流',
    description: '从拖节点、连线、配置工具到绑定 Agent 的完整流程',
    totalTime: 'PT10M',
    steps: [
      '打开「工作流」，新建「程序编码开发」',
      '拖出 input → plan → approval → agent → verify → review → artifact',
      '把节点按顺序连线',
      '在 agent 节点选择程序开发 Agent，并允许 Read / Grep / Glob / Edit / MultiEdit / Bash',
      '在 verify 节点填写项目验证命令',
      '保存工作流',
      '打开 Agents，把该工作流绑定到目标 Agent',
      '用该 Agent 开新会话并提交真实开发任务',
    ],
  },
  aiSummary:
    'Spark Agent 工作流是可视化、可执行、可审计的任务编排。新版 Claude SDK 路径通过 workflow_run 真实执行节点，保存 workflow_runs 快照，支持失败节点记录与恢复；Codex 路径按结构化执行计划推进。' +
    '非 IT 用户可按 input→plan→agent→verify→review→artifact 快速创建流程；专业用户可配置 agentId、provider/model、toolIds、skillIds、mcpServerIds、retryCount、execution、exportPath。' +
    '11 种节点包括 input、plan、agent、subagent、skill、tool、mcp、approval、verify、review、artifact。plan/input/review 默认只读，代码编辑应放在 agent/subagent/tool 节点。' +
    '常用模板包括程序编码开发、调研报告和发布前自检。',
  Body,
}

export default workflowUsage
