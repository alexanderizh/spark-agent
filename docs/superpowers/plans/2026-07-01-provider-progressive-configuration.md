# Provider Progressive Configuration Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Provider setup usable with only essential fields while preserving every existing advanced option and saved runtime field.

**Architecture:** Keep `ProviderForm` and `handleSave` unchanged. Add presentation-only disclosure state in `ProviderEditPanel`, render existing advanced controls conditionally, and expose a short summary derived from current form values.

**Tech Stack:** React, TypeScript, Vitest, jsdom, Less

---

### Task 1: Lock the interaction with a component test

**Files:**

- Create: `apps/desktop/src/renderer/design/views/ProvidersView.test.tsx`

- [x] Render `ProviderEditPanel` and assert advanced labels are absent by default.
- [x] Click the `高级设置` disclosure and assert the advanced labels become visible.
- [x] Verify the collapsed disclosure includes an automatic-configuration summary.
- [x] Run the focused Vitest test and confirm the new test fails before implementation.

### Task 2: Add progressive disclosure

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.less`

- [x] Add `advancedOpen` state and reset it whenever the drawer opens for a new profile or preset.
- [x] Add an accessible disclosure button with adapter/model summary and chevron icon.
- [x] Render all media adapter controls and optional text-model controls only while expanded.
- [x] Keep all form/save handlers unchanged.
- [x] Wrap optional model-list and tier-mapping sections in the same disclosure state.

### Task 3: Verify behavior and compatibility

**Files:**

- Modify: `docs/superpowers/specs/2026-07-01-provider-progressive-configuration-design.md`
- Modify: `docs/superpowers/plans/2026-07-01-provider-progressive-configuration.md`

- [x] Re-run the focused test and confirm it passes.
- [x] Run the desktop typecheck and relevant Provider tests.
- [x] Inspect the drawer at desktop and narrow viewport widths.
- [x] Mark both documents `已落地` after verification.
- [x] Run GitNexus change detection and refresh the index.
