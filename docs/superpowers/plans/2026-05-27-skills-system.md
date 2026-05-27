# Skills System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build layered skills and system-prompt configuration from UI to agent runtime.

**Architecture:** Keep the existing `skills.enabled` column as the system-level visibility gate, add persisted project/session selections and prompt snippets through typed IPC backed by SQLite settings, and compose effective runtime context inside `SessionService.startTurn`. Local Claude/Codex skills are detected from known skill roots and imported as local installed skills without copying user files.

**Tech Stack:** TypeScript, React, Electron IPC, better-sqlite3 repositories, Vitest, GitNexus.

---

### Task 1: Runtime Composition Tests

**Files:**
- Create: `packages/agent-runtime/src/services/runtime-composition.service.ts`
- Create: `packages/agent-runtime/src/services/runtime-composition.service.test.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/session.service.test.ts`

- [x] Add failing tests for system/project/session skill merging, disabled system gate behavior, and prompt composition order.
- [x] Add a failing `SessionService.sendTurn` test that expects composed `systemPrompt` and available skill instructions in `AgentConfig`.
- [x] Run focused tests and confirm they fail before implementation.

### Task 2: Backend Services and IPC

**Files:**
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Modify: `packages/storage/src/repositories/skill.repository.ts`
- Modify: `packages/agent-runtime/src/services/skill.service.ts`
- Modify: `packages/agent-runtime/src/services/skill-registry/index.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Create: `packages/agent-runtime/src/services/local-skill-importer.ts`

- [x] Add protocol types for skill config, local detection/import, prompt config, and effective runtime preview.
- [x] Add repository/service methods for safe upsert of local skills and optional extended metadata.
- [x] Implement local skill discovery for `.claude/skills`, `.codex/skills`, and `.agents/skills` folders.
- [x] Register typed IPC handlers for layered skill and prompt configuration.
- [x] Run focused backend tests and confirm green.

### Task 3: Runtime Integration

**Files:**
- Modify: `packages/agent-runtime/src/skills/builtin/index.ts`
- Add: `packages/agent-runtime/src/skills/builtin/superpowers.ts`
- Modify: `packages/agent-runtime/src/skills/skill-loader.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/agent-runtime/src/__tests__/skills/skill-loader.test.ts`

- [x] Add built-in `builtin:superpowers` skill and update built-in tests from 5 to 6.
- [x] Build available skill instructions from effective system/project/session selection.
- [x] Compose system, project, and session prompt snippets into `AgentConfig.systemPrompt`.
- [x] Preserve explicit `skillId` execution behavior for backward compatibility.

### Task 4: Frontend

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/SkillStoreView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/SkillsView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/SettingsView.tsx`
- Modify: `apps/desktop/src/renderer/design/utils/skills-data.ts`
- Modify: `apps/desktop/src/renderer/design/styles/views.css`

- [x] Split skill management into installed and market panes with system visibility toggles.
- [x] Add local Claude/Codex detection and import controls.
- [x] Add project/session skill multi-select and prompt editor in the chat inspector.
- [x] Add system prompt editor and system-level built-in skill controls in settings/skills UI.

### Task 5: Docs, Verification, Commit

**Files:**
- Modify: `docs/desktop-agent-development-guide.md`

- [x] Document layered skill and system-prompt loading rules, including future agent-level scope.
- [x] Run `pnpm test`, `pnpm typecheck`, and the focused frontend/backend test commands.
- [x] Run `gitnexus detect-changes --scope staged` before commit.
- [x] Stage only this feature's files and commit on `codex/skills-system`.
