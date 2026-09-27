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

**S2.2 完成（2026-09-27，commit `e28feb50b`）：** revision 历史落地。迁移 108 `memory_revision`（被覆盖版本快照，正文按守卫哈希同款规范化口径——`normalizeBodyForGuard` 导出统一去尾部换行）+ `memory_derivation`（派生边 merge/elevate/supersede，不级联）。repo `update`/`compareAndSwap` 增 `UpdateRevisionCapture`：同事务保留被覆盖版本（oldBody 由调用方在写新快照前读出——文件被原子替换，事务内已读不到）。新增 `memory-revision-history.test.ts` 12 用例：commitUpdate 保留旧版本（正文=旧正文）与版本链按序累积、revision 收录幂等（同版本 INSERT OR IGNORE 跳过）、supersedeEntry 当前版本入历史指向替代者 + 派生边 + 替代者缺失拒绝、retractEntry 幂等（重复撤回不重复入历史）、deleteEntry 物理清理历史与派生边（与 supersede/retract 保留历史相对）、N10 `getRevisionHistory` 完整链 + 存量行如实说明（coverage 保守口径——**修复了 version=1 零记录被 `0===version-1` 巧合误判 complete 的边界**，零记录与断链一律不判完整）、缺省拒绝与越范围拒绝（与 recall 同源 `isEntryInScopes`）、consolidation MERGE keep/drops 双侧入历史 + drop→keep 派生边、ELEVATE source→新条目派生边。IPC 增 `memory:history`/`memory:supersede`/`memory:retract` 三通道（history 为本机管理入口，E7 越权防护针对会话侧 recall）。coverage 判定收敛 `buildRevisionCoverage`（reader 与桌面 IPC 共用，两端口径一致）。memory 域 184/184、storage 全量 445/445、AccountSync 48/48、四包 typecheck 0 错。H1（可解释使用凭据）与 H2（纠正影响传播）的验证前提（revision 稳定/派生边可查）已具备，验证本身留 S2 后续与 §5 假设表。

**S1B.2–S2.2 整体审查（2026-09-27，commit `1a262d34d`）：** 对六个未整体复核的提交做聚焦审查，确认 2 处真实缺陷并修复——① `commitUpdate` 先写文件再 CAS，失配时新快照已覆盖旧权威正文（违反矩阵"文件修改、DB 提交失败 → 旧权威版本仍完整"）：失配时按行 content_hash 与读取时旧正文一致性条件恢复（NULL 存量行同列恢复；行已推进为不同内容时无法安全恢复，守卫拒绝态如实固定边界），consolidation MERGE 的直接 writeFile+compareAndSwap 一并收编提交原语（revisionKind='merge'）；② sync-adapters 的 tombstone 删除构造 `MemoryLifecycleService` 缺 revisionRepo，S2.2 后同步删除会残留悬挂 revision/派生边行：补传 `MemoryRevisionRepository`。既有 CAS 失配测试更新为新契约（文件恢复权威正文而非留覆盖），新增 3 用例（失配恢复/归档窗口恢复+frontmatter 写回/并发推进边界）+ 同步 revision 清理用例。memory 域 187/187、AccountSync 49/49。

**S2.3 完成（2026-09-27，commit `8a1a2894c`）：** 候选确认入口落地。迁移 109 `memory_candidate`（content_digest 确认绑定 + payload_json 原文 + pending/confirmed/rejected/expired）。ELEVATE 从直接写稳定 feedback 改为入候选区（缺省无候选仓库时跳过不晋级——宁可不做也不绕过确认）。新增 `memory-candidate.service.test.ts` 8 用例：确认晋级 happy path（原文落库+派生边+来源标注 consolidation）、错误摘要拒绝、**载荷被改写后旧摘要失配拒绝**（repo.confirm 按当前载荷重算复核——测试暴露"只比行内摘要列"的缺口后补的双重比对）、一次性（重复确认/拒绝后确认均 not_pending）、过期拒绝、**容量淘汰**（差一修复：插入前腾位）、**确认只覆盖指定版本**（晋级后条目更新 → isConfirmationCurrent 如实过时；口径修复：buildPromotedBody 与 readFile 的尾部换行同 normalize）、载荷不可解析不创建条目。consolidation exec 测试更新为候选契约（夹带 userConfirmed 字段不进载荷——N12；同提议重复整合摘要去重不累积——N1/N2）+ S2.4 敏感 2 用例 + S2.5 MERGE 不升置信 1 用例。memory 域 198→218 阶段全绿、四包 typecheck 0 错。UI（MemoryPanel 候选区）经类型校验，未真机验证。

**S2.4 完成（2026-09-27，commit `12c4ee67f`）：** 统一写入不变量。敏感闸门补齐 §4.5 矩阵全部缺口：入口 3 `memory:update`（新描述/正文经 `isMemorySensitive`，SparkError VALIDATION_FAILED）、入口 4（MERGE 产物命中丢弃整个动作 / ELEVATE 提议不进候选区，日志带 rejection_code=sensitive）、入口 5（applyMemory 二道防线——测试发现 sync-policy 层已有 token 前缀/凭据 URL 扫描，本层补通用赋值形态与 PEM，计 SYNC_MEMORY_SENSITIVE）、候选确认不豁免（**校验顺序重构**：敏感/不可解析校验先于状态迁移，拒绝时候选保持 pending，修复"已确认无条目"悬状态）。入口 3 CAS 收编（S1B.1 遗留关闭）：协议 `expectedVersion` 可选字段 + DTO `version` + 编辑抽屉携带当前版本；带版本走提交原语（含 S2.2 revision 保留与审查修复的失配恢复），冲突返回 CONFLICT；缺省保持旧直写路径兼容。GateOutcome 补 rejected-quota/merged/skipped-duplicate 分类（评估按类别断言）。手工输入不套自动抽取的日期/置信规则（入口策略差异化维持）。

**S2.5 完成（2026-09-27，commit `964b16317`）：** 置信度合并修订。废除全部现存 4 处 Math.max（计划列 5 处，writer:797 一处已随 S1B 死代码清理消失）：V1 去重 merge 两处（重复提及/转述不升置信也不拉低——频次非证据，独立性不可识别时不自动晋级）、V2 演化 UPDATE（新版独立评估允许下降，N3——用户纠正不被旧高分淹没）、整合 MERGE（合并重复不升——十篇转载不算十份独立证据，keep 维持自身评估）。新增 4 用例：去重不升（0.65 遇 0.95 merge 仍 0.65）、去重不降（0.9 遇 0.55 弱重述仍 0.9）、演化独立评估（0.95→0.7，N3）、整合不升（0.65 keep 遇 0.95 drop 仍 0.65）。手工 1.0 概念拆分：legacy confidence 固定值只表达保存意愿（迁移期只读）；展示层换可解释状态——协议/DTO 增 `authorRole`/`evidenceStatus`，MemoryPanel 详情显示状态（已失效/已归档/证据不可用/用户明确表达/整合推断/同步导入/模型推断），legacy 置信标注"仅参考"。memory 域 202/202。

**S2.6 完成（2026-09-27，commit `17b11387c`）：** 时效语义落地。迁移 110 `valid_until`（半开区间 [valid_from, valid_until) 右端 UTC ms）+ `valid_until_meta`（JSON：instant 或 date+IANA 时区；实施中发现 valid_until 列此前并不存在——§2.1"已有"的表述实际仅覆盖 valid_from/invalid_at，迁移一并补列）。`memory-temporal.ts`：`localDayEndExclusive` 两轮迭代消化 DST 边界（纽约春令时用例锁定），闰日/月溢出/非法时区结构化拒绝（归一化校验首轮实现有 bug——月末 +1 滚动被误判非法，修复为校验输入日本身）；insert 占位符随新列修正。到期读取语义（N5/N7）：`listByScope` 默认与 searchBm25/向量检索/回填队列均过滤到期条目（不当当前事实），`includeInvalid` 审计视图可见（到期 ≠ 删除），按 id recall 返回历史标注（N10，`describeValidUntil` 按原始时区展示"按日精度"不捏造准确时间）。手工创建链路（协议/IPC/manualWrite/新建抽屉 date 输入/详情展示）支持有效期。新增 `memory-temporal.test.ts` 9 用例。review_after/retention_until 经 §2.1 映射确认归属 S3（分类型实验后按需），N6 会话级临时覆盖的全面检测同依赖 S3 分类型实验——可测部分已覆盖（临时条目到期自然失效、长期不受影响、合并/演化语义不自动覆盖长期偏好）。memory 域 211/211、storage 445/445。

**S2.7 完成 + S2 阶段收口（2026-09-27，commit `7ce480f5a`）：** `memory-n-acceptance.test.ts` 固定攻击集 7 用例（N1/N2/N3/N4/N10/N11 可测部分/N12），攻击载荷夹带 userConfirmed/globalScope/authority/votes 伪造字段打完整链路（writer→consolidation→candidate→reader）。全部通过。边界如实声明：N4"近似文本互相否定→冲突判定"与 N11"频次未知/核验到期"依赖 S3 分类型实验字段，攻击集待 S3 落地后扩充。**S2 出口达成**：助手建议/引用/假设不会成为用户确认（N12）；同源转述不晋级（N2）；确认只覆盖指定版本；删除会话后证据 unavailable；新版本可追溯。memory 域 218/218、storage 445/445、四包 typecheck 0 错。S1B.1 遗留子项状态：入口 3 CAS（S2.4 关闭）、入口 5（S1B.5 关闭）、`managed: v2` frontmatter 标记与快照枚举（哈希守卫已构成核心防线，作为后续增强项保留）。剩余未实施：S3（检索与留存策略逐项验证 + 长期验证假设触发）——按计划属实验验证阶段，不属本轮实施范围。
