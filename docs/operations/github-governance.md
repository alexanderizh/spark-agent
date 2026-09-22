# GitHub 治理与项目板

> 状态: 已落地 | 最后核对: 2026-09-22

目标是让一个长期运行的公开源码仓库具备可发现、可分流、可审查、可交付的最小治理闭环。这里的“开源”沿用仓库当前语境，代码采用项目自定义的个人使用许可证，并不等同于 OSI 批准的标准开源许可证；贡献者在参与前应先阅读 `LICENSE`。

## 资源分工

| 资源 | 用途 | 事实源 |
| --- | --- | --- |
| Issues | 可复现的缺陷、明确的需求、维护任务 | Issue 模板 + 讨论记录 |
| Discussions | 方案讨论、使用求助、展示和路线方向 | GitHub Discussions |
| Project | 跨 Issue/PR 的交付状态和优先级 | [`SparkWork · Open Source Roadmap`](https://github.com/users/alexanderizh/projects/6) |
| Wiki | GitHub 内的快速上手、架构摘要和维护手册 | Wiki 仓库中的 Markdown |
| Pages | 可分享的工程手册、架构图和运维说明 | 主仓库 `docs-site/` |
| `docs/` | 代码旁边的详细设计、计划、评审和长期事实 | 主仓库提交历史 |

不要把 Issue 当聊天记录、把 Project 当需求文档，或把 Wiki 当唯一事实源。能影响代码行为的设计细节应回到主仓库 `docs/`，Wiki 和 Pages 只保留可导航的摘要与操作入口。

## 项目板设计

项目板名称：`SparkWork · Open Source Roadmap`

### 状态

当前看板使用以下单选状态，并保持顺序：

1. `Inbox`：刚进入、尚未完成 triage。
2. `Planned`：已确认范围和优先级，等待排期。
3. `In Progress`：已有明确实现者和当前分支。
4. `In Review`：已有 PR 或等待设计/验证意见。
5. `Blocked`：依赖外部资源、决定或复现信息。
6. `Done`：代码/文档已合并，并完成必要验证。

### 其他字段

| 字段 | 类型 | 选项/用途 |
| --- | --- | --- |
| Priority | 单选 | `P0` 紧急、`P1` 近期、`P2` 常规、`P3` 以后 |
| Area | 单选 | `Runtime`、`Desktop`、`Website`、`Docs`、`Operations`、`Release` |
| Target | 单选 | `Next`、`Later`、`Exploration` |
| Milestone | 日期 | 只在有真实交付窗口时填写，不用虚构日期 |

### 视图

- `Delivery Board`：按 `Status` 分组，主视图用于每周推进。
- `Roadmap Table`：按 `Area`、`Priority`、`Target` 筛选，适合发布前盘点。
- `Needs Triage`：过滤 `Status = Inbox`，每次维护只清理这一小队列。

看板入口：[SparkWork · Open Source Roadmap](https://github.com/users/alexanderizh/projects/6)。

项目板不预先塞入无法核实的任务。新 Issue 进入 `Inbox`，完成 triage 后才进入 `Planned`；PR 合并后自动或手动移到 `Done`。

## Issue 分流

### 缺陷

必须能回答：哪个版本、哪个平台、最短复现步骤、实际结果、期望结果、日志/截图在哪里。涉及凭据、个人文件或隐私内容时先脱敏。

### 功能建议

先描述问题和使用场景，再描述方案。大型功能要附范围、不做什么、验收条件和对现有数据/权限/发布链路的影响。

### 安全问题

不要公开创建带真实漏洞细节的 Issue，按 [SECURITY.md](../../SECURITY.md) 的私下联系方式发送。

### 文档问题

可以直接提交 PR；若涉及架构事实、行为边界或许可证，应同时更新相关 `docs/` 文件的状态/核对日期。

## 分支与 PR

推荐分支命名：

```text
feat/<area>-<short-name>
fix/<area>-<short-name>
docs/<area>-<short-name>
refactor/<area>-<short-name>
```

一个 PR 尽量只做一个可验收主题，并在正文写清：

- 背景与用户影响；
- 变更边界和未做事项；
- 迁移、凭据、权限、兼容性和发布影响；
- 执行过的命令及结果；
- UI 变更的截图或录屏；
- 对应 Issue、Project item 或设计文档。

主分支启用了 PR、代码所有者审查和会话解决要求。不要绕过保护规则直接推送；需要紧急修复时也要保留 PR、验证和后续复盘记录。

## 合并前最小质量门

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm check:file-size
```

按改动范围可以缩小验证，但不能省略与风险直接相关的检查。官网改动还应运行：

```bash
pnpm --dir apps/website typecheck
pnpm --dir apps/website build
pnpm --dir apps/website check:geo
```

Pages 工程手册改动至少确认 `docs-site/index.html`、`docs-site/architecture.html`、`docs-site/operations.html` 和 Pages workflow 仍然存在，并在 Actions 中检查 deployment URL。

## Wiki 与 Pages 的维护约定

- Wiki：适合“我现在应该点哪里/先读什么”的短路径；页面之间用相对 Wiki 链接，详细技术事实链接回主仓库。
- Pages：适合公开分享的结构化说明；源文件在 `docs-site/`，通过 `.github/workflows/deploy-pages.yml` 发布。
- 主仓库 docs：适合需要随代码审查、状态行和提交历史同步的文档；不把自动生成文件手工当源文件编辑。
- 每季度至少复核一次资源链接、架构摘要、项目字段、Pages deployment 和 Wiki 首页。
