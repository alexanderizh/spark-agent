# Media Artifact Download Retry Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-25

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while implementing each behavior below.

**Goal:** Prevent a transient failure while downloading an already-generated remote media artifact from failing the whole canvas task immediately.

**Architecture:** Keep provider submission and polling unchanged. Add bounded, idempotent retry handling inside the shared `MediaArtifactService` URL download boundary so APIMart and every other URL-based provider receive the same protection, while deterministic client errors still fail immediately.

**Tech Stack:** TypeScript, Node fetch/AbortController, Vitest.

---

### Task 1: Capture the regression in the shared artifact service

**Files:**
- Modify: `packages/agent-runtime/src/__tests__/services/media/media-artifact.service.test.ts`

- [x] Add a test whose injected fetch throws `TypeError('fetch failed')` once and returns an image response on the second attempt.
- [x] Assert the file is written and fetch is called twice.
- [x] Add a test proving HTTP 404 is not retried.
- [x] Run `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-artifact.service.test.ts` and confirm the transient-failure test fails before implementation.

### Task 2: Implement bounded artifact download retries

**Files:**
- Modify: `packages/agent-runtime/src/services/media/media-artifact.service.ts`

- [x] Add a small service option for testable retry delay while keeping production callers unchanged.
- [x] Perform at most three total download attempts (initial request plus two retries).
- [x] Retry only fetch/network failures and HTTP 408, 425, 429, and 5xx responses.
- [x] Preserve the configured total download deadline across all attempts and backoff waits.
- [x] Include the nested fetch cause and attempt count in the final safe error message without exposing signed query parameters.
- [x] Run the focused artifact service tests and confirm they pass.

### Task 3: Verify shared-channel compatibility

**Files:**
- Verify: `packages/agent-runtime/src/services/media/adapters/*.ts`
- Verify: `packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts`

- [x] Re-scan all `writeImage` and `downloadMediaAsset` callers to confirm no signature changes are required. (10 个 adapter 调用签名一致，均用无参 `new MediaArtifactService()`，零改动即获益)
- [x] Run the focused media artifact, APIMart adapter, and media HTTP tests. (media-artifact 3 + media-http 12 + media-adapters 92 + mcp-server 16 = 123 passed)
- [x] Run `pnpm --filter @spark/agent-runtime typecheck`. (clean)
- [x] Review `git diff` to ensure only the shared artifact behavior, its tests, and this plan changed for this task. (仅 4 个文件 + 本计划文档)

## 范围决策（2026-07-25）

用户选择**方案 1：只保留自动重试，不实现"手动二次下载"**。

理由：自动重试（最多 3 次、退避 1s/2s/4s、总时限内）已覆盖截图里 `fetch failed` 这类瞬时网络错误的绝大多数情况；"手动二次下载"是自动重试全部失败后的长尾兜底，但触发时通常是 URL 签名已过期或彻底断网，手动重试成功率未可知，而改动需跨 adapter / artifact service / TaskRuntime / DB / IPC protocol / canvas UI 六层并含 DB 迁移，成本与收益不匹配，故不做。

后续若自动重试用尽仍频繁失败，再单独立项评估手动二次下载。

