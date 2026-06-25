# 安装包瘦身 + 删除 BrowserPanelView 死代码 — Phase 1 实施计划

> 状态: [实施中] | 最后核对: 2026-06-25

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（本会话内分批执行 + 检查点）来逐任务实施。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 把 `app.asar` 从 ~508MB 降到 ~200MB（去除重复打包的前端依赖、woff 字体、pnpm 嵌套副本），并清除 BrowserPanelView 僵尸功能。

**Architecture:** 纯打包配置 + 死代码删除，**不改运行时行为**。前端依赖已被 vite 打进 `out/renderer`，故从打包 `node_modules` 中排除；main/preload 经 `externalizeDepsPlugin` 外置，其运行时依赖（已静态核实仅 better-sqlite3/keytar/node-pty/openai/zod + 动态 require 的 playwright/@playwright/mcp 等）一律保留。每步以「重新打 `--dir` 包 + 体积核对 + 启动冒烟」为验证关。

**Tech Stack:** electron-builder 24、electron-vite 2、pnpm workspace、@electron/asar CLI。

**关键前置事实（已核实）：**
- `out/main/index.js` 外置 require 仅：`better-sqlite3 / keytar / node-pty / openai / zod`（+ node 内置 + electron）。`out/preload/index.js` 仅 `electron`。
- `src/main` **不引用任何前端包**（antd/@lobehub/pdfjs-dist/lucide-react/@file-viewer/katex/shiki/html2canvas/@xterm/@xyflow/react-easy-crop/@rc-component）。
- `playwright` 经 `require('playwright')`、`@playwright/mcp` 经 `require.resolve` + 子进程启动——**必须保留**。
- 顶层 `node_modules` 已含 openai/zod/better-sqlite3 等 main 所需依赖。

**提交策略：** 本计划含 commit 步骤，但**首次提交前需向用户确认**（项目规则：commit 只在用户要求时做）。执行时先确认分支策略（建议 `feat/packaging-slimdown`），再决定提交节奏。

---

## Part 1：去重瘦身

### Task 0: 建立基线

**Files:** 无（仅测量）

- [ ] **Step 1: 记录当前 asar 体积基线**

Run:
```bash
cd apps/desktop
du -h dist/mac-arm64/"Spark Agent.app"/Contents/Resources/app.asar
```
Expected: ~508M（记下这个数，作为对比基线）

- [ ] **Step 2: 确认 electron-builder.yml 当前 files 段**

Run: `sed -n '40,64p' apps/desktop/electron-builder.yml`
Expected: 看到裸的 `node_modules/**/*`，无前端包排除项。

---

### Task 1: 排除已 bundle 的纯前端依赖

**Files:**
- Modify: `apps/desktop/electron-builder.yml`（`files:` 段）

- [ ] **Step 1: 在 files 段追加排除项**

在 `electron-builder.yml` 的 `files:` 列表中，`- '!browsers/**'` 之后追加：

```yaml
  # 以下包仅被 renderer 经 vite 打进 out/renderer，运行时不从 node_modules 加载。
  # main/preload 不引用它们（已核实 out/main/index.js 的 require 列表）。
  - '!node_modules/@lobehub/**'
  - '!node_modules/antd/**'
  - '!node_modules/pdfjs-dist/**'
  - '!node_modules/lucide-react/**'
  - '!node_modules/@file-viewer/**'
  - '!node_modules/katex/**'
  - '!node_modules/shiki/**'
  - '!node_modules/html2canvas/**'
  - '!node_modules/@xterm/**'
  - '!node_modules/@xyflow/**'
  - '!node_modules/react-easy-crop/**'
  - '!node_modules/@rc-component/**'
  - '!node_modules/react-dom/**'
```

> 说明：`react`（仅 ~0.25MB）保留不排除，避免任何边缘运行时解析问题，收益微小不值得冒险。`motion` 视情况——若 Task 1 冒烟通过后体积仍需压，再单独评估（motion 仅 ~0.7M）。

- [ ] **Step 2: 重新打 --dir 包**

Run:
```bash
cd apps/desktop
pnpm run build && pnpm run rebuild:native && pnpm exec electron-builder --dir --mac --arm64
```
Expected: 构建成功，无报错。

- [ ] **Step 3: 核对前端包已从 asar 移除**

Run:
```bash
cd apps/desktop
npx --yes @electron/asar list dist/mac-arm64/"Spark Agent.app"/Contents/Resources/app.asar | grep -cE '^/node_modules/(antd|@lobehub|pdfjs-dist|lucide-react|@file-viewer|katex|shiki|html2canvas|@xterm|@xyflow|react-easy-crop|@rc-component|react-dom)/'
```
Expected: `0`（这些包已不在 asar）

- [ ] **Step 4: 启动冒烟测试（关键关卡）**

Run:
```bash
cd apps/desktop
open dist/mac-arm64/"Spark Agent.app"
```
手动验证（无 `Cannot find module` 弹窗/崩溃）：
1. 应用正常启动、主窗口渲染。
2. 新建会话、发一条消息（验证 agent runtime + DB）。
3. 打开一个文件预览（验证 @file-viewer 已 bundle，能渲染）。
4. 打开内置终端（验证 @xterm 已 bundle）。
5. 预览一个 PDF（验证 pdfjs 已 bundle + worker）。
6. 渲染含数学公式/代码高亮的消息（验证 katex/shiki）。

Expected: 全部正常。若任一报缺模块 → 该包不应排除，从 Step 1 清单移除并回到 Step 2。

- [ ] **Step 5: 记录新体积**

Run: `du -h apps/desktop/dist/mac-arm64/"Spark Agent.app"/Contents/Resources/app.asar`
Expected: 显著下降（预计降 ~250MB+）。

---

### Task 2: 去掉 woff 字体（保留 woff2）

**Files:**
- Modify: `apps/desktop/electron.vite.config.ts`（renderer 段新增插件）

- [ ] **Step 1: 确认当前 renderer 产物含 woff**

Run:
```bash
ls apps/desktop/out/renderer/assets/*.woff 2>/dev/null | wc -l
```
Expected: > 0（当前有 woff 文件，主要是 HarmonyOS SC ~32MB）

- [ ] **Step 2: 在 electron.vite.config.ts 新增 dropWoff 插件**

在文件顶部 `copyRuntimeToolsPlugin()` 之后新增：

```ts
/**
 * dropWoffPlugin — 从 renderer 产物中剔除 .woff（保留 .woff2）。
 * Electron(Chromium) 完整支持 woff2，woff 仅为古旧浏览器回退，纯冗余。
 * HarmonyOS Sans SC 的 woff 约 32MB。
 */
function dropWoffPlugin() {
  return {
    name: 'drop-woff',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; source?: unknown; fileName: string }>) {
      for (const [key, asset] of Object.entries(bundle)) {
        // 1. 删除 .woff 资源文件（保留 .woff2）
        if (asset.fileName.endsWith('.woff')) {
          delete bundle[key]
          continue
        }
        // 2. 从 CSS 中移除指向 .woff 的 @font-face src 片段
        if (asset.type === 'asset' && asset.fileName.endsWith('.css') && typeof asset.source === 'string') {
          asset.source = asset.source.replace(
            /url\([^)]+\.woff\)\s*format\(["']woff["']\)\s*,?\s*/g,
            '',
          )
        }
      }
    },
  }
}
```

然后在 `renderer.plugins` 数组追加 `dropWoffPlugin()`：

```ts
  renderer: {
    // ...
    plugins: [react(), tailwindcss(), dropWoffPlugin()],
```

- [ ] **Step 3: 重新构建 renderer 并核对无 woff**

Run:
```bash
cd apps/desktop
pnpm run build
ls out/renderer/assets/*.woff 2>/dev/null | wc -l
ls out/renderer/assets/*.woff2 2>/dev/null | wc -l
```
Expected: woff = `0`，woff2 > `0`。

- [ ] **Step 4: 冒烟验证字体仍正常**

Run: 重新 `electron-builder --dir --mac --arm64` 后 `open` 应用。
手动验证：界面中文字体（HarmonyOS Sans SC）、等宽字体（Geist Mono）显示正常，无字体回退到系统默认的突兀变化。

Expected: 字体正常（woff2 生效）。

---

### Task 3: 消除 pnpm 嵌套 node_modules 重复

**Files:**
- Modify: `apps/desktop/electron-builder.yml`（`files:` 段）

- [ ] **Step 1: 确认嵌套副本现状**

Run:
```bash
npx --yes @electron/asar list apps/desktop/dist/mac-arm64/"Spark Agent.app"/Contents/Resources/app.asar | grep -E '^/node_modules/@spark/[^/]+/node_modules/' | sed -E 's#(^/node_modules/@spark/[^/]+/node_modules/[^/]+).*#\1#' | sort -u
```
Expected: 看到 `@spark/agent-runtime/node_modules/openai`、`.../zod`、`.../@anthropic-ai`、`@spark/storage/node_modules/better-sqlite3` 等嵌套副本。

- [ ] **Step 2: 在 files 段追加嵌套 node_modules 排除**

在 Task 1 追加的排除项之后再加：

```yaml
  # @spark/* 已被 bundle 进 out/main，其依赖应解析到顶层 node_modules，
  # 嵌套副本（openai/zod/@anthropic-ai/better-sqlite3 等）是 pnpm 收集产生的重复。
  - '!node_modules/@spark/*/node_modules/**'
```

- [ ] **Step 3: 重新打包 + 核对嵌套副本消失**

Run:
```bash
cd apps/desktop
pnpm run build && pnpm run rebuild:native && pnpm exec electron-builder --dir --mac --arm64
npx --yes @electron/asar list dist/mac-arm64/"Spark Agent.app"/Contents/Resources/app.asar | grep -cE '^/node_modules/@spark/[^/]+/node_modules/'
```
Expected: `0`

- [ ] **Step 4: 冒烟验证（重点验 DB + agent runtime + native）**

Run: `open` 应用。
手动验证：
1. 应用启动无 `Cannot find module`。
2. 新建会话发消息（agent-runtime + openai/zod 解析）。
3. 数据持久化：重启应用，历史会话还在（better-sqlite3 native 正常）。

Expected: 全部正常。**若报缺模块**（项目记忆记载过「pnpm 漏收 bindings/commander 传递依赖」）→ 改为更精确的 per-package 排除（只排 `@spark/*/node_modules/{openai,zod,@anthropic-ai}`），保留可能缺失的传递依赖；或在顶层 node_modules 补齐后再排除。

---

### Task 4: 清理杂项

**Files:**
- Modify: `apps/desktop/electron-builder.yml`（`files:` 段）

- [ ] **Step 1: 追加杂项排除**

在 files 段追加（`.DS_Store` 若已有则跳过）：

```yaml
  - '!**/*.map'
  - '!**/*.md'
  - '!**/*.ts'
  - '!**/{LICENSE,license,LICENSE.txt,*.LICENSE.txt,CHANGELOG.md}'
```

> 注意：不要排除 `.node`、`.sql`（migrations）、`.json`（package.json/各类清单）、`cli.js`（@playwright/mcp）。

- [ ] **Step 2: 重新打包 + 冒烟**

Run: `pnpm run build && pnpm run rebuild:native && pnpm exec electron-builder --dir --mac --arm64` 后 `open`。
Expected: 启动正常，核心功能（会话/文件预览/终端/PDF）OK。

---

### Task 5: Part 1 终检

- [ ] **Step 1: 出完整 DMG 测体积**

Run:
```bash
cd apps/desktop
pnpm run build:mac:arm64
ls -lh dist/*.dmg
du -h dist/mac-arm64/"Spark Agent.app"/Contents/Resources/app.asar
```
Expected: asar ≤ ~220MB（对比基线 508MB）；DMG 显著下降。

- [ ] **Step 2: 记录瘦身成果**

把基线/瘦身后 asar 与 DMG 数字记到设计文档「最后核对」或本计划末尾。

---

## Part 2：删除 BrowserPanelView 死代码

### Task 6: impact 分析（动手前必做）

**Files:** 无（仅分析）

- [ ] **Step 1: 对 BrowserPanelView 跑 impact**

用 GitNexus MCP：`impact({target: "BrowserPanelView", direction: "upstream"})`，记录 blast radius。

- [ ] **Step 2: 对 BrowserAutomationViewService 跑 impact + context**

`impact({target: "BrowserAutomationViewService", direction: "upstream"})` 与 `context({name: "BrowserAutomationViewService"})`。判定：`openView`/`getCdpEndpoint`/`bindLifecycle` 是否仍有真实运行时调用路径（前端是否还会触发 `browser:openView` 等 IPC）。

- [ ] **Step 3: 确认 PlaywrightStatusCard 引用方**

Run: `grep -rn "PlaywrightStatusCard" apps/desktop/src`
判定：是否仅被 BrowserPanelView 引用（决定是否连带删除）。

- [ ] **Step 4: 若任何目标为 HIGH/CRITICAL 风险 → 先告知用户再继续。**

---

### Task 7: 移除 BrowserPanelView 及其无入口的关联代码

**Files:**
- Delete: `apps/desktop/src/renderer/design/views/BrowserPanelView.tsx`
- Delete（若 Step 6.3 确认仅 BrowserPanelView 用）: `apps/desktop/src/renderer/design/views/PlaywrightStatusCard.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`（移除 import 与 `<BrowserPanelView />`、`main-with-browser` 包裹）
- Modify: `apps/desktop/src/renderer/design/AppContext.tsx`（移除 `browserPanelOpen`/`browserPanelWidth` 及持久化 key、`BROWSER_PANEL_*` 常量）
- Modify: 相关 `.less`（`ChatView.less` 等含 `.browser-panel`/`.main-with-browser` 的规则）。**遵守「禁止编辑 views.css」**——删除落到对应组件 `.less`，不在全局 views.css 增改。

- [ ] **Step 1: 删除组件文件**

```bash
rm apps/desktop/src/renderer/design/views/BrowserPanelView.tsx
# 若仅 BrowserPanelView 引用 PlaywrightStatusCard：
# rm apps/desktop/src/renderer/design/views/PlaywrightStatusCard.tsx
```

- [ ] **Step 2: 改 App.tsx**

把（约 `App.tsx:1008-1023`）：
```tsx
{t.view === 'chat' ? (
  <div className="main-with-browser">
    <div className="main">
      <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
        {viewElement}
      </div>
    </div>
    <BrowserPanelView />
  </div>
) : (
  <div className="main">
    <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
      {viewElement}
    </div>
  </div>
)}
```
替换为：
```tsx
<div className="main">
  <div className="view-body" style={{ display: 'flex', flexDirection: 'column' }}>
    {viewElement}
  </div>
</div>
```
并删除顶部 `import { BrowserPanelView } from './design/views/BrowserPanelView'`。

- [ ] **Step 3: 改 AppContext.tsx**

移除 `browserPanelOpen`、`browserPanelWidth` 的类型字段、默认值、`key === 'browserPanelOpen'/'browserPanelWidth'` 的持久化分支、`BROWSER_PANEL_OPEN_KEY`/`BROWSER_PANEL_WIDTH_MIN`/`MAX` 常量及其 export。

- [ ] **Step 4: 清理 CSS**

在含 `.browser-panel`、`.main-with-browser`、`browser-panel-resizing` 的组件 `.less` 中删除对应规则（grep 定位）：
```bash
grep -rn "browser-panel\|main-with-browser" apps/desktop/src/renderer --include=*.less --include=*.tsx
```
逐处删除（注意 ChatView.tsx 中 `browser-panel-resizing` 的 body class 判断也要一并清理）。

- [ ] **Step 5: typecheck**

Run: `cd apps/desktop && pnpm run typecheck`
Expected: 通过，无悬空引用（`BROWSER_PANEL_WIDTH_MIN` 等 export 已无消费方）。

---

### Task 8: 条件性移除 BrowserAutomationViewService

**Files:**（依据 Task 6 结论二选一）
- 若确认死代码: Delete `apps/desktop/src/main/services/BrowserAutomationViewService.ts`；Modify `apps/desktop/src/main/index.ts`（移除 import 与 `bindBrowserViewLifecycle()`、`getBrowserCdpEndpoint`/`isBrowserViewOpen` 用法，pushPlaywrightStatus 中 `viewOpen`/`cdpEndpoint` 改为常量 false/null 或移除字段）；Modify `apps/desktop/src/main/ipc/index.ts`（移除 `browser:*` handlers）；同步协议类型。
- 若仍有调用路径: **保留**，仅完成 Task 7。

- [ ] **Step 1: 按 Task 6 结论执行删除或保留**

若删除，逐文件移除引用；保留 `pushPlaywrightStatus` 的字段契约（前端 `PlaywrightStatusResponse` 若仍含 `viewOpen`/`cdpEndpoint`，给安全默认值，避免破坏协议）。

- [ ] **Step 2: typecheck + 单测**

Run: `cd apps/desktop && pnpm run typecheck && pnpm run test:unit`
Expected: 通过。注意 `renderer.test.ts` 里对 `BrowserPanelView` 的 `vi.doMock` 需同步删除（约 line 1504/1658）。

---

### Task 9: Part 2 验证

- [ ] **Step 1: 全量 typecheck + 单测**

Run: `cd apps/desktop && pnpm run typecheck && pnpm run test:unit`
Expected: 全绿。

- [ ] **Step 2: 启动冒烟**

Run: `pnpm run build && pnpm run rebuild:native && pnpm exec electron-builder --dir --mac --arm64` 后 `open`。
手动验证：聊天主界面正常（无 `main-with-browser` 布局残留/错位），无控制台报错。

- [ ] **Step 3: detect_changes 复核**

用 GitNexus `detect_changes({scope: "compare", base_ref: "master"})`，确认改动只影响打包配置、BrowserPanelView 相关符号与 AppContext，无意外波及。

---

### Task 10: Phase 1 收尾

- [ ] **Step 1: 汇总体积成果 + 更新设计文档「最后核对」日期**

- [ ] **Step 2: 向用户确认提交**

汇报：asar 基线 508MB → 现 XXX MB，DMG → XXX MB；BrowserPanelView 已移除（BrowserAutomationViewService 删/留及原因）。询问是否提交、分支策略，再执行 commit。

---

## Self-Review 记录

- **Spec 覆盖**：Part 1（1.1 前端排除→Task1、1.2 woff→Task2、1.3 嵌套→Task3、1.4 杂项→Task4）、Part 2（2.1 删除→Task7、2.2 service 核查→Task6/8）均有对应任务。Phase 2（Part 3 浏览器策略）不在本计划，另起计划。
- **占位符**：无 TBD；所有配置/代码步骤含完整内容。
- **类型一致**：CSS 类名 `main-with-browser`/`browser-panel`、tweak 键 `browserPanelOpen`/`browserPanelWidth`、常量 `BROWSER_PANEL_*` 在各任务间一致。
