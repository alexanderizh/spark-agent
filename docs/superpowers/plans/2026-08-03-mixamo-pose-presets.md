# Mixamo 内置姿势预设 Implementation Plan

> 状态: 实施中 | 最后核对: 2026-08-03

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为默认 Mixamo 素体提供独立的内置姿势偏移，且绝不修改 FBX 原始绑定姿态或网格。

**Architecture:** 新增一个只描述 Mixamo 骨骼局部旋转增量的预设库。`MixamoActorRig` 先恢复每根骨骼的原始旋转，再叠加所选 Mixamo 预设与用户手动关节覆盖；UE4 继续读取现有通用预设，不共享 Mixamo 的骨骼数据。

**Tech Stack:** React、Three.js、Vitest、TypeScript。

---

### Task 1: 定义 Mixamo 专用预设数据

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/stage3d/mixamoPosePresets.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/stage3d/stage3d.test.ts`

- [ ] **Step 1: 写出失败测试**

验证 `stand`、`walk`、`sit` 的 Mixamo 预设存在，并且每个预设只返回骨骼局部旋转增量，不返回位置或缩放：

```ts
expect(getMixamoPose('stand').bones.mixamorigLeftShoulder).toBeDefined()
expect(getMixamoPose('walk').bones.mixamorigLeftUpLeg).toBeDefined()
expect(getMixamoPose('sit').bones.mixamorigLeftLeg).toBeDefined()
```

- [ ] **Step 2: 运行失败测试**

运行：

```powershell
pnpm exec vitest run apps/desktop/src/renderer/design/views/canvas/stage3d/stage3d.test.ts --reporter=dot
```

预期：失败，提示 `getMixamoPose` 尚未导出。

- [ ] **Step 3: 实现最小预设库**

定义 `MixamoPose` 和 `getMixamoPose(poseId)`；先实现站立、走路、坐下、指向、挥手五个安全姿势。每个姿势仅包含以骨骼名称为 key 的局部欧拉增量。

- [ ] **Step 4: 验证预设库**

重复 Step 2 的命令，预期通过。

### Task 2: 在原绑定姿态上应用 Mixamo 预设

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/stage3d/MixamoActorRig.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/stage3d/stage3d.test.ts`

- [ ] **Step 1: 写出失败测试**

验证 Mixamo 预设应用返回的旋转是 `bindRotation × poseDelta`，不会替换绑定姿态：

```ts
const bind = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -0.3))
const result = applyMixamoPoseDelta(bind, [0.4, 0, 0])
expect(result.equals(bind)).toBe(false)
expect(result.length()).toBeCloseTo(1)
```

- [ ] **Step 2: 运行失败测试**

运行：

```powershell
pnpm exec vitest run apps/desktop/src/renderer/design/views/canvas/stage3d/stage3d.test.ts --reporter=dot
```

预期：失败，提示 `applyMixamoPoseDelta` 尚未导出。

- [ ] **Step 3: 实现绑定增量应用**

保留现有 `baseRotations`，新增四元数基线缓存；每次换姿势先恢复基线，再只把 Mixamo 预设中的四元数增量右乘到指定骨骼。手动关节覆盖继续走现有通用路径，且不重置其他骨骼。

- [ ] **Step 4: 验证绑定不被替换**

重复 Step 2 的命令，预期通过。

### Task 3: 回归验证与视觉验收

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/stage3d/stage3d.test.ts`

- [ ] **Step 1: 增加预设覆盖测试**

验证五个安全姿势都解析为有限的四元数，且预设不包含 `position`、`scale` 或未注册骨骼名称。

- [ ] **Step 2: 运行完整 3D 回归**

```powershell
pnpm exec vitest run apps/desktop/src/renderer/design/views/canvas/stage3d/stage3d.test.ts apps/desktop/src/renderer/design/views/canvas/stage3d/Scene3D.test.tsx --reporter=dot
pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json
git diff --check
```

预期：测试和 TypeScript 检查通过，差异无空白错误。
