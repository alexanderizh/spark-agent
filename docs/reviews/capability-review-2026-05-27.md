# Spark Agent 全能 Code Agent 能力评审报告

日期: 2026-05-27
评审者: Claude Code Agent
更新: 2026-05-27 晚间，结合当前开发进度与新的产品取舍补充

## 总体评估

总评分：62/100（骨架完整，Claude SDK 主路径已落地，但端到端闭环仍未完成）

当前项目约 40k 行 TypeScript，包含 agent-runtime / storage / protocol / shared / ui-kit 与 Electron 桌面应用。相比初版评审，核心进度已经发生变化：Claude Agent SDK 已经作为执行内核接入，`claude-sdk` 已进入协议类型、SessionService 执行路径和 SDK 事件映射层。

新的产品取舍是：**核心 Code Agent 不再保留 direct Anthropic API 回退路径。Claude 通道必须使用 Claude Agent SDK；SDK 不可用时项目应显式不可用，并引导用户安装或修复 SDK。**

## 当前进度校准

| 能力 | 当前状态 | 判断 |
|------|----------|------|
| Claude Agent SDK 执行路径 | 已实现 `ClaudeSDKExecutor`，SessionService 默认 Anthropic provider 使用 `claude-sdk` | 已完成第一步，待产品化 |
| SDK 事件映射 | 已映射 assistant / stream / result / usage / tool name | 需真实任务验证 UI 表现 |
| SDK 完整性检测 | 桌面端已有 `SdkIntegrityService` 与 Settings 入口相关改动 | 需联调成阻断式提示 |
| Direct Anthropic fallback | 仍存在回退逻辑 | 应移除 |
| 前端 adapter 适配 | Protocol 已支持 `claude-sdk`，但 ChatView 类型和文案仍未完全适配 | P0 阻塞 |
| 自研 AgentLoop | 仍保留 direct API + ToolRegistry 路径 | 仅可作为非 Claude 兼容遗留；核心路线不再投资 |
| Context Governor | 仍未实现 | P1 |
| Checkpoint / Diff 可控性 | SDK 侧可开启 checkpoint，但 Spark UI/会话侧未产品化 | P0/P1 |
| CI/CD | 仍缺失 `.github/workflows` | P0 |

## 核心能力评分

| 维度 | 评分 | 关键差距 |
|------|------|----------|
| Agent Execution Core | 70 | SDK 主路径已接入，但 SDK 不可用阻断、真实任务闭环、checkpoint UI 未完成 |
| Model / SDK Adapters | 74 | `claude-sdk` 已接入；需移除 direct Anthropic fallback，完善安装/健康检查 |
| Tool System | 68 | Claude 主路径复用 SDK 工具；自研工具仍粗糙，不再作为核心投入方向 |
| Context Management | 45 | Context Governor、pin/exclude、ledger、预算规划未实现 |
| Permission & Security | 70 | 权限模式较完整；SDK permission callback 需与 UI 审批完整联调 |
| Multi-Agent | 15 | 非当前阶段重点 |
| Workflow | 10 | 非当前阶段重点 |
| MCP Integration | 58 | MCP tools 可注入；resources/prompts、SDK 侧 MCP 联调仍需加强 |
| UI/UX | 58 | ChatView 需完整支持 `claude-sdk`，Settings SDK 健康检查需形成可操作闭环 |
| Testing & Quality | 60 | 单测基础可用；缺 CI，端到端由人工验收补齐 |

## 核心开发原则

1. 先完成核心 Code Agent 的完整能力，不继续扩展 Workflow / Multi-Agent / 团队协作等外层功能。
2. Claude 执行链路只认 Claude Agent SDK；SDK 缺失、加载失败或版本异常时直接阻断任务。
3. 前后端必须同步开发：运行时策略、协议类型、ChatView composer、Settings 健康检查和错误提示必须同时完成。
4. 每完成一块开发就做局部审查、局部验证、局部提交，避免大批量混杂提交。
5. 自研 AgentLoop 不再作为核心竞争力投入；除非为 Codex/OpenAI 兼容需要，否则不要继续扩展 direct API 工具链。

## 下一步开发计划

### P0 — 立即开发

1. **强制 Claude Agent SDK 主路径**
   - 移除 `claude-sdk -> claude direct API` fallback。
   - 旧 session/provider 中的 `claude` adapter 统一规范化为 `claude-sdk`。
   - SDK 不可用时写入 `agent_error` 和 `agent_status:error`，提示用户到 Settings 安装或修复 SDK。

2. **ChatView / Composer 适配 `claude-sdk`**
   - Adapter 选择器显示 `Claude SDK` 与 `Codex`。
   - Anthropic provider 默认映射为 `claude-sdk`。
   - 权限模式、推理强度、provider 过滤、composer prefs 全部接受 `claude-sdk`。
   - Inspector / toast / 错误提示保持用户可理解。

3. **Settings SDK 完整性闭环**
   - SDK 检测结果展示安装状态、版本、可加载状态。
   - 提供安装/更新入口。
   - Chat 发送失败时能明确指向 Settings 的 SDK 修复动作。

4. **CI/CD 最小质量门禁**
   - 增加 GitHub Actions：install -> typecheck -> unit test -> desktop build。
   - 先覆盖开发必需门禁，不扩展复杂发布流程。

### P1 — 核心体验补强

- Checkpoint / Diff 可控性：展示 SDK checkpoint 元数据、变更摘要、后续接入回滚。
- Context Governor MVP：context mode、pin/exclude、Context Ledger、token budget。
- SDK 事件联调：工具调用、工具结果、MCP tool、usage、失败状态在 UI 中完整呈现。
- Self-correction MVP：任务后自动建议运行 typecheck/test，并把失败摘要交回模型修复。

### P2 — 暂缓

- Monaco Editor 集成
- 终端 PTY 集成
- 虚拟列表
- Multi-Agent 编排基础
- Workflow 执行引擎

## 结论

当前最重要的不是继续做新页面，而是把 Claude Agent SDK 路径做成一个可靠的 Code Agent 产品闭环：能创建会话、选择 provider、发送任务、执行工具、显示进度、处理权限、展示错误、引导修复 SDK，并让类型检查和构建稳定通过。

**核心建议：Claude SDK 必需化，前后端闭环化，质量门禁自动化。**
