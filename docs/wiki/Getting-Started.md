# 快速开始

> 状态: 已落地 | 最后核对: 2026-09-22

## 环境

- Node.js `>=22.14.0 <23`
- pnpm `>=11.13.0 <12`
- Git

```bash
git clone https://github.com/alexanderizh/spark-agent.git
cd spark-agent
pnpm install
```

## 常用命令

```bash
pnpm dev                 # 启动 Electron 桌面端
pnpm typecheck           # 全仓类型检查
pnpm lint                # 全仓 lint
pnpm test                # 单元测试
pnpm build               # 桌面端构建
pnpm --dir apps/website dev
```

Windows 构建 better-sqlite3、keytar 等原生依赖时，准备 Visual Studio Build Tools。不要把个人 Provider key、登录凭据或生产数据库放进 Issue、PR 和仓库文件。

## 第一次贡献

1. 搜索现有 Issue 和 Discussions。
2. 在 [SparkWork Project](https://github.com/users/alexanderizh/projects/6) 的 `Inbox` 中确认任务是否已存在。
3. 创建 `feat/...`、`fix/...` 或 `docs/...` 分支。
4. 在本地完成与改动范围相关的验证。
5. 提交 PR，说明范围、风险、验证命令和截图。

更多规则见[贡献流程](https://github.com/alexanderizh/spark-agent/blob/master/CONTRIBUTING.md)。
