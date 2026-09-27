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

**S1B.2 完成（2026-09-27，commit `c68132a99`）：** E5（search repo 层 fails）与 E6（embedding 层 fails）已反转为 `it` 并通过——文本更新失效旧向量重新排队（`invalidateVecIndex`）、回填晚到向量按输入摘要比对拒绝占位（`upsertVec` 第三参）。新增 3 组用例：E6 防护（repo 层）、同维度模型切换重建+代际失效、代际稳定。既有 `listEntriesMissingVec` 用例按新契约更新（upsertVec 需带输入摘要才离开回填队列）。**顺带修正**：embedding.service.test 的 settings 跨用例污染——此前 E6 的 `it.fails` 通过实为超时假阳性（首个用例清空 settings.memory 未恢复，第二用例 embed 永不被调用而自旋超时；fails 语义把超时当"反例成立"），反转时暴露并修复测试隔离。storage 全量 442/442、memory 域 155/155。仍在 `fails` 状态：E3/F4/E1（文件与投影同步，待 S1B.4）。

## 后续 prompt/逻辑改动须跑此集（S0 增补）

S1A/S1B 各切片除上述集外，必须同步反转对应 `it.fails` 用例并在 todolist 进度日志记录；反转后全量重跑本表测试文件。
