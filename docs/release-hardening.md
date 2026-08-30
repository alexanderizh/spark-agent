# 桌面端正式发布加固

> 状态: 已落地 | 最后核对: 2026-07-26

## 发布边界

- Windows 当前允许无签名发布，CI 保留 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1`；更新完整性校验不等同于代码签名，不会误伤无签名安装包。
- 无限画布与调试浏览器需要加载网页、本地文件和自定义协议。外链策略采用危险协议拒绝表，合法自定义协议默认允许；`file:` 仅允许已登记 workspace、Canvas 项目、应用数据和临时目录。
- 内嵌 WebView 保留任意站点、DevTools 和网页能力，但强制隔离 Node/preload，阻止远程页面提升为本地进程权限。
- 本轮不新增 CI 单元测试门禁。发布工作流仍在构建前创建 tag，因为并行 `electron-builder --publish` 依赖已存在的版本 tag。

## 已落地机制

### 更新链

- 官网版本中心的 `sha512` 已传入客户端，安装包流式下载时同步计算摘要。
- 下载结束必须同时满足发布元数据大小和摘要；失败删除临时文件，不进入可安装状态。
- GitHub 历史 Release 没有 digest 时保留兼容并记录警告；新版本中心资产使用强校验。

### 本地数据

- 每个应用版本首次打开已有数据库时，在迁移前原子复制 `spark.db`、`spark.db-wal`、`spark.db-shm`。
- 迁移失败先关闭数据库连接，再恢复本次启动创建的快照并退出，禁止半初始化继续运行。
- 同一版本不会反复覆盖恢复点；只保留最近 5 个版本。

### 安全与隐私

- `safe-file://` 在词法路径检查外增加真实路径检查，阻止符号链接逃逸，并返回 `nosniff`。
- 外部图片不发送 referrer；远程媒体请求、命令和视频处理日志不再记录 prompt、消息正文或本地路径。
- 新安装默认日志级别由 `info` 收敛为 `warn`；显式调试日志仍可由用户开启。
- 媒体结构化日志会遮蔽 secret、prompt/message/content，URL 去除凭据、查询参数和 fragment。

### 产品真实性

- 删除设置页虚假的自动备份、全量导出、审计报告、通知/启动/沙箱等仅保存 UI 状态的控制项。
- 删除 Agent 模板/优化/高级设置、视频“导出整条”、模型 Profile 假编辑器等占位入口。
- 删除未实现的 Skill export IPC 与未知市场 Mock Skill Adapter；不再用假数据冒充能力。
- 媒体 MCP 仅在火山方舟/百炼渠道暴露真实可用的文件管理工具，其他渠道不再展示调用后必失败的入口。
- 历史导入、归档恢复、检查点恢复等真实能力保留。

### 发布与性能

- 已存在版本 tag 必须指向当前发布提交，否则工作流失败并要求提升版本；禁止把新产物覆盖到旧 tag。
- 手动“仅构建/签名验证”不创建 tag；正式发布仍可能在后续构建失败时留下无 Release 的 tag，同一提交可安全重跑。
- 页面、画布窗口、弹窗按需加载；onboarding 判定前移到 splash 阶段，避免首次启动先加载 Chat 再切页。
- 首入口 JS 从改造前约 20.8 MB 降到 5.26 MB；Chat、Canvas、Provider、设置等拆为独立 chunk。
- Canvas 底部工具栏按左右面板后的真实可操作区域居中，避免 Agent 输入层遮挡可见按钮。
- electron-builder 26 的 Windows 签名参数和 Linux desktop entry 已迁移到新 schema；Windows 无证书时仍按明确开关发布未签名包。
- sqlite-vec 各平台原生包改为桌面端直接可选依赖，发布矩阵在对应 runner 上按 OS/架构安装。

## 发布验收

- 全仓 typecheck、unit test、desktop lint 均为 0 error。
- 生产构建、60 个 migration 静态校验和 `electron-builder --dir` 均通过。
- Electron E2E 3/3 通过：首次引导、主侧栏、无限画布工作流、创建 Canvas 项目与工作流抽屉。
- 依赖树确认不再包含 `electron-updater`，Playwright MCP CLI 与修复后的传递依赖可解析。
- OSV 对 1458 个唯一 npm 包版本复核后仅剩两类已评估告警：旧版 `brace-expansion` 仅来自受控构建 glob，强升 5.x 会破坏旧 minimatch CJS；`react-router` 告警仅影响未使用的 unstable RSC API。二者均不进入当前可被外部输入触发的桌面运行路径。
- GitNexus 索引刷新和 `git diff --check` 作为最终变更范围核对。
