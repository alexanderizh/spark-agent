# 画布 Agent 性能与能力升级方案

> 状态: 已落地 | 最后核对: 2026-07-11

## 一、问题诊断总结

画布 Agent 通过工具桥（Tool-Call Bridge）跨三进程协作控制画布。经四轮深度分析，确认以下核心问题相互叠加导致「慢慢慢」体感：

| # | 问题 | 严重度 | 根因 |
|---|------|--------|------|
| 0 | **级联超时 BUG** | 🔴🔴🔴 | 主进程 60s 超时从 dispatch 即计时，渲染端 FIFO 队列等待时间吃掉预算；队列无取消传播 |
| 1 | **localStorage 全库序列化** | 🔴🔴🔴 | 每次 writeDb = JSON.stringify 全库 + localStorage.setItem；63 个调用点 |
| 2 | **MCP Server 每轮重建** | 🔴🔴 | 每个 turn 调 createCanvasMcpServer 重建 40 个工具的 Zod schema |
| 3 | **nodeActions 引用抖动** | 🔴🔴 | snapshot?.nodes 在 useCallback deps 中，导致所有可见节点重渲染 |
| 4 | **串行队列饿死读操作** | 🔴 | projectToolQueues 不区分读写，查询操作白白串行等待 |
| 5 | **工具返回数据冗余** | 🟠 | summarizeNode 返回 13 字段，查询返回全量数组 |
| 6 | **工具粒度盲区** | 🟡 | 缺批量原子操作、细粒度参数微调、布局对齐、条件查询 |

### 因果关系
```
级联超时(#0) ← 串行队列(#4) ← 60s 计时设计
    ↓ 导致 Agent 重试 → 更多排队 → 更易超时（恶性循环）

localStorage 序列化(#1) → 单工具变慢 → 队列积压 → 加剧级联超时(#0)

React 重渲染(#3) 叠加 → UI 卡顿 → 体感「慢慢慢」

MCP 重建(#2) → 每 turn 启动慢 → 放大延迟
```

## 二、修复方案（三轨道并行）

### 轨道 A：数据层加速（热存储增量化）

**目标**：消除每次工具调用的全库 JSON 序列化/反序列化开销。

**方案**：保持 `writeDb(db)` / `readDb()` 函数签名不变（63+75 个调用点零改动），内部从「整库 stringify」改为「按表分片 + 增量标记」。

**改动**：
- `canvas.api.ts`：替换 `readDb` / `writeDb` / `persistHotDb` 内部实现
  - readDb：首次懒加载后持有内存引用，后续直接返回（不重复 parse）
  - writeDb：不再 stringify 全库；仅标记 dirty + 轻量同步内存引用
  - persistHotDb：改为防抖落盘（写入 localStorage 走 requestIdleCallback 或 setTimeout 合并）
- localStorage 格式不变（`spark-canvas:v1`），保持向后兼容
- 更新 2 个直接解析 localStorage 的测试文件

**预期收益**：单次工具调用从 25-75ms 序列化降至 <1ms。

**风险**：中。函数签名不变降低风险；需验证 dirty 标记 + 自动保存链路。

---

### 轨道 B：桥接层修复（MCP 缓存 + 队列 + 超时）

**目标**：消除级联超时 BUG，并行化读操作，缓存 MCP server。

**B1. MCP Server 缓存**
- `canvas-host-bridge.ts`：缓存 `createCanvasMcpServer` 结果，按 toolSchemas 内容 hash 做 key
- schema 不变时复用实例，避免每轮重建 40 个 Zod schema
- **预期收益**：每轮 turn 省 100-300ms

**B2. 读写分离队列**
- `canvas-tool-host.ts`：重写 `runCanvasToolInProjectQueue`
  - 只读工具（get_/list_/find_ 前缀）并行执行，无锁
  - 写操作保持按项目串行
  - 新增 `CANVAS_READONLY_TOOLS` 白名单
- **预期收益**：查询密集轮次延迟减半

**B3. 级联超时修复**
- `canvas-host-bridge.ts`：60s 超时从「渲染端实际开始执行」开始计时（而非 dispatch 时）
  - 方案：IPC 发送后等渲染端 ACK `tool-call:ack`，ACK 后才启动计时器
- `canvas-tool-host.ts`：收到工具调用立即发 ACK；队列取消传播（主进程超时后通知渲染端跳过）
- **预期收益**：消除级联超时误报，消除白干功

---

### 轨道 C：渲染层 + 工具层增强

**C1. 修复 nodeActions 引用抖动**
- `CanvasWorkspaceView.tsx`：4 个回调改为读 `snapshotRef.current` + 空依赖
  - `handleNodeSelectIntent`（2549）
  - `handleToggleLockNode`（2692）
  - `handleBringNodeToFront`（2701）
  - `handleEditNode`（2949）
- 参照已有 `*Stable` 回调模式（5136-5188）
- **预期收益**：单节点变更从全量重渲染降至仅变更节点重渲染

**C2. 工具返回数据精简**
- `canvas.tools.ts`：`summarizeNode` 按调用场景裁剪字段
- `list_nodes` / `find_nodes` 默认返回轻量摘要（id+type+title+坐标），详情走 `get_node`
- **预期收益**：减少 Agent token 消耗，加速推理

**C3. 扩展工具粒度**
- 新增工具（纯声明式追加，零风险）：
  - `canvas_batch_create_nodes`：一次性创建多节点+连线（减少往返）
  - `canvas_align_nodes` / `canvas_distribute_nodes`：布局对齐
  - `canvas_bring_to_front` / `canvas_send_to_back`：Z 序语义
  - `canvas_update_model_param`：细粒度改单个 modelParams key（不整块替换）
  - `canvas_query_nodes`：条件查询（按坐标范围/连线关系/任务状态/资产类型）
  - `canvas_get_canvas_diff`：快照差异对比
- **预期收益**：Agent 操作更精细，批量场景往返次数大幅减少

---

## 三、实施进度

### 轨道 B：桥接层修复（先做，风险可控收益大）

- [x] B2. 读写分离队列 — `canvas-tool-host.ts` 重写队列逻辑 ✅ 已完成
- [x] B1. MCP Server 缓存 — `canvas-mcp-server.ts` shape 缓存（jsonSchemaToShape 结果缓存） ✅ 已完成
- [x] B3. 级联超时修复 — ACK 协议 ✅ 已完成
  - [x] 协议层新增 `canvas:tool-ack` IPC channel（protocol ipc + zod schema）
  - [x] 桥接层 ACK 宽限期（5s）+ ACK 后启动 60s 执行计时（消除队列等待计入超时）
  - [x] 渲染端收到 tool-call 立即发 ACK
  - [ ] 取消传播（主进程超时后通知渲染端跳过）— 后续增强（B2+B3 已大幅降低风险）

### 轨道 C：渲染层 + 工具层增强

- [x] C1. 修复 nodeActions 引用抖动 — 7 个回调改 ref 模式 ✅ 已完成
  - handleNodeSelectIntent / handleToggleLockNode / handleBringNodeToFront / handleEditNode
  - handleDownloadMediaNode / handlePreviewPanorama / handleOpenCharacterSubviewEditorFromNode
  - 全部改用 snapshotRef.current 读取，去掉 snapshot?.nodes / snapshot 依赖
- [x] C2. 工具返回数据精简 ✅ 已完成
  - [x] 新增 summarizeNodeLite（轻量摘要，11 字段→不含 data 详情）
  - [x] list_nodes / find_nodes / query_nodes 默认返回轻量摘要
- [x] C3. 扩展工具粒度 ✅ 已完成（42 → 49 个工具）
  - [x] canvas_batch_create_nodes — 批量创建多节点+连线
  - [x] canvas_align_nodes — 6 方向对齐
  - [x] canvas_distribute_nodes — 水平/垂直等距分布
  - [x] canvas_bring_to_front / canvas_send_to_back — Z 序语义
  - [x] canvas_update_model_param — 细粒度改单个 modelParams key（不整块替换）
  - [x] canvas_query_nodes — 多维条件查询（类型/状态/坐标范围/连线/资产/流水线角色/生产状态）

### 轨道 A：数据层加速（最后做，影响面最大需充分测试）

- [x] A1. readDb 内存引用化（消除重复 parse） ✅ 已完成 — hotMemory 模块级缓存
- [x] A2. writeDb 去全库 stringify（增量 dirty 标记） ✅ 已完成 — writeDb 只更新内存引用 + dirty
- [x] A3. persistHotDb 防抖落盘 ✅ 已完成 — 500ms 防抖合并多次写为一次 localStorage.setItem
- [x] A4. 更新直接解析 localStorage 的测试文件 ✅ 已完成 — 4 个测试文件加 __resetCanvasHotCache
- [x] A5. 验证自动保存链路 ✅ 已完成 — flushPersist 加 flushHotPersist 保证一致性；488 测试全过

## 四、验证策略

1. **现有测试**：每步改动后跑 `canvas.tools.test.ts` / `canvas.store.test.ts` / `canvasHotStorage.test.ts` / `canvasAssetInsert.test.ts`
2. **新增基准**：测量单工具调用延迟（before/after）
3. **集成验证**：Agent 连续创建 10 节点 + 5 连线 + 3 查询，对比延迟
4. **回归检查**：自动保存、Ctrl+S、项目切换、撤销重做链路
