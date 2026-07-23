# 多媒体接口超时统一实施计划

> 状态: 已落地 | 最后核对: 2026-07-24

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个媒体 Provider 配置的统一接口超时同时约束同步请求与异步任务链路，并兼容历史轮询超时配置。

**Architecture:** 协议层新增顶层 `mediaDefaults.timeoutMs`，运行时通过集中解析器实现新字段、旧字段和默认值的优先级。桌面 Adapter 与 `spark_media` MCP 分别接入同一语义；存储迁移复制历史值，配置页改为读写新字段并显示“接口超时 ms”。

**Tech Stack:** TypeScript、React、Zod、Vitest、SQLite JSON1、Node.js ESM

---

## 文件结构

- `packages/protocol/src/media-config.ts`：新增 Provider 统一接口超时类型与 schema。
- `packages/protocol/src/provider-presets.ts`：内置 Provider 默认超时改用顶层字段。
- `packages/agent-runtime/src/services/media/media-timeout.ts`：集中解析新字段、旧字段和 fallback。
- `packages/agent-runtime/src/services/media/media-http.util.ts`：轮询单次请求受剩余时限约束。
- `packages/agent-runtime/src/services/media/media-artifact.service.ts`：媒体 URL 下载支持统一超时。
- `packages/agent-runtime/src/services/media/adapters/*.ts`：所有专用和模板 Adapter 接入统一解析器。
- `packages/agent-runtime/src/tools/media-generation-mcp-server.mjs`：MCP 同步/异步路径使用统一超时。
- `apps/desktop/src/renderer/design/views/ProvidersView.tsx`：表单改为“接口超时”并读写新字段。
- `packages/storage/migrations/060_media_interface_timeout.sql`：复制历史 Provider 超时配置。
- 现有 protocol、storage、runtime、desktop 测试文件：增加回归覆盖。
- `docs/design/openai-google-multimedia-adapters.md` 与相关设计文档：刷新统一超时说明和状态日期。

### Task 1: 协议字段和兼容解析器

**Files:**
- Modify: `packages/protocol/src/media-config.ts`
- Modify: `packages/protocol/src/__tests__/schemas.test.ts`
- Create: `packages/agent-runtime/src/services/media/media-timeout.ts`
- Create: `packages/agent-runtime/src/__tests__/services/media/media-timeout.test.ts`

- [x] **Step 1: 为顶层接口超时写失败测试**

测试 `ProviderMediaDefaultsSchema` 接受 `timeoutMs: 6_000_000`，拒绝小于 `1_000` 或大于 `172_800_000`；测试解析器按新字段、旧字段、fallback 的顺序返回：

```ts
expect(resolveMediaInterfaceTimeoutMs({ timeoutMs: 6_000_000 }, 180_000)).toBe(6_000_000)
expect(resolveMediaInterfaceTimeoutMs({ polling: { timeoutMs: 600_000 } }, 180_000)).toBe(600_000)
expect(resolveMediaInterfaceTimeoutMs(undefined, 180_000)).toBe(180_000)
```

- [x] **Step 2: 运行定向测试并确认因字段/函数缺失失败**

Run: `pnpm --filter @spark/protocol exec vitest run src/__tests__/schemas.test.ts && pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-timeout.test.ts`

Expected: 新增断言因 schema 丢弃/拒绝 `timeoutMs` 或模块不存在而失败。

- [x] **Step 3: 实现最小协议和解析器**

```ts
export interface ProviderMediaDefaults {
  timeoutMs?: number | undefined
  // existing families...
}

export function configuredMediaInterfaceTimeoutMs(
  defaults: ProviderMediaDefaults | undefined,
): number | undefined {
  return validTimeout(defaults?.timeoutMs) ?? validTimeout(defaults?.polling?.timeoutMs)
}

export function resolveMediaInterfaceTimeoutMs(
  defaults: ProviderMediaDefaults | undefined,
  fallbackMs: number,
): number {
  return configuredMediaInterfaceTimeoutMs(defaults) ?? fallbackMs
}
```

- [x] **Step 4: 运行定向测试并确认通过**

Run: `pnpm --filter @spark/protocol exec vitest run src/__tests__/schemas.test.ts && pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-timeout.test.ts`

Expected: PASS。

### Task 2: Provider 配置页与数据迁移

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ProvidersView.test.tsx`
- Modify: `packages/protocol/src/provider-presets.ts`
- Modify: `packages/protocol/src/__tests__/provider-presets.test.ts`
- Create: `packages/storage/migrations/060_media_interface_timeout.sql`
- Modify: `packages/storage/src/database.test.ts`

- [x] **Step 1: 写配置页、预设和迁移失败测试**

覆盖以下行为：表单显示“接口超时 ms”；profile 优先回显 `mediaDefaults.timeoutMs`，旧 profile 回退 `polling.timeoutMs`；保存只写顶层 `timeoutMs`；迁移复制旧字段且不覆盖已有顶层值。

迁移断言：

```ts
expect(interfaceTimeout('legacy-provider')).toBe(600_000)
expect(interfaceTimeout('new-provider')).toBe(6_000_000)
expect(legacyPollingTimeout('legacy-provider')).toBe(600_000)
```

- [x] **Step 2: 运行测试并确认旧行为导致失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/ProvidersView.test.tsx && pnpm --filter @spark/protocol exec vitest run src/__tests__/provider-presets.test.ts && pnpm --filter @spark/storage exec vitest run src/database.test.ts`

Expected: UI 文案、保存字段和 migration 060 断言失败。

- [x] **Step 3: 实现配置页、新预设字段和 SQL 迁移**

表单构造遵守：

```ts
mediaTimeout: String(d?.timeoutMs ?? d?.polling?.timeoutMs ?? defaultTimeout)

const result: ProviderMediaDefaults = {
  ...(form.mediaTimeout.trim() ? { timeoutMs: Number(form.mediaTimeout) } : {}),
  ...(pollInterval ? { polling: { intervalMs: pollInterval } } : {}),
}
```

迁移只在旧值存在且新值不存在时复制：

```sql
UPDATE provider_profiles
SET config_json = json_set(
  config_json,
  '$.mediaDefaults.timeoutMs',
  CAST(json_extract(config_json, '$.mediaDefaults.polling.timeoutMs') AS INTEGER)
)
WHERE json_valid(config_json)
  AND json_type(config_json, '$.mediaDefaults.timeoutMs') IS NULL
  AND json_type(config_json, '$.mediaDefaults.polling.timeoutMs') IN ('integer', 'real');
```

- [x] **Step 4: 运行配置与迁移测试并确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/ProvidersView.test.tsx && pnpm --filter @spark/protocol exec vitest run src/__tests__/provider-presets.test.ts && pnpm --filter @spark/storage exec vitest run src/database.test.ts`

Expected: PASS。

### Task 3: HTTP 轮询和产物下载基础设施

**Files:**
- Modify: `packages/agent-runtime/src/services/media/media-http.util.ts`
- Modify: `packages/agent-runtime/src/services/media/media-artifact.service.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/media/media-http.util.test.ts`
- Create: `packages/agent-runtime/src/__tests__/services/media/media-artifact.service.test.ts`

- [x] **Step 1: 写轮询剩余时限与下载超时失败测试**

测试 `pollTask` 在配置单次请求超时后使用 `min(requestTimeoutMs, deadline - now)`，以及媒体 URL 下载超时后返回 `artifact_download_failed` 并包含实际毫秒数。

- [x] **Step 2: 运行测试并确认当前固定 30 秒/无下载 signal 导致失败**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-http.util.test.ts src/__tests__/services/media/media-artifact.service.test.ts`

Expected: 新行为断言失败。

- [x] **Step 3: 实现轮询请求预算和下载 AbortController**

```ts
const remainingMs = Math.max(1, deadline - Date.now())
const requestTimeoutMs = Math.min(opts.requestTimeoutMs ?? 30_000, remainingMs)
const data = await fetchJson(url, { ...fetchOpts, timeoutMs: requestTimeoutMs })
```

Artifact 方法新增可选 `timeoutMs`，下载时创建并清理 `AbortController`；未传时保持当前无额外超时行为。

- [x] **Step 4: 运行基础设施测试并确认通过**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-http.util.test.ts src/__tests__/services/media/media-artifact.service.test.ts`

Expected: PASS。

### Task 4: 桌面媒体 Adapter 全量接入

**Files:**
- Modify: `packages/agent-runtime/src/services/media/adapters/apimart-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/agnes-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/bailian-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/google-generative-ai-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/midjourney-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/openai-compatible-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/openai-official-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/template-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/tencent-tokenhub-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/volcengine-ark-media.adapter.ts`
- Modify: `packages/agent-runtime/src/services/media/adapters/xai-media.adapter.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/media/official-media-adapters.test.ts`

- [x] **Step 1: 写同步、异步和模板 Adapter 失败测试**

为 OpenAI 图片编辑、一个专用异步渠道和 Template Adapter 注入 `mediaDefaults: { timeoutMs: 6_000_000 }`，捕获 AbortSignal 或推进 fake timer，证明不再使用 60/120/180 秒固定值；另保留未配置时原默认值测试。

- [x] **Step 2: 运行定向 Adapter 测试并确认失败**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/official-media-adapters.test.ts src/__tests__/services/media/media-adapters.test.ts`

Expected: 配置值未传播到同步请求，测试失败。

- [x] **Step 3: 所有 Adapter 使用共享解析器**

同步、提交和下载采用：

```ts
const timeoutMs = resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, EXISTING_DEFAULT_MS)
// fetchJson(..., { timeoutMs })
// artifact.writeImage(..., ctx.fetch, timeoutMs)
```

异步轮询采用：

```ts
const configuredTimeoutMs = configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults)
const timeoutMs = configuredTimeoutMs ?? manifestTimeoutMs ?? EXISTING_DEFAULT_MS
await pollTask(url, headers, {
  timeoutMs,
  ...(configuredTimeoutMs ? { requestTimeoutMs: configuredTimeoutMs } : {}),
  // existing inspect/error contract
})
```

- [x] **Step 4: 运行完整媒体 Adapter 测试并确认通过**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/services/media/media-adapters.test.ts src/__tests__/services/media/official-media-adapters.test.ts src/__tests__/services/media/media-http.util.test.ts`

Expected: PASS。

### Task 5: spark_media MCP 链路统一

**Files:**
- Modify: `packages/agent-runtime/src/tools/media-generation-mcp-server.mjs`
- Modify: `packages/agent-runtime/src/__tests__/tools/media-generation-mcp-server.test.ts`

- [x] **Step 1: 写 MCP 同步和异步失败测试**

设置 `SPARK_MEDIA_DEFAULTS_JSON={"timeoutMs":6000000,"polling":{"intervalMs":1}}`，分别断言同步图片请求与异步轮询使用新值；另用旧 `polling.timeoutMs` 验证兼容。

- [x] **Step 2: 运行 MCP 测试并确认固定超时导致失败**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/tools/media-generation-mcp-server.test.ts`

Expected: 同步请求仍使用固定值，新断言失败。

- [x] **Step 3: 实现 MCP 统一解析和调用点替换**

```js
function configuredInterfaceTimeoutMs(config) {
  return validTimeout(config.mediaDefaults?.timeoutMs) ||
    validTimeout(config.mediaDefaults?.polling?.timeoutMs)
}

function interfaceTimeoutMs(config, fallbackMs) {
  return configuredInterfaceTimeoutMs(config) || fallbackMs
}
```

所有 provider 请求、轮询和下载用上述解析结果；轮询单次请求按剩余总时限取较小值。

- [x] **Step 4: 运行 MCP 测试并确认通过**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/__tests__/tools/media-generation-mcp-server.test.ts`

Expected: PASS。

### Task 6: 文档、审查、验证和提交

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-media-interface-timeout-unification-design.md`
- Modify: `docs/superpowers/plans/2026-07-24-media-interface-timeout-unification.md`
- Modify: `docs/design/openai-google-multimedia-adapters.md`
- Modify: `.agents/memory/multimedia-model-channel-configuration.md`

- [x] **Step 1: 更新文档状态和运行时说明**

将设计和计划状态改为“已落地”，刷新 `2026-07-24`；记录顶层 `timeoutMs`、旧字段回退及同步/异步统一语义。

- [x] **Step 2: 运行格式、类型和相关测试验证**

Run:

```bash
pnpm exec prettier --check packages/protocol/src/media-config.ts packages/protocol/src/provider-presets.ts packages/agent-runtime/src/services/media/media-timeout.ts packages/agent-runtime/src/services/media/media-http.util.ts packages/agent-runtime/src/services/media/media-artifact.service.ts packages/agent-runtime/src/services/media/adapters packages/agent-runtime/src/tools/media-generation-mcp-server.mjs apps/desktop/src/renderer/design/views/ProvidersView.tsx docs/superpowers/specs/2026-07-24-media-interface-timeout-unification-design.md docs/superpowers/plans/2026-07-24-media-interface-timeout-unification.md docs/design/openai-google-multimedia-adapters.md .agents/memory/multimedia-model-channel-configuration.md
pnpm --filter @spark/protocol typecheck
pnpm --filter @spark/storage test:unit
pnpm --filter @spark/agent-runtime typecheck
pnpm --filter @spark/agent-runtime test:unit
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/ProvidersView.test.tsx
pnpm --filter @spark/desktop verify:migrations
```

Expected: 全部 exit 0。

- [x] **Step 3: 做五轴代码审查并修复所有必改项**

按 correctness、readability、architecture、security、performance 检查 `git diff`，重点核对未遗漏硬编码超时、非法配置回退、轮询总时限、旧字段兼容及用户工作区修改隔离；修复后重新运行受影响测试。

- [x] **Step 4: 更新 GitNexus 并核对变更范围**

Run: `npx gitnexus analyze`

Expected: 索引成功更新。若不可用，记录降级原因，并使用 `rg` 调用点检索、完整相关测试和 `git diff --check` 核对。

- [x] **Step 5: 仅暂存本任务文件并创建本地提交**

```bash
git add packages/protocol/src/media-config.ts packages/protocol/src/provider-presets.ts packages/protocol/src/__tests__/schemas.test.ts packages/protocol/src/__tests__/provider-presets.test.ts packages/agent-runtime/src/services/media/media-timeout.ts packages/agent-runtime/src/services/media/media-http.util.ts packages/agent-runtime/src/services/media/media-artifact.service.ts packages/agent-runtime/src/services/media/adapters packages/agent-runtime/src/tools/media-generation-mcp-server.mjs packages/agent-runtime/src/__tests__/services/media/media-timeout.test.ts packages/agent-runtime/src/__tests__/services/media/media-http.util.test.ts packages/agent-runtime/src/__tests__/services/media/media-artifact.service.test.ts packages/agent-runtime/src/__tests__/services/media/media-adapters.test.ts packages/agent-runtime/src/__tests__/services/media/official-media-adapters.test.ts packages/agent-runtime/src/__tests__/tools/media-generation-mcp-server.test.ts apps/desktop/src/renderer/design/views/ProvidersView.tsx apps/desktop/src/renderer/design/views/ProvidersView.test.tsx packages/storage/migrations/060_media_interface_timeout.sql packages/storage/src/database.test.ts docs/superpowers/specs/2026-07-24-media-interface-timeout-unification-design.md docs/superpowers/plans/2026-07-24-media-interface-timeout-unification.md docs/design/openai-google-multimedia-adapters.md .agents/memory/multimedia-model-channel-configuration.md
git diff --cached --check
git commit -m "feat(media): unify provider interface timeouts"
```

Expected: 提交成功；不运行 `git push`。
