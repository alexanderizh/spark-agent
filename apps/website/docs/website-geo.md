# Spark Work 官网 GEO 与可抓取静态页面

> 状态: 已落地 | 最后核对: 2026-09-04

## 目标

官网、下载页和使用文档应同时满足传统搜索引擎与 AI 答案引擎的抓取需求：首次 HTML 响应包含完整正文、独立元数据与结构化数据，不依赖浏览器执行 JavaScript 才能理解页面。

官方站点地址统一为 `https://spark.yiqibyte.com`。canonical、Open Graph、JSON-LD、Sitemap、robots 和 LLM 抓取文件不得使用其他生产域名。

## 架构

官网继续使用 Vite + React，不引入额外 SSR 框架。`pnpm build` 会执行以下流程：

1. 拉取或复用桌面端发行快照。
2. 运行 TypeScript 类型检查。
3. 以 `src/entry-server.tsx` 构建临时 Vite SSR bundle。
4. 对公开静态路由逐一执行 React 服务端渲染，收集页面正文、SEO 元数据和 JSON-LD。
5. 从同一份路由清单与实际渲染结果生成 `sitemap.xml`、`robots.txt`、`llms.txt` 和 `llms-full.txt`。
6. 构建客户端 bundle，并把每个页面写入对应的 `<route>/index.html`。
7. 运行 `scripts/check-geo.mjs` 检查产物完整性。

构建结束会删除临时 `.prerender/` 目录；最终产物只保留在 `dist/`。

## 路由与索引规则

- 首页、功能、画布、架构、下载、文档首页、全部文档主题、路线图和联系页可索引。
- `/docs/search` 是交互式功能页，保留访问和站内链接，但设置为 `noindex, follow`，并从 Sitemap 排除。
- `/404` 设置为 `noindex, follow`，由 nginx 作为统一错误页返回。
- nginx 优先匹配预渲染的 `<route>/index.html`。未知路径返回真实 HTTP 404，不再回退首页形成 soft 404。
- `/docs` 必须先匹配 `docs/index.html`，不能被 `public/docs/` 图片目录截获。

## 页面语义与结构化数据

- 每个页面必须有唯一 `title`、description、canonical、robots 和一个可见 `h1`。
- 主页输出 WebSite、Organization、SoftwareApplication 和 FAQPage。
- 文档首页输出 CollectionPage、ItemList 和 BreadcrumbList。
- 文档主题输出 TechArticle、BreadcrumbList，并在正文数据存在时输出 FAQPage 和 HowTo。
- 下载页的版本、平台、下载地址和 Offer 来自构建期发行快照；快照为空时不声明不存在的下载地址或版本。
- 客户端 hydration 后，`Seo` 继续在站内导航时同步更新 head，预渲染与 SPA 交互共用同一份 SEO 定义。

## 内容维护

- 站点级 URL 与公共结构化数据维护在 `src/lib/links.ts` 和 `src/lib/seo.ts`。
- 可预渲染路由维护在 `src/entry-server.tsx` 的 `routeManifest`。
- 文档元信息维护在 `src/content/docs.ts`，正文维护在 `src/content/docs-pages/`，同步注册在 `src/content/docs-page-registry.ts`。
- 新增公开页面时，必须加入路由与 `routeManifest`；新增文档主题时，必须同时加入文档元信息和正文注册表。
- 禁止手工维护 Sitemap 与 LLM 抓取文件的页面正文；它们由构建脚本覆盖生成。

## 验证

日常验证命令：

```bash
pnpm --dir apps/website typecheck
pnpm --dir apps/website build
pnpm --dir apps/website check:geo
```

`check:geo` 会检查 Sitemap 域名与去重、可索引路由、逐页 canonical/title/H1/robots/正文/JSON-LD，以及 `llms.txt`、`llms-full.txt` 和 robots 的一致性。发布环境还应 smoke test `/docs` 为 200、未知地址为 404。

浏览器验收还需覆盖带查询参数的 `/docs/search?q=Provider`：静态 HTML 的首帧不读取 query，客户端挂载后再同步 URL，避免 hydration mismatch。可索引页、搜索页和 404 均应在 hydration 后保持正确的 title、H1、canonical 与 robots。

## 已知权衡

为了保证所有文档主题能够直接预渲染并在客户端 hydration 时保持一致，文档正文进入主客户端 bundle。当前构建会提示单 chunk 大于 Vite 默认 500 KB 阈值，但 gzip 后约 229 KB；这是当前可抓取性优先的明确权衡。后续若继续增长，应采用“每个路由独立客户端入口或按路由 hydration bundle”的方式拆分，不能退回空 SPA 壳。
