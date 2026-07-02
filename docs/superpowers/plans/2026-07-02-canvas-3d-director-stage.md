# 画布真·3D 导演台（Director Stage 3D）

> 状态: 实施中 | 最后核对: 2026-07-02

## 背景与目标

现有「画面编排导演台」（`CanvasDirectorStageModal.tsx`，节点 subtype `director_stage`）本质是 2D 俯视平面图 + 相机取景推算，名不符实。目标是新增一个**真实 3D 空间导演台**，2D 版保留不动。

用户目标（原话归纳）：

1. 在一个 3D 空间中，可叠加 **360 全景图**或**普通场景图**形成真实 3D 场景背景。
2. 角色是**实体 3D 人体模型**（参考 body-chan 素体人偶风格），在 3D 空间内编排**姿势、位置、朝向**；支持多种体型（儿童/瘦高/标准/健壮/肥胖等，见参考图中角色 A-H）。
3. 角色可**绑定画布中已有的角色板节点**，也可以是不绑定的普通路人角色。
4. 可添加**家具等 3D 模型**在空间内形成布局。
5. 可**生成截图**输出为画布图片节点，作为后续图像生成的参考图；同时产出结构化中文提示词。

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 3D 引擎 | three.js + @react-three/fiber v9 + @react-three/drei | React 19 兼容；手写 WebGL（如 CanvasPanoramaViewerModal）无法支撑骨架人偶/GLB/gizmo |
| 人偶 | **程序化关节人偶**（几何体拼装 + THREE.Group 关节层级） | Kenney 角色太花哨；程序化可参数化体型、姿势预设、逐关节调整，风格贴合素体人偶 |
| 家具 | Kenney furniture-kit **GLB 精选子集**（~30 件）打入资产 + 参数化几何道具兜底 | GLB 现成、低多边形素色、单件几 KB |
| 背景 | 三模式：地面网格 / 全景球（equirect 贴图）/ 背板平面（普通场景图） | 覆盖全景图与普通场景图两种素材 |
| 落点 | 新节点 subtype `director_stage_3d` + 全屏 Modal，代码集中于 `views/canvas/stage3d/` 新目录 | 2D 版不动，侵入最小 |
| 截图 | `renderer.domElement.toDataURL()` → 插入画布图片节点 | 复用全景查看器截图入画布的既有链路 |

## 数据模型（节点 data.stage3d，version 1）

```ts
type Stage3DData = {
  version: 1
  backdrop: { mode: 'grid' | 'panorama' | 'backdrop'; imageUrl?: string; /* 全景球或背板 */ rotationY?: number; backdropDistance?: number }
  actors: Stage3DActor[]   // 人偶
  props: Stage3DProp[]     // 家具/道具
  camera: { position: [number,number,number]; target: [number,number,number]; fov: number; aspect: '16:9'|'9:16'|'1:1'|'4:3' }
  activeId?: string
  sceneBrief?: string
  prompt?: string
}

type Stage3DActor = {
  id: string
  name: string
  color: string            // 人偶通体颜色（参考图彩色人偶）
  boundNodeId?: string     // 绑定的画布角色板节点 id；无则为路人
  bodyType: 'standard' | 'child' | 'slim' | 'muscular' | 'heavy' | 'tall'
  heightScale: number      // 0.5–1.5
  position: [number, number, number]  // y 通常 0（站地面）
  rotationY: number        // 朝向（弧度）
  pose: string             // 姿势预设 id：stand/walk/run/sit/point/arms-crossed/lying/kneel...
  joints?: Record<string, [number,number,number]>  // 关节欧拉角覆盖（逐关节微调）
  note?: string
}

type Stage3DProp = {
  id: string
  kind: 'glb' | 'primitive'
  assetId: string          // glb: 资产注册表 id；primitive: box/cylinder/plane...
  name: string
  position: [number,number,number]
  rotationY: number
  scale: number
  color?: string           // primitive 用
}
```

## 人偶关节层级（程序化 Mannequin）

root(hips) → spine → chest → neck → head；chest → L/R shoulder → upperArm → lowerArm → hand；hips → L/R upperLeg → lowerLeg → foot。共 ~17 关节。体型 = 各段长度/半径参数表；姿势预设 = 关节欧拉角集合；材质 MeshStandardMaterial 单色 + 轻描边感（可用深色关节球区隔肢段）。头顶浮动名字标签（drei Billboard/Html）。

## 交互设计（Modal 内）

- 左侧工具栏：添加角色（选绑定角色节点 / 路人）、添加家具（GLB 面板缩略分类：床/桌椅/柜/沙发/浴室/杂项）、添加几何道具、背景设置（三模式 + 从画布图片节点选图）。
- 视口:主视口 OrbitControls 自由视角；选中对象显示 TransformControls（移动/旋转 Y）；点击选中，Delete 删除。
- 右侧属性面板：选中角色 → 体型/身高/颜色/姿势预设/关节微调（分组滑杆）/备注；选中道具 → 缩放/颜色。
- 相机系统：独立「取景相机」对象（视锥线框可见），一键「进入取景视角」预览构图；焦段(fov)/画幅可调。
- 顶栏：截图（取景相机视角渲染 → 画布图片节点）、生成提示词、保存（写回节点 data）。

## 实施分工（多代理编排）

- **Phase A（opus 代理）**：依赖安装（three/@react-three/fiber/@react-three/drei/@types/three）；`stage3d/` 目录全部核心：类型与序列化、Scene3D、程序化人偶（体型+姿势预设+关节覆盖）、背景三模式、取景相机、TransformControls 交互、Modal 全 UI、`director_stage_3d` 节点接入 CanvasWorkspaceView/CanvasNode/CanvasBottomDock、截图入画布、提示词生成。
- **Phase B（sonnet 代理，A 完成后）**：Kenney GLB 精选子集拷贝入资产 + 注册表 + 家具面板缩略图、GLB 加载缓存、几何道具、单测（序列化/姿势/提示词）、文档状态刷新。

## Phase C：AI 影视开发特色功能（2026-07-02 追加）

> 目标：让 3D 导演台不只是「摆人偶截图」，而是具备真实影视预演（previz）工作方式的专业感，产出更贴合分镜/多镜头 AI 生图工作流的结果。

### C1. 多机位 / 分镜镜头列表（Shot List）— 优先级最高
- 数据模型扩展：`Stage3DData.shots?: Stage3DShot[]`，`Stage3DShot = { id, name, shotNumber: string /* 如 "3A" */, position, target, fov, aspect, note? }`。当前 `camera` 字段作为「工作机位/草稿机位」不变，Shot 是「已保存的正式镜头」。
- 交互：取景相机属性面板新增「保存为镜头」按钮，把当前机位存入 shots 列表；列表可命名、编辑镜号、切换（点击即让主视口/取景相机跳到该机位）、删除、复制。
- 顶栏新增「导出全部镜头」：遍历 shots，逐个渲染截图，批量插入画布图片节点（每张标题带镜号），一次生成一组分镜参考图——这是本功能最贴合真实分镜工作流的部分。
- 提示词：单镜头截图仍用当前 prompt 生成逻辑（机位取该 shot 的参数）；批量导出时每张各自生成对应提示词。

### C2. 三点布光（Key / Fill / Back Light）
- 目前场景只有固定环境光+两盏方向光，不可调、不影响构图判断。新增 `Stage3DData.lighting?: Stage3DLighting`，`Stage3DLighting = { preset: 'studio'|'front'|'side'|'back'|'rim'|'top'|'none', intensity: number /* 0.5-2 */ }`，与 2D 版 `LIGHTING_LABEL`（顺光/侧光/逆光/顶光/轮廓光）语义对齐，方便用户从 2D 版迁移心智。
- 渲染：不同 preset 对应不同的主光（key light）方向/角度组合（如 rim= 强逆光+弱正面补光），实际驱动 three.js DirectionalLight 位置与强度，让取景预览里真能看出光影差异，而不仅是文字描述。
- 属性面板：场景级设置（不挂在单个对象上），下拉预设 + 强度滑杆。
- 提示词：写入「灯光：XXX（强度 Y）」，衔接 2D 版的措辞风格。

### C3. 构图参考线（Composition Guides）
- 取景视角预览模式下，视口叠加可切换的参考线：三分法网格 / 中心十字 / 无。纯 UI overlay（HTML/CSS 绝对定位在画幅遮幅内），不参与截图渲染（截图应保持干净无参考线）。
- 顶栏或取景视角面板加一个小的 Segmented 切换。

### C4. 场记板信息（Slate / 场次镜号备注）
- `Stage3DData.slate?: { scene: string; shotNumber: string; take: string; note?: string }`（如 场 3 / 镜 A / take 2）。
- 属性面板「场景与提示词」区块新增三个小输入框；写入提示词开头，格式如「场次 3 · 镜号 3A · Take 2」，帮助用户在生成一系列图时保持场次/镜号的可追踪性，也可作为批量导出时文件命名的依据（如「导出全部镜头」时文件标题用 `场次-镜号` 命名）。

### 数据模型增量（version 保持 1，字段均可选，宽容解析旧数据）
```ts
type Stage3DShot = { id: string; name: string; shotNumber: string; position:[number,number,number]; target:[number,number,number]; fov: number; aspect: Stage3DAspect; note?: string }
type Stage3DLighting = { preset: 'studio'|'front'|'side'|'back'|'rim'|'top'|'none'; intensity: number }
type Stage3DSlate = { scene: string; shotNumber: string; take: string; note?: string }
// Stage3DData 新增: shots?: Stage3DShot[]; lighting?: Stage3DLighting; slate?: Stage3DSlate
```

### 验收清单（Phase C）
- [x] 可将当前取景机位保存为命名镜头，镜头列表可切换/编辑/删除（`ShotListPanel`，另含复制）
- [x] 「导出全部镜头」一次性把所有镜头截图批量插入画布（各自命名）（顶栏按钮 → `onExportScreenshots` → `handleInsertStage3DScreenshots` 网格排布 + 连线）
- [x] 三点布光预设可选且真实影响渲染光影（非纯文字）（`LightingRig` 按预设换算 key/fill/back 三盏方向光位置与强度）
- [x] 取景预览可切换三分法/中心十字参考线，且不出现在最终截图里（纯 CSS overlay，截图走离屏 WebGLRenderTarget 只渲染 three.js scene，不含 DOM）
- [x] 场记板信息可填写并体现在提示词与批量导出命名中（提示词开头「场次 X · 镜号 Y · Take Z」；批量命名优先「场次-镜号」）
- [x] 旧场景数据（无 shots/lighting/slate）打开不报错，字段按默认值补齐（`readStage3DData` 宽容解析 + 单测覆盖）

## 验收清单

- [ ] 新建 3D 导演台节点，打开全屏 3D 视口，OrbitControls 可用
- [ ] 添加多个不同体型/颜色人偶，姿势预设切换生效，关节可微调，头顶名字
- [ ] 人偶可绑定画布角色节点（名字联动）
- [ ] 全景图模式：选画布全景图节点 → 全景球包裹场景；场景图模式：背板显示
- [x] 家具 GLB 可添加/移动/旋转/缩放（Kenney 精选 37 件，`src/renderer/assets/stage3d-furniture/` 共约 660KB，经 Vite 资产管线打包；drei useGLTF 缓存 + 每实例 clone，加载失败红色占位盒兜底；家具面板按 床/桌/椅/柜/沙发/浴室/杂项 分组）
- [ ] 取景相机视角预览 + 截图生成画布图片节点
- [ ] 生成中文提示词包含机位/焦段/站位/朝向/姿势/光线
- [ ] 状态保存进节点 data，重开恢复
- [ ] 2D 导演台不受影响
