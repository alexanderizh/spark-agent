# 安装包瘦身 + 内置可用 Playwright 设计方案

> 状态: [待开发] | 最后核对: 2026-06-25

## 背景与问题

当前 macOS 构建产物体积异常：

- `Spark Agent.app` ≈ **746MB**，其中 `app.asar` ≈ **508MB**（Electron 框架基线 ~150MB 不可压缩，余下全是应用代码与依赖）。
- DMG 安装包 ≈ **228–294MB**（不同版本波动）。

同时，**内置 Playwright 在终端用户机器上不可用**：`electron-builder.yml` 用 `!browsers/**` 把浏览器目录整个排除在打包之外，运行时回退链（`resourcesPath/browsers` → `~/.cache/ms-playwright` → 系统 Chrome/Edge）在一台只装了 Safari 的干净 macOS 上会全部落空。

### 根因分析（已实测确认）

**安装包过大** —— 集中在三类重复打包：

1. **前端依赖打了两份**（最大头）。renderer 进程经 vite 把所有前端依赖打进 `out/renderer`（118MB），但 `electron-builder.yml` 的 `files: node_modules/**/*` 又把这些包的源码原样收了一份。这些包运行时根本不从 node_modules 加载。实测 asar 内冗余占用：`@lobehub/*` 96MB、`@file-viewer/*` 56MB、`antd` 52MB、`pdfjs-dist` 35MB、`lucide-react` 28MB，外加 katex/shiki/html2canvas/@xterm/@xyflow/react-dom 等 ~30MB。main/preload 进程相反——用 `externalizeDepsPlugin` 保持外置，其运行时依赖（openai、better-sqlite3、keytar、node-pty、playwright、@playwright/mcp、js-yaml、zod、electron-updater、@anthropic-ai/claude-agent-sdk 等）**必须保留**。
2. **字体 woff 冗余**。HarmonyOS Sans SC 在 renderer 同时打了 `.woff`（32MB）和 `.woff2`（17MB），现代 Electron 只需 woff2。且 `@lobehub/webfont-harmony-sans-sc` 在 node_modules 还有 73MB 一份（已 bundle，冗余）。
3. **pnpm 嵌套 node_modules 重复**。`@spark/agent-runtime/node_modules` 自带 openai(14M)+@anthropic-ai(11M)+zod(4.5M)+嵌套 @spark(31M)，`@spark/storage/node_modules` 又一份 better-sqlite3(12M)+zod。zod 全包至少 3–4 份。

> 注：上述优化曾经做过（项目记忆记载「DMG 530→144M；字体去 woff + 排除已 bundle 前端依赖」），但已回退——当前 `files` 是裸的 `node_modules/**/*`，无任何排除。本方案 Part 1 本质是**重新落地并固化**这些优化。

**Playwright 不可用** —— `electron-builder.yml:47` 的 `!browsers/**` 让打包不含任何浏览器。架构上（见 `index.ts:542-548` 注释）此前「复用 Electron 自带 chromium 的 CDP」方案已废弃，现在 Playwright MCP 会**自己拉起一个真正的 chromium 系浏览器**；代码已支持系统 Chrome/Edge（`PlaywrightMcpRegistration.ts:77` 传 `--browser chrome|msedge`），但干净 macOS 无 Chromium 系浏览器时无可用对象。

**BrowserPanelView 僵尸功能** —— `App.tsx:1015` 仍挂载 `<BrowserPanelView />`，但已无任何手动入口（无按钮/菜单触发 `browserPanelOpen`），仅在收到 `stream:playwright:status` 事件时自动弹出。注释（`index.ts:548`）已写明它「不再与 agent 共享会话」，是独立的手动浏览侧栏。

## 目标

1. `app.asar` 从 ~508MB 降到 ~200MB（去重瘦身，纯删除，无运行时行为变化）。
2. 终端用户机器上 Playwright 尽可能可用——**系统浏览器优先**（Windows 用自带 Edge，0 体积/下载代价）；无系统浏览器时**引导安装**（Edge 优先、Chrome 次之，因受限网络下微软域名通常比 Google 可达）；**仅 macOS** 内置压缩 chromium 作为最终兜底（无系统浏览器且无法下载时，首次启动带进度解压）。
3. 清除 BrowserPanelView 死代码。

## 非目标

- 不做字体子集化（CJK subsetting 收益大但风险/复杂度高，留作后续）。
- 不动 Electron 框架本身（locale 裁剪等微优化可选，不作为主线）。
- 不改 agent 的浏览器自动化交互逻辑（只保证「有可用浏览器」）。

## 方案概览

分两阶段交付：

- **Phase 1 = Part 1 + Part 2**：去重瘦身 + 移除 BrowserPanelView 死代码。低风险、立即见效，单独一轮验证。
- **Phase 2 = Part 3**：系统浏览器优先 + 引导安装（Edge 优先）+ macOS 内置压缩 chromium 兜底（无系统浏览器时按需首次启动解压）。较复杂（浏览器策略调整 + 引导 UI + macOS 构建管道/解压 UI），单独一轮。

---

## Part 1：去重瘦身（Phase 1）

### 1.1 排除已 bundle 的纯前端依赖

**手段**：在 `electron-builder.yml` 的 `files` 增加精确排除项（surgical negation），只排除**确认仅被 renderer bundle、main/preload 运行时不 require** 的包。候选清单：

```
- '!node_modules/{@lobehub,antd,pdfjs-dist,lucide-react,@file-viewer,katex,shiki,html2canvas,@xterm,@xyflow,motion,react-easy-crop,@rc-component}/**'
- '!node_modules/{react,react-dom}/**'   # 仅当确认 main 不直接 require 时
```

**安全护栏（必须执行）**：

1. 对每个候选包，检查打包后的 `out/main/index.js` 与 `out/preload/index.js` 是否 `require()` 了它。判定方式：构建后 grep `out/main`、`out/preload` 的 require 列表。
2. main 进程确需的依赖（openai、js-yaml、zod、better-sqlite3、keytar、node-pty、playwright、playwright-core、@playwright/mcp、electron-updater、@anthropic-ai/claude-agent-sdk、@larksuiteoapi）一律**不排除**。
3. 排除后必须跑**启动冒烟测试**：打 `--dir` 包、启动、走通核心路径（聊天、文件预览、终端、PDF 预览），确认无 `Cannot find module`。

**备选**：把这些包从 `dependencies` 移到 `devDependencies`（语义上它们是 build-time 依赖，被 vite 在构建期消费）。electron-builder 默认不收 devDeps，效果等价且更干净，但会改变依赖分类、可能影响其它工具链。**默认采用 `files` negation**（更外科、可逆、blast radius 小）。

### 1.2 去掉 woff 字体

- renderer 产物只保留 woff2：覆盖 `@lobehub/webfont-harmony-sans-sc` 的 CSS 字体引用，或在 vite 构建中过滤 `.woff`（保留 `.woff2`）。预计省 32MB。
- 确保 `@lobehub/webfont-*` 不进打包 node_modules（已含在 1.1 的 `@lobehub` 排除中）。

### 1.3 消除 pnpm 嵌套 node_modules 重复

- 在 `files` 排除 `!node_modules/@spark/*/node_modules/**`，让 `@spark/*` 的依赖解析到顶层（已 bundle 进 main 的代码 `require()` 解析根为 `out/main`，指向顶层 node_modules）。
- **风险**：项目记忆记载过「pnpm isolated + electron-builder 漏收 bindings/commander 传递依赖」。因此排除后**必须验证**顶层 node_modules 含全部被 main 引用的传递依赖；如缺失，改用更精确的 per-package 排除或在顶层补齐。以启动冒烟测试为准。

### 1.4 清理杂项

- `files` 增加 `!**/.DS_Store`（已有，确认生效）、`!**/*.md`、`!**/*.map`（按需）。
- 可选：裁剪 Electron 多余 locale（仅保留 zh-CN、en）。**列为可选，不阻塞主线**。

### Part 1 验收

- `app.asar` ≤ ~220MB。
- `--dir` 包启动无缺模块；核心功能冒烟通过。
- `detect_changes()` 仅影响打包配置相关，无意外符号变更。

---

## Part 2：移除 BrowserPanelView 死代码（Phase 1）

### 2.1 清理范围

- 删除 `BrowserPanelView.tsx`、其 pop-out 窗口逻辑、`PlaywrightStatusCard.tsx`（若仅被它引用）。
- 移除 `App.tsx:1015` 的 `<BrowserPanelView />` 及外层 `main-with-browser` 包裹（退化为普通 `main`）。
- 移除 `AppContext` 的 `browserPanelOpen` / `browserPanelWidth` tweak 及其持久化 key。
- 移除相关 CSS（`browser-panel*`、`main-with-browser*`；注意遵守「禁止编辑 views.css」——样式删除落到对应组件 `.less`/局部文件，不在全局 views.css 增改）。

### 2.2 BrowserAutomationViewService 核查（关键）

现在 `index.ts:550` 以 `cdpEndpoint:null` 注册，不再复用嵌入式自动化窗口。需用 GitNexus `impact({target:"BrowserAutomationViewService", direction:"upstream"})` 与 `context` 确认：

- 若 `openView`/`getCdpEndpoint`/`bindLifecycle` 已无真实运行时调用路径（仅 IPC 暴露但前端不再调用）→ 一并清理 service + IPC handler + 协议类型。
- 若仍有调用路径（如某处手动浏览/pop-out 仍依赖）→ **保留**，仅删 BrowserPanelView 本身。

> 本项**必须**先做 impact 分析再动手；HIGH/CRITICAL 风险需先告知用户。

### Part 2 验收

- 编译通过、单测通过、启动无报错。
- 确认删除的代码确无运行时引用（impact 分析 + 启动冒烟）。

---

## Part 3：系统浏览器优先 + 引导安装 + macOS 内置 chromium 兜底（Phase 2）

### 决策记录

最终采用**系统浏览器优先**模型，而非全平台内置：

- Windows Edge 系统预装 → 绝大多数用户开箱即用，0 体积/下载代价。
- 无系统浏览器时引导安装，**Edge 优先**（受限网络下微软域名通常比 Google 可达）、Chrome 次之。
- **仅 macOS** 内置压缩 chromium 作为最终兜底——针对「macOS + 无 Chrome/Edge + 无可用网络」这类引导也救不了的边缘用户。Windows 不内置。
- 关键优化：macOS 的解压**按需触发**——仅在「首次启动检测到无系统浏览器」时才解压；已装 Chrome/Edge 的 mac 用户跳过，不浪费 344MB。

### 3.1 浏览器策略调整（系统优先）

改 `PlaywrightEnvironment.ts`：

- **翻转优先级**为：① 系统浏览器（Edge 优先 → Chrome）→ ② macOS 解压后的 `userData/browsers` 兜底 chromium → ③ Playwright 默认缓存（dev 场景）→ ④ 无（触发引导 UI）。
  - 注意：现有实现是「bundled/chromium 永远胜过系统浏览器」，本次按产品决策**反转**为系统优先。dev 场景开发者通常自带 Chrome，不受影响。
- **补 macOS Edge 检测**：`detectSystemBrowser()` 的 mac 分支当前只查 Chrome，新增 `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`，并按 Edge 优先排序。
- 在 `getBundledBrowserDirCandidates()` 候选里新增 `join(app.getPath('userData'), 'browsers')`。

### 3.2 引导安装 UI（无浏览器时）

- 当策略解析为「无可用浏览器」时，渲染一个引导组件：**先 Edge 下载入口**（`https://www.microsoft.com/edge`），**再 Chrome**（`https://www.google.com/chrome`）；提示「检测到本机无可用浏览器，agent 浏览器自动化需要 Chrome 或 Edge」。
- macOS 上若内置兜底已就绪/可解压，则引导文案改为「正在准备内置浏览器…」并走 3.4 的解压流程；引导下载作为解压失败后的二次兜底。
- 新组件样式写在其同目录 `.less`，**不碰全局 views.css**。

### 3.3 体积事实（诚实基线）

chromium-1228 解压后 mac-arm64 ≈ **344MB**；Playwright 官方分发归档 ≈ **130–150MB**。macOS 安装包因内置兜底固定 **+~130MB**（无论用户是否用得到，extraResources 总在 DMG 里）；Windows 包**不增**。运行期仅「无系统浏览器」的 mac 才真正解压出 ~344MB 到 `userData`。

### 3.4 构建期：打包压缩归档（仅 macOS）

新增脚本 `apps/desktop/scripts/pack-chromium.mjs`：

- 取**当前 mac arch** 对应、与 `playwright-core` 版本匹配的 chromium 构建（来自本地 `browsers/` 或 `pnpm exec playwright install chromium` 产物）。
- 压缩成单个归档放入 `extraResources`（**不进 asar**——asar 内不可直接解压，且会被签名/公证覆盖）。落点示例：`extraResources/chromium.pack`。
- 同时写 `chromium.manifest.json`（版本号、目标 arch、解压后预期目录名、校验和、解压后字节数——用于进度总量与完整性校验）。
- 归档格式：优先 **tar + brotli（node:zlib 内置，无新增原生依赖）**；若 brotli 解压过慢，退回 **tar.gz（zlib）**。最终由实现阶段基准测试（解压时间 vs 体积）决定。
- 仅接入 macOS build（`build:mac:arm64` / `build:mac:x64` 各带对应 arch 归档）；`build:win` **不带**。

### 3.5 运行期：ChromiumProvisionService + 进度 UI（仅 macOS）

新增 `apps/desktop/src/main/services/ChromiumProvisionService.ts`：

- **触发时机**：macOS App 首次启动（`whenReady` 后）→ 先跑系统浏览器检测；**仅当无系统浏览器**时，检测 `userData/browsers` 是否就绪。
- **就绪判定**：比对 `userData/browsers/.provisioned`（已解压的 chromium 版本/校验和）与 `chromium.manifest.json`；不一致或缺失 → 触发解压。
- **解压**：流式从 `extraResources/chromium.pack` 解压到 `app.getPath('userData')/browsers`，按已写字节 / manifest 总字节算百分比，节流上报进度（含速率、剩余）。
- **完整性**：解压后校验关键二进制存在 + 校验和；失败则清理重试（上限 3 次）。成功写 `.provisioned`。
- **兜底链**：解压失败 → 回退到 3.2 的引导安装 UI（Edge → Chrome）；不阻断 App 其余功能。

**进度 UI**：

- 非阻塞进度层：主窗口照常加载，叠加「正在准备浏览器组件… 45%」浮层 + 动画，完成自动消失。
- 复用现有 IPC + `stream:*` 事件把进度推给 renderer，渲染新进度组件（样式写组件同目录 `.less`，不碰 views.css）。
- 失败态：「浏览器组件准备失败，可在设置重试，或安装 Edge/Chrome」。

### 3.6 electron-builder 配置

- 保留 `!browsers/**`（本地 dev 产物不进包），新机制走 `extraResources` 压缩归档，互不冲突。
- `extraResources` 的 chromium 归档**仅 mac target** 注入（通过 per-platform 配置或 build 脚本控制）。

### Part 3 验收

- **Windows**：无系统 Chrome 时用自带 Edge，agent 可成功驱动；包体不因浏览器增大。
- **macOS 有 Chrome/Edge**：直接用系统浏览器，**不解压**。
- **macOS 无浏览器**：首次启动出现解压进度，完成后 agent 可用；解压中断/重启幂等；解压失败回退引导安装 UI。
- macOS Edge 能被正确检测并优先于 Chrome。

---

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| 误排除 main 运行时依赖 → 启动崩 | 逐包核对 require + `--dir` 启动冒烟；`files` negation 可逆 |
| pnpm 嵌套排除导致漏收传递依赖 | 启动冒烟为准；必要时 per-package 精确排除 |
| 删 BrowserAutomationViewService 误伤 | 先 GitNexus impact 分析，确认无调用路径再删 |
| 优先级反转（系统优先）改变 dev 行为 | dev 开发者通常自带 Chrome；如需用本地 `browsers/`，保留 Playwright 默认缓存候选 |
| macOS 无浏览器解压拖慢首启 | 仅「无系统浏览器」才解压；进度浮层 + 非阻塞加载 |
| macOS + 无浏览器 + 无网络 | 内置 chromium 兜底（本方案已覆盖）；解压失败再退引导安装 |
| chromium 版本与 playwright-core 不匹配 | manifest 记版本，构建期从匹配源取；运行期校验 |

各 Part 改动均可独立回滚（Part 1/2 为配置与代码删除，Part 3 为新增模块）。

## 受影响文件（预估）

**Part 1**：`apps/desktop/electron-builder.yml`、可能 `apps/desktop/electron.vite.config.ts`（字体过滤）、`apps/desktop/package.json`（如走 devDeps 备选）。

**Part 2**：`apps/desktop/src/renderer/App.tsx`、`BrowserPanelView.tsx`（删）、`PlaywrightStatusCard.tsx`（删/留）、`AppContext.tsx`、相关 `.less`；条件性 `BrowserAutomationViewService.ts` + IPC。

**Part 3**：新增 `scripts/pack-chromium.mjs`（仅 macOS）、`src/main/services/ChromiumProvisionService.ts`、进度 UI 组件 + 引导安装 UI 组件（各带 `.less`）；改 `electron-builder.yml`（mac extraResources）、`PlaywrightEnvironment.ts`（优先级反转 + macOS Edge 检测 + userData 候选路径）、`PlaywrightMcpRegistration.ts`（策略消费）、`src/main/index.ts`（启动接线）、build 脚本（`build:mac:*`）。
