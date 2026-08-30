# Optional Capability Selection Center Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-10

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新手引导完成后展示按固定顺序排列的依赖选择，并把所选能力接入统一后台下载与右上角进度中心。

**Architecture:** 扩展现有 `OptionalCapabilityManager` 的协议与能力定义；Office/深度继续使用包管理器，Codex、FFmpeg、Chromium、Voice 使用已有完整性服务适配器。Shell 只在 onboarding 视图之外挂载中心，renderer 继续消费一条能力快照/进度流。

**Tech Stack:** TypeScript strict、Electron IPC、React、Vitest、现有 artifact manifest 与完整性服务。

---

### Task 1: Lock the public capability contract

**Files:**
- Modify: `packages/protocol/src/optional-capabilities.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Modify: `packages/protocol/src/ipc/index.ts`
- Test: `packages/protocol/src/__tests__/schemas.test.ts`

- [ ] 写测试确认六个 ID 都能通过 IPC schema，未知 ID 仍被拒绝。
- [ ] 将协议 ID、显示状态和 stream 注释扩展到六项能力，保持原有请求/响应结构兼容。
- [ ] 运行协议 schema 聚焦测试，确认新增测试先失败后通过。

### Task 2: Add ordered definitions and local adapters

**Files:**
- Modify: `apps/desktop/src/main/services/optional-capabilities/definitions.ts`
- Create: `apps/desktop/src/main/services/optional-capabilities/externalCapabilityAdapters.ts`
- Test: `apps/desktop/src/main/services/optional-capabilities/OptionalCapabilityManager.test.ts`

- [ ] 先补测试锁定顺序、缺失检测、manifest artifact 选择和已有能力不变。
- [ ] 添加 Codex、FFmpeg、Chromium、Voice 的选择元数据和本地状态适配。
- [ ] 复用已有服务安装方法并把进度映射到 `OptionalCapabilityProgress`。

### Task 3: Gate the startup prompt after onboarding

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/design/optional-capabilities/OptionalCapabilityCenter.tsx`
- Test: `apps/desktop/src/renderer/design/optional-capabilities/OptionalCapabilityCenter.test.tsx`

- [ ] 写测试证明 onboarding 视图不渲染资源选择弹窗。
- [ ] 在 Shell 中以视图状态控制中心挂载，完成 onboarding 后重新执行能力检查。
- [ ] 保持默认不勾选、稍后/关闭提醒和异步安装行为。

### Task 4: Verify integrated progress and settings compatibility

**Files:**
- Modify: `apps/desktop/src/renderer/design/optional-capabilities/OptionalCapabilitiesSettingsCard.tsx`
- Modify: `apps/desktop/src/renderer/design/optional-capabilities/optional-capabilities.less`
- Test: `apps/desktop/src/renderer/design/optional-capabilities/OptionalCapabilitiesSettingsCard.test.tsx`

- [ ] 为外部能力增加正确的状态文案和不可取消安装状态测试。
- [ ] 确认右上角进度卡和完整性页共用相同快照，不破坏已有入口。
- [ ] 运行相关 renderer 测试和类型检查。

### Task 5: Documentation and final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-optional-capability-packages-design.md`
- Modify: `.spark-agent/task-state/optional-capability-selection.json`

- [ ] 更新旧设计文档的能力范围与状态核对日期，移除“仅 Office/深度”的过时描述。
- [ ] 运行聚焦测试、TypeScript 检查和必要的构建验证。
- [ ] 使用 `git diff`、调用点检索和测试结果核对本轮影响范围；若 `npx gitnexus analyze` 可用则更新索引，否则记录降级原因。
