# Computer Use V2 Phase 4 · 输入协同切片审查

审查日期：2026-07-31

## 结论

Phase 4 的 execution lane 与 macOS 输入冲突/用户接管切片已经落地并通过聚焦回归；Phase 4 整体仍处于实施中，不能以本报告代替最终阶段验收。未完成项为 300 ms P99 真机测量、系统/产品控制状态、目标 picker 与新窗口来源证明、AppControlBridge，以及 Windows 对等实现。

## 本切片覆盖

- action envelope 显式声明 `background_semantic | foreground_input | passive`，TypeScript 与 Swift 双端拒绝 lane/action 不匹配。
- 后台 AX 语义动作不激活目标应用；前台 CGEvent 动作等待 300 ms 用户输入空闲，动作结束恢复原前台应用与指针。
- Host 注入的鼠标、滚轮和键盘事件统一写入来源标记，listen-only Event Tap 不把它们误判为用户操作。
- 用户点击绑定窗口时会话进入接管态；观察后、首次动作前发生的点击通过最近点击记录补偿绑定竞态。
- `handoff_required` 从 Swift wire 映射到 Broker error，Operator 转入 `handoff_required/user_takeover`，不把主动接管误记为任务失败。

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
- click/type L1、T01 intent 升档、unknown→L2、unattended/sensitive handoff、approval ticket、digest/timeout fail-closed 等治理路径未修改。

## 剩余验收

1. 在真实签名 App 上采集用户点击目标窗口到 Host 停止输入的 P50/P95/P99，P99 必须小于 300 ms。
2. 用 20 个后台 AX 语义动作跑跨应用连续输入，确认无焦点跳转和字符串串入。
3. 完成系统状态/产品状态/实际会话状态的一致性链路。
4. 完成 picker、new-window provenance、AppControlBridge 与 Windows 对等方案后，再出 Phase 4 最终审查。
