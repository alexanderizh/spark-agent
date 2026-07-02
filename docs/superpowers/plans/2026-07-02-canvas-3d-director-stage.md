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
