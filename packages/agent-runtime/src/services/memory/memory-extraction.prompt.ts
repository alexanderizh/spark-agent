/**
 * @module memory-extraction.prompt
 *
 * 记忆抽取 prompt 模板
 *
 * 供 MemoryWriterService 调用小模型时使用。
 * 返回的 prompt 包含完整指令 + 已有记忆摘要 + 本轮对话上下文。
 */

export interface ExtractionPromptParams {
  userMessage: string
  assistantMessage: string
  recentSummary: string
  existingMemoriesSummary: string
  /** 当前会话绑定的 workspaceId（影响 scope 判定，无则视为非项目会话） */
  workspaceId?: string
  /** 当前会话的 agentId（影响 scope 判定） */
  agentId?: string
}

/**
 * 构建记忆抽取 prompt
 *
 * 返回的 prompt 指导 LLM 从对话中提取值得长期记住的信息。
 * 输出格式为 JSON 数组。
 */
export function buildExtractionPrompt(params: ExtractionPromptParams): string {
  // 构造"当前会话上下文"段落 —— 把 workspaceId/agentId 告诉 LLM，让它能区分
  // "项目相关事实"（应归 project scope）与"用户跨项目特征"（应归 user scope）。
  // 否则 LLM 看不到项目信息，会把"我在这个项目里独自开发"误归到 user scope，
  // 导致别的项目也读到这条记忆。
  const inProject = params.workspaceId != null && params.workspaceId.length > 0
  const ctxLines: string[] = []
  ctxLines.push(inProject ? `当前是项目会话（workspaceId=${params.workspaceId}）` : '当前非项目会话（无 workspace 绑定）')
  if (params.agentId != null && params.agentId.length > 0) {
    ctxLines.push(`当前 agentId=${params.agentId}`)
  }
  ctxLines.push(
    inProject
      ? 'scope 判定提示：信息若只对当前项目成立（如"这个项目我用 X 框架"、"我独自维护这个项目"），必须归 project scope；只有跨所有项目都成立的事实（如"我是 Java 工程师"、"我偏好先讨论再动手"）才归 user scope。'
      : 'scope 判定提示：当前无项目绑定，项目相关内容无法归 project scope；只有跨项目通用的事实可归 user scope。',
  )
  const sessionContext = ctxLines.join('\n')

  return `你是本助手的记忆抽取器。读完下面这一轮对话，判断有没有需要"长期记住"的信息，按 JSON 返回。

记忆的价值是"跨时间有效、同场景下有长期意义、用户要求的记忆、对工作区和项目的固定信息等"。如果一条信息会在数小时/数天内漂移、或只在当下有意义，就不要写入。

# 当前会话上下文（scope 判定关键依据）
${sessionContext}

# 应当写入（积极场景）
0. **显式记忆指令最高优先级**：用户说"记一下"、"记住"、"以后记得"、"写入记忆"等时，
   除非命中"绝不写入"里的敏感/瞬时/违法/完全无意义内容，否则必须至少抽取 1 条候选。
   若句子里有夸张能力描述（如"你懂所有技术栈"），不要把它存成事实；应改写成可执行偏好，
   例如"用户期望当前 Agent 以架构师视角、跨技术栈协助"。
1. 稳定的用户身份/角色/技术栈背景（首次出现，且跨项目成立）→ type=user, scope=user
   例如："用户是 Java 工程师"、"用户偏好先讨论再动手"
2. 显式纠正 / 长期约定（"不要这样"、"别再 X"、"以后都 Y"）→ type=feedback
   例如："禁止编辑 xxx.css"、"PR 颗粒度要小"
3. 显式认可且非显然（"对，这种风格保持下去"、"这次拆 PR 的方式很好"）→ type=feedback
4. 给当前助手/Agent 分配长期角色、工作方式、回答风格 → type=feedback, scope=agent
   例如："你是架构师，记一下"、"以后你用架构师视角审方案"、"这个 Agent 回答要覆盖多技术栈"
   必须带 **Why:** 和 **How to apply:**；若用户明确说"所有助手/所有项目都这样"，才考虑 scope=user。
5. 项目级长期决策与动机（"我们选 X 因为 Y"、"Q3 要上线 Z"、"这个项目我独自开发"）→ type=project, scope=project
   必须带 **Why:** 和 **How to apply:**
6. 外部系统稳定指针（"bug 在 Linear INGEST"、"看 grafana xxx"）→ type=reference
   必须是不变的 URL / 项目名 / 配置位置

# 绝不写入（即时性 / 一次性 / 可推导）
- **日期、时间、星期、当前时刻** —— "今天 2026-06-16"、"现在 14:30"、"今天是星期几"
  （随时间漂移，存进去立刻过时；agent 下次会读到错误的"今天"）
- **实时数据** —— 当前天气、当日股价、汇率、温度、内存/CPU 当前值、本地时间
  （任何"我现在查到的 X"都不应进记忆，agent 应该重新查询）
- **单次查询结果** —— 一次 API 调用的返回值、一次 grep 的命中、一次命令的输出
  （除非用户明确说"以后都基于这个结论"，否则就是临时上下文）
- **临时任务状态** —— "现在在 debug X"、"还差 3 个文件没改完"、"先放着回头看"
- **可从代码、git log、项目说明文件（如 AGENTS.md）推导出的事实**（架构、文件路径、约定、命令用法）
- **已存在于项目说明文件 / 已有 memory 列表的内容**
- **调试过程、bug 修复细节，除非用户有要求提取习惯**（这些应当在 commit message 或 issue 跟踪）
- **一次性事件 / 单点事实** —— 本次会议结论、本次 commit 编号、本次部署版本号
  （除非用户明确说"以后都按这个版本"）
- **不确定的猜测**（你拿不准就 confidence 给 < 0.6，下游会自动丢弃）

# scope 判定（必须结合上面的"当前会话上下文"）
- user：与具体项目/agent 无关、跨项目复用的事实（换一个项目仍然成立）
- project：仅在当前 workspace 内有效（强相关于该项目的代码、约定、节奏、人员配置）
- agent：仅对当前 agent 角色有效

# RECENT_CONTEXT 使用边界
- RECENT_CONTEXT 只能用于理解本轮指代（如"刚才那个方式"、"这类约定"），帮助补全本轮明确要求记住的对象。
- 不能仅凭 RECENT_CONTEXT 生成新记忆；候选必须由本轮 USER/ASSISTANT 明确确认或用户在本轮显式要求"记一下"。
- 若历史上下文和本轮冲突，以本轮为准；拿不准就降低 confidence，低于 0.6 会被下游丢弃。

# 输出
严格 JSON，外层数组，每项：
{
  "scope": "user" | "project" | "agent",
  "type": "user" | "feedback" | "project" | "reference",
  "name": "kebab-case-slug",
  "description": "一句话摘要（≤ 80 字）",
  "body": "正文 markdown，feedback/project 类型必须包含 **Why:** 和 **How to apply:**",
  "confidence": 0.0~1.0,
  "links": ["other-memory-name"],
  "entities": ["出现的实体名：人名/库名/框架/模块/系统/产品名，如 Arco Design、vite、Linear、React"]
}

# JSON 字符串转义（务必遵守，否则解析失败会丢失全部记忆）
所有字符串值（description / body / name / entities 元素）内部若含双引号，必须转义为 \\"：
- ✅ "description": "用户叫助手\\"牛马王\\"，要求架构师级别" （内部引号转义）
- ✅ "description": "用户叫助手『牛马王』" （或直接用中文引号『』避免转义）
- ❌ "description": "用户叫助手"牛马王"" （裸双引号会破坏 JSON，整条候选被丢弃）
字符串内的换行用 \\n，反斜杠用 \\\\。

# entities 字段说明
抽取本条记忆涉及的关键实体（用于跨记忆关联检索）。只放专有名词，不要放通用词。
- ✅ "Arco Design"、"vite"、"Linear INGEST 项目"、"React 18"、"GitHub Actions"
- ❌ "组件"、"构建"、"项目"、"前端"（通用词无关联价值）
没有明确实体就给空数组 []。

没有任何值得写入的，返回 []。
不要包含解释、不要 \`\`\`json\`\`\` 包裹。

# 已有记忆（避免重复，scope 内 name 必须不同）
${params.existingMemoriesSummary || '（无已有记忆）'}

# 本轮对话
USER:
${params.userMessage}

ASSISTANT:
${params.assistantMessage}

RECENT_CONTEXT:
${params.recentSummary || '（无近期摘要）'}`
}

/**
 * 构建去重/合并二次判定的 prompt
 *
 * 当候选记忆与已有记忆在 name 或 description 上有重叠时调用，
 * 让 LLM 决定是 merge / replace / skip。
 */
export function buildDedupPrompt(existing: { name: string; description: string }, candidate: { name: string; description: string }): string {
  return `你是记忆去重判定器。

# 已有记忆
- name: ${existing.name}
- description: ${existing.description}

# 候选记忆
- name: ${candidate.name}
- description: ${candidate.description}

判断候选记忆与已有记忆的关系，返回一个 JSON：
- "merge"：内容相关但候选有新信息，应合并更新
- "replace"：候选完全替代已有记忆
- "skip"：候选无新增信息，应丢弃

只返回 merge / replace / skip 三个值之一，不要包含其他内容。`
}

// ─── 演化决策（V2 ADD/UPDATE/DELETE/NOOP，取代 merge/replace/skip） ────────

export interface EvolutionSimilarEntry {
  id: string
  name: string
  description: string
  type: string
}

export interface EvolutionCandidateInput {
  name: string
  description: string
  body: string
  type: string
}

/**
 * 构建演化决策 prompt。
 *
 * 给定候选 + 同 scope FTS 召回的相似条目，让 LLM 判断候选与已有的关系：
 * - ADD：候选是新事实，没有已有条目覆盖 → 新建
 * - UPDATE：候选是 targetId 的更新/精炼版（同一事实的新版本）→ 更新 target（保 id/hit_count，旧版进 History）
 * - DELETE：候选表明 targetId 已过时/被推翻（如"我们已从 X 迁到 Y"否定旧条目）→ 使 target 失效，候选不写入
 * - NOOP：候选与已有重复，无新增 → 丢弃
 */
export function buildEvolutionPrompt(candidate: EvolutionCandidateInput, similar: EvolutionSimilarEntry[]): string {
  const similarBlock =
    similar.length === 0
      ? '（无相似已有记忆）'
      : similar
          .map((e) => `- id: ${e.id} | name: ${e.name} | type: ${e.type} | description: ${e.description}`)
          .join('\n')

  return `你是记忆演化判定器。判断候选记忆与已有相似记忆的关系。

# 候选记忆（本轮新抽取）
- name: ${candidate.name}
- type: ${candidate.type}
- description: ${candidate.description}
- body 摘要: ${candidate.body.slice(0, 300)}

# 同 scope 已有相似记忆（FTS 召回，仅未归档/未失效）
${similarBlock}

# 判定规则（四选一）
- "ADD"：候选是新事实，已有记忆里没有覆盖它的。targetId 为 null。
- "UPDATE"：候选是某条已有记忆（targetId）的更新或精炼版 —— 同一事实但内容更新/更准确。targetId 填该条 id。
- "DELETE"：候选表明某条已有记忆（targetId）已过时或被推翻（例如"我们已经从 X 迁到 Y"使旧条目失效）。targetId 填该条 id。候选本身不必单独留存。
- "NOOP"：候选与已有重复，无新增信息。targetId 为 null。

# 重要约束
- 若没有任何相似已有记忆，必须返回 ADD。
- UPDATE/DELETE 的 targetId 必须是上面列出的某个 id，不得编造。
- 拿不准时优先 ADD（宁可多存一条，由后续整合 job 合并），不要瞎猜 UPDATE/DELETE。

# 输出
严格 JSON，不要 \`\`\`json 包裹，不要解释：
{ "decision": "ADD" | "UPDATE" | "DELETE" | "NOOP", "targetId": "<id 或 null>", "reason": "<一句话>" }`
}

// ─── 整合（consolidation，回顾性反思） ────────────────────────────────────

export interface ConsolidationEntryInput {
  id: string
  name: string
  type: string
  description: string
}

/**
 * 构建整合 prompt（回顾性反思）。
 *
 * 定期把一个 scope 内全部有效记忆交给小模型，发现写入时漏掉的关系：
 * - MERGE：语义重复（同一事实多条）→ 保留 keepId、合并 dropIds 的要点、dropIds 失效
 * - ELEVATE：多条低阶 feedback 暗示的通用模式 → 升华为一条高阶 feedback
 *
 * 保守约束：id 必须来自列表（不得编造）；拿不准就返回空数组。
 */
export function buildConsolidationPrompt(scope: 'user' | 'project' | 'agent', entries: ConsolidationEntryInput[]): string {
  const list = entries.length === 0
    ? '（该 scope 暂无有效记忆）'
    : entries.map((e) => `- id: ${e.id} | name: ${e.name} | type: ${e.type} | description: ${e.description}`).join('\n')

  return `你是记忆整合器（scope=${scope}）。回顾下面全部有效长期记忆，发现两类回顾性关系：

# 当前 scope 的全部有效记忆
${list}

# 任务（发现写入时漏掉的）
1. 语义重复：同一事实/约定被存成多条 → MERGE。保留最完整的一条作 keepId，其余入 dropIds，
   给出合并后的一句话描述 mergedDescription（吸收 dropIds 的要点）。
2. 升华规律：多条低阶 feedback 暗示一个通用模式 → ELEVATE。合成一条高阶 feedback（newMemory），
   sourceIds 标注它的来源条目。type 通常 feedback；body 必须含 **Why:** 和 **How to apply:**。

# 输出
严格 JSON 数组（不要 \`\`\`json 包裹，不要解释），每项二选一：
{ "action": "MERGE", "keepId": "<列表内 id>", "dropIds": ["<列表内 id>", ...], "mergedDescription": "<≤80字>", "reason": "<一句话>" }
{ "action": "ELEVATE", "sourceIds": ["<列表内 id>", ...], "newMemory": { "name": "<kebab-slug>", "description": "<≤80字>", "body": "<markdown>", "type": "feedback", "confidence": 0.0~1.0 }, "reason": "<一句话>" }

# 硬性约束
- keepId / dropIds / sourceIds 必须是上面列表里的真实 id，禁止编造。
- MERGE 的 dropIds 至少 1 条；ELEVATE 的 sourceIds 至少 2 条（单条不值得升华）。
- MERGE 合并后不要丢失关键信息，但描述要精炼。
- 没有明显可整合的，返回 []（保守，宁可不做）。`
}
