# 画布模型切换参数兼容性实施计划

> 状态: 实施中 | 最后核对: 2026-07-16

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模型切换或历史节点回显时，保留新模型兼容的参数值，并把不兼容值回退到新模型默认值。

**Architecture:** 使用 JSON Schema 提供的枚举、自定义值标记和正则格式约束进行通用兼容性判断。纯函数集中在参数草稿状态模块，创建器、任务面板和预设面板共享该逻辑；Seedream 的尺寸格式由 manifest 声明，不在 UI 中写死模型名称。

**Tech Stack:** TypeScript、React、JSON Schema、Vitest、pnpm workspace

---

### Task 1: 参数兼容性纯函数

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasModelParamDraftState.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasModelParamDraftState.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasParameterPresentation.ts`

- [ ] **Step 1: 编写失败测试**

创建纯函数测试，明确非法值回退、合法自定义尺寸保留、枚举值保留和缺少格式约束时保持宽松行为：

```ts
import { describe, expect, it } from 'vitest'
import {
  isModelParamDraftValueCompatible,
  mergeSeededModelParamDraft,
} from './canvasModelParamDraftState'

const sizeField = {
  name: 'size',
  title: '画幅',
  type: 'string',
  enumValues: ['2K', '4K'],
  allowCustom: true,
  pattern: '^\\d+\\s*[xX]\\s*\\d+$',
}

describe('model parameter compatibility', () => {
  it('falls back to the new model default when the old custom value is invalid', () => {
    expect(
      mergeSeededModelParamDraft({ size: '2:1' }, { size: '2K' }, [sizeField]),
    ).toEqual({ size: '2K' })
  })

  it('keeps a valid custom width-by-height value', () => {
    expect(
      mergeSeededModelParamDraft({ size: '2848x1600' }, { size: '2K' }, [sizeField]),
    ).toEqual({ size: '2848x1600' })
  })

  it('keeps an explicitly supported enum value', () => {
    expect(isModelParamDraftValueCompatible(sizeField, '4K')).toBe(true)
  })

  it('keeps custom values when the schema has no format constraint', () => {
    expect(
      isModelParamDraftValueCompatible({ ...sizeField, pattern: undefined }, 'provider-private'),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasModelParamDraftState.test.ts
```

Expected: FAIL，因为新兼容性函数和带字段约束的合并签名尚未实现。

- [ ] **Step 3: 实现最小兼容性逻辑**

给 `SchemaField` 增加可选的 `pattern?: string`，并在草稿状态模块实现：

```ts
export function isModelParamDraftValueCompatible(
  field: Pick<SchemaField, 'enumValues' | 'allowCustom' | 'pattern'>,
  value: string,
): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (field.enumValues.includes(trimmed)) return true
  if (!field.allowCustom) return field.enumValues.length === 0
  if (!field.pattern) return true
  try {
    return new RegExp(field.pattern).test(trimmed)
  } catch {
    return true
  }
}
```

将 `mergeSeededModelParamDraft` 改为只输出新模型字段，并仅保留兼容的旧值：

```ts
export function mergeSeededModelParamDraft(
  currentDraft: Record<string, string>,
  seededDraft: Record<string, string>,
  fields: readonly SchemaField[],
): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const currentValue = currentDraft[field.name]
      return [
        field.name,
        currentValue && isModelParamDraftValueCompatible(field, currentValue)
          ? currentValue
          : (seededDraft[field.name] ?? ''),
      ]
    }),
  )
}
```

- [ ] **Step 4: 运行纯函数测试并确认通过**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasModelParamDraftState.test.ts
```

Expected: PASS。

### Task 2: Schema 约束传递与历史参数初始化

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx`

- [ ] **Step 1: 编写失败测试**

增加两个测试：schema 字段保留 `pattern`，历史节点中的非法 `size=2:1` 不覆盖默认值：

```ts
it('preserves JSON Schema patterns for custom value validation', () => {
  expect(
    schemaFields({
      properties: {
        size: {
          type: 'string',
          enum: ['2K', '4K'],
          'x-allow-custom': true,
          pattern: '^\\d+x\\d+$',
        },
      },
    })[0],
  ).toMatchObject({ allowCustom: true, pattern: '^\\d+x\\d+$' })
})

it('falls back to the model default when a persisted value is incompatible', () => {
  expect(
    resolveInitialModelParamDraftValue({
      operation: 'image_edit',
      field: {
        ...field('size'),
        enumValues: ['2K', '4K'],
        allowCustom: true,
        pattern: '^\\d+x\\d+$',
      },
      fieldName: 'size',
      presetParams: {},
      existingParams: { size: '2:1' },
      defaultParams: { size: '2K' },
    }),
  ).toBe('2K')
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts
```

Expected: FAIL，当前 `schemaFields` 丢弃 `pattern`，初始值解析无条件接受历史值。

- [ ] **Step 3: 实现 schema 提取和初始值校验**

`schemaFields` 读取字符串类型的 `pattern`：

```ts
const pattern = typeof spec.pattern === 'string' ? spec.pattern : undefined
return {
  name,
  title: typeof spec.title === 'string' ? spec.title : name,
  type,
  enumValues,
  ...(allowCustom ? { allowCustom: true } : {}),
  ...(pattern ? { pattern } : {}),
}
```

`resolveInitialModelParamDraftValue` 在接受 existing、preset 或 default 候选值前调用 `isModelParamDraftValueCompatible`；全景图映射逻辑保持原优先级，但不能返回新字段不接受的值。

- [ ] **Step 4: 运行创建器测试并确认通过**

Run:

```powershell
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts
```

Expected: PASS。

### Task 3: 接入模型切换面板与 Seedream manifest

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPresetModal.tsx`
- Modify: `packages/protocol/src/media-model-manifest.ts`
- Modify: `packages/protocol/src/__tests__/schemas.test.ts`

- [ ] **Step 1: 编写 Seedream schema 失败测试**

在协议测试中断言 Seedream 4.0、4.5、5.0 和 5.0 lite 的 `size` 支持自定义值且声明 `宽x高` 格式：

```ts
for (const modelId of [
  'doubao-seedream-4-0-250828',
  'doubao-seedream-4-5-251128',
  'doubao-seedream-5-0-260128',
  'doubao-seedream-5-0-lite-260128',
]) {
  const manifest = findM(modelId)!
  const size = manifest.capabilities[0]?.paramSchema.properties?.size
  expect(size?.['x-allow-custom']).toBe(true)
  expect(size?.pattern).toBe('^\\d+\\s*[xX]\\s*\\d+$')
}
```

- [ ] **Step 2: 运行协议测试并确认失败**

Run:

```powershell
pnpm --filter @spark/protocol test -- src/__tests__/schemas.test.ts
```

Expected: FAIL，因为 Seedream 尺寸 schema 尚未声明 `pattern`。

- [ ] **Step 3: 添加 manifest 格式约束并接入面板**

为四个 Seedream `size` 字段增加：

```ts
pattern: '^\\d+\\s*[xX]\\s*\\d+$',
```

任务面板和预设面板调用草稿合并时传入当前参数字段：

```ts
mergeSeededModelParamDraft(prev, next, parameterFields)
```

- [ ] **Step 4: 运行相关测试**

Run:

```powershell
pnpm --filter @spark/protocol test -- src/__tests__/schemas.test.ts
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasModelParamDraftState.test.ts src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts src/renderer/design/views/canvas/CanvasOperationPanel.test.ts
```

Expected: PASS。

### Task 4: 完整验证与文档收尾

**Files:**

- Modify: `docs/superpowers/specs/2026-07-16-canvas-model-param-compatibility.md`
- Modify: `docs/superpowers/plans/2026-07-16-canvas-model-param-compatibility.md`

- [ ] **Step 1: 运行类型检查**

Run:

```powershell
pnpm --filter @spark/protocol typecheck
pnpm --filter @spark/desktop typecheck
```

Expected: PASS。

- [ ] **Step 2: 运行格式与变更范围检查**

Run:

```powershell
git diff --check
git diff --stat
git status --short
```

Expected: 无空白错误，变更只包含参数兼容性、Seedream schema、相关测试和本任务文档。

- [ ] **Step 3: 更新文档状态**

把设计文档和实施计划的状态更新为：

```markdown
> 状态: 已落地 | 最后核对: 2026-07-16
```

- [ ] **Step 4: 提交实现**

```powershell
git add -- apps/desktop/src/renderer/design/views/canvas/canvasModelParamDraftState.ts apps/desktop/src/renderer/design/views/canvas/canvasModelParamDraftState.test.ts apps/desktop/src/renderer/design/views/canvas/canvasParameterPresentation.ts apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasOperationPanel.tsx apps/desktop/src/renderer/design/views/canvas/CanvasOperationPresetModal.tsx packages/protocol/src/media-model-manifest.ts packages/protocol/src/__tests__/schemas.test.ts docs/superpowers/specs/2026-07-16-canvas-model-param-compatibility.md docs/superpowers/plans/2026-07-16-canvas-model-param-compatibility.md
git commit -m "fix(canvas): reset incompatible params on model switch"
```
