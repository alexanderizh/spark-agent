# Computer Use Local Trust Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-28
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make full Computer Use available in development and unsigned desktop packages, honor full-access as no-approval, and automatically fall back when the native path is unavailable.

**Architecture:** Add a strict local artifact manifest/verifier alongside the existing signed verifier. Build dedicated local-trust native binaries for dev/unsigned packages, select them in the backend factory, and propagate session permission mode into the Computer Use controller. Keep OS privacy prompts authoritative while removing blanket fallback prohibitions.

**Tech Stack:** Electron, TypeScript, Vitest, Swift Package Manager, Rust/Cargo, electron-builder.

---

### Task 1: Local artifact contract and backend selection

**Files:**

- Modify: `apps/desktop/src/main/services/computer-use/NativeHostArtifact.ts`
- Modify: `apps/desktop/src/main/services/computer-use/NativeHostBackendFactory.ts`
- Test: `apps/desktop/src/main/services/computer-use/NativeHostArtifact.test.ts`
- Test: `apps/desktop/src/main/services/computer-use/NativeHostBackendFactory.test.ts`

- [x] Add failing tests proving a `trustMode: local` manifest validates path, hash, platform and architecture without a publisher certificate.
- [x] Run the two Vitest files and confirm the new cases fail because local verification is absent.
- [x] Add `verifyLocalNativeHostArtifact()` and select it only for a declared local artifact.
- [x] Re-run the two Vitest files and confirm signed and local cases pass.

### Task 2: Local native Host build and authorization

**Files:**

- Modify: `apps/desktop/native/macos/SparkComputerHost/Sources/SparkComputerHost/ParentProcessAuthorizer.swift`
- Modify: `apps/desktop/native/windows/spark-computer-host/Cargo.toml`
- Modify: `apps/desktop/native/windows/spark-computer-host/src/windows_host/runtime_auth.rs`
- Modify: `apps/desktop/src/main/services/computer-use/NativeHostClient.ts`
- Test: `apps/desktop/src/main/services/computer-use/NativeHostClient.test.ts`

- [x] Add a failing NativeHostClient test requiring the local-trust environment marker only for local artifacts.
- [x] Add compile-time local/debug authorization branches on macOS and Windows; signed builds retain their current checks.
- [x] Pass the marker from NativeHostClient only when the verified artifact is local.
- [x] Run NativeHostClient, Swift and Cargo tests.

### Task 3: Dev and unsigned packaging

**Files:**

- Create: `apps/desktop/scripts/prepare-computer-use-host.js`
- Modify: `apps/desktop/scripts/package-native-host.js`
- Modify: `apps/desktop/scripts/package-windows-native-host.js`
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/src/main/services/__tests__/after-pack.test.ts`

- [x] Add failing script tests proving missing certificates produce local Host manifests instead of omitted artifacts.
- [x] Implement current-platform dev build and unsigned package build, including macOS ad-hoc signing.
- [x] Add the dev preparation script before `electron-vite dev`.
- [x] Run packaging helper tests and build the macOS development Host.

### Task 4: Full-access and fallback behavior

**Files:**

- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseMcpProvider.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseAgentController.ts`
- Modify: `packages/agent-runtime/src/computer-use/computer-use-system-prompt.ts`
- Test: corresponding `.test.ts` files.

- [x] Add failing tests that full-access includes `start_task`/`resume`, directly mints Broker tickets, and instructs automatic fallback.
- [x] Propagate effective turn `permissionMode` into the provider/controller/operator and implement full-access auto-ticketing.
- [x] Replace the blanket desktop-automation prohibition with ordered fallback and normal permission requests.
- [x] Run provider, controller, prompt and session runtime tests.

### Task 5: Documentation and verification

**Files:**

- Modify: `docs/COMPUTER_USE_PLAN.md`
- Modify: `docs/design/macos-native-host-design.md`
- Modify: `docs/design/computer-use-threat-model.md`

- [x] Update implementation status, trust modes, unsigned packaging, optional Kill Switch, snapshot preview and fallback semantics; refresh freshness dates.
- [x] Run desktop and agent-runtime typechecks and focused tests.
- [x] Run `git diff --check`, direct-call-site impact review and `git diff --stat`; GitNexus detect-changes may be skipped because its tools are not exposed.
- [x] Start development mode and verify `get_capabilities` reports the local Native Host rather than `native_host_incompatible`.
