# 发布与 GitHub Pages 运维

> 状态: 已落地 | 最后核对: 2026-09-22

SparkWork 目前有四条不同的交付链路。它们共享仓库和保护规则，但不共享部署目标或敏感凭据。

## 发布矩阵

| 链路 | 触发 | 目标 | 失败时先看 |
| --- | --- | --- | --- |
| CI | `master` push、PR、手动触发 | 类型、lint、文件大小、包级验证 | `.github/workflows/ci.yml` 的具体 job |
| 桌面端 | 版本/发布 workflow | GitHub Release 安装包 | `publish-desktop-release.yml`、Actions artifact |
| Spark CLI | CLI 相关发布 workflow | `spark-cli-releases` 分支制品、安装脚本、`latest.json` | `publish-spark-cli.yml`、远端 raw 回读 |
| 自有官网 | `apps/website/**` push 或手动 | Docker 镜像 + 自有服务器 | `publish-website.yml`、Docker/SSH secrets |
| GitHub Pages | `docs-site/**`、架构/运维 docs 或手动 | `alexanderizh.github.io/spark-agent` 工程手册 | `deploy-pages.yml`、`github-pages` environment |

## GitHub Pages 设计

Pages 只部署静态 `docs-site/`，不复用面向自有域名的 `apps/website`。这样有三个好处：

1. 项目页位于 `/spark-agent/` 时，所有页面使用相对链接，不需要修改官网的根路径路由。
2. 工程手册不需要下载 API、Docker、SSH 或平台发布 secrets。
3. Pages 的变更可以独立于桌面端和官网发布，回滚就是回滚一个文档提交。

### 发布步骤

1. PR 修改 `docs-site/` 或其源文档。
2. `deploy-pages.yml` 检查入口文件和占位符。
3. `actions/configure-pages` 建立 Pages 上下文。
4. `actions/upload-pages-artifact` 上传 `docs-site/`。
5. `actions/deploy-pages` 发布到 `github-pages` environment。
6. 在 Actions 摘要中打开 deployment URL，检查首页、架构页、运维页和 404 页。

### 页面内容合同

- 首页说明项目是什么、架构入口在哪里、如何贡献。
- 架构页只写当前代码已经存在的边界；未来计划必须明确标为计划。
- 运维页说明 Project、Wiki、PR、CI、发布和 Pages 的分工。
- 所有内部链接使用相对路径；外部 GitHub/官网链接使用完整 HTTPS URL。
- 不把 token、API key、服务器地址、私有下载地址或用户数据写入静态产物。

## 发布与回滚

Pages 发布失败时：

1. 先查看 build job 的 `Validate static site` 和 deployment job 的错误。
2. 如果是内容问题，修复后重新提交 PR 或手动重跑 workflow。
3. 如果是 Pages 环境问题，确认仓库 Pages source 为 GitHub Actions、`github-pages` environment 没有卡住的审批规则。
4. 如果刚发布的内容错误，优先回滚文档提交并重新部署；不要删除历史 workflow run 或覆盖主仓库文件。

桌面端和 CLI 的发布不因为 Pages 失败而自动回滚。反过来也一样：Pages 内容不应该引用一个尚未发布的桌面版本。

## 日常检查

每次文档/治理变更：

```bash
test -f docs-site/index.html
test -f docs-site/architecture.html
test -f docs-site/operations.html
test -f .github/workflows/deploy-pages.yml
```

每月检查：

- Pages URL 仍能访问，入口页面没有 404；
- Wiki 首页和 Pages 入口互相可达；
- README 的下载、架构、贡献链接没有漂移；
- Project 的状态/字段仍和治理文档一致；
- workflow 使用的 action major 版本仍受支持。

每季度检查：

- `docs/` 计划和设计文档的状态、核对日期与代码一致；
- 架构页中的包名、入口文件、发布矩阵与工作流实际内容一致；
- 对外许可证、SECURITY 联系方式和行为准则仍然符合维护者意图。

## 与官网的边界

`apps/website` 是自有官网的产品/用户站点，仍由 `publish-website.yml` 使用 Docker 和服务器 secrets 发布。GitHub Pages 是公开仓库的工程手册，两者不共享运行时 API 配置，也不承担相同的 SEO、下载和登录责任。
