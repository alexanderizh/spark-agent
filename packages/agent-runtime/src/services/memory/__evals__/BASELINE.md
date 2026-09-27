# 记忆系统 V2 评测基线

> 最后核对: 2026-07-03 | 评测集: gate-cases (16) + search-cases (11)

## 基线分数

| 维度               | 用例数 | 通过 | 分数                 |
| ------------------ | ------ | ---- | -------------------- |
| 写入闸门（gate）   | 16     | 16   | **precision 100.0%** |
| 检索召回（search） | 11     | 11   | **recall 100.0%**    |

确定性评测（mock callLLM + mock evolution / 纯 FTS BM25），不依赖真 LLM，CI 可跑。任何用例失败 = 逻辑回归。

## 覆盖范围

### gate-cases（写入闸门 + 演化执行）

- ADD（feedback / user / project / reference 四种 type）
- rejected-confidence（confidence < 0.6）
- rejected-transient（日期 / 实时数据 / 任务进度"现在 N"）
- rejected-sensitive（sk- token / PEM 私钥）
- 演化 NOOP / UPDATE（保 id+History）/ DELETE（失效 invalid_at）
- V1 路径回退（evolutionService=null）
- **H1 修复验证**：失效条目释放唯一索引槽，同名 ADD 可重建（`add-after-invalidate`）

### search-cases（FTS BM25 召回）

- 中文二字词（segmentCjk 逐字分词 + phrase）
- 中文多字词、英文词、中英混合
- **H5 修复验证**：多词英文 AND 共现（不再要求紧邻 phrase）
- **M9 修复验证**：正文 body 可检索（insert 传 body）
- type 过滤、失效排除（H3）、scope 过滤、limit、空查询

## 如何跑

```bash
# better-sqlite3 需切 Node ABI（见 storage-tests-better-sqlite3-abi 记忆）
cd node_modules/better-sqlite3 && npm run build-release
cd /Users/zhangyang/spark_ai_project/Spark-Agent
pnpm --filter @spark/agent-runtime exec vitest run src/services/memory/__evals__/eval.test.ts
# 跑完务必还原 Electron ABI：
# cd node_modules/better-sqlite3 && prebuild-install --runtime electron --target 43.2.0
```

输出含 `gate: N/M precision = X%` 与 `search: N/M recall = X%` 汇总。

## 已知 limitation（非 bug，设计权衡）

1. **瞬时闸门对自然语言任务进度表述覆盖有限**：detectTransientMemory 用正则启发式，能稳定捕获"日期 / 今天+数字 / 实时数据词"，但"还差 N 个文件""正在 debug X"这类纯自然语言表述需靠**抽取 prompt 指令**（不存任务进度）规避，闸门是兜底。评测用例用稳定信号（"现在 N"）。
2. **抽取 prompt 的真 LLM 评测未含在确定性集**：写入闸门用例 mock 了 callLLM，不测 prompt 质量。真 LLM 抽取准确率（precision/recall）需单独跑（需配置 extraction 模型），用例数据可扩展自 gate-cases 的 candidate。
3. **检索用例为 FTS-only**：向量路径（sqlite-vec + RRF 融合）需 embedding 配置，不在确定性集（不稳定）。memory-search.service.test.ts 的 mock 测试覆盖 RRF/衰减/降级逻辑。

## 后续 prompt/逻辑改动须跑此集

任何改动 `memory-extraction.prompt.ts` / writer 闸门 / evolution / segment-cjk / memory-search.repository 后，必须跑此评测集且分数不回退。

## S0 反例固定基线（2026-09-27，生命周期加固计划）

> 计划：[2026-09-25-memory-lifecycle-hardening-plan.md](../../../../../docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md)（S0）｜代码基线：`5be077863`｜追踪：[todolist](../../../../../docs/plans/2026-09-27-memory-hardening-todolist.md)

固定集名称：`memory-s0-negatives`。用 `it.fails` 固化 E1–E8 中"当前反例成立"的缺陷行为（fails 通过 = 反例仍在）；各切片修复时逐条反转为 `it`，反转完成即该切片验收动作。mock callLLM / fake ModelService，确定性可跑。

**运行结果（2026-09-27，node ABI）：**

| 层      | 测试文件                          | 反例固定（fails） | 正确行为固化                   | 基线存量    |
| ------- | --------------------------------- | ----------------- | ------------------------------ | ----------- |
| storage | memory.repository.test.ts         | 2（E4）           | 2                              | 24          |
| storage | memory-search.repository.test.ts  | 1（E5）           | —                              | 17          |
| runtime | memory-writer.service.test.ts     | 1（E4 writer）    | —                              | 20          |
| runtime | memory-reader.service.test.ts     | 3（E7）           | 1                              | 8           |
| runtime | embedding.service.test.ts         | 1（E6）           | 1                              | 0（新文件） |
| runtime | memory-lifecycle.contract.test.ts | 4（E3/F4/E1）     | 2                              | 0（新文件） |
| runtime | memory-search.service.test.ts     | —                 | 1（E8 口径）                   | 14          |
| engine  | memory-store-contract.test.ts     | —                 | 3（documenting，E1/E2 证据链） | 0（新文件） |

解读：`fails` 通过 = 反例成立（缺陷仍被测试抓住）；`it` 通过 = 正确性通过。E8 为口径记录（非缺陷）。memory snapshot 未归档（本轮不涉及真数据回放）；后续需要时归档至本机临时目录并在本节注明位置。

**S1A 反转记录（2026-09-27）：** E4（repo 2 条 + writer 1 条）与 E7（3 条）共 6 条 `fails` 已反转为 `it` 并通过——S1A.3（FTS fail-loud + 全调用方补传 body）与 S1A.2（MemoryRecallAccess 缺省拒绝 + isEntryInScopes 统一校验）落地。仍在 `fails` 状态：E5/E6（向量新鲜度，待 S1B.2/3）、E3/F4/E1（文件与投影同步，待 S1B.4 隔离与清理）。

**S1B.1 主体完成（2026-09-27）：** 迁移 104 落地（version/content_hash）；`memory-commit.service.test.ts` 5 用例（CAS 语义）+ reader 守卫 2 用例（哈希失配拒绝/NULL 存量放行）通过。写入口 1/2/4 已统一经提交原语（先快照后 CAS），晚到/并发写入不再覆盖当前状态；读取侧哈希守卫拦截外部覆盖与孤儿快照。memory 域 155/155、storage 349/349。

**S1B.2 完成（2026-09-27，commit `c68132a99`）：** E5（search repo 层 fails）与 E6（embedding 层 fails）已反转为 `it` 并通过——文本更新失效旧向量重新排队（`invalidateVecIndex`）、回填晚到向量按输入摘要比对拒绝占位（`upsertVec` 第三参）。新增 3 组用例：E6 防护（repo 层）、同维度模型切换重建+代际失效、代际稳定。既有 `listEntriesMissingVec` 用例按新契约更新（upsertVec 需带输入摘要才离开回填队列）。**顺带修正**：embedding.service.test 的 settings 跨用例污染——此前 E6 的 `it.fails` 通过实为超时假阳性（首个用例清空 settings.memory 未恢复，第二用例 embed 永不被调用而自旋超时；fails 语义把超时当"反例成立"），反转时暴露并修复测试隔离。storage 全量 442/442、memory 域 155/155。

**S1B.3 完成（2026-09-27，commit `dab4969a0`）：** 无 fails 反转（本切片为新增防护而非反例修复）。`upsertVec` 升级为三重期望值事务内条件提交（终态 `archived=0 AND invalid_at IS NULL` + 输入摘要 + 索引代际，任一失配影响 0 行即丢弃/重排队）；`embedTexts` 改为请求时捕获 embedding 配置并返回 `{vectors, generation}`；整合防重入双升级（实例锁 → 进程级 static 互斥 + `lastConsolidationAt` 占坑前置至 LLM 前）。新增 7 用例：repo 层终态/代际拒绝 3 例、embedding 并发重建收敛 2 例、consolidation 占坑防重入 2 例。memory 域 159/159、storage 全量 445/445。

**S1B.4 完成（2026-09-27，commit `72747df74`）：** E3（2 条）+ F4（2 条）+ E1（1 条）共 5 条 fails 已反转为 `it` 并通过（均改走 `MemoryLifecycleService` 序列）——至此 S0 固定的全部反例（E1–E7）已反转完毕。新增 6 用例：删除状态机走查、删除/归档幂等（not_found / 重复归档补写回）、清理失败置 failed 保留目标 + `retryFailed` 收敛、cleaning 中断恢复、屏障未设完恢复。迁移 106 `memory_operation` + `MemoryOperationRepository` + `MemoryLifecycleService`（删除/归档唯一收敛入口，scope 感知 store）。memory 域 165/165、storage 全量 445/445、四包 typecheck 0 错。UI 文案与 blocked_locally 状态分支经类型静态校验，未真机验证（真机验收按项目规则由用户手动完成）。

**S1B.5 完成（2026-09-27，commit `36b264a6c`）：** 写入口矩阵入口 5（同步导入）收编。无本仓 fails 反转（S0.7 的桌面侧 fails 已随 S1B.4/E1 反转；engine 侧 3 条 documenting 保留为读取语义证据链）。新增 `sync-adapters.memory.test.ts` 9 用例（desktop 侧）：上行停止 `isArchived` 折叠 `invalid_at`（version/invalidAt/supersededBy 独立传递 + 白名单放行）；tombstone 版本语义（早于本地最后写入保留待下轮决胜 / 晚于本地走 lifecycle 删行删文件刷投影 / 重放幂等）；旧响应 `updatedAt` 防御不覆盖；新条目失效语义恢复 + version 对齐收敛不变量；旧云端条目（缺新字段）兼容应用。覆盖 §6 矩阵"本地删除、远端离线/同步失败"（stale 保留 + 既有 pendingApply 重试链路）与"旧同步响应不覆盖当前状态"。AccountSync 全套 48/48、memory 域 166/166、desktop typecheck 0 错。同步语义依赖服务端 canonical 行为的端到端联调未做（本仓覆盖到 adapter 边界）。

## 后续 prompt/逻辑改动须跑此集（S0 增补）

S1A/S1B 各切片除上述集外，必须同步反转对应 `it.fails` 用例并在 todolist 进度日志记录；反转后全量重跑本表测试文件。

**S2.1 完成（2026-09-27，commit `21bcc3bf5`）：** 来源绑定落地。迁移 107 `memory_entry` 七列（`source_event_id`/`source_turn_id`/`author_role`/`author_agent_id`/`extraction_kind`/`extraction_model`/`evidence_status`）。新增 `memory-source-attribution.test.ts` 7 用例：host/member 路径系统侧来源落库、**LLM candidate 夹带伪造来源字段不采信**（sourceEventId/authorRole/userConfirmed 等注入全被系统侧真实值覆盖——无注入点由消费侧保证，写入只读 TurnPayload）、无来源上下文如实为空不补造、手工入口固定 manual 标记、更新路径来源不可变（V1 merge 不改写首次创建来源）、`findLastEventIdByTurn` 锚点查询（含跨会话隔离）。consolidation ELEVATE 追加来源断言。storage 侧 session 删除语义反转（`repositories.test.ts`）：`source_session_id` 不再置 NULL，改标 `evidence_status='unavailable'` 保留引用。来源字段随同步协议传递（sync-policy 白名单 + 上行下行 + 旧云端条目标 `sync_import`）。memory 域 172/172、storage 全量 445/445、AccountSync 48/48、三包 typecheck 0 错。
