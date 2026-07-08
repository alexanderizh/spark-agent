# 自动路由实施计划

> 状态: 实施中 | 最后核对: 2026-07-06

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以“Claude Auto Router / Codex Auto Router 两个虚拟 Provider + 自动路由模型卡片”的形式，为 Chat、单 Agent 与团队成员自动选择合适模型。CLI 模型切换是独立能力，当前暂停；本地 Claude CLI / Codex CLI 继续跟随宿主机配置，不消费应用内 SDK 模型卡或自动路由卡。

**Architecture:** 自动路由在选择层是两个内置虚拟 Provider，路由卡保存在 `model_profiles` 中且 `provider_id` 指向 `claude-auto-router` 或 `codex-auto-router`。会话、Agent、团队成员仍保存 `providerProfileId + modelId + agentAdapter`；当 `providerProfileId` 是自动路由虚拟 Provider 时，运行时先根据 `modelId` 找到路由卡并解析为真实 provider/model，再进入 Claude SDK 或 Codex SDK executor。Claude 路由只输出 Anthropic 格式模型，Codex 路由只输出 OpenAI/openai-compatible 文本模型，并排除 image/voice/video 以及明确配置了媒体生成能力的模型。

**Tech Stack:** TypeScript, Electron IPC, SQLite/better-sqlite3, Vitest, Claude Agent SDK executor, Codex SDK executor.

---

## File Structure

- `packages/protocol/src/model-router.ts`
  - 定义路由模型卡片配置、候选槽位、复杂度、路由结果与校验 helper。
- `packages/protocol/src/auto-router-provider.ts`
  - 定义 `claude-auto-router` / `codex-auto-router` 两个虚拟 Provider。
- `packages/protocol/src/index.ts`
  - 导出路由模型协议。
- `packages/storage/src/repositories/model-profile.repository.ts`
  - 复用现有 `model_profiles` 表保存普通模型卡片与路由模型卡片。
- `packages/agent-runtime/src/services/model-router.service.ts`
  - 纯运行时路由服务：输入 model profile、providers、message/context，输出真实 provider/model/adapter 与 reason。
- `packages/agent-runtime/src/services/provider.service.ts`
  - `provider:list` 合成返回两个虚拟 Provider；它们不写入真实 provider 表。
- `packages/agent-runtime/src/services/session.service.ts`
  - 当 provider 是自动路由虚拟 Provider 时，在主会话与团队 member runtime 解析阶段调用路由服务。
- `apps/desktop/src/renderer/design/utils/agent-execution-config.ts`
  - SDK provider 允许保存路由模型卡 id；内置 CLI provider 保持跟随本地配置。
- `apps/desktop/src/main/ipc/index.ts`
  - 复用现有 model list/create/update/delete IPC 暴露路由模型卡片。
- `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
  - 在模型配置页增加“自动路由模型”卡片入口，路由卡固定创建在两个虚拟 Provider 下。
- `apps/desktop/src/renderer/design/views/ChatView.tsx`
  - 模型选择器展示路由卡片，并保持适配器维度区分 Claude / Codex。
- `apps/desktop/src/renderer/design/views/AgentsView.tsx`
  - Agent 配置允许选择对应 adapter 的路由模型。
- `docs/codex-dual-core-adapter.md`
  - 记录自动路由模型卡片机制与 CLI 切换暂停边界。

---

## Task 1: Protocol And Storage Contract

**Files:**
- Create: `packages/protocol/src/model-router.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/storage/src/repositories/model-profile.repository.ts`
- Test: `packages/protocol/src/__tests__/model-router.test.ts`
- Test: `packages/storage/src/repositories/model-profile.repository.test.ts`

- [x] **Step 1: Write protocol tests**

Create tests that prove:
- `isRoutingModelConfig` accepts `kind: 'router'` configs.
- `normalizeRoutingCandidates` rejects empty slots and supports ordered candidate pools per slot.
- `isProviderAllowedForRouterAdapter` accepts Anthropic for Claude.
- `isProviderAllowedForRouterAdapter` accepts OpenAI/openai-compatible for Codex.
- media-only and multimodal providers are excluded from Codex text routing.

- [x] **Step 2: Run protocol tests and verify RED**

Run: `pnpm --filter @spark/protocol test -- model-router`

Expected: fail because `model-router.ts` does not exist.

- [x] **Step 3: Implement `model-router.ts`**

Add minimal exported types and helper functions:
- `RoutingAdapter = 'claude' | 'codex'`
- `RoutingComplexity = 'simple' | 'default' | 'complex' | 'longContext'`
- `RoutingCandidateRef`
- `RoutingModelConfig`
- `isRoutingModelConfig`
- `normalizeRoutingCandidates`
- `isProviderAllowedForRouterAdapter`

- [x] **Step 4: Add storage tests**

Add repository tests for creating, listing, updating, disabling, and reading a `model_profiles.config_json` router config without changing schema.

- [x] **Step 5: Run storage tests and verify RED/GREEN**

Run: `pnpm --filter @spark/storage test -- model-profile.repository`

Expected first failure before repository helper additions, then pass after adding typed helpers if needed.

---

## Task 2: Runtime Router Service

**Files:**
- Create: `packages/agent-runtime/src/services/model-router.service.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Test: `packages/agent-runtime/src/services/model-router.service.test.ts`

- [x] **Step 1: Write service tests**

Cover:
- simple request routes to `simple`.
- code/edit/multi-step wording routes to `complex`.
- long estimated context routes to `longContext` when configured.
- missing slot falls back to `default`.
- Claude router never returns Codex/OpenAI providers.
- Codex router accepts `openai` and `openai-compatible` text providers.

- [x] **Step 2: Run service tests and verify RED**

Run: `pnpm --filter @spark/agent-runtime test -- model-router.service`

Expected: fail because service does not exist.

- [x] **Step 3: Implement router service**

Implement a deterministic `ModelRouterService.resolve` with no network calls and a clear reason object:
- `matchedComplexity`
- `fallbackUsed`
- `reasonCode`
- `providerProfileId`
- `modelId`
- `adapter`

- [x] **Step 4: Wire `SessionService.startTurn`**

Before stable SDK session id calculation, resolve route model ids into concrete provider/model. Preserve the original selected routing card id in diagnostic metadata or a `route_decision` event.

- [x] **Step 5: Wire team member dispatch**

In member runtime resolution, apply the same route service per member so Host and each member can independently route.

---

## Task 3: SDK Route Consumption

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Test: `packages/agent-runtime/src/services/session.service.test.ts`

- [x] **Step 1: Keep local CLI on host config**

Verify `local-cli` and `local-codex-cli` do not resolve route cards or app SDK model cards.

- [x] **Step 2: Resolve virtual-provider route cards before executor creation**

Verify `claude-auto-router` / `codex-auto-router` route cards resolve to concrete provider/model before Claude SDK or Codex SDK executor config is created.

- [x] **Step 3: Preserve OpenAI-compatible text routing**

Codex route candidates may come from OpenAI and openai-compatible text providers, excluding media generation providers.

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @spark/agent-runtime test -- model-router.service session.service`

---

## Task 4: IPC And UI Model Cards

**Files:**
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/AgentsView.tsx`
- Test: `packages/protocol/src/__tests__/schemas.test.ts`
- Test: `apps/desktop/src/main/ipc/__tests__/ipc-handlers.test.ts`

- [x] **Step 1: Add IPC schema tests**

Cover list/create/update/delete router model cards, invalid adapter, invalid empty candidate, and multimedia provider rejection.

- [x] **Step 2: Implement IPC handlers**

Use `ModelProfileRepository` and protocol validators. Do not expose API keys to renderer.

- [x] **Step 3: Add renderer selection support**

Show router cards as model options under the matching adapter:
- `Auto Claude` only for Claude adapter.
- `Auto Codex` only for Codex adapter.

- [x] **Step 4: Add provider settings card editor**

Add a compact editor for route slots: simple/default/complex/long context, each selecting a text model from compatible provider profiles.

---

## Task 5: Docs And Verification

**Files:**
- Modify: `docs/codex-dual-core-adapter.md`
- Modify: `todo/CLI模型切换与自动路由实施计划.md`

- [x] **Step 1: Update docs**

Document:
- local CLI provider still supports host local config.
- route model cards are virtual models.
- Claude and Codex route cards are separate due to API/interface differences.
- Codex supports OpenAI-compatible text aggregators, excluding multimedia models.

- [x] **Step 2: Run targeted tests**

Run:
- `pnpm --filter @spark/protocol test -- model-router schemas`
- `pnpm --filter @spark/storage test -- model-profile.repository`
- `pnpm --filter @spark/agent-runtime test -- model-router.service session.service`
- `pnpm --filter @spark/desktop test -- ipc-handlers`

- [x] **Step 3: Run GitNexus change detection**

Run: `node .gitnexus/run.cjs detect_changes -r /Users/zhangyang/spark_ai_project/Spark-Agent`

- [x] **Step 4: Refresh this plan status**

When code and docs land, update status to `已落地` and refresh `最后核对`.
