---
name: spark-workflow-generator
description: "Generates Spark Agent workflow graphs (WorkflowGraph JSON, 13 node kinds) from natural language requirements, with offline structural validation aligned to Spark's preflight error codes. Use when the user asks to create/generate/design a Spark workflow, sparkflow, 工作流, Agent 编排流程, or wants to convert requirements into a Spark-importable workflow JSON. Not for real-time canvas operations (use canvas-studio skill instead)."
version: 0.2.0
author: Riley Ren (with Qoder)
category: utility
tags: [spark, workflow, generator, sparkflow, 工作流, agent-orchestration, json]
---

# Spark Workflow Generator

> 从自然语言需求生成 **Spark Agent 可导入的工作流图 JSON**（L3 WorkflowGraph，13 种节点）。
> 定位：**蓝图编译器 + 人工确认闸门**——AI 产出的是「待审草案 + 校验报告」，须经人工确认后才导入 Spark。这对齐 Spark 官方哲学：AI 可生成图结构，但只能是草案、须人工确认、不得批量沉淀。

## When to Use（与相邻 skill 的分工）

**用本 skill**：离线生成/修改工作流定义 JSON——「帮我生成一个 XX 工作流」「把这个需求变成 Spark 工作流」「修改这个 workflow JSON 加一个审批节点」。

**不用本 skill**：
- 实时操作当前打开的画布（创建节点/连线/运行 AI 任务）→ 用 **canvas-studio**（经 mcp__spark_canvas__* 工具）；
- 画布媒体工作流 DAG（CanvasWorkflowPackage，canvas_* 7 kind）→ 那是 L2，已有官方 MCP 工具通道（canvas_create_reusable_workflow_graph 等），不属于本 skill 范围；
- 视频转码剪辑 → 用 **video-workflow**。

**触发词**：Spark 工作流、workflow、sparkflow、生成工作流、Agent 编排、工作流 JSON、审批流、路由分支工作流。

## 事实来源（生成前必读）

| 文件 | 内容 |
|---|---|
| `references/schema-freeze.md` | WorkflowGraph 完整 schema、24 个 config 字段、preflight 13 error + 5 warning 权威错误码、官方设计约束、版本漂移监控点 |
| `references/node-spec.md` | 13 种节点逐个规格：定位/config/示例/常见错误 + 通用生成规则（§0 必读） |
| `templates/*.json` | 4 个内置模板（线性/条件路由/迭代循环/审批+MCP） |
| `scripts/validate.mjs` | 离线结构校验器（三层校验，错误码对齐 preflight） |

**适配版本**：spark-agent 0.11.68（2026-09-14 冻结）；0.11.69 官方安装版全链路实测通过（2026-09-15：导入+试跑闭环，见 RUN_VERIFICATION.md）。生成前若目标 Spark 版本更新，先按 schema-freeze.md §7 核对漂移。

## 核心流程（5 阶段）

### Phase 1 · 需求分析

从自然语言提取结构化需求：

```json
{
  "purpose": "工作流目标（一句话）",
  "pattern": "linear | conditional | iterative | gated",
  "steps": ["步骤1", "步骤2"],
  "branchConditions": ["按复杂度分流 deep/quick"],
  "humanGates": ["执行前需人工审批"],
  "externalCalls": [{"type": "mcp|builtin|platform", "tool": "工具名", "argsHint": "参数来源"}],
  "deliverables": ["最终交付物"],
  "verifyCommands": ["pnpm typecheck"]
}
```

信息不足时向用户澄清（目标？是否需要审批门禁？分支条件？交付物形态？），**不要猜测关键意图**。

### Phase 2 · 模板匹配

| pattern | 模板 | 特征 |
|---|---|---|
| linear | `templates/tpl-simple-linear.json` | 单目标线性：input→plan→agent→verify→artifact |
| conditional | `templates/tpl-conditional-route.json` | 按判定分流，各支线独立终点 |
| iterative | `templates/tpl-loop-iterate.json` | 产出→评审→不过重来（loop + breakCondition） |
| gated | `templates/tpl-approval-mcp.json` | 人工审批门禁 + 外部工具调用 |

以最高匹配模板为底稿改造；无匹配（得分低）则从 linear 骨架起步按 Phase 3 规则组装。

### Phase 3 · 图生成

严格遵守 `references/node-spec.md` §0 通用规则与以下**铁律**（违反即产生不可运行的工作流）：

1. **13 种 kind 封闭枚举**：input/plan/route/agent/subagent/skill/tool/mcp/approval/verify/review/artifact/loop——不得发明新 kind（`unsupported_node_kind`）；
2. **坐标在顶层**：x/y 是节点顶层字段（不在 config 里）；横向主链 x 间隔 260-280、y=160，分支 y 错开（60/320）；
3. **绑定字段一律留空**：agentId/skillIds/toolIds/mcpServerIds/ruleIds/modelId/providerProfileId/toolServerId 是目标环境 ID，写死跨环境必失效——在 needsBinding 或 prompt 里注明「需绑定：××」；
4. **分支不汇合**：route/review 的条件分支必须互斥条件 + 各自独立终点链（各自 artifact 收尾）；汇合节点会被 executor 的 `.some` 判定整体跳过（`branch_merge`）；
5. **条件边引用存在的 outputKey**：condition.key 必须是某上游节点 config.outputKey（`invalid_condition_reference`）；equals/not_equals 必带 value；route 出边的 value 必须在 routeOptions 内；
6. **loop 规则**：body 是完整独立图；不嵌套 loop；body 节点 ID 不与外层冲突；maxIterations ≤ 50；breakCondition.key 须在 body 的 outputKey 中；
7. **每图恰一个 input 起点、每条链以 artifact 收尾**（官方惯例）；
8. **outputKey 全图唯一**（驼峰命名：objective/plan/implementation/verification/deliverable…）；
9. **review 裁决节点 prompt 必须限定输出值域**（如「严格只输出 'pass' 或 'retry'」）；
10. **tool/mcp 节点**：toolSource='mcp' 或 kind='mcp' 必须有 toolName；toolArgs 字符串值用 `{{key}}` 插值引用上游 outputKey；artifact 的 exportPath 不得含 `..`/绝对路径。

节点 ID 命名：`<kind>-<n>`（如 agent-1）或语义化 kebab-case（如 artifact-deep）；边 ID：`e-<from>-<to>`。

### Phase 4 · 校验（强制，不可跳过）

生成后**必须**运行：

```bash
node scripts/validate.mjs <生成的.json>
```

- 退出码 0 = 结构层通过；非 0 = 按报告逐条修复后重跑，直到通过；
- 三层校验：格式（字段/枚举/坐标）→ 连接（端点/环/可达/条件引用）→ 逻辑（route 选项/分支汇合/loop 结构/工具组合/绑定写死警告）；
- **能力边界**：validate.mjs 只覆盖结构层。依赖层（绑定的 Agent/Skill/MCP 在目标环境是否存在）由导入后 Spark 官方 preflight 兜底（13 error + 5 warning）——把校验报告连同 JSON 一起交给用户，明确告知「导入后请在 Spark 里跑一次预检」。

### Phase 5 · 增量修改（可选）

对已有工作流 JSON 增删改节点：①解析修改意图（add/delete/modify/reconnect + 目标节点）；②执行修改（新节点重算坐标、重连边、清理悬空引用）；③**重跑 Phase 4 校验**。删除节点时注意旁路重连（前驱直连后继）与 outputKey 引用清理。

## 输出交付格式

每次生成向用户交付三件套：
1. **工作流 JSON**（模板外壳格式：`{name, description, needsBinding, graph}`，与官方 workflow-templates.ts 同构）；同时附 **UI 导入就绪版**（外层包裹 `{"workflows":[<模板外壳>]}`，文件名建议 `<name>.import.json`）——官方桌面端「工作流」页导入下拉「流程图 JSON(兼容旧版)」通道只认包裹版；扁平模板外壳供 workflow:create / .sparkflow 打包等程序化通道；
2. **校验报告**（validate.mjs 输出原样附上）；
3. **导入与绑定指引**：
   - 导入：Spark 桌面端 → 侧栏顶部切「工作台」模式 → 「工作流」页 → 导入下拉 → 「流程图 JSON(兼容旧版)」→ 选包裹版（落库为 draft）；或打包 .sparkflow（含依赖技能/MCP 时）；
   - 通道警示：「画布」模式下的「画布工作流」页是 L2 通道（只认 exportVersion:1 画布包），L3 JSON 导入必报错——属通道走错而非生成错误；
   - 绑定：导入后在节点检查器补齐 needsBinding 列出的 Agent/Skill/MCP/Tool 绑定（「执行 Agent」下拉默认「宿主 Agent（当前会话）」可作试跑兜底）；
   - 预检：运行前 Spark 会执行官方 preflight，处理其报告的依赖层问题；
   - **人工确认闸门**：提醒用户逐节点审阅 prompt 与结构后再启用（draft → active）。

## Host Agent Notes（跨 Agent 兼容）

本 skill 采用通用 SKILL.md 格式（Anthropic Agent Skills 约定），同一份本体适配三个宿主：

| 宿主 | 安装位置 | 备注 |
|---|---|---|
| Claude Code | `.claude/skills/spark-workflow-generator/`（项目级）或 `~/.claude/skills/`（全局） | 原生支持 |
| Codex CLI | 对应 skills 目录（v0.65.0+ 支持 SKILL.md） | 可选 `agents/openai.yaml` 补 UI 元数据 |
| Qoder | 经 create-plugin 转换为原生插件，或直接放技能目录 | 原生支持 |

跨宿主一致性保障：生成质量不依赖宿主模型自觉——**Phase 4 的 validate.mjs 是确定性闸门**，任何宿主生成后都必须过同一脚本。若某宿主模型生成的 JSON 反复触发同类错误，记入 `LESSONS_LEARNED.md`（本目录，随使用积累）。

## 已知限制（诚实声明）

- 依赖层校验离线不可做（见 Phase 4 能力边界）；
- builtin 工具白名单（WORKFLOW_RESTRICTABLE_TOOL_NAMES）暂未内嵌——toolSource='builtin' 的 toolName 合法性以导入后 preflight 为准；
- L2 画布工作流（CanvasWorkflowPackage）不在范围内；
- 适配版本 0.11.68，上游 schema 漂移须按 schema-freeze.md §7 核对。
