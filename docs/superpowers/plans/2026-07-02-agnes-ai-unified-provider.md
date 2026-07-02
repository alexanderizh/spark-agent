# Agnes AI Unified Provider Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-02
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Agnes AI as a first-class provider template so one configured provider key can expose Agnes text models to skills and Agnes image/video models to both skills and canvas.

**Architecture:** Keep Agnes text on the existing OpenAI-compatible chat path, add a dedicated Agnes media adapter for image/video runtime behavior, and use built-in media manifests for schema discovery and canvas model selection. Extend provider editing and session media injection just enough for a `multimodal` Agnes profile to carry media capabilities without breaking legacy image-only routing.

**Tech Stack:** Electron desktop app, `@spark/protocol`, `@spark/agent-runtime`, React provider editor, Vitest.

---

### Task 1: Agnes protocol surface

**Files:**
- Modify: `packages/protocol/src/media-config.ts`
- Modify: `packages/protocol/src/media-model-manifest.ts`
- Modify: `packages/protocol/src/provider-presets.ts`
- Test: `packages/protocol/src/__tests__/provider-presets.test.ts`

- [x] Add `agnes` to the media provider kind registry and keep schema helpers in sync.
- [x] Seed built-in Agnes manifests for image (`agnes-image-2.0-flash`, `agnes-image-2.1-flash`) and video (`agnes-video-v2.0`) with parameter schemas used by canvas and `spark_media`.
- [x] Add an Agnes provider preset that uses the Agnes chat endpoint plus Agnes media manifests on one multimodal provider profile.
- [x] Add protocol-level tests for the new preset and manifest references.

### Task 2: Agnes media runtime

**Files:**
- Create: `packages/agent-runtime/src/services/media/adapters/agnes-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/media-router.service.ts`
- Test: `packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts`

- [x] Implement an Agnes media adapter for:
  text-to-image, image edit/compose via `POST /v1/images/generations`;
  text-to-video, image-to-video, reference-video flows via `POST /v1/videos`;
  async polling through preferred `GET /agnesapi?video_id=...` plus fallback `GET /v1/videos/<TASK_ID>`.
- [x] Register the adapter in `MediaRouterService` without changing existing adapter precedence for other providers.
- [x] Add focused tests for Agnes image and video request/response handling.

### Task 3: Unified provider profile flow

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Test: `apps/desktop/src/renderer/design/views/ProvidersView.test.tsx`
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`

- [x] Allow `multimodal` provider profiles to retain and edit media configuration in the provider editor.
- [x] Ensure the Agnes preset appears as a single provider template with text + media configuration prefilled.
- [x] Extend session media injection so non-image profiles with explicit image/video media capabilities can receive `spark_media`, while legacy image-only `spark_image` behavior stays intact.
- [x] Add regression tests covering Agnes preset save payload and session tool injection.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/multimedia-model-providers.md`
- Modify: `docs/image-generation-providers.md`

- [x] Document Agnes as a supported unified provider and explain the single-profile setup path.
- [x] Run targeted Vitest suites for protocol, provider UI, media adapter, and session runtime config.
- [x] Run `node .gitnexus/run.cjs detect_changes` before wrapping up and summarize the affected scope.
