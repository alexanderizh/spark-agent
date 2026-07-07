# 3D 导演台：人偶全关节姿势编排（Pose Editing）设计方案

> 状态: 实施中 | 最后核对: 2026-07-07

## 背景与目标

3D 导演台（`apps/desktop/src/renderer/design/views/canvas/stage3d/`）的人偶目前有 19 个关节，
姿势 = 预设 + `actor.joints` 逐关节欧拉角覆盖，但调节只能靠属性面板里 57 根滑杆，效率低、不直观。
本次升级目标（参考 Magic Poser 类应用）：

1. **视口内直接摆姿势**：点关节出旋转环（FK），拖手/脚末端肢体自动跟随（两骨解析 IK）。
2. **骨架加密**：手腕独立 + 拇指 + 四指合并弯曲，能摆拳/掌/抓/指等武打常用手型。
3. **软限位**：按解剖学限制每关节可用轴与角度范围，默认钳制，按 `Alt` 拖拽可突破。
4. **效率功能**：自定义姿势保存/复用、左右镜像、姿势编辑撤销/重做、武打等新预设。

已确认选型：**方案 A —— 自研姿势 Gizmo + 解析式两骨 IK**（不用 drei TransformControls，不重构 SkinnedMesh）。

## 非目标

- 不做 SkinnedMesh 蒙皮、不引入外部 IK/骨骼库。
- 不做动画/关键帧（仍是静态姿势编排）。
- 不做全关节手指（15 关节/手）；四指合并为一个弯曲量。
- 2D 版导演台（`directorStage`）不动。

## 1. 数据模型（stage3d.types.ts / mannequin.ts）

`Stage3DData.version` 保持 1，全部向后兼容（旧数据无新 key，读取时宽容补默认）。

### 1.1 新增关节 id（JOINT_IDS 追加）

| id | 语义 | 存储语义 |
|----|------|---------|
| `handL`/`handR`（既有） | **重定义为手腕**（3 轴欧拉角，标签改「左腕/右腕」） | Vec3 欧拉角（不变） |
| `thumbL`/`thumbR` | 拇指 | `[curl, spread, 0]`：curl 弯曲 0~1.6rad，spread 张开 -0.3~0.9rad |
| `fingersL`/`fingersR` | 四指合并 | `[curl, spread, 0]`：curl 0（伸直）~ 2.4rad（握拳），spread 四指分开 0~0.35rad |

手指仍复用 `joints: Record<string, Vec3>` 存储（`readJoints` 已宽容，无需迁移）。
渲染时 curl 按 40%/35%/25% 分配到三段指节联动。

### 1.2 关节限位表（mannequin.ts 新增）

```ts
export type AxisLimit = [min: number, max: number] | null // null = 该轴锁定（不出环、不出滑杆）
export const JOINT_LIMITS: Record<JointId, [AxisLimit, AxisLimit, AxisLimit]>
```

要点（度数，写代码时转弧度）：
- `hips`：根关节全自由 ±180（用于躺/翻滚等整体姿态）。
- `spine`/`chest`：X ±35/±30，Y ±40/±35，Z ±25/±20。
- `neck` X ±25 Y ±40 Z ±15；`head` X -35~+25 Y ±50 Z ±20。
- `shoulderL/R`（锁骨耸肩）：X ±15，Y null，Z ±20（左右 Z 方向镜像）。
- `upperArmL/R`：X -170(前举)~+40(后摆)，Y ±90（内外旋），Z 外展：L 为 -10~+170、R 镜像 -170~+10。
- `lowerArmL/R`（肘，铰链+前臂旋转）：X -145~0，Y ±80（前臂旋前/旋后），Z null。
- `handL/R`（腕）：X ±70（屈伸），Y null，Z ±25（尺桡偏）。
- `upperLegL/R`：X -120(抬腿)~+30(后摆)，Y ±45，Z 外展 L -10~+80、R 镜像。
- `lowerLegL/R`（膝，纯铰链）：X 0~+150，Y null，Z null。
- `footL/R`（踝）：X -45(勾脚)~+70(绷脚)，Y ±20，Z ±20。
- `thumb*`：`[0~92°, -17°~52°, null]`；`fingers*`：`[0~137°, 0~20°, null]`。

限位是**软限位**：环拖拽/IK/滑杆默认 `clamp`，拖拽时按住 `Alt` 不钳制。
新增纯函数 `clampJointEuler(jointId, euler, opts?)` 供环、IK、滑杆共用（可单测）。

### 1.3 镜像（mannequin.ts 新增纯函数）

```ts
export function mirrorPose(joints: Record<string, Vec3>): Record<string, Vec3>
export function copyArmPose(joints, from: 'L' | 'R'): Record<string, Vec3> // 含腿：copySidePose
```

规则：L/R 关节互换；每个 Vec3 做 `[x, -y, -z]` 翻转（绕 Y/Z 的旋转左右对称取反）；
中线关节（hips/spine/chest/neck/head）仅 `[x, -y, -z]` 不互换。curl 类（thumb/fingers）互换不翻转。
**镜像的是"预设+覆盖"合成后的最终姿势**：先 `getPose(pose)` 与 `joints` 相加合成，镜像后整体写入 `joints`、`pose` 置为 `stand`（避免非对称预设翻转错乱）。

### 1.4 武打等新预设（POSE_PRESETS 追加）

新增分组概念：`POSE_PRESETS` 每项加 `group: '基础' | '武打'`。
武打组：出拳（弓步冲拳）、踢腿（正踢）、格挡、马步、飞踢（腾空侧踢，hips 抬高 + 双腿分展）。
预设中可使用 fingers/thumb curl（如出拳 = fingers curl 满 + thumb curl 大半）。
飞踢等离地姿势：`poseGroundOffset` 扩展返回正值（hips y 偏移），Scene 层已有消费点。

### 1.5 自定义姿势库

```ts
export type SavedPose = { id: string; name: string; joints: Record<string, Vec3>; createdAt: number }
```

- 存储：`localStorage` key `spark.stage3d.savedPoses`（应用级，跨画布/节点复用）。上限 60 个，超出提示删除。
- 保存时同 1.3 先把"预设+覆盖"合成为完整 joints 快照存入；套用时 `pose='stand'` + `joints=快照`。
- 新文件 `poseLibrary.ts`：`loadSavedPoses/savePose/deleteSavedPose/renameSavedPose`（纯函数 + localStorage 包装，可单测核心合成逻辑）。

## 2. 骨架与渲染（MannequinRig.tsx）

### 2.1 手部几何改造

现 `Hand` 是一个整盒。改为：
- 掌（腕关节 group 下的扁盒，略短）。
- 拇指：掌侧根部出一段两节小柱体，受 `thumb*` 的 curl/spread 驱动（curl 分配到两节）。
- 四指：掌端出三段联动指节（一排合并的扁盒即可，不逐指建模），受 `fingers*` curl/spread 驱动。
- 尺寸从 `BodyMetrics.handLen/limbRadius` 派生，不新增体型字段。

### 2.2 关节 ref 注册表

Gizmo 需要每个关节的世界变换。MannequinRig 增加可选 prop：

```ts
onJointRefs?: (map: Map<JointId, THREE.Group>) => void // 或 registerJoint(jointId, group|null) 回调 ref
```

每个关节 `<group>` 挂 callback ref 写入 map。仅选中且处于摆姿势模式的 actor 需要传入（其他人偶零开销）。

## 3. 姿势模式交互（新文件 PoseGizmo.tsx + Scene3D/Modal 接入）

### 3.1 模式进入/退出

- 选中人偶后，属性面板与视口浮条出现「摆姿势」toggle（也支持双击人偶进入）。
- 摆姿势模式下：OrbitControls 保持可用（拖环/把手时临时 `enabled=false`，drei TransformControls 同款处理）；人偶本体半透明度不变，但显示关节热点与 IK 把手；移动/旋转人偶整体的既有 gizmo 暂时隐藏，避免混淆。
- `Esc` / 再点 toggle 退出。切换选中对象自动退出。

### 3.2 关节热点

- 每个可调关节渲染一个小热点球（`depthTest=false` 叠加渲染，尺寸 ≈ jointRadius×0.9，跟随 2.2 的 ref 世界位置）。
- 默认半透明白，hover 高亮，当前选中关节为主题色。
- 手部热点（腕/拇指/四指）密集，热点半径按部位缩小并做 hover 放大，减少误点。

### 3.3 旋转环（FK）

- 点选关节后，在该关节原点按**父空间轴向**渲染 1~3 个 torus 环（X 红 / Y 绿 / Z 蓝），`JOINT_LIMITS` 中为 `null` 的轴不渲染。
- 环半径按关节层级自适应（躯干大、四肢中、手指小），`depthTest=false` 保证可见。
- 拖拽：pointerdown 捕获环 → 把指针移动投影到环所在平面的圆周切向 → 角度增量写入 `actor.joints[jointId][axis]`（叠加在预设之上的覆盖语义不变）→ `clampJointEuler` 软限位（Alt 突破）。
- 拖拽过程中在环旁显示当前角度数值（Html 标签）；释放才落一次 undo 快照。
- `thumb/fingers` 关节不出旋转环，出**两根迷你滑杆浮层**（curl/spread），因为 curl 是联动量不是单轴旋转。

### 3.4 末端 IK 拖拽（两骨解析 IK）

- 摆姿势模式下，双腕/双踝各显示一个菱形把手（区别于热点球）。
- 拖把手：目标点 = 指针射线与「过原把手位置、面向相机的平面」交点（Magic Poser 同款屏幕平面拖拽）。
- 新文件 `poseIk.ts`：`solveTwoBoneIK(chain, target, poleHint)` 闭式解：
  - 手臂链：shoulder(upperArm) → elbow(lowerArm) → wrist；腿链：upperLeg → lowerLeg → ankle。
  - 余弦定理求肘/膝弯曲角（lowerArm.x / lowerLeg.x），再求上臂/大腿指向目标的欧拉角；
  - 极向量默认：肘向后下、膝向前，可用既有关节当前弯曲方向作 hint 保持连续性；
  - 结果经 `clampJointEuler` 钳制（Alt 突破），目标不可达时伸直指向目标。
  - 纯函数，输入输出都是本地欧拉角与长度，可单测（目标可达/不可达/限位钳制三类用例）。
- IK 写回的仍是 FK 欧拉角数据，随后仍可用旋转环微调。

### 3.5 与滑杆面板的关系

- 属性面板「关节微调」滑杆保留（精调入口），min/max 改用 `JOINT_LIMITS`（锁定轴不渲染该滑杆），新增拇指/四指 curl/spread 滑杆行。
- 选中视口关节时，面板自动展开并滚动到对应关节行（双向联动，弱需求，实现简单就做，复杂就只做视口→面板高亮）。

## 4. 效率功能（Modal 层）

### 4.1 撤销/重做

- 范围：**仅姿势编辑操作**（`pose`/`joints` 变更，含套预设、镜像、套自定义姿势、IK/环拖拽、滑杆）。
- 实现：Modal 内 per-actor 栈 `{ actorId, before: {pose, joints}, after: {...} }`，上限 50 步；
  拖拽类操作在 pointerup 时落一条；`Cmd/Ctrl+Z`、`Shift+Cmd/Ctrl+Z` 快捷键（Modal 聚焦时拦截，不冒泡到画布全局 undo）。
- 不做整个 stage3d 数据的通用 undo（避免与画布层历史机制打架）。

### 4.2 镜像

- 属性面板姿势区两个按钮：「左右镜像」（整体）、「左→右 / 右→左」（下拉二选一，含臂+腿+手指同侧拷贝）。

### 4.3 姿势库 UI

- 姿势预设区改为分组：基础 / 武打 / 我的姿势。
- 「保存当前姿势」按钮 → 输入名弹窗 → 存入 poseLibrary；「我的姿势」项支持套用/重命名/删除（右键或 hover 操作钮）。

## 5. 提示词联动（prompt.ts，小改）

- 当 `joints` 有覆盖或套用自定义姿势时，姿势描述输出「自定义姿势（基于 X 预设微调）」或自定义姿势名，避免仍写死预设标签误导生图。
- 新预设补充中英文描述词（出拳→"throwing a punch, bow stance"等）。

## 6. 测试（stage3d.test.ts 扩展）

纯函数单测（vitest，无需 WebGL）：
1. `clampJointEuler`：范围内不动 / 超限钳制 / 锁定轴归零 / Alt(noClamp) 直通。
2. `mirrorPose`：L/R 互换 + y/z 取反；中线关节不换；curl 不翻转；镜像两次 = 原姿势。
3. `solveTwoBoneIK`：可达目标误差 < 1e-3；不可达伸直；限位钳制后不越界。
4. `poseLibrary`：合成快照（预设+覆盖）正确；增删改查与 60 上限。
5. 兼容性：`readStage3DData` 读旧数据（无 thumb/fingers）不炸；含新关节数据 round-trip。

交互（环拖拽/IK 拖拽）不写自动化测试，真机冒烟验收。

## 7. 实施拆分（供派工）

| 任务 | 内容 | 依赖 | 状态 |
|------|------|------|------|
| T1 骨架与纯函数层 | 1.1~1.4 + 2.1 + 5 + 对应单测 | 无 | ✅ 已完成（`df6a1837c`） |
| T2 视口姿势 Gizmo | 2.2 + 3.1~3.4 + `poseIk.ts` 单测 | T1 | ✅ 已完成（`556f6d20e`） |
| T3 效率功能（主 Modal） | 1.5 + 3.5 + 4.1~4.3 + 对应单测 | T1（与 T2 弱耦合） | ✅ 已完成（`a6ee1bcdb`，含 Gizmo 性能优化 R1） |
| R2a 全屏姿势编辑页 | 独立大视口 Modal（正/侧/顶/ISO 视角预设）、抽出 `JointSliders`/`usePoseUndoRedo` 复用、进入时姿势平铺、独立撤销栈 | T2/T3 | ✅ 已完成（`c1059712e`） |
| R3 人偶建模升级 | 可动人偶/素体手办风格重塑（头雕、三段式躯干、外露关节壳、LatheGeometry 肌肉肢段、靴状脚）+ 站立预设手-大腿穿模修复（stand 外展角由内收误值 ±6° 翻正为 ∓12° 真外展 + 手指自然微曲） | 无（纯视觉，关节层级/原点/`onJointRef` 零改动） | ✅ 已完成（`a1b0e04f3` + `92bde95a3`） |

验收标准：`pnpm typecheck` 通过；stage3d 单测全绿（现 61 条）；真机冒烟——能在视口中用环+IK 摆出「弓步冲拳」并保存为自定义姿势、镜像、撤销重做各操作一遍。

## 8. 待办（真机冒烟后发现，供下一轮派工）

用户已用「全屏编辑」页（R2a）+ 新建模（R3）冒烟，反馈：摆姿势卡顿、部分旋转句柄不好点中；另外全屏页里姿势库/镜像还是占位未接。

| 任务 | 内容 | 备注 |
|------|------|------|
| R2b 全屏页姿势库/镜像 | `PoseEditorModal.tsx` 右侧面板目前「姿势库（R2b）」「镜像（R2b）」两块是占位 `<div>`（见文件内 `stage3d-pose-editor-placeholder-title` 附近）。需接入主 Modal（`CanvasDirectorStage3DModal.tsx`）里已实现的姿势库（`poseLibrary.ts`：保存/套用/重命名/删除）与镜像（`mirrorPose`/`copySidePose`）能力，UI 风格对齐 4.2/4.3 节描述。操作需记入 `usePoseUndoRedo` 撤销栈。 | 纯 UI 接线，无新纯函数，工作量小 |
| 句柄命中优化 | `PoseGizmo.tsx` 的旋转环/IK 把手在真机反馈「不好触发」。方向：① 给环增加一层不可见的加粗/加厚 raycast 命中代理（几何比可见环粗，只用于 pointer 命中判定，不参与渲染或用极低透明度）；② 检查是否被 R3 新增的关节壳/肢段 mesh 挡住了 raycast（新几何面数增多，命中优先级可能被躯干体块抢先）——必要时环/把手渲染时关闭目标之外 mesh 的 raycast（`raycast={() => null}` 或提高环的 `renderOrder`+单独 raycaster 层）；③ 确认手指/拇指等细小关节的环半径是否小于可点击的最小像素阈值，按需要设最小屏幕空间半径。 | 需真机验证，建议先用 `console.log`/临时高亮定位具体卡住的关节再动手 |
| 卡顿排查 | 用户反馈摆姿势时卡顿。方向：① 检查 `PoseGizmo` 是否在每帧（`useFrame`）里做了不必要的重计算/重分配（如每帧 new 向量而非复用）；② R3 引入的 `geometryCache`/`materialCache` 是否在 poseMode 下被跳过导致重建；③ 用 React DevTools Profiler 或 `performance.now()` 打点定位是重渲染还是 GPU 绘制瓶颈；④ 检查关节热点/环的数量（新增 thumb/fingers 后每 actor 关节数增多）是否让每帧 `getWorldPosition` 调用量线性增长到可感知程度。 | 建议先定位瓶颈来源（CPU 计算 / React 重渲染 / GPU）再决定优化手段，避免盲目优化 |

验收标准：真机在「全屏编辑」页能顺畅拖动任意关节环/IK 把手（含手指细关节），无明显掉帧；姿势库/镜像在全屏页与主 Modal 行为一致。
