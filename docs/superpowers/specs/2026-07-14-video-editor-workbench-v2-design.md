# 视频编辑工作台 V2 设计

> 状态: 实施中 | 最后核对: 2026-07-14

## 目标

把现有“单个源视频 + 单条裁剪轨道”的视频处理工作台升级为可保存、可继续编辑、可导出的桌面非线性编辑器。第一期必须形成完整闭环：导入多种素材、编排多轨时间线、预览和调整片段、保存工程、通过 FFmpeg 导出成片。

## 已确认产品边界

### 第一期

- 左侧项目素材库同时展示视频、图片和音频，支持多文件导入、搜索和类型筛选。
- 下方全宽多轨时间线支持视频/图片/音频片段、拖放、移动、修剪、分割、删除、轨道显隐/锁定/静音、磁吸和时间缩放。
- 中央节目监视器支持播放/暂停、逐帧、时间定位、适配画面、25%–400% 缩放和拖动画面查看。
- 右侧属性检查器支持位置、缩放、旋转、水平/垂直镜像、不透明度、裁剪、音量、静音和图片持续时间。
- 封面可使用当前帧或项目图片素材；设置结果保存到编辑工程。
- 工程状态持久化到画布工作台节点；旧单源工作台数据首次打开时自动迁移。
- 导出把启用的视频/图片轨和音频轨编译成一个安全的 FFmpeg `filter_complex` 任务，生成新产物并登记到工作台。

### 第二期

- 转场、关键帧动画、字幕编辑、水印、调色滤镜、淡入淡出、变速/倒放、音频混音细节、代理媒体和更多导出预设。
- 第一期开好 `effects` 与渲染计划扩展口，但不制作没有编辑体验的孤立按钮。

## 界面结构

采用已确认的“方案 A：全宽多轨剪辑台”。

```text
┌──────────────────────────── 顶栏：工程信息 / 保存 / 导出 ────────────────────────────┐
│ 左侧项目素材库               │ 中央节目监视器                      │ 右侧属性检查器       │
│ 视频 / 图片 / 音频           │ 合成画面、缩放、播放、逐帧          │ 片段变换、声音、封面 │
├────────────────────────────────────────────────────────────────────────────────────┤
│ 时间线工具栏：撤销、重做、分割、磁吸、删除、缩放                                   │
│ V2  叠加图片/视频片段                                                                │
│ V1  主视频片段                                                                       │
│ A1  音频片段                                                                         │
└────────────────────────────────────────────────────────────────────────────────────┘
```

时间线必须占满工作台宽度，避免右侧属性面板长期挤压长项目。窗口宽度不足时，右侧检查器缩窄，素材库可折叠；时间线不降级为卡片列表。

## 工程模型

新模型版本为 `VideoEditorDocument.version = 2`：

```ts
interface VideoEditorDocument {
  version: 2
  settings: {
    width: number
    height: number
    fps: number
    background: string
  }
  assets: VideoEditorAsset[]
  tracks: VideoEditorTrack[]
  cover: VideoEditorCover | null
  outputs: WorkbenchOutput[]
  updatedAt: number
}

interface VideoEditorAsset {
  id: string
  kind: 'video' | 'image' | 'audio'
  name: string
  sourceUrl: string
  sourcePath: string
  thumbnailUrl?: string
  durationSec?: number
  width?: number
  height?: number
  hasAudio?: boolean
}

interface VideoEditorTrack {
  id: string
  kind: 'video' | 'audio'
  name: string
  hidden: boolean
  locked: boolean
  muted: boolean
  clips: VideoEditorClip[]
}

interface VideoEditorClip {
  id: string
  assetId: string
  timelineStartSec: number
  durationSec: number
  sourceStartSec: number
  transform: {
    x: number
    y: number
    scale: number
    rotation: number
    flipX: boolean
    flipY: boolean
    opacity: number
    crop: { top: number; right: number; bottom: number; left: number }
  }
  audio: { volume: number; muted: boolean }
  effects: VideoEditorEffect[]
}
```

模型约束由纯函数维护：时间值有限且非负；片段持续时间不小于一帧；视频片段的源区间不得超过素材时长；锁定轨道不可修改；同一视频轨片段默认不重叠；图片素材默认持续 5 秒；音频素材只能放入音频轨。

## 组件边界

- `CanvasVideoWorkbenchModal` 退化为装配层，只负责打开/关闭、工程载入和画布回调。
- `VideoWorkbenchShell` 负责四区布局、当前选中项与全局快捷键。
- `VideoMediaLibrary` 负责素材筛选、批量导入、双击/拖入时间线。
- `VideoPreviewMonitor` 负责合成预览、播放器状态和视口缩放，不直接持久化数据。
- `VideoMultiTrackTimeline` 只消费文档和派发编辑命令；坐标与时间换算放入纯模型。
- `VideoClipInspector` 根据选中片段派发变换、声音和封面命令。
- `useVideoEditorProject` 持有 reducer、撤销/重做历史和 350ms 防抖保存；拖动过程只改内存，不产生高频 IPC 写入。
- `videoWorkbench.api.ts` 封装素材探测、导入、导出和进度订阅；React 组件不直接拼接 IPC 参数。

所有新逻辑放在 `videoWorkbench/` 子目录。超过 3000 行的 `CanvasWorkspaceView.tsx`、`canvas.api.ts`、主进程 `ipc/index.ts` 和协议 `ipc/index.ts` 只允许最小接线，不继续堆叠编辑逻辑。

## 数据流

1. 工作台打开时读取 `node.data.videoWorkbench`。
2. V2 文档直接规范化；旧文档把 `node.data.url` 迁移为一个素材、一条 V1 轨和一个片段。
3. 用户导入文件后，画布层复制文件到项目，工作台为每个文件创建素材记录并异步探测元数据。
4. 用户编辑时，UI 只派发领域命令；reducer 产生下一份文档并记录撤销历史。
5. 防抖保存只回写 `videoWorkbench.editorDocument`，不会覆盖节点其他字段。
6. 导出时把文档生成 `VideoRenderPlan`，经 schema 校验后发给主进程。
7. 主进程逐个校验所有输入路径，编译参数数组并以 `shell: false` 执行 FFmpeg；进度只更新匹配 `requestId` 的任务。
8. 成功产物写入工作台输出列表，可播放并继续回填画布。

## 预览策略

第一期采用“轻量实时预览 + FFmpeg 最终渲染”：

- 播放头处只渲染当前启用轨道的可见片段，视频使用原生 `<video>`，图片使用 `<img>`，通过 CSS transform/crop/opacity 叠加。
- 多视频同时播放时以时间线为主时钟，子视频按阈值纠偏；暂停、定位和逐帧时强制同步。
- CSS 预览负责交互反馈，最终像素结果以 FFmpeg 渲染为准；不在第一期引入 WebGL 或逐帧离屏编码。

## FFmpeg 渲染

新增单一高层操作 `renderTimeline`，输入为经过协议校验的声明式渲染计划。编译器负责：

- 视频裁切与时间偏移：`trim`、`setpts`。
- 图片静帧：循环输入与 `trim`。
- 适配、裁剪、旋转、镜像、透明度和定位：`scale`、`crop`、`transpose/rotate`、`hflip/vflip`、`colorchannelmixer`、`overlay`。
- 音频裁切、时间偏移、音量和混音：`atrim`、`asetpts`、`volume`、`amix`。
- 无底层画面时生成项目尺寸的背景色；无音频时正常导出静音视频。
- 第一阶段统一输出 MP4/H.264/AAC，沿用现有导出产物目录、并发上限、取消和超时机制。

编译器只生成参数数组，禁止拼接 shell 命令；每个附加输入都必须通过现有安全路径白名单校验。

## 错误与恢复

- FFmpeg 未安装时允许继续排版和保存工程，但禁用最终导出并提供原位安装入口。
- 素材丢失时保留占位片段和原路径，不自动删除编辑内容；素材库提供“重新链接”。
- 导入或探测部分失败时保留成功项，逐项显示失败原因。
- 导出可取消；失败保留工程和已有产物，不产生半成品输出记录。
- 渲染进度、失败和取消按 `requestId` 隔离，避免多个任务相互覆盖。

## 测试与验收

- 纯模型：旧数据迁移、素材/轨道/片段约束、插入、移动、修剪、分割、删除、磁吸和总时长。
- reducer：命令结果、锁定轨保护、撤销/重做和防抖保存。
- 渲染计划：输入映射、视频/图片叠加、镜像旋转、音量混音、空轨和非法值拒绝。
- 组件：素材筛选、播放/暂停、缩放、选中片段属性修改、轨道快捷键。
- 集成：导入两段视频和一张图片，编排到 V1/V2，设置镜像与封面，保存重开后状态一致。
- 端到端：有 FFmpeg 环境时导出短工程并用 ffprobe 核对时长、尺寸和音轨；无 FFmpeg 环境时验证可编辑但不可导出。

第一期完成标准不是“按钮出现”，而是用户可以从空工作台导入多素材、排出多轨时间线、预览、保存重开并成功导出一条合成视频。
