# SparkWork Wiki

> 状态: 已落地 | 最后核对: 2026-09-30

SparkWork（仓库名 `spark-agent`）是本地优先的桌面 AI Agent 工作台。Wiki 是 GitHub 内的快速入口：帮助第一次访问仓库的人找到架构、开发、项目板、发布和安全说明。

## 先看什么

- [[Getting-Started|快速开始]]：环境、常用命令和第一次贡献。
- [[Architecture|运行架构]]：Electron、Agent runtime、SQLite、spark-engine 的边界，以及长期记忆 / 知识库 / 自动路由三条能力线的落点。
- [[Contributing|贡献流程]]：Issue、分支、PR、验证和许可证。
- [[Operations|项目运维]]：Project、Pages、发布链路和维护节奏。

## 核心能力

- **长期记忆**：三层作用域 + 每轮结束后台抽取写入、每轮开始混合检索注入；支持记忆有效期、候选确认区与语义整合，旧记忆只标失效不删除。
- **知识库（Wiki）**：空间 / 页面 / 双链 / 版本四件套；零预注入加四层上下文预算，对话沉淀与技能提议都要人工确认才落库。
- **自动路由**：1 个分流器 + N 个按强度分档的执行模型，分流是轮次级替换，失败一律降级不抛错。
- **性能保护**：2 秒采样六类指标、四档分级（正常 / 警告 / 严重 / 危急）加双池并发闸门；只有危急档才会打扰你。

图解与代码落点见[工程手册 · 能力架构](https://alexanderizh.github.io/spark-agent/capabilities.html)；面向使用者的完整说明（含常见问题）见[官网文档中心](https://www.yiqibyte.com/docs)。

## 正式事实源

- [工程手册 · 运行架构](https://alexanderizh.github.io/spark-agent/architecture.html)
- [工程手册 · 能力架构](https://alexanderizh.github.io/spark-agent/capabilities.html)
- [工程手册 · 项目运维](https://alexanderizh.github.io/spark-agent/operations.html)
- [GitHub Pages 工程手册](https://alexanderizh.github.io/spark-agent/)
- [贡献指南](https://github.com/alexanderizh/spark-agent/blob/master/CONTRIBUTING.md)
- [安全策略](https://github.com/alexanderizh/spark-agent/blob/master/SECURITY.md)

Wiki 适合导航和短说明；会影响代码行为的细节以仓库源码、`docs/` 与提交历史为准。
