# 平台官方模型目录事件刷新实施计划

> 状态: 待开发 | 最后核对: 2026-07-24

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改任何服务端的前提下，让桌面客户端进入模型管理页、恢复可见或主动刷新时重新同步平台官方模型目录。

**Architecture:** 主进程新增带 singleflight 和 5 分钟成功缓存的轻量目录同步方法，只调用现有 `/api/user/models` 并归并本地 Provider 偏好。渲染进程把事件监听封装为独立 Hook，避免继续扩大超过 3000 行的 `ProvidersView.tsx`；首次进入与恢复可见使用节流刷新，用户点击刷新执行强制同步。

**Tech Stack:** TypeScript、Electron IPC、React 19、Vitest、SQLite Provider Profile

---

## 文件结构

- `packages/protocol/src/ipc/index.ts`：声明目录刷新请求与响应以及类型安全 IPC channel。
- `packages/agent-runtime/src/services/provider.service.ts`：新增只归并受管 Provider 模型目录的窄方法。
- `packages/agent-runtime/src/__tests__/services/provider.service.test.ts`：覆盖下线模型清理、默认模型迁移和空目录保护。
- `apps/desktop/src/main/services/PlatformModel/PlatformModelService.ts`：实现按用户 singleflight、成功时间节流和轻量目录同步。
- `apps/desktop/src/main/services/PlatformModel/PlatformModelService.test.ts`：覆盖节流、强制刷新和并发合并。
- `apps/desktop/src/main/services/PlatformModel/registerPlatformModelIpc.ts`：注册目录刷新 IPC。
- `apps/desktop/src/renderer/design/views/platform-model/usePlatformModelCatalogRefresh.ts`：封装首次进入、恢复可见和主动刷新的事件逻辑。
- `apps/desktop/src/renderer/design/views/platform-model/usePlatformModelCatalogRefresh.test.tsx`：验证事件与 IPC 调用顺序。
- `apps/desktop/src/renderer/design/views/ProvidersView.tsx`：只接入新 Hook，并把顶部按钮绑定为强制目录刷新。
- `docs/superpowers/specs/2026-07-24-platform-model-catalog-refresh-design.md` 与本计划：实施完成后更新状态。

### Task 1: Provider 目录偏好归并

**Files:**
- Modify: `packages/agent-runtime/src/__tests__/services/provider.service.test.ts`
- Modify: `packages/agent-runtime/src/services/provider.service.ts`

- [ ] **Step 1: 写目录刷新失败测试**

在现有受管 Provider 测试附近增加三个独立用例：

```ts
it('removes unavailable managed models while preserving valid preferences', async () => {
  await service.ensureManagedNewApiProvider({
    ownerUserId: '42',
    baseUrl: 'https://newapi.example',
    modelIds: ['glm-5', 'MiniMax-M3', 'retired-model'],
    apiKey: 'sk-platform-secret',
  })
  await service.updateManagedNewApiModelPreferences({
    modelIds: ['MiniMax-M3', 'retired-model'],
    defaultModel: 'MiniMax-M3',
  })

  const profile = await service.refreshManagedNewApiModels({
    ownerUserId: '42',
    modelIds: ['glm-5', 'MiniMax-M3', 'new-model'],
  })

  expect(profile.availableModelIds).toEqual(['glm-5', 'MiniMax-M3', 'new-model'])
  expect(profile.modelIds).toEqual(['MiniMax-M3'])
  expect(profile.defaultModel).toBe('MiniMax-M3')
})

it('selects a valid default when the managed default disappears', async () => {
  await service.ensureManagedNewApiProvider({
    ownerUserId: '42',
    baseUrl: 'https://newapi.example',
    modelIds: ['MiniMax-M3', 'retired-model'],
    apiKey: 'sk-platform-secret',
  })
  await service.updateManagedNewApiModelPreferences({
    modelIds: ['MiniMax-M3', 'retired-model'],
    defaultModel: 'retired-model',
  })

  const profile = await service.refreshManagedNewApiModels({
    ownerUserId: '42',
    modelIds: ['MiniMax-M3', 'new-model'],
  })

  expect(profile.modelIds).toEqual(['MiniMax-M3'])
  expect(profile.defaultModel).toBe('MiniMax-M3')
})

it('does not overwrite the managed provider with an empty catalog', async () => {
  await service.ensureManagedNewApiProvider({
    ownerUserId: '42',
    baseUrl: 'https://newapi.example',
    modelIds: ['MiniMax-M3'],
    apiKey: 'sk-platform-secret',
  })
  const before = repo.rows.get('spark-platform-newapi')?.config_json

  await expect(service.refreshManagedNewApiModels({
    ownerUserId: '42',
    modelIds: [],
  })).rejects.toThrow('当前没有可用模型')

  expect(repo.rows.get('spark-platform-newapi')?.config_json).toBe(before)
})
```

- [ ] **Step 2: 运行测试并确认因方法缺失失败**

Run: `bash scripts/sqlite-abi.sh node && pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/provider.service.test.ts; status=$?; bash scripts/sqlite-abi.sh electron; exit $status`

Expected: FAIL，错误包含 `refreshManagedNewApiModels is not a function` 或 TypeScript 运行时等价错误。

- [ ] **Step 3: 实现最小目录归并方法**

在 `ProviderService` 的受管 Provider 方法区新增：

```ts
async refreshManagedNewApiModels(params: {
  ownerUserId: string
  modelIds: string[]
}): Promise<ProviderProfile> {
  const row = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
  if (!row || !isManagedProviderRow(row)) throw new Error('平台官方 Provider 尚未就绪')
  const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
  if (config.managedOwnerUserId !== params.ownerUserId) throw new Error('平台官方 Provider 属于其他登录账号')

  const availableModelIds = [...new Set(params.modelIds.map(model => model.trim()).filter(Boolean))]
  if (availableModelIds.length === 0) throw new Error('平台账户当前没有可用模型')
  const preferredModelIds = config.modelIds.filter(model => availableModelIds.includes(model))
  const modelIds = preferredModelIds.length > 0 ? preferredModelIds : availableModelIds
  const defaultModel = modelIds.includes(config.defaultModel) ? config.defaultModel : modelIds[0]!

  this.repo.update(PLATFORM_NEWAPI_PROVIDER_ID, {
    config: normalizeProviderConfig({ ...config, availableModelIds, modelIds, defaultModel }),
  })
  const updated = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
  if (!updated) throw new Error('平台官方 Provider 更新后无法读取')
  return rowToProfile(updated)
}
```

- [ ] **Step 4: 运行 ProviderService 测试并确认通过**

Run: `bash scripts/sqlite-abi.sh node && pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/provider.service.test.ts; status=$?; bash scripts/sqlite-abi.sh electron; exit $status`

Expected: PASS，新增三个回归用例全部通过。

### Task 2: 主进程轻量同步、节流与 IPC

**Files:**
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `apps/desktop/src/main/services/PlatformModel/PlatformModelService.test.ts`
- Modify: `apps/desktop/src/main/services/PlatformModel/PlatformModelService.ts`
- Modify: `apps/desktop/src/main/services/PlatformModel/registerPlatformModelIpc.ts`

- [ ] **Step 1: 写主进程失败测试**

扩展 `@spark/agent-runtime` mock，增加 `refreshManagedNewApiModels`；用延迟 Promise 覆盖 singleflight，并断言：

```ts
it('singleflights concurrent platform catalog refreshes', async () => {
  seedReadyCredentials()
  const service = new PlatformModelService()
  const first = service.refreshModelCatalog(false)
  const second = service.refreshModelCatalog(false)
  expect(second).toBe(first)
  await expect(Promise.all([first, second])).resolves.toEqual([
    { models: ['gpt-5.4-mini'], refreshed: true },
    { models: ['gpt-5.4-mini'], refreshed: true },
  ])
  expect(mocks.getModels).toHaveBeenCalledTimes(1)
})

it('skips a recent automatic refresh but force refreshes', async () => {
  seedReadyCredentials()
  const service = new PlatformModelService()
  await service.refreshModelCatalog(false)
  await expect(service.refreshModelCatalog(false)).resolves.toMatchObject({ refreshed: false })
  await expect(service.refreshModelCatalog(true)).resolves.toMatchObject({ refreshed: true })
  expect(mocks.getModels).toHaveBeenCalledTimes(2)
})
```

同时断言同步成功调用 `refreshManagedNewApiModels({ ownerUserId, modelIds })` 并发出 Provider 更新事件。

- [ ] **Step 2: 运行测试并确认方法缺失失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/PlatformModel/PlatformModelService.test.ts`

Expected: FAIL，错误包含 `refreshModelCatalog is not a function`。

- [ ] **Step 3: 增加 IPC 类型**

在平台模型类型区声明：

```ts
export interface PlatformModelRefreshCatalogRequest {
  force?: boolean
}

export interface PlatformModelRefreshCatalogResponse {
  models: string[]
  refreshed: boolean
}
```

在 `IpcChannelMap` 增加：

```ts
'platform-model:refresh-catalog': [
  PlatformModelRefreshCatalogRequest,
  PlatformModelRefreshCatalogResponse,
]
```

- [ ] **Step 4: 实现轻量同步、成功节流和 singleflight**

在 `PlatformModelService` 增加每用户状态：

```ts
const PLATFORM_MODEL_CATALOG_REFRESH_INTERVAL_MS = 5 * 60 * 1000

private readonly catalogRefreshInflight = new Map<string, Promise<PlatformModelRefreshCatalogResponse>>()
private readonly lastCatalogRefreshAt = new Map<string, number>()
```

公开方法保持为非 `async` 方法，以便并发调用返回同一个 Promise 实例。它先返回同用户 in-flight Promise，再判断非强制刷新是否处于成功缓存期。真正刷新通过 `readyClient().getModels()` 获取目录，调用 `refreshManagedNewApiModels`，更新 `status.models`、成功时间并发出配置变化事件；失败不得写成功时间。`bootstrapInternal` 成功后记录成功时间，`logout` 清理对应用户的刷新状态。

- [ ] **Step 5: 注册 IPC 并运行主进程测试**

注册代码：

```ts
typedIpcHandle('platform-model:refresh-catalog', async (req) => (
  getPlatformModelService().refreshModelCatalog(req.force === true)
))
```

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/PlatformModel/PlatformModelService.test.ts`

Expected: PASS，节流、强制刷新、singleflight 和原有平台模型测试全部通过。

### Task 3: 模型管理页事件 Hook

**Files:**
- Create: `apps/desktop/src/renderer/design/views/platform-model/usePlatformModelCatalogRefresh.test.tsx`
- Create: `apps/desktop/src/renderer/design/views/platform-model/usePlatformModelCatalogRefresh.ts`
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.tsx`

- [ ] **Step 1: 写 Hook 失败测试**

用一个只调用 Hook 的 React 测试 Harness，mock `useIpcInvoke` 和 Toast。测试准备代码固定为：

```ts
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  reloadLocal: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: mocks.invoke }),
}))
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: { error: mocks.toastError } }),
}))

let manualRefresh: (() => void) | null = null
function Harness(): React.ReactElement | null {
  const result = usePlatformModelCatalogRefresh(mocks.reloadLocal)
  manualRefresh = result.refreshPlatformCatalog
  return null
}

it('refreshes the catalog on mount and reloads local providers', async () => {
  mocks.invoke.mockResolvedValue({ models: ['glm-5'], refreshed: true })
  await act(async () => { root.render(<Harness />) })
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith({ force: false }))
  expect(mocks.reloadLocal).toHaveBeenCalledOnce()
})

it('refreshes after the document becomes visible', async () => {
  mocks.invoke.mockResolvedValue({ models: ['glm-5'], refreshed: false })
  await act(async () => { root.render(<Harness />) })
  mocks.invoke.mockClear()
  mocks.reloadLocal.mockClear()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith({ force: false }))
  expect(mocks.reloadLocal).toHaveBeenCalledOnce()
})

it('force refreshes when the user clicks refresh', async () => {
  mocks.invoke.mockResolvedValue({ models: ['glm-5'], refreshed: true })
  await act(async () => { root.render(<Harness />) })
  mocks.invoke.mockClear()
  await act(async () => { manualRefresh?.() })
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith({ force: true }))
})

it('keeps local providers visible when automatic refresh fails', async () => {
  mocks.invoke.mockRejectedValue(new Error('offline'))
  await act(async () => { root.render(<Harness />) })
  await vi.waitFor(() => expect(mocks.reloadLocal).toHaveBeenCalledOnce())
  expect(mocks.toastError).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行测试并确认模块缺失失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/platform-model/usePlatformModelCatalogRefresh.test.tsx`

Expected: FAIL，错误包含无法解析 `usePlatformModelCatalogRefresh` 模块。

- [ ] **Step 3: 实现独立 Hook**

Hook 接口固定为：

```ts
export function usePlatformModelCatalogRefresh(
  reloadLocal: () => void,
): { refreshPlatformCatalog: () => void }
```

内部 `sync(force, notifyError)` 始终在 `finally` 调用 `reloadLocal()`；mount 调用 `sync(false, false)`，`visibilitychange` 只在 `document.visibilityState === 'visible'` 时调用自动同步，返回的 `refreshPlatformCatalog` 调用 `sync(true, true)`。仅用户主动刷新失败时显示 `平台模型目录刷新失败` Toast。

- [ ] **Step 4: 接入 ProvidersView**

保持现有 `refresh` 作为纯本地重载和配置事件回调，删除原来的首次 `useEffect(refresh)`，改为：

```ts
const { refreshPlatformCatalog } = usePlatformModelCatalogRefresh(refresh)
```

顶部刷新按钮绑定 `onClick={refreshPlatformCatalog}`；其余保存、删除、导入和配置变化事件仍调用本地 `refresh`。`ProvidersView.tsx` 只增加 import、Hook 调用和按钮绑定，事件实现全部留在新文件中。

- [ ] **Step 5: 运行 Hook 与现有 Provider UI 测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/platform-model/usePlatformModelCatalogRefresh.test.tsx src/renderer/design/views/ProvidersView.test.tsx`

Expected: PASS，Hook 新用例和现有 Provider 表单/卡片用例全部通过。

### Task 4: 完整验证、文档保鲜与变更核对

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-platform-model-catalog-refresh-design.md`
- Modify: `docs/superpowers/plans/2026-07-24-platform-model-catalog-refresh.md`

- [ ] **Step 1: 运行相关包类型检查**

Run: `pnpm --filter @spark/protocol typecheck && pnpm --filter @spark/agent-runtime typecheck && pnpm --filter @spark/desktop typecheck`

Expected: 三个命令均退出 0。

- [ ] **Step 2: 运行定向回归测试**

Run: `bash scripts/sqlite-abi.sh node && pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/provider.service.test.ts; runtime_status=$?; bash scripts/sqlite-abi.sh electron; test $runtime_status -eq 0 && pnpm --filter @spark/desktop exec vitest run src/main/services/PlatformModel/PlatformModelService.test.ts src/renderer/design/views/platform-model/usePlatformModelCatalogRefresh.test.tsx src/renderer/design/views/ProvidersView.test.tsx`

Expected: 所有定向测试通过且无未处理异常。

- [ ] **Step 3: 更新文档状态**

把设计文档和本计划的状态改为：

```md
> 状态: 已落地 | 最后核对: 2026-07-24
```

- [ ] **Step 4: 核对最终变更范围**

Run: `git diff --check && git diff --stat && git status --short`

Expected: 无空白错误；变更仅包含本计划列出的当前项目文件以及用户原有、未被本任务改动的工作区文件。该改动调用关系清晰，按项目 GitNexus 降级规则使用直接调用点检索、测试和 `git diff` 核对，不启动 GitNexus。
