# 提交邮箱安全策略

> 状态: 已落地 | 最后核对: 2026-08-30

本仓库禁止在 Git 提交的作者邮箱或提交者邮箱中使用 `@byteplan.com` 公司邮箱。提交前应使用 GitHub 提供的 `noreply` 邮箱。

## 防护层

1. `pre-push` 钩子在推送任何分支或标签前检查完整可达历史；只要作者邮箱或提交者邮箱命中公司域名，就拒绝推送。
2. GitHub Actions 在 push 和 pull request 中复核新增提交，作为远程审计与兜底机制。
3. 默认分支保护继续限制未经检查的直接合入；本地仓库统一使用 GitHub `noreply` 邮箱。

GitHub 当前未向此个人公开仓库开放提交元数据 Ruleset，因此服务端无法在接收对象前按邮箱过滤；本仓库使用本地推送前拦截、远程检查和默认分支保护组合实现防护。

## 本地检查

提交前运行：

```bash
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

输出邮箱应为 GitHub `noreply` 地址。若不是，先修正当前仓库或全局 Git 配置，再创建提交。
