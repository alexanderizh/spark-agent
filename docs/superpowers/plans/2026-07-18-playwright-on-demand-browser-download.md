# Playwright Browser On-Demand Download Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-18

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove Chromium downloads from application startup while preserving Agent-triggered recovery and the Settings integrity manual download path.

**Architecture:** The desktop main process becomes detection-only at startup. Browser recovery guidance moves into a focused agent-runtime prompt module and the built-in browser skill, while the existing Playwright integrity IPC remains the single manual-download implementation. The settings card only changes explanatory copy.

**Tech Stack:** Electron, TypeScript, React, Vitest, Playwright MCP

---

### Task 1: Make application startup detection-only

**Files:**
- Create: `apps/desktop/src/main/services/__tests__/PlaywrightStartupDownloadPolicy.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [x] **Step 1: Write the failing startup policy test**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Playwright startup download policy', () => {
  it('detects status without installing Chromium during startup', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../index.ts', import.meta.url)),
      'utf8',
    )

    expect(source).toContain('pushPlaywrightStatus()')
    expect(source).not.toContain('autoInstallBrowser')
    expect(source).not.toContain('[auto-download]')
  })
})
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/__tests__/PlaywrightStartupDownloadPolicy.test.ts`

Expected: FAIL because `index.ts` still imports and invokes `autoInstallBrowser` and emits `[auto-download]` logs.

- [x] **Step 3: Remove startup installation code**

Change the Playwright imports to retain only detection and early environment setup:

```ts
import { detectIntegrity as detectPlaywrightIntegrity } from './services/PlaywrightIntegrityService.js'
import { ensureBundledBrowserEnv } from './services/PlaywrightEnvironment.js'
```

Replace the delayed startup block with detection-only behavior:

```ts
// 7. 检测 Playwright 完整性并推送状态（延迟 6 秒，与 SDK 自检错开）
// 启动阶段只检测，不隐式下载 Chromium；下载由 Agent 按需恢复或用户在完整性页手动触发。
setTimeout(() => {
  pushPlaywrightStatus()
}, 6_000)
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/__tests__/PlaywrightStartupDownloadPolicy.test.ts`

Expected: PASS.

### Task 2: Add Agent on-demand recovery guidance

**Files:**
- Create: `packages/agent-runtime/src/services/browser-automation-prompt.ts`
- Create: `packages/agent-runtime/src/services/browser-automation-prompt.test.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `apps/desktop/resources/skills/browser-use/SKILL.md`
- Create: `apps/desktop/src/main/services/__tests__/BrowserUseSkillPolicy.test.ts`

- [x] **Step 1: Write failing prompt and skill policy tests**

The runtime test must assert that the exported prompt contains all recovery decisions:

```ts
import { describe, expect, it } from 'vitest'
import { BROWSER_AUTOMATION_SYSTEM_PROMPT } from './browser-automation-prompt.js'

describe('browser automation system prompt', () => {
  it('guides task-driven Chromium recovery without startup downloads', () => {
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain('playwright install chromium')
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain('150 MB')
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain('设置 → 完整性 → 浏览器自动化')
    expect(BROWSER_AUTOMATION_SYSTEM_PROMPT).toContain('Never download Chromium merely because the app/session started')
  })
})
```

The desktop skill policy test must load `resources/skills/browser-use/SKILL.md` and assert that it mentions reuse of system Chrome/Edge, on-demand download, retrying the original action, and the integrity-page fallback.

- [x] **Step 2: Run both tests and verify RED**

Run:

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/services/browser-automation-prompt.test.ts
pnpm --filter @spark/desktop exec vitest run src/main/services/__tests__/BrowserUseSkillPolicy.test.ts
```

Expected: FAIL because the focused prompt module and complete skill recovery guidance do not exist.

- [x] **Step 3: Extract and extend the runtime prompt**

Move `BROWSER_TOOL_NAMES` and `BROWSER_AUTOMATION_SYSTEM_PROMPT` out of the 10,000+ line `session.service.ts` into `browser-automation-prompt.ts`. Add this guidance to the prompt:

```ts
'If Playwright MCP cannot launch because Chromium is missing, its executable is absent, or browser versions are incompatible, first reuse any working system Chrome/Edge or existing Chromium.',
'If no browser is usable, explain that the on-demand Chromium download is about 150 MB, run the appropriate `playwright install chromium` command, and retry the original browser action.',
'If the download or retry fails, report the relevant error and guide the user to “设置 → 完整性 → 浏览器自动化” to download or repair Chromium manually.',
'Never download Chromium merely because the app/session started; recovery is task-driven.',
```

Import both exports from the new module in `session.service.ts` and remove the old inline declarations.

- [x] **Step 4: Complete the built-in skill recovery path**

Keep its current installation commands and add explicit instructions for the case where MCP tools exist but browser launch fails: reuse working browsers first, announce the approximately 150MB download, install Chromium on demand, retry the original action once, and fall back to “设置 → 完整性 → 浏览器自动化” after download/retry failure. Do not add any startup download instruction.

- [x] **Step 5: Run both focused tests and verify GREEN**

Run the two commands from Step 2.

Expected: both test files PASS.

### Task 3: Clarify the Settings integrity copy

**Files:**
- Create: `apps/desktop/src/renderer/design/views/PlaywrightStatusCard.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/PlaywrightStatusCard.tsx`

- [x] **Step 1: Write the failing description test**

Export a testable `getBrowserDescription` contract from the component and assert desired copy for `system` and `none`:

```ts
expect(getBrowserDescription('system')).toContain('当前可用')
expect(getBrowserDescription('system')).toContain('兼容性问题')
expect(getBrowserDescription('none')).toContain('未检测到可用浏览器')
expect(getBrowserDescription('none')).toContain('手动下载')
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/PlaywrightStatusCard.test.ts`

Expected: FAIL because `getBrowserDescription` is not exported.

- [x] **Step 3: Implement and use the description helper**

Add a pure helper accepting `PlaywrightStatusResponse['browserSource']`. Return the existing bundled message, a system-browser message explaining it is currently usable and matching Chromium is optional for compatibility problems, or a no-browser message pointing to manual download. Use the helper in the Chromium row instead of the nested conditional.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 4: Verify and refresh documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-playwright-on-demand-browser-download-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-playwright-on-demand-browser-download.md`

- [x] **Step 1: Run focused tests together**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/main/services/__tests__/PlaywrightStartupDownloadPolicy.test.ts \
  src/main/services/__tests__/BrowserUseSkillPolicy.test.ts \
  src/renderer/design/views/PlaywrightStatusCard.test.ts
pnpm --filter @spark/agent-runtime exec vitest run src/services/browser-automation-prompt.test.ts
```

Expected: all focused tests PASS.

- [x] **Step 2: Run type checks**

```bash
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/agent-runtime typecheck
```

Expected: both commands exit 0. If unrelated pre-existing worktree errors occur, record the exact errors and verify none reference changed files.

- [x] **Step 3: Inspect the scoped diff**

Run `git diff --` with only the files listed in this plan. Confirm there are no edits to unrelated user work and that `apps/desktop/src/main/index.ts` preserves the existing Codex runtime and font-asset changes.

- [x] **Step 4: Mark docs implemented**

Change both document status lines to:

```md
> 状态: 已落地 | 最后核对: 2026-07-18
```

- [x] **Step 5: Run final focused verification after doc refresh**

Repeat the focused test commands from Step 1 and confirm all tests still pass.
