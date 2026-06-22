# 会话内文件输出与打开体验设计

> 状态: 已落地 | 最后核对: 2026-06-22

## 背景

会话内目前同时存在 Markdown 文件链接、单文件变更卡片、回合文件总结卡片三种文件展示形态。它们之前各自处理点击行为，导致 `file://` 链接不可用，Office/PDF 产物会被当作代码文件交给编辑器打开，而不是进入应用内置预览。

## 目标

- 会话中出现的本地文件引用都优先规范化为磁盘路径，包括 `file://` URL、绝对路径和相对 workspace 路径。
- PDF、Word、Excel、PowerPoint、图片、Markdown、HTML、文本等可预览文件，点击主入口优先使用应用内预览。
- 不可预览文件保留原有外部打开能力，包括默认应用、文件夹定位、编辑器、终端和文档应用打开。
- 三种文件展示形态共享同一套文件类型识别和图标策略，避免行为继续分叉。
- Agent 在消息里输出 Office、PDF、TXT、Markdown 等文档访问链接时，优先以文档卡片展示；代码文件仍保留轻量文本链接。

## 设计

新增共享文件展示工具 `FileDisplay.tsx`，集中提供：

- 文件引用规范化：`file://` 解码、本地路径判断、尾部标点剥离。
- 预览类型判断：Markdown、HTML、图片、文本和 Flyfish Viewer 支持的通用文档格式。
- 文件类型元数据：扩展名、色彩 tone、文档类型和图标。
- 文件图标组件：Office/PDF 使用内置文档徽章，常见代码文件使用本地 vendored SVG 图标。

会话渲染层的职责收敛为：

- Markdown 显式链接如果指向本地文件，则渲染为 `ClickableFilePath`。
- Markdown 中独立成段的文档链接或路径会渲染为文档卡片，展示类型图标、文件名、路径摘要和预览/打开入口。
- 同一条消息内重复出现的同一文档只渲染第一张卡片，避免 Agent 同时输出绝对路径、`file://` URL 和相对路径时造成视觉重复。
- `ClickableFilePath` 点击时对可预览类型触发右侧 `FilePreviewPanel`。
- `FilePreviewPanel` 打开时关闭其他右侧面板，保持右侧抽屉互斥；面板默认使用更宽的预览宽度，支持从左侧拖拽伸缩、键盘调宽和双击恢复默认宽度，并使用实色背景压住第三方 viewer 的透明区域和底部 footer。
- `FilePreviewPanel` 右上角提供默认应用打开按钮，通过 `file:open` 调用宿主系统文件关联打开当前预览文件。
- `FileChangeCard` 与 `TurnFileSummaryCard` 使用会话专用 `SessionFileOpenPicker`，不复用项目顶部打开器。
- `SessionFileOpenPicker` 主按钮优先预览可预览文件，菜单提供默认应用、文件夹中显示、文档应用、编辑器、终端和重新检测。
- 外部工具检测新增 `document` 类型，用于 WPS Office 和 Microsoft Office 系列应用；文档类文件菜单会优先展示匹配的文档应用。

## 图标来源

常见代码文件图标从 Atom Material UI iconGenerator 固定提交下载并内置在 `apps/desktop/src/renderer/assets/file-icons/`，只保留高频类型以控制包体积。Office/PDF 图标使用应用内 CSS 徽章，不依赖外部素材。
