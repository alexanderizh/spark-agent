import type { ReactNode } from 'react'
import type { DocsPageContent } from './_shared'

type WorkflowTone = 'blue' | 'green' | 'amber' | 'violet' | 'slate'

function WorkflowNode({
  kind,
  title,
  description,
  tone = 'slate',
  eyebrow,
}: {
  kind: string
  title: string
  description: string
  tone?: WorkflowTone
  eyebrow?: string
}) {
  return (
    <div className={`workflow-doc-node workflow-doc-node-${tone}`}>
      <div className="workflow-doc-node-head">
        <code>{kind}</code>
        {eyebrow ? <span>{eyebrow}</span> : null}
      </div>
      <strong>{title}</strong>
      <small>{description}</small>
    </div>
  )
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="workflow-doc-arrow" aria-hidden="true">
      <span>↓</span>
      {label ? <small>{label}</small> : null}
    </div>
  )
}

function Figure({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="workflow-doc-figure">
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

const Body = () => (
  <div className="workflow-doc-page">
    <p>
      工作流是 Spark Agent 里一张<strong>可视化、可执行、可审计</strong>
      的任务图。节点描述每一步做什么，连线描述先后关系，
      <code>outputKey</code> 把上一步结果写入工作流状态，条件边再根据状态决定下一条路径。
    </p>
    <div className="docs-callout">
      <strong>先记住这四句话</strong>
      <ul>
        <li>节点是步骤，连线是依赖，不是普通装饰线。</li>
        <li>
          需要给下游使用的结果，必须写入 <code>outputKey</code>。
        </li>
        <li>路由负责选择分支；循环负责重复自己的内部子图，两者不是一回事。</li>
        <li>
          <code>verify</code> 是失败即停止的质量门禁，不是“失败后继续分流”的判断器。
        </li>
      </ul>
    </div>
    <p>
      Claude SDK 执行路径会通过 <code>workflow_run</code>{' '}
      真正调度节点、保存运行快照并记录失败节点；Codex 路径在当前版本中
      会退化为结构化执行指引，由模型按拓扑顺序推进。因此，要求严格节点级调度、循环次数和失败状态时，应优先使用支持
      <code>workflow_run</code> 的运行路径。
    </p>

    <h2 id="mental-model">1. 先理解工作流的运行模型</h2>
    <Figure caption="一条可执行链路由节点输出、工作流状态和条件边共同驱动。">
      <div
        className="workflow-doc-state-flow"
        role="img"
        aria-label="节点 A 输出写入工作流状态，条件边读取状态后选择节点 B 或节点 C"
      >
        <WorkflowNode kind="input" title="节点 A" description="输出需求解析结果" tone="blue" />
        <div className="workflow-doc-inline-arrow" aria-hidden="true">
          →
        </div>
        <div className="workflow-doc-state-card">
          <span>Workflow state</span>
          <code>objective = …</code>
          <code>route = full</code>
        </div>
        <div className="workflow-doc-inline-arrow" aria-hidden="true">
          →
        </div>
        <div className="workflow-doc-mini-stack">
          <span>
            <code>equals full</code> → 节点 B
          </span>
          <span>
            <code>equals quick</code> → 节点 C
          </span>
        </div>
      </div>
    </Figure>
    <ol>
      <li>
        节点完成后，把文本结果写入自己配置的 <code>outputKey</code>。
      </li>
      <li>下游节点只会收到与自己相连、条件命中的上游输出。</li>
      <li>一个节点有多个有效上游时，会等待这些上游完成；未命中的分支会被标记为跳过。</li>
      <li>
        节点失败时，执行器根据节点类型和 <code>retryCount</code> 决定重试或结束工作流。
      </li>
    </ol>

    <h3 id="output-key">1.1 outputKey：节点之间传递结果的钥匙</h3>
    <p>
      连上线并不代表输出会自动传递。假设“代码调研”节点输出一份报告，应配置
      <code>outputKey = research_report</code>
      。后面的“编码实现”节点通过这条连线，才能在上游输入中看到
      <code>research_report</code>。
    </p>
    <pre>{`代码调研节点
outputKey: research_report

代码调研 ─────→ 编码实现
                 inputs.research_report`}</pre>

    <h3 id="edge-condition">1.2 条件写在连线上，不写在节点里</h3>
    <p>选中一条连线后，可以配置以下条件：</p>
    <table>
      <thead>
        <tr>
          <th>操作符</th>
          <th>含义</th>
          <th>适合的数据</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>exists</code>
          </td>
          <td>状态键存在</td>
          <td>是否产生过某项结果</td>
        </tr>
        <tr>
          <td>
            <code>equals</code>
          </td>
          <td>严格等于指定值</td>
          <td>路由值、状态枚举，最推荐</td>
        </tr>
        <tr>
          <td>
            <code>not_equals</code>
          </td>
          <td>严格不等于指定值</td>
          <td>排除某种状态</td>
        </tr>
        <tr>
          <td>
            <code>truthy</code>
          </td>
          <td>转换为布尔值后为真</td>
          <td>真正的布尔值或非空值</td>
        </tr>
        <tr>
          <td>
            <code>falsy</code>
          </td>
          <td>转换为布尔值后为假</td>
          <td>
            <code>false</code>、<code>0</code>、空字符串等
          </td>
        </tr>
      </tbody>
    </table>
    <div className="docs-callout">
      <strong>不要用 truthy / falsy 判断字符串 “true” / “false”</strong>
      ：路由节点输出的是字符串，字符串
      <code>"false"</code> 仍然是真值。建议使用 <code>pass / retry</code>、
      <code>accept / follow_up</code>，并在条件边上配置
      <code>equals</code>。
    </div>

    <h2 id="node-kinds">2. 13 种节点分别做什么</h2>
    <p>节点可以按职责分为入口与判断、执行、治理与交付四组。</p>

    <h3 id="nodes-control">2.1 入口、计划与流程控制</h3>
    <table>
      <thead>
        <tr>
          <th>节点</th>
          <th>作用</th>
          <th>关键配置</th>
          <th>典型场景</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>input</code>
          </td>
          <td>把用户消息解析为目标、约束和交付物</td>
          <td>
            <code>prompt</code>、<code>outputKey</code>
          </td>
          <td>所有工作流入口</td>
        </tr>
        <tr>
          <td>
            <code>plan</code>
          </td>
          <td>使用只读工具分析并制定计划</td>
          <td>
            只读 Prompt、模型覆盖、<code>outputKey</code>
          </td>
          <td>编码方案、调研计划、发布计划</td>
        </tr>
        <tr>
          <td>
            <code>route</code>
          </td>
          <td>从允许的字符串分支值中选择一个</td>
          <td>
            <code>routeOptions</code>、<code>outputKey</code>、出边条件
          </td>
          <td>复杂/简单任务、通过/返工、接受/跟进</td>
        </tr>
        <tr>
          <td>
            <code>loop</code>
          </td>
          <td>重复执行独立的内部子图，满足退出条件后停止</td>
          <td>
            <code>body</code>、<code>maxIterations</code>、<code>breakCondition</code>
          </td>
          <td>反复修复、润色、评分优化</td>
        </tr>
      </tbody>
    </table>

    <h3 id="nodes-execution">2.2 真正执行任务</h3>
    <table>
      <thead>
        <tr>
          <th>节点</th>
          <th>作用</th>
          <th>关键配置</th>
          <th>典型场景</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>agent</code>
          </td>
          <td>派发给已配置 Agent；未绑定时继承当前宿主 Agent</td>
          <td>
            <code>agentId</code>、Prompt、模型、工具
          </td>
          <td>编码、修改文件、综合执行</td>
        </tr>
        <tr>
          <td>
            <code>subagent</code>
          </td>
          <td>派发临时或指定子 Agent，可同节点并发多份</td>
          <td>
            <code>agentId</code>、<code>parallelism</code>、工具
          </td>
          <td>多角度调研、按模块并行检查</td>
        </tr>
        <tr>
          <td>
            <code>skill</code>
          </td>
          <td>创建只加载所选 Skill 的临时 worker</td>
          <td>
            <code>skillIds</code>、Prompt
          </td>
          <td>验证、搜索、设计、文档等专业步骤</td>
        </tr>
        <tr>
          <td>
            <code>tool</code>
          </td>
          <td>把临时 worker 的内置工具收窄到白名单</td>
          <td>
            <code>toolIds</code>、Prompt
          </td>
          <td>只读检查、允许 Bash 的审计、受限编辑</td>
        </tr>
        <tr>
          <td>
            <code>mcp</code>
          </td>
          <td>通过临时 worker 使用应用中已启用的 MCP</td>
          <td>Prompt、模型；MCP 在应用层全局启用</td>
          <td>浏览器、外部文档、平台或媒体能力</td>
        </tr>
      </tbody>
    </table>

    <h3 id="nodes-governance">2.3 治理、验证与交付</h3>
    <table>
      <thead>
        <tr>
          <th>节点</th>
          <th>作用</th>
          <th>关键配置</th>
          <th>典型场景</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>approval</code>
          </td>
          <td>暂停工作流，等待用户批准或拒绝</td>
          <td>
            审批说明、<code>outputKey</code>
          </td>
          <td>方案确认、高风险动作前门禁</td>
        </tr>
        <tr>
          <td>
            <code>verify</code>
          </td>
          <td>在工作区执行固定命令，任一命令失败即停止</td>
          <td>
            <code>verifyCommands</code>、<code>retryCount</code>
          </td>
          <td>测试、类型检查、构建、diff 检查</td>
        </tr>
        <tr>
          <td>
            <code>review</code>
          </td>
          <td>用只读能力复核结果、证据与风险</td>
          <td>
            复核 Prompt、模型、<code>outputKey</code>
          </td>
          <td>代码审查、事实核验、验收分析</td>
        </tr>
        <tr>
          <td>
            <code>artifact</code>
          </td>
          <td>整理最终交付文本，可写入工作区文件</td>
          <td>
            <code>outputKey</code>、<code>exportPath</code>
          </td>
          <td>变更摘要、报告、release notes</td>
        </tr>
      </tbody>
    </table>

    <h2 id="route-guide">3. 路由判断节点怎么配置</h2>
    <Figure caption="路由节点先输出一个受约束的分支值，再由多条条件边完成分流。">
      <div
        className="workflow-doc-route"
        role="img"
        aria-label="任务复杂度路由把 full 分支送到并行调研，把 quick 分支送到编码实现"
      >
        <WorkflowNode
          kind="route"
          title="任务复杂度路由"
          description="只输出 full 或 quick"
          tone="amber"
        />
        <div className="workflow-doc-route-branches">
          <div>
            <span>
              <code>equals full</code>
            </span>
            <WorkflowNode
              kind="subagent"
              title="并行代码调研"
              description="复杂任务先调查调用链"
              tone="violet"
            />
          </div>
          <div>
            <span>
              <code>equals quick</code>
            </span>
            <WorkflowNode
              kind="agent"
              title="直接编码实现"
              description="边界清晰则快速进入执行"
              tone="blue"
            />
          </div>
        </div>
      </div>
    </Figure>
    <ol>
      <li>
        给路由节点设置 <code>outputKey</code>，例如 <code>route_mode</code>。
      </li>
      <li>
        在“路由分支”中每行填写 <code>value | label | description</code>。
      </li>
      <li>
        选中每条出边，配置 <code>route_mode equals 分支值</code>。
      </li>
      <li>确保所有可能的分支值都有出口；未命中的分支及其不可达下游会被跳过。</li>
    </ol>
    <pre>{`outputKey: route_mode

routeOptions:
full  | 完整调研 | 跨模块或调用链不清晰
quick | 快速实施 | 局部且边界清晰

出边 1: route_mode equals full
出边 2: route_mode equals quick`}</pre>
    <p>
      如果上游节点已经严格输出 <code>pass</code> 或 <code>retry</code>
      ，也可以直接在上游出边配置条件，不一定再增加路由节点。
      路由更适合把一段自然语言报告归一化成有限的分支值。
    </p>

    <h2 id="loop-guide">4. 循环节点怎么配置</h2>
    <p>
      循环节点不是外层画布上的“回跳箭头”，而是一个
      <strong>内部保存独立 WorkflowGraph 的原子节点</strong>。 只有写入 <code>config.body</code>{' '}
      的节点会被重复执行。不要把外层执行节点连回上游形成环；外层图应保持无环。
    </p>
    <Figure caption="每一轮完整执行 body 子图；评审输出 pass 时退出，否则开始下一轮，最多执行配置的轮数。">
      <div
        className="workflow-doc-loop"
        role="img"
        aria-label="循环节点内部依次执行本轮修复与测试和本轮通过判断，retry 进入下一轮，pass 退出"
      >
        <div className="workflow-doc-loop-head">
          <span>Loop · 实现与自检迭代</span>
          <code>最多 4 轮</code>
        </div>
        <div className="workflow-doc-loop-body">
          <WorkflowNode
            kind="agent"
            title="本轮修复与测试"
            description="修改代码、运行相关测试、返回完整报告"
            tone="blue"
          />
          <div className="workflow-doc-inline-arrow" aria-hidden="true">
            →
          </div>
          <WorkflowNode
            kind="review"
            title="本轮通过判断"
            description="严格输出 pass 或 retry"
            tone="green"
          />
        </div>
        <div className="workflow-doc-loop-outcomes">
          <span>
            <code>retry</code> ↺ 下一轮
          </span>
          <span>
            <code>pass</code> → 退出循环
          </span>
        </div>
      </div>
    </Figure>
    <table>
      <thead>
        <tr>
          <th>配置</th>
          <th>作用</th>
          <th>示例</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>body</code>
          </td>
          <td>每一轮重复执行的独立子图</td>
          <td>
            <code>agent → review</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>maxIterations</code>
          </td>
          <td>最大轮数，默认 5，硬上限 50</td>
          <td>
            <code>4</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>loopVar</code>
          </td>
          <td>写入循环状态的轮次键，从 0 开始</td>
          <td>
            <code>iteration_index</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>resultKey</code>
          </td>
          <td>每轮结束后作为循环节点最终文本的状态键</td>
          <td>
            <code>iteration_report</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>collectAll</code>
          </td>
          <td>是否聚合所有轮次；关闭时只返回最后一轮</td>
          <td>
            <code>false</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>breakCondition</code>
          </td>
          <td>每轮完成后针对循环体状态求值</td>
          <td>
            <code>verdict equals pass</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>outputKey</code>
          </td>
          <td>把循环最终文本写回外层工作流状态</td>
          <td>
            <code>final_iteration_report</code>
          </td>
        </tr>
      </tbody>
    </table>
    <pre>{`outputKey: final_iteration_report
maxIterations: 4
loopVar: iteration_index
resultKey: iteration_report
collectAll: false
breakCondition:
  op: equals
  key: verdict
  value: pass`}</pre>
    <div className="docs-callout">
      <strong>两个重要边界</strong>
      <ul>
        <li>
          v1 不支持循环体里再嵌套 <code>loop</code>。
        </li>
        <li>
          达到最大轮数但没有命中退出条件时，循环会返回最后一轮结果并继续外层流程。因此循环后应增加最终复核和验收路由。
        </li>
      </ul>
    </div>

    <h2 id="verify-semantics">5. verify、retryCount 和循环不要混用</h2>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>解决的问题</th>
          <th>失败后的行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>retryCount</code>
          </td>
          <td>网络抖动、偶发工具故障等技术性失败</td>
          <td>原样重跑当前节点</td>
        </tr>
        <tr>
          <td>
            <code>loop</code>
          </td>
          <td>质量未达标，需要根据结果继续修改</td>
          <td>重新执行整个内部子图</td>
        </tr>
        <tr>
          <td>
            <code>verify</code>
          </td>
          <td>最终硬性命令门禁</td>
          <td>非零退出后工作流失败并停止</td>
        </tr>
      </tbody>
    </table>
    <p>
      因此，不要设计成 <code>verify → route → 失败后循环</code>
      ：真实验证命令失败时，路由没有机会执行。 需要“测试未通过后继续修复”时，让循环内的{' '}
      <code>agent</code> 运行测试并<strong>正常返回测试报告</strong>，再由
      <code>review</code> 或 <code>route</code> 输出 <code>pass / retry</code>
      。循环完成后，再放置真正的 <code>verify</code> 作为最终门禁。
    </p>

    <h2 id="full-example">6. 完整示例：编码功能任务 · 全节点能力演示</h2>
    <p>
      下面的示例用于执行真实编码功能任务，覆盖全部 13
      种节点。它把“业务质量迭代”和“最终技术门禁”分开，既能演示复杂分支，
      也避免外层回路和验证失败无法分流的问题。
    </p>
    <Figure caption="完整编码工作流：先计划和审批，再按复杂度分流，实施后进入有限循环，最后并行审计、真实验证和验收分流。">
      <div className="workflow-doc-full-flow" role="img" aria-label="编码功能任务全节点工作流总览">
        <WorkflowNode
          kind="input"
          title="需求解析"
          description="目标、约束、验收标准"
          tone="blue"
          eyebrow="入口"
        />
        <FlowArrow />
        <WorkflowNode
          kind="plan"
          title="只读实施计划"
          description="影响范围、方案、测试策略"
          tone="slate"
        />
        <FlowArrow />
        <WorkflowNode
          kind="approval"
          title="人工审批计划"
          description="用户批准后才允许改代码"
          tone="amber"
        />
        <FlowArrow />
        <WorkflowNode
          kind="route"
          title="任务复杂度路由"
          description="输出 full 或 quick"
          tone="amber"
        />
        <div className="workflow-doc-example-branches">
          <div>
            <span>
              <code>full</code>
            </span>
            <WorkflowNode
              kind="subagent × 2"
              title="并行代码调研"
              description="调用链、测试、回归风险"
              tone="violet"
            />
          </div>
          <div>
            <span>
              <code>quick</code>
            </span>
            <div className="workflow-doc-skip-card">跳过额外调研</div>
          </div>
        </div>
        <FlowArrow label="分支汇合" />
        <WorkflowNode
          kind="agent"
          title="主 Agent 编码实现"
          description="修改代码、更新必要文档、初步测试"
          tone="blue"
        />
        <FlowArrow />
        <div className="workflow-doc-loop-compact">
          <span>
            <code>loop</code> 最多 4 轮
          </span>
          <strong>修复与测试 → 只读判断 pass / retry</strong>
        </div>
        <FlowArrow />
        <div className="workflow-doc-parallel-row">
          <WorkflowNode kind="skill" title="Verify Skill" description="证据审计" tone="violet" />
          <WorkflowNode
            kind="tool"
            title="受限工具"
            description="Read / Grep / Glob / Bash"
            tone="blue"
          />
          <WorkflowNode
            kind="mcp"
            title="MCP 检查"
            description="相关则调用，不相关则跳过"
            tone="violet"
          />
        </div>
        <FlowArrow label="并行汇合" />
        <WorkflowNode
          kind="verify"
          title="真实命令质量门禁"
          description="git diff --check；失败即停止"
          tone="green"
        />
        <FlowArrow />
        <WorkflowNode
          kind="review"
          title="最终只读复核"
          description="覆盖、证据、风险和遗留项"
          tone="green"
        />
        <FlowArrow />
        <WorkflowNode
          kind="route"
          title="验收结论路由"
          description="accept 或 follow_up"
          tone="amber"
        />
        <div className="workflow-doc-example-branches workflow-doc-example-branches-final">
          <div>
            <span>
              <code>accept</code>
            </span>
            <WorkflowNode
              kind="artifact"
              title="正式交付物"
              description="完成内容、文件、验证和风险"
              tone="green"
            />
          </div>
          <div>
            <span>
              <code>follow_up</code>
            </span>
            <WorkflowNode
              kind="artifact"
              title="未通过跟进报告"
              description="阻断证据和下一轮建议"
              tone="amber"
            />
          </div>
        </div>
      </div>
    </Figure>

    <h3 id="example-stage-1">6.1 需求、计划、审批</h3>
    <ul>
      <li>
        <strong>需求解析</strong>：<code>outputKey = structured_requirement</code>
        ，把自然语言需求整理成结构化输入。
      </li>
      <li>
        <strong>只读实施计划</strong>：<code>outputKey = implementation_plan</code>
        ，只读分析代码，不提前修改。
      </li>
      <li>
        <strong>人工审批计划</strong>：在可能产生大量改动之前停下来，让用户决定是否继续。
      </li>
    </ul>

    <h3 id="example-stage-2">6.2 复杂度分流与编码实现</h3>
    <p>
      “任务复杂度路由”配置 <code>full / quick</code> 两个值。<code>full</code> 分支运行并发数为 2
      的子代理调研，
      <code>quick</code> 分支直接进入主 Agent。两个分支最终汇合到“主 Agent 编码实现”。主 Agent
      未绑定固定
      <code>agentId</code> 时，会继承发起本次工作流的宿主 Agent。
    </p>

    <h3 id="example-stage-3">6.3 循环修复</h3>
    <p>
      主 Agent 首次实现后进入循环。循环体的 Agent
      检查当前工作区、修复问题并运行任务相关测试；即使测试未通过，也要正常返回
      <code>iteration_report</code>。只读 Review 根据报告严格输出 <code>pass</code> 或{' '}
      <code>retry</code>，从而控制是否开始下一轮。
    </p>

    <h3 id="example-stage-4">6.4 并行审计与真实门禁</h3>
    <p>循环结束后同时运行三种互补检查：</p>
    <ul>
      <li>
        <strong>Skill</strong>：加载验证类 Skill，检查“已经完成”的声明是否有新鲜证据。
      </li>
      <li>
        <strong>Tool</strong>：只开放 <code>Read / Grep / Glob / Bash</code>，限制审计能力边界。
      </li>
      <li>
        <strong>MCP</strong>：使用应用当前已启用的 MCP；没有相关外部依赖时返回{' '}
        <code>no_external_check_needed</code>。
      </li>
    </ul>
    <p>
      三条并行分支汇合后，<code>verify</code> 执行 <code>git diff --check</code>
      。这是通用门禁；项目自己的单测、类型检查和构建命令， 应根据仓库情况追加到{' '}
      <code>verifyCommands</code>。
    </p>

    <h3 id="example-stage-5">6.5 最终复核与双交付物</h3>
    <p>
      最终 Review 汇总实现结果、循环报告、三种审计和命令输出。验收路由把自然语言复核结果归一化为
      <code>accept / follow_up</code>
      ：通过时生成正式交付物；未通过时生成跟进报告，不会错误声称任务已经验收。
    </p>

    <h2 id="build-in-app">7. 在应用里照着配置</h2>
    <ol>
      <li>打开左侧“工作流”，新建工作流，切换为纵向编排。</li>
      <li>
        先放置外层主链：<code>input → plan → approval → route → agent → loop</code>。
      </li>
      <li>
        给复杂度路由增加 <code>full / quick</code>，在出边上使用 <code>equals</code>。
      </li>
      <li>
        在 <code>full</code> 分支放置 <code>subagent</code>，设置 <code>parallelism = 2</code>
        ，然后与 quick 分支汇合。
      </li>
      <li>
        打开循环节点右侧 Inspector，在“循环体 JSON”里放置 <code>agent → review</code> 子图。
      </li>
      <li>
        循环后并排放置 <code>skill / tool / mcp</code>，再统一连接到 <code>verify</code>。
      </li>
      <li>
        添加 <code>review → route → 两个 artifact</code>，分别配置 accept 和 follow_up 条件。
      </li>
      <li>
        逐个检查所有需要传递结果的节点是否设置了唯一、清晰的 <code>outputKey</code>。
      </li>
      <li>保存并设为 active，然后到 Agent 配置中绑定该工作流。</li>
    </ol>

    <h2 id="safe-defaults">8. 推荐的安全默认值</h2>
    <ul>
      <li>
        <code>input / plan / review</code> 保持只读，不给写文件和执行命令能力。
      </li>
      <li>
        真正修改代码只放在 <code>agent / subagent / tool</code> 节点。
      </li>
      <li>
        高风险动作前放置 <code>approval</code>，不要只靠 Prompt 口头约束。
      </li>
      <li>
        路由值使用英文枚举，例如 <code>full / quick</code>、<code>pass / retry</code>。
      </li>
      <li>
        循环必须设置有限的 <code>maxIterations</code>，并在循环后做最终验收。
      </li>
      <li>
        <code>verify</code> 从稳定、通用的命令开始，再逐步增加项目测试和构建。
      </li>
      <li>不需要的 MCP 在应用的 MCP 管理页全局停用；节点本身不再单独维护 MCP allow-list。</li>
    </ul>

    <h2 id="troubleshooting">9. 常见配置错误</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>常见原因</th>
          <th>处理办法</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>路由只走一个分支</td>
          <td>用 truthy 判断字符串 “false”</td>
          <td>
            改用枚举字符串和 <code>equals</code>
          </td>
        </tr>
        <tr>
          <td>下游看不到上游结果</td>
          <td>
            上游没有 <code>outputKey</code>，或两者没有直接有效连线
          </td>
          <td>配置 outputKey 并检查条件边</td>
        </tr>
        <tr>
          <td>一开始就 workflow_deadlock</td>
          <td>在外层画了回边，形成有向环</td>
          <td>删除回边，把重复节点放入 loop body</td>
        </tr>
        <tr>
          <td>verify 失败后没有进入路由</td>
          <td>verify 是失败即停止节点</td>
          <td>业务判断放进循环，verify 放最终门禁</td>
        </tr>
        <tr>
          <td>循环达到上限仍继续</td>
          <td>最大轮数结束会返回最后结果</td>
          <td>循环后增加最终 Review 和验收路由</td>
        </tr>
        <tr>
          <td>循环节点直接失败</td>
          <td>body 为空、节点 ID 与外层冲突或嵌套 loop</td>
          <td>检查循环体 JSON 和节点 ID</td>
        </tr>
        <tr>
          <td>Agent 不能编辑文件</td>
          <td>使用了只读节点，或 toolIds 漏选编辑工具</td>
          <td>改用 agent/subagent/tool 并检查权限</td>
        </tr>
        <tr>
          <td>MCP 节点没有目标能力</td>
          <td>应用层没有启用对应 MCP</td>
          <td>到 MCP 管理页启用服务后重试</td>
        </tr>
      </tbody>
    </table>
  </div>
)

export const workflowUsage: DocsPageContent = {
  slug: 'workflow-usage',
  toc: [
    { id: 'mental-model', title: '1. 工作流运行模型', level: 2 },
    { id: 'output-key', title: '1.1 outputKey', level: 3 },
    { id: 'edge-condition', title: '1.2 条件边', level: 3 },
    { id: 'node-kinds', title: '2. 13 种节点作用', level: 2 },
    { id: 'nodes-control', title: '2.1 入口与流程控制', level: 3 },
    { id: 'nodes-execution', title: '2.2 执行节点', level: 3 },
    { id: 'nodes-governance', title: '2.3 治理与交付', level: 3 },
    { id: 'route-guide', title: '3. 路由节点配置', level: 2 },
    { id: 'loop-guide', title: '4. 循环节点配置', level: 2 },
    { id: 'verify-semantics', title: '5. 验证与重试语义', level: 2 },
    { id: 'full-example', title: '6. 完整编码工作流', level: 2 },
    { id: 'example-stage-1', title: '6.1 需求、计划、审批', level: 3 },
    { id: 'example-stage-2', title: '6.2 分流与实现', level: 3 },
    { id: 'example-stage-3', title: '6.3 循环修复', level: 3 },
    { id: 'example-stage-4', title: '6.4 并行审计与门禁', level: 3 },
    { id: 'example-stage-5', title: '6.5 复核与交付', level: 3 },
    { id: 'build-in-app', title: '7. 在应用里配置', level: 2 },
    { id: 'safe-defaults', title: '8. 安全默认值', level: 2 },
    { id: 'troubleshooting', title: '9. 常见配置错误', level: 2 },
  ],
  faq: [
    {
      question: '路由节点和循环节点有什么区别？',
      answer:
        '路由节点只选择一次后续分支；循环节点会重复执行自己的内部 body 子图，直到满足 breakCondition 或达到最大轮数。外层画布不要用回边模拟循环。',
    },
    {
      question: '为什么 verify 失败后不能进入 retry 分支？',
      answer:
        'verify 是硬性命令门禁，任一命令非零退出都会让当前工作流失败并停止。需要质量迭代时，让循环内 Agent 返回测试报告，再由 Review 或 Route 输出 pass/retry；最终再运行 verify。',
    },
    {
      question: '为什么已经连线，下游还是看不到上游结果？',
      answer:
        '连线只建立依赖。上游还必须配置 outputKey，且条件边必须命中，下游才会收到该键对应的输出。',
    },
    {
      question: '循环达到最大轮数还没通过怎么办？',
      answer:
        '当前循环会返回最后一轮结果并继续外层流程，所以应在循环后增加最终 Review 和验收 Route，将未通过结果送到 follow_up 产物，而不是直接交付。',
    },
    {
      question: 'MCP 节点需要逐个绑定 MCP 吗？',
      answer:
        '不需要。所有在应用中已启用的 MCP 会自动对 Agent 和工作流节点可用；节点 Prompt 应说明何时使用，不需要的服务在 MCP 管理页全局停用。',
    },
  ],
  quickReference: [
    {
      key: '完整编码链路',
      value:
        'input → plan → approval → route → agent → loop → skill/tool/mcp → verify → review → route → artifact',
    },
    {
      key: '节点种类',
      value:
        '13 种：input / plan / route / agent / subagent / skill / tool / mcp / approval / verify / review / artifact / loop',
    },
    { key: '路由条件', value: '优先使用枚举字符串 + equals，不要用 truthy 判断字符串 false' },
    { key: '循环语义', value: '只重复 config.body 子图；外层保持无环；默认 5 轮，硬上限 50' },
    { key: '验证语义', value: 'verifyCommands 任一命令失败即停止；业务返工应放进 loop' },
    { key: '状态传递', value: '上游必须配置 outputKey；下游只接收直接有效连线的输出' },
    { key: 'MCP', value: '所有应用层已启用 MCP 自动可用，不再逐节点维护 allow-list' },
    { key: '执行记录', value: 'workflow_runs 保存节点状态、输出、失败信息和可恢复快照' },
  ],
  howTo: {
    name: '创建“编码功能任务 · 全节点能力演示”工作流',
    description: '配置需求、审批、分流、并行调研、循环修复、并行审计、真实验证和双交付物',
    totalTime: 'PT20M',
    steps: [
      '新建纵向工作流，添加 input、plan、approval、route、agent 和 loop 主链',
      '给复杂度 route 配置 full / quick，并在出边上使用 equals 条件',
      '在 full 分支添加 parallelism=2 的 subagent，并与 quick 分支汇合',
      '在 loop body 中配置 agent → review，使用 verdict equals pass 作为退出条件',
      '循环后并行添加 skill、tool 和 mcp 节点',
      '让三条审计分支汇合到 verify，并配置项目验证命令',
      '添加最终 review、accept/follow_up route 和两个 artifact',
      '检查每个需要传递结果的节点都有 outputKey，保存并绑定到 Agent',
    ],
  },
  aiSummary:
    'Spark Agent 工作流是一张可视化、可执行、可审计的任务图，由节点、依赖边、outputKey 状态和条件边共同驱动。当前支持 input、plan、route、agent、subagent、skill、tool、mcp、approval、verify、review、artifact、loop 共 13 种节点。' +
    'route 从 routeOptions 中选择字符串 value，分支条件应优先使用 equals；字符串 false 仍为 truthy。loop 是封装独立 config.body 子图的原子节点，支持 maxIterations、loopVar、resultKey、collectAll 和 breakCondition，外层图不应使用回边，v1 不支持嵌套 loop。' +
    'verify 会在工作区执行 verifyCommands，任一命令非零退出即终止工作流，因此业务层“未通过后继续修改”应放进 loop：由 Agent 运行测试并正常返回报告，再由 Review 或 Route 输出 pass/retry，循环结束后再用 verify 做最终硬门禁。' +
    '完整编码示例为 input→plan→approval→复杂度 route→可选并行 subagent→主 agent→修复 loop→skill/tool/mcp 并行审计→verify→最终 review→accept/follow_up route→双 artifact。所有需要传递的节点必须配置 outputKey；MCP 在应用层全局启用。',
  Body,
}

export default workflowUsage
