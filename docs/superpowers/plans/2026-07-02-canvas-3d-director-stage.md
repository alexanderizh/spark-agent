# 画布真·3D 导演台（Director Stage 3D）

> 状态: 实施中 | 最后核对: 2026-07-08

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
| 人偶 | **UE4 素体模型默认 + Mixamo 素体可选**（旧程序化数据读取时归一为 UE4） | 实体模型观感明显优于几何体拼装；UE4 体型通过局部骨骼比例拉开差异，Mixamo 作为兼容备选 |
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

## Phase D：人偶视觉 R4（2026-07-07 追加）

用户基于真机截图反馈，当前人偶仍偏“球和圆柱拼接”，脸部、手脚、关节分件和躯干层次不够接近 body-chan / 可动素体参考。保持 `Stage3DData`、关节 id、关节原点、`onJointRef` 回调与姿势编辑逻辑不变，只升级 `MannequinRig.tsx` 的程序化 mesh。

本轮升级范围：

- 头雕：眼睛从凸眼改为凹眼窝 + 眉弓 + 眼睑浅浮雕，增加下颌、唇线、耳和颈部肌线，减少“玩具脸”感。
- 躯干：胸甲、腹甲、骨盆甲加入深色分件边线，强化胸-腰-骨盆三段层次。
- 关节：肩、肘、髋、膝、踝加入同色深调护环和缝线，避免黑球外露，同时让可动关节位置更清楚。
- 手部：四指从一整块合并盒体升级为四根三段指节，拇指按左右手外侧放置，保留 `thumb*` / `fingers*` 的合并驱动语义。
- 脚部：鞋底、踝口、鞋头缝和脚背块更清晰，站立时更像可动素体鞋型脚。

验收标准：默认站姿从正面看应具备清楚的胸甲/腹甲/骨盆甲层次，左右拇指位于外侧，四指可读，头脸不再出现凸眼泡；姿势编辑环/IK 仍能通过原关节 ref 定位。

### D2. Mixamo 实体人偶替换（2026-07-07 追加）

程序化人偶即使继续细修，实体质感仍明显不如专业模型。用户提供 Mixamo 下载的 `Shoved Reaction With Spin.fbx` 后，改为内置一个 Mixamo skinned mannequin 作为 3D 导演台默认人偶视觉资产。

实现要点：

- 资产放入 `apps/desktop/src/renderer/assets/stage3d-actors/mixamo-mannequin.fbx`，运行时通过 Three.js `FBXLoader` 加载。
- 新增 `MixamoActorRig.tsx`：克隆 skinned mesh、统一蓝色素体材质、保留深色关节材质，并把标准 Mixamo 骨骼名映射到现有 `JointId`。
- `Scene3D` 优先渲染 Mixamo rig；加载中或加载失败时回退到原 `MannequinRig`，保证视口不空白。
- `Stage3DActor` 数据结构不变，旧节点无需迁移。
- 胖瘦高矮当前采用稳定的整体非均匀缩放实现：`child / slim / muscular / heavy / tall` 直接映射为 root scale，避免对 Mixamo 局部骨骼做缩放导致皮肤权重和头颈比例变形。

已知边界：

- Mixamo FBX 的骨骼局部轴与旧程序化人偶不同，现阶段只做关节名映射和基础欧拉叠加；姿势轴需要后续逐关节真机校准。
- 用户下载的文件自带 `Shoved Reaction With Spin` 动画，但导演台当前仍以静态 pose/joints 为主，暂不自动播放该动画。

### D3. 姿势调节交互修正（2026-07-07 追加）

用户反馈关节点白点过大、旋转环难命中且拖拽卡顿，并且退出摆姿势后视口控制偶发不可用；同类问题同时影响主 3D 导演台与全屏姿势编辑页。

本轮修正：

- 关节热点视觉半径下调、透明度降低，同时保留更大的隐形命中区，减少遮挡但不牺牲点击可达性。
- 点选关节后在视口右下角显示浮动 XYZ 调节器，三轴均可在 -180° 到 180° 范围自由拖动；拖动面板时隐藏关节点和旋转环。
- 旋转环仍保留为备用交互，并增加选中轴高亮；三轴不再按解剖学限位锁定。
- `Scene3D` 在退出姿势模式或组件卸载时强制恢复 `OrbitControls.enabled`，避免拖拽取消后视口无法旋转/移动。
- 全屏姿势页的相机预设只在预设项或编辑对象变化时应用，不再因为关节数据刷新而重置用户当前观察角度。
- 侧栏 `JointSliders` 与视口浮动调节器一致，XYZ 三轴均开放，不再显示“锁定”。

## Phase E：参考 3D 导演台能力补齐（2026-07-08 追加）

用户提供 `storyai-3d-director-desk` 作为参考实现，希望吸收其中多人物模型、群众阵列、基础几何体一键添加、本地模型导入、全景图导入与视口比例框等能力。当前项目已有多 Actor、Mixamo 默认人偶、姿势库、家具 GLB、镜头导出和取景画幅；本阶段不整体迁移参考项目的 Zustand 场景模型，而是在现有 `Stage3DData` 上做兼容扩展。

本阶段落地范围：

- 多人物模型：`Stage3DActor` 增加 `modelId / modelSource / rigType`，默认使用参考项目 UE4 素体，保留内置 Mixamo 作为可选模型；不再向用户暴露程序化素体人偶，旧 `procedural` 数据读取时归一为 UE4。
- 群众阵列：`Stage3DActor` 增加 `crowdId / crowdLabel`，支持 rows / columns / spacing 批量生成，并在提示词里归纳为群众阵列。
- 全景背景：恢复 `backdrop.mode = 'panorama'`，读取旧 panorama 数据不再降级为 grid；渲染层用内侧球面/安全纹理加载处理全景图。
- 基础几何体：在 box / cylinder / sphere / plane 基础上补充 cone / torus / pyramid。
- 本地模型导入：引入本地 FBX / OBJ / GLB 文件读取，作为 `Stage3DProp` 的本地模型资产渲染与保存；持久化仍保留 data URL，渲染时转换为 runtime `blob:` URL 供 three loaders 读取，避免导入后落入红色错误占位。

### E1. 数据模型与提示词地基

- [x] `Stage3DBackdropMode` 恢复 `panorama`
- [x] `Stage3DActor` 保存群众与模型元数据
- [x] `Stage3DPrimitiveShape` 扩展 cone / torus / pyramid
- [x] 提示词输出全景背景和群众阵列摘要

### E2. 视口与交互

- [x] 视口渲染真正支持全景球背景
- [x] 左侧工具栏支持群众阵列添加
- [x] 角色属性面板支持人物模型选择
- [x] Primitive 渲染新增 cone / torus / pyramid

### E3. 本地资产

- [x] 本地模型读取 FBX / OBJ / GLB
- [x] 本地模型作为道具加入场景并可移动 / 旋转 / 缩放
- [x] 保存时避免脏数据导致旧节点打开失败

### E4. 参考项目人物与导入修复

- [x] 引入 `storyai-3d-director-desk` 的 `ue-mannequin-retopology.glb`，新增 UE4 素体作为默认内置人物模型，并保留 Mixamo 素体作为可选模型。
- [x] UE4 素体按 `bodyType` 做局部骨骼比例调整，儿童 / 纤细 / 健壮 / 宽厚 / 高挑不再只依赖根节点宽高缩放。
- [x] 本地 FBX / OBJ / GLB 导入渲染时直接解码 data URL 为 runtime `blob:` URL，不再依赖 `fetch(data:)`；skinned mesh clone 改用 `SkeletonUtils.clone`，降低人物模型导入后落入红色占位的概率。单文件上传入口暂不开放依赖外部 `.bin` / 贴图的 `.gltf`。
- [x] 姿势预设改为参考项目语义控制值再映射到现有关节数据；全屏姿势编辑页站姿基准改为从 `getPose('stand')` 读取，并把最终姿势快照转换为 stand 覆盖，避免预设/姿势库套用时四肢二次偏移。
- [x] 全屏姿势编辑左侧面板补充撤销 / 重做 / 重置、镜像和预设快捷操作，右侧继续保留精细关节滑杆。

## 验收清单

- [ ] 新建 3D 导演台节点，打开全屏 3D 视口，OrbitControls 可用
- [ ] 添加多个不同体型/颜色人偶，姿势预设切换生效，关节可微调，头顶名字
- [ ] 人偶可绑定画布角色节点（名字联动）
- [x] 全景图模式：选画布全景图节点 → 全景球包裹场景；场景图模式：背板显示
- [x] 家具 GLB 可添加/移动/旋转/缩放（Kenney 精选 37 件，`src/renderer/assets/stage3d-furniture/` 共约 660KB，经 Vite 资产管线打包；drei useGLTF 缓存 + 每实例 clone，加载失败红色占位盒兜底；家具面板按 床/桌/椅/柜/沙发/浴室/杂项 分组）
- [x] 群众阵列可一键生成、选中和整组变换
- [x] 本地模型可导入并作为道具进入场景
- [x] 可在 UE4 素体 / Mixamo 素体之间选择人物模型，UE4 素体体型差异由局部骨骼比例驱动
- [ ] 取景相机视角预览 + 截图生成画布图片节点
- [ ] 生成中文提示词包含机位/焦段/站位/朝向/姿势/光线
- [ ] 状态保存进节点 data，重开恢复
- [ ] 2D 导演台不受影响
