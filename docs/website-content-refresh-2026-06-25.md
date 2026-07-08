# 官网内容与 README 刷新记录

> 状态: 已落地 | 最后核对: 2026-06-25

## 背景

本次刷新聚焦项目 README 与 `apps/website` 官网内容。目标是把 Spark Agent 的产品表达从泛内容创作站点调整为本地优先 AI Agent 工作台，突出代码开发、团队 Agent、运行时治理、无限画布和多媒体 Provider 生态。

## 更新范围

- README：更新官网链接、产品定位、官网结构说明、功能边界和官网开发入口。
- 官网导航：保留原有路由，增加图标化导航和更明确的 GitHub 入口。
- 功能矩阵：为每组能力补充图标 key、摘要、详情链接和代码证据说明。
- 下载页：细化 macOS、Windows、Linux 下载说明和安装提示，继续统一跳转 GitHub Releases。
- 画布页：细化节点类型、影视工具区和 3D 导演台说明，使用真实截图替换临时描述。
- 文档、开源、联系、路线图：补充仓库 docs 链接、安全报告入口、许可证入口和路线图原则。
- AI 可读入口：同步 `llms.txt` 与 `llms-full.txt`，便于搜索和 LLM 摘要理解当前能力边界。

## 验收口径

- 不改变官网路由结构，不破坏现有 SEO path。
- 不新增前端依赖，沿用项目已有 `lucide-react` 图标库。
- Provider 相关能力保持边界说明，避免承诺具体服务商能力一定可用。
- 通过 `pnpm --filter @spark/website build` 验证。
- 运行 GitNexus `detect-changes` 确认影响范围集中在 README、官网和本记录。
