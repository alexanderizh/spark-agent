# Computer Use V2 · Phase 0 诊断与指标基线阶段审查

> 日期: 2026-07-31 | 阶段: Phase 0 | 结论: 自主代码交付物完成，真实安装包与真机基线待 Phase 1 签收

## 1. 范围与完成边界

本阶段完成不依赖开发者工具的只读 Native Host 诊断、Computer Use Beta 标识、细粒度故障阶段归因和内容无关的性能指标采集。真实 macOS DMG / Windows NSIS 失败包、签名摘要与四步任务性能数值需要最终安装包和真机环境，保留为发布签收项，不以 mock 或单元测试数据冒充。

## 2. 实现审查

- 协议新增 `computer-use:diagnose-native-host`，报告包含 correlationId、App/OS/CPU、Host/协议版本、权限、`diagnosticCode + stage + repairAction` 和聚合时延。
- Native backend 新增精确探针：产物不可信归入 `verify`，可信产物握手失败归入 `handshake`，Host 缺失归入 `discover`。
- IPC 仅允许受信任顶层 Renderer 调用；MCP 新增 `diagnose_native_host`，用户无需打开开发者工具即可获取可复制报告。
- `get_capabilities` 明确返回 `releaseChannel: beta`，工具描述在不可用时引导调用诊断。
- `ComputerUseMetricsCollector` 仅保存固定上限的数值样本，按 platform/architecture/App version/Host version/trust mode 分桶，不接收截图、文本、目标或输入内容。
- Backend 接入 capability、permission、observation、action 四类计时；takeover 与四步任务指标在 Phase 4/5 接真实转换点。

## 3. 三遍缺陷复核

1. **契约与权限复核**：诊断通道存在于 schema registry 和 typed channel map；未受信 Renderer 与其他 Computer Use 特权通道一样 fail-closed。
2. **安全与隐私复核**：诊断不返回文件路径、签名明文、截图、输入文本或目标内容；诊断与指标均为旁路，不参与 policy、approval、dispatch 决策。
3. **失败归因复核**：`NativeHostArtifactError` 的既有 diagnostic 原样保留；缺失 diagnostic 时才按 error code 建立稳定 fallback，避免把 trust failure 误报为 handshake failure。

## 4. 验证证据

- 完整 Computer Use 相关回归：40 个文件、270 项全部通过；其中回环 HTTP 套件按原命令在允许监听 `127.0.0.1` 的测试环境运行。
- 新增覆盖：指标 percentile/失败计数、诊断脱敏报告、trust 与 handshake 分层、IPC 权限、MCP 工具暴露与 Agent Controller 路由。
- desktop 全量 typecheck：未通过；错误来自已提交的 Phase 2/3/5 Timeline/batch/Supervisor 测试与联合类型，不属于 Phase 0 新增代码。Phase 0 自身唯一字面量推断问题已修复，复跑输出中不再出现本阶段新增文件或改动行错误。

## 5. 安全不变量

click/type 基线 L1、T01 intent 升档、unknown→L2、L2/L3 unattended→handoff、sensitive→L4 handoff、full-access 显式模式、digest/timeout fail-closed 均未修改。诊断失败不会放行动作，指标失败不会改变动作结果。

## 6. 外部签收项

- macOS 失败 DMG 与 Windows 失败 NSIS 的 App/OS/CPU、manifest、App/Host 签名摘要、Host stderr、握手 correlationId。
- 已授权冷启动、首次权限、四步普通任务的真机 P50/P95/P99 基线。
- Beta 发布界面的 Renderer“查看诊断/复制诊断”视觉入口；当前 IPC 与 MCP 已提供无需开发者工具的功能入口，完整 UI 随 Phase 5 状态面板落地。

## 7. 回滚

本阶段为独立提交；回滚不涉及数据迁移。诊断通道和指标采集均为纯增量，`git revert <phase-0-commit>` 可完整撤回。
