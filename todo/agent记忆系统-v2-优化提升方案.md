# Agent 记忆系统 V2 —— 优化提升方案（交付给执行 agent）

> 状态: 实施中（M1 已落地，2026-07-03） | 最后核对: 2026-07-03
>
> **本文档面向执行 agent**。请按里程碑顺序实施，每个里程碑完成后对照「验收标准」自检，未通过不得进入下一个。
> 修改任何现有符号前**必须**先 `gitnexus_impact({target: "符号名", direction: "upstream"})`；提交前**必须** `gitnexus_detect_changes()`。
>
> **M1 落地记录（2026-07-03）**：T1.1–T1.6 全部完成并提交（commit 8187cd44 / f0e2b1b1 / 9206787c / 818769a2 / 0cabbe2e7）。
> - 存储层 SQL（migration 042 + FTS5 + sqlite-vec）用真实 migration 文件在隔离 spike 验证通过。
> - 服务层 + 存储层共 99 例测试全绿（含 ABI 切换跑通的真实 DB 测试：storage 39 + agent-runtime real-DB 39 + mock 21）；agent-runtime typecheck 0 错误。
> - 打包坑已修：electron-builder asarUnpack 补 `sqlite-vec*/**`（vec0.dylib 非 .node）。
> - 审查顺手修了 findByName 返回 undefined 的预存在 bug（memory.repository 22/22）。
>
> **M2 进度（2026-07-03）**：
> - 增量 1（commit f45f2c8ae）：`ModelService.complete()` + 接通 writer 真实 LLM 抽取（原 callLLM 是 stub，写入路径从不产记忆）。7 例单测全绿。
> - 增量 2（commit T2.1/T2.2）：演化决策 `memory-evolution.service.ts`（FTS 召回相似 + LLM 判 ADD/UPDATE/DELETE/NOOP，取代 merge/replace/skip）+ writer 接入 + bi-temporal 失效链（DELETE 置 invalid_at、UPDATE 保 id/hit_count + ## History、recall 失效标注）。18 例测试全绿（13 决策 mock + 5 执行真实 DB），全套 memory 78 例全绿。
> - T2.3 配额同步：FTS 已在 archive/invalid 自动移除（repo.update becomesInactive 分支），vec 靠检索层 invalid_at 过滤（惰性，显式删 vec 为优化非正确性）——实质已完成。
> - 审查修复（commit 6181b5599）：updateEntry 写入顺序（先文件后 DB，避免文件写失败致 DB 领先 recall 永久损坏）；检索索引回填触发（backfillFtsIfNeeded + backfillMissingVectors 在 reader 注入点 fire-and-forget，原从未触发致 evolution 召回/向量检索漏数据）。
>
> **M3 进度（2026-07-03）**：
> - T3.1 实体图基础（commit T3.1）：migration 043（memory_entity + memory_entity_link）+ MemoryEntityRepository（规范化别名去重、findRelated 一跳、clearLinks）+ 抽取 prompt entities 字段 + writer ADD/UPDATE 落库。12 例真实 DB 测试全绿。
> - T3.2 search 一跳扩展（commit 51dcc6532）：search_memory 命中后对 top3 查 findRelated，附"经实体关联的其他记忆"段（≤5，失败安全）。
> - T3.3 整合 consolidation job（commit T3.3）：memory-consolidation.service —— 回顾性反思，MERGE 同事实多条（dropIds 失效指向 keep）/ ELEVATE 低阶 feedback 升华高阶规律（source_session_id='consolidation'）；触发门控（≥30 条且 ≥7 天）、防重入、fire-and-forget。17 例测试全绿（parse 11 + exec 6）。**M3 完成。**
> - **全链路审查修复（commit 10a8d8680）**：7 维度对抗式审查（97 agent，44 confirmed）→ 修 7 high + 关键 medium：唯一索引加 invalid_at（H1，migration 045）、listByScope/count/findByName 过滤失效（H3）、FTS 查询 CJK phrase+英文 AND（H5，修会话注入 seedQuery 恒空）、EmbeddingService 跨 turn 单例缓存（H2，修负缓存失效致每轮阻塞 15s）、processCandidate per-candidate 错误隔离（H7）、memory.enabled 短路注入块（H4）、insert 传 body（M9）、delete/inactive 清 vec+entity_link（M11/M16）、bumpHit 不刷 updated_at（M12）、parseCandidates 枚举校验（M14）。全套 memory 95/95 + storage 61/61 绿。
> - **M4 评测集 + 端到端剧本（commit 477f1e45a / 8916c542f）**：确定性黄金集 gate 16/16 (100%) + search 11/11 (100%)，BASELINE.md 含已知 limitation；端到端真机剧本 7 场景（todo/记忆系统-v2-端到端测试用例.md）。**M4 完成，待真机验证。**

---

## 一、说明（背景与动机）

### 1.1 现状

Phase 1 MVP（见 `docs/agent-记忆系统-开发计划.md`）已落地：

- **三层 scope**（user / project / agent）× **4 种 type**（user / feedback / project / reference）
- **存储**：markdown 正文（`~/.spark-agent/memory/**` 与 `<workspace>/.spark-agent/memory/`）+ SQLite `memory_entry` 索引表
- **写入**：turn 结束后小模型抽取 → 4 道闸门（置信度 / 去重 / 配额 / 敏感词）→ 落库
- **读取**：会话开始时把**全部**未归档条目的 description 拼进 system prompt，超 4000 token 按 type 优先级裁剪
- 核心代码：`packages/agent-runtime/src/services/memory/`（writer / reader / store / sanitizer / prompt）、`packages/storage/src/repositories/memory.repository.ts`

### 1.2 与开源社区最先进方案的差距

对照 2026 年主流开源记忆方案（[Mem0](https://github.com/mem0ai/mem0)、[Zep/Graphiti](https://github.com/getzep/graphiti)、[Letta/MemGPT](https://github.com/letta-ai/letta)、[Cognee](https://github.com/topoteretes/cognee)、[Memvid](https://github.com/Olow304/memvid)、LangMem），当前实现是"草稿版"的关键短板：

| # | 短板 | 后果 | 社区对标 |
|---|---|---|---|
| 1 | **没有查询时检索**：只在会话开始一次性注入全部 description，会话中途无法按需搜索 | 记忆多了以后要么裁剪丢失、要么 prompt 膨胀；与当前话题无关的记忆挤占相关记忆 | Mem0 / Zep 都是 query-time hybrid search（向量 + BM25 + 过滤），P95 300ms 内且检索不调 LLM |
| 2 | **去重靠 name 精确匹配 + 关键词重叠率**，语义级重复识别不了 | "偏好 Arco 不用 Radix" 与 "别再引入 radix-ui" 会存成两条 | Mem0 用向量相似度召回已有记忆再决策 |
| 3 | **记忆演化只有 merge/replace/skip**，没有"事实失效"概念 | 用户说"我们从 webpack 切到 vite 了"，旧记忆要么被覆盖丢失历史，要么留下互相矛盾的两条 | Zep/Graphiti 的 temporal model：事实带 valid_from / invalid_at，新事实到来时旧事实标记失效而非删除 |
| 4 | **links 字段是死数据**：只存 name 数组，检索不利用 | 无法做"找到一条记忆后顺藤摸瓜拉出关联记忆" | Cognee / Graphiti 用实体-关系图做多跳检索 |
| 5 | **反思/整合（consolidation）未实现**（原计划 Phase 4） | 碎片记忆越积越多，永远不会升华成高阶规律 | Letta sleep-time compute、LangMem 后台整合 |
| 6 | **无评测手段** | 改 prompt / 改检索策略好坏全凭感觉 | LongMemEval、Mem0 的 LOCOMO 评测套路 |

### 1.3 选型结论：**不引第三方记忆库，借其架构自建**

评估过的方案与结论：

- **Mem0**（Apache-2.0, Python 为主，TS SDK 偏薄）：其核心价值是"抽取 → 相似召回 → ADD/UPDATE/DELETE/NOOP 决策"流水线，这个**模式**值得抄，但库本身要求外接向量库（Qdrant 等）且 TS 支持二等公民，不适合本地优先的 Electron 应用。
- **Zep/Graphiti**（需要 Neo4j/FalkorDB + 服务端）：temporal knowledge graph 是[对多跳/时序问题最强的方案](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)（LongMemEval 63.8% vs Mem0 49.0%），但依赖图数据库服务，桌面端装不起。**抄其 bi-temporal 数据模型**（事实有效期 + 观察时间），用 SQLite 表实现轻量版。
- **Letta/MemGPT**：core memory blocks（agent 可自编辑的常驻记忆块）+ 分页式 archival 的**分层思想**值得抄；作为框架引入则会取代我们整个 runtime，不可行。
- **Cognee**：ECL（Extract-Cognify-Load）知识图谱管线，重且面向文档灌入场景，本项目记忆量级（百条）用不上完整 KG 管线；抄其"实体规范化"思路即可。
- **Memvid**（把文本块编码进视频帧 + 语义索引）：零基础设施很讨巧，但本质是只读归档介质，不支持就地更新/失效，与我们"用户可编辑每条记忆"的硬约束冲突，**不采用**。
- **本地检索底座**：SQLite **FTS5**（BM25 关键词）+ **sqlite-vec**（本地向量，纯 C 扩展、better-sqlite3 可加载）是桌面端零外部服务的标准组合，Hybrid（BM25 + 向量 + 结构化过滤 + RRF 融合）检索精度[优于单一路线](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)。

> **约束变更说明**：原计划的硬约束"不引入向量库/embedding 依赖"在 V2 **有条件放宽**——向量能力通过 sqlite-vec（本地文件内扩展，非独立服务）+ 可选 embedding provider 实现；**用户未配置任何 embedding 模型时，系统必须自动降级为 FTS5-only，全部功能仍可用**。其余硬约束（用户可查看/编辑/删除任意条、写入失败不影响主对话、settings 一键关闭）**全部保留**。

---

## 二、功能需求

### FR-1 查询时混合检索（最高优先级）

1. 新增内置工具 `search_memory({ query, scope?, type?, limit? })`：会话中 agent 可随时按语义/关键词搜索三层记忆，返回带 id 的摘要列表（复用现有 recall 深读模式）。
2. 检索管线：FTS5(BM25) 与 sqlite-vec(cosine) 两路并行 → RRF（Reciprocal Rank Fusion）融合 → 结构化过滤（scope/type/archived/失效）→ 按 `融合分 × 时间衰减 × confidence` 重排。
3. 无 embedding provider 时自动降级 FTS5 单路，接口与返回结构不变。
4. 会话开始注入从"全量 description"改为"**预算内的相关子集**"：以 `agent 定义 + workspace 名 + 最近会话摘要` 为查询种子做一次检索，取 top-K 注入；feedback 类型始终全量注入（行为守则不能靠运气召回）。

### FR-2 记忆演化操作（Mem0 模式）

1. 写入闸门第 2 道升级：候选记忆先经混合检索召回同 scope 相似条目（top 5），交给小模型做四选一决策 `ADD / UPDATE / DELETE(失效) / NOOP`，替换现有 merge/replace/skip。
2. `UPDATE` 保留原 id 与 hit_count，正文与 description 更新，`updated_at` 刷新，旧正文追加到文件末尾的 `## History` 区段（最多留 3 版）。
3. `DELETE` 不物理删除：见 FR-3 的失效机制。

### FR-3 时间感知（Graphiti 轻量版 bi-temporal）

1. `memory_entry` 增加列：`valid_from`（事实生效时间，默认=created_at）、`invalid_at`（事实失效时间，NULL=仍有效）、`superseded_by`（被哪条记忆取代）。
2. 新事实与旧事实矛盾时（FR-2 决策为 DELETE/UPDATE-替代），旧条目置 `invalid_at=now, superseded_by=<新id>`，不删文件。
3. 检索默认只召回 `invalid_at IS NULL`；`recall_memory` 读到已失效条目时在返回中显式标注"已于 X 被 Y 取代"。
4. 用户 UI 可查看失效历史链。

### FR-4 实体关联图（轻量，SQLite 内）

1. 新表 `memory_entity(id, name, normalized_name, scope, scope_ref)` 与 `memory_entity_link(memory_id, entity_id)`；抽取 prompt 增加返回 `entities: string[]`（人名/库名/模块名/系统名）。
2. 实体规范化：小写、去空格、常见别名映射（写死映射表即可，不调 LLM）。
3. `search_memory` 结果附带"经共享实体关联的其他记忆"一跳扩展（最多 3 条）。
4. 现有 `links` 字段并入该机制（name 链接转为实体链接的一种）。

### FR-5 反思与整合（consolidation，落地原 Phase 4）

1. 触发条件（settings 可配）：单 scope 新增记忆满 N 条（默认 30）或距上次整合超 7 天，且仅在应用空闲时执行。
2. 整合 job：读取该 scope 全部有效条目 → 小模型输出操作清单（合并语义重复、把多条低阶 feedback 升华为 1 条高阶规律、标记过期候选）→ 逐条走 FR-2 演化操作落地（复用同一套代码，不另写落库逻辑）。
3. 整合产生的新条目 `source_session_id = 'consolidation'`，UI 可识别。
4. 失败仅 log，不重试风暴（下个触发周期再试）。

### FR-6 评测与可观测

1. `packages/agent-runtime/src/services/memory/__evals__/`：固定 20 组「对话片段 → 期望写入/不写入」+ 20 组「查询 → 期望召回 id」的黄金用例，跑分脚本输出 precision/recall。
2. 每次检索/写入决策打结构化 log（决策类型、耗时、召回数），便于回归对比。

### 非目标（本期不做）

- 不做多设备同步 / 云端存储；不引入独立图数据库；不做记忆的自动跨 agent 共享（保留原 Phase 4 的 `shareMemoryWith` 设想，另立项）。

---

## 三、开发方案

### 3.1 架构总览

```
写入路径（turn 结束，异步 fire-and-forget，保持不变的外壳）
  turn payload → 抽取(小模型, 增加 entities 字段)
    → 敏感词闸门（提前到第一道，省一次检索）
    → 混合检索召回相似 top5
    → 演化决策(小模型): ADD | UPDATE | DELETE | NOOP
    → 落库: markdown 文件 + memory_entry + FTS5 + vec + entity 表（单事务）
    → 配额闸门（归档时同时使 FTS/vec 行失效）

读取路径
  会话开始: 种子查询 → hybrid search → feedback 全量 + 相关 top-K 注入
  会话中:   search_memory(query) → hybrid search → 摘要列表
            recall_memory(id)   → 完整正文（含失效标注）
```

### 3.2 检索实现细节

- **FTS5**：`CREATE VIRTUAL TABLE memory_fts USING fts5(name, description, body, content='')`，external-content 模式，由 repository 在 insert/update/archive 时同步维护（不用 trigger，统一走事务代码，便于测试）。**中文分词（已验证，2026-07-03）**：unicode61 把连续 CJK 当整词、trigram 对二字词（如"迁移"）查不到，两者都不行；采用**写入与查询时对 CJK 逐字预分词**（`s.replace(/[一-鿿㐀-䶿]/g, c => ' '+c+' ')`），tokenizer 保持 unicode61，查询侧包成短语（`"迁 移"`）。该方案对二字词/多字词/中英混合均验证通过。
- **sqlite-vec（已验证，2026-07-03）**：`sqlite-vec@0.1.9` npm 包经 optionalDependencies 分发平台二进制（如 `sqlite-vec-darwin-arm64/vec0.dylib`），`sqliteVec.load(db)` 在 **Node v22（ABI 127）与 Electron 31.7.7（ABI 125）双环境均加载成功**（扩展是纯 sqlite 扩展，与 better-sqlite3 的 ABI 无关），`vec0` 虚拟表 KNN 查询正确。虚拟表 `memory_vec(embedding float[<dim>])`，rowid 对齐 memory_entry 的自增 rowid。**维度取决于用户配置的 embedding 模型，首次确定后写入 settings；模型更换时需全量重建向量（提供 rebuild 入口）**。
- **Embedding 来源**：走 `model.service` 新增的 `embed(texts: string[])` 能力，provider 支持 OpenAI 兼容 `/embeddings` 端点（用户已配的任一 provider 若有 embedding 模型即可用）。**禁止直接 new SDK client**。无可用 embedding 模型 → `capabilities.vector = false`，全链路降级。
- **RRF 融合**：`score = Σ 1/(60 + rank_i)`，两路各取 top20 融合后取 top-limit；再乘时间衰减 `exp(-λ·days_since_updated)`（λ 默认 0.01，settings 可调）。
- **注入种子查询**：`agentName + agent 描述前 200 字 + workspace 名 + 最近一次 session summary 前 300 字`。

### 3.3 数据迁移

- 新 migration：`memory_entry` 加 `valid_from / invalid_at / superseded_by` 三列（默认值兼容存量行）；建 `memory_fts`、`memory_entity`、`memory_entity_link` 表。
- 迁移后一次性回填：存量条目批量写入 FTS5；向量列**懒回填**（首次检索时对未 embed 的条目排队后台 embed，避免迁移卡启动）。

### 3.4 文件清单

新增：

| 路径 | 作用 |
|---|---|
| `packages/storage/src/migrations/<N>-memory-v2.ts` | 三列 + FTS5 + entity 表 |
| `packages/storage/src/repositories/memory-search.repository.ts` | FTS5/vec 维护 + hybrid 查询 SQL |
| `packages/agent-runtime/src/services/memory/memory-search.service.ts` | RRF 融合、降级开关、时间衰减重排 |
| `packages/agent-runtime/src/services/memory/memory-evolution.service.ts` | ADD/UPDATE/DELETE/NOOP 决策与执行 |
| `packages/agent-runtime/src/services/memory/memory-consolidation.service.ts` | 整合 job |
| `packages/agent-runtime/src/services/memory/embedding.service.ts` | embed 队列、维度管理、rebuild |
| `packages/agent-runtime/src/tools/search-memory.tool.ts` | `search_memory` 内置工具 |
| `packages/agent-runtime/src/services/memory/__evals__/` | 黄金用例 + 跑分脚本 |

修改（每个都先跑 `gitnexus_impact`）：

| 路径 | 修改要点 |
|---|---|
| `memory-writer.service.ts` | 闸门顺序调整 + 接入 evolution 决策 |
| `memory-reader.service.ts` | 注入逻辑改为 feedback 全量 + 检索 top-K |
| `memory-extraction.prompt.ts` | 增加 entities 输出、演化决策 prompt |
| `memory-store.service.ts` | UPDATE 时维护 `## History` 区段 |
| `memory.repository.ts` | 新列 CRUD、失效链查询 |
| `model.service.ts` | 新增 `embed()` 能力探测与调用 |
| `settings.service.ts` | `memory.search.*`、`memory.consolidation.*`、embedding 模型选择 |
| 记忆面板（若 Phase 3 UI 已存在则扩展；不存在则本期只做后端，UI 沿用原计划） | 失效链视图、"来自整合"标识、向量重建按钮 |

---

## 四、任务拆解（4 个里程碑，可分别独立交付）

### M1 混合检索底座（预计改动最大，先行）

- [ ] T1.1 migration：新列 + `memory_fts`（先不建 vec 表）；存量回填 FTS
- [ ] T1.2 `memory-search.repository.ts`：FTS 同步维护 + BM25 查询；改造 insert/update/archive 走同一事务
- [ ] T1.3 `embedding.service.ts` + `model.service.embed()`：能力探测、批量 embed、懒回填队列
- [ ] T1.4 sqlite-vec 集成：扩展加载（注意 Electron/Node 双 ABI，见注意事项 5）、`memory_vec` 表、维度管理与 rebuild
- [ ] T1.5 `memory-search.service.ts`：RRF + 时间衰减 + 降级逻辑；单测覆盖"有/无向量"两条路径
- [ ] T1.6 `search_memory` 工具注册 + `memory-reader.service` 注入逻辑改造（feedback 全量 + top-K）

### M2 演化与时间感知

- [ ] T2.1 演化决策 prompt + `memory-evolution.service.ts`（ADD/UPDATE/DELETE/NOOP），writer 接入，删除旧 merge/replace/skip 代码
- [ ] T2.2 bi-temporal：失效链写入/查询、recall 失效标注、`## History` 区段
- [ ] T2.3 配额闸门与检索层同步（归档/失效条目从 FTS/vec 移除）

### M3 实体图 + 整合

- [ ] T3.1 抽取 prompt 加 entities、entity 表落库与规范化
- [ ] T3.2 search 结果一跳实体扩展
- [ ] T3.3 `memory-consolidation.service.ts`：触发器（条数/时间/空闲）、操作清单执行复用 evolution、`source_session_id='consolidation'`

### M4 评测 + 收尾

- [ ] T4.1 黄金用例集 + 跑分脚本（写入判定 40 例、检索 20 例），基线分数记录进 `__evals__/BASELINE.md`
- [ ] T4.2 结构化 log 与耗时埋点
- [ ] T4.3 UI 增量（若记忆面板已存在）：失效链、整合标识、rebuild 按钮
- [ ] T4.4 更新 `docs/agent-记忆系统-开发计划.md` 状态行，本文档状态改为"已落地"

> 每个里程碑独立 commit（`feat(memory): ...`），完成后跑全量 `pnpm test` + `gitnexus_detect_changes()`。

---

## 五、验收标准

### M1

- [ ] 无 embedding 模型配置时：`search_memory({query:"arco"})` 走 FTS 返回相关条目，log 显示 `vector=disabled`，全流程无异常
- [ ] 配置 embedding 模型后：语义查询（如库中有"偏好 Arco Design"，查询"UI 组件库怎么选"）能命中 FTS 命不中的条目
- [ ] RRF 单测：构造两路各自独占的命中，验证融合排序正确；时间衰减单测：同分条目新者在前
- [ ] 会话开始注入：构造 60 条记忆（10 条 feedback + 50 条杂项），注入块包含全部 10 条 feedback 且总 token ≤ `maxInjectTokens`，杂项按相关性取子集
- [ ] embedding provider 中途报错：检索自动降级 FTS-only 并 log warning，不抛给主对话
- [ ] 存量库升级：跑 migration 后旧记忆可被 FTS 搜到；向量懒回填在后台完成（log 可见进度）
- [ ] `@spark/storage` 与 `agent-runtime` 全量单测通过

### M2

- [ ] 演化四分支各有单测：mock 决策返回 ADD/UPDATE/DELETE/NOOP，验证落库行为（UPDATE 保 id 保 hit_count、DELETE 置 invalid_at+superseded_by 且文件仍在、NOOP 零写入）
- [ ] 手测剧本：先告知"我们用 webpack"，产生记忆后再告知"我们已经迁到 vite 了" → 旧条目失效、新条目生效、`recall_memory(旧id)` 返回带"已被取代"标注
- [ ] 语义去重：先存"偏好 Arco 不用 Radix"，再触发"别再引入 radix-ui"的抽取 → 决策为 UPDATE 或 NOOP，库中不出现语义重复的两条
- [ ] 默认检索不返回 invalid 条目；UI/repository 可查失效链

### M3

- [ ] 抽取包含实体的对话后 `memory_entity` / `memory_entity_link` 有正确行；同一实体不同写法（"Arco"/"arco design"）规范化为一行
- [ ] `search_memory` 命中条目 A 时，与 A 共享实体的条目 B 出现在扩展区（≤3 条）
- [ ] 整合 job：造 30+ 条含重复/低阶 feedback 的 scope，手动触发整合 → 条目数下降、出现 `source_session_id='consolidation'` 的高阶条目、被合并者进入失效链
- [ ] 整合 job 抛错仅 log，主流程与下次触发不受影响；非空闲时不执行（mock 验证）

### M4

- [ ] 跑分脚本一条命令出 precision/recall，写入判定 precision ≥ 0.85、检索 recall@5 ≥ 0.8（黄金集上）；结果落盘 `BASELINE.md`
- [ ] `memory.enabled=false` 时 V2 全部路径（search 工具、整合、embed 队列）均静默关闭，行为与关闭前一致
- [ ] 端到端手测：沿用原计划第六章 12 步剧本全过 + 本文档 M1/M2 手测项全过
- [ ] `gitnexus_detect_changes()` 影响范围仅涵盖本方案文件清单

---

## 六、注意事项（执行 agent 必读）

1. **绝不阻塞主对话**：写入、embed、整合全部异步 + try/catch 到底；任何新代码路径抛错只允许 log。这是 V1 的硬约束，V2 继承。
2. **降级优先于报错**：向量不可用 → FTS-only；FTS 查询异常 → 退回 V1 的全量注入。每级降级都要 log 但不能让用户感知为故障。
3. **禁止直接 new SDK client**：embedding 调用必须走 `model.service`；小模型决策沿用现有调用通道。
4. **单事务一致性**：`memory_entry` / FTS / vec / entity 四处写入必须同一事务；文件写入沿用 `.tmp → rename`。SQLite 事务内不要 await 外部 IO（better-sqlite3 是同步 API，embed 结果先算好再进事务）。
5. **better-sqlite3 双 ABI 坑（已验证 2026-07-03，风险解除大半）**：sqlite-vec 扩展与 ABI 无关，Node/Electron 双环境实测均可加载。本地跑 `@spark/storage` 测试仍需切 Node ABI（编译方法见 user memory `storage-tests-better-sqlite3-abi.md`；注意 `prebuild-install --runtime node` 拉的 arm64 预编译是坏的，必须源码编译，用完必须还原 Electron 版否则 `pnpm dev` 崩）。**打包已知必改点**：electron-builder 的 `asarUnpack` 目前只有 `**/*.node`，而 sqlite-vec 的二进制是 `vec0.dylib`（在 `sqlite-vec-darwin-arm64` 等平台包内），asar 内的 dylib 无法被 `loadExtension` 加载——必须在 `apps/desktop/electron-builder.yml` 的 asarUnpack 增加 `'**/node_modules/sqlite-vec*/**'`；且 sqlite-vec 需加进 `apps/desktop/package.json` 的 dependencies（生产依赖闭包才会被收集，参见 memory `packaging-size-and-pnpm-collection.md`）。
6. **prompt 改动要跑评测**：M4 之前改抽取/演化 prompt 允许凭手测，M4 落地后任何 prompt 改动必须跑黄金集且分数不回退。
7. **UI 约束**（若涉及）：仅 Arco Design、表单用 `SparkInput/SparkSelect/SparkTextarea`、样式写组件同目录 `.less`，**严禁**动 `views.css` 等全局 css，**严禁**新增 `@radix-ui/*`。
8. **不要重写 V1**：V2 是在现有 writer/reader/store/repository 上增量演进，接口签名尽量保持，破坏性修改前先 `gitnexus_impact` 并在 HIGH/CRITICAL 时停下来向用户说明。
9. **配额与整合的相互作用**：整合可能在满配额 scope 里新增条目，先执行失效/合并再写新条目，避免触发误淘汰。
10. **中文检索质量（已验证，方案定死）**：不要用裸 unicode61（连续中文当整词，"迁移"查不到"迁移到 vite"）也不要用 trigram（二字词直接失效）。采用 §3.2 的 CJK 逐字预分词 + 短语查询方案，repository 写入与查询两侧必须走同一个 `segmentCjk()` 工具函数（放 `packages/storage` 内导出，单测覆盖中英混合）。
11. **文档保鲜**：本文档位于 `todo/`，落地后按 CLAUDE.md 规则更新状态行；同时刷新 `docs/agent-记忆系统-开发计划.md` 的状态与"最后核对"。

---

## 附：参考资料

- [Mem0 vs Zep vs Letta vs Cognee 实测对比 (2026)](https://particula.tech/blog/agent-memory-frameworks-tested-mem0-zep-letta-cognee-2026)
- [AI Agent Memory Systems in 2026 全景对比](https://blog.devgenius.io/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8)
- [Graphiti: temporal knowledge graph for agent memory (Neo4j blog)](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)
- [2026 记忆框架排名与 hybrid retrieval 实践](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)
- [8 个记忆框架横评 (vectorize.io)](https://vectorize.io/articles/best-ai-agent-memory-systems)
- [Cognee 官方: 开源记忆工具指南](https://www.cognee.ai/blog/guides/best-open-source-ai-memory-tools-for-llm-agents-and-developers)
