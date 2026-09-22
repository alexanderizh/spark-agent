# 项目运维

> 状态: 已落地 | 最后核对: 2026-09-22

## GitHub Project

项目板 `SparkWork · Open Source Roadmap` 用于追踪可交付的 Issue/PR：

```text
Inbox → Planned → In Progress → In Review → Blocked → Done
```

常用字段：`Priority`、`Area`、`Target`、`Milestone`。项目板不替代设计文档；方案事实回到 `docs/`。

## GitHub Pages

工程手册由主仓库的 `docs-site/` 发布，workflow 是 `.github/workflows/deploy-pages.yml`。它与 `apps/website` 的自有域名发布独立：

- Pages：贡献者、维护者和仓库治理；无服务器 secrets。
- 官网：用户文档、下载、产品内容；Docker + 自有服务器。

入口：[GitHub Pages 工程手册](https://alexanderizh.github.io/spark-agent/)。

## 发布链路

- CI：类型、lint、文件大小和包级验证。
- 桌面端：GitHub Releases 安装包。
- CLI：`spark-cli-releases` 分支、tarball、安装器和 `latest.json`。
- 官网：Docker 镜像和自有服务器。
- Pages：`docs-site/` 静态 artifact。

完整运维约定见[发布与 GitHub Pages 运维](https://github.com/alexanderizh/spark-agent/blob/master/docs/operations/release-and-pages.md)。
