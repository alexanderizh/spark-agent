# 画布自动整理与工作区拆分说明

> 状态: 已落地 | 最后核对: 2026-07-10

## 自动整理画布

画布工具栏新增自动整理入口，支持横向、纵向、宫格三种排列模式，并提供小 / 中 / 大 / 超大四档间距。

- 未选中或仅单选节点时，执行全画布整理。
- 多选两个及以上节点时，仅整理所选节点，整理完成后保留原选择状态。
- 整理过程中按钮进入 loading 态，避免重复触发。
- 布局计算包含节点悬浮头高度，避免节点主体不重叠但悬浮头互相压住。
- 局部整理会把未选中的节点作为避让对象，降低覆盖已有内容的概率。

## 工作区拆分

`CanvasWorkspaceView.tsx` 已拆出以下独立模块，降低页面文件继续膨胀的风险：

- `canvasAutoLayout.ts`: 自动整理布局算法与间距定义。
- `useCanvasFileInsertion.ts`: 图片选择、粘贴、拖拽导入文件的节点创建流程。
- `CanvasWorkspaceSidePanel.tsx`: 右侧属性 / 任务 / 资产 / 项目信息面板。
- `CanvasShortcutHelpModal.tsx`: 画布快捷键帮助弹窗。
- `CanvasFloatingNodeToolbar.tsx`: 节点悬浮编辑工具栏。
- `CanvasNodeEditModal.tsx`: 节点编辑弹窗。
- `CanvasProjectInfoPanel.tsx`: 项目信息设置面板。
- `canvasWorkspacePlacement.ts`: 画布节点定位、图片分组排布、插入尺寸计算。
- `canvasWorkspaceTaskInput.ts`: 任务输入节点解析、输入文件构造、Prompt 合并。
- `canvasWorkspaceFilm.ts`: 影视资产与分镜相关 Prompt / draft 构造工具。
- `canvasWorkspaceSnapshot.ts`: 截图、组节点合成、快照辅助工具。

`CanvasWorkspaceView.tsx` 仍保留画布核心编排状态和一部分影视生产 handler。后续继续压缩到 3000 行以下时，优先拆分操作节点运行逻辑、影视中心 handler、全局快捷键 / 离开守卫 hook。
