# 记忆系统 V2 评测基线

> 最后核对: 2026-07-03 | 评测集: gate-cases (16) + search-cases (11)

## 基线分数

| 维度 | 用例数 | 通过 | 分数 |
|---|---|---|---|
| 写入闸门（gate） | 16 | 16 | **precision 100.0%** |
| 检索召回（search） | 11 | 11 | **recall 100.0%** |

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
# cd node_modules/better-sqlite3 && prebuild-install --runtime electron --target 31.7.7
```

输出含 `gate: N/M precision = X%` 与 `search: N/M recall = X%` 汇总。

## 已知 limitation（非 bug，设计权衡）

1. **瞬时闸门对自然语言任务进度表述覆盖有限**：detectTransientMemory 用正则启发式，能稳定捕获"日期 / 今天+数字 / 实时数据词"，但"还差 N 个文件""正在 debug X"这类纯自然语言表述需靠**抽取 prompt 指令**（不存任务进度）规避，闸门是兜底。评测用例用稳定信号（"现在 N"）。
2. **抽取 prompt 的真 LLM 评测未含在确定性集**：写入闸门用例 mock 了 callLLM，不测 prompt 质量。真 LLM 抽取准确率（precision/recall）需单独跑（需配置 extraction 模型），用例数据可扩展自 gate-cases 的 candidate。
3. **检索用例为 FTS-only**：向量路径（sqlite-vec + RRF 融合）需 embedding 配置，不在确定性集（不稳定）。memory-search.service.test.ts 的 mock 测试覆盖 RRF/衰减/降级逻辑。

## 后续 prompt/逻辑改动须跑此集

任何改动 `memory-extraction.prompt.ts` / writer 闸门 / evolution / segment-cjk / memory-search.repository 后，必须跑此评测集且分数不回退。
