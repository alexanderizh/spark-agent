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
}

/**
 * 构建记忆抽取 prompt
 *
 * 返回的 prompt 指导 LLM 从对话中提取值得长期记住的信息。
 * 输出格式为 JSON 数组。
 */
export function buildExtractionPrompt(params: ExtractionPromptParams): string {
  return `你是 Spark-Agent 的记忆抽取器。读完下面这一轮对话，判断有没有需要"长期记住"的信息，按 JSON 返回。

记忆的唯一价值是"跨会话、跨时间仍然有用"。如果一条信息会在数小时/数天内漂移、或只在当下有意义，就不要写入。

# 应当写入（积极场景）
1. 稳定的用户身份/角色/技术栈背景（首次出现）→ type=user, scope=user
   例如："用户是 Java 工程师"、"用户偏好先讨论再动手"
2. 显式纠正 / 长期约定（"不要这样"、"别再 X"、"以后都 Y"）→ type=feedback
   例如："禁止编辑 views.css"、"PR 颗粒度要小"
3. 显式认可且非显然（"对，这种风格保持下去"、"这次拆 PR 的方式很好"）→ type=feedback
4. 项目级长期决策与动机（"我们选 X 因为 Y"、"Q3 要上线 Z"）→ type=project, scope=project
   必须带 **Why:** 和 **How to apply:**
5. 外部系统稳定指针（"bug 在 Linear INGEST"、"看 grafana xxx"）→ type=reference
   必须是不变的 URL / 项目名 / 配置位置

# 绝不写入（即时性 / 一次性 / 可推导）
- **日期、时间、星期、当前时刻** —— "今天 2026-06-16"、"现在 14:30"、"今天是星期几"
  （随时间漂移，存进去立刻过时；agent 下次会读到错误的"今天"）
- **实时数据** —— 当前天气、当日股价、汇率、温度、内存/CPU 当前值、本地时间
  （任何"我现在查到的 X"都不应进记忆，agent 应该重新查询）
- **单次查询结果** —— 一次 API 调用的返回值、一次 grep 的命中、一次命令的输出
  （除非用户明确说"以后都基于这个结论"，否则就是临时上下文）
- **临时任务状态** —— "现在在 debug X"、"还差 3 个文件没改完"、"先放着回头看"
- **可从代码、git log、CLAUDE.md 推导出的事实**（架构、文件路径、约定、命令用法）
- **已存在于 CLAUDE.md / 已有 memory 列表的内容**
- **调试过程、bug 修复细节**（这些应当在 commit message 或 issue 跟踪）
- **一次性事件 / 单点事实** —— 本次会议结论、本次 commit 编号、本次部署版本号
  （除非用户明确说"以后都按这个版本"）
- **不确定的猜测**（你拿不准就 confidence 给 < 0.6，下游会自动丢弃）

# scope 判定
- user：与具体项目/agent 无关、跨项目复用的事实
- project：仅在当前 workspace 内有效（强相关于该项目的代码、约定、节奏）
- agent：仅对当前 agent 角色有效

# 输出
严格 JSON，外层数组，每项：
{
  "scope": "user" | "project" | "agent",
  "type": "user" | "feedback" | "project" | "reference",
  "name": "kebab-case-slug",
  "description": "一句话摘要（≤ 80 字）",
  "body": "正文 markdown，feedback/project 类型必须包含 **Why:** 和 **How to apply:**",
  "confidence": 0.0~1.0,
  "links": ["other-memory-name"]
}

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
