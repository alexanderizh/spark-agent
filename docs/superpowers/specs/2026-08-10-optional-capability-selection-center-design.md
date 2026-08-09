# 首次资源选择与统一后台安装中心设计

> 状态: 已落地 | 最后核对: 2026-08-10

## 目标

将首次安装时的按需资源选择扩展为统一能力清单，并确保弹窗只在新手引导完成后出现。用户确认后弹窗立即关闭，所有所选资源进入后台队列；右上角统一展示任务进度，原有设置「完整性」入口继续可用。

## 能力顺序与边界

清单顺序固定为：

1. Codex 本地运行环境（仅缺失或可更新时显示）
2. 离线 Office 预览
3. 本地深度处理
4. FFmpeg
5. Chromium 浏览器运行环境
6. 语音输入资源

Codex 指的是与应用内 JS SDK 匹配的 native runtime，不把应用内已打包的 JS SDK 当作可下载资源。Chromium 条目复用现有 Playwright browser 安装入口；Playwright MCP 包仍由完整性页管理，不在首次选择中拆成第二个条目。语音条目包含既有 native runtime 与模型两个制品。

## 架构

`OptionalCapabilityManager` 继续负责 manifest 缓存、队列、状态快照和统一进度。Office/深度沿用现有能力包原子安装流程；Codex、FFmpeg、Chromium、Voice 通过适配器调用已有完整性服务，并将已有状态/进度映射到统一协议。这样不会复制下载、SHA-256、平台选择和健康检查逻辑。

渲染端继续通过 `useOptionalCapabilities` 订阅单一快照与进度流。`OptionalCapabilityCenter` 在 Shell 中仅于 `t.view !== 'onboarding'` 时挂载；引导完成后重新挂载并执行一次能力检查，避免依赖启动时机或早期 stream 事件。

## 状态与错误

统一条目继续使用 `checking/missing/queued/downloading/verifying/extracting/activating/ready/update_available/damaged/error`。外部服务不支持取消时，进度卡不显示取消按钮；任务仍在后台完成，失败沿用原服务错误信息并允许从完整性页重试。已有 archive 能力保留取消与原子回滚。

## 验收

- 新手引导视图不会出现“可选功能资源”弹窗。
- 引导完成后，缺失且可安装的能力按上述六项顺序展示，默认全部不勾选。
- 选择任意多项后，弹窗关闭，安装调用异步执行，右上角显示统一进度。
- 现有 Office/深度测试保持通过；新增测试覆盖能力顺序、门控和外部安装进度映射。
- 相关 docs 状态行和任务状态文件保持更新；GitNexus 不可用时以源码与 diff 核对替代。
