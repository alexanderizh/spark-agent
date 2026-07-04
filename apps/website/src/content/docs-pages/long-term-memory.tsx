import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      默认情况下，AI 助手每次对话都从零开始 —— 你说过的偏好、项目背景、长期约定，
      下一会话就忘了。Spark Agent 内置<strong>三层长期记忆系统</strong>，让 Agent
      自动沉淀跨会话、跨时间仍然有用的事实与反馈，后续会话开箱即得你之前的上下文。
    </p>

    <h2 id="scopes">1. 三层作用域：记忆不会串味</h2>
    <p>每条记忆按作用范围分三层独立存储，避免"项目 A 的决策污染项目 B"：</p>
    <table>
      <thead>
        <tr><th>作用域</th><th>存什么</th><th>举例</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>User（跨项目）</strong></td>
          <td>身份、角色、技术栈、跨项目通用的偏好与约定</td>
          <td>"我是 Java 工程师"、"偏好先讨论再动手"、"PR 颗粒度要小"</td>
        </tr>
        <tr>
          <td><strong>Project（项目专属）</strong></td>
          <td>仅对当前 workspace 成立的决策、架构、节奏、人员配置</td>
          <td>"这个项目选 Arco 不用 antd"、"这个项目我独自开发"、"Q3 要上线 X"</td>
        </tr>
        <tr>
          <td><strong>Agent（角色专属）</strong></td>
          <td>仅对某个 Agent 角色有效的记忆</td>
          <td>"审查 Agent 关注 PR 颗粒度"、"调研 Agent 用 Bocha 搜索"</td>
        </tr>
      </tbody>
    </table>
    <p>
      项目级记忆跟随项目代码目录存储（<code>&lt;workspace&gt;/.spark-agent/memory/</code>），
      用户级和 Agent 级存储在应用 home。Agent 在会话中只会看到当前 scope 集合内的记忆 ——
      切换工作区时项目记忆自动隔离。
    </p>

    <h2 id="architecture">2. 后台自动抽取：不干扰主对话</h2>
    <p>
      记忆写入采用<strong>后台独立抽取</strong>架构（与 OpenAI Memory、Mem0 同款）：
      每轮对话结束后，系统异步用一个轻量 LLM 从对话中判断"有没有值得长期记住的"，
      主对话本身完全不参与记忆决策。
    </p>
    <p>这样设计带来四个关键优势：</p>
    <ul>
      <li>
        <strong>主对话不被"该不该记"打断</strong>：Agent 100% 注意力放在你的任务上，
        不用分心判断哪些信息要存，对话体验更纯粹。
      </li>
      <li>
        <strong>成本最优</strong>：主对话用强模型（如 Claude Sonnet / GPT-4o）推进任务，
        记忆抽取用便宜小模型（如 deepseek-chat / claude-haiku / gpt-4o-mini），不必为
        "判断该不该记"付强模型的钱。
      </li>
      <li>
        <strong>故障不影响主流程</strong>：抽取 LLM 宕机 / 超时 / 配错 key 时，记忆系统
        安静降级（本轮不抽取），对话照常进行，用户完全无感。
      </li>
      <li>
        <strong>能做回顾性进化</strong>：后台能跑整合 job，把多条零散反馈升华为通用模式、
        把重复记忆合并 —— 这是"边对话边记忆"的 Agent 工具方案做不到的。
      </li>
    </ul>
    <p>
      未配置抽取模型时，自动回退到当前会话的对话模型（含 <code>@mention</code> 切换到
      成员 Agent 的模型），零配置也能用；配了独立抽取模型则更省成本。
    </p>

    <h2 id="retrieval">3. 混合检索 + 会话注入：关键词和语义都能命中</h2>
    <p>每条记忆同时进入两个索引：</p>
    <ul>
      <li><strong>FTS5 全文索引</strong>（BM25 排序）—— 关键词命中，配 OpenAI 兼容 embedding 时升级为：</li>
      <li><strong>向量检索</strong>（sqlite-vec）—— 语义命中，"偏好函数式组件"能被"组件写法"召回</li>
    </ul>
    <p>
      两路结果用 RRF 融合 + 时间衰减重排（越久没用的记忆越沉底）。不配向量模型时自动
      降级为 FTS-only，零向量成本也能用。
    </p>
    <p>
      <strong>会话开始时</strong>，系统把当前 scope 内最相关的记忆摘要自动注入 system prompt
      （feedback 守则全量 + 其他类型按相关子集），Agent 不用主动调工具就能拿到历史上下文。
    </p>

    <h2 id="tools">4. Agent 按需检索工具（命名空间 <code>mcp__spark_memory__</code>）</h2>
    <p>
      注入的摘要不够用时，Agent 可调用两个工具主动深挖（在 Claude SDK / Codex CLI / Claude CLI
      路径下注册；Codex SDK API-only 路径因架构限制仅支持注入）：
    </p>
    <table>
      <thead>
        <tr><th>工具</th><th>说明</th><th>参数</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><code>search_memory</code></td>
          <td>按语义/关键词搜索三层记忆，返回 id + 摘要列表</td>
          <td><code>query</code>(必填) · <code>type</code> · <code>limit</code></td>
        </tr>
        <tr>
          <td><code>recall_memory</code></td>
          <td>读取某条记忆的完整正文（含 Why / How to apply）</td>
          <td><code>id</code>(必填)</td>
        </tr>
      </tbody>
    </table>

    <h2 id="config">5. 配置与降级</h2>
    <p>在<strong>设置 → Agent → 记忆</strong>配置：</p>
    <ul>
      <li><strong>抽取模型</strong>：选 OpenAI 兼容 provider（deepseek/openrouter/openai/自部署 vLLM）或 anthropic 原生（claude）；留空则回退到对话模型</li>
      <li><strong>向量模型</strong>：可选，仅 OpenAI 兼容（anthropic 不提供 embedding）；留空则 FTS-only</li>
      <li><strong>整合 job</strong>：默认开启，触发阈值 30 条 / 间隔 7 天（真机测试可调小）</li>
      <li><strong>总开关</strong>：关闭后注入 / 写入 / 整合全停</li>
    </ul>
    <p>
      配置页内置<strong>"测试抽取配置"</strong>按钮，主动跑一次真实 LLM 调用验证连通性，
      避免"配错 key 后只能从记忆静默不生成被动发现"。
    </p>

    <h2 id="storage">6. 数据存储与隐私</h2>
    <ul>
      <li><strong>本地优先</strong>：所有记忆数据存本地（DB + markdown 文件），不上云</li>
      <li><strong>正文 markdown</strong>：可读可编辑，<code>&lt;workspace&gt;/.spark-agent/memory/*.md</code> 跟随项目</li>
      <li><strong>敏感词闸门</strong>：含 API key / 凭证 / 个人隐私的记忆自动拒绝写入</li>
      <li><strong>bi-temporal 模型</strong>：失效记忆保留历史（<code>superseded_by</code> 链可追溯）</li>
    </ul>
  </>
)

const page: DocsPageContent = {
  slug: 'long-term-memory',
  toc: [
    { id: 'scopes', title: '三层作用域：记忆不会串味', level: 2 },
    { id: 'architecture', title: '后台自动抽取：不干扰主对话', level: 2 },
    { id: 'retrieval', title: '混合检索 + 会话注入', level: 2 },
    { id: 'tools', title: 'Agent 按需检索工具', level: 2 },
    { id: 'config', title: '配置与降级', level: 2 },
    { id: 'storage', title: '数据存储与隐私', level: 2 },
  ],
  faq: [
    {
      question: '记忆会不会被别的项目看到？',
      answer:
        '不会。三层作用域严格隔离：User 跨项目共享（身份/偏好），Project 仅当前 workspace 可见（项目决策），Agent 仅对应角色可见。项目 A 的决策记忆在项目 B 完全不可见。',
    },
    {
      question: '为什么不让 Agent 自己决定记什么？',
      answer:
        '后台独立抽取不让 Agent 分心判断"该不该记"，主对话体验更纯粹；可以用便宜小模型做抽取（强模型只管对话）；抽取失败不影响主流程；后台还能跑整合 job 做回顾性进化。这是 OpenAI Memory、Mem0 等主流产品的同款架构。',
    },
    {
      question: '配错抽取模型会怎样？',
      answer:
        '记忆系统安静降级（本轮不抽取），主对话完全不受影响。配置页内置"测试抽取配置"按钮可主动验证连通性，避免被动等待。',
    },
  ],
  aiSummary:
    'Spark Agent 三层长期记忆系统：User/Project/Agent 三层作用域隔离，记忆不会跨项目串味；后台独立 LLM 抽取（与 OpenAI Memory、Mem0 同款架构）不干扰主对话、可用便宜模型降本、故障不影响主流程、支持回顾性整合进化；FTS5+sqlite-vec 混合检索 + 会话自动注入 + search_memory/recall_memory 工具按需深挖；本地优先存储，项目级记忆跟随代码目录。',
  quickReference: [
    { key: '作用域', value: 'User（跨项目）/ Project（项目专属）/ Agent（角色专属）' },
    { key: '抽取架构', value: '后台独立 LLM（OpenAI 兼容 / anthropic 原生），未配则回退对话模型' },
    { key: '检索', value: 'FTS5 BM25 + sqlite-vec 向量 RRF 融合 + 时间衰减' },
    { key: '工具', value: 'mcp__spark_memory__search_memory / recall_memory' },
    { key: '存储', value: '本地 SparkDB（索引）+ markdown 正文（项目级跟随代码）' },
  ],
  Body,
}

export default page
