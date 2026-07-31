# Computer Use V2 Phase 4 · 输入协同切片审查

审查日期：2026-07-31

## 结论

Phase 4 的 execution lane、macOS 输入冲突/用户接管、系统 Tray、AppControlBridge 与精确目标窗口绑定切片已经落地并通过聚焦回归；Phase 4 整体仍处于实施中，不能以本报告代替最终阶段验收。未完成项为 300 ms P99 真机测量、产品 picker UI/控制标签与 Windows 对等实现。

## 本切片覆盖

- action envelope 显式声明 `background_semantic | foreground_input | passive`，TypeScript 与 Swift 双端拒绝 lane/action 不匹配。
- 后台 AX 语义动作不激活目标应用；前台 CGEvent 动作等待 300 ms 用户输入空闲，动作结束恢复原前台应用与指针。
- Host 注入的鼠标、滚轮和键盘事件统一写入来源标记，listen-only Event Tap 不把它们误判为用户操作。
- 用户点击绑定窗口时会话进入接管态；观察后、首次动作前发生的点击通过最近点击记录补偿绑定竞态。
- `handoff_required` 从 Swift wire 映射到 Broker error，Operator 转入 `handoff_required/user_takeover`，不把主动接管误记为任务失败。
- 主进程 Tray 实时投影实际 Computer Session 状态，只显示绑定应用标识而不泄露 objective/input，并通过 Broker 提供暂停、立即接管、停止控制。
- AppControlBridge 仅支持 `set_theme/navigate/prefill_composer` 三类协议枚举命令；命令经过 Broker L1/intent 升档，精确绑定 session/action/command，只有受信主 Renderer 可回执，成功后重新观察并显示操作 toast。`prefill_composer` 只填当前会话的空草稿，不发送、不覆盖已有输入，敏感文本标记进入 credential/L4 handoff。
- Agent 工具与 Renderer IPC 都可用 `targetWindowId` 绑定 `list_windows` 返回的精确窗口；绑定后前台切换不会改变目标，窗口消失时以 `focus_mismatch` fail-closed。
- 新窗口必须先暂停会话，再由拥有该会话的 Agent/Renderer 显式调用 `bind_target`/`computer-use:bind-target` 加入，并重新匹配任务契约中的 signing/bundle/executable/app identity；不允许在动作执行中换绑，也不允许仅凭标题或当前焦点加入。

## 三遍审查

### 第一遍：需求与调用链

- 核对 observation binding → Native Host execute → Event Tap → wire error → NativeHostClient → Backend/Broker → Operator 全链路。
- 后台语义通道不等待用户在其他应用的输入；只有前台输入通道等待空闲窗口。
- 目标窗口点击属于 fail-closed 接管，后续动作不再执行。

### 第二遍：安全与竞态

- 所有直接 CGEvent post 均经来源标记；指针恢复也使用带标记事件。
- 接管检查位于 dispatch 前与长输入过程的目标复核回调内；drag 既有 mouse-up defer 保留。
- Event Tap 创建失败时 capability 的 `inputAvailable` 为 false，不把无法证明“用户未接管”的前台输入能力宣传为可用。
- 首次启动尚未授权导致 Event Tap 创建失败时，权限请求完成后会重试创建，不要求用户重启 Host 才恢复能力。
- observation 与首次 execute 之间的用户点击通过 `capturedAt + lastUserPointerDown` 检测，避免仅靠当前焦点造成漏判。

### 第三遍：回归与边界

- `swift test`：42 项通过，新增 `userTakeover → handoff_required` wire 映射断言。
- 聚焦 Vitest：3 文件 46 项通过，新增 Native Host 接管后 Operator handoff 且不 fail 的断言。
- `tsc -p apps/desktop/tsconfig.node.json --noEmit`：exit 0。
- Tray/Session 聚焦 Vitest：2 文件 11 项通过；状态订阅 listener 失败不会反向破坏会话状态转换。
- AppControlBridge/协议/IPC/策略/Renderer 聚焦 Vitest：11 文件 79 项通过；任意 eval command、跨会话回执、非 SparkWork 目标、取消/无 Renderer 均 fail-closed。
- 目标绑定聚焦 Vitest：普通沙箱 4 文件 63 项通过，MCP Bridge 回环测试 4 项在允许监听 `127.0.0.1` 的环境通过；desktop node 与 protocol typecheck 均 exit 0。
- 表单白名单 command 聚焦 Vitest：8 文件 53 项通过；覆盖 schema 长度上限、空草稿写入、已有用户输入/错误会话拒绝、敏感草稿 data class 与 L4 handoff；desktop renderer/node 与 protocol typecheck 均 exit 0。
- Computer Use 全量回归共 43 文件 285 项：普通沙箱先通过 277 项，7 项回环 HTTP 因 `listen EPERM` 在允许监听 `127.0.0.1` 的环境复跑通过；审批审计夹具补齐缺失的 `turnId` 后通过。desktop node/renderer 双 tsconfig 均 exit 0。
- click/type L1、T01 intent 升档、unknown→L2、unattended/sensitive handoff、approval ticket、digest/timeout fail-closed 等治理路径未修改。

## 剩余验收

1. 在真实签名 App 上采集用户点击目标窗口到 Host 停止输入的 P50/P95/P99，P99 必须小于 300 ms。
2. 用 20 个后台 AX 语义动作跑跨应用连续输入，确认无焦点跳转和字符串串入。
3. 补齐目标窗口内的控制标签/入口，并做系统 Tray、产品状态与实际会话状态的真实界面联测。
4. 完成产品 picker UI/控制标签与 Windows 对等方案后，再出 Phase 4 最终审查。
