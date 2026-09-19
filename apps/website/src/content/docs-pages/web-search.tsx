import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      SDK 自带的 <code>WebSearch</code> / <code>WebFetch</code> 是 Anthropic 第一方服务端工具，
      一旦会话走第三方 OpenAI 兼容供应商就会被剥离。Spark Work 因此内置了独立的{' '}
      <code>spark_search</code> MCP server：它在本地 Node 子进程里自己发
      HTTP，与模型供应商完全解耦， 对普通会话与团队成员默认挂载，零配置即可用。
    </p>

    <h2 id="tools">1. 工具与返回结构</h2>
    <p>
      命名空间是 <code>mcp__spark_search__</code>，只有两个工具（SDK
      允许清单里的名字就是下面这两个）：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>参数</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>web_search</code>
          </td>
          <td>
            <code>query</code>（必填）· <code>count</code>（1~20，默认 8）· <code>time_range</code>
            （<code>day</code> / <code>week</code> / <code>month</code> / <code>year</code> /{' '}
            <code>all</code>，默认 <code>all</code>）· <code>site</code>（限定域名）
          </td>
          <td>联网搜索，返回排序结果，命中解析后自动去重</td>
        </tr>
        <tr>
          <td>
            <code>fetch_url</code>
          </td>
          <td>
            <code>url</code>（必填，仅 http/https）· <code>max_chars</code>（默认 8000，最大 50000）
          </td>
          <td>抓取网页并清洗成可读正文，替代失效的 WebFetch</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>time_range</code> 只对 keyed 后端（bocha / tavily / serper）精确生效；免密 HTML
      引擎会忽略它。
      <code>site</code> 是拼进查询串的（<code>site:example.com</code> 之类写法同样可用）。
    </p>
    <p>
      <code>web_search</code> 的返回对象：
    </p>
    <pre>
      {`{
  provider: "bocha" | "tavily" | "serper" | "bing" | "duckduckgo" | "baidu",
  query: "...",
  results: [{ title, url, snippet, source?, date?, score? }],
  warnings?: ["tavily: HTTP 429 ...", ...],   // 降级过程说明
  answer?: "..."                              // tavily / serper 的摘要（如果渠道给了）
}`}
    </pre>
    <p>
      <code>fetch_url</code> 的返回对象：
    </p>
    <pre>
      {`{
  url: "<跟随重定向后的最终地址>",
  title?: "<HTML 的 <title>，非 HTML 时没有>",
  contentType: "text/html; charset=utf-8",
  truncated: true | false,
  chars: 12000,
  text: "<正文；被截断时末尾会附加 [truncated, N chars total]>"
}`}
    </pre>
    <p>
      内容类型处理：JSON 原样返回；HTML/XML（或内容看起来像 HTML）会剥标签、解 HTML
      实体、压缩空白后转成 文本；其它类型原样返回。正文超过 <code>max_chars</code>{' '}
      会截断，参数被夹在 500~50000 之间。
    </p>

    <h2 id="backends">2. 后端与降级链</h2>
    <p>
      <strong>免密默认链</strong>（零 key、零配置，顺序固定）：
    </p>
    <ol>
      <li>
        <code>bing</code> → https://www.bing.com/search
      </li>
      <li>
        <code>duckduckgo</code> → https://html.duckduckgo.com/html/
      </li>
      <li>
        <code>baidu</code> → https://www.baidu.com/s（末级回退）
      </li>
    </ol>
    <p>
      链式规则：某个引擎抛错或返回 0 条结果，就往下走，并把原因累积到 <code>warnings</code> 里返回。
      三个都失败才抛错，错误信息形如{' '}
      <code>
        All keyless engines failed. bing: GET https://www.bing.com/search timed out [timeout] | ...
      </code>
      。 请求会带桌面 Chrome 的 User-Agent 与 <code>Accept-Language: zh-CN,zh;q=0.9,en;q=0.8</code>
      。
    </p>
    <p>
      <strong>keyed 后端</strong>（配了 key 自动优先，质量更高）：
    </p>
    <table>
      <thead>
        <tr>
          <th>provider</th>
          <th>默认地址</th>
          <th>请求要点</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>bocha</code>（博查，<code>auto</code> 时的默认 keyed 选择）
          </td>
          <td>
            https://api.bochaai.com（<code>/v1/web-search</code>）
          </td>
          <td>
            POST，<code>Authorization: Bearer</code>；<code>time_range</code> 映射成
            freshness：oneDay / oneWeek / oneMonth / oneYear / noLimit
          </td>
        </tr>
        <tr>
          <td>
            <code>tavily</code>
          </td>
          <td>
            https://api.tavily.com（<code>/search</code>）
          </td>
          <td>
            POST，key 在 body 的 <code>api_key</code>；<code>search_depth: basic</code>、
            <code>include_answer: true</code>；day/week/month 会切 <code>topic: news</code> +{' '}
            <code>days</code>，<strong>year 不支持</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>serper</code>（Google）
          </td>
          <td>
            https://google.serper.dev（<code>/search</code>）
          </td>
          <td>
            POST，<code>X-API-KEY</code>；<code>time_range</code> 映射成 tbs：qdr:d / qdr:w / qdr:m
            / qdr:y
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      免密引擎也可被单独指定：<code>provider</code> 填 <code>bing</code> / <code>baidu</code> /{' '}
      <code>duckduckgo</code> 时只用那一个，不再链式降级。
    </p>
    <p>
      keyed 后端出错或 0 结果时不会直接失败，而是<strong>回落免密链</strong>，并在{' '}
      <code>warnings</code> 里保留原因，所以「配置了 key 但结果看起来是白牌的」通常意味着 keyed
      调用失败了。
    </p>

    <h2 id="config">3. 配置 keyed 后端</h2>
    <p>
      配置读的是 <code>app_settings</code> 表里分类为 <code>webSearch</code> 的三个键， 每次解析 MCP
      server 时实时读取：
    </p>
    <table>
      <thead>
        <tr>
          <th>键</th>
          <th>取值</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>provider</code>
          </td>
          <td>
            <code>auto</code>（默认）/ <code>bocha</code> / <code>tavily</code> /{' '}
            <code>serper</code> / <code>bing</code> / <code>baidu</code> / <code>duckduckgo</code>
          </td>
          <td>
            <code>auto</code> = 有 <code>apiKey</code> 就走 keyed（默认 bocha），否则走免密链
          </td>
        </tr>
        <tr>
          <td>
            <code>apiKey</code>
          </td>
          <td>string</td>
          <td>仅 bocha / tavily / serper 需要；留空则不会走 keyed</td>
        </tr>
        <tr>
          <td>
            <code>baseUrl</code>
          </td>
          <td>string</td>
          <td>可选，覆盖 keyed 后端的 base url（自建代理、镜像时用）</td>
        </tr>
      </tbody>
    </table>
    <p>
      当前版本<strong>没有</strong>对应的设置页面，最快的写法是让 Agent 调{' '}
      <code>mcp__spark_platform__settings_set</code>：
    </p>
    <pre>
      {`settings_set({ category: "webSearch", key: "provider", value: "bocha" })
settings_set({ category: "webSearch", key: "apiKey", value: "<你的 key>" })
settings_set({ category: "webSearch", key: "baseUrl", value: "https://api.bochaai.com" })   # 可选`}
    </pre>
    <p>读取入口在子进程侧，对应这三个环境变量（key 只存在于该子进程内存）：</p>
    <pre>
      {`SPARK_SEARCH_PROVIDER        auto | bocha | tavily | serper | bing | baidu | duckduckgo
SPARK_SEARCH_API_KEY         keyed 后端的 key
SPARK_SEARCH_BASE_URL        keyed 后端 base url 覆盖
SPARK_SEARCH_TIMEOUT_MS      单次请求超时，默认 15000（1000~60000）
SPARK_SEARCH_TOTAL_TIMEOUT_MS  单次搜索总时限，默认 20000（1000~90000）
SPARK_SEARCH_MAX_RETRIES     可重试错误的最大重试次数，默认 1（0~3）
SPARK_SEARCH_RETRY_BACKOFF_MS  退避基数，默认 250（1~2000）
SPARK_SEARCH_FETCH_MAX_CHARS fetch_url 默认正文上限，默认 8000（500~50000）
SPARK_SEARCH_BING_URL / SPARK_SEARCH_BAIDU_URL / SPARK_SEARCH_DUCKDUCKGO_URL  覆盖免密引擎地址`}
    </pre>
    <p>
      其中前三个变量由应用按 <code>webSearch</code> 设置实时注入；其余是部署级逃生口，只有你自己
      在启动环境里设置时才生效。
    </p>

    <h2 id="timeout">4. 超时、重试与限额</h2>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>默认</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>单次请求超时</td>
          <td>15 s</td>
          <td>可配 1~60 s</td>
        </tr>
        <tr>
          <td>单次搜索总时限</td>
          <td>20 s</td>
          <td>可配 1~90 s；HTML 正文读取也共享这个 deadline</td>
        </tr>
        <tr>
          <td>可重试错误重试次数</td>
          <td>1</td>
          <td>可配 0~3；重试退避基数 250 ms，可配 1~2000 ms</td>
        </tr>
        <tr>
          <td>结果条数</td>
          <td>8</td>
          <td>工具参数 1~20；keyed 渠道请求里也会夹到 20</td>
        </tr>
        <tr>
          <td>fetch_url 正文上限</td>
          <td>8000 字符</td>
          <td>参数 500~50000</td>
        </tr>
      </tbody>
    </table>
    <p>
      哪些错误算「可重试」：<code>timeout</code>、<code>network</code>、<code>rate_limited</code>
      （429）、
      <code>server_error</code>（5xx）。会读取响应里的 <code>Retry-After</code>（秒数或 HTTP
      日期）， 但退避上限 2000 ms。4xx（除 429）与 <code>invalid_response</code>（返回体不是
      JSON）不重试。
    </p>
    <p>错误信息里带方括号分类标签，便于快速判断：</p>
    <pre>
      {`GET https://www.bing.com/search timed out [timeout]
GET https://api.tavily.com/search failed: fetch failed [network]
POST https://google.serper.dev/search returned HTTP 429 [rate_limited]
POST https://api.bochaai.com/v1/web-search returned HTTP 500 [server_error]
POST https://api.bochaai.com/v1/web-search returned HTTP 401 [http_4xx]
Non-JSON response from https://... [invalid_response]
GET https://... exceeded request budget [budget_exhausted]`}
    </pre>

    <h2 id="usage">5. 在会话里怎么用</h2>
    <p>不需要任何配置，直接派活：</p>
    <pre>
      {`帮我搜一下最近一周关于 React Server Components 的最佳实践，整理成 5 条要点并给出链接。`}
    </pre>
    <p>
      Agent 会先 <code>web_search</code> 拿候选，再对关键页面 <code>fetch_url</code>{' '}
      读全文，最后给出带 出处的结论。注入的 system prompt（<code>WEB_SEARCH_SYSTEM_PROMPT</code>
      ）明确要求：时效性问题要 主动核实而不是靠模型记忆、优先一手来源、结论附近给
      URL、不要把「没搜到」当成「不存在」。
    </p>
    <p>挂载范围：</p>
    <ul>
      <li>宿主会话默认挂载，工具名会合并进 SDK 的允许清单。</li>
      <li>团队成员默认也挂载，与 Host 走同一套解析。</li>
      <li>
        例外：显式标记为只读的「原子」成员从空能力集开始，不会拿到 <code>spark_search</code>。
      </li>
      <li>
        脚本文件缺失时（<code>web-search-mcp-server.mjs</code> 找不到或缺少依赖）会记 warn 并跳过，
        此时工具列表里不会出现这两个工具。
      </li>
    </ul>
    <p>
      配套技能是内置技能 <code>builtin:multi-search-engine</code>，它的 <code>requiredTools</code>{' '}
      就是这两个工具，内容是多角度检索、交叉验证、给出处的操作规范。
    </p>

    <h2 id="implementation">6. 实现位置与排查</h2>
    <ul>
      <li>
        MCP server：<code>packages/agent-runtime/src/tools/web-search-mcp-server.mjs</code>
      </li>
      <li>
        HTTP/重试/deadline 工具：<code>packages/agent-runtime/src/tools/web-search-http.mjs</code>
      </li>
      <li>
        接线：<code>SessionService.resolveWebSearchMcpServer()</code>（读 <code>webSearch</code>{' '}
        设置并注入 环境变量）+ 各轮次的 <code>mcpServers.spark_search</code> /{' '}
        <code>allowedTools</code> 合并
      </li>
      <li>
        工具允许清单：<code>SEARCH_TOOL_NAMES</code>（<code>session-mcp-tooling-helpers.ts</code>）
      </li>
      <li>
        提示词：<code>WEB_SEARCH_SYSTEM_PROMPT</code>（同文件）
      </li>
      <li>
        伴随技能：<code>apps/desktop/resources/skills/multi-search-engine/</code>
      </li>
    </ul>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>排查</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Agent 说不能联网</td>
          <td>
            先确认工具列表里有没有 <code>mcp__spark_search__web_search</code>；没有就是 MCP
            脚本没解析成功（脚本缺失或依赖不全），看主进程日志里的 warn。
          </td>
        </tr>
        <tr>
          <td>结果都是白牌 / 质量低</td>
          <td>
            说明回落到了免密链。检查 <code>app_settings.webSearch</code> 的 <code>provider</code> 与{' '}
            <code>apiKey</code>；返回结果里的 <code>warnings</code> 会写明细。
          </td>
        </tr>
        <tr>
          <td>
            报 <code>All keyless engines failed</code>
          </td>
          <td>三个免密引擎都被限流或网络不通。换 keyed 后端，或确认所在网络能直连这几个域名。</td>
        </tr>
        <tr>
          <td>
            <code>time_range</code> 没生效
          </td>
          <td>
            免密引擎不支持时间过滤；只有 bocha / tavily / serper 会翻译该参数（tavily 不支持
            year）。
          </td>
        </tr>
        <tr>
          <td>抓到的正文太短</td>
          <td>
            页面可能是 JS 渲染的空壳。<code>fetch_url</code> 不做渲染，这种页面请改用浏览器自动化。
          </td>
        </tr>
      </tbody>
    </table>
  </>
)

export const webSearch: DocsPageContent = {
  slug: 'web-search',
  toc: [
    { id: 'tools', title: '1. 工具与返回结构', level: 2 },
    { id: 'backends', title: '2. 后端与降级链', level: 2 },
    { id: 'config', title: '3. 配置 keyed 后端', level: 2 },
    { id: 'timeout', title: '4. 超时、重试与限额', level: 2 },
    { id: 'usage', title: '5. 在会话里怎么用', level: 2 },
    { id: 'implementation', title: '6. 实现位置与排查', level: 2 },
  ],
  faq: [
    {
      question: '为什么走第三方供应商后 WebSearch 失效？',
      answer:
        'Anthropic 自带的 WebSearch / WebFetch 是服务端工具，第三方 OpenAI 兼容网关不会提供，所以会被剥离。spark_search 在本地子进程发 HTTP，与供应商解耦，任意供应商下都可用。',
    },
    {
      question: '需要 key 吗？',
      answer:
        '不需要。免密链 Bing → DuckDuckGo → 百度 零配置可用。填 key 只是获得更高质量的结果与精确的 time_range 过滤。',
    },
    {
      question: 'key 会泄露给模型吗？',
      answer: '不会。key 只作为环境变量注入搜索子进程内存，不写进提示词，也不随工具结果返回。',
    },
    {
      question: '团队成员也能用吗？',
      answer:
        '默认可以，成员与 Host 走同一套解析。但显式标记为只读的原子成员从空能力集开始，不会挂载 spark_search。',
    },
    {
      question: '在哪儿填 key？',
      answer:
        '配置存在 app_settings 的 webSearch 分类（provider / apiKey / baseUrl）。当前版本没有对应的设置页面，最方便的方式是让 Agent 调 mcp__spark_platform__settings_set 写入。',
    },
    {
      question: '搜索会返回几条？',
      answer: 'count 参数 1~20，默认 8；超过 20 会被夹到 20，keyed 渠道请求里也按 20 上限发送。',
    },
  ],
  quickReference: [
    {
      key: 'MCP 与工具',
      value: 'spark_search：mcp__spark_search__web_search / mcp__spark_search__fetch_url',
    },
    {
      key: '免密默认链',
      value:
        'www.bing.com → html.duckduckgo.com → www.baidu.com（失败/0 结果自动降级并写入 warnings）',
    },
    {
      key: 'keyed 后端',
      value:
        'bocha（api.bochaai.com/v1/web-search）· tavily（api.tavily.com/search）· serper（google.serper.dev/search）',
    },
    {
      key: '配置位置',
      value: 'app_settings.webSearch.{provider, apiKey, baseUrl}，provider 默认 auto',
    },
    {
      key: '超时',
      value: '单次 15s（1~60s）· 单次搜索总时限 20s（1~90s）· 可重试错误重试 1 次（0~3）',
    },
    { key: 'fetch_url 正文上限', value: '默认 8000 字符，范围 500~50000' },
    {
      key: '条件变量',
      value:
        'SPARK_SEARCH_PROVIDER / _API_KEY / _BASE_URL / _TIMEOUT_MS / _TOTAL_TIMEOUT_MS / _MAX_RETRIES / _RETRY_BACKOFF_MS / _FETCH_MAX_CHARS',
    },
  ],
  howTo: {
    name: '让 Agent 完成一次联网调研',
    description: '用 spark_search 调研一个最新技术话题',
    totalTime: 'PT2M',
    steps: [
      '打开新会话，无需任何额外配置',
      '给 Agent 发指令：「调研 XXX 最近一周的最佳实践，给出链接」',
      'Agent 调用 mcp__spark_search__web_search 拿候选（需要精确时间过滤时先配 keyed 后端）',
      '对关键页面调 mcp__spark_search__fetch_url 读全文',
      '汇总成带出处的要点或 Markdown 报告；结果里的 warnings 可判断是否发生了降级',
    ],
  },
  aiSummary:
    'Spark Work 内置联网搜索 spark_search：解决 Anthropic WebSearch/WebFetch 在第三方供应商下失效的问题，本地子进程发 HTTP、与供应商解耦，宿主会话与团队成员默认挂载（只读原子成员除外）。' +
    '工具：mcp__spark_search__web_search（query / count 1-20 默认 8 / time_range day-week-month-year-all / site，返回 provider、results、warnings、answer）与 mcp__spark_search__fetch_url（url 仅 http(s)、max_chars 默认 8000 最大 50000，返回最终 url、title、contentType、truncated、chars、text）。' +
    '后端：免密链 bing → duckduckgo → baidu（失败或 0 结果自动降级并写入 warnings）；keyed 后端 bocha / tavily / serper（默认地址 api.bochaai.com/v1/web-search、api.tavily.com/search、google.serper.dev/search），配置在 app_settings.webSearch.{provider,apiKey,baseUrl}，key 只注入 SPARK_SEARCH_* 环境变量。' +
    '超时默认单次 15s、总时限 20s、可重试错误重试 1 次（退避 250ms 起、上限 2s）；只重试 timeout/network/rate_limited/server_error。',
  Body,
}

export default webSearch
