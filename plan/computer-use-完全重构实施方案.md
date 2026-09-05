# Computer Use 完全重构实施方案（对齐 Codex Sky CUA）

> 状态: 已落地（M1–M4 + 可用性冲刺 R1 + 资源泄漏修复 R2 全部完成，待真机验收） | 最后核对: 2026-09-05
>
> 前置文档: [codex-computer-use-逆向解析与复刻方案.md](./codex-computer-use-逆向解析与复刻方案.md)（六轮逆向证据）
> / [computer-use-开发实施规格书.md](./computer-use-开发实施规格书.md)（协议与算法规格）
>
> 本文基于对现有实现的**逐文件代码审读**（Swift 宿主全部核心文件 + TS 服务层全链路），把「为什么不好用」定位到 7 个根因，并给出保留什么、重写什么、怎么验收的完整实施计划。

---

## 0. 一句话诊断

**架构骨架已经和 Codex 同构**（独立 Swift 宿主进程 + 签名信任链 + AX 语义/CGEvent 双通道 + 接管检测 + 心跳监督），**真正的问题在骨肉**：模型看到的界面 representation 是劣质的（平铺 JSON、无层级、无稳定 ID、diff 失效、截图被压到 1200px）、反馈循环是双倍开销的（每步 2 次截图 + 1 次全树遍历、无动作后 Skyshot）、执行通道缺 Codex 的两件武器（CGEventPostToPid 定向投递、焦点伪造通知）、决策架构是内层单轮 JSON 子循环而非模型原生工具调用。**不需要推倒进程拓扑，需要重写感知渲染层、升级协议带 Skyshot、补第三执行通道、把原子工具直接交给会话模型。**

## 0.5 执行原则（用户指令，2026-09-05）

**不需要比 Codex 更严；要达到 Codex 的水准——快、准、狠。宁可少做校验，也要功能完整、可完美使用。**

落到本方案：

- 凡「校验/安全严格性」与「功能完整性/使用体验」冲突，一律优先功能；
- **不新增**审批门、签名校验层、策略裁决层；现有过度校验在阻碍可用性时可简化或旁路；
- 一切开发优先级以感知精度、执行成功率、反馈速度为准；
- D1 中「保留信任链」指保留现有拓扑不推倒，**不是**在此基础上继续加码。

---

## M1 落地记录（2026-09-05，第一切片）

已完成并验证（Swift 61/61 测试通过；TS typecheck + 42/42 相关测试通过）：

| 项                 | 内容                                                                                                                                               | 文件                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Markdown 渲染器    | 层级 outline（2 空格缩进）、`- role "name" = "value" [id]` 行格式、噪声叶剪枝、勾选框状态标记、精确 90k 预算 + 截断标记                            | `SparkComputerHostCore/NativeAXTreeRenderer.swift`（新增）+ 测试 |
| 行索引短 ID        | ID = 渲染行号（"1","2",…），与渲染文本中的 `[n]` 标记天然同步                                                                                      | `MacControlPolicy.publish` 重写                                  |
| 内容指纹版本号     | treeVersion = SHA256(渲染文本+元素数)，静止画面跨帧版本相同（原实现掺入 publish 计数器，永远变）                                                   | 同上                                                             |
| **移除 diff 模式** | 原 diff 门控逻辑颠倒（树没变才 diff）、索引 ID 使 diff 全量化——直接删掉，macOS 恒发 full；TS Reconciler 仅对 `diff` 模式动作，Windows 宿主不受影响 | 同上                                                             |
| frameId 去时间戳   | frameId = SHA256(截图字节 + treeVersion)，静止画面两次观察同 frameId                                                                               | `MacScreenCaptureProvider.swift`                                 |
| depth 字段         | `NativeAXRawElement` 增 `depth`，采集器透传（渲染器靠它重建层级）                                                                                  | `MacAccessibilityController.swift`                               |
| 提示词双 JSON 消除 | 删除 `Element references:` 第二份 48k 元素转储（R1 后半）；系统提示词说明 outline 格式与 `[n]` id 用法                                             | `ComputerDecisionAdapter.ts`                                     |

**与原 W1 计划的偏差**（均为简化，非降级）：

- ID 方案用「渲染行号」而非「内容指纹继承」（W1.3）：模型永远基于最新树动作，跨帧稳定无必要；行号与渲染文本零成本同步，消除 ID/文本不一致这一整类 bug。跨帧继承留待确有需要时再加。
- 行格式 id 放行尾（`… [17]`）而非行首：解析等价、生成更简单。
- W1.1 字段扩展（roleDescription/placeholder/url/…）与 W1.5 settle 尚未做，属后续切片。

W1 剩余：settle（AXSettlePolicy）、字段扩展、大容器可见子集渲染、离屏剪枝。之后进入 W3（Skyshot 协议 v2，M2）。

---

## M1–M4 落地记录（2026-09-05，全部完成）

全部四个里程碑已实现并验证：**Swift 75/75 测试通过；TS computer-use 全目录 45 文件 334/334 通过 + typecheck 干净；protocol 包 327/327 通过；agent-runtime computer-use 5/5 通过**。真机验收按惯例由用户手动执行（清单见 §3 W5）。

### M1 收尾（W1 剩余项）

| 项                  | 内容                                                                                                                                                                                | 文件                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 采集字段扩展        | `roleDescription`（AXRoleDescription，人类词汇优先于 AXRole）、`placeholder`（空文本字段）、`selected`（行/单元格/Tab/菜单项）、`childCount`；仅对相关角色采集，控制每元素 XPC 成本 | `MacAccessibilityController.collect`         |
| 大容器截断          | 每容器最多遍历前 120 个子元素（`maxChildrenPerContainer`），渲染行尾标注 `(1250 items, first 120 shown)`                                                                            | `NativeAXTreeRenderer` + collector           |
| 离屏剪枝            | 与 AX 窗口 frame 求交（96px 余量）剪除完全离屏子树；保守策略：零尺寸元素保留（web 布局容器常报 0 尺寸带真实子元素）                                                                 | `MacAccessibilityController.collect`         |
| **settle 等待策略** | 纯状态机 `NativeSettlePolicy`（基线 200ms → 静默窗口 300ms 无 AX 变化且无 busy → 稳定；硬上限 1.5s 防动画界面卡死）+ `waitForSettle` 轮询 dirty generation 与 AXElementBusy         | `NativeSettlePolicy.swift`（新）+ controller |

### M2 Skyshot 协议 v2（W3）

| 项                     | 内容                                                                                                                                                      | 文件                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 协议字段（全向后兼容） | envelope 增 `includeSkyshot`（可选）；`action_result` 增 `skyshot`（完整 observation 结构）+ `payload`（PNG 描述符）；双端 schema 同步                    | `NativeComputerAction.swift` / `native-wire.ts` / `action.ts`                       |
| Swift 侧管线           | 动作完成 → settle → 新截图（persistent 帧优先）→ 树重采集 → frameID 重算 → **会话绑定更新为新帧**（下一步动作可直接链接）→ 一次性返回；失败不阻断动作本身 | `MacScreenCaptureProvider.buildSkyshot`                                             |
| TS 侧消费              | backend 收到 skyshot 且非前台跟随场景时：直接合成 ComputerObservation、落证据、更新会话状态，**跳过二次 observe 往返**；v1 宿主/被动通道自动回退旧路径    | `NativeHostComputerUseBackend.execute`                                              |
| 二进制跟随帧           | `action_result` 带 payload 时客户端自动等待相邻 binary 帧 + sha256 校验                                                                                   | `NativeHostClient.handleFrame`                                                      |
| 超时预算               | skyshot 请求超时 +6s（settle+截图+树遍历）                                                                                                                | `actionRequestTimeoutMs`                                                            |
| 平台隔离               | skyshot 请求仅发 macOS 宿主（Windows Rust 宿主未学新字段，避免严格解码拒绝）                                                                              | backend `requestSkyshot` 判定                                                       |
| 灰度                   | `actionSkyshot` V2 flag 默认开，环境变量/运行时回滚可用                                                                                                   | `computerUseV2Flags.ts`                                                             |
| **决策图全分辨率**     | 决策模型输入改用**全分辨率涂灰图**（坐标精度只受截图本身限制）；持久审计保留 1200px 涂灰缩略图                                                            | `EvidenceStore.decisionImageProcessor` + `createRedactedEvidence(options.maxWidth)` |

### M3 执行增强（W2）

| 项                          | 内容                                                                                                                                                                                                                                                                                                 | 文件                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **background_pid 第三通道** | `CGEventPostToPid` 定向投递：click（任意键）/drag（16ms 插值）/scroll（像素精确）/move/keyChord/typeUnicode 全套；不抢焦点、不经全局 HID、可直达被完全遮挡窗口与自绘控件；前置 `prepareWindow`（AXRaise + kAXMain，不激活 app——焦点伪造的可用子集，AXUIElementPostNotification 在当前 SDK 不可链接） | `MacPidEventInjector.swift`（新）            |
| 决策树三级化                | background_ax（语义）→ background_pid（仅窗口非前台时）→ foreground_cg（兜底）；通道如实回报                                                                                                                                                                                                         | `MacScreenCaptureProvider.executeActionCore` |
| 拟人节奏                    | 点击 down→40ms→up，连击间隔 100ms（Codex 实测值）；type_text 分块间隔 2ms→8ms（降低吞字）                                                                                                                                                                                                            | `MacCGEventController` + injector            |
| **布局感知键码**            | `UCKeyTranslate` + `TISCopyCurrentKeyboardLayoutInputSource` 运行时构建字符→(keycode, shift) 映射（进程内缓存），US-ANSI 表降级为兜底——非美式键盘布局不再打错字符；shift 判定同样布局感知                                                                                                            | `NativeKeyCodeLayout.swift`（新，Core）      |

### M4 原子工具直暴露（W4）

| 项                   | 内容                                                                                                                                                                                                                                                          | 文件                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 隐式会话服务         | 每个 agent 会话一个隐式 computer session（懒创建、跨 turn 存活、agent 销毁时释放）；observe→dispatch 单动作链路；stale_frame/tree 自动重观察重试一次                                                                                                          | `ComputerAtomicActionService.ts`（新）                     |
| 10 个原子工具        | `click`（at: elementId/coordinate, clickCount, button）/ `type_text`（into 聚焦 + submit 回车）/ `set_value` / `invoke_element` / `press_key`（"cmd+shift+t" 和弦解析）/ `scroll` / `drag` / `select_text` / `perform_secondary_action`（右键）/ `screenshot` | `ComputerAtomicToolHandlers.ts`（新）                      |
| 每次响应自带 Skyshot | 动作状态 + 真实通道 + 新 Markdown 树 + `[n]` id + **全分辨率截图（MCP image content block，视觉模型直接看）**                                                                                                                                                 | handlers + `ComputerUseAgentBridge.buildToolResultContent` |
| 治理复用             | 全部走 broker.dispatch（策略评估 → 原生宿主 → 证据链），与 start_task 同一治理面；`policyContextFor` 提取为共享模块                                                                                                                                           | `ComputerActionPolicyContext.ts`（新）                     |
| 工具面接线           | bridge MCP_TOOLS/ALLOWED_TOOLS + `COMPUTER_USE_AGENT_TOOL_NAMES` + controller invoke case + `get_capabilities` 返回 atomicTools 清单                                                                                                                          | bridge / provider / controller                             |
| 系统提示词重写       | 双模式工作流：原子工具直控优先（工具优先级、元素树用法、stale 恢复、失败换策略）+ start_task 作为委托模式保留                                                                                                                                                 | `computer-use-system-prompt.ts`                            |
| 模式 B 复用          | start_task 内循环自动受益于新感知（Markdown 树）+ skyshot（动作后观察免费）                                                                                                                                                                                   | 无需改动（backend 层透明）                                 |

## 可用性冲刺 R1 落地记录（2026-09-05，用户实测反馈驱动）

用户真机实测判定「根本无法使用」：截图显示一个「打开应用→输入→点击」任务耗时 6 分半、步骤日志全是无信息模板（11 步「准备执行操作（L1）」）、外层模型先直试失败再退回 start_task 委托、每步 1-2 分钟模型调用空窗。根因定位与修复：

### R1-1 模型图压缩（最大性能单点）

| 项                 | 内容                                                                                                                                                                                                | 文件                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 决策图 1600px JPEG | M2 的「全分辨率决策图」在 Retina 下每步产生 4-14MB PNG base64——这就是每步 1-2 分钟空窗的元凶。改为长边 1600px、质量 85 的 JPEG（≈300KB，≈20x 压缩）；视觉模型内部本来就会降采样，小控件可读性不受损 | `ElectronSnapshotImageProcessor.createModelFacingImage`           |
| 几何信息贯通       | 证据缓存携带模型图 {bytes,width,height,mimeType}；原子工具的 coordinate 输入按模型所见尺寸归一化（`coordinate[0]/dims.width`），坐标映射永远与模型看到的图一致                                      | `ComputerObservationEvidenceStore` + `ComputerAtomicToolHandlers` |
| 审计不变           | 持久审计仍为 1200px 涂灰缩略图                                                                                                                                                                      | 不变                                                              |

### R1-2 步骤日志信息化（界面输出质量）

| 项               | 内容                                                                                                                                         | 文件                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 动作摘要         | 协议层 `describeComputerAction`：每个动作生成一行人类可读中文摘要（`点击 元素 [42]`、`输入 "comfyui"`、`滚动下 480px`、`按键 cmd+shift+t`…） | `packages/protocol/src/computer-use/action-summary.ts`（新） |
| 事件携带 summary | `computer_action_requested/blocked/executed/failed` 四个事件点携带摘要并持久化进时间线                                                       | `ComputerControlBroker` + `events.ts`                        |
| 渲染折叠         | 活动卡每个动作只显示一行：requested 在出现同 actionId 终态后折叠（避免「准备执行+已执行」双行模板噪音）；进行中的动作显示「正在 {summary}」  | `ComputerActivityBlock` + i18n                               |

### R1-3 焦点伪造完整版（用户点名任务）

| 项             | 内容                                                                                                                                                                                                                                           | 文件                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| SPI 软链接     | dlsym 解析 `_AXUIElementPostNotification`（运行时符号实测存在于 HIServices，但不在公开 SDK 头文件——Codex 同款 SoftLink 手法）；向目标 app 元素投递 `AXApplicationShown/Activated`，向窗口元素投递 `AXFocusedWindowChanged/AXMainWindowChanged` | `MacFocusForger.swift`（新）        |
| 分布式通知通道 | 同名 AX 通知经 `DistributedNotificationCenter` 投递（Codex 二进制中观察到 `postNotificationName:object:userInfo:…` 选择器模式）；无观察者时无害                                                                                                | 同上                                |
| 安全网         | 连续失败 8 次自动熔断 + `SPARK_CU_DISABLE_AX_POST=1` 保险开关；全部 best-effort，失败不阻断注入                                                                                                                                                | 同上                                |
| 接线           | `prepareWindow` 在 AXRaise+Main 之后执行完整伪造，覆盖 background_pid 全部动作路径（click/drag/scroll/keypress/typeText）                                                                                                                      | `MacPidEventInjector.prepareWindow` |

### R1-4 虚拟光标动画（用户点名任务）

| 项       | 内容                                                                                                                                                      | 文件                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 覆盖层   | 全屏透明 NSPanel（statusWindow 层级、`ignoresMouseEvents`、宿主 `.prohibited` 激活策略——永不抢焦点、永不拦截输入）；CALayer 箭头光标（白描边+系统强调色） | `MacVirtualCursor.swift`（新）        |
| 动画     | 移动 120ms ease + 到位果冻回弹（0.9→1.14→1.0）；按压 0.82 缩放/释放过冲回弹；空闲 1.2s 后 500ms 淡出                                                      | 同上                                  |
| 坐标     | CGGlobalPoint（顶左原点）→ AppKit 全局（左下原点）正确换算；按目标屏自动迁移面板                                                                          | 同上                                  |
| 宿主重构 | AppKit 拥有主线程 run loop（`NSApplication.run`），stdio 协议循环改 detached；stdin 关闭即整体退出（生命周期与旧版一致）                                  | `HostMain.swift`                      |
| 接线     | 语义 AX 动作（光标移到元素中心+按压）、background_pid 全路径（click/drag 沿路径/scroll/keyboard 移到窗口中心）——语义动作首次对用户可见                    | `MacScreenCaptureProvider` + injector |

### R1-5 PIP 实况浮窗（用户点名任务）

| 项     | 内容                                                                                                                           | 文件                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 投影   | 纯函数折叠时间线事件 → {目标标签, 状态, 最近动作摘要}；终态滞留 2.5s 后退场                                                    | `ComputerUsePipProjection.ts`（新，6 测试） |
| 窗口   | 300×108 无边框置顶非聚焦小窗（右下角、跨空间、毛玻璃深色卡）：状态色点（观察蓝/执行橙/等待确认红/完成绿）+ 目标 + 当前动作摘要 | `ComputerUsePipService.ts`（新）            |
| 数据源 | 复用 broker timeline 订阅（与渲染器活动流同源，天然吃到 R1-2 的摘要）                                                          | services 装配                               |
| 灰度   | `pipPanel` V2 flag 默认开，环境变量可关                                                                                        | `computerUseV2Flags.ts`                     |

### R1-6 Windows 端新能力（用户点名任务）

| 项              | 内容                                                                                                                                                                                                   | 文件                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Markdown 渲染器 | 与 macOS 同格式同预算（2 空格缩进层级 outline、行号短 ID `[n]`、行内值、勾选状态标记、噪声叶剪枝、90k 精确预算+截断标记）——模型在两平台读同一格式                                                      | `src/tree_render.rs`（新，5 测试）        |
| 带深度遍历      | `FindAll` 平铺列表（无层级）改为 `ControlViewWalker` DFS 前序遍历，每元素携带 depth（上限 30 层/10 万元素）                                                                                            | `src/windows_host/uia.rs`                 |
| 稳定 ID + 版本  | 元素 ID=渲染行号；treeVersion=渲染文本内容哈希（静止界面跨帧相同）；diff 模式移除（与 macOS 同理：门控反转缺陷）                                                                                       | `src/uia_policy.rs`                       |
| Skyshot         | envelope 学会 `includeSkyshot`；动作成功后 250ms settle → 截图+树重采 → `action_result.skyshot` + 二进制跟随帧 + 会话绑定重绑（下一步动作可直接链接）；任何失败静默省略字段，TS 侧自动回退普通 observe | `src/protocol.rs` + `src/windows_host.rs` |
| 平台门放开      | TS 侧 `requestSkyshot` 移除 macOS-only 判定（两平台宿主均已支持）                                                                                                                                      | `NativeHostComputerUseBackend`            |

### R1 验证（全部真实执行）

- Swift 宿主：`swift build` + `swift test` **75/75**
- Windows 宿主：`cargo test` 10 个测试二进制全绿（含 5 个新渲染器测试）；`cargo check --target x86_64-pc-windows-msvc` 干净
- TS：computer-use 全目录 + 活动卡渲染器 **47 文件 344/344**；protocol 34/34 + typecheck 干净；desktop typecheck 干净；agent-runtime computer-use 5/5

### R1 待真机验收项（新增）

- 后台打字/点击在「拒绝后台输入」的 app 上是否因焦点伪造而生效（R1-3 的直接检验）
- 虚拟光标动画观感（节奏、大小、淡出时机）
- PIP 面板位置遮挡与多任务并存体验
- Windows 端整链路（渲染格式、skyshot 往返、TreeWalker 遍历性能）——需真实 Windows 设备

### 已知边界（诚实声明）

- **真机未验证**：postToPid 对各 app 的实际响应矩阵、prepareWindow 焦点伪造效果、中文输入 type_text、非美式布局 keypress——按既有惯例由用户按 §3 W5 清单手动验收。
- ~~焦点伪造仅实现 AXRaise+Main 子集~~ → 可用性冲刺 R1 已通过 dlsym 软链接 `_AXUIElementPostNotification` 补全（见下）。
- agent-runtime 全量 typecheck 存在一个预存错误（`spark-engine-executor.ts` 找不到 `@spark/agent`，workspace 构建顺序问题），与本次改动无关；agent-runtime 全量测试中 6 个预存失败经 stash 基线对照确认与本次改动无关。
- ~~Windows 宿主 macOS-only~~ → 可用性冲刺 R1 已完成 Windows 感知/渲染/skyshot 对等（见下）；postToPid/布局键码/虚拟光标仍为 macOS-only（Windows SendInput 本身即全局注入，语义动作走 UIA）。

---

## 资源泄漏修复 R2 落地记录（2026-09-05，用户实测反馈驱动）

用户报告：任务完成或中止后，右下角 PIP 观察卡（「我的桌面 · 观察中」）不关闭，被捕获窗口左上角的 macOS 屏幕共享指示器（紫色）不熄灭；会话界面的任务卡全部停在「进行中」。三个根因，全部修复：

| #    | 根因                                                                                                                                                                                                                                                                                  | 修复                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 | **原子工具流每次调用泄漏一个悬挂会话**：`ComputerAtomicActionService.isSessionAlive` 判断 `status === 'active'`，而状态枚举里根本没有 `active`（实际为 observing/planning/…），于是每个工具调用都抛弃旧会话新建一个，旧会话永远 `observing`，卡片永远「进行中」，宿主侧采集流无人停止 | 改为可复用状态集合（`REUSABLE_STATUSES`），一个 agent 会话全程复用一个隐式会话；并接入 `coordinator.claim`（单一桌面输入通道，与 start_task 互斥）                                                                                     |
| R2-2 | **`completeVerified` 只在带 verificationIds 时才发终态事件**：无验证记录的任务完成永远不发 `computer_session_completed`，活动卡与 PIP 全部卡「进行中」                                                                                                                                | 协议放宽 `verificationIds` 允许空数组（向后兼容），事件无条件发射                                                                                                                                                                      |
| R2-3 | **原子会话没有任何回收机制**：普通 turn 结束不触发 stop（设计上仅 clearSessionMemory/cancelTurn 触发），隐式会话与宿主常驻 SCStream（10fps）一直活着 → 紫色共享指示器永不熄灭                                                                                                         | TS 侧 60s 空闲自动释放（每次工具调用重置计时，释放后下次调用透明重建会话）；Swift 宿主 90s 空闲自动停流安全网（`MacPersistentWindowCapture` 记录 lastRequestAt，provider 看守任务到期 `stopPersistentCapture`，下次 observe 透明重启） |

顺手清偿的类型债（tsconfig.node.json 严格模式暴露，均为 R1 未提交改动的残留）：`ComputerUseMetricsCollector`/`ComputerUseBackend`/`ComputerDecisionAdapter`/协议 `ComputerUseExecutionChannelReport` 补齐 `background_pid`；`NativeHostClient.AwaitingBinary` 纳入 `action_result` 二进制响应并重排窄化；`ComputerAtomicActionService` 的 `ComputerUseServices` 改从本地模块导入；测试夹具更新（readLatestImage 几何对象形状、PIP 断言可选链）；删除 protocol 陈旧 `dist` 构建残留。

### R2 验证（全部真实执行）

- Swift 宿主 `swift build` + `swift test` **75/75**
- TS computer-use 全目录 **46 文件 344/344**（新增 4 个生命周期回归测试：会话复用、空闲释放+重建、claim 接入、无验证完成也发终态事件）
- protocol 包 **327/327**（完成事件契约测试按新语义更新）
- desktop `tsc -p tsconfig.json` 与 `tsc -p tsconfig.node.json` 双双干净（R1 时 node 配置实际欠账，本轮补齐）

### R2 预期真机行为

- 原子工具连续操作期间：单一任务卡聚合所有步骤，60s 无调用后自动显示终态并关闭 PIP；紫色指示器随之熄灭
- start_task 完成/失败/停止：立即发终态事件（原有 `releaseOperatorResources` 本就清宿主资源），PIP 2.5s 滞留后关闭
- 极端情况（TS 侧异常未清理）：Swift 宿主 90s 空闲自停采集流，紫色指示器必然熄灭

---

## 1. 现状盘点（基于代码事实）

### 1.1 已有的好底子（保留，不动）

| 能力                  | 现状                                                                            | 位置                                                      |
| --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 独立宿主进程 + 信任链 | sha256+codesign 双向验证（宿主也验父进程），违规 fail-closed SIGKILL            | `NativeHostArtifact.ts` / `ParentProcessAuthorizer.swift` |
| stdio 帧协议          | 4B 长度前缀 + json/binary 帧，FIFO 单车道，64MiB 上限                           | `NativeHostFrameCodec.ts` / `NativeFrameCodec.swift`      |
| AX 采集               | Chromium 强制开启 AXManualAccessibility、tray 窗规避、observer 脏标记 + 1s 缓存 | `MacAccessibilityController.swift`                        |
| 双通道执行            | background_ax（AXPress/AXSetValue）→ foreground_cg（CGEvent→cghidEventTap）降级 | `MacScreenCaptureProvider.executeAction`                  |
| 接管检测              | listen-only event tap + 注入事件标记 + topmost 窗口归属判定                     | `MacUserInputMonitor.swift`                               |
| 敏感防护              | secure field 双重拦截 + 敏感应用黑名单 + 证据涂灰                               | 多处                                                      |
| 宿主监督              | 心跳 + 每任务 1 次重启预算 + rebound 强制重绑                                   | `NativeHostSupervisor.ts`                                 |
| 灰度框架              | 8 个 V2 flag + 自动回滚                                                         | `computerUseV2Flags.ts`                                   |
| 窗口截图              | ScreenCaptureKit 窗口级 + scaleFactor 正确 + SCStream 常驻流                    | `MacScreenCaptureProvider.swift`                          |

### 1.2 七个根因（为什么不好用）

**R1 — 模型看不懂界面（最致命）**
AX 树被渲染成**平铺 JSON 数组**（`MacControlPolicy.publish` → `jsonString(published.map(jsonObject))`）：无层级缩进、每元素带全量 bounds、字段名重复，token 膨胀严重且模型难以理解 UI 结构。Codex 是**层级 Markdown outline**（缩进表达层级、短稳定 ID、focus 标记、actions 后缀、无坐标）。

**R2 — 元素 ID 不稳定 + diff 实际失效**
`elementId = SHA256(runtimeID|index)`，index 是遍历序号——树任何变化导致 ID 全变。而 diff 门控条件 `previousTreeVersion == currentVersion`（树没变才 diff）逻辑颠倒：树变了必然输出全量。结果：模型每步看到的都是全量 JSON，元素引用无法跨步稳定。

**R3 — 模型看不清界面**
决策截图被压到 ≤1200px 宽（`ElectronSnapshotImageProcessor`），Retina 全屏缩到 1200px 后小按钮只有几像素，坐标精度天花板极低。Codex 用全分辨率截图 + 缩放坐标系换算（`scalingFactor` 状态缓存）。

**R4 — 反馈循环双倍开销、无 Skyshot**
每步 = 动作前观察（截图+全树遍历）+ 动作 + 动作后再观察。`action_result` 只返回 `executed|noop`，不带新观察。`markDirty()` 在每个动作前无条件击穿树缓存 → 每次观察全量重遍历（2000 元素 × 每元素多次 XPC 调用）。frameId 混入时间戳，同一静止画面两次观察 frameId 必不同，「画面没变」无法廉价判定。Codex 每个动作响应直接携带 Skyshot（动作后新截图 + 新树），一次往返完成「执行+感知」。

**R5 — 执行通道缺武器**

- 无 **CGEventPostToPid 定向投递**（Codex 非前台控制的核心）：自绘 UI/canvas 控件无法后台点击；
- 无 **焦点伪造通知**（notifyAppActivated/notifyWindowKeyFocus）：部分 app 因「自己非 active」拒绝响应后台 AX 动作；
- 后台通道能力面窄：click 无右键/中键、drag 完全无后台等价、滚动只有 AXIncrement/Decrement 步进语义；
- 无拟人节奏（Codex 点击间隔实测 0.1s）、无按键按住 duration、键码表 US-ANSI 硬编码。

**R6 — 决策架构弱**
内层是「单轮 JSON 生成」子循环（`ComputerDecisionAdapter`）：每步构造 prompt（≤32k 树文本 + ≤48k 元素 JSON + base64 图）→ 期望模型吐 JSON → 平衡括号提取解析。格式漂移即整轮重试；模型每步只见「任务描述+最近 12 步」，无对话连续性；successCriteria 靠正则从 goal 猜。Codex 的架构：**会话模型本身就是 CUA agent**，通过 12 个 MCP 工具直接操作，每步工具响应带 Skyshot，上下文天然连续。

**R7 — 人机协同/可视化缺口**
审批机制空转（L2/L3 票据代码存在但执行路径不触发）；无 Esc 全局取消；无虚拟光标/控制指示（Codex 的 agent 光标 + PIP 浮窗是「可见可控」体验的核心）。

### 1.3 附带问题（随主体修复一并解决）

- `get_app_state`/`capture_app_snapshot` 只支持前台窗口（协议层 `capture_window` 明明支持任意窗口却未暴露）；
- 单宿主单观察绑定（`MacScreenCaptureProvider.observation` 是 actor 内单值），并行任务互相踩；
- 证据加密落盘在关键路径附近（虽已 fire-and-forget，但每步两次截图的处理链仍是负担）。

---

## 2. 架构决策

| #   | 决策                                                                                                                               | 理由                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1  | **保留**宿主进程拓扑、信任链、帧协议骨架、双通道降级方向、Supervisor、灰度框架、证据库                                             | 这些已达到或超过 Codex 同类设计（信任链比 Codex 的 parent 签名六字段更严）                      |
| D2  | **重写**感知渲染层：Markdown outline 渲染器 + 内容指纹稳定 ID + 渲染行 diff + 可见性/预算控制                                      | R1/R2 的直接解，Codex 感知质量的核心                                                            |
| D3  | **新增**第三执行通道 `background_pid`（CGEventPostToPid + 焦点伪造）                                                               | R5 的直接解                                                                                     |
| D4  | **升级** IPC 协议到 v2：`execute_action` 响应携带 **Skyshot**（动作后树+截图一次往返）；frameId 去时间戳                           | R4 的直接解                                                                                     |
| D5  | **双决策模式并存**：模式 A（新，对齐 Codex）把 12 个原子工具直接暴露给会话模型；模式 B（保留）`start_task` 自主循环复用新感知层    | Codex 模式的核心是模型原生工具调用循环；但 Spark 的任务级治理（预算/验证/委托）有独立价值，保留 |
| D6  | **决策截图全分辨率**：工具/决策直接用宿主原始截图（含 scaleFactor 元数据），坐标换算下沉到宿主                                     | R3 的直接解                                                                                     |
| D7  | **macOS 先行**：本次只改 Swift 宿主 + TS 层；Windows（Rust）只做协议 v2 的 nullable 兼容（skyshot 字段可缺省），能力对齐放后续迭代 | 控制爆炸半径；用户主力平台是 macOS                                                              |
| D8  | 开发期走 `trustMode: 'local'`（dev 包允许未签名宿主），合并后随版本重打包签名                                                      | 现有机制，无新增风险                                                                            |

---

## 3. 工作流分解（W1–W5）

### W1 感知层重写（Swift，~1 周）

**改动文件**：

- 重写 `SparkComputerHostCore/MacControlPolicy.swift` 中 `NativeAXTreeState`（拆分为独立文件 `AXTreeRenderer.swift` + `AXTreeIdentity.swift`，避免单文件膨胀）
- 增强 `SparkComputerHost/MacAccessibilityController.swift`（采集字段扩展）
- 新增 `SparkComputerHostCore/AXSettlePolicy.swift`
- 同步 `Tests/SparkComputerHostCoreTests/`

**W1.1 采集字段扩展**（对齐规格书 §5.1）：
每节点在现有 role/name/value/bounds/enabled/focused/actions/secure 基础上补采：
`roleDescription`（AXRoleDescription，比 role 更贴近人类词汇）、`placeholder`（AXPlaceholderValue）、`help`、`url`（AXURL，短化保 host）、`selected`（AXSelected）、`childrenCount`（AXChildren 数量，用于大容器检测）。
表格节点补 `rowIndexRange/columnIndexRange`（后续增强，一期可选）。

**W1.2 Markdown 渲染器**（核心，规格书 §5.2）：

```
renderLine(node, depth):
  line = "  "×depth
       + (focused ? "▸ " : "")
       + "[" + id + "] "
       + roleWord            // roleDescription 优先，回退 role 驼峰转词
       + " " + quoted(name)  // title|description|help 首个非空
       + (value 非空且非冗余 ? " value=" + quoted(截断(value)) : "")
       + (placeholder 非空 ? " placeholder=" + quoted(placeholder) : "")
       + (url 非空 ? " " + 短化链接 : "")
       + (非平凡 actions 且非 invoke/set_value 类 ? " actions:[...]" : "")
```

渲染规则：

- 层级用 2 空格缩进表达（对齐 Codex outline）；深度上限 40；
- **bounds 不进渲染文本**（坐标信息只在截图上，模型需要坐标时用视觉定位；elementID 语义动作根本不需要坐标）；
- 单元素 value > 2000 UTF-16 截断 + `…[truncated]`；
- 大容器（childrenCount > 100）：渲染前 100 个可见子集 + 描述行 `── list: 100 of 1250 items (first 100 shown) ──`；
- 离屏子树：与窗口 frame 求交剪枝（滚动容器内 AX 已只暴露可见子集的场景天然满足）；
- 全树文本预算 64k 字符（超限 → 优先保留焦点路径子树 + 截断标记，对齐 Codex 「truncated to visible range」）。

**W1.3 稳定 ID（内容指纹方案）**：
`id = 会话内自增序号`，分配规则：同会话内若存在 fingerprint 匹配的旧元素（fingerprint = SHA256(role + name + value前512字符 + depth)），继承其 ID；否则分配新 ID。ID 在响应里以 `[17]` 形式出现在渲染行首，模型引用时传 `17`。

- 语义：内容不变 → ID 不变（即使位置移动）；内容变 → 新 ID（diff 显示 changed/removed）；
- 与 Codex 的 `Change{path,offset,depthFirstOrder} + inheritElementID` 语义等价，实现更简单；
- 同 fingerprint 多个实例（列表重复项）→ 序号去重桶；
- ID → runtimeID 映射每次 publish 重建（AX 元素查找不受影响）。

**W1.4 渲染行 diff**（修复 R2 的颠倒逻辑）：

```
diff(oldRender, newRender):
  oldIDs = 旧渲染的 {id: line}
  for line in newRender.lines:
    id ∈ oldIDs && 文本相同   → 跳过（未变）
    id ∈ oldIDs && 文本不同   → 输出新行
    id ∉ oldIDs              → 输出新行（新增）
  removed = oldIDs 中不在新树的 → 汇总为一行 "Removed element IDs: [12, 45, ...]"
  输出 = 变更行块 + removed 行；无变化 → "No visible changes."
```

diff 模式由 `previousTreeVersion` 有效 + 上一版本可寻址时启用；TS 侧 `NativeHostTreeReconciler` 继续负责全量重建兜底。

**W1.5 settle**（新增 `AXSettlePolicy`，对齐规格书 §5.5）：
动作后等待策略：基线 1.0s 内监听 `AXElementBusyChanged` + 轮询树哈希；busy → 延长（上限 6s）；连续 2 次树哈希相同且无 busy → 稳定。settle 结果供 W2 的 Skyshot 使用（动作响应前完成，保证截图/树是稳定后状态）。

**W1.6 frameId 去时间戳**：frameId = SHA256(截图字节 + treeVersion)，静止画面两次观察 frameId 相同 → `snapshot_changed` 等待条件与「画面没变」判定免费获得。

**验收**：

- Swift 单测：渲染格式快照测试（固定 AX 元素输入 → 固定 Markdown 输出）；ID 稳定性（同内容跨 publish 继承）；diff 正确性（增/删/改三类）；大容器截断；预算截断；
- 手动：对 VS Code（Electron）、Safari（原生）、微信对比新旧树文本的 token 量与可读性（预期 token 降 50%+）。

### W2 执行层增强（Swift，~1 周）

**改动文件**：

- 新增 `SparkComputerHost/MacEventInjector.swift`（postToPid 通道 + 焦点伪造）
- 增强 `MacAccessibilityController.swift` 的 `MacCGEventController`（拟人节奏、keypress duration、布局感知键码）
- `MacScreenCaptureProvider.executeAction` 决策树扩展
- Core 新增 `NativeBackgroundActionPolicy` 扩展（background_pid 通道判定）

**W2.1 动作决策树**（升级为三级，对齐规格书 §6.1）：

```
click(point, button, count):
  1. [background_ax]   hit-test 缓存树 → 元素有 AXPress/AXConfirm/AXPick → 执行（不抢焦点）
  2. [background_pid]  构造 CGEvent 序列 → CGEventPostToPid(targetPID)（不进全局 HID）
      前置：AXRaise 目标窗口（不激活 app）+ notifyAppActivated 焦点伪造
  3. [foreground_cg]   现有路径（激活窗口 + cghidEventTap 全局注入）
  通道选择在响应里如实回报（executionChannel: background_ax | background_pid | foreground_cg）
```

**W2.2 焦点伪造通知**（对齐逆向 §8）：
`AXUIElementPostNotification(appElement, kAXApplicationActivatedNotification)` + 目标窗口 `kAXMainWindowAttribute/kAXFocusedAttribute` 置位尝试，让目标 app 认为自己 active，解锁其对后台事件的响应。postToPid 点击前调用；失败不阻断（尽力而为，真机验证效果）。

**W2.3 postToPid 细节**：

- 事件仍打注入标记（现有 `eventSourceUserData` tag），接管监测天然兼容；
- 拖拽（drag）：postToPid 序列 mouseDown → 插值 mouseDragged → mouseUp，间隔 16ms；
- 滚动：postToPid scrollWheel 事件（像素精确，优于 AXIncrement 步进）；
- 键盘：postToPid keyDown/keyUp（目标进程必须有 key window，配合 W2.2）；
- 坐标：全局屏幕坐标语义不变，但需先确认目标窗口 z-order 遮挡关系——被完全遮挡时 postToPid 事件仍直达进程（不经窗口服务器 hit-test），这是它优于全局注入的本质。

**W2.4 拟人节奏**：连击/批次动作间隔 0.1s（Codex 实测值）；type_text 分块间隔从 2ms 提升到 8ms（降低吞字率，真机调参）。

**W2.5 keypress duration**：按住毫秒数（down → sleep(duration) → up），协议字段新增。

**W2.6 布局感知键码**：运行时用 `TISCopyCurrentKeyboardLayoutInputSource` + `UCKeyTranslate` 解析字符 → 真实键码，US-ANSI 表降级为兜底。

**验收**：

- Swift 单测：决策树通道选择（元素有/无 AXPress × 窗口前/后台 × 通道可用性矩阵）；UCKeyTranslate 映射；
- 真机（用户手动验收）：后台窗口点击自绘控件（如 Figma canvas 场景）、后台滚动像素精确性、中文输入法下 type_text 行为、非美式键盘布局 keypress。

### W3 协议 v2 + Skyshot（TS + Swift，~1 周）

**改动文件**：

- `packages/protocol/src/computer-use/native-wire.ts`（v2 字段）+ `native-version.ts`（protocolVersion 2）
- Swift `NativeHostProtocol.swift` / `NativeHostRequestHandler.swift`（响应编码）
- `NativeHostClient.ts` / `NativeHostComputerUseBackend.ts`（Skyshot 接收与缓存）
- `ComputerObservationEvidenceStore.ts` / `ElectronSnapshotImageProcessor.ts`（全分辨率决策图）

**W3.1 协议 v2 变更**（全量向后兼容：新增字段全部 optional）：

```
execute_action 响应 v2:
  action_result {
    actionId, status, executionChannel,
    skyshot?: {                          // W1.5 settle 完成后采集
      frameId, treeVersion, treeMode(full|diff), treeText(Markdown),
      elementCount, screenshot?: { width, height, scaleFactor, payloadDescriptor }
    }                                    // screenshot 为 null 当 persistentCapture 帧不可用
  }

observe 响应 v2:
  observation { ..., treeText 改为 Markdown 渲染（v1 JSON 废弃）, scaleFactor }

capture_window / observe 请求增加:
  { ..., maxImageWidth?: number }        // 客户端可控分辨率上限（决策用全分辨率，预览用 1200px）
```

**W3.2 Skyshot 生成管线**（Swift 侧）：

```
executeAction 完成动作 → AXSettlePolicy.settle(≤1s 基线) → 树重采集（observer 未脏且 <1s 则复用缓存）
  → persistentCapture 帧获取（≥动作完成时刻的帧，2s 超时降级为 null）
  → 组装 skyshot 一次性返回
```

**W3.3 TS 侧**：

- `action_result.skyshot` 直接更新本地 observationSessions（动作后不再强制二次 observe）；
- 决策图改为全分辨率（或 ≥2048px 上限），`scalingFactor` 元数据随行，坐标换算只在需要绝对坐标时用（模式 A 大多数动作走 elementID 不需要）；
- 证据链照常（涂灰缩略图用于审计，决策用原图）。

**W3.4 多观察绑定**：`MacScreenCaptureProvider.observation` 从单值改为 `[computerSessionId: ObservationBinding]` 字典（R 附带问题），宿主侧按会话隔离。

**验收**：TS 协议单测（v2 解析、v1 宿主兼容降级——skyshot 缺省时回退现有二次观察路径）；Swift 编解码单测；集成冒烟（dev trust 模式跑通 observe→action→skyshot 全链）。

### W4 工具面与决策架构（TS，~1 周）

**改动文件**：

- `ComputerUseMcpProvider.ts`（工具清单扩展）+ `ComputerUseAgentBridge.ts`
- `ComputerUseAgentController.ts`（原子工具入口 + 轻量会话）
- `packages/agent-runtime/src/computer-use/computer-use-system-prompt.ts`（重写）
- `ComputerDecisionAdapter.ts`（模式 B 复用新感知，prompt 瘦身）

**W4.1 模式 A：原子工具直暴露**（对齐 Codex 12 工具语义，新增 10 个工具）：

```
click               {at: {elementID} | {coordinate:[x,y]}, clickCount?, button?}
type_text           {text, into?: elementID, submit?: boolean}
set_value           {elementID, value}
press_key           {keys[], durationMs?}
scroll              {deltaX, deltaY, at?: elementID|coordinate}
drag                {from, to}
select_text         {elementID, text, prefix?, suffix?}
perform_secondary_action {at}                    // 右键
screenshot          {}                            // 全分辨率 + Markdown 树
wait_for            {condition, timeoutMs}        // 沿用现有
（get_app_state / get_screen_state / list_windows / open_app 升级现有：任意窗口 + Markdown 树 + 全分辨率图）
```

- 每个动作工具响应 = 动作状态 + **新 Markdown 树** + 新截图（工具结果携带图片，视觉模型直接看）；
- 工具描述文案**逐字采用**规格书 §4 从 Codex 逆向的描述（含四条实战警示与权限 pending 重试话术）；
- 治理：首次原子动作建立轻量会话（继承现有预检/预算/kill switch/接管检测；Esc 全局取消本期一并加上——监听 keyDown Escape → killSwitch）。

**W4.2 系统提示词重写**：以 Codex SKILL.md 为蓝本——确认策略四档分类学、工具优先级（语义 > 坐标、elementID > 截图定位）、失败换通道指引、权限 pending 重试话术；删除与新模式重复的 start_task 强引导（start_task 保留为「委托模式」）。

**W4.3 模式 B 瘦身**：`ComputerDecisionAdapter` 的 prompt 从「32k 树文本 + 48k 元素 JSON」改为「Markdown 树（~10–20k）+ 全分辨率图」；决策输出格式不变（内部循环，保持 JSON 协议但输入质量对齐模式 A）。

**验收**：MCP 工具 schema 单测；提示词快照测试；真机（用户手动）：用会话模型直接走「打开备忘录 → 输入文字 → 保存」全原子工具流程 vs 现状对比。

### W5 质量与收尾（贯穿，~3 天）

- Swift：`swift test` 全绿（新增渲染/ID/diff/settle/注入决策树用例 ≥ 30 个）；
- TS：改动文件相关 vitest 全绿（协议、reconciler、controller、prompt）；
- typecheck + lint（按项目惯例；并行改动期间只跑与自身改动相关的检查）；
- 真机验收清单（用户手动执行）：
  1. Electron 应用（VS Code）：树可读性、语义点击成功率；
  2. 原生应用（备忘录/访达）：同上；
  3. 后台窗口操作（目标窗口非前台）：点击/滚动/打字；
  4. 人机协同：任务中物理移动鼠标/敲键 → takeover；
  5. Esc 全局取消、kill switch；
  6. 中文输入场景 type_text；
  7. 全流程 token 消耗对比（改造前后同一任务）。

---

## 4. 里程碑与交付节奏

| 里程碑  | 内容                                                             | 预期效果（用户可感知）                  |
| ------- | ---------------------------------------------------------------- | --------------------------------------- |
| M1 = W1 | 感知重写（Markdown 树 + 稳定 ID + diff + settle + frameId 修正） | 模型看得懂界面；模式 B 决策质量立即提升 |
| M2 = W3 | Skyshot + 全分辨率截图 + 多绑定                                  | 每步一次往返；坐标精度恢复；吞吐翻倍    |
| M3 = W2 | postToPid + 焦点伪造 + 拟人节奏                                  | 后台自绘控件可点；点击更像人            |
| M4 = W4 | 原子工具 + 提示词                                                | 会话模型直接操作，对齐 Codex 工作流     |
| M5      | 体验补齐（Esc、虚拟光标可选、后台窗 get_app_state）              | 人机协同与可视化                        |

每个里程碑独立可合并、可回退（V2 灰度框架承接：新渲染/Skyshot/postToPid 各挂一个 flag，默认开、可环境变量关）。

## 5. 风险与对策

| 风险                                              | 对策                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| postToPid 对非 key window 的路由行为依 app 而异   | 决策树三级降级兜底；真机验证矩阵（W2 验收）；通道如实回报供模型换策略                                            |
| 协议 v2 双端版本漂移                              | 所有 v2 字段 optional + protocolVersion 握手硬校验；v1 宿主遇 v2 客户端走兼容路径（skyshot 缺省 → 现有二次观察） |
| 渲染格式改动影响模式 B 决策 prompt 的既有调参     | ComputerDecisionAdapter prompt 同步改写 + 快照测试；灰度 flag 可回退                                             |
| 内容指纹 ID 在动态列表（同 fingerprint 多项）歧义 | 指纹桶 + 序号去重；元素引用失败返回 stale_tree 时模型重观察（现有恢复路径）                                      |
| Windows（Rust 宿主）协议不同步                    | v2 字段全 optional，Rust 端暂不实现 skyshot（TS 兼容降级）；Windows 能力对齐单列后续迭代                         |
| 真机行为不可自动化验证                            | 明确标注「未验证」，真机清单交由用户手动验收（既有惯例）                                                         |

## 6. 不做什么（本期明确排除）

- 不改宿主信任链/分发机制（签名验证流程不动）；
- 不做虚拟光标动画/PIP 浮窗（M5 仅做最小控制指示评估，动画完整版后续）；
- 不做 Windows 端能力实现（仅协议兼容）；
- 不做 iMessage/Record& Replay/Skysight 等 Codex 增强子系统；
- 不激活逐动作审批（保持任务级授权 + 黑名单 + secure 拦截的现有治理；审批票据机制留待后续按需接回）。
