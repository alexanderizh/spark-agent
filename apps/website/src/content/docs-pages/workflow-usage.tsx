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
      工作流是 Spark Work 里一张<strong>可视化、可执行、可审计</strong>
      的任务图。节点描述每一步做什么，连线描述先后关系，
      <code>outputKey</code> 把上一步结果写进工作流状态，条件边再按状态决定下一条路径。 图存为{' '}
      <code>workflows.graph_json</code>，一次运行存为 <code>workflow_runs</code> 快照。
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
          <code>verify</code> 是失败即停止的质量门禁，不是「失败后继续分流」的判断器。
        </li>
      </ul>
    </div>
    <p>
      Claude SDK 执行路径会通过 <code>workflow_run</code> 真实调度节点、保存运行快照并记录失败节点；
      Codex / Spark 路径不给这个工具，退化为结构化执行指引，由模型按拓扑顺序推进。
      要让严格节点级调度、循环次数与失败状态真正落地，请使用支持 <code>workflow_run</code>{' '}
      的运行路径。
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
        节点完成后，把文本结果写入自己配置的 <code>outputKey</code>（状态里存的是字符串）。
      </li>
      <li>
        下游节点的输入只来自「直接连到自己、条件命中、上游带 outputKey」的那几条边；
        跨级或未命中的上游值不会出现。
      </li>
      <li>
        节点有多个入边时，会等待所有未被跳过的上游完成；如果所有入边都不满足条件，
        这个节点会被标记为跳过（skip），下游整段不可达的节点也一起跳过。
      </li>
      <li>
        节点失败时，执行器按节点类型和 <code>retryCount</code> 决定重试或结束整条工作流。
      </li>
      <li>
        执行是分层推进的：同一波里互不依赖的 <code>agent</code> / <code>subagent</code>{' '}
        节点并行派发， 原子节点串行执行，节点完成即落 <code>executions</code> 并刷新快照。
      </li>
    </ol>

    <h3 id="output-key">1.1 outputKey：节点之间传递结果的钥匙</h3>
    <p>
      连上线并不代表输出会自动传递。假设「代码调研」节点输出一份报告，应配置
      <code>outputKey = research_report</code>，后面的「编码实现」节点才能在上游输入里看到
      <code>research_report</code>。留空即视为「本节点没有输出」，运行时按无输出处理。
    </p>
    <pre>{`代码调研节点
outputKey: research_report

代码调研 ─────→ 编码实现
                 inputs.research_report`}</pre>
    <p>还有两条容易踩的规则：</p>
    <ul>
      <li>
        <strong>条件引用必须是已声明的键</strong>：连线条件或循环退出条件里的 key，
        必须是图中某个节点的 <code>outputKey</code> 或 <code>loopVar</code>，否则保存时直接报
        「工作流条件引用无效」。这样能把「键名拼错」挡在落库之前。
      </li>
      <li>
        <strong>模板占位符</strong>：节点的 <code>prompt</code> 与工具节点的 <code>toolArgs</code>
        支持 <code>&#123;&#123;key&#125;&#125;</code> 插值，取值为工作流状态 +
        当前节点活跃上游输入。 没命中的占位符保持原样（不会变成空串），方便你发现漏配的 outputKey。
      </li>
    </ul>

    <h3 id="edge-condition">1.2 条件写在连线上，不写在节点里</h3>
    <p>选中一条连线后，在右侧检查器里配置触发条件，操作符只有 5 个：</p>
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
          <td>严格等于（===）指定值</td>
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
    <p>
      比较值框里 <code>true</code> / <code>false</code> 存成布尔、<code>null</code> 存成空值、
      纯数字存成数值，其余按字符串——因为运行时用的是严格等值比较，类型不还原就对不上。
      状态键留空的条件保存后会被忽略。
    </p>
    <div className="docs-callout">
      <strong>不要用 truthy / falsy 判断字符串 “true” / “false”</strong>
      ：路由节点输出的是字符串，字符串
      <code>"false"</code> 仍然是真值。建议使用 <code>pass / retry</code>、
      <code>accept / follow_up</code>，并在条件边上配置
      <code>equals</code>。
    </div>

    <h2 id="node-kinds">2. 13 种节点分别做什么</h2>
    <p>
      <code>kind</code> 枚举共 13 个（保存时会校验，写错类型的图会被直接拒绝）：
      <code>
        input / plan / route / agent / subagent / skill / tool / mcp / approval / verify / review /
        artifact / loop
      </code>
      。按职责分为入口与流程控制、执行、治理与交付三组。
    </p>

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
          <td>把用户消息解析成目标、约束和交付物（结构化 JSON）</td>
          <td>
            <code>prompt</code>、<code>objective</code>、<code>constraint</code>、<code>value</code>
            、<code>outputKey</code>
          </td>
          <td>所有工作流入口</td>
        </tr>
        <tr>
          <td>
            <code>plan</code>
          </td>
          <td>使用只读工具集分析并制定计划（禁写、禁执行）</td>
          <td>
            Prompt、模型覆盖、<code>outputKey</code>
          </td>
          <td>编码方案、调研计划、发布计划</td>
        </tr>
        <tr>
          <td>
            <code>route</code>
          </td>
          <td>在允许的分支值里选一个输出；也可固定输出某个分支</td>
          <td>
            <code>routeOptions</code>、<code>value</code>、<code>outputKey</code>、出边条件
          </td>
          <td>复杂/简单任务、通过/返工、接受/跟进</td>
        </tr>
        <tr>
          <td>
            <code>loop</code>
          </td>
          <td>重复执行独立的内部子图，满足退出条件后停止</td>
          <td>
            <code>body</code>、<code>maxIterations</code>、<code>loopVar</code>、
            <code>resultKey</code>、<code>collectAll</code>、<code>breakCondition</code>
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
          <td>派发给绑定 Agent 的完整执行链路</td>
          <td>
            <code>agentId</code>、Prompt、模型、工具
          </td>
          <td>编码、修改文件、综合执行</td>
        </tr>
        <tr>
          <td>
            <code>subagent</code>
          </td>
          <td>创建临时子代理；可同节点并发多份</td>
          <td>
            <code>agentId</code>（可选，作为配置基底）、<code>parallelism</code>、工具
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
          <td>受限代理，或按参数确定性直调单个工具</td>
          <td>
            <code>toolIds</code> / <code>toolSource</code> + <code>toolName</code> +
            <code>toolArgs</code>
          </td>
          <td>只读检查、允许 Bash 的审计、受限编辑</td>
        </tr>
        <tr>
          <td>
            <code>mcp</code>
          </td>
          <td>受限代理使用已启用 MCP，或直调指定 MCP 工具</td>
          <td>
            <code>toolSource: 'mcp'</code> + <code>toolServerId</code> + <code>toolName</code>
          </td>
          <td>浏览器、外部文档、平台或媒体能力</td>
        </tr>
      </tbody>
    </table>
    <div className="docs-callout">
      <strong>
        <code>agent</code> 与 <code>subagent</code> 的绑定语义不同
      </strong>
      <ul>
        <li>
          <code>agent</code> 节点在托管执行里<strong>必须绑定一个已启用的 Agent</strong>：
          <code>config.agentId</code> 为空、或绑定的 Agent 不存在/已禁用，节点就以
          <code>missing_agent_id</code> 失败并停止工作流。这是刻意设计——画了 agent
          节点却静默落到宿主身上， 比明确报错更难排查。
        </li>
        <li>
          <code>subagent</code> 节点不填 <code>agentId</code> 时，会用宿主 Agent 的配置生成一个临时
          worker； 填了但绑定的 Agent 不可用，同样以 <code>missing_agent_id</code> 失败。
        </li>
        <li>
          <code>parallelism ≥ 2</code> 只对 <code>subagent</code> 生效： 同一节点在一次尝试里并发 N
          路独立派发，结果按
          <code>--- branch N ---</code> 拼接进同一个 outputKey。
        </li>
      </ul>
    </div>

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
    <p>路由节点有两种工作方式：</p>
    <ul>
      <li>
        <strong>LLM 决策</strong>（默认，<code>execution: 'auto'</code>）：派发只读临时 worker，
        让它从 <code>routeOptions</code> 里选一个 <code>value</code> 输出。
      </li>
      <li>
        <strong>固定分支</strong>（<code>value</code> + <code>execution: 'static'</code>）：
        运行时直接输出该值，不经模型，适合确定性路由。
      </li>
    </ul>
    <ol>
      <li>
        给路由节点设置 <code>outputKey</code>，例如 <code>route_mode</code>。
      </li>
      <li>
        在「路由分支」文本框里每行填写 <code>value | label | description</code>； 只有唯一且非空的
        value 会被接受，重复值会被丢弃。
      </li>
      <li>
        选中每条出边，配置 <code>route_mode equals 分支值</code>；两个分支都要有出口。
      </li>
      <li>未命中的分支及其不可达下游会被跳过，而不是报错。</li>
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
      循环节点不是外层画布上的「回跳箭头」，而是一个
      <strong>内部保存独立 WorkflowGraph 的原子节点</strong>。 只有写入 <code>config.body</code>{' '}
      的节点会被重复执行。不要把外层执行节点连回上游形成环；外层图必须保持无环，
      否则保存时就会报「工作流不允许出现循环依赖」。
    </p>
    <p>
      选中循环节点后，在右侧「循环体子图」卡片点击<strong>编辑循环体</strong>
      ，工作流编辑区会下钻到专属子图画布。
      子图里同样有节点面板、拖拽、连线、条件边、横纵布局、缩放、小地图和检查器；完成后点击
      「返回主工作流」。递归的循环体（循环里再放循环）在 v1 不被支持，编辑器会直接拦住。
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
          <td>
            每一轮重复执行的独立子图（为空则节点直接失败：<code>workflow_loop_empty</code>）
          </td>
          <td>
            <code>agent → review</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>maxIterations</code>
          </td>
          <td>最大轮数，默认 5，硬上限 50（超出会被钳到区间内）</td>
          <td>
            <code>4</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>loopVar</code>
          </td>
          <td>
            写入循环状态的轮次键，从 0 开始；默认 <code>__loop_index</code>
          </td>
          <td>
            <code>iteration_index</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>resultKey</code>
          </td>
          <td>每轮结束后作为循环节点文本的状态键；留空时取循环体里最后一个带 outputKey 的节点</td>
          <td>
            <code>iteration_report</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>collectAll</code>
          </td>
          <td>开启后输出每轮的聚合文本（带 iteration 分隔），关闭只输出最后一轮</td>
          <td>
            <code>false</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>breakCondition</code>
          </td>
          <td>每轮完成后针对循环体状态求值，命中即提前退出</td>
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
      <strong>三个重要边界</strong>
      <ul>
        <li>
          v1 不支持循环体里再嵌套 <code>loop</code>（运行时会返回
          <code>workflow_loop_nested</code>）。
        </li>
        <li>
          循环体节点 id 不能与外层节点重名，循环体内也不能重复，否则分别以
          <code>workflow_loop_node_id_collision</code>、<code>workflow_loop_duplicate_node_id</code>{' '}
          失败。
        </li>
        <li>
          达到最大轮数但没命中退出条件时，循环返回最后一轮结果并继续外层流程。
          所以循环后应增加最终复核和验收路由。
        </li>
        <li>
          循环节点本身不重试（<code>retryCount</code> 对 loop 无效）：整条循环重跑的成本不可控。
        </li>
      </ul>
    </div>

    <h2 id="tool-nodes">5. 工具节点与 MCP 节点怎么调用</h2>
    <p>
      选中 <code>tool</code> 或 <code>mcp</code> 节点后，检查器的第一项是「调用方式」：
    </p>
    <table>
      <thead>
        <tr>
          <th>调用方式</th>
          <th>tool 节点</th>
          <th>mcp 节点</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>受限代理</td>
          <td>✅</td>
          <td>✅</td>
          <td>
            tool：派发临时 worker，能力收窄到所选 <code>toolIds</code>；mcp：挂载所有已启用 MCP，
            用哪个工具、传什么参数由模型决定。
          </td>
        </tr>
        <tr>
          <td>内置工具直调</td>
          <td>✅</td>
          <td>—</td>
          <td>
            锁定单个内置工具（<code>toolSource: 'builtin'</code>），参数已预渲染， LLM
            只负责包装结果。
          </td>
        </tr>
        <tr>
          <td>MCP 工具直调</td>
          <td>✅</td>
          <td>✅</td>
          <td>
            按 <code>toolServerId</code> + <code>toolName</code> 原生调用，不经 LLM。
          </td>
        </tr>
        <tr>
          <td>平台工具直调</td>
          <td>✅</td>
          <td>—</td>
          <td>
            直接调用平台上已启用的自定义工具或工具包工具，运行时即时读取目录；
            工具被禁用后该节点会失败。
          </td>
        </tr>
      </tbody>
    </table>
    <p>几个必须知道的细节：</p>
    <ul>
      <li>
        <strong>toolIds 是「白名单」而不是「免审批名单」</strong>：一旦配置，
        未选中的可限制工具会被放进 <code>disallowedTools</code>。可选工具共 13 个：
        <code>
          Read / Write / Edit / MultiEdit / NotebookEdit / Grep / Glob / Bash / TodoWrite /
          AskUserQuestion / ExitPlanMode / WebFetch / WebSearch
        </code>
        。不选表示不额外限制。
      </li>
      <li>
        <strong>只读原子节点会自动收窄</strong>：
        <code>input / route / plan / review / artifact</code>
        禁掉 <code>Write / Edit / MultiEdit / NotebookEdit / Bash</code>； 即使你在这些节点上配了
        toolIds，也只会取其中属于只读集的那些。
      </li>
      <li>
        <strong>
          toolArgs 支持 <code>&#123;&#123;key&#125;&#125;</code> 占位符
        </strong>
        ， 用上游 outputKey 渲染出真实参数后再执行；这也是「确定性调用」能接上上游数据的原因。
      </li>
      <li>
        <strong>MCP 不按节点配置</strong>：能选服务器只是直调时要指定目标；
        受限代理模式下挂载的是应用级全部已启用 MCP。
      </li>
      <li>
        <strong>只读原子节点完全不挂 MCP</strong>：
        <code>input / route / plan / review / artifact</code> 运行在空能力集上， 既不会调用外部
        MCP，也拿不到项目级 Skill 提示词；这是刻意的边界，不是配置遗漏。
      </li>
    </ul>

    <h2 id="verify-semantics">6. verify、retryCount 和循环不要混用</h2>
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
          <td>原样重跑当前节点，范围 0~3（默认 0）</td>
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
          <td>
            命令非零退出即以 <code>verify_failed</code> 失败并停止工作流
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>verifyCommands</code> 在工作区根目录依次执行：单条命令超时 600 秒， 输出缓冲上限
      20MB。数组为空时该节点不报错，直接透传默认内容。
      <code>verify</code> 支持 <code>retryCount</code>（技术性失败可重跑）；
      <code>approval</code> 与 <code>loop</code> 固定不重试。
    </p>
    <p>
      因此，不要设计成 <code>verify → route → 失败后循环</code>
      ：真实验证命令失败时，路由没有机会执行。 需要「测试未通过后继续修复」时，让循环内的{' '}
      <code>agent</code> 运行测试并<strong>正常返回测试报告</strong>，再由
      <code>review</code> 或 <code>route</code> 输出 <code>pass / retry</code>
      。循环完成后，再放置真正的 <code>verify</code> 作为最终门禁。
    </p>
    <p>
      另外两个执行语义值得记住：<code>approval</code> 节点在用户拒绝时直接失败并停止；
      批准时附带的修改意见会拼到输出末尾，随 outputKey 流向下游。
      无人值守场景（没有问询通道）下审批默认放行并记审计，不会阻塞自动化。
    </p>

    <h2 id="full-example">7. 完整示例：编码功能任务 · 全节点能力演示</h2>
    <p>
      下面的示例用于执行真实编码功能任务，覆盖全部 13
      种节点。它把「业务质量迭代」和「最终技术门禁」分开，既能演示复杂分支，
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

    <h3 id="example-stage-1">7.1 需求、计划、审批</h3>
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
        <strong>人工审批计划</strong>：在可能产生大量改动之前停下来，让用户决定是否继续；
        被拒绝时工作流在此停止。
      </li>
    </ul>

    <h3 id="example-stage-2">7.2 复杂度分流与编码实现</h3>
    <p>
      「任务复杂度路由」配置 <code>full / quick</code> 两个值。<code>full</code> 分支运行并发数为 2
      的子代理调研，
      <code>quick</code> 分支直接进入主 Agent。两个分支最终汇合到「主 Agent 编码实现」。 注意这个
      agent 节点必须绑定一个已启用的 Agent，否则会以
      <code>missing_agent_id</code> 失败。
    </p>

    <h3 id="example-stage-3">7.3 循环修复</h3>
    <p>
      主 Agent 首次实现后进入循环。循环体的 Agent
      检查当前工作区、修复问题并运行任务相关测试；即使测试未通过，也要正常返回
      <code>iteration_report</code>。只读 Review 根据报告严格输出 <code>pass</code> 或{' '}
      <code>retry</code>，从而控制是否开始下一轮。
    </p>

    <h3 id="example-stage-4">7.4 并行审计与真实门禁</h3>
    <p>循环结束后同时运行三种互补检查：</p>
    <ul>
      <li>
        <strong>Skill</strong>：加载验证类 Skill，检查「已经完成」的声明是否有新鲜证据。
      </li>
      <li>
        <strong>Tool</strong>：只开放 <code>Read / Grep / Glob / Bash</code>，限制审计能力边界。
      </li>
      <li>
        <strong>MCP</strong>：受限代理模式下自动挂载应用当前已启用的 MCP（也可改成 MCP 直调）；
        没有相关外部依赖时返回 <code>no_external_check_needed</code>。
      </li>
    </ul>
    <div className="docs-callout">
      <strong>这三个节点是可选扩展，不是编码工作流的固定套餐</strong>
      <ul>
        <li>
          <strong>Skill</strong> 固定「使用什么方法论」，团队有验证规范时再选。
        </li>
        <li>
          <strong>Tool</strong> 限制「允许用什么手段」，需要独立受限审计时再放。
        </li>
        <li>
          <strong>MCP</strong> 连接外部系统；普通本地编码没有浏览器、官方文档、Issue
          或远程平台依赖时可以删除。
        </li>
      </ul>
    </div>
    <p>
      三条并行分支汇合后，<code>verify</code> 执行 <code>git diff --check</code>
      。这是通用门禁；项目自己的单测、类型检查和构建命令， 应根据仓库情况追加到{' '}
      <code>verifyCommands</code>。
    </p>

    <h3 id="example-stage-5">7.5 最终复核与双交付物</h3>
    <p>
      最终 Review 汇总实现结果、循环报告、三种审计和命令输出。验收路由把自然语言复核结果归一化为
      <code>accept / follow_up</code>
      ：通过时生成正式交付物；未通过时生成跟进报告，不会错误声称任务已经验收。 两个 artifact 都配了{' '}
      <code>outputKey</code>；配了 <code>exportPath</code> 的那个还会把内容写进工作区文件
      （必须是工作区相对路径，越界会被拒绝）。
    </p>

    <h2 id="execution-modes">8. 谁在驱动这张图：三种执行模式</h2>
    <p>同一张图在不同执行器上的落地强度不同，界面上的文案如下：</p>
    <table>
      <thead>
        <tr>
          <th>模式</th>
          <th>界面文案</th>
          <th>触发条件</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>workflow_run</code>
          </td>
          <td>托管执行</td>
          <td>Claude SDK 执行器 + 图里有可派发节点 + 有托管执行器 + 不是 @ 提及轮</td>
          <td>
            宿主拿到 <code>workflow_run</code> 工具，运行时按依赖波次真实执行节点、落
            <code>workflow_runs</code> 快照并支持断点续跑
          </td>
        </tr>
        <tr>
          <td>
            <code>codex_guided</code>
          </td>
          <td>引导执行</td>
          <td>Codex 或 Spark 执行器</td>
          <td>
            不暴露 <code>workflow_run</code>
            ，把图作为执行计划注入提示词，由模型在本轮内按拓扑顺序推进
          </td>
        </tr>
        <tr>
          <td>
            <code>guided</code>
          </td>
          <td>引导执行</td>
          <td>没有工作流图、托管执行器不可用，或该轮是 @ 提及</td>
          <td>只按节点顺序引导，不承诺节点级调度</td>
        </tr>
      </tbody>
    </table>
    <p>会话级还能覆盖 Agent 的默认工作流，入口在会话输入栏的工作流选择器：</p>
    <ul>
      <li>
        <strong>继承 Agent 默认</strong>（<code>mode: 'inherit'</code>）：用宿主 Agent
        绑定的工作流。
      </li>
      <li>
        <strong>本会话不使用工作流</strong>（<code>mode: 'disabled'</code>）。
      </li>
      <li>
        <strong>指定某个工作流</strong>（<code>mode: 'override'</code> + <code>workflowId</code>）：
        下拉里只列「已启用且状态为 active」的工作流。
      </li>
    </ul>
    <p>
      绑定写进独立的 <code>session_workflow_bindings</code> 表（带
      <code>binding_instance_id</code> 做乐观锁），不污染 <code>sessions.metadata</code>。
      会话正在跑、队列里还有消息、有未处理的审批或提问、目标进行中、或已有
      <code>working</code> 状态的运行记录时，改绑定会被阻止并给出对应原因；
      失败运行可以点「放弃并新建运行」，旧运行标记为 canceled，历史保留。
    </p>

    <h2 id="build-in-app">9. 在应用里照着配置</h2>
    <ol>
      <li>打开左侧「工作流」（Beta），点「新建工作流」，进入编排详情。</li>
      <li>
        先放置外层主链：<code>input → plan → approval → route → agent → loop</code>。
      </li>
      <li>
        给复杂度路由增加 <code>full / quick</code> 分支，在出边上使用 <code>equals</code>。
      </li>
      <li>
        在 <code>full</code> 分支放置 <code>subagent</code>，把并发数设为 2，然后与 quick 分支汇合。
      </li>
      <li>
        打开循环节点右侧检查器，点「编辑循环体」，在子图画布放置 <code>agent → review</code>{' '}
        并连线，配置退出条件后返回主工作流。
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
      <li>
        把状态从 <code>draft</code> 切到 <code>active</code> 保存；然后在 Agent
        的「工作流」下拉里绑定它， 或在会话的工作流选择器里覆盖。
      </li>
      <li>
        用工具栏的「试跑」在编辑器内跑一次（执行的是已保存版本，走真实会话与节点级进度），
        需要回看时点「历史」。
      </li>
    </ol>
    <p>
      「试跑」与「历史」都会打开右侧面板：历史面板按 <code>workflow_runs</code> 列出每次运行，
      展开可看逐节点状态、错误、输出预览与耗时，运行状态只有
      <code>working / completed / failed / canceled</code> 四种。
    </p>

    <h2 id="save-validation">10. 保存闸门与运行错误码</h2>
    <p>
      工作流在<strong>保存时</strong>就会做两层校验，避免把问题留到运行期：
    </p>
    <ul>
      <li>
        <strong>形状层</strong>：<code>kind</code> 必须在 13 种枚举内；
        <code>config</code> 是严格对象——未知字段、类型错误、超界值都会被拒绝。 边界值包括{' '}
        <code>retryCount ≤ 3</code>、<code>parallelism 1~8</code>、<code>maxIterations 1~50</code>、
        <code>prompt</code> 最长 10 万字符、 节点最多 1000 个、边最多 5000 条。
      </li>
      <li>
        <strong>拓扑层</strong>
        ：未知节点类型、有向环、条件引用未声明的状态键，三类问题都在写入前拦下，
        报错里带节点标题便于定位。
      </li>
    </ul>
    <p>
      会话挂载工作流或改绑定时还会跑一次预检，问题码（界面会翻译成中文）：
      <code>workflow_not_found</code>、<code>workflow_disabled</code>、
      <code>workflow_not_active</code>、<code>workflow_run_snapshot_invalid</code>、
      <code>graph_cycle</code>、<code>invalid_condition_reference</code>、
      <code>invalid_loop_body</code>、<code>unsupported_node_kind</code>、<code>missing_agent</code>
      、<code>disabled_agent</code>、<code>missing_required_skill</code>、
      <code>missing_required_tool</code>、<code>missing_required_mcp</code>；警告类是
      <code>provider_uses_host_fallback</code>、<code>optional_mcp_unavailable</code>、
      <code>workflow_archived_for_existing_binding</code>、
      <code>definition_newer_than_resumable_run</code>、<code>bundle_dependency_unresolved</code>。
    </p>
    <p>运行期会出现的失败码，对照排查：</p>
    <table>
      <thead>
        <tr>
          <th>错误码</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>missing_agent_id</code>
          </td>
          <td>agent / subagent 节点没绑定 Agent，或绑定的 Agent 不可用</td>
        </tr>
        <tr>
          <td>
            <code>workflow_deadlock</code>
          </td>
          <td>图里存在环，无法继续推进</td>
        </tr>
        <tr>
          <td>
            <code>verify_failed</code>
          </td>
          <td>verify 命令非零退出</td>
        </tr>
        <tr>
          <td>
            <code>workflow_loop_empty</code>
          </td>
          <td>loop 节点缺少非空的 body 子图</td>
        </tr>
        <tr>
          <td>
            <code>workflow_loop_nested</code>
          </td>
          <td>循环体里出现嵌套 loop（v1 不支持）</td>
        </tr>
        <tr>
          <td>
            <code>workflow_loop_node_id_collision</code>
          </td>
          <td>循环体节点 id 与外层节点重名</td>
        </tr>
        <tr>
          <td>
            <code>workflow_loop_duplicate_node_id</code>
          </td>
          <td>循环体内节点 id 重复</td>
        </tr>
        <tr>
          <td>
            <code>workflow_tool_invoke_failed</code>
          </td>
          <td>工具 / MCP 直调失败（例如平台工具被停用）</td>
        </tr>
      </tbody>
    </table>

    <h2 id="safe-defaults">11. 推荐的安全默认值</h2>
    <ul>
      <li>
        <code>input / plan / review / artifact</code> 保持只读：这些节点运行时会自动禁掉
        <code>Write / Edit / MultiEdit / NotebookEdit / Bash</code>。
      </li>
      <li>
        真正修改代码只放在 <code>agent / subagent / tool</code> 节点，且 agent 节点显式绑定 Agent。
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
      <li>
        把「业务是否达标」交给 loop + review，把「技术是否通过」交给 verify，两者不要互相替代。
      </li>
    </ul>

    <h2 id="troubleshooting">12. 常见配置错误</h2>
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
          <td>保存时报「工作流不允许出现循环依赖」</td>
          <td>外层画布上画了回边</td>
          <td>
            删除回边，把重复步骤放进 <code>loop</code> 的 body 子图
          </td>
        </tr>
        <tr>
          <td>保存时报「条件引用无效」</td>
          <td>条件里的状态键没有任何节点声明过</td>
          <td>
            先给上游节点配好 <code>outputKey</code>，或在检查器里点「使用 xx」自动填充
          </td>
        </tr>
        <tr>
          <td>保存时报不支持节点类型</td>
          <td>
            手写或导入的 JSON 里 <code>kind</code> 拼错
          </td>
          <td>
            改成 13 种合法 <code>kind</code> 之一；注意运行时会把未知 kind 静默当成 agent，
            所以保存闸门特意拦下
          </td>
        </tr>
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
            上游没有 <code>outputKey</code>，或两者没有直接有效连线，或条件未命中
          </td>
          <td>
            配置 outputKey 并检查条件边；必要时用 <code>&#123;&#123;key&#125;&#125;</code> 显式引用
          </td>
        </tr>
        <tr>
          <td>运行一上来就 workflow_deadlock</td>
          <td>旧数据里存了带环的图，绕过了新保存闸门</td>
          <td>重新保存一次让校验跑起来，或在编辑器里删除成环的边</td>
        </tr>
        <tr>
          <td>agent 节点报 missing_agent_id</td>
          <td>节点没有绑定 Agent，或绑定的 Agent 已停用/删除</td>
          <td>在检查器里重新选择一个启用中的 Agent</td>
        </tr>
        <tr>
          <td>verify 失败后没有进入路由</td>
          <td>verify 是失败即停止节点</td>
          <td>业务判断放进循环，verify 放最终门禁</td>
        </tr>
        <tr>
          <td>循环达到上限仍继续</td>
          <td>最大轮数结束会返回最后结果并继续外层流程</td>
          <td>循环后增加最终 Review 和验收路由</td>
        </tr>
        <tr>
          <td>循环节点直接失败</td>
          <td>body 为空、节点 ID 与外层冲突或嵌套 loop</td>
          <td>打开循环体可视化编辑器，按错误码检查节点、连线和 ID</td>
        </tr>
        <tr>
          <td>Agent 不能编辑文件</td>
          <td>用了只读节点，或 toolIds 漏选编辑工具</td>
          <td>
            改用 agent/subagent，或在 tool 节点的 <code>toolIds</code> 里放行 Edit / Write
          </td>
        </tr>
        <tr>
          <td>MCP 节点没有目标能力</td>
          <td>应用层没有启用对应 MCP</td>
          <td>到 MCP 管理页启用服务后重试</td>
        </tr>
        <tr>
          <td>以为有 workflow_run 但模型在「自己演」</td>
          <td>当前执行器是 Codex / Spark，属于引导执行</td>
          <td>需要节点级调度时切到 Claude SDK 执行器</td>
        </tr>
      </tbody>
    </table>
  </div>
)

export const workflowUsage: DocsPageContent = {
  slug: 'workflow-usage',
  toc: [
    { id: 'mental-model', title: '1. 工作流的运行模型', level: 2 },
    { id: 'output-key', title: '1.1 outputKey 与状态传递', level: 3 },
    { id: 'edge-condition', title: '1.2 条件写在连线上', level: 3 },
    { id: 'node-kinds', title: '2. 13 种节点分别做什么', level: 2 },
    { id: 'nodes-control', title: '2.1 入口与流程控制', level: 3 },
    { id: 'nodes-execution', title: '2.2 执行节点', level: 3 },
    { id: 'nodes-governance', title: '2.3 治理与交付', level: 3 },
    { id: 'route-guide', title: '3. 路由节点配置', level: 2 },
    { id: 'loop-guide', title: '4. 循环节点配置', level: 2 },
    { id: 'tool-nodes', title: '5. 工具节点与 MCP 节点', level: 2 },
    { id: 'verify-semantics', title: '6. 验证与重试语义', level: 2 },
    { id: 'full-example', title: '7. 完整编码工作流', level: 2 },
    { id: 'example-stage-1', title: '7.1 需求、计划、审批', level: 3 },
    { id: 'example-stage-2', title: '7.2 分流与实现', level: 3 },
    { id: 'example-stage-3', title: '7.3 循环修复', level: 3 },
    { id: 'example-stage-4', title: '7.4 并行审计与门禁', level: 3 },
    { id: 'example-stage-5', title: '7.5 复核与交付', level: 3 },
    { id: 'execution-modes', title: '8. 三种执行模式', level: 2 },
    { id: 'build-in-app', title: '9. 在应用里配置', level: 2 },
    { id: 'save-validation', title: '10. 保存闸门与错误码', level: 2 },
    { id: 'safe-defaults', title: '11. 安全默认值', level: 2 },
    { id: 'troubleshooting', title: '12. 常见配置错误', level: 2 },
  ],
  faq: [
    {
      question: '路由节点和循环节点有什么区别？',
      answer:
        '路由节点只选择一次后续分支，分支值受 routeOptions 约束；循环节点会重复执行自己的 body 子图，直到命中 breakCondition 或达到 maxIterations（默认 5，上限 50）。外层画布必须无环，保存时会做环检测。',
    },
    {
      question: '为什么 agent 节点会报 missing_agent_id？',
      answer:
        '托管执行（workflow_run）不把未绑定的 agent 节点静默交给宿主：config.agentId 为空或绑定的 Agent 不存在/已禁用时，节点以 missing_agent_id 失败并停止工作流。需要「跟随宿主」时用 subagent 节点（不填 agentId 会用宿主配置生成临时 worker）。',
    },
    {
      question: '为什么 verify 失败后不能进入 retry 分支？',
      answer:
        'verify 是硬性命令门禁，任一命令非零退出即返回 verify_failed 并停止整条工作流。需要质量迭代时，让循环内 Agent 返回测试报告，再由 Review 或 Route 输出 pass/retry；循环结束后再运行 verify。',
    },
    {
      question: '已经连线了，下游还是看不到上游结果？',
      answer:
        '连线只建立依赖。上游必须配置 outputKey，边条件必须命中，而且下游只接收直接相连的上游输入；三者缺一都看不到。可以在 prompt 或 toolArgs 里用 {{key}} 显式引用，未命中的占位符会原样保留，便于发现漏配。',
    },
    {
      question: '循环达到最大轮数还没通过怎么办？',
      answer:
        '循环会返回最后一轮结果并继续外层流程，不会自动失败。所以应在循环后增加最终 Review 和验收 Route，把未通过的结果送到 follow_up 产物，而不是直接交付。',
    },
    {
      question: 'MCP 节点需要逐个绑定 MCP 服务器吗？',
      answer:
        '不需要。受限代理模式下所有「已启用」的应用 MCP 自动挂载；只有在选择「MCP 工具直调」时才需要指定服务器和工具名。要减少可用能力，请在 MCP 管理页全局停用服务。',
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
    { key: '边条件操作符', value: 'exists / equals / not_equals / truthy / falsy' },
    { key: 'retryCount', value: '0~3，默认 0；approval 与 loop 不重试' },
    { key: '循环语义', value: '只重复 config.body 子图；默认 5 轮，硬上限 50；v1 不支持嵌套 loop' },
    { key: 'subagent 并发', value: 'parallelism 1~8，仅 subagent 节点生效' },
    {
      key: 'verify 语义',
      value: 'verifyCommands 在工作区依次执行，单条超时 600s，缓冲 20MB，失败即 verify_failed',
    },
    {
      key: '状态传递',
      value: '上游必须配置 outputKey；下游只接收直接命中条件的上游输出；{{key}} 可插值',
    },
    { key: '执行模式', value: 'workflow_run（托管执行）/ codex_guided / guided（引导执行）' },
    { key: 'MCP', value: '应用级已启用 MCP 自动挂载，节点不再维护 allow-list' },
    { key: '运行记录', value: 'workflow_runs 保存状态、state、节点执行、失败节点与跳过集合' },
  ],
  howTo: {
    name: '创建「编码功能任务 · 全节点能力演示」工作流',
    description: '配置需求、审批、分流、并行调研、循环修复、并行审计、真实验证和双交付物',
    totalTime: 'PT20M',
    steps: [
      '新建纵向工作流，添加 input、plan、approval、route、agent 和 loop 主链',
      '给复杂度 route 配置 full / quick 分支，并在出边上使用 equals 条件',
      '在 full 分支添加 parallelism=2 的 subagent，并与 quick 分支汇合',
      '给主 agent 节点绑定一个已启用的 Agent（否则运行时会 missing_agent_id）',
      '在 loop 的 body 子图里配置 agent → review，用 verdict equals pass 作为退出条件',
      '循环后并行添加 skill、tool 和 mcp 节点',
      '让三条审计分支汇合到 verify，并配置项目验证命令',
      '添加最终 review、accept/follow_up route 和两个 artifact（需要落盘时配 exportPath）',
      '检查每个需要传递结果的节点都有唯一的 outputKey，把状态切到 active 并保存',
      '用「试跑」验证节点级进度，再绑定到 Agent 或在会话工作流选择器里覆盖',
    ],
  },
  aiSummary:
    'Spark Work 工作流是一张可视化、可执行、可审计的任务图，由节点、依赖边、outputKey 状态和条件边共同驱动，图存在 workflows.graph_json，运行快照存在 workflow_runs。' +
    '节点共 13 种：input、plan、route、agent、subagent、skill、tool、mcp、approval、verify、review、artifact、loop；边条件只有 exists/equals/not_equals/truthy/falsy 五个操作符，比较值按布尔/数值/字符串还原类型后严格比较，条件引用的状态键必须是某个节点声明过的 outputKey 或 loopVar，否则保存被拒。' +
    'agent/subagent 节点会真实派发：agent 必须绑定已启用的 Agent（否则 missing_agent_id），subagent 未绑定时用宿主配置生成临时 worker 且支持 parallelism 1~8 的并发分支；tool/mcp 节点支持受限代理、内置工具直调、MCP 直调与平台工具直调。' +
    'loop 是包裹独立 config.body 子图的原子节点，支持 maxIterations（默认 5、上限 50）、loopVar、resultKey、collectAll、breakCondition，v1 不支持嵌套 loop 且循环体 id 不能与外层冲突；verify 在工作区执行 verifyCommands，单条超时 600 秒、缓冲 20MB，非零退出即 verify_failed 停止工作流，因此业务返工应放进 loop。' +
    '执行模式分 workflow_run（Claude SDK，托管执行，暴露 mcp__spark_team__workflow_run）、codex_guided 与 guided（引导执行）；会话可通过 session_workflow_bindings 覆盖为 inherit/override/disabled，编辑器提供「试跑」与「历史」面板，保存前有形状层与拓扑层双重闸门（含环检测与条件引用检测）。',
  Body,
}

export default workflowUsage
