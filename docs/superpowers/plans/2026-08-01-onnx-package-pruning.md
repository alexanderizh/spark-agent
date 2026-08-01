# ONNX 安装包精准裁剪 Implementation Plan

> 状态: 实施中 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从桌面安装包移除未使用的 `onnxruntime-web`，并只保留目标平台和架构的 `onnxruntime-node` Native 二进制。

**Architecture:** electron-builder 的 `files` 过滤器负责阻止 Web Runtime 进入 ASAR；独立的 CommonJS 构建钩子在 `afterPack` 阶段裁剪 `app.asar.unpacked` 中的异平台 ONNX 目录。产物验证脚本独立检查最终 `.app` 或 Windows unpacked 目录，确保配置错误不会静默回归。

**Tech Stack:** Electron Builder 26、Node.js CommonJS 构建钩子、Vitest、pnpm、macOS/Windows packaged artifact inspection。

---

## 文件结构

- Create: `apps/desktop/scripts/prune-onnx-runtime.js` — 目标平台映射、目录裁剪和裁剪结果。
- Create: `apps/desktop/scripts/verify-packaged-onnx-runtime.js` — 对最终 unpacked 应用执行独立产物门禁。
- Modify: `apps/desktop/scripts/after-pack.js` — 在签名和 fuses 处理前调用 ONNX 裁剪器。
- Modify: `apps/desktop/electron-builder.yml` — 排除完整 `onnxruntime-web` 生产依赖目录。
- Modify: `apps/desktop/package.json` — 增加可重复执行的产物验证命令。
- Modify: `apps/desktop/src/main/services/__tests__/after-pack.test.ts` — 构建钩子单元测试。
- Create: `apps/desktop/src/main/services/__tests__/verify-packaged-onnx-runtime.test.ts` — 独立门禁测试。
- Modify: `docs/superpowers/specs/2026-08-01-optional-capability-packages-design.md` — 启动实施时刷新状态。

### Task 1: 定义目标平台 ONNX 裁剪行为

**Files:**
- Create: `apps/desktop/scripts/prune-onnx-runtime.js`
- Modify: `apps/desktop/src/main/services/__tests__/after-pack.test.ts`

- [ ] **Step 1: 写失败测试，证明只保留目标平台和架构**

在 `after-pack.test.ts` 引入尚不存在的 `prunePackagedOnnxRuntime`，创建下列目录：

```ts
for (const relative of [
  'darwin/arm64/onnxruntime_binding.node',
  'darwin/x64/onnxruntime_binding.node',
  'linux/arm64/onnxruntime_binding.node',
  'linux/x64/onnxruntime_binding.node',
  'win32/x64/onnxruntime_binding.node',
]) {
  const file = join(
    root,
    'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6',
    relative,
  )
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, relative)
}

const result = await prunePackagedOnnxRuntime(root, 'darwin', 'arm64')

expect(result.kept).toEqual(['darwin/arm64'])
expect(result.removed.sort()).toEqual(['darwin/x64', 'linux', 'win32'])
expect(existsSync(join(root, 'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64'))).toBe(true)
expect(existsSync(join(root, 'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/linux'))).toBe(false)
expect(existsSync(join(root, 'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/win32'))).toBe(false)
```

- [ ] **Step 2: 运行测试并确认因导出不存在而失败**

Run: `pnpm --filter @spark/desktop test:unit -- src/main/services/__tests__/after-pack.test.ts`

Expected: FAIL，错误指向 `prunePackagedOnnxRuntime` 未定义或模块不存在。

- [ ] **Step 3: 实现最小裁剪器**

`prune-onnx-runtime.js` 导出以下 API：

```js
const fs = require('fs/promises')
const path = require('path')

async function prunePackagedOnnxRuntime(appResourcesPath, platform, arch) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`Unsupported ONNX target platform: ${platform}`)
  }
  if (!['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported ONNX target architecture: ${arch}`)
  }
  const napiRoot = path.join(
    appResourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
  )
  const platformEntries = await fs.readdir(napiRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const removed = []
  for (const entry of platformEntries) {
    if (!entry.isDirectory()) continue
    const platformPath = path.join(napiRoot, entry.name)
    if (entry.name !== platform) {
      await fs.rm(platformPath, { recursive: true, force: true })
      removed.push(entry.name)
      continue
    }
    for (const archEntry of await fs.readdir(platformPath, { withFileTypes: true })) {
      if (!archEntry.isDirectory() || archEntry.name === arch) continue
      await fs.rm(path.join(platformPath, archEntry.name), { recursive: true, force: true })
      removed.push(`${platform}/${archEntry.name}`)
    }
  }
  const targetPath = path.join(napiRoot, platform, arch)
  const targetFiles = await fs.readdir(targetPath).catch(() => [])
  if (platformEntries.length > 0 && targetFiles.length === 0) {
    throw new Error(`Packaged ONNX runtime is missing target ${platform}/${arch}`)
  }
  return { kept: targetFiles.length > 0 ? [`${platform}/${arch}`] : [], removed }
}

module.exports = { prunePackagedOnnxRuntime }
```

测试 fixture 传入的根目录应对应 `Resources`，与实际产物目录结构一致。

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @spark/desktop test:unit -- src/main/services/__tests__/after-pack.test.ts`

Expected: PASS，现有 locale、fuses、签名和 Native Host 测试仍全部通过。

- [ ] **Step 5: 提交裁剪器和测试**

```bash
git add apps/desktop/scripts/prune-onnx-runtime.js apps/desktop/src/main/services/__tests__/after-pack.test.ts
git commit -m "test(desktop): define packaged ONNX pruning"
```

### Task 2: 接入 afterPack 并排除 Web Runtime

**Files:**
- Modify: `apps/desktop/scripts/after-pack.js`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/src/main/services/__tests__/after-pack.test.ts`

- [ ] **Step 1: 写失败测试，约束目标路径解析和 Web Runtime 排除规则**

在 `after-pack.test.ts` 增加静态配置断言和钩子依赖注入测试：

```ts
it('excludes the unused ONNX web runtime from production packaging', () => {
  const config = readFileSync(new URL('../../../../electron-builder.yml', import.meta.url), 'utf8')
  expect(config).toContain("'!**/node_modules/onnxruntime-web/**'")
})

it('resolves the packaged resources path and target architecture', async () => {
  const result = await pruneOnnxForContext(
    {
      electronPlatformName: 'darwin',
      arch: Arch.arm64,
      appOutDir: '/tmp/spark-pack',
      packager: {
        appInfo: { productFilename: 'Spark Agent' },
        platformSpecificBuildOptions: {},
      },
    },
    {
      prunePackagedOnnxRuntime: async (_resources, platform, arch) => {
        expect(platform).toBe('darwin')
        expect(arch).toBe('arm64')
        return { kept: ['darwin/arm64'], removed: ['linux', 'win32'] }
      },
    },
  )
  expect(result.kept).toEqual(['darwin/arm64'])
})
```

新增独立的 `pruneOnnxForContext(context, dependencies)`；现有 Computer Use、Native Host、Node
签名和 fuses 分支不重构，只在原 `afterPack` 中插入 ONNX helper 调用。

- [ ] **Step 2: 运行测试并确认失败原因正确**

Run: `pnpm --filter @spark/desktop test:unit -- src/main/services/__tests__/after-pack.test.ts`

Expected: FAIL，配置中尚无排除规则，`pruneOnnxForContext` 尚未导出。

- [ ] **Step 3: 加入生产配置和 afterPack 调用**

在 `electron-builder.yml` 的 `files` 排除项中加入：

```yaml
  # 深度推理只在 Node worker 中运行，Transformers 的 Web Runtime 不进入桌面产物。
  - '!**/node_modules/onnxruntime-web/**'
```

在 `after-pack.js` 中计算资源目录并调用裁剪器：

```js
const { prunePackagedOnnxRuntime } = require('./prune-onnx-runtime.js')

function resourcesPath(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    )
  }
  return path.join(context.appOutDir, 'resources')
}

async function pruneOnnxForContext(
  context,
  dependencies = { prunePackagedOnnxRuntime },
) {
  return dependencies.prunePackagedOnnxRuntime(
    resourcesPath(context),
    context.electronPlatformName,
    targetArchitecture(context.arch),
  )
}
```

`targetArchitecture` 从 `package-standalone-node.js` 导出复用，不复制另一份 Arch 数字映射。

- [ ] **Step 4: 运行钩子测试和桌面 Node typecheck**

Run: `pnpm --filter @spark/desktop test:unit -- src/main/services/__tests__/after-pack.test.ts`

Expected: PASS。

Run: `pnpm --filter @spark/desktop typecheck`

Expected: PASS。

- [ ] **Step 5: 提交构建接线**

```bash
git add apps/desktop/scripts/after-pack.js apps/desktop/electron-builder.yml apps/desktop/src/main/services/__tests__/after-pack.test.ts
git commit -m "fix(desktop): prune unused ONNX runtimes"
```

### Task 3: 建立独立的最终产物门禁

**Files:**
- Create: `apps/desktop/scripts/verify-packaged-onnx-runtime.js`
- Create: `apps/desktop/src/main/services/__tests__/verify-packaged-onnx-runtime.test.ts`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: 写失败测试，覆盖成功和异平台残留**

测试创建临时 `Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6`，并断言：

```ts
expect(
  await verifyPackagedOnnxRuntime({ resourcesPath, platform: 'darwin', arch: 'arm64' }),
).toMatchObject({ target: 'darwin/arm64', foreignEntries: [] })

await expect(
  verifyPackagedOnnxRuntime({ resourcesPath: badResourcesPath, platform: 'darwin', arch: 'arm64' }),
).rejects.toThrow('foreign ONNX runtime entries: linux/x64')
```

fixture 同时创建 `app.asar` 文本清单替身，通过注入的 `listAsarFiles` 返回
`node_modules/onnxruntime-web/dist/ort.js`，断言门禁以 `onnxruntime-web` 错误失败。

- [ ] **Step 2: 运行新测试并确认模块不存在**

Run: `pnpm --filter @spark/desktop test:unit -- src/main/services/__tests__/verify-packaged-onnx-runtime.test.ts`

Expected: FAIL，`verify-packaged-onnx-runtime.js` 不存在。

- [ ] **Step 3: 实现产物验证器和 CLI**

导出：

```js
const fs = require('fs/promises')
const path = require('path')

async function collectNativeEntries(resourcesPath) {
  const napiRoot = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
  )
  const entries = []
  for (const platformEntry of await fs.readdir(napiRoot, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) continue
    const platformPath = path.join(napiRoot, platformEntry.name)
    for (const archEntry of await fs.readdir(platformPath, { withFileTypes: true })) {
      if (archEntry.isDirectory()) entries.push(`${platformEntry.name}/${archEntry.name}`)
    }
  }
  return entries.sort()
}

async function verifyPackagedOnnxRuntime({ resourcesPath, platform, arch, listAsarFiles }) {
  const entries = await collectNativeEntries(resourcesPath)
  const target = `${platform}/${arch}`
  const foreignEntries = entries.filter((entry) => entry !== target)
  if (foreignEntries.length > 0) {
    throw new Error(`foreign ONNX runtime entries: ${foreignEntries.join(', ')}`)
  }
  if (!entries.includes(target)) throw new Error(`missing ONNX runtime entry: ${target}`)
  const asarFiles = await listAsarFiles(join(resourcesPath, 'app.asar'))
  if (asarFiles.some((file) => file.includes('/node_modules/onnxruntime-web/'))) {
    throw new Error('onnxruntime-web is present in app.asar')
  }
  return { target, foreignEntries, webRuntimePresent: false }
}

module.exports = { collectNativeEntries, verifyPackagedOnnxRuntime }
```

CLI 参数为 `--resources <path> --platform <darwin|linux|win32> --arch <arm64|x64>`，默认使用
`@electron/asar` 的 `listPackage()`。错误时输出一行安全错误并以非零状态退出。

- [ ] **Step 4: 增加 package script 并运行测试**

在 `apps/desktop/package.json` 加入：

```json
"verify:packaged:onnx": "node scripts/verify-packaged-onnx-runtime.js"
```

Run: `pnpm --filter @spark/desktop test:unit -- src/main/services/__tests__/verify-packaged-onnx-runtime.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交独立门禁**

```bash
git add apps/desktop/scripts/verify-packaged-onnx-runtime.js apps/desktop/src/main/services/__tests__/verify-packaged-onnx-runtime.test.ts apps/desktop/package.json
git commit -m "test(desktop): verify packaged ONNX runtime scope"
```

### Task 4: 构建真实安装目录并记录体积回落

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-optional-capability-packages-design.md`
- Create: `docs/reviews/2026-08-01-onnx-package-pruning-review.md`

- [ ] **Step 1: 确认原生模块 ABI 和当前工作区状态**

Run: `pnpm --filter @spark/desktop native:verify`

Expected: PASS；若失败，先运行项目既有 `pnpm --filter @spark/desktop rebuild:native`，不得修改深度 IPC 用户改动。

- [ ] **Step 2: 构建当前平台 unpacked 产物**

Run: `pnpm --filter @spark/desktop build:unpack`

Expected: electron-vite build 和 electron-builder `--dir` 成功，afterPack 日志显示仅保留当前
`platform/arch`。

- [ ] **Step 3: 对真实产物执行门禁**

macOS arm64 示例：

```bash
pnpm --filter @spark/desktop verify:packaged:onnx -- \
  --resources "dist/mac-arm64/Spark Agent.app/Contents/Resources" \
  --platform darwin \
  --arch arm64
```

Expected: PASS，并报告 `target=darwin/arm64`、`foreignEntries=0`、`webRuntimePresent=false`。

- [ ] **Step 4: 记录前后体积和文件列表**

Run:

```bash
du -sh "apps/desktop/dist/mac-arm64/Spark Agent.app/Contents/Resources/app.asar" \
  "apps/desktop/dist/mac-arm64/Spark Agent.app/Contents/Resources/app.asar.unpacked"
find "apps/desktop/dist/mac-arm64/Spark Agent.app/Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6" \
  -type f -print
```

Expected: 文件列表只含 `darwin/arm64`；review 文档记录与修复前 `app.asar 392 MiB`、
`app.asar.unpacked 375 MiB` 和 DMG `397.6 MB` 的可比数据。若本轮只构建 unpacked，不虚构 DMG
结果，明确标记 DMG 待 release 构建验证。

- [ ] **Step 5: 更新文档状态并提交验证记录**

把设计文档状态改为“实施中”并刷新日期。review 文档位于 `docs/reviews/`，记录命令、退出码、
目标平台、保留/删除内容和体积数据。

```bash
git add docs/superpowers/specs/2026-08-01-optional-capability-packages-design.md docs/reviews/2026-08-01-onnx-package-pruning-review.md
git commit -m "docs(desktop): record ONNX package pruning"
```

### Task 5: 交付前回归与变更范围核对

**Files:**
- Verify only; do not modify unrelated user files.

- [ ] **Step 1: 运行定向单测**

Run:

```bash
pnpm --filter @spark/desktop test:unit -- \
  src/main/services/__tests__/after-pack.test.ts \
  src/main/services/__tests__/verify-packaged-onnx-runtime.test.ts \
  src/main/services/depth-video/DepthFrameEstimator.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行桌面类型检查**

Run: `pnpm --filter @spark/desktop typecheck`

Expected: PASS。

- [ ] **Step 3: 核对差异不包含用户工作区改动**

Run: `git status --short && git diff --stat HEAD~4..HEAD && git diff --check HEAD~4..HEAD`

Expected: 本计划提交只涉及列出的构建脚本、配置、测试和文档；
`registerCanvasDepthTaskIpc.ts`、其测试及既有未跟踪计划不进入提交。

- [ ] **Step 4: GitNexus 降级核对**

若 GitNexus MCP 健康可用，对 `afterPack` 做 upstream impact 并在提交前运行 detect changes；若未
暴露或索引不可信，按项目规则使用 `rg -n "afterPack|pruneOnnxForContext|prunePackagedOnnxRuntime"`、定向
测试和 `git diff` 完成核对，并在交付说明中注明降级。

- [ ] **Step 5: 标记第一阶段完成**

确认真实产物门禁和所有回归均通过后，更新 review 的最终结论；不要把整个可选能力包设计标记为
“已落地”，因为通用下载管理器、Office、Computer Use 和深度 Runtime 远程化仍未实施。
