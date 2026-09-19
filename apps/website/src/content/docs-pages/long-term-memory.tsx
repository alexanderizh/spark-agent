import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      默认情况下每次新会话都从零开始：你上次说过的偏好、项目里的技术选型、长期约定，
      下个会话就没了。Spark Work 内置三层长期记忆：记忆以 markdown 文件为事实来源、 以本地 SQLite
      为索引，由<strong>每轮对话结束后触发的后台抽取</strong>写入， 在
      <strong>每轮对话开始时</strong>按相关度检索并注入 system prompt。
    </p>

    <h2 id="scopes">1. 三层作用域：键名、scope_ref 与落盘位置</h2>
    <p>
      <code>scope</code> 只有三个取值：<code>user</code>、<code>project</code>、<code>agent</code>。
      真正决定「这条记忆属于谁」的是 <code>scope_ref</code>：
    </p>
    <table>
      <thead>
        <tr>
          <th>scope</th>
          <th>scope_ref</th>
          <th>markdown 落盘位置</th>
          <th>可见范围</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>user</code>
          </td>
          <td>
            <code>NULL</code>
          </td>
          <td>
            <code>~/.spark-agent/memory/user/&lt;id&gt;.md</code>
          </td>
          <td>所有项目、所有 Agent 共享（身份、跨项目偏好）</td>
        </tr>
        <tr>
          <td>
            <code>project</code>
          </td>
          <td>
            <code>workspaceId</code>
          </td>
          <td>
            <code>&lt;workspace&gt;/.spark-agent/memory/&lt;id&gt;.md</code>
          </td>
          <td>仅该工作区；跟随代码目录走，可随仓库迁移</td>
        </tr>
        <tr>
          <td>
            <code>agent</code>
          </td>
          <td>
            <code>agentId</code>
          </td>
          <td>
            <code>~/.spark-agent/memory/agent/&lt;agentId&gt;/&lt;id&gt;.md</code>
          </td>
          <td>仅该 Agent 角色（含团队成员各自的 agent scope）</td>
        </tr>
      </tbody>
    </table>
    <p>
      每个 scope 目录下还会维护一份 <code>MEMORY.md</code> 索引（每行
      <code>- [名称](文件.md) — 描述</code>），方便你直接翻目录理解 Agent 记住了什么。
      记忆文件用「先写 <code>.tmp</code> 再 rename」的原子写入，避免半截文件。
    </p>
    <p>
      两个真实约束：<strong>project 记忆必须有工作区</strong>——会话没绑定工作区时， 候选里{' '}
      <code>scope=project</code> 的条目会被丢弃（写入端也会报 VALIDATION_FAILED）；
      <strong>scope_ref 的空串会被归一成 NULL</strong>，避免出现既不是 NULL 也不是合法 ID 的 「孤儿
      project 记忆」。
    </p>
    <p>
      另一条容易混淆的维度是 <code>type</code>，它和 scope 正交，取值四个：
      <code>user</code>（关于用户的事实）、<code>feedback</code>
      （行为守则，如「先给结论」「别自动提交」）、
      <code>project</code>（项目决策）、<code>reference</code>（外部资料线索）。 scope
      决定「谁能看到」，type 决定「怎么处理」——例如 feedback 类型永远全量注入，不靠检索。
    </p>

    <h2 id="write">2. 写入：每轮结束的后台抽取与五道闸门</h2>
    <p>
      <strong>触发时机</strong>：宿主会话的每一轮 turn 结束、且助手产生了非空文本时，
      运行时异步调用记忆写入流程（fire-and-forget：任何异常只写日志，绝不影响主对话）。
      团队模式下，每个成员的回复也会按该成员的 agentId 单独触发一次抽取，
      所以成员发现的技术决策同样会沉淀。
    </p>
    <p>
      <strong>用哪个模型</strong>：读取设置项 <code>memory.extractionProviderId</code> 与{' '}
      <code>memory.extractionModel</code>，通过模型服务发起一次真实 LLM 调用。 支持 Anthropic 原生（
      <code>/v1/messages</code>）与 OpenAI 兼容（<code>/chat/completions</code>） 两种协议，
      <strong>不支持 responses API</strong>。两个设置项都没配时，自动回退到当前会话正在用的对话模型
      （<code>@mention</code>{' '}
      到成员时用该成员的模型），因此零配置也能用；模型不可用时这一轮就不产出记忆， 日志里会写{' '}
      <code>memory extraction LLM unavailable</code>。
    </p>
    <p>抽取结果要连续过五道闸门，任何一道没过就丢弃：</p>
    <ol>
      <li>
        <strong>瞬时数据</strong>
        ：命中「临时/当前这次/今天」这类模式的名字或描述被拒，避免把一次性状态当长期事实。
      </li>
      <li>
        <strong>置信度</strong>：模型给的 <code>confidence</code> 必须 ≥ <code>0.6</code>。
      </li>
      <li>
        <strong>去重与合并</strong>：与该 scope 内已有记忆比对；V2 会用 FTS 召回相似条目，让模型判定
        ADD / UPDATE / DELETE / NOOP，而不是无脑新增。
      </li>
      <li>
        <strong>配额</strong>：默认上限 <code>user 100</code> / <code>project 200</code> /{' '}
        <code>agent 50</code>（可用设置项 <code>memory.quota</code> 覆盖单层数值）。
      </li>
      <li>
        <strong>敏感内容</strong>
        ：命中密钥、令牌、私钥等模式（以及隐私类模式）的记忆被拒，不落盘、不建索引。
      </li>
    </ol>
    <p>
      通过后按顺序落三处：markdown 文件（事实来源）→ SQLite 行（<code>memory_entry</code>，
      同事务维护全文索引）→ 刷新 <code>MEMORY.md</code>。落库时会把抽取出的实体（人名、库名、
      模块名、系统名）写进实体关联图，供后续检索做一跳扩展。
    </p>

    <h2 id="retrieval">3. 检索：FTS5 + 向量两路并行，RRF 融合后重排</h2>
    <ul>
      <li>
        <strong>FTS5 全文</strong>：<code>memory_fts</code> 是与 <code>memory_entry</code> rowid
        对齐的 contentless FTS5 表，索引 name / description /
        正文；中文在写入与查询两侧都做逐字预分词 （两侧不一致会直接查不到），排序用{' '}
        <code>bm25()</code>。
      </li>
      <li>
        <strong>向量检索</strong>：<code>memory_vec</code> 是 sqlite-vec 的 <code>vec0</code>{' '}
        虚拟表， 维度取决于你配的 embedding 模型，运行时惰性建表并把维度记在设置项{' '}
        <code>memory.vecDimension</code>；
        换模型导致维度变化时会重建表，旧向量丢弃后由后台懒回填补齐。查询走 KNN（
        <code>embedding MATCH ? AND k = ?</code>），先多取候选再回表按 scope / type / 归档 /
        失效过滤。
      </li>
      <li>
        <strong>融合与重排</strong>：两路各取 top20，用 RRF 融合（
        <code>score = Σ 1/(60 + rank)</code>， 同一条双路命中则相加），再乘时间衰减与置信度：
        <code>finalScore = rrf × exp(-λ × 距今天数) × confidence</code>，λ 默认 <code>0.01</code>
        （设置项 <code>memory.timeDecayLambda</code>，数值越大旧记忆沉降越快）。
      </li>
      <li>
        <strong>过滤</strong>：只召回 <code>archived = 0</code> 且 <code>invalid_at IS NULL</code>
        （仍有效）的条目。
      </li>
      <li>
        <strong>降级链</strong>：向量不可用（未配 embedding 或调用失败）→ FTS-only； FTS
        本身抛错且没有向量 → 告诉调用方回退到「全量 + 类型优先级」的注入方式。
        每一级降级只写日志，界面上不会报错。
      </li>
    </ul>

    <h2 id="injection">4. 会话注入：每轮开始注入，不是开场注入一次</h2>
    <p>每次开始新的一轮对话时（不是每个会话只做一次），运行时都会重新组装 memory block：</p>
    <ul>
      <li>
        <strong>feedback 全量</strong>：所有 feedback 类型的记忆都注入（按更新时间倒序），
        不依赖检索命中——行为守则不能靠运气。这个排序刻意不依赖 <code>hit_count</code>，
        以保证同一会话里重复渲染的字节稳定，不破坏提示词前缀缓存。
      </li>
      <li>
        <strong>其它类型按相关度取子集</strong>：以「Agent 名称 + Agent 描述 +
        工作区目录名」作为种子查询， 走上面的混合检索取相关条目；检索不可用或无结果时回退到全量 +
        类型优先级排序。
      </li>
      <li>
        <strong>token 预算</strong>：默认上限 4000 token（设置项 <code>memory.maxInjectTokens</code>
        ）， 超出时按 <code>feedback &gt; user &gt; project &gt; reference</code> 的优先级裁剪。
      </li>
      <li>
        <strong>结构</strong>：注入成 <code>&lt;user-memory&gt;</code>、
        <code>&lt;project-memory workspace="..."&gt;</code>、<code>&lt;agent-memory&gt;</code>{' '}
        三段， 末尾告诉模型「需要更多用 <code>search_memory</code>，需要正文用{' '}
        <code>recall_memory</code>」。 记忆文本里的尖括号会被替换，防止内容破坏这些结构标签。
      </li>
      <li>
        <strong>来源提示</strong>：同时注入一段 [Memory Provenance] 约束：记忆摘要可能是模型生成的，
        不得当成用户原话或最终决定；与用户当前明确说法冲突时以当前为准。
      </li>
    </ul>

    <h2 id="tools">5. Agent 可用的记忆工具（只读）</h2>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>参数</th>
          <th>返回</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>mcp__spark_memory__search_memory</code>
          </td>
          <td>
            <code>query</code>（必填，1–500 字符）、<code>type</code>（可选：<code>user</code> /{' '}
            <code>feedback</code> / <code>project</code> / <code>reference</code>）、
            <code>limit</code>（默认 8，最大 20）
          </td>
          <td>命中的记忆 id + 摘要列表；检索不可用时返回明确的「已降级」提示</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_memory__recall_memory</code>
          </td>
          <td>
            <code>id</code>（必填，取 search_memory 返回或注入摘要里方括号内的 id）
          </td>
          <td>
            该条记忆的完整 markdown 正文（含 Why / How to
            apply）；已失效的条目仍返回正文，但会前置「已于某时失效、已被某条取代」的警示
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      调用 <code>recall_memory</code> 会把该条记忆的 <code>hit_count</code> +1， 但不会改{' '}
      <code>updated_at</code>——同样是出于保护提示词缓存的考虑。
    </p>
    <p>这三条运行时路径都会挂上同一组工具，语义与检索后端完全一致：</p>
    <ul>
      <li>Claude SDK 路径：进程内 MCP server（直接访问本地数据库，没有子进程）。</li>
      <li>
        Codex CLI / Claude CLI 路径：<code>spark_memory</code> stdio 子进程，通过本地 Platform
        Bridge 的 HTTP RPC 回到主进程。
      </li>
      <li>Spark 引擎路径：由引擎运行时按内置 server 名单注入同名工具。</li>
    </ul>
    <p>
      <strong>重要边界</strong>：Agent 侧<strong>没有写入或删除记忆的工具</strong>。
      记忆写入只来自后台抽取，增删改只在「设置 → Agent → 记忆」面板里由人完成。 这样设计是为了防止
      Agent 在对话中把临时信息固化成长期事实。
    </p>

    <h2 id="consolidation">6. 整合 job：合并重复与升华规律</h2>
    <p>
      后台还会周期性跑一次「整合」：在记忆启用时，于每轮对话开始阶段异步触发， 对 user / project /
      agent 三层分别判断（fire-and-forget，失败只写日志）。
    </p>
    <ul>
      <li>
        <strong>触发条件</strong>：该层记忆条数达到 <code>memory.consolidationThreshold</code>（默认
        30）， 且距上次整合已超过 <code>memory.consolidationIntervalDays</code>（默认 7 天）；
        <code>memory.consolidationEnabled</code> 默认开启。上次整合时间按
        <code>lastConsolidationAt:&lt;scope&gt;:&lt;scopeRef&gt;</code> 记录，因此三层各自计时。
      </li>
      <li>
        <strong>MERGE</strong>：把多条语义重复的记忆合并成一条（保留其中一条，其余归并），减少冗余。
      </li>
      <li>
        <strong>ELEVATE</strong>
        ：把多条零散反馈升华成一条更通用的新记忆，正文末尾会附「升华来源」列表，
        指向原始条目，便于追溯。
      </li>
    </ul>
    <p>
      除了整合，抽取阶段本身还有演化判定（ADD / UPDATE / DELETE / NOOP），两者共同避免记忆无限膨胀。
      真机调试时可以把阈值调小（例如阈值 2、间隔 0.01 天）来快速观察整合效果。
    </p>

    <h2 id="evolution">7. 失效与实体图：旧记忆不删除，但会标失效</h2>
    <ul>
      <li>
        <strong>bi-temporal 字段</strong>：<code>memory_entry</code> 有 <code>valid_from</code> /
        <code>invalid_at</code> / <code>superseded_by</code>。事实失效时不删文件， 而是写入{' '}
        <code>invalid_at</code> 与被谁取代的 id。
      </li>
      <li>
        <strong>失效后仍可读</strong>：检索默认过滤掉失效条目（<code>invalid_at IS NULL</code>），
        但你用 <code>recall_memory</code> 显式读它时仍能拿到正文，并带失效警示，
        便于理解「当初为什么这么定」。
      </li>
      <li>
        <strong>实体关联图</strong>：<code>memory_entity</code>（规范化去重的实体）+
        <code>memory_entity_link</code>（记忆 ↔ 实体多对多）。实体名做小写与别名归一 （如{' '}
        <code>Arco Design</code> 与 <code>@arco-design/web-react</code> 都归到 <code>arco</code>），
        同一 scope 内按归一化名去重；检索命中记忆后可顺着共享实体做一跳扩展，
        把「讲同一套技术栈」的记忆一起带出来。
      </li>
    </ul>

    <h2 id="config">8. 配置：设置 → Agent → 记忆</h2>
    <p>
      入口只有一处：桌面端「设置」页左侧 Agent 分组下的「记忆」（面板标题为「长期记忆」）。 当前没有
      Web 管理端或独立记忆页——应用内虽有 <code>memory</code> 视图路由，但它同样渲染设置页的
      记忆分区，不是一个单独的界面。面板顶部有「新增」「配置」两个按钮，页面主体是记忆列表与筛选，
      所有开关都在「配置」抽屉里：
    </p>
    <table>
      <thead>
        <tr>
          <th>设置项（category = memory）</th>
          <th>含义</th>
          <th>默认 / 取值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>enabled</code>
          </td>
          <td>总开关：关闭后注入 / 写入 / 整合全停</td>
          <td>默认开</td>
        </tr>
        <tr>
          <td>
            <code>extractionProviderId</code> / <code>extractionModel</code>
          </td>
          <td>抽取用的 Provider 与模型；可清除，清除后回退到对话模型</td>
          <td>空（回退对话模型）</td>
        </tr>
        <tr>
          <td>
            <code>embeddingProviderId</code> / <code>embeddingModel</code>
          </td>
          <td>向量检索用的 Provider 与模型，仅支持 OpenAI 兼容（Anthropic 不提供 embedding）</td>
          <td>空（FTS-only）</td>
        </tr>
        <tr>
          <td>
            <code>consolidationEnabled</code>
          </td>
          <td>是否启用整合 job</td>
          <td>开</td>
        </tr>
        <tr>
          <td>
            <code>consolidationThreshold</code> / <code>consolidationIntervalDays</code>
          </td>
          <td>整合触发阈值（条）与间隔（天）</td>
          <td>30 / 7</td>
        </tr>
        <tr>
          <td>
            <code>maxInjectTokens</code>
          </td>
          <td>每轮注入的记忆 token 上限</td>
          <td>4000</td>
        </tr>
        <tr>
          <td>
            <code>timeDecayLambda</code>
          </td>
          <td>时间衰减系数，越大旧记忆沉降越快</td>
          <td>0.01</td>
        </tr>
        <tr>
          <td>
            <code>quota</code>
          </td>
          <td>
            按 scope 的条数配额覆盖（对象：如{' '}
            <code>&#123;"user": 100, "project": 200, "agent": 50&#125;</code>）
          </td>
          <td>100 / 200 / 50</td>
        </tr>
        <tr>
          <td>
            <code>vecDimension</code> / <code>ftsBackfillDone</code>
          </td>
          <td>内部状态：向量表维度、FTS 存量回填是否完成</td>
          <td>—（不要手改）</td>
        </tr>
      </tbody>
    </table>
    <ul>
      <li>
        <strong>「测试抽取配置」</strong>：按下会真的发起一次 LLM 调用，返回模型名与一段样例输出；
        失败时给出原因（例如 settings 未配且当前没有可回退的对话模型）。配错 key 时用它主动验证，
        不用等「记忆静默不生成」。
      </li>
      <li>
        <strong>「重建向量索引」</strong>：换了 embedding 模型或怀疑向量表异常时用，
        重建后会提示「后台正按新模型回填全部记忆，条目多时可能持续几分钟，期间向量检索会逐步恢复」。
      </li>
      <li>
        <strong>改完何时生效</strong>：抽屉底部的提示写明「配置改完下一个新会话生效」——
        注入是在新一轮开始时重算的。
      </li>
    </ul>
    <p>面板本身可以做的事：</p>
    <ul>
      <li>
        筛选：按 scope（User / Project / Agent）、按 type（全部 / User / Feedback / Project /
        Reference）、按项目、按 Agent、<code>仅有效</code> 或 <code>含失效</code>、按 name /
        description 搜索。
      </li>
      <li>批量操作：勾选后批量归档、批量删除。</li>
      <li>
        单条详情：编辑描述与正文（markdown）、保存、归档、删除；失效条目会显示失效时间与被谁取代。
      </li>
      <li>
        手动新增：指定 scope（Project / Agent 需要选具体 workspaceId / agentId）、type、
        <code>name</code>、描述、正文与实体（逗号分隔）。
      </li>
    </ul>

    <h2 id="storage">9. 存储与隐私</h2>
    <ul>
      <li>
        <strong>双层存储</strong>：markdown 文件是事实来源（可读、可直接编辑、项目级跟随代码目录），
        SQLite 存索引与元数据。相关表：<code>memory_entry</code>（条目）、<code>memory_fts</code>
        （全文）、
        <code>memory_vec</code>（向量）、<code>memory_entity</code> /{' '}
        <code>memory_entity_link</code>（实体图）。
      </li>
      <li>
        <strong>本地优先</strong>：没有云端同步，记忆不会离开本机。
      </li>
      <li>
        <strong>两道自动闸门保护隐私</strong>：敏感内容（密钥 / 令牌 / 私钥 /
        隐私信息）在写入前被拒； 瞬时状态（「今天」「这次」之类）不落库。
      </li>
      <li>
        <strong>不进 prompt 的东西</strong>：记忆正文不会整篇塞进 system prompt，只注入摘要行；
        模型需要细节时得显式 <code>recall_memory</code>，这一步在日志里可见（便于审计 Agent
        到底读了什么）。
      </li>
      <li>
        <strong>删干净</strong>：面板删除会同时删数据库行与 markdown 文件；归档则保留文件、
        让条目退出检索与注入。
      </li>
    </ul>

    <h2 id="troubleshoot">10. 常见坑与排查</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>排查方向</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>聊了半天一条记忆都没有</td>
          <td>
            先确认总开关；再看日志里是否出现 <code>memory extraction triggered</code> 与随后的{' '}
            <code>memory extraction LLM unavailable</code>
            （抽取模型不可用）。也可以点「测试抽取配置」直接验证连通性
          </td>
        </tr>
        <tr>
          <td>对话很短/只有工具调用，没有记忆</td>
          <td>抽取需要助手产生了非空文本才触发；纯执行型回合可能不产出候选</td>
        </tr>
        <tr>
          <td>候选没通过</td>
          <td>
            依次检查：是否被判定为瞬时数据、<code>confidence</code> 是否低于
            0.6、是否命中敏感词、该层配额是否已满
          </td>
        </tr>
        <tr>
          <td>项目记忆写不进去</td>
          <td>
            该会话没有绑定工作区。project scope 必须带 <code>workspaceId</code>
            ，未绑定时候选会被丢弃
          </td>
        </tr>
        <tr>
          <td>语义检索不生效，只有关键词能中</td>
          <td>
            没配 embedding（正常降级为 FTS-only）；或 sqlite-vec 加载失败（日志{' '}
            <code>sqlite-vec load failed, vector search disabled</code>）。换过 embedding
            模型后要点「重建向量索引」
          </td>
        </tr>
        <tr>
          <td>Agent 说「我不记得」</td>
          <td>
            本轮注入为空（三层都没条目，或 token 预算裁掉了）；可以让它调 <code>search_memory</code>{' '}
            主动检索确认，而不是直接下结论
          </td>
        </tr>
        <tr>
          <td>记了但下次换个说法就找不到</td>
          <td>
            FTS 是关键词匹配；要让「组件写法」召回「偏好函数式组件」，必须配 embedding 才有语义通道
          </td>
        </tr>
        <tr>
          <td>能不能让 Agent 自己「记住这个」</td>
          <td>
            Agent
            没有写记忆的工具。它能做的是把信息留在对话里，由后台抽取判断是否值得长期保存；要立刻固定，请到记忆面板手动「新增」
          </td>
        </tr>
      </tbody>
    </table>
  </>
)

const page: DocsPageContent = {
  slug: 'long-term-memory',
  toc: [
    { id: 'scopes', title: '1. 三层作用域：键名、scope_ref 与落盘位置', level: 2 },
    { id: 'write', title: '2. 写入：每轮结束的后台抽取与五道闸门', level: 2 },
    { id: 'retrieval', title: '3. 检索：FTS5 + 向量两路并行', level: 2 },
    { id: 'injection', title: '4. 会话注入：每轮开始注入', level: 2 },
    { id: 'tools', title: '5. Agent 可用的记忆工具（只读）', level: 2 },
    { id: 'consolidation', title: '6. 整合 job：合并重复与升华规律', level: 2 },
    { id: 'evolution', title: '7. 失效与实体图', level: 2 },
    { id: 'config', title: '8. 配置：设置 → Agent → 记忆', level: 2 },
    { id: 'storage', title: '9. 存储与隐私', level: 2 },
    { id: 'troubleshoot', title: '10. 常见坑与排查', level: 2 },
  ],
  faq: [
    {
      question: '记忆会不会被别的项目看到？',
      answer:
        '不会。project 记忆用 scope_ref = workspaceId 隔离，只在同一工作区可见，文件也存在该工作区的 .spark-agent/memory/ 下；user 记忆跨项目共享；agent 记忆按 agentId 隔离。切换工作区时项目记忆自动不可见。',
    },
    {
      question: '是谁决定「该不该记」？Agent 会看到记忆正文吗？',
      answer:
        '后台抽取决定，Agent 不参与：每轮结束后台异步用抽取模型判断候选，过五道闸门后落库。Agent 侧只有 search_memory（拿 id + 摘要）和 recall_memory（拿正文）两个只读工具，没有写入权限。system prompt 里默认只有摘要行。',
    },
    {
      question: '配错抽取模型会怎样？',
      answer:
        '这一轮不产出记忆，主对话完全不受影响（fire-and-forget，异常只写日志）。在「设置 → Agent → 记忆 → 配置」里点「测试抽取配置」会真实调用一次模型并返回结果或失败原因，不用等记忆静默不生成才发现。',
    },
    {
      question: '不配 embedding 模型能用吗？',
      answer:
        '能，会降级成 FTS-only：只有关键词命中，没有语义召回。配了 OpenAI 兼容的 embedding 后会自动建向量表并后台回填；换模型后需要点「重建向量索引」重新生成向量。',
    },
    {
      question: '记忆存在哪里？我能直接改吗？',
      answer:
        '正文是 markdown：user 在 ~/.spark-agent/memory/user/，project 在工作区 .spark-agent/memory/，agent 在 ~/.spark-agent/memory/agent/<agentId>/；索引与元数据在本地 SQLite（memory_entry / memory_fts / memory_vec / memory_entity）。可以手工编辑文件，但更推荐用面板编辑，避免文件与索引不一致。',
    },
    {
      question: '怎么让一条记忆失效？',
      answer:
        '演化机制会在新事实与旧记忆冲突时把旧条目标记失效（写 invalid_at 与 superseded_by），文件保留但退出检索与注入；不需要历史时可在面板里归档（退出检索、保留文件）或删除（文件和记录一起删）。',
    },
  ],
  quickReference: [
    {
      key: '作用域键名',
      value: 'user / project / agent（scope_ref 分别为 NULL / workspaceId / agentId）',
    },
    { key: '记忆类型', value: 'user / feedback / project / reference（与 scope 正交）' },
    {
      key: '落盘位置',
      value: '~/.spark-agent/memory/user|agent/<agentId>/ 与 <workspace>/.spark-agent/memory/',
    },
    { key: '抽取触发', value: '每轮 turn 结束后异步触发（宿主 + 团队成员各自触发）' },
    { key: '抽取模型', value: 'memory.extractionProviderId + extractionModel；空则回退对话模型' },
    { key: '置信度阈值', value: 'confidence ≥ 0.6' },
    { key: '配额默认', value: 'user 100 / project 200 / agent 50' },
    {
      key: '检索',
      value: 'FTS5 BM25 + sqlite-vec KNN → RRF(k=60) → exp 时间衰减(λ=0.01) × confidence',
    },
    { key: '注入预算', value: '默认 4000 token，优先级 feedback > user > project > reference' },
    { key: '整合默认', value: '开启；阈值 30 条、间隔 7 天（三层分别计时）' },
    { key: 'Agent 工具', value: 'mcp__spark_memory__search_memory / recall_memory（只读）' },
    { key: '配置入口', value: '设置 → Agent → 记忆（长期记忆面板 → 配置）' },
  ],
  howTo: {
    name: '开启并验证 Spark Work 长期记忆',
    description: '从打开开关到确认记忆真的写入并注入',
    totalTime: 'PT5M',
    steps: [
      '打开「设置」→ Agent 分组 → 「记忆」，确认「长期记忆」总开关是开的',
      '点「配置」，在「抽取模型」里选 Provider 与模型（留空则回退到对话模型）',
      '点「测试抽取配置」确认返回正常；想启用语义检索再配「向量模型」，必要时点「重建向量索引」',
      '在一个绑定了工作区的会话里聊一轮，明确说出你要它长期记住的偏好或项目决策',
      '回到记忆面板，按 scope / type 筛选，确认新增了条目（Project 层级需要该会话已绑定工作区）',
      '开一个新会话，直接问它「我之前说过的偏好是什么」，验证注入生效',
      '需要 Agent 主动深挖时，让它调用 search_memory / recall_memory 取更多细节',
    ],
  },
  aiSummary:
    'Spark Work 长期记忆实测说明：三层作用域 user（scope_ref=NULL，~/.spark-agent/memory/user）/ project（scope_ref=workspaceId，' +
    '<workspace>/.spark-agent/memory）/ agent（scope_ref=agentId，~/.spark-agent/memory/agent/<agentId>），记忆类型为 ' +
    'user/feedback/project/reference。写入是每轮 turn 结束后的后台异步抽取（fire-and-forget），用 memory.extractionProviderId + ' +
    'extractionModel 指定的模型（未配则回退对话模型；支持 Anthropic /v1/messages 与 OpenAI 兼容 /chat），过五道闸门：瞬时数据、' +
    '置信度 ≥0.6、去重合并（ADD/UPDATE/DELETE/NOOP 演化）、配额（user100/project200/agent50）、敏感内容；先写 markdown 再写 SQLite 并刷新 MEMORY.md。' +
    '检索是 FTS5 BM25（memory_fts，中文逐字分词）与 sqlite-vec KNN（memory_vec，维度记在 memory.vecDimension）两路并行，' +
    'RRF(k=60) 融合后乘 exp(-λ·天数)×confidence（λ 默认 0.01），向量不可用自动降级 FTS-only，FTS 异常回退全量注入。' +
    '每轮开始注入 memory block：feedback 全量 + 其它类型按种子查询取相关子集，token 上限 memory.maxInjectTokens 默认 4000，' +
    '优先级 feedback>user>project>reference，并注入 [Memory Provenance] 约束避免把记忆当用户原话。' +
    'Agent 侧只有 mcp__spark_memory__search_memory（query/type/limit）与 recall_memory（id）两个只读工具，写入只来自后台抽取与记忆面板；' +
    '整合 job 默认开启，阈值 30 条 / 间隔 7 天，做 MERGE 与 ELEVATE；失效用 bi-temporal 的 invalid_at / superseded_by 标记而不删文件。' +
    '配置与增删改在「设置 → Agent → 记忆」（长期记忆面板 → 配置）。',
  Body,
}

export default page
