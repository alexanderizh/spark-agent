# Session Message and Adapter Hardening Implementation Plan

> 状态: 实施中 | 最后核对: 2026-07-11
>
> **For agentic workers:** Execute inline in the current goal. Each task must follow impact analysis, TDD red/green, focused verification, five-axis self-review, `gitnexus detect-changes --scope staged`, and one standalone commit.

**Goal:** Eliminate session message loss/reordering and close the actionable Claude Agent SDK and Codex SDK/CLI adapter gaps verified in the 2026-07-11 audit.

**Architecture:** Keep the existing append-only `AgentEvent` contract, but make sequence allocation and terminal stream completion durable at the runtime boundary. Normalize provider-specific signals into explicit protocol events or existing tool/error/subagent events, and move new hot-path logic out of oversized `session.service.ts` and `ChatView.tsx` files into focused helpers.

**Tech Stack:** TypeScript, Electron, React, SQLite, Claude Agent SDK, Codex SDK/CLI, Vitest, GitNexus.

---

### Task 1: Audit Baseline And Scope

**Files:**
- Modify: `docs/reviews/2026-07-11-会话消息乱序消失与适配器审计.md`
- Create: `docs/superpowers/plans/2026-07-11-session-message-and-adapter-hardening.md`

- [x] Verify the audit against `master@a488fa37f`, installed SDK declarations, current tests, and GitNexus flows.
- [x] Record stale counts and already-landed behavior so implementation does not duplicate or regress existing work.
- [x] Review and commit the verified scope as a documentation-only baseline.

### Task 2: Durable Event Sequence And Persistence

**Files:**
- Create: `packages/agent-runtime/src/services/session-event-sequencer.ts`
- Modify: `packages/storage/src/repositories/event.repository.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Test: `packages/storage/src/repositories/event.repository.test.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-event-sequencer.test.ts`

- [x] Add `nextSeqBySession()` using `COALESCE(MAX(seq), -1) + 1` and prove it survives deleted rows and hidden delta rows.
- [x] Centralize sequence reservation so command, normal turn, restart recovery, imported session continuation, and out-of-band events seed from persisted max seq.
- [x] Persist before publishing; fail closed with structured logging so an event is never shown as durable when insertion failed.
- [x] Review affected execution flows and commit the storage/sequence fix.

### Task 3: Cancellation And Restart Stream Finalization

**Files:**
- Create: `packages/agent-runtime/src/sdk/stream-terminalizer.ts`
- Modify: `packages/agent-runtime/src/sdk/claude-sdk-executor.ts`
- Modify: `packages/agent-runtime/src/sdk/codex-sdk-executor.ts`
- Modify: `packages/agent-runtime/src/sdk/codex-cli-executor.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/storage/src/repositories/event.repository.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/stream-terminalizer.test.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/claude-sdk-executor.test.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/codex-sdk-executor.test.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/codex-cli-executor.test.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session.service.test.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-goal-budget.test.ts`
- Test: `packages/storage/src/repositories/repositories.test.ts`

- [x] Track streamed assistant/thinking segments and emit `mode=complete` snapshots before cancelled/error terminal status.
- [x] Classify Codex CLI SIGTERM as cancelled and preserve already streamed text.
- [x] On app restart, synthesize complete events for the latest interrupted turn before `APP_RESTARTED` and seed recovery seq from persisted max.
- [x] Skip post-turn workspace snapshots and memory/title follow-ups when the terminal status is cancelled.
- [x] Review and commit the cancellation/restart fix.

### Task 4: Ordered And Batched Live Event Consumption

**Files:**
- Create: `apps/desktop/src/renderer/design/services/live-agent-event-buffer.ts`
- Test: `apps/desktop/src/renderer/design/services/live-agent-event-buffer.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [ ] Replace array `.some()` dedupe with an ID set synchronized with history reset and pagination.
- [ ] Buffer one animation frame of live events, sort by seq/timestamp/id, and process the batch in deterministic order.
- [ ] Use one RAF flush for text/thinking deltas instead of synchronous full-list state updates per token.
- [ ] Review and commit the live ordering/render batching fix.

### Task 5: Long Conversation Rendering And Refresh Cost

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatMarkdown.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/VirtualMessageList.tsx`
- Test: `apps/desktop/src/renderer/design/views/chat/VirtualMessageList.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/design/SessionSidebarContext.tsx`
- Test: `apps/desktop/src/renderer/design/SessionSidebarContext.test.tsx`

- [ ] Memoize markdown parsing/rendering with stable props and preserve streaming updates.
- [ ] Virtualize variable-height message rows while retaining scroll anchoring, load-older behavior, and bottom-follow behavior.
- [ ] Coalesce concurrent `refreshData()` calls and remove the duplicate new-session refresh path.
- [ ] Review desktop performance and accessibility behavior, then commit.

### Task 6: Reasoning Effort And Dependency Parity

**Files:**
- Modify: `packages/agent-runtime/src/sdk/reasoning-effort.ts`
- Modify: `packages/agent-runtime/src/sdk/types.ts`
- Modify: `packages/agent-runtime/package.json`
- Modify: `apps/desktop/package.json`
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Modify: `apps/desktop/src/renderer/design/views/AgentsView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/reasoning-effort.test.ts`
- Test: `packages/protocol/src/__tests__/schemas.test.ts`

- [ ] Support Spark `minimal/low/medium/high/xhigh/max` without collapsing Claude `xhigh` into `max`.
- [ ] Map Claude to `low/medium/high/xhigh/max`, Codex to `minimal/low/medium/high/xhigh`, and keep explicit degradation for OpenAI Responses.
- [ ] Align workspace SDK dependency versions with the installed versions and expose all supported choices in session/settings UI.
- [ ] Review and commit reasoning/dependency parity.

### Task 7: Codex SDK And CLI Event Completeness

**Files:**
- Modify: `packages/protocol/src/events/index.ts`
- Modify: `packages/agent-runtime/src/sdk/codex-sdk-executor.ts`
- Modify: `packages/agent-runtime/src/sdk/codex-cli-executor.ts`
- Modify: `packages/agent-runtime/src/sdk/types.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/codex-sdk-executor.test.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/codex-cli-executor.test.ts`

- [ ] Carry `reasoning_output_tokens` through `usage_update`, ledger aggregation, and renderer usage models.
- [ ] Map CLI `cached_input_tokens`, `file_change`, `todo_list`, and item-level `error` with SDK-equivalent semantics.
- [ ] Write reasoning-summary visibility config even when no effort is selected.
- [ ] Wire explicit Codex network/web-search thread options from runtime config with conservative defaults.
- [ ] Review and commit Codex adapter parity.

### Task 8: Claude Errors And Runtime Signals

**Files:**
- Modify: `packages/protocol/src/events/index.ts`
- Modify: `packages/agent-runtime/src/sdk/types.ts`
- Modify: `packages/agent-runtime/src/sdk/event-mapper.ts`
- Modify: `apps/desktop/src/renderer/design/services/event-mapper.ts`
- Create: `apps/desktop/src/renderer/design/views/chat/StreamingErrorCard.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`
- Test: `packages/agent-runtime/src/sdk/event-mapper.test.ts`
- Test: `apps/desktop/src/renderer/tests/event-mapper.test.ts`
- Test: `apps/desktop/src/renderer/design/views/chat/StreamingErrorCard.test.tsx`

- [ ] Map all Claude assistant error codes and `error_max_structured_output_retries` with correct retryability.
- [ ] Map rate limits, permission denials, auth status, API retry, session state, refusal fallback/no-fallback, notification, mirror error, and worker shutdown without silent drops.
- [ ] Render actionable status/error details and make retryable failures invoke the existing resend flow.
- [ ] Review and commit Claude signal handling.

### Task 9: Claude Content Blocks, Tools, And Diff Quality

**Files:**
- Create: `packages/agent-runtime/src/sdk/content-block-mapper.ts`
- Create: `packages/agent-runtime/src/sdk/unified-diff.ts`
- Modify: `packages/agent-runtime/src/sdk/event-mapper.ts`
- Test: `packages/agent-runtime/src/sdk/content-block-mapper.test.ts`
- Test: `packages/agent-runtime/src/sdk/unified-diff.test.ts`

- [ ] Map server tool use, web search/fetch results, MCP tool use/results, redacted thinking, code execution, container upload, advisor, compaction, and fallback blocks to structured events or explicit audit notices.
- [ ] Extend SDK tool display-name normalization for resource, workflow, scheduling, worktree, artifact, project, and review tools.
- [ ] Replace all-delete/all-add diff generation with a real line diff and retain bounded output for large files.
- [ ] Review and commit content/tool mapping.

### Task 10: Claude Permission And Query Controls

**Files:**
- Modify: `packages/agent-runtime/src/sdk/types.ts`
- Modify: `packages/agent-runtime/src/sdk/claude-sdk-executor.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/agent-runtime/src/services/permission.service.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Test: `packages/agent-runtime/src/__tests__/sdk/claude-sdk-executor.test.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session.service.test.ts`
- Test: `packages/agent-runtime/src/services/permission.service.test.ts`

- [ ] Keep the active SDK Query reference and call native `setPermissionMode()` when available, with the existing live callback as fallback.
- [ ] Type and preserve `requestId`, `PermissionUpdate[]`, nullable permission results, and the UI's allow-session/project/global decision scope.
- [ ] Set `strictMcpConfig`, disable native workflows that conflict with Spark orchestration, and expose supported MCP/task controls through bounded executor methods.
- [ ] Review and commit permission/query control parity.

### Task 11: Subagent Progress And SDK Hook Bridge

**Files:**
- Modify: `packages/protocol/src/events/index.ts`
- Modify: `packages/agent-runtime/src/sdk/types.ts`
- Modify: `packages/agent-runtime/src/sdk/claude-sdk-executor.ts`
- Modify: `packages/agent-runtime/src/sdk/event-mapper.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/protocol/src/hooks.ts`
- Modify: `packages/agent-runtime/src/services/hook.service.ts`
- Create: `apps/desktop/src/renderer/design/views/chat/SubagentActivityCard.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`
- Test: `packages/agent-runtime/src/sdk/event-mapper.test.ts`
- Test: `packages/agent-runtime/src/services/hook.service.test.ts`
- Test: `apps/desktop/src/renderer/design/views/chat/SubagentActivityCard.test.tsx`

- [ ] Enable forwarded subagent text and map task started/updated/progress/notification/background membership into expandable progress/transcript data.
- [ ] Bridge selected SDK hooks (`PermissionRequest`, `PermissionDenied`, `SessionStart/End`, `SubagentStart/Stop`, compaction, elicitation, file/cwd changes) into Spark events/hooks without executing duplicate business logic.
- [ ] Trigger the existing `permission_request` application hook at the actual approval boundary.
- [ ] Review and commit subagent/hook integration.

### Task 12: Capability Documentation And Final Verification

**Files:**
- Modify: `docs/codex-dual-core-adapter.md`
- Modify: `docs/desktop-agent-development-guide.md`
- Modify: `docs/reviews/2026-07-11-会话消息乱序消失与适配器审计.md`
- Modify: this plan status/checklist

- [ ] Document implemented adapter capabilities and deliberate non-support for long-lived `streamInput`, structured output, and experimental betas where no product contract exists.
- [ ] Run targeted suites after every task, then full workspace typecheck, unit tests, lint, and desktop build.
- [ ] Run `gitnexus detect-changes --scope compare --base-ref master`, refresh the GitNexus index, mark documents `已落地`, review, and commit final documentation/metadata.
