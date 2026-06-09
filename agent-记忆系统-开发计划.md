# Agent 记忆系统 —— 开发计划（交付文档）

> **本文档面向执行 agent**。请按顺序逐阶段实施，每阶段完成后对照"验收条件"自检；未通过的不要进入下一阶段。
> 涉及到对现有文件的修改前**必须**先运行 `gitnexus_impact({target: "符号名", direction: "upstream"})`，HIGH/CRITICAL 风险需在 commit message 中说明。

---

## 一、Context（为什么要做）

Spark-Agent 已有 `session` / `session-summary` / `conversation-summarizer` / `rules` / `context-preference` 等机制，但**没有跨会话的长期记忆**。每次新建会话用户要重新介绍背景、纠正过的错误反复犯、项目隐性约定只能靠 CLAUDE.md 手维护。

目标：让 agent 自动从对话中学习，按"用户 / 项目 / agent"三层精准注入。

**硬性约束**：
- 不引入向量库 / embedding 依赖
- 用户可随时查看、编辑、删除任意一条
- 噪声过滤：不是所有对话都产生记忆
- 写入失败必须不影响主对话（fire-and-forget + try/catch）
- 提供 settings flag 全局关闭，关闭后行为与当前完全一致

---

## 二、总体架构

### 2.1 三层记忆模型

| 层级 | scope | 作用域 | 典型内容 | 存储位置 |
|---|---|---|---|---|
| **User Memory** | `user` | 跨项目、跨 agent | 用户角色、长期偏好、技术栈背景 | `~/.spark-agent/memory/user/<id>.md` + SQLite |
| **Project Memory** | `project` | 单 workspace 内全部 agent | 项目约定、技术选型、踩坑记录 | `<workspace>/.spark-agent/memory/<id>.md` + SQLite |
| **Agent Memory** | `agent` | 单个 agent 定义 | 该 agent 角色专属反馈、领域知识 | `~/.spark-agent/memory/agent/<agentId>/<id>.md` + SQLite |

每层都包含 4 种**记忆类型**：

| type | 含义 | 写入信号示例 |
|---|---|---|
| `user` | 关于人是谁 | "我是 Java 工程师"、"我对 React 不熟" |
| `feedback` | 纠正与确认 | "别这样"、"对，这种风格保持" |
| `project` | 进行中的工作、动机、deadline | "我们 Q3 要上线 X"、"团队模式因为 Y 立项" |
| `reference` | 外部系统指针 | "bug 在 Linear INGEST 项目"、"看 grafana.xx 仪表盘" |

### 2.2 数据格式（markdown + SQLite 索引）

**markdown 文件正文**（人类可读、可手编、git 友好）：

```markdown
---
id: usr_a1b2c3d4
scope: user                         # user | project | agent
scope_ref: null                     # project: workspaceId；agent: agentId；user: null
type: feedback                      # user | feedback | project | reference
name: prefer-arco-not-radix         # 短 kebab-case slug，scope 内唯一
description: 用户偏好 Arco Design，禁止新增 Radix 依赖
confidence: 0.9
created_at: 2026-06-09T14:00:00Z
updated_at: 2026-06-09T14:00:00Z
hit_count: 0
last_hit_at: null
source_session_id: sess_xxx         # 抽取自哪个 session（可空，手动写入时为 null）
links: [ui-tech-stack]              # 关联到其它 memory.name
archived: false
---

新增 UI 组件统一用 @arco-design/web-react，禁止引入新的 @radix-ui/*。

**Why:** 历史包袱，混用样式会冲突。
**How to apply:** 写新前端组件时优先查 Arco；review PR 时若引入 Radix 直接驳回。
```

**SQLite 索引表**：

```sql
-- packages/storage/src/migrations/<N>-memory.ts
CREATE TABLE memory_entry (
  id            TEXT PRIMARY KEY,             -- usr_xxx / prj_xxx / agt_xxx
  scope         TEXT NOT NULL CHECK(scope IN ('user','project','agent')),
  scope_ref     TEXT,                          -- 对应 workspace_id / agent_id；user 层为 NULL
  type          TEXT NOT NULL CHECK(type IN ('user','feedback','project','reference')),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  file_path     TEXT NOT NULL,                 -- markdown 绝对路径
  confidence    REAL NOT NULL DEFAULT 1.0,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  last_hit_at   INTEGER,
  source_session_id TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_mem_name ON memory_entry(scope, scope_ref, name) WHERE archived = 0;
CREATE INDEX idx_mem_scope_archived ON memory_entry(scope, scope_ref, archived);
CREATE INDEX idx_mem_scope_type ON memory_entry(scope, type, archived);
```

> 选择"文件正文 + SQLite 索引"：检索/统计/关联走 SQL；正文走 markdown，便于用户直接编辑、git diff。
> **id 前缀**：`usr_` / `prj_` / `agt_`，便于日志识别。
> **scope_ref 规则**：user 层为 NULL；project 层为 workspace.id；agent 层为 agent.id。

---

## 三、关键流程

### 3.1 写入流程：每轮结束的"记忆判定"

触发时机：`session.service` 内一次完整 turn 结束（assistant 回复完毕、tool calls 全部 settle）后，**异步**调用 `MemoryWriterService.maybeWriteFromTurn(turnContext)`。**绝不阻塞主对话**。

```
turn 结束
  → 收集 turn payload：本轮 user message、assistant 最终文本、tool calls 摘要、最近 3 轮 conversation summary
  → MemoryWriterService.maybeWriteFromTurn(payload)
      → 调用小模型（默认走 model.service 配置的 "small" 档，typically Haiku）
      → LLM 按"抽取 prompt"返回 JSON：候选记忆数组
      → 逐条过 4 道闸门（见 3.2）
      → 通过的写文件 + 写 SQLite + 更新对应 MEMORY.md 索引
  → 全过程 try/catch，任何异常仅 log，不向上抛
```

#### 抽取 prompt 模板（写入 `memory-extraction.prompt.ts`）

```
你是 Spark-Agent 的记忆抽取器。读完下面这一轮对话，判断有没有需要"长期记住"的信息，按 JSON 返回。

# 必须写入
1. 用户身份/角色/技术栈背景（首次出现）→ type=user, scope=user
2. 显式纠正（"不要这样"、"别再 X"、"以后都 Y"）→ type=feedback
3. 显式认可且非显然（"对，这种风格保持下去"、"这次拆 PR 的方式很好"）→ type=feedback
4. 项目级决策与动机（"我们选 X 因为 Y"、"Q3 要上线 Z"）→ type=project, scope=project
5. 外部系统指针（"bug 在 Linear INGEST"、"看 grafana xxx"）→ type=reference

# 绝不写入（即便用户没明说）
- 可从代码、git log、CLAUDE.md 推导出的事实（架构、文件路径、约定）
- 已存在于 CLAUDE.md / 已有 memory 列表的内容
- 临时上下文（当前任务进度、本轮要做什么）
- 调试过程、bug 修复细节（这些应当在 commit message）
- 不确定的猜测（你拿不准就 confidence 给 < 0.6，下游会自动丢弃）

# scope 判定
- user：与具体项目/agent 无关、跨项目复用的事实
- project：仅在当前 workspace 内有效（强相关于该项目的代码、约定、节奏）
- agent：仅对当前 agent 角色有效

# 输出
严格 JSON，外层数组，每项：
{
  "scope": "user" | "project" | "agent",
  "type": "user" | "feedback" | "project" | "reference",
  "name": "kebab-case-slug",          // 短，scope 内唯一
  "description": "一句话摘要（≤ 80 字）",
  "body": "正文 markdown，feedback/project 类型必须包含 **Why:** 和 **How to apply:**",
  "confidence": 0.0~1.0,
  "links": ["other-memory-name"]      // 可选
}

没有任何值得写入的，返回 []。
不要包含解释、不要 ```json``` 包裹。

# 已有记忆（避免重复，scope 内 name 必须不同）
{{existingMemoriesSummary}}

# 本轮对话
USER:
{{userMessage}}

ASSISTANT:
{{assistantMessage}}

RECENT_CONTEXT:
{{recentSummary}}
```

### 3.2 写入闸门（4 道）

候选记忆按顺序过 4 道闸门，任意失败即丢弃：

1. **置信度闸门**：`confidence ≥ 0.6`（低于此说明 LLM 自己拿不准）
2. **去重 / 合并闸门**：
   - 在同 `(scope, scope_ref)` 下按 `name` 精确匹配 → 命中即触发"更新还是跳过"二次 LLM 判定
   - 未精确命中但 description 与已有条目关键词重叠率 ≥ 70% → 同样触发二次判定
   - 二次判定 prompt 返回 `merge` / `replace` / `skip` 三选一
3. **配额闸门**：
   - user: 100 条 / project: 200 条 / agent: 50 条（写入 settings 可调）
   - 超额时按 `score = hit_count × 0.5 + recency(0~1) × 0.3 + confidence × 0.2` 升序排序，归档（archived=1）末位若干条直到回到上限
4. **敏感信息闸门**：正文 / description 包含以下正则任一匹配即丢弃并 log warning
   - `(?i)(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*\S+`
   - `(?i)-----BEGIN [A-Z ]+PRIVATE KEY-----`
   - 形如 `sk-[A-Za-z0-9]{20,}`、`ghp_[A-Za-z0-9]{30,}` 等典型 token

### 3.3 读取流程：会话开始时的"记忆注入"

触发时机：`runtime-composition.service` 组装 system prompt 时（已有现成入口）。

```
组装 system prompt
  → MemoryReaderService.loadForSession({ workspaceId, agentId })
      → 并行查询三层：
          user        : SELECT * FROM memory_entry WHERE scope='user' AND archived=0
          project     : ... WHERE scope='project' AND scope_ref=:workspaceId AND archived=0
          agent       : ... WHERE scope='agent'   AND scope_ref=:agentId     AND archived=0
      → 计算总 token 数（用 description 估算，1 字 ≈ 1.5 token 上限估）
      → 若超 settings.memory.maxInjectTokens（默认 4000）：按 type 优先级裁剪
          优先级：feedback > user > project > reference
          每个 type 内按 hit_count desc, updated_at desc
      → 拼成 XML 结构化 block
  → 拼入 system prompt 的固定锚点（"# Long-term Memory" 区段）
```

注入格式（写入 system prompt）：

```
# Long-term Memory

<user-memory>
- [usr_xxx] prefer-arco-not-radix (feedback): 用户偏好 Arco Design，禁止新增 Radix 依赖
- [usr_yyy] senior-fullstack (user): 全栈工程师，偏好先讨论再动手
</user-memory>

<project-memory workspace="spark-agent">
- [prj_xxx] team-mode-phase1 (project): Team Mode Phase 1 进行中
- [prj_yyy] no-views-css (feedback): 绝不在 views.css 全局文件新增样式
</project-memory>

<agent-memory>
（如该 agent 有专属记忆）
</agent-memory>

需要查看某条记忆的完整正文（含 Why / How to apply），使用 recall_memory 工具，传入方括号内的 id。
```

> 正文只在 agent 主动 `recall_memory(id)` 时才完整读出，避免 system prompt 膨胀。每次 recall 时同步 `hit_count += 1, last_hit_at = now`。

### 3.4 内置工具：`recall_memory`

注册到 agent runtime 的内置工具集合，schema：

```typescript
{
  name: 'recall_memory',
  description: '读取一条长期记忆的完整正文（含 Why / How to apply）。当 system prompt 中的记忆摘要不足以判断时调用。',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'memory id，例如 usr_a1b2c3d4' }
    },
    required: ['id']
  }
}
```

返回值：完整 markdown 正文。若 id 不存在或已归档，返回错误说明。

### 3.5 用户控制（桌面端）

在桌面端新增「记忆」面板，最小功能：

- 列表：按 scope（user / project / agent）tab 切换，按 type 过滤
- 详情：展示完整 markdown，支持就地编辑（保存时同时更新文件 + SQLite）
- 操作：归档、删除、手动新增
- 手动新增走 `MemoryWriterService.manualWrite()`：**跳过 LLM 判定与置信度闸门**，但仍走去重、配额、敏感词闸门

---

## 四、文件清单

### 4.1 新增文件

| 路径 | 作用 |
|---|---|
| `packages/storage/src/migrations/<N>-memory.ts` | 创建 `memory_entry` 表 |
| `packages/storage/src/repositories/memory.repository.ts` | SQLite CRUD |
| `packages/storage/src/repositories/memory.repository.test.ts` | repo 单测 |
| `packages/agent-runtime/src/services/memory/memory-writer.service.ts` | 抽取 + 闸门 + 落库 |
| `packages/agent-runtime/src/services/memory/memory-reader.service.ts` | 三层加载 + 裁剪 + XML 拼装 |
| `packages/agent-runtime/src/services/memory/memory-store.service.ts` | 文件系统读写 + MEMORY.md 索引文件维护 |
| `packages/agent-runtime/src/services/memory/memory-extraction.prompt.ts` | 抽取 prompt 模板（导出函数） |
| `packages/agent-runtime/src/services/memory/sanitizer.ts` | 敏感词正则集中地 |
| `packages/agent-runtime/src/services/memory/memory-writer.service.test.ts` | 写入流程单测 |
| `packages/agent-runtime/src/services/memory/memory-reader.service.test.ts` | 读取流程单测 |
| `packages/agent-runtime/src/tools/recall-memory.tool.ts` | 内置 tool |
| `apps/desktop/src/renderer/views/MemoryPanel/index.tsx` | 用户控制面 |
| `apps/desktop/src/renderer/views/MemoryPanel/MemoryPanel.less` | 样式（同目录 .less） |

### 4.2 修改的现有文件

| 路径 | 修改要点 | 必须先做 |
|---|---|---|
| `packages/agent-runtime/src/services/runtime-composition.service.ts` | 在组装 system prompt 处插入 memory block | `gitnexus_impact` |
| `packages/agent-runtime/src/services/session.service.ts` | turn 完成处 fire-and-forget 调用 `MemoryWriterService.maybeWriteFromTurn` | `gitnexus_impact` |
| `packages/agent-runtime/src/services/settings.service.ts` | 新增 settings：`memory.enabled`, `memory.maxInjectTokens`, `memory.quota.{user,project,agent}` | 无 |
| `packages/storage/src/repositories/index.ts` | 导出 `MemoryRepository` | 无 |

### 4.3 必须复用（禁止重复造）

- `packages/agent-runtime/src/services/model.service.ts` —— 调用小模型，**禁止直接 new SDK client**
- `packages/agent-runtime/src/services/conversation-summarizer.ts` —— 提供 `recentSummary` 入参
- `packages/agent-runtime/src/services/workspace.service.ts` —— 解析 workspace 路径用于 project memory 存放
- `packages/storage/src/repositories/agent.repository.ts` —— agent_id 校验

### 4.4 接口签名（执行 agent 严格按此实现）

```typescript
// packages/storage/src/repositories/memory.repository.ts
export interface MemoryEntryRow {
  id: string;
  scope: 'user' | 'project' | 'agent';
  scope_ref: string | null;
  type: 'user' | 'feedback' | 'project' | 'reference';
  name: string;
  description: string;
  file_path: string;
  confidence: number;
  hit_count: number;
  last_hit_at: number | null;
  source_session_id: string | null;
  archived: number;
  created_at: number;
  updated_at: number;
}

export class MemoryRepository extends BaseRepository {
  insert(row: Omit<MemoryEntryRow, 'created_at' | 'updated_at'>): MemoryEntryRow;
  update(id: string, patch: Partial<MemoryEntryRow>): MemoryEntryRow;
  getById(id: string): MemoryEntryRow | null;
  findByName(scope: string, scopeRef: string | null, name: string): MemoryEntryRow | null;
  listByScope(scope: string, scopeRef: string | null, opts?: { type?: string; includeArchived?: boolean }): MemoryEntryRow[];
  bumpHit(id: string): void;
  archive(id: string): void;
  delete(id: string): void;
  countByScope(scope: string, scopeRef: string | null): number;
}

// packages/agent-runtime/src/services/memory/memory-writer.service.ts
export interface TurnPayload {
  sessionId: string;
  workspaceId: string;
  agentId: string;
  userMessage: string;
  assistantMessage: string;
  recentSummary: string;
}

export interface MemoryCandidate {
  scope: 'user' | 'project' | 'agent';
  type: 'user' | 'feedback' | 'project' | 'reference';
  name: string;
  description: string;
  body: string;
  confidence: number;
  links?: string[];
}

export class MemoryWriterService {
  maybeWriteFromTurn(payload: TurnPayload): Promise<void>;
  manualWrite(input: Omit<MemoryCandidate, 'confidence'> & { scopeRef: string | null }): Promise<MemoryEntryRow>;
}

// packages/agent-runtime/src/services/memory/memory-reader.service.ts
export interface MemoryInjection {
  block: string;          // 拼好的 XML 字符串，直接拼入 system prompt
  injectedIds: string[];
  droppedCount: number;
}

export class MemoryReaderService {
  loadForSession(input: { workspaceId: string; agentId: string }): Promise<MemoryInjection>;
  recall(id: string): Promise<string>;   // 返回完整 markdown，bumpHit
}
```

---

## 五、分期实施 & 验收条件

### Phase 1（MVP）—— 后端打通

**范围**：SQLite 表、repository、writer、reader、system prompt 注入、settings flag。无 UI、无 recall tool。

**验收条件**（每条都需可演示）：

- [ ] 运行 migration 后 `memory_entry` 表存在，索引齐全（`sqlite3 <db> ".schema memory_entry"` 输出符合 §2.2）
- [ ] `MemoryRepository` 单测全绿，覆盖 insert/update/findByName/listByScope/bumpHit/archive/countByScope
- [ ] `MemoryWriterService` 单测：mock model.service 返回固定 JSON，覆盖 4 类场景
  - 应写：返回 1 条 feedback，落库且文件存在
  - 应丢（置信度 < 0.6）：不落库
  - 应去重：同 name 二次写入触发 LLM 二次判定 mock 返回 `skip`，不重复落库
  - 应淘汰：scope 已满时新写入触发末位归档
- [ ] `MemoryReaderService` 单测：mock 三层数据，验证 token 超限时按 `feedback > user > project > reference` 裁剪
- [ ] `runtime-composition.service` 修改后，新建会话的 system prompt 包含 `# Long-term Memory` 区段（log 验证）
- [ ] `session.service` 修改后，一次 turn 结束后能在日志看到 `MemoryWriterService.maybeWriteFromTurn` 被调用，**且即使该调用抛错也不影响下一轮**
- [ ] settings `memory.enabled = false` 时：注入 block 为空字符串、writer 跳过、行为与改造前一致
- [ ] 全量 `pnpm test` 通过
- [ ] `gitnexus_detect_changes()` 输出仅涵盖本阶段预期符号

### Phase 2 —— Recall tool + 文件索引 + 配额淘汰

**范围**：`recall_memory` 内置 tool、各 scope 的 `MEMORY.md` 索引文件落地、配额淘汰策略上线、敏感词闸门完整生效。

**验收条件**：

- [ ] `recall_memory` 工具在 agent tool 列表中可见，schema 与 §3.4 一致
- [ ] 调用 `recall_memory({id})` 返回完整 markdown 正文，对应 SQLite 行 `hit_count += 1` 且 `last_hit_at` 更新
- [ ] 不存在 / 已归档的 id 返回结构化错误（不抛异常）
- [ ] 每个 scope 目录下 `MEMORY.md` 自动生成 / 更新，每行 ≤ 150 字格式：`- [name](file.md) — description`
- [ ] 写入超配额（默认 user 100 / project 200 / agent 50）时，自动归档末位条目，新条目落地。手测：把 quota 改为 3 后连写 5 条，结束后 SQLite 中 archived=0 的恰为 3 条
- [ ] 敏感词闸门：包含 `sk-abcdefghijklmnopqrstuvwxyz123` 的候选被丢弃，log 中包含 `[memory] sensitive content blocked` warning
- [ ] 单测覆盖以上每个新分支
- [ ] `gitnexus_detect_changes()` 复核影响范围

### Phase 3 —— 桌面端用户控制面

**范围**：在桌面端新增「记忆」面板，列表 / 详情 / 编辑 / 归档 / 删除 / 手动新增。

**验收条件**：

- [ ] 桌面端侧栏出现「记忆」入口（与现有任务面板同级）
- [ ] 三个 tab：User / Project（当前 workspace）/ Agent，可按 type 过滤
- [ ] 列表条目展示 name / description / type / hit_count / updated_at
- [ ] 点击条目展开右侧抽屉，markdown 渲染正文 + 元数据
- [ ] 编辑保存：同步更新文件与 SQLite，`updated_at` 刷新
- [ ] 归档：列表移除（可在"已归档"视图中看到），SQLite `archived=1`
- [ ] 删除：二次确认后真删文件 + DB 行
- [ ] 手动新增：弹窗输入 scope / type / name / description / body，跳过置信度闸门，仍走去重 / 配额 / 敏感词
- [ ] 仅使用 Arco Design 组件（**严禁**新增 Radix 依赖；表单元素必须用 `SparkInput / SparkSelect / SparkTextarea`）
- [ ] 样式写入同目录 `MemoryPanel.less`（**严禁**写入任何 `*.css` 全局文件，尤其 `views.css`）
- [ ] 桌面端通过 `pnpm dev` 启动后，按"端到端手测"全过

### Phase 4（可选前卫扩展）—— 反思与共享

**范围**：定期反思 job（合并相关条目、抽取高阶规律）、agent 间共享开关。

**验收条件**：

- [ ] settings 中可配置 reflection 触发条件（如每 100 条新记忆 / 每 24 小时）
- [ ] 反思 job：批量读取近期高 hit_count 条目，调小模型生成 1~3 条高阶 `feedback`，原条目 `links` 互指
- [ ] agent 共享开关：在 agent 定义中加 `shareMemoryWith: agentId[]`，reader 加载时合并这些 agent 的 memory
- [ ] 反思 job 失败不影响正常读写

---

## 六、端到端手测剧本（Phase 1~3 完成后必跑）

1. 全新空数据库启动 desktop
2. 新建会话 A，告诉 agent："我是 Java 工程师，对 React 不熟，先讨论再动手"
3. agent 正常回复后等 5 秒（让异步写入完成）；打开记忆面板，应看到至少 1 条 `user` scope 的记忆
4. 关闭会话 A，新建会话 B；查看 agent 第一次回复的 system prompt（开发者工具或 log），应包含步骤 2 的记忆摘要
5. 在会话 B 问 "你了解我吗"，agent 应能复述工程师身份与偏好
6. 在会话 B 纠正 agent："以后写代码不要加 console.log，统一用我们的 logger"
7. 等待异步写入；新建会话 C，让 agent 写一段含日志的代码，应**不出现** console.log
8. 切换到另一个 workspace D，新建会话 E；记忆面板的 Project tab 应**看不到** workspace C 的 project 记忆，但 User tab 仍可见
9. 手动新增一条 user 记忆，name 故意与现有冲突 → 应弹错或触发更新流程
10. 手动新增一条带 `sk-fake1234567890abcdef1234` 的记忆 → 应被敏感词闸门拒绝
11. 把 user quota 改为 3，手动新增第 4 条 → 末位条目应自动归档
12. settings 关闭 `memory.enabled`，新建会话 F → system prompt 不含 memory block，turn 结束不触发写入

---

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| LLM 抽取出错伤主流程 | fire-and-forget + try/catch + 详细 log；任何异常不向上抛 |
| system prompt 膨胀 | description 注入 + 正文懒加载；token 超限按 type 优先级裁剪 |
| 误记噪声 | 4 道闸门 + 用户手动删除入口；description 一目了然便于审查 |
| 配额无限增长 | 写入路径自动淘汰，不依赖定时 job |
| 多端 / 多进程并发写入冲突 | SQLite 写入用事务；文件写入用 `<id>.md.tmp` → rename 原子替换 |
| 用户隐私 | 敏感词正则 + 所有数据本地存放，无远端上传 |
| 现有功能回归 | settings flag 一键关闭；每阶段都跑 `gitnexus_detect_changes` + 全量测试 |

---

## 八、给执行 agent 的最后提醒

- **编辑任何现有符号前**先 `gitnexus_impact({target, direction:"upstream"})`，高风险必须告知用户
- **提交前**必须 `gitnexus_detect_changes()` 校验影响范围
- **样式**：Tailwind + 组件级 `.less`，**禁止**新增全局 `.css` 规则、**禁止**新增 `@radix-ui/*` 依赖
- **表单**：必须用 `SparkInput / SparkSelect / SparkTextarea / SparkCheckbox / SparkMultiSelect`
- **测试**：`@spark/storage` 测试若 ABI 报错，先切 better-sqlite3 ABI（参见 user memory `storage-tests-better-sqlite3-abi.md`）
- **commit 信息**：遵循仓库现有 `feat(scope): xxx` / `fix(scope): xxx` 风格
