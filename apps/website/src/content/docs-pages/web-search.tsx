import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      SDK 自带的 <code>WebSearch</code> / <code>WebFetch</code> 是 Anthropic 第一方服务端工具 —
      一旦会话走第三方 OpenAI 兼容供应商就会被剥离失效。为了让 Agent 在任意供应商下都能联网，
      Spark Agent 内置了独立的 <code>spark_search</code> MCP server，它在本地子进程内自己发 HTTP，
      与模型供应商完全解耦，<strong>所有 session / 所有 Agent（含团队成员）默认挂载</strong>。
    </p>

    <h2 id="tools">1. 工具（命名空间 <code>mcp__spark_search__</code>）</h2>
    <table>
      <thead>
        <tr><th>工具</th><th>说明</th><th>参数</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><code>web_search</code></td>
          <td>联网搜索，返回排序结果 <code>[&#123;title, url, snippet&#125;]</code></td>
          <td><code>query</code>(必填) · <code>count</code>(1-20, 默认 8) · <code>time_range</code>(<code>day/week/month/year/all</code>) · <code>site</code></td>
        </tr>
        <tr>
          <td><code>fetch_url</code></td>
          <td>抓取网页并返回清洗后的正文（替代失效的 WebFetch）</td>
          <td><code>url</code>(必填) · <code>max_chars</code>(默认 8000, 最大 50000)</td>
        </tr>
      </tbody>
    </table>

    <h2 id="backends">2. 搜索后端（多后端自动降级，国内优先）</h2>
    <p><strong>① 免密默认链</strong>（零 key 零配置，国内裸网可用）：</p>
    <ol>
      <li><code>cn.bing.com</code></li>
      <li>百度</li>
      <li>DuckDuckGo</li>
    </ol>
    <p>任一引擎被限流 / 改版时自动降级到下一个。</p>
    <p><strong>② 填 key 增强</strong>（配置后自动优先，质量更高）：</p>
    <ol>
      <li><code>bocha</code>（博查，国产 RAG 搜索，推荐）</li>
      <li><code>tavily</code></li>
      <li><code>serper</code>（Google）</li>
    </ol>

    <h2 id="config">3. 可选配置：启用 keyed 搜索后端</h2>
    <p>
      写入 <code>app_settings</code> 的 <code>webSearch</code> 分类即可（用户在设置里填，或 Agent 通过
      <code>mcp__spark_platform__settings_set</code> 写入）：
    </p>
    <table>
      <thead>
        <tr><th>key</th><th>取值</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr><td><code>provider</code></td><td><code>auto</code>(默认) / <code>bocha</code> / <code>tavily</code> / <code>serper</code> / <code>bing</code> / <code>baidu</code> / <code>duckduckgo</code></td><td><code>auto</code> = 有 key 走 keyed、否则走免密链</td></tr>
        <tr><td><code>apiKey</code></td><td>string</td><td>keyed provider 的 API key（仅 bocha/tavily/serper 需要）</td></tr>
        <tr><td><code>baseUrl</code></td><td>string</td><td>可选 keyed provider 的 base url 覆盖（如自建代理）</td></tr>
      </tbody>
    </table>
    <p>
      Key 仅注入搜索子进程的环境变量（<code>SPARK_SEARCH_*</code>），不写入提示词、不外泄。
    </p>

    <h2 id="usage">4. 在会话里使用</h2>
    <p>直接给 Agent 发指令即可：</p>
    <pre>{`帮我搜一下最近一周关于 React Server Components 的最佳实践，整理成 5 条要点。`}</pre>
    <p>
      Agent 会自动调 <code>mcp__spark_search__web_search</code>，必要时再用
      <code>fetch_url</code> 抓详情页。
    </p>

    <h2 id="implementation">5. 实现位置</h2>
    <ul>
      <li>MCP server：<code>packages/agent-runtime/src/tools/web-search-mcp-server.mjs</code></li>
      <li>挂载接线：<code>SessionService.resolveWebSearchMcpServer()</code> 与各 turn 的
          <code>mcpServers.spark_search</code> / <code>allowedTools</code> 合并
          （<code>session.service.ts</code>）</li>
      <li>提示词注入：<code>WEB_SEARCH_SYSTEM_PROMPT</code>（同文件）</li>
      <li>伴随技能：<code>apps/desktop/resources/skills/multi-search-engine/SKILL.md</code></li>
      <li>测试：<code>web-search-mcp-server.test.ts</code></li>
    </ul>
  </>
)

export const webSearch: DocsPageContent = {
  slug: 'web-search',
  toc: [
    { id: 'tools', title: '1. 工具', level: 2 },
    { id: 'backends', title: '2. 搜索后端', level: 2 },
    { id: 'config', title: '3. 可选配置', level: 2 },
    { id: 'usage', title: '4. 在会话里使用', level: 2 },
    { id: 'implementation', title: '5. 实现位置', level: 2 },
  ],
  faq: [
    {
      question: '为什么走第三方供应商后 WebSearch 失效？',
      answer:
        'Anthropic 自带的 WebSearch / WebFetch 是服务端工具，第三方 OpenAI 兼容供应商的网关会把它剥离。',
    },
    {
      question: '需要 key 吗？',
      answer: '不需要。免密链默认可用；填 key 只是获得更高质量的结果。',
    },
    {
      question: 'key 会泄露给模型吗？',
      answer: '不会。Key 只注入到搜索子进程的环境变量，不进 prompt。',
    },
    {
      question: 'team mode 下 Member 也能用吗？',
      answer: '可以。spark_search 默认对所有 session / 所有 Agent（含团队 Member）挂载。',
    },
  ],
  quickReference: [
    { key: 'MCP 名称', value: 'spark_search' },
    { key: '工具', value: 'mcp__spark_search__web_search / fetch_url' },
    { key: '免密默认链', value: 'cn.bing.com → 百度 → DuckDuckGo' },
    { key: 'keyed 后端', value: 'bocha / tavily / serper' },
    { key: '默认 provider', value: 'auto（有 key 走 keyed，否则走免密链）' },
    { key: '凭据注入', value: '仅 SPARK_SEARCH_* 环境变量，不入 prompt' },
  ],
  howTo: {
    name: '让 Agent 完成一次联网调研',
    description: '用 spark_search 调研一个最新技术话题',
    totalTime: 'PT2M',
    steps: [
      '打开新会话，无需任何额外配置',
      '给 Agent 发指令：「调研 XXX 最近一周的最佳实践」',
      'Agent 调用 mcp__spark_search__web_search 拿候选',
      '需要时调 fetch_url 抓详情页',
      '汇总成结构化要点或 Markdown 报告',
    ],
  },
  aiSummary:
    'Spark Agent 内置联网搜索 spark_search：解决 Anthropic WebSearch/WebFetch 在第三方供应商下失效的问题，' +
    '本地子进程发 HTTP 与供应商解耦，所有 session / Agent（含 team member）默认挂载。' +
    '工具：mcp__spark_search__web_search（query, count 1-20, time_range day/week/month/year/all, site）、' +
    'mcp__spark_search__fetch_url（url, max_chars 默认 8000 最大 50000）。后端：免密默认链 cn.bing.com → 百度 → DuckDuckGo（自动降级）；' +
    'keyed 后端 bocha / tavily / serper。配置：app_settings.webSearch.{provider: auto/bocha/tavily/serper/bing/baidu/duckduckgo, apiKey, baseUrl}，' +
    'key 只注入 SPARK_SEARCH_* 环境变量。实现：packages/agent-runtime/src/tools/web-search-mcp-server.mjs，伴随 multi-search-engine Skill。',
  Body,
}

export default webSearch
