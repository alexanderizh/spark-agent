# 会话内容区 HTML 渲染工具

> 状态: 实施中 | 最后核对: 2026-08-08

## 实现范围

`mcp__spark_ui__render_html` 用于流程图、架构图、可视化示例和 Markdown 不易表达的紧凑排版。工具结果按 `tool_call` 顺序归约为 `html_block`，历史会话不需要迁移。

HTML 卡片提供一个扁平的“打开方式”选择器：内容区、统一侧面板、Spark 独立窗口、外部浏览器。内容区与统一侧面板互斥；独立窗口复用单个 viewer，外部浏览器使用专用 HTML viewer 文件，不复用普通网页外开入口。

## 安全边界

- 内容始终进入 `sandbox="allow-scripts"` iframe，禁止 `allow-same-origin`、表单、弹窗、下载和顶层导航。
- iframe 文档注入 `default-src 'none'` CSP，只放行内联脚本/样式和 `data:`、`blob:` 媒体；网络连接、嵌套 iframe 和对象资源均禁用。
- MCP 限制 HTML 体积、标题和高度，IPC 再限制体积与标题，并拒绝明显危险标签；外链引用只返回 warning，最终由 CSP 兜底拦截。
- 独立窗口关闭 Node 集成、webview 和不安全内容，拒绝非 viewer 顶层导航。

## 主题与样式

宿主卡片复用现有 CSS variables，采用扁平边框与浅/深主题。`srcdoc` 随应用 resolved theme 重建，并注入 `data-spark-theme` 与 `color-scheme`；Agent 侧提示词要求同时提供浅色/深色样式。

## 验证记录

- MCP server 集成测试：工具列表、合法输入、warning、危险标签拒绝。
- renderer 测试：事件映射、统一侧面板 HTML tab、iframe sandbox/CSP、错误占位与四种打开方式。
- shared/protocol 测试：viewer 文档安全构造、HTML/主题/IPC 边界。
- 已运行 agent-runtime、desktop、protocol、shared TypeScript typecheck；GitNexus 索引已刷新。

待真实桌面环境补做一次手动网络面板冒烟，确认 srcdoc 在当前 Electron CSP 下无外部请求。
