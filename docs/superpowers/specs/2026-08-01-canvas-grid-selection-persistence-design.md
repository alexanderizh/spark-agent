# 无限画布网格划选持久化与自动整理复用设计

> 状态: 已落地 | 最后核对: 2026-08-01

## 目标

- 多选工具栏的网格矩阵在鼠标松开后保留已选区域高亮，直到用户再次划选或关闭面板。
- “应用网格排列”使用小号按钮，降低弹层主动作的视觉体积。
- 右上角“自动整理”在宫格模式下复用同一网格矩阵，可指定每排节点数；横向和纵向模式保持现状。
- 自动整理中的共享网格面板铺满 320px 弹层可用宽度；多选浮层仍保持原有紧凑宽度。

## 根因与约束

`CanvasGridSelectionMatrix` 当前只用 `dragStart` 和 `dragEnd` 计算高亮，并在 `window.mouseup` 后清空两者，因此列数虽然通过 `onChange` 提交，高亮状态必然消失。底层 `arrangeCanvasNodes` 与 `CanvasStageViewportControls.arrangeNodes` 已支持可选 `columns`，无需修改布局算法或持久化协议。

## 设计

矩阵把“正在拖动的选区”和“已提交的选区”分开：拖动时显示实时矩形；松开时提交并保留用户实际划出的矩形。列数仍通过现有受控 `columns` 值与数值输入同步，已提交矩形只负责表达最近一次鼠标划选区域，不伪造额外高亮行。

`CanvasGridArrangePanel` 继续作为网格规格的共享 UI。新增可配置标题、提交文案和显式 `fullWidth` 模式，但保持默认值兼容多选工具栏；右上角自动整理仅在 `layoutMode === 'grid'` 时启用铺满模式并渲染该面板，把选定列数随 `onArrange` 传递。横向、纵向继续使用原有间距选择和“开始整理”按钮。

## 测试

- 组件测试模拟按下、划过和 `mouseup`，断言松开后活动格仍存在。
- 面板测试断言小号应用按钮以及自动整理所需的自定义标题和提交文案。
- 工具栏测试断言宫格模式展示网格面板，并把列数传给 `onArrange`。
- 既有自动布局测试继续覆盖 `columns` 的布局语义。

## 影响范围

直接修改 `CanvasGridSelectionMatrix`、`CanvasGridArrangePanel` 和 `CanvasToolbar`。类型参数沿 `CanvasWorkspaceChrome`、`CanvasWorkspaceView` 传到 `CanvasStage`，但底层算法不变。GitNexus MCP 未暴露，本次依照降级规则使用 `rg`、源码调用链、测试与 `git diff` 完成影响核对。
