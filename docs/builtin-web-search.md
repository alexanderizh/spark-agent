# 内置联网搜索（spark_search）

## 背景

SDK 自带的 `WebSearch` / `WebFetch` 是 Anthropic 第一方服务端工具，**一旦会话走第三方
OpenAI 兼容供应商就会被剥离失效**。为了让 Agent 在任意供应商下都能联网，应用内置了一个
独立的搜索 MCP server `spark_search`，它在本地子进程内自己发 HTTP，与模型供应商完全解耦，
并对**所有 session / 所有 Agent（含团队成员）默认挂载**，开箱即用、无需任何配置。

## 工具（命名空间 `mcp__spark_search__`）

| 工具 | 说明 | 参数 |
|------|------|------|
| `web_search` | 联网搜索，返回排序结果 `[{title, url, snippet}]` | `query`（必填）、`count`(1-20,默认 8)、`time_range`(`day`/`week`/`month`/`year`/`all`)、`site` |
| `fetch_url` | 抓取网页并返回清洗后的正文文本（替代失效的 WebFetch） | `url`（必填）、`max_chars`(默认 8000，最大 50000) |

## 搜索后端（多后端自动降级，国内优先）

**① 免密默认链**（零 key 零配置，国内裸网可用）：
`cn.bing.com` → `百度` → `DuckDuckGo`（最后一个为能访问国际网络的用户兜更广结果）。
任一引擎被限流/改版时自动降级到下一个。

**② 填 key 增强**（配置后自动优先，质量更高）：
`bocha`（博查，国产 RAG 搜索，推荐）/ `tavily` / `serper`（Google）。

## 可选配置：启用 keyed 搜索后端

写入 `app_settings` 的 `webSearch` 分类即可（可由用户在设置中填写，或 Agent 通过
`mcp__spark_platform__settings_set` 写入）：

| key | 取值 | 说明 |
|-----|------|------|
| `provider` | `auto`(默认) / `bocha` / `tavily` / `serper` / `bing` / `baidu` / `duckduckgo` | `auto`=有 key 走 keyed、否则走免密链 |
| `apiKey` | string | keyed provider 的 API key（仅 bocha/tavily/serper 需要） |
| `baseUrl` | string | 可选，keyed provider 的 base url 覆盖（如自建代理） |

> key 仅注入搜索子进程的环境变量（`SPARK_SEARCH_*`），不写入提示词、不外泄。

## 实现位置

- MCP server：[`packages/agent-runtime/src/tools/web-search-mcp-server.mjs`](../packages/agent-runtime/src/tools/web-search-mcp-server.mjs)
- 挂载接线：`SessionService.resolveWebSearchMcpServer()` 及各 turn 的 `mcpServers.spark_search`
  / `allowedTools` 合并（[`session.service.ts`](../packages/agent-runtime/src/services/session.service.ts)）
- 提示词注入：`WEB_SEARCH_SYSTEM_PROMPT`（同上文件）
- 伴随技能：[`apps/desktop/resources/skills/multi-search-engine/SKILL.md`](../apps/desktop/resources/skills/multi-search-engine/SKILL.md)
- 测试：[`web-search-mcp-server.test.ts`](../packages/agent-runtime/src/__tests__/tools/web-search-mcp-server.test.ts)
