# 项目运维

> 状态: 已落地 | 最后核对: 2026-09-30

## GitHub Project

项目板 [`SparkWork · Open Source Roadmap`](https://github.com/users/alexanderizh/projects/6) 用于追踪可交付的 Issue/PR：

```text
Inbox → Planned → In Progress → In Review → Blocked → Done
```

常用字段：`Priority`、`Area`、`Target`、`Milestone`。其中 `Priority` 使用 P0–P3，`Target` 使用 `Next`、`Later`、`Exploration`，`Area` 使用 `Runtime`、`Desktop`、`Website`、`Docs`、`Operations`、`Release`。项目板不替代设计文档；方案事实回到 `docs/`。

## GitHub Pages

工程手册由主仓库的 `docs-site/` 发布，workflow 是 `.github/workflows/deploy-pages.yml`。它与自有域名官网的发布完全独立：

- Pages：贡献者、维护者和仓库治理；无服务器 secrets。
- 官网：用户文档、下载、产品内容；Docker + 自有服务器。

手册现有三个页面，入口：[GitHub Pages 工程手册](https://alexanderizh.github.io/spark-agent/)。

| 页面                | 内容                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `index.html`        | 总览：四条阅读入口与运行时边界图                                            |
| `architecture.html` | 运行架构：五个边界、启动顺序、任务流、仓库落点、安全不变量                  |
| `capabilities.html` | 能力架构：长期记忆 / 知识库 / 自动路由 / 性能保护四条能力线的图解与代码落点 |
| `operations.html`   | 项目运维：GitHub Project、Pages、发布矩阵与维护节奏                         |

新增手册页面时，除 HTML 与样式外还要同步更新 `.github/workflows/deploy-pages.yml` 的静态校验清单（该步骤会 `test -s` 逐个检查文件存在且非空）。

## 发布链路

- CI：类型、lint、文件大小和包级验证。
- 桌面端：GitHub Releases 安装包。
- CLI：`spark-cli-releases` 分支、tarball、安装器和 `latest.json`。
- 官网：Docker 镜像和自有服务器。
- Pages：`docs-site/` 静态 artifact。

完整运维约定见[发布与 GitHub Pages 运维](https://github.com/alexanderizh/spark-agent/blob/master/docs/operations/release-and-pages.md)。
