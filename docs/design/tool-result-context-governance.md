# 工具结果上下文治理与子应用源码引用

> 状态: 已落地 | 最后核对: 2026-09-01

## 背景

Codex native runtime 在一个用户轮次内可能执行多次模型调用。Provider 上报的
`inputTokens` 因而可能是整轮累计输入消耗，而不是最后一次请求实际占用的上下文窗口。
同时，Bash、MCP 和子应用源码等大型工具结果会被后续模型调用重复携带，既增加成本，也会
挤占真正需要的对话与项目上下文。

本设计把问题拆在五个边界解决：界面只展示正确语义；Spark 可控的 stdio MCP 在结果返回
模型前执行统一治理；Codex 原生工具在写入模型历史时使用官方预算；所有执行器事件在持久化
前归档超长输出；子应用工具把完整源码改为工作区文件引用。各层不修改 Provider 原始用量，
也不改变子应用数据库和发布协议。

## 设计原则

- 窗口占用与累计消耗是两个指标，不互相兜底取最大值。
- Codex 原生工具优先使用官方历史预算，不在 Spark 侧模拟或改写 native runtime 内部循环。
- Spark 可控的 stdio MCP 在模型消费结果前统一封装；远程 HTTP/SSE 和 SDK 内置工具保持原协议。
- 大对象通过“紧凑元数据 + 可访问文件”传递；需要全文时显式读取，不把全文长期塞进工具历史。
- 文件边界默认不信任模型参数，必须限制到当前工作区并校验类型、扩展名和大小。
- 保留原有 `draftHtml` 调用，新增文件路径是向后兼容的优化路径。

## 治理边界

| 边界                 | 负责的语义                       | 实现                                                         |
| -------------------- | -------------------------------- | ------------------------------------------------------------ |
| UI 用量              | 当前请求的有效上下文             | Codex Runtime 快照 / Claude 单次请求 → Spark 请求边界估算    |
| Spark stdio MCP      | 工具结果进入模型前的统一治理     | 保持命名空间的透明 JSON-RPC 代理 + `ToolResultEnvelope`      |
| Codex native history | 原生 Bash/MCP 进入后续请求的上限 | 三种 native transport 统一 `tool_output_token_limit = 12000` |
| Spark 事件持久化     | UI、审计与后续按需读取           | 原始结构化消费者先处理，超长 `tool_result` 再归档            |
| 子应用 MCP           | 完整 HTML 的读取、修改和结果返回 | 工作区文件引用、内容指纹、紧凑回包和显式导出                 |

## UI 用量语义

`resolveContextUsedTokens` 按运行时隔离选择来源，不再取最大值：

1. Codex app-server 收到 `thread/tokenUsage/updated` 时，把 `last.inputTokens` 和
   `modelContextWindow` 映射为独立 `runtime_context_snapshot`。二者分别作为已用量和窗口；
   快照还必须与当前 Codex adapter、模型一致，切换模型或 Claude 时不能复用。
2. Claude 保持原有单次请求口径：`input + cache_read + cache_creation` 优先于本地估算。
3. 无对应 Runtime 实测时，使用 Context Ledger 的 `totalEstimatedTokens`，再回退 Context
   Governor 的 `estimatedTokens`。
4. 旧 Codex SDK / CLI 的 `turn.completed.usage` 是整轮多次模型请求累计消耗，只用于成本与
   用量统计，禁止回填上下文占用；历史事件没有独立 Runtime 快照时宁可显示 Spark 估算。

Provider 上报的整轮累计输入、缓存读取和输出 token 继续进入用量统计，不被删除或改写。这样
成本面板仍能看到真实消耗，而上下文进度不会把 17 次内部调用累计出的 129 万 token 显示为
一次请求已经超过 100 万窗口。新的 `user_message` 到达时清除上一请求的 Runtime / Provider
展示快照，先使用本轮请求边界 Ledger，等 Runtime 发出新快照后切换为实测值；原始 usage 事件
和成本统计不清零。弹窗会明确标注“Codex Runtime · 最近一次请求”或“Spark 估算”，避免把
请求边界实测误解为持续实时采样。

## Codex 工具输出预算

`CODEX_TOOL_OUTPUT_TOKEN_LIMIT` 是单一策略源，值为 12,000 tokens，并同时注入：

- Codex SDK config；
- Codex App Server 的 `thread/start.config`；
- Codex CLI 临时 profile。

该设置使用 Codex 官方 `tool_output_token_limit` 配置，限制单个工具或函数输出保留在模型历史
中的 token 数。它不改变工具是否成功、不改 Provider usage，也不要求 Spark 接管 native
runtime 的轮内消息状态。官方配置参考：
[Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)。

Codex 内建 Bash 没有已验证的 Spark 前置结果钩子，因此它不经过 stdio 代理。模型历史由官方预算
止血；Spark 收到对应 `tool_result` 事件后会归档执行器公开的完整内容并生成可读取引用；若上游
执行器本身已经省略内容，Spark 不会声称能重建未公开部分。官方文档未公布默认值，所以 12,000
是 Spark 的统一显式策略，不能声称它一定小于所有 Codex 版本的默认值。

## 通用工具结果 Envelope

### 模型前治理

Spark 把所有 `command` / `type=stdio` MCP 配置包装为只依赖 Node 内置模块的透明 JSON-RPC
代理。代理保留原 server 名称，因此 `mcp__<server>__<tool>` 命名空间、权限规则和工具列表均
不变；上游显式配置的 `cwd` 原样保留，缺省时也不注入工作区目录；请求、通知、资源和 prompts
等非工具结果消息原样转发。只有对应 `tools/call` response 的 `result` 会进入治理；封装超长
结果时保留标准 `CallToolResult._meta` 供客户端/宿主消费。代理按
JSON-RPC response 形态而不是只按 id 关联结果，所以上游在
工具执行中发出的 sampling / elicitation 等双向请求即使复用了相同 id，也不会提前清除待治理调用。
对于声明 `outputSchema` 的工具，代理在 `tools/list` 中把契约扩展为“原始结构或 envelope”联合
schema；短结果继续匹配原结构，超长结果匹配 envelope，避免 MCP 客户端结构校验拒绝治理后的结果。

`type=sdk`、HTTP 和 SSE MCP 不经过代理。SDK 类型没有子进程边界；远程传输还涉及 OAuth、
SSE 和 session 生命周期，强行桥接会扩大协议回归面。这些路径继续由 Provider 历史预算保护，
同时在 Spark 事件持久化边界归档超长结果。

### Envelope 与存储

- 序列化结果不超过 24,000 字符时保持原对象和成功/失败语义不变。
- 超长结果完整写入 `.spark-agent/tool-results/<full-sha256>.txt|json`，相同内容按完整
  SHA-256 复用。
- 单个制品最大 64 MiB；目录和文件权限分别为 `0700`、`0600`。
- 8,000 字符预览按工具感知生成：Bash/build/test/lint/compile 或失败结果优先保留错误行及
  上下两行，再补头尾边界。
- 图片、音频、视频和二进制 Base64 只在预览中替换为大小占位；完整值仍保存在制品中，避免
  二进制再次占满模型上下文。
- 清理策略为 best effort：保留 7 天、工作区总量最多 512 MiB；存储不可用时 envelope 标记
  `artifact.available=false` 并保留预览，不把工具成功改成失败。

每个可用 envelope 都给出 `spark_tool_results` 的续读工具。`read` 支持 offset/limit，单次最多
40,000 字符；`search` 做普通文本搜索并返回命中偏移和邻近片段；`list` 用于没有 artifactId
时发现最近制品，并以 MCP 合法的 `{ artifacts: [...] }` 对象返回结构化内容。Reader 本身不再
套代理，避免递归治理。

### 事件归档顺序

SDK、Codex/CLI 与团队成员三条执行路径都先让媒体提取、`present_files` 和
`report_file_changes` 读取原始事件，再对最终持久化/广播的 `tool_result` 调用统一治理。这样
不会破坏图片卡片和文件变更清单，同时 Bash 等超长结果不会继续完整进入 Spark 会话记录。

## 子应用源码协议

### 紧凑结果

`spark_app_get` 对 `draft.source` 和 `publishedRelease.source` 都返回：

- 完整 SHA-256；
- 字符数与 UTF-8 字节数；
- 最多 2,000 字符的头尾预览。

`create`、`update_draft`、`publish` 和 `rollback` 的生命周期结果不返回源码预览，只返回指纹
和大小。这样发布或修改完成后不会再次把刚写入的完整 HTML 回灌到上下文。

### 文件输入

`spark_app_create` 和 `spark_app_update_draft` 新增 `draftFilePath`。MCP 子进程读取文件后仍向
既有 bridge RPC 发送 `source`，所以仓储层、CAS revision 和发布快照语义保持不变。
`draftHtml` 与 `draftFilePath` 互斥；短内容仍可继续使用 `draftHtml`。

读取策略包括：

- 相对路径以当前工作区为基准，绝对路径也必须解析到工作区内；
- 使用 `realpath` 后检查工作区边界，阻断 `..` 和符号链接越界；
- 只接受普通 `.html` / `.htm` 文件；
- 读取前限制 20 MB 字节数，读取后限制 500 万字符。

### 显式导出

`spark_app_export_source` 从现有草稿或指定发布版本取回完整源码，并写到：

```text
.spark-agent/sub-app-sources/<appId>/<full-sha256>.html
```

文件名使用完整 SHA-256，相同内容直接复用。复用前必须确认目标是普通文件且内容完全一致；
目录从工作区根开始逐级创建，每一级在继续前都拒绝符号链接和非目录并重新核对真实路径边界；
因此恶意的 `.spark-agent/sub-app-sources` 符号链接会在工作区外创建任何子目录之前被拒绝。
文件路径被符号链接、目录或不同内容占用时同样拒绝继续，避免静默覆盖。Agent 随后可使用
普通文件工具按范围读取和编辑，再通过 `draftFilePath` 写回。

## 典型流程

```text
spark_app_get
  → 紧凑详情 + 指纹 + 头尾预览
  → 需要全文时 spark_app_export_source
  → 按文件范围检查/编辑
  → spark_app_update_draft(draftFilePath, expectedRevision)
  → 紧凑结果 + 新 revision
```

## 兼容性与非目标

- 既有 `draftHtml`、bridge RPC、SubAppRepository 和数据库结构不变。
- Provider 的累计 usage 仍用于成本统计，本设计不重新解释或清零原始事件。
- `tool_output_token_limit` 只治理 Codex native history；stdio MCP 的 envelope 与 Spark 事件
  归档是独立保护层，不能把其中一层的成功误认为所有 Provider 内部历史都已受控。
- HTTP/SSE 和 in-process SDK MCP 当前不做透明前置代理；后续只有在认证、双向请求和 session
  生命周期均有完整兼容测试时才扩展。
- 工具输出预算不能替代合理的工具设计；搜索、日志和 API 仍应优先返回分页或错误相关片段。

## 验证

- UI 单测覆盖 Ledger / Governor 优先和 Provider-only 兜底。
- 三种 Codex transport 单测覆盖统一的 12,000-token 配置。
- 通用存储测试覆盖短结果不变、Bash 错误优先预览、SHA-256 去重、范围读取、搜索、二进制预览
  脱敏和符号链接目录拒绝。
- MCP 代理端到端测试覆盖工具透传、超长结果 envelope 与 Reader 续读/搜索；会话配置测试覆盖
  Claude SDK、Codex/CLI 的代理装配与 Reader 权限；代理测试还覆盖同 id 双向请求不会破坏响应
  关联、Reader list 返回合法对象；事件治理单测覆盖持久化前归档语义。
- 子应用 MCP 测试覆盖文件输入、工作区越界拒绝、草稿与发布源码紧凑化、内容寻址导出、复用、
  篡改拒绝，以及符号链接越界时无工作区外副作用。
- Agent Runtime strict typecheck、聚焦 lint 和聚焦单测作为交付门禁。
