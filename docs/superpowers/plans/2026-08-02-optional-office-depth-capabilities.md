# Office 与深度可选能力包 Implementation Plan

> 状态: 实施中 | 最后核对: 2026-08-02

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动 Computer Use 的前提下，将离线 Office Viewer 静态资源和本地深度推理 Runtime 从桌面基础安装包移出，支持启动选择、后台安装、统一进度、设置页安装/更新/修复和功能入口按需恢复。

**Architecture:** 主进程 `OptionalCapabilityManager` 以现有 Spark artifact manifest 为远端事实源，将多个 artifact 聚合为 `office-viewer` 与 `local-depth` 两项用户能力，并复用受校验的 tarball installer 做 staging、健康检查和原子激活。renderer 只通过类型化 IPC 获取状态，统一的启动弹窗、右上角进度卡和设置卡消费同一状态流；Office 资产通过只读 `capability-asset://` 协议加载，深度 worker 从激活目录按绝对 ESM 入口加载 Runtime。

**Tech Stack:** TypeScript、Electron 43、React 19、Vitest、electron-builder 26、tar/gzip、Spark MinIO/S3 SigV4、`@electron/asar`。

---

## 文件结构

- Create `packages/protocol/src/optional-capabilities.ts`：能力 ID、阶段、状态、进度和 IPC payload。
- Create `apps/desktop/src/main/services/optional-capabilities/definitions.ts`：Office/深度 artifact 选择和健康检查定义；不得引用 Computer Use。
- Create `apps/desktop/src/main/services/optional-capabilities/OptionalCapabilityManager.ts`：状态、队列、安装、更新、修复、卸载和 active state。
- Create `apps/desktop/src/main/ipc/registerOptionalCapabilityIpc.ts`：类型化 IPC 与流事件接线。
- Create `apps/desktop/src/main/services/CapabilityAssetProtocol.ts`：只读 Office 静态资源协议。
- Create `apps/desktop/src/renderer/design/optional-capabilities/`：store/hook、启动选择弹窗、右上角进度卡、设置卡和 Office 缺失态。
- Create `scripts/prepare-office-viewer-artifact.mjs`、`scripts/prepare-depth-runtime-artifact.mjs`：可重复归档和包内 manifest。
- Create `scripts/publish-optional-capabilities-to-minio.mjs`：备份、staging manifest、原子发布和公网回读。
- Modify `apps/desktop/electron-builder.yml`：基础包排除 Office 静态目录和深度 Runtime 生产依赖。
- Modify `apps/desktop/src/main/services/depth-video/*`：worker 接收已激活 Runtime 入口。
- Modify `apps/desktop/src/renderer/design/components/OfficeFileViewer.tsx`：未安装时显示安装状态；就绪时使用远程资产根。
- Modify `apps/desktop/src/renderer/design/views/SettingsView.tsx`：只导入并组合独立设置卡，不继续扩张该 6,000+ 行文件。

### Task 1: 定义能力协议和 manifest 聚合规则

**Files:**
- Create: `packages/protocol/src/optional-capabilities.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Test: `packages/protocol/src/__tests__/schemas.test.ts`

- [ ] **Step 1: 写失败测试**

断言 `optional-capability:install` 只接受 `office-viewer | local-depth`，进度事件包含阶段、字节数、百分比和队列位置，拒绝 `computer-use`。

```ts
expect(() => validateIpcRequest('optional-capability:install', { capabilityId: 'computer-use' }))
  .toThrow()
expect(validateIpcRequest('optional-capability:install', { capabilityId: 'office-viewer' }))
  .toEqual({ capabilityId: 'office-viewer' })
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @spark/protocol test -- src/__tests__/schemas.test.ts`
Expected: FAIL，通道尚未定义。

- [ ] **Step 3: 实现最小协议**

定义 `OptionalCapabilityId`、`OptionalCapabilityPhase`、`OptionalCapabilityStatus`、`OptionalCapabilitySnapshot`、`OptionalCapabilityProgress`；IPC 包含 `list/check/install/update/repair/uninstall/set-auto-update`，流包含 `stream:optional-capability:snapshot` 与 `stream:optional-capability:progress`。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `pnpm --filter @spark/protocol test -- src/__tests__/schemas.test.ts`
Expected: PASS。

```bash
git add packages/protocol/src
git commit -m "feat(protocol): define optional capability lifecycle"
```

### Task 2: 主进程能力管理器、队列和原子激活

**Files:**
- Create: `apps/desktop/src/main/services/optional-capabilities/definitions.ts`
- Create: `apps/desktop/src/main/services/optional-capabilities/OptionalCapabilityManager.ts`
- Create: `apps/desktop/src/main/services/optional-capabilities/OptionalCapabilityStateStore.ts`
- Test: `apps/desktop/src/main/services/optional-capabilities/OptionalCapabilityManager.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：平台/架构 artifact 选择；Office 单 artifact 与深度 Runtime+模型聚合；串行队列；重复安装去重；下载/校验/解压/激活阶段；更新失败保留旧 active；损坏状态；自动更新仅处理已安装能力；定义列表不含 Computer Use。

```ts
expect(definitions.map((item) => item.id)).toEqual(['office-viewer', 'local-depth'])
await expect(manager.install('local-depth')).resolves.toMatchObject({ state: 'ready' })
expect(events.map((event) => event.phase)).toEqual(
  expect.arrayContaining(['queued', 'downloading', 'verifying', 'extracting', 'activating', 'ready']),
)
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm --dir apps/desktop exec vitest run src/main/services/optional-capabilities/OptionalCapabilityManager.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小管理器**

状态根目录固定为 `{userData}/optional-capabilities`。下载写入同盘 staging；包内 `capability-package.json`、archive SHA-256、artifact/version/platform/arch 和健康检查全部成功后才用 rename 更新 `active.json`。所有外部依赖（manifest fetch、archive install、平台、时钟、事件回调）可注入，测试禁止联网。

- [ ] **Step 4: 运行 GREEN、typecheck 并提交**

Run: `pnpm --dir apps/desktop exec vitest run src/main/services/optional-capabilities/OptionalCapabilityManager.test.ts`
Run: `pnpm --filter @spark/desktop typecheck`
Expected: PASS。

```bash
git add apps/desktop/src/main/services/optional-capabilities
git commit -m "feat(desktop): add optional capability manager"
```

### Task 3: IPC、启动检测、统一进度与设置卡

**Files:**
- Create: `apps/desktop/src/main/ipc/registerOptionalCapabilityIpc.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/renderer/design/optional-capabilities/useOptionalCapabilities.ts`
- Create: `apps/desktop/src/renderer/design/optional-capabilities/OptionalCapabilityStartupPrompt.tsx`
- Create: `apps/desktop/src/renderer/design/optional-capabilities/OptionalCapabilityProgressCard.tsx`
- Create: `apps/desktop/src/renderer/design/optional-capabilities/OptionalCapabilitiesSettingsCard.tsx`
- Create: `apps/desktop/src/renderer/design/optional-capabilities/optional-capabilities.less`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/design/views/SettingsView.tsx`
- Test: matching `*.test.tsx` and `registerOptionalCapabilityIpc.test.ts`

- [ ] **Step 1: 写失败测试**

启动快照在 manifest 不可达时不弹窗；缺失能力默认不勾选；同 manifest “稍后”冷却 7 天；确认后后台安装；右上角显示字节进度和队列；设置卡支持安装、更新、修复、卸载、自动更新和手动检查。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --dir apps/desktop exec vitest run src/main/ipc/registerOptionalCapabilityIpc.test.ts src/renderer/design/optional-capabilities/*.test.tsx`
Expected: FAIL，组件/IPC 尚不存在。

- [ ] **Step 3: 实现接线**

主窗口加载完成后延迟检查 manifest，不阻塞首屏；24 小时缓存由主进程负责，7 天提示冷却由 renderer localStorage 负责。弹窗所有大包默认不勾选；进度卡提供“前往完整性”并通过既有 `settingsSection=integrity` 导航。`SettingsView.tsx` 只增加 import 和 `<OptionalCapabilitiesSettingsCard />`。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: 与 Step 2 相同；再运行 `pnpm --filter @spark/desktop typecheck`。

```bash
git add packages/protocol apps/desktop/src/main apps/desktop/src/renderer/design/optional-capabilities apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/design/views/SettingsView.tsx
git commit -m "feat(desktop): surface optional capability installs"
```

### Task 4: Office Viewer 制品和只读资产协议

**Files:**
- Create: `scripts/prepare-office-viewer-artifact.mjs`
- Create: `scripts/__tests__/prepare-office-viewer-artifact.test.mjs`
- Create: `apps/desktop/src/main/services/CapabilityAssetProtocol.ts`
- Test: `apps/desktop/src/main/services/__tests__/CapabilityAssetProtocol.test.ts`
- Modify: `apps/desktop/src/main/services/PrivilegedProtocolSchemes.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/src/renderer/index.html`
- Modify: `apps/desktop/src/renderer/design/components/officeViewerOptions.ts`
- Modify: `apps/desktop/src/renderer/design/components/OfficeFileViewer.tsx`
- Test: existing Office tests plus new missing/installing/ready tests

- [ ] **Step 1: 写失败测试**

归档必须包含全量 `public/file-viewer` 资产和逐文件哈希，不得包含符号链接；协议拒绝 `..`、编码穿越和非激活 capability；Office 缺失时不实例化 FileViewer，安装完成自动重试；electron-builder 排除 `out/renderer/file-viewer{,/**/*}`。

- [ ] **Step 2: 运行 RED**

Run: `node --test scripts/__tests__/prepare-office-viewer-artifact.test.mjs`
Run: `pnpm --dir apps/desktop exec vitest run src/main/services/__tests__/CapabilityAssetProtocol.test.ts src/renderer/design/components/OfficeFileViewer.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现制品和加载**

版本使用 `2.2.3-1`，artifact ID 为 `archive.optional-office-viewer-2.2.3-1`。`capability-asset://office-viewer/<relative>` 只映射当前 active 目录，做 lexical + realpath 双重边界检查并返回正确 JS/WASM/font MIME。CSP 显式允许该 scheme 的 script/worker/connect/font。

- [ ] **Step 4: 运行 GREEN、真实 Office smoke test 并提交**

至少用仓库测试 DOCX/XLSX/PPTX fixture 验证 renderer 进入 ready；缺资源时显示安装态而非空白/崩溃。

```bash
git add scripts apps/desktop/electron-builder.yml apps/desktop/src/main/services/CapabilityAssetProtocol.ts apps/desktop/src/main/services/PrivilegedProtocolSchemes.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer
git commit -m "feat(office): load viewer assets as an optional package"
```

### Task 5: 深度 Runtime 制品与 worker 动态加载

**Files:**
- Create: `scripts/prepare-depth-runtime-artifact.mjs`
- Create: `scripts/__tests__/prepare-depth-runtime-artifact.test.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/src/main/services/depth-video/DepthFrameEstimator.ts`
- Modify: `apps/desktop/src/main/services/depth-video/DepthInferenceWorker.ts`
- Modify: `apps/desktop/src/main/workers/depth-inference.worker.ts`
- Modify: `apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.ts`
- Test: existing depth estimator/worker/IPC tests

- [ ] **Step 1: 写失败测试**

制品只包含目标平台/架构的 Transformers Node 依赖闭包，不含 `onnxruntime-web` 或异平台 native；Estimator 从传入 file URL 加载；缺 Runtime 时深度入口报告能力缺失；安装进度合并 Runtime 与现有模型字节数。

- [ ] **Step 2: 运行 RED**

Run: `node --test scripts/__tests__/prepare-depth-runtime-artifact.test.mjs`
Run: `pnpm --dir apps/desktop exec vitest run src/main/services/depth-video/DepthFrameEstimator.test.ts src/main/services/depth-video/DepthInferenceWorker.test.ts src/main/ipc/registerCanvasDepthTaskIpc.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 Runtime 包和加载**

Runtime 版本 `transformers-4.2.0-onnx-1.24.3-1`，按 `darwin-arm64`、`darwin-x64`、`win32-x64` 发布。基础包不再携带 `@huggingface/transformers`、`onnxruntime-node`、`onnxruntime-web` 及其仅深度使用的 native 闭包；workerData 同时传 `modelDir` 与 `runtimeEntryPath`。不得修改 Computer Use 文件或依赖。

- [ ] **Step 4: 运行 GREEN、真实一帧推理并提交**

从临时安装目录导入 Runtime，断言 `pipeline`、`RawImage`、ONNX 版本，并用固定 RGB fixture 完成一帧深度估计。

```bash
git add scripts apps/desktop/package.json apps/desktop/electron-builder.yml apps/desktop/src/main/services/depth-video apps/desktop/src/main/workers/depth-inference.worker.ts apps/desktop/src/main/ipc/registerCanvasDepthTaskIpc.ts
git commit -m "feat(depth): load inference runtime from optional package"
```

### Task 6: MinIO 上传、正式清单与公网回读

**Files:**
- Create: `scripts/publish-optional-capabilities-to-minio.mjs`
- Create: `scripts/__tests__/publish-optional-capabilities-to-minio.test.mjs`
- Create: `docs/release-manifests/office-viewer-2.2.3-1.json`
- Create: `docs/release-manifests/depth-runtime-*.json`
- Modify: `scripts/audit-artifact-repository.mjs`

- [ ] **Step 1: 写发布器失败测试**

覆盖本地 size/SHA 不符拒绝、已有 ID 冲突拒绝、先备份再上传、staging manifest 先于正式 index、正式发布后从公网完整下载并复算 SHA。测试使用本地 mock HTTP server，不访问真实 MinIO。

- [ ] **Step 2: 运行 RED/GREEN**

Run: `node --test scripts/__tests__/publish-optional-capabilities-to-minio.test.mjs`
Expected: 先因模块缺失 FAIL，最小实现后 PASS。

- [ ] **Step 3: 生成并本地审计制品**

凭据只以当前进程环境变量注入，禁止写入仓库、日志、测试快照和 shell 历史。生成 Office 与本机 `darwin-arm64` 深度 Runtime；其他平台没有可信 runner 产物时不得伪造，在 manifest 和设置状态中保持 unavailable。

- [ ] **Step 4: 上传、staging、正式发布和公网回读**

固定顺序：本地校验 → 备份 index → 上传版本化对象 → HEAD 元数据校验 → 公网 GET 全量 SHA → staging index → 审计 → 正式 index → 再次公网 GET。任何一步失败不得替换正式 index。

- [ ] **Step 5: 提交清单与发布工具**

```bash
git add scripts docs/release-manifests
git commit -m "release: publish optional Office and depth packages"
```

### Task 7: 最终产物、文档和回归门禁

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-optional-capability-packages-design.md`
- Modify: this plan status to `已落地`
- Create: `docs/reviews/2026-08-02-optional-capabilities-delivery.md`

- [ ] **Step 1: 定向测试和 typecheck**

运行 Task 1—6 所有测试、`pnpm --filter @spark/desktop typecheck`、`pnpm --filter @spark/protocol build` 和 `git diff --check`。全量测试若受并行开发影响，记录具体无关失败，不得声称全量通过。

- [ ] **Step 2: 构建干净 macOS arm64 unpacked 和 DMG**

安全移走并恢复 `apps/desktop/output`，不要删除其中用户技能链接。验证基础 ASAR 不含 `out/renderer/file-viewer`、Transformers、ONNX；验证 ASAR 可完整解包。

- [ ] **Step 3: 干净 userData 验收**

启动弹窗默认未勾选；Office/深度分别可后台安装；进度卡与设置状态一致；断网、取消、损坏修复、更新失败回滚不影响核心启动；Office 三种格式和深度一帧/短视频可用。

- [ ] **Step 4: 记录体积和公网证据**

记录基础 DMG、`.app`、`app.asar`、`app.asar.unpacked`、每个远程下载量与落盘量，并与 398,417,355 B 原始 DMG 对比。记录正式 manifest URL、artifact ID、size/SHA，不记录 MinIO 凭据。

- [ ] **Step 5: GitNexus/降级核对和提交**

若 GitNexus 健康，运行 impact/detect_changes；否则按项目规则用 `rg`、定向测试、真实产物和 `git diff`，在 review 中注明降级。刷新 spec/plan 状态和日期。

```bash
git add docs/superpowers docs/reviews
git commit -m "docs(desktop): record optional capability delivery"
```

## 自审结果

- 规格覆盖：启动选择、默认不勾选、后台进度、设置页手动安装/更新/修复/卸载/自动更新、Office、深度 Runtime、回滚、MinIO 和体积审计均有对应任务。
- 范围约束：所有定义和测试明确只允许 `office-viewer`、`local-depth`，Computer Use 完全排除。
- 文件大小：新逻辑进入独立目录；`SettingsView.tsx` 只组合新卡片，不继续堆积实现。
- 发布约束：当前机器只生成可信 `darwin-arm64` Runtime；跨平台制品必须由对应 runner 后续补齐。
