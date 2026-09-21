# 贡献指南

感谢你关注 SparkWork。仓库当前是公开源码项目，使用项目自定义的个人使用许可证；提交代码前请先阅读 [LICENSE](LICENSE)。

## 开始之前

- 先搜索现有 Issue、Discussions 和 [项目板](https://github.com/alexanderizh/spark-agent/projects)。
- 架构、运行时和发布边界先读 [运行架构](docs/architecture/overview.md) 与 [工程运维](docs/operations/README.md)。
- 安全问题不要公开发 Issue，见 [SECURITY.md](SECURITY.md)。

## 本地环境

- Node.js `>=22.14.0 <23`
- pnpm `>=11.13.0 <12`
- Git

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

桌面端开发：

```bash
pnpm dev
```

官网开发：

```bash
pnpm --dir apps/website dev
```

## 提交变更

推荐分支名：`feat/...`、`fix/...`、`docs/...`、`refactor/...`。提交信息遵循 Conventional Commits，例如 `docs(architecture): add runtime overview`。

PR 应说明背景、范围、验证命令、兼容性/迁移影响和截图（如果有 UI 变更）。主分支启用 PR 与代码所有者审查，请不要直接推送或绕过保护规则。

如果修改 `docs/**/*.md` 中的计划、规格、PRD 或设计文档，请在标题下第一段保留：

```text
> 状态: [待开发 | 实施中 | 已落地 | 已废弃] | 最后核对: YYYY-MM-DD
```

如果修改数据库、权限、外部 Provider、工具、MCP、工作流或长任务运行时，请在 PR 中明确恢复、取消、失败和审计路径。

## 许可证与贡献

提交到仓库的内容默认受项目许可证约束。该许可证允许个人学习、研究、评估、实验和其他非商业私人使用；商业使用请先联系维护者。
