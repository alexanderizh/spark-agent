# SparkWork 通用自定义工具包平台 V3

> 状态: 实施中 | 最后核对: 2026-08-31

## 1. 结论与产品边界

SparkWork 的自定义工具必须是一个与业务类型无关、不按业务类型、语言、SDK 或当前 Host Capability 清单设置能力白名单的扩展平台。工具可以是几十行脚本，也可以是包含多个模块、第三方依赖、模型调用、文件处理、网络服务和长期进程的完整工程。工具的业务逻辑归工具作者所有；SparkWork 只负责开发辅助、安装导入、配置、授权、生命周期、执行调度、日志观测和 Agent 接入。协议兼容、资源配额、用户授权和操作系统能力仍是明确边界，不应被误解为无限资源承诺。

以下原则是本方案的硬约束：

- 图像理解只是验收用例，不是协议类型、默认入口、专用运行主链或核心产品叙事；
- MCP、HTTP、OpenAPI、CLI、独立进程和远程服务只是运行或导入适配器，不是自定义工具本体；
- SDK 和 Spark Host Capabilities 是可选便利能力，不构成工具能力上限；
- 权限用于告知、授权和审计，不能以“安全”为名把工具阉割成只能调用少量宿主原语的脚本；
- 已发布并启用的工具必须动态进入 Spark 统一 Tool Registry，Agent 像使用内置工具一样自主发现和调用；
- Spark 内创建、Agent 对话创建、本地目录导入、压缩包安装和第三方来源安装最终生成同一种 Tool Package；
- 工具可以自带运行时与依赖，也可以声明使用 Spark 提供的 Node/Python 等运行时制品。

旧 `http | code | provider-vision` 判别联合与单文件受限 Worker 仅作为兼容层保留，不再定义平台能力上限。

## 2. 核心对象：Tool Project、Package Version 与 Installation

三个对象必须分开：

- **Tool Project**：可编辑源工程，可以位于 Spark 受管目录或用户外部目录；
- **Package Version**：Project 构建或外部导入后产生的不可变快照，包含 manifest、实际运行文件、完整性摘要和来源；
- **Installation**：某台 SparkWork 上的安装实例，持有启用版本、配置、Keychain 引用、授权和运行状态。

Spark 对外部目录默认复制快照，不从原目录原地运行；保存和发布不会删除或改写用户源工程。目录检查拒绝 symlink、路径逃逸和超限文件。远程工具同样生成一个只含远程运行描述和工具定义的 Package Version，不要求把远程服务源码装入包内。

一个 Package Version 可贡献一个或多个 Agent 工具。包根目录使用 `spark-tool.json` 描述元数据，业务代码、依赖、资源和构建产物均由包自行组织。下面使用中性多工具包说明协议；图像理解只在验收章节出现。

```json
{
  "$schema": "https://sparkwork.local/schemas/tool-package-v1.json",
  "schemaVersion": 1,
  "id": "acme.productivity-suite",
  "version": "1.0.0",
  "name": "Acme 生产力工具集",
  "description": "包含报表生成与记录同步工具",
  "runtime": {
    "adapter": "process",
    "protocol": "spark-tool-process-v1",
    "command": "node",
    "args": ["dist/main.js"],
    "lifecycle": "persistent",
    "workingDirectory": "."
  },
  "tools": [
    {
      "name": "generate_report",
      "title": "生成业务报表",
      "description": "根据数据文件和报表要求生成结构化报表；仅在用户明确要求产出报表时调用",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sourceFile": { "type": "string", "description": "数据文件句柄" },
          "instruction": { "type": "string", "description": "报表要求" }
        },
        "required": ["sourceFile", "instruction"]
      },
      "risk": "read",
      "effect": "read",
      "idempotency": "safe"
    }
  ],
  "environment": [
    {
      "name": "REPORT_MAX_ROWS",
      "title": "报表最大行数",
      "type": "integer",
      "required": false,
      "secret": false,
      "default": 2048,
      "agentConfigurable": true
    },
    {
      "name": "EXTERNAL_API_TOKEN",
      "title": "外部服务令牌",
      "type": "string",
      "required": false,
      "secret": true,
      "agentConfigurable": true
    }
  ],
  "permissions": {
    "declaredOsEffects": ["network", "filesystem.read"],
    "requiredSparkCapabilities": ["models.list", "files.read", "files.write"]
  }
}
```

核心协议不得出现 `image`、`vision`、`provider` 等业务类型。

### 2.1 包与工具的身份

- 包 ID 在安装域内唯一，工具的完整运行 ID 为 `<packageId>/<toolName>`；
- Agent 协议适配器生成稳定且无冲突的引擎工具名，同时保留完整 ID 用于调用和 Trace；
- 一个包可贡献多个工具，共享代码、依赖、环境配置和持久进程；
- Package Version 不可变，升级产生新版本；Installation 的启用指针原子切换，失败时保留旧版本；
- 包级启停控制整体，工具级启停可进一步收窄可见范围。

### 2.2 来源与信任

来源只描述安装方式，不改变工具对象：

- `managed-project`：Spark 内或 Agent 对话创建的受管工程；
- `local-directory` / `local-archive`：用户从其他地方开发后导入；
- `registry`：扩展源或市场安装；
- `remote`：远程服务适配器；
- `mcp-import`：已有 MCP 服务的兼容导入。

首版通用进程工具属于 `trusted-local`：它可以按当前用户权限运行完整工程，技术上可能访问当前用户可访问的数据、网络和子进程。Spark 必须明确展示其命令、环境、来源和 `declaredOsEffects`，不能伪称为恶意代码安全沙箱。用户拒绝任一声明的 OS effect 时，整个 Package Version 不允许启用；一旦启用，Spark 不能承诺对这些 OS 行为做细粒度强制拦截。未来可增加 OS 级受限运行模式，但不得取消 trusted-local 的完整能力路径。

## 3. 可扩展 Runtime Adapter

Runtime Adapter 只解决“如何启动和调用”，不决定工具能做什么。

### 3.1 首批适配器

1. **process**：核心通用适配器。启动包内或系统/内置运行时中的任意可执行程序，支持 Node、Python、Rust、Go、Java、原生二进制及作者自带运行时；
2. **remote-http**：连接独立远程工具服务；适合已有部署与跨设备执行；
3. **mcp-import**：兼容第三方 MCP 生态，只是导入适配器；
4. **legacy-custom-tool**：承载现有 HTTP、单文件 code 和 provider-vision 数据的迁移兼容层。

后续新增适配器只需实现统一的 `inspect / start / list / invoke / cancel / stop / health` 生命周期，不修改 Tool Package、Registry 或 Agent authoring 协议。

### 3.2 Spark Tool Process Protocol V1

通用进程通过 stdin/stdout JSON Lines 或本机受保护管道与宿主通信。stdout 只允许协议帧，普通日志走 stderr 或 `log` 帧。每个帧包含 `protocolVersion / type / requestId / invocationId / sequence`，默认最大 4 MB；宿主按 `requestId` 多路复用并施加有界队列和背压。协议包含：

- `initialize`：协商协议版本、包版本、工具清单摘要和 Host Capability 版本；
- `invoke`：传入调用 ID、工具名、结构化输入和调用上下文；
- `result` / `error`：返回结构化结果或稳定错误；
- `log` / `progress`：进入本地 Trace，不污染协议输出；
- `capability.request` / `capability.result`：调用经授权的 Spark Host Capability；
- `cancel`：取消指定调用；结果与取消竞态以宿主先确认的终态为准；
- `health` / `shutdown`：健康检查和优雅退出。

初始化超时、协议版本不兼容、非法帧、超大帧和进程提前退出均返回稳定错误码。宿主必须支持 `per-call` 和 `persistent` 两种生命周期。持久进程用于大模型、浏览器、数据库连接池等昂贵初始化场景；普通崩溃和协议错误只失败所属包并按退避策略重启。对恶意进程或 OS 资源耗尽不做绝对隔离承诺，首版至少设置子进程树终止、调用并发、超时、日志、磁盘缓存和可用平台资源限制。

### 3.3 依赖与运行时

- 工具包可携带已构建产物与依赖，Spark 不强迫使用某个包管理器；
- inspect 只读取文件和 manifest，不执行包代码；受管工程可声明开发命令和构建命令，安装依赖、build 和首次 start 是三个独立且可观察的执行步骤，第三方来源每一步都需要用户确认；
- 需要外部运行时时，优先解析 Spark 自建制品，再用国内镜像，最后才使用公共海外源；
- 工具安装或更新必须记录完整性摘要、来源和实际执行命令；
- 超过 50 MB 的新增下载仍遵循项目既有预检确认规则。

## 4. 环境变量、普通配置与密钥

环境变量是工具包的一等配置能力，不写死在某个业务适配器中。

### 4.1 声明与作用域

每个环境变量声明名称、类型、说明、是否必填、默认值、是否敏感、校验规则和是否允许 Agent 发起配置。配置值与包版本分离，升级时按兼容规则继承。

支持以下作用域：

- 包级：同包所有工具共享；
- 工具级：覆盖某个工具；
- 项目 / Agent / Workflow / 会话级：由运行上下文覆盖；
- 调用级：只在单次调用中注入，调用结束即销毁。

优先级为调用级 > 会话 > Agent/Workflow > 项目 > 工具 > 包 > 默认值。Agent 配置时必须显式传入目标作用域，不允许猜测。敏感值只允许从安全存储或调用级凭据租约注入。

### 4.2 手动与 Agent 对话配置

- Tool Studio 可直接编辑普通变量，并通过安全表单写入 secret；
- Agent 可读取配置 Schema、当前是否已配置和脱敏状态，可直接配置 `agentConfigurable=true` 的非敏感值；
- secret 上的 `agentConfigurable=true` 仅表示 Agent 可发起一次性安全配置请求，不表示 Agent 可写值；为 false 时只能由用户主动在 Tool Studio 配置；
- Agent 对敏感变量只能创建一次性安全配置请求，由用户在模型上下文与消息记录之外的应用内受保护输入框填写；明文不进入模型上下文、普通 IPC 日志或 SQLite；
- Agent 不得通过自由文本或管理工具参数写入 secret 明文；
- 保存前执行类型、枚举、正则和跨字段校验；支持覆盖、删除、轮换、过期和取消并记录脱敏审计；缺少必填值时包可以安装但不能启用；
- 环境变量仅注入声明过的名称，不把 SparkWork 主进程的完整 `process.env` 传给工具。

升级时，仅当新旧声明的名称、类型、secret 标记和作用域兼容时继承配置；不兼容项进入“需要重新配置”状态。回滚到兼容版本复用原值，不兼容版本仍保持未就绪。配置值不进入 Package Version 摘要。

### 4.3 Provider 与外部凭据

工具可选择两种方式使用 Spark 已配置 Provider：

1. 调用 `models.invoke`，由宿主完成凭据使用；
2. 声明高风险 `models.connection.lease`，经用户授权后获得调用期连接信息或指定环境变量注入，用于工具必须直接兼容某个 Provider API 的场景。

第二种能力不得把凭据写入工具工程、版本快照或 Trace。`per-call` 进程可在创建时注入调用级环境；`persistent` 进程禁止修改共享环境来传递调用级凭据，只能通过 capability 响应返回短期不透明令牌、专用管道/文件描述符，或为该调用创建隔离子进程。并发调用不得共享可复用的明文凭据。

## 5. Spark Host Capabilities

Spark 平台能力通过版本化 Host Capability Broker 提供，不通过 MCP，也不要求工具使用 Spark SDK。任何语言都可以实现 Tool Process Protocol 并发起能力请求；SDK 只提供类型和便利封装。

### 5.1 首批能力域

- `models.list / models.get / models.invoke / models.connection.lease`：读取模型目录、调用模型或在授权后租用连接信息；
- `agents.list / agents.get / agents.invoke`：读取或调用助手；
- `agents.create / agents.update`：助手管理，高风险且必须显式授权；
- `files.read / files.write / files.upload / files.present`：处理 Spark 文件句柄、上传文件并向会话呈现产物；
- `workflows.list / workflows.invoke`：复用工作流；
- `tools.list / tools.invoke`：组合内置、插件或其他自定义工具，并执行循环检测；
- `settings.read`：读取明确允许的非敏感设置；不提供任意设置和数据库访问捷径。

能力名是可版本化注册表，不把上述清单固化为协议上限。新增能力不要求升级工具包协议。每项能力拥有独立的请求/响应 Schema、稳定错误码、最大负载、流式/取消规则和兼容版本；调用上下文显式携带当前用户、项目、会话、Agent 和父调用身份，具体能力只继承其声明允许的部分。

首批文件能力语义：`files.read` 消费 Spark 文件句柄而非任意路径；`files.write/upload` 返回有所有者、作用域、有效期和大小限制的文件句柄；`files.present` 把已存在句柄呈现给当前会话。助手与工具递归调用共享调用预算，默认最大深度 8，并以调用栈中的稳定工具 ID 检测循环。

### 5.2 权限、授权与审计

- 包清单声明 required 与 optional Spark Capabilities；required 被拒绝或未配置时 Installation 不允许启用，optional 被拒绝时工具可按文档降级；运行时请求未声明能力时由宿主拒绝；
- 安装和启用页面展示权限差异，用户可按能力域授权或拒绝；
- 读、写、发布、删除等风险继续进入统一权限与确认流程；
- `requiredSparkCapabilities` 是 Broker 可强制拒绝的权限；`declaredOsEffects` 是 trusted-local 的告知、确认和审计信息，不伪装成细粒度 OS 沙箱；
- 每次能力请求记录包 ID、版本、工具、调用 ID、能力名、结果状态和脱敏摘要；
- 一个能力失败只失败当前调用，不能让平台管理、会话或其他工具不可用。

## 6. 统一 Tool Registry 与 Agent 调用

统一 Tool Registry 聚合内置工具、平台工具、插件工具和已发布启用的 Tool Package 工具。来源不同，Agent 看到和调用的语义一致。

进入 Registry 前必须同时满足：Package Version 已安装、已发布、包和工具均启用、required 配置就绪、required Spark Capabilities 已授权、运行适配器可用且作用域匹配。运行健康短暂降级时工具仍可见但调用返回精确可恢复错误；初始化永久不兼容时从快照排除并在管理页显示原因。

每个 Registry 条目至少包含：

- 稳定工具 ID、引擎工具名、标题、说明；
- JSON Schema 输入和可选输出 Schema；
- risk / effect / idempotency；
- 来源、版本、作用域和所需权限；
- `invoke` 入口与 Trace 关联信息。

发布、启用、停用、升级、回滚或配置就绪状态变化后，下一次新的模型推理/Agent loop 生成不可变快照；正在执行的一次模型推理与其工具循环继续使用原快照。每次 invoke 必须绑定快照中的准确 Package Version，升级后旧 loop 仍能调用旧版本，直至 loop 结束再释放版本租约。

Installation 状态机为 `inspected → installed-disabled → configuration-ready → enabled`，运行时另有 `stopped / starting / healthy / degraded / failed`；发布或升级通过 staging 后原子切换。任何一步失败都保留上一个 enabled 版本。

Agent 根据名称、说明和 Schema 自主决定是否调用。Spark 不为图像理解或其他业务场景写专用选择逻辑。每个快照设置工具数量、说明字符和 Schema token 预算；超限时先按作用域、显式启用、Agent 配置和语义候选检索收窄，不能静默截断导致工具随机消失。Claude、Codex 和 OpenAI Chat Completions 只在末端适配各自工具协议；OpenAI Chat Completions 必须补标准 `tools / tool_calls / tool result` 循环并复用同一 Registry 与权限边界。

## 7. Tool Studio 与 Agent 对话开发

### 7.1 Tool Studio

Tool Studio 面向工具工程而不是固定类型表单，提供：

- 创建空白工程、选择模板、导入目录/压缩包、连接远程服务；
- 多文件树、manifest 编辑、外部编辑器打开、构建与依赖安装；
- 环境变量 Schema、普通值与安全 secret 配置；
- 权限和 Spark Host Capabilities 声明；
- 启动、调试、测试输入、日志、进度、Trace 和产物预览；
- 打包、完整性检查、发布、启停、升级和回滚；
- 包内多个工具的独立说明、Schema 和启停状态。

UI 继续使用扁平分割线和清晰文字层级，不引入卡片墙或图像理解专用主入口。

### 7.2 Agent authoring

平台管理能力升级为工具包工作流：

1. 读取 Tool Package 指南和现有包；
2. 创建受管工程或检查外部包；
3. 写入/修改多文件工程与 manifest；
4. 校验 Schema、运行时、依赖、环境变量和权限；
5. 配置普通环境变量，或发起 secret 安全配置请求；
6. 构建并运行测试；
7. 用户确认权限差异后发布和启用；
8. 下一轮验证 Registry 中的工具并进行真实调用。

Agent 不得把“已创建工程”“测试通过”“已发布”和“已启用”混为同一状态。来自第三方的包默认禁用，Agent 不能静默安装依赖、执行代码或扩大权限。

## 8. 存储与生命周期

新增独立表承载通用包，不继续膨胀 `custom_tools` 单行 JSON：

- `tool_packages`：当前安装、来源、信任、启用版本和完整性；
- `tool_package_versions`：不可变 manifest、包路径、摘要、状态和构建信息；
- `tool_package_tools`：包版本贡献的工具元数据与工具级启停；
- `tool_package_config`：非敏感配置、作用域和版本；
- Keychain：敏感环境变量与连接租约引用；
- `tool_package_permissions`：OS effects 的用户确认、Spark Capability 授权和最后核对版本；
- `tool_package_invocations`：调用、能力请求和脱敏 Trace。

安装使用 staging → inspect → integrity → permission review → install-disabled；安装不等于启用。更新失败保留旧版本；卸载先停用并停止进程，再清理安装副本、构建缓存、配置和 Keychain。调用产生并交付给用户的产物、用户源工程和外部目录不属于卸载清理范围。

## 9. 兼容迁移

- 现有 HTTP 工具继续由 `legacy-custom-tool` 适配器运行，并可转换为单工具包；
- 现有单文件 code 工具继续兼容执行，但新建入口改为完整工程；
- provider-vision 只保留一轮兼容，不新增专用能力；已有记录可迁移为普通包或继续走旧宿主路由；
- 旧数据迁移保留原工具 ID 作为 alias，并映射到新 `<packageId>/<toolName>` 稳定 ID；启用状态、版本历史、密钥引用和 Trace 通过 alias 继续关联；
- 迁移完成前，Registry 同时聚合新 Tool Package 与旧 CustomTool Catalog，冲突时以完整稳定 ID 区分；
- MCP 设置页只展示真实外部 MCP，不展示 Tool Package。

## 10. 实施顺序

### Phase A：协议与可安装包基础

- Tool Package V1 Schema、inspection 和完整性摘要；
- 新存储表、Repository、版本与配置模型；
- 本地目录/压缩包导入和受管工程骨架；
- 环境变量 Schema、普通配置和 Keychain secret 状态。

退出条件：中性多工具 manifest、目录检查、摘要、旧库升级/新库、普通环境配置和 secret 状态测试通过；inspect 全程不执行包代码。

### Phase B：通用进程运行时与 Host Capability Broker

- process adapter、Tool Process Protocol、per-call/persistent 生命周期；
- 调用超时、取消、日志、进度、崩溃隔离；
- Host Capability Registry 与首批 models/agents/files/tools 能力；
- trusted-local 权限展示、授权、审计和配置注入。

退出条件：Node 与非 Node 示例包均能完成初始化、并发调用、取消和重启；普通崩溃/非法帧隔离通过；models.invoke、agents.invoke、files.upload/present 三条 Host Capability 端到端契约通过。

### Phase C：统一 Registry 与全引擎调用

- 聚合内置、插件、新工具包和旧兼容目录；
- 不可变 turn 快照与统一 invoke；
- Claude/Codex 末端适配迁移；
- OpenAI Chat Completions 工具调用循环；
- 发布/启停/回滚后下一轮动态刷新。

退出条件：Claude、Codex、OpenAI Chat Completions 均真实调用包工具；停用后新 loop 消失；升级中的旧 loop 固定旧版本；名称冲突和工具预算行为可预测。

### Phase D：Tool Studio 与 Agent authoring

- 工程创建、多文件、依赖、构建、环境配置和权限 UI；
- Agent 工具包创建、导入、配置、测试、发布与启停 API；
- secret 安全配置请求和会话外输入；
- 真实会话路由测试、Trace 与产物呈现。

退出条件：手动和 Agent 两条路径均能创建/导入、配置、构建、测试、发布和启用；secret 明文从不进入模型；真实应用交互由用户手动验收。

## 11. 验收标准

平台通用性至少由三个互不相似的包验证，任何一个都不是核心协议特例：

1. **图像理解包**：自带多文件代码与 `sharp` 依赖，自行压缩图片，通过授权使用本地 Provider 连接或模型调用能力，启用后由 Agent 自主调用；
2. **复杂本地包**：包含第三方依赖、多个工具、持久进程和文件/网络逻辑，环境变量可手动和通过 Agent 工作流配置；
3. **外部工具包**：在 Spark 外按 Tool Package manifest 与 Tool Process Protocol 开发，从目录或压缩包导入后无需针对 Spark 源码做改动即可安装、配置、启用并被 Agent 调用。

共同验收项：

- 工具业务代码不依赖 MCP；
- 启用后下一轮出现在 Agent 工具清单，停用后消失；
- 工具说明、Schema、风险和调用结果正确传递；
- Agent 可自主选择调用，权限拒绝和工具失败不会阻断会话或其他工具；
- 普通环境变量可由 Tool Studio 或 Agent 配置；secret 可由 Agent 发起安全配置但明文不进入模型；
- 工具可使用已授权的模型、助手、文件上传等 Spark Host Capabilities；
- 工具崩溃、超时或协议错误只影响当前包/调用；
- 版本升级失败保留旧稳定版本，回滚无需重新输入兼容配置；
- 不自动删除用户源工程或生成产物。

## 12. 非目标与诚实边界

- 首版不承诺 trusted-local 第三方代码具备恶意代码沙箱；
- 不要求所有语言都使用 Spark SDK；协议和 SDK 分离；
- 不把所有 Provider、Agent 或文件能力的内部数据库对象直接暴露给工具；通过版本化能力契约访问；
- 不在首个切片同时完成公共市场、签名基础设施和企业策略中心；
- 不因首个验收包是图像理解而增加任何图像专用核心协议。

## 13. 影响与验证要求

本改造影响协议、插件安装、存储、运行时、Keychain、平台能力、Session 工具装配和各模型引擎，风险为 HIGH。实施必须满足：

- `session.service.ts` 只增加独立 Registry Snapshot 的薄接线；
- 新旧数据双读兼容，迁移覆盖旧库升级和全新建库；
- Runtime Host、Capability Broker 和 Engine Adapter 分模块测试；
- 聚焦验证协议、Repository、包检查、进程生命周期、环境注入、密钥脱敏、权限、Registry 刷新、工具循环和失败隔离；
- Desktop typecheck、目标 ESLint、迁移干跑、生产构建与打包资源一致性通过；
- 完成后进行正确性、兼容性、安全、性能和异常回退代码审查；
- 真实应用交互与第三方包执行由用户手动验收，自动化不得冒充真机验收。

## 14. 当前落地状态（2026-08-31）

本轮已完成首个可运行切片，并经过源码复核、聚焦测试、迁移干跑、类型检查、目标 lint、生产构建和隔离 Electron UI 验证。文档仍保持“实施中”，以下“已完成”只描述当前代码事实，不代表 Phase A-D 的全部退出条件均已满足。

### 14.1 已完成

- 已落地业务无关的 Tool Package V1 Schema、Tool Process Protocol V1、090/091 存储迁移、不可变版本记录、配置/权限/安全输入请求 Repository；
- 已实现只读目录 inspection、symlink/路径逃逸拒绝、文件与总大小上限、原子 staging 安装，并在复制后重新核对 staging 摘要，避免源目录复制期间变化破坏不可变版本；
- 已实现受管多文件工程创建、文件清单、受限读取与逐文件写入，以及 `process` adapter 的 `per-call` / `persistent` 生命周期、初始化、调用、取消、关闭、4 MB 有界协议帧和普通崩溃/非法帧隔离；
- 已实现普通环境变量的包/工具/项目/Agent/Workflow/会话作用域解析、类型校验和 Agent 配置；secret 只能创建一次性安全请求，由应用内密码输入写入 Keychain，SQLite 仅保存元数据和引用；
- 已实现 required/optional Spark Capability 声明与用户授权的双重校验；撤销 enabled 版本的 required 权限会自动停用该包；
- 首批 Broker 能力已落地 `models.list/get/invoke`、`agents.list/get/invoke`、`files.upload/present`。文件能力在桌面主进程继续校验 Spark 允许根目录；`agents.invoke` 当前明确为单轮模型调用；
- 已实现 Tool Package Runtime Catalog，Claude/Codex 通过现有末端 MCP bridge 获得动态快照；OpenAI Chat Completions 已实现标准 `tools → tool_calls → tool result` 多轮循环，并对写能力复用交互审批；
- 平台管理 Agent 已能读取指南、检查目录、创建/列出/读取/写入受管工程、安装、配置非敏感变量、发起 secret 请求、核对权限、启停和真实测试；安装、权限变更、启用和执行均要求显式确认；
- Tool Studio 已增加“工具包”视图，支持版本切换、普通配置、Keychain 安全配置、权限核对和启停；全局安全输入 Host 不把 secret 写入消息记录；
- 已实现受管工程开发工作流：manifest 可声明 `development.installCommand/buildCommand`，安装命令支持按 lockfile（pnpm/yarn/bun/npm）推断，build 未声明即拒绝；步骤以 trusted-local 在工程目录执行，超时终止进程树、输出限幅保留尾部；UI 提供「安装依赖/构建」按钮与结果展示，Agent 侧通过 `tool_packages_run_project_step` 触发且强制 `confirmExecute`（manifest 命令对 Agent 可写，等价于启用前代码执行，必须显式确认）；工程文件清单跳过 `node_modules`/`.git`/`.DS_Store`；
- 已实现卸载与版本治理：卸载要求包处于停用态，先停进程、再删除安装目录与数据库级联记录，并尽力清理 Keychain 密钥引用；受管工程源码默认保留，仅在二次确认后删除；删除单个不可变版本设有「启用版本拒删、最后一个版本拒删、安装路径必须位于包根内」三重防护；UI 提供卸载/删版本危险按钮与双重确认，Agent 侧通过 `tool_packages_uninstall` / `tool_packages_delete_version` 触发且强制 `confirmUninstall`；
- 已实现压缩包与 Git 仓库导入：`.zip` 经 `fflate` 解压到一次性 `tool-imports/` 物化目录（防 zip-slip、跳过 `.git`/`__MACOSX`/`.DS_Store`、单层包裹目录自动识别、256 MB 包体/5 万条目/2 GB 解压上限），Git 仓库以参数数组浅克隆（无 shell、`--` 分隔、ref 字符集白名单、`GIT_TERMINAL_PROMPT=0`、代理环境透传、超时杀进程树），`owner/repo` 简写自动规范化为 GitHub HTTPS；安装记录 `source_url/source_ref/source_subdirectory` 溯源（092 迁移）并在详情中展示；Tool Studio 提供统一「导入工具包」弹窗（本地目录/压缩包/Git 三种方式 + trusted-local 安装确认），Agent 侧通过 `tool_packages_install_archive` / `tool_packages_install_git` 触发且强制 `confirmInstall`；本地目录安装补齐 `installLocalDirectory` 统一返回形状供 UI 复用；
- 已实现非 process 适配器实际执行：`remote-http` 把 schema 合法的 `spark-tool-process-v1` invoke 协议帧 POST 给远端工具包服务，校验响应必须是 requestId/invocationId 回显一致的 result/error 子帧，响应体 4 MB 上限（超限截断即拒绝，不把残缺 JSON 交给模型），header 支持 `${ENV}` 模板渲染（值来自已解析环境含 Keychain 密钥，引用未配置变量直接拒绝，密钥不落错误文本，错误 URL 只保留协议/主机/路径骨架），超时经 AbortController 中止并保留原始异常 cause；`mcp-import` 经宿主 MCP 桥代理调用（manifest 工具名经 `toolNameOverrides` 映射到服务器真实工具名），输入先按 manifest schema 预校验再代理，结果保留 MCP content 结构，isError 抛为失败；导入工具默认按保守权限处理（risk `low-write`/effect `update`/idempotency `unsafe`）；新增 `installRemoteManifest`（注册远端 manifest，无本地代码）与 `installMcpImport`（读取 MCP 服务器工具清单并登记为不可变版本，跳过无法规范化的工具名并报告原因）两个安装入口，UI「导入工具包」弹窗增加第四种方式「MCP 服务器」（下拉来自 `mcp:list`，懒加载），Agent 侧通过 `tool_packages_install_remote` / `tool_packages_install_mcp_import` 触发且强制 `confirmInstall`；`legacy-custom-tool` 有意保持不可执行；
- 隔离 Electron 生产构建实例已验证“扩展中心 → 自定义工具 → 工具包”可进入、空状态可见，页面错误和控制台错误均为 0。

### 14.2 代码审查已修复的确定缺陷

- Capability 原先只检查 manifest 声明、未检查用户实际授权；现增加 `CAPABILITY_NOT_AUTHORIZED`；
- 撤销 required 权限后包仍可能保持 enabled；现原子切回 `installed-disabled`；
- 超过 4 MB 且不换行的 stdout 可能无限缓冲；现使用有界 Buffer，协议失败持有并强制终止原进程；
- cancel/子进程关闭错误可能覆盖原始 timeout/protocol 错误；现保留最初失败原因；
- stderr 可能原样记录配置 secret；现按当前 manifest secret 值做精确脱敏；
- 跨版本仅按变量名继承配置；现按新 manifest 的类型、secret 和校验规则重新判断兼容性；
- 布尔默认值、版本/权限异步 UI handler 和 OpenAI 审批回调异常存在错误状态或中断 turn 的风险；现均已修复并覆盖聚焦测试；
- 服务构造原先会让不拥有持久数据库路径的测试/嵌入宿主崩溃；现这类宿主不挂载 Tool Package 持久目录，动态目录安全返回空集；
- 原子安装原先只校验复制前源目录，且复制中途失败可能遗留 staging；现把复制纳入统一清理边界，复制后复核 staging 完整性，再写安装元数据并原子切换。
- Agent authoring 原先只能创建和覆盖文件，无法读取既有受管多文件工程，且非字符串 `content` 会被静默写成空串；现增加受限文件清单/读取接口并拒绝非法内容类型、路径逃逸、symlink 和超大读取。
- 安装与启停管理响应原先返回裸数据库行；现与 list/get/桌面 IPC 一致返回稳定 `ToolPackageSummary` 契约。
- secret 请求切换时原输入可能残留并被误用于下一请求，过期请求失败后也不会刷新；现按 request ID 清空输入、串行化提交/取消并在失败后重新拉取状态。

第二轮三层审查（功能 / 完整性 / 交付水平）追加修复：

- `persistent` 进程在 initialize 阶段超时或失败时可能遗留孤儿子进程；现初始化失败统一进入终止边界并强制结束进程树；
- Claude/Codex 末端桥原先把 JSON Schema 粗降级为 string/number/boolean，嵌套对象与整数数组参数会被错误改写，复杂工具无法按声明参数调用；现完整保留嵌套 Schema，并在执行边界复验后才进入工具；
- 并发 `persistent` 初始化与并发停止存在竞态；现初始化结果可复用、停止串行化并以测试锁定；
- `blocked` 包安装新版本时可能被 manifest 默认信任值意外“解封”；现 blocked 状态跨版本保持，测试夹具按安全语义隔离；
- 超大 `spark-tool.json` 原先一次性读入主进程存在 OOM 风险；现读取前先做大小上限校验；
- Keychain 异步写入期间“保存/取消”可竞态导致 UI 报失败但密钥已更新；现提交串行化并保证状态与实际写入一致；
- OpenAI Chat 流式工具调用补齐硬边界：参数增量超 1 MiB 终止、单轮调用数与 tool_call ID/名称长度限额、超过 2 MiB 或不可序列化的工具结果转为有界 JSON 摘要/错误并继续会话；Tool Package 工具名保证不超过 OpenAI 64 字符限制。

### 14.3 首版尚未完成或有意限制

- `remote-http` 与 `mcp-import` 已可实际执行（帧协议远端调用 / 宿主 MCP 桥代理），仅 `legacy-custom-tool` 有意保持不可执行；
- 依赖安装与 build 步骤已以受管工程开发工作流形式落地，卸载与单版本删除也已提供 UI 与 Agent 接口，压缩包与 Git 仓库导入（浅克隆）也已落地；尚未提供 npm-style registry 远程 URL 导入（`installRemoteManifest` 需通过 Agent 对话传入 manifest 对象）、完整多文件 IDE、运行健康页和工具级启停 UI；开发步骤本身不做依赖审计或锁文件校验，安装结果以进程退出码为准；Git 导入不校验仓库签名，浅克隆不携带完整历史，溯源以克隆时 URL/ref 为准；
- `models.connection.lease`、`agents.create/update`、`files.read/write`、`workflows.*`、`tools.*`、`settings.read` 尚未进入 Broker；调用级环境覆盖与调用级凭据租约尚未开放；
- `agents.invoke` 不递归运行完整 Agent loop，不自动挂载该助手的 Skills/MCP/团队/工作流；
- 首版没有 OS 沙箱、CPU/内存/磁盘/进程树硬配额，也没有恶意代码隔离承诺；trusted-local 仍是当前用户权限进程；
- 显式版本租约目前由 Agent loop 的不可变闭包绑定版本，尚未实现卸载配套的引用计数；`tool_package_invocations` 脱敏审计表与完整 Trace UI 仍待补齐；
- 隔离 Electron 自动化只验证构建产物中的入口、空状态和无页面异常；真实用户数据、第三方包安装执行、权限交互和真机体验必须由用户手动验收。

### 14.4 本轮交付门禁结果

- Protocol、Storage、Agent Runtime 与 Desktop typecheck 均通过；
- Protocol 测试 7/7、Storage Repository 测试 6/6、Agent Runtime 聚焦测试 62/62、旧库升级测试 4/4 均通过；
- 090/091 迁移在全新数据库与旧库升级路径均通过；91 个迁移全新库干跑通过；
- 目标 ESLint 无 error，仅保留与本功能无关的既有 warning；Prettier、`git diff --check` 与文件大小检查通过；
- Desktop production build exit 0，renderer 完成 17,732 modules transform，只有仓库既有的 Vite 动静态导入分块提示；
- live `better_sqlite3.node` 与仓库 Electron prebuild 的 SHA-256 一致（`13e0cbee…`）；仓库 Electron 43.2.0 二进制在 `ELECTRON_RUN_AS_NODE` 下自报 `modules-abi=148`，双证据确认原生模块处于 Electron ABI；
- GitNexus MCP 未挂载，依项目降级规则使用源码调用点、聚焦测试、Git 历史与 `git diff` 完成影响和变更范围复核；
- 本轮未提交、未推送，构建产物未进入 Git 变更。

第三轮（Phase B-1：受管工程依赖安装与构建工作流）追加门禁：

- Protocol、Agent Runtime、Desktop typecheck 均通过（Storage 无改动）；
- Protocol 测试 10/10、project runner 测试 8/8、Service+Bridge 聚焦测试 20/20（Node ABI 运行，结束已恢复 Electron ABI）、MCP 契约 7/7 均通过；格式化后 runner/bridge 复跑 14/14；
- Prettier 全部 11 个改动文件通过；目标 ESLint 0 error；`git diff --check` 通过；
- Desktop production build exit 0；`out/main/tools/platform-management-mcp-server.mjs` 与源码逐字一致，含 `tool_packages_run_project_step` 定义与路由。

第四轮（Phase B-2：工具包卸载与版本治理）追加门禁：

- Protocol、Agent Runtime、Desktop typecheck 均通过（Storage 仅 Repository 新增方法）；
- Storage Repository 级联删除测试 8/8、Service 卸载/删版本测试 18/18、Bridge 契约测试 8/8、Protocol 测试 10/10 均通过（SQLite 测试以 Node ABI 运行，结束后恢复 Electron ABI，`better_sqlite3.node` SHA-256 与 vendor Electron prebuild 一致）；
- 目标 ESLint 0 error（测试文件保留既有 `no-non-null-assertion` 风格 warning，HEAD 基线即存在）；Prettier、`git diff --check` 通过；
- 卸载期间在途 Agent loop 的行为边界：Agent loop 以不可变闭包绑定版本，卸载/删版本不做引用计数，进行中的调用在下一次访问安装目录/数据库行时收到明确的 not found 错误，不会静默降级。

第五轮（Phase B-3：压缩包与 Git 仓库导入）追加门禁：

- Protocol、Storage、Agent Runtime 与 Desktop（node + renderer 双 tsconfig）typecheck 均通过；
- Import 纯逻辑测试 27/27（解压/包裹目录/跳过杂项/zip-slip/上限/无 manifest/Git 源规范化矩阵/ref 与子目录校验/离线本地仓库克隆）、Service 安装测试 21/21（zip 安装、Git 安装含溯源、同版本幂等重装）、Storage Repository 测试 8/8、Bridge 契约测试 9/9（确认门/参数校验/可选参数不透传 undefined）、MCP 契约 7/7 均通过；SQLite 测试以 Node ABI 运行，结束后恢复 Electron ABI；
- 92 个迁移全新库内存干跑通过（含 092 溯源列）；
- 目标 ESLint 0 error（105 个 warning 均为 HEAD 既有测试文件 `no-non-null-assertion` 风格）；Prettier 格式化后全过；`git diff --check` 通过；
- Desktop production build exit 0；`out/main/tools/platform-management-mcp-server.mjs` 与源码逐字一致，含 2 个新导入工具定义与路由；
- 新增依赖仅 `fflate@0.8.2+`（纯 JS zip 解压，无 native 编译、无子依赖）。

第六轮（Phase B-4：非 process 适配器实际执行）追加门禁：

- Protocol、Storage、Agent Runtime 与 Desktop（node + renderer 双 tsconfig）typecheck 均通过（Desktop 仅剩并行会话 git-panel 文件的 1 个既有错误，本功能文件零错误）；
- remote/mcp-import 执行器测试 12/12（帧协议回显、header 环境模板、未配置变量拒绝、HTTP 错误摘录、非协议帧拒绝、requestId/invocationId 回显校验、远端 error 帧、输入预校验、超时、MCP content 结构保留、isError 抛错、未声明工具/适配器错配拒绝）、Service+Import+Bridge 聚焦测试 77/77（含 `installRemoteManifest` / `installMcpImport` 安装、确认门、参数校验、skippedTools 报告）、Storage Repository 8/8、Protocol 12/12、MCP 契约 7/7 均通过；SQLite 测试以 Node ABI 运行，结束后恢复 Electron ABI（`better_sqlite3.node` SHA-256 与 vendor Electron prebuild 一致）；
- 目标 ESLint 0 error（1 个既有风格 warning 为 B-3 遗留的 `react-hooks/set-state-in-effect`，非本轮引入）；Prettier、`git diff --check` 通过；
- Desktop production build exit 0（两次构建确认）；`out/main/tools/platform-management-mcp-server.mjs` 与源码逐字一致，含 `tool_packages_install_remote` / `tool_packages_install_mcp_import` 定义与路由。
