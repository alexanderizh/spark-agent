# Custom Media Model Manifests Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-defined media model manifests usable by both canvas and `spark_media` without changing existing built-in model routing.

**Architecture:** Store an optional complete manifest on each provider media-model reference. Resolve inline manifests before catalog and legacy synthesized fallbacks, validate them at the protocol boundary, and use one redaction utility for runtime logs and request summaries.

**Tech Stack:** TypeScript, Zod, Vitest, Electron IPC, React, SQLite JSON provider config

---

### Task 1: Inline Manifest Protocol

**Files:**

- Modify: `packages/protocol/src/media-model-manifest.ts`
- Modify: `packages/protocol/src/__tests__/schemas.test.ts`

- [x] Add failing schema tests for a valid inline manifest and mismatched IDs.
- [x] Extend `ProviderMediaModelRef` with optional `manifest` and add semantic refinement.
- [x] Run protocol tests and typecheck.

### Task 2: Runtime Resolution

**Files:**

- Modify: `packages/agent-runtime/src/services/media/media-model-resolver.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/media/media-model-resolver.test.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`

- [x] Add failing tests proving inline Manifest wins over catalog and synthesis.
- [x] Add a single resolver helper implementing inline, catalog, fallback priority.
- [x] Reuse the resolver in canvas discovery, describe, runtime provider construction, and skill runtime context.
- [x] Run focused agent-runtime and desktop tests.

### Task 3: Manifest Semantic Validation

**Files:**

- Create: `packages/protocol/src/media-model-manifest-validation.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/__tests__/media-model-manifest-validation.test.ts`

- [x] Add failing tests for async/polling mismatch, unknown template variables, and invalid defaults.
- [x] Implement structured validation issues with paths and actionable messages.
- [x] Integrate validation into custom provider reference parsing.
- [x] Run protocol tests and typecheck.

### Task 4: Safe Media Diagnostics

**Files:**

- Modify: `packages/agent-runtime/src/services/media/media-debug-log.ts`
- Modify: `packages/agent-runtime/src/services/media/media-router.service.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts`

- [x] Add failing tests for data URL, bare base64, Authorization, API key, and long body redaction.
- [x] Replace prefix-only truncation with metadata summaries and secret masking.
- [x] Ensure captured request calls use the same sanitizer.
- [x] Run focused adapter tests.

### Task 5: Provider Basic Wizard

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.less`
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.test.tsx`

- [x] Add focused tests for sync JSON and async polling Manifest creation plus the Provider editor flow.
- [x] Generate a complete basic Manifest when a custom image or video model is added.
- [x] Add an advanced JSON editor backed by the same validation.
- [x] Show path-level validation before saving the custom protocol.
- [x] Run renderer tests and desktop typecheck.

### Task 6: Verification

**Files:**

- Modify: `docs/multimedia-model-platform-adapters-design.md`

- [x] Run protocol, agent-runtime, and desktop unit tests.
- [x] Run workspace typecheck and lint for touched packages.
- [x] Run `npx gitnexus detect-changes` and review affected flows.
- [x] Update the platform adapter design with landed behavior and remaining protocol limits.
