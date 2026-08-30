# 桌面窗口 Chrome 布局契约

> 状态: 已落地 | 最后核对: 2026-07-30

## 目标

macOS 原生红黄绿按钮属于窗口系统层，侧栏搜索/折叠按钮属于应用导航层，各页面
Header 属于业务层。三者可以共享几何安全区，但不能互相拥有或复制对方的布局逻辑。

本契约解决以下问题：

- 悬浮侧栏与扁平侧栏切换后，原生按钮和侧栏操作按钮纵向漂移；
- 侧栏折叠后，各页面重复维护 `70px`、`90px`、`92px` 等红绿灯避让值；
- 聊天、画布和独立画布窗口使用不同 Header 时，需要继续保留各自业务结构；
- 系统缩放、Electron 或 macOS 原生控件尺寸变化后，硬编码坐标失效。

## 分层

### 系统层

主窗口和独立画布窗口启用 Electron Window Controls Overlay。Electron 负责原生窗口
按钮的位置、状态和可访问性，并向渲染层发布：

- `env(titlebar-area-x)`
- `env(titlebar-area-y)`
- `env(titlebar-area-width)`
- `env(titlebar-area-height)`

Window Controls Overlay 只负责发布可用区域，不保证 `hiddenInset` 灯组随自定义高度
自动垂直居中。主进程因此仍设置 `trafficLightPosition`，但其纵坐标由统一的
`WINDOW_CHROME_HEIGHT` 和 macOS 原生按钮直径推导，不再与页面 Header 分别调参。

### Shell 层

`.window` 将系统值归一为两个应用变量：

- `--window-titlebar-height`
- `--window-titlebar-safe-left`

侧栏样式只控制 `--sidebar-frame-inset`、圆角、阴影和主区 gutter。悬浮侧栏的顶部
外边距不能改变窗口标题栏基线，因此其 Header 使用负 margin 回到窗口坐标系；
扁平侧栏的 inset 为零，不需要额外分支。

### 页面层

聊天、画布、设置等页面继续保留各自 Header 组件和视觉样式。只有当页面 Header
承担窗口标题栏职责时，才消费 Shell 变量：

- 高度使用 `var(--window-titlebar-height)`；
- macOS 左侧避让使用 `var(--window-titlebar-safe-left)`；
- Header 容器使用 `-webkit-app-region: drag`；
- 按钮、输入框、链接使用 `-webkit-app-region: no-drag`。

禁止页面重新声明红绿灯坐标或新的固定安全区数值。

## 回退

浏览器预览、测试环境或不支持 Window Controls Overlay 的平台使用 `52px` 高度和
`90px` 左侧安全区回退值。Windows/Linux 继续使用现有 HTML 窗口控制按钮，不受
macOS 原生覆盖层变更影响。

## 验证矩阵

- macOS：侧栏悬浮 / 扁平 / 折叠；
- 页面：聊天集成标题栏 / 普通页面 / 画布项目页 / 画布工作区 / 独立画布窗口；
- 窗口：普通 / 最大化 / 全屏退出后；
- 显示：100% 与非整数缩放、浅色与深色。

参考：

- [Electron Custom Title Bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [Window Controls Overlay explainer](https://github.com/WICG/window-controls-overlay/blob/main/explainer.md)
