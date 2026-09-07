# 版本更新说明自动化 — 实施状态

- 状态：已完成（待官网版本中心联调）
- 分支：`fizzlx_20260907_release_notes`
- 隔离工作区：`.claude/worktrees/fizzlx_20260907_release_notes`
- 最后更新：2026-09-07

## 已完成

- 确认 `UpdateService` 已从 GitHub Release/官网版本中心读取 `releaseNotes`，但发布链未写入、设置页未展示。
- 新增 `CHANGELOG.md` 精确版本条目解析器与 Node 单测。
- GitHub Release 创建/重跑时写入同一份更新说明；tag 创建前校验说明存在。
- 官网注册请求增加 `releaseNotes`，并有 payload 单测。
- 设置页新增独立更新内容卡片和组件测试。

## 验证

- 解析器、发布工作流契约与官网注册 payload：通过（6 tests）。
- 更新内容组件：通过（3 tests）。
- `pnpm --filter @spark/desktop typecheck`：通过；本机 Node 为 24.14.1，仓库声明范围为 >=22.14 <23，仅有 engine warning。
- 定向 ESLint：无 error；`SettingsView.tsx` 仍有 3 个既有未使用声明 warning，与本次改动无关。
- 曾误触发全量 desktop 单测：4,846 通过、98 个既有跨平台/权限依赖失败；本次新增组件已用直接 Vitest 文件路径独立通过。

## 后续联调

- 需在 edu-server 确认 `/api/v1/ci/desktop/releases/register` 已接收、持久化并通过 `/api/v1/desktop/releases/latest` 返回 `releaseNotes`；本仓库未包含该服务端源码，无法在本地验证。
