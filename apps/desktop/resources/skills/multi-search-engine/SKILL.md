---
name: multi-search-engine
description: "联网搜索与网页阅读技能：使用内置的 spark_search 工具检索网络信息、抓取网页正文，综合比对多来源结果给出有出处的答案。适用于任何模型供应商（含第三方 OpenAI 兼容 API）。"
version: 2.0.0
author: Spark AI
category: utility
tags: [search, web-search, fetch, research, 信息检索, 搜索, 联网, 调研]
---

# 联网搜索 (Web Search & Fetch)

你具备始终可用的联网搜索与网页阅读能力。当用户需要搜索、查询、调研、核实信息，或需要读取某个网页时，使用内置 `mcp__spark_search__*` 工具。

> **为什么用 spark_search 而不是 WebSearch/WebFetch**：SDK 自带的 `WebSearch` / `WebFetch` 是 Anthropic 第一方服务端工具，一旦本会话走第三方 OpenAI 兼容供应商就会失效。`spark_search` 在本地子进程内自己发请求，**与模型供应商解耦，任何供应商下都能用**，已对所有 Agent 默认挂载。

## 可用工具（命名空间 `mcp__spark_search__`）

- **`web_search`** — 联网搜索，返回排序后的结果 `[{title, url, snippet}]`
  - 参数：`query`（必填）、`count`（1-20，默认 8）、`time_range`（`day`/`week`/`month`/`year`/`all`）、`site`（限定域名，如 `github.com`）
- **`fetch_url`** — 抓取网页并返回清洗后的正文文本（替代失效的 WebFetch）
  - 参数：`url`（必填）、`max_chars`（默认 8000，最大 50000）

## 核心工作模式

1. **检索**：用 `web_search` 搜关键词；必要时换 2-3 个角度的关键词交叉验证。
2. **精读**：对重要结果用 `fetch_url` 拉取完整正文，不要只依赖 snippet。
3. **综合**：合并去重、对比多来源、标注一致与矛盾之处。
4. **给出处**：结论后附来源 URL，让用户可追溯。

## 搜索策略

- **一般查询**：直接 `web_search`。
- **时效性问题**（新闻、版本、价格）：加 `time_range`（仅 keyed 后端 bocha/tavily/serper 精确生效），并优先抓取最新页面核对日期。
- **站内检索**：用 `site` 参数或在 query 里写 `site:example.com`。
- **代码/技术**：关键词带上语言名、框架名、错误信息原文。
- **学术/专业**：关键词加 `paper` / `research` / `documentation` 等限定词。

## 搜索后端（自动选择，无需用户操心）

- **免密默认链**（零配置开箱即用，国内优先）：cn.bing.com → 百度 → DuckDuckGo。
- **填 key 增强**（自动优先）：在「设置 → webSearch」配置 `provider`（`bocha` 博查 / `tavily` / `serper`）+ `apiKey` 后，自动走更高质量的搜索 API。

## 注意事项

- 搜索结果可能过时，留意时间相关性，重要信息务必交叉验证、不依赖单一来源。
- 合理控制频率，尊重站点使用条款，不要批量爬取。
- 单个免密引擎偶发被限流/改版时会自动降级到下一个；若全部失败，向用户说明并建议配置 keyed 搜索后端。
