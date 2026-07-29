# Office 文档离线预览

> 状态: 已落地 | 最后核对: 2026-07-30

## 目标

会话内的 DOCX、XLSX、PPTX 文档卡片在无网络环境下也能完成预览。实现不能依赖
CDN、浏览器对 `safe-file://` 的 `fetch()` 支持，或运行时自动发现 renderer。

## 加载链路

本地文档由 `file:read-binary` IPC 读取为 `ArrayBuffer`。主进程在读取前复用
`isSafeFilePathAllowed` 白名单校验，渲染进程将二进制数据直接交给 File Viewer。
HTTP(S) 文档仍使用 URL 加载，不经过本地文件 IPC。

Office renderer 通过 `@file-viewer/preset-office` 显式装配。DOCX、XLSX、PPTX/PPT
所需 Worker、WASM、字体和辅助脚本由 `prepare:file-viewer-assets` 复制到
`apps/desktop/public/file-viewer`，Electron Vite 再将该目录包含进
`out/renderer/file-viewer`。资源 URL 基于 `document.baseURI` 解析，使开发服务器
与打包后的 `file://.../out/renderer/index.html` 使用同一套相对路径。

## 窗口与布局

预览面板宽度必须同时为聊天主区和窗口边缘预留空间。Viewer 浮动工具栏使用紧凑
密度并保持单行；当 Viewer 容器宽度不超过 680px 时，通过公开的
`::part(toolbar)` 接口整体隐藏，避免裁切或换行。Viewer 的 `light` / `dark`
主题跟随应用解析后的主题状态，不直接跟随操作系统；Viewer 自带的主题切换按钮
关闭，避免产生第二套主题状态。主题更新触发 Viewer 重载前保存视图状态，在新主题
渲染完成后恢复阅读位置与缩放。预览头部是 Electron 拖拽区；操作按钮和缩放把手是
`no-drag` 区。头部双击调用统一的 `window:maximize` IPC，在自定义标题栏环境中切换
最大化与还原。

## 验证要求

- 在浏览器上下文离线模式下分别打开 DOCX、XLSX、PPTX；
- 确认三种 renderer 均实际创建，且无失败网络请求或控制台错误；
- 核对工具栏、头部按钮与预览面板均未越出视口；
- 调整面板宽度，确认工具栏在宽面板中单行显示、在 680px 及以下隐藏；
- 切换应用明暗主题，确认 Viewer 自动同步，并核对阅读位置与缩放状态；
- 验证头部双击最大化与再次双击还原；
- 构建后逐项确认 Office Worker、WASM 和字体存在于 `out/renderer/file-viewer`。
