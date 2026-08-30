# SparkWork 原生自定义工具运行时

> 状态: 已废弃 | 最后核对: 2026-08-31

本文记录 0.11.28 的单文件受限 Worker 过渡实现。它禁止依赖、文件、网络和 import，不能代表用户要求的完整自定义工具平台。现行设计见 [通用自定义工具包平台 V3](./2026-08-31-custom-tool-package-platform-v3.md)。旧实现暂时作为兼容适配器保留，不再扩展为产品核心。

## 1. 产品定义

自定义工具是 SparkWork 的一等扩展对象，不是“自定义 MCP”的别名。一个工具从创建到使用都由同一原生内核管理：

- ID、名称、给 Agent 的说明和输入 Schema；
- 风险、副作用、幂等性、权限和资源上限；
- 草稿、测试、稳定版本、原子发布、回滚和启停；
- Keychain 密钥引用、调用 Trace、错误和耗时；
- Tool Studio 表单/代码编辑与 Agent 对话创建；
- 会话、工作流、画布和未来其他宿主共享的工具目录。

MCP 只保留两个合法角色：导入用户已有的外部 MCP 服务；在某个模型引擎只接受 MCP 工具协议时，作为不可见的最后一公里传输适配器。用户开发、存储、发布和执行的对象都不是 MCP server，也不写入 `mcp_servers`。

## 2. 原生架构

```text
Tool Studio / Agent authoring
          │
          ▼
CustomToolService ── version / policy / secret / trace
          │
          ▼
CustomToolRuntimeCatalog
   ├─ HTTP adapter
   ├─ Code Worker adapter
   ├─ Provider host adapter
   └─ future SQL / workflow / media adapters
          │
          ├─ direct: UI / workflow / canvas / host routing
          └─ engine adapter: Claude / Codex tool protocol
```

旧 `spark_custom_tools` 受管 MCP 注册在应用启动时停止并删除；只删除应用创建的 `scope=managed, name=spark_custom_tools` 行，不影响用户 MCP 配置或自定义工具数据。

## 3. TypeScript 代码工具

`type=code` 是原生运行适配器。源码随工具版本快照保存，入口固定为：

```ts
export default async function run(input, sdk) {
  const data = await sdk.tools.call('approved_tool', { query: input.query })
  return { data }
}
```

首个生产边界：

- 独立 Standalone Node 进程，一次调用绑定一个工具版本；
- Node Permission Model 只读 Runner 自身，不读取用户目录；
- 禁止 import / dynamic import、文件、子进程、Worker、Addon 和 WASI；
- 不传完整环境变量、Provider Key、工具 Keychain 值或宿主对象；
- 通过 `permissions.toolIds` 明确允许 `sdk.tools.call` 的目标；
- 依赖必须存在、已发布且启用，外层工具风险不能低于依赖；
- 循环调用和超过八层的组合调用由宿主拒绝；
- 超时、输出大小、V8 heap、协议帧和日志有独立上限；崩溃只失败当前调用。

信任标签固定为 `trusted-local`。Node 权限模型目前不能强制断网，`vm` 也不是恶意代码安全边界，因此只允许用户自己编写或确认可信的代码。三平台 OS 级默认断网完成后才能新增“不可信包”信任等级；当前 UI、文档和 Agent 都不得混淆两者。

## 4. Agent 对话开发

所有 Agent 继续通过平台管理工具操作同一个 `CustomToolService`：

1. `custom_tools_guide` 获取 HTTP 与 code 完整示例；
2. `custom_tools_list/get` 核对现状；
3. `custom_tools_validate` 校验定义、风险和密钥边界；
4. `create_draft/save_draft` 保存禁用草稿；
5. 用户确认后测试、发布、启用或回滚；
6. 下一轮从原生 Runtime Catalog 重新生成引擎工具快照。

代码工具不要求 Agent 生成 `package.json`、stdio server 或 MCP manifest。需要外部 API 时，优先创建受管 HTTP 工具，再由代码工具按 ID 组合；用户明确已有 MCP 服务时才走 MCP 导入。

## 5. 权限与失败回退

- 只读工具可进入自动允许清单；写入、发布和删除类工具可发现但不自动允许，必须走会话权限确认。
- 草稿永远不进入 Agent 目录；发布失败保留旧稳定版本。
- Provider Vision 继续由宿主验证本轮附件，不向模型开放任意本地路径。
- Worker、依赖工具或 Trace 写入失败都不能阻断其他工具或会话；错误须带精确类型。
- 工具删除先停用，再清理 Keychain 和版本数据。

## 6. 验收标准

- 用户可在 Tool Studio 从空白创建、编辑、测试、发布并启用 TypeScript 工具。
- Agent 可从对话生成相同 `type=code` 草稿，不创建 MCP 项目。
- 代码工具可执行类型化纯逻辑，并组合白名单中的 HTTP 或其他原生工具。
- 未授权工具、循环依赖、低报风险、缺失/停用依赖、import、超时和超大输出均被拒绝。
- 自定义工具不出现在 MCP 设置页，不产生 `spark_custom_tools` 注册。
- Claude/Codex 下一轮可调用已发布工具；高风险工具仍需权限确认。
- 图像理解只保留为普通模板和宿主路由验收用例。

## 7. 落地验证记录（2026-08-31）

- 存储：迁移 089 已用「088 旧库升级 + 全新建库」双路径测试锁定（`packages/storage/src/custom-tools-native.migration.test.ts`，4 项）；89 个迁移内存干跑通过。
- 执行：code Worker 聚焦测试（独立进程执行、白名单组合、拒绝未声明组合）通过；服务层依赖校验（发布门禁、风险继承、循环/深度）27 项通过。
- 打包：`copy-runtime-tools` 构建钩子已改为同步式清理，源目录删除的工具不再残留 `out/main/tools` 并随 extraResources 打进安装包；生产构建后 `custom-tool-worker-runner.mjs` 与源码逐字一致，旧 `custom-tools-mcp-server.mjs` 已从产物清除。
- 迁移：启动期移除 `spark_custom_tools` 受管 MCP 注册（仅应用创建的 managed 行），自定义工具改由 `CustomToolRuntimeCatalog` 原生暴露。

## 8. 后续增强

- 三平台 OS 级默认断网、RSS/Job/cgroup 限额和真机验收；
- TypeScript 诊断、格式化、断点和 Monaco 类型补全；
- OpenAPI 批量导入与结构化输出 Schema；
- 工具作用域（全局 / 项目 / Agent / Workflow）和能力包；
- 经安全评审的依赖包白名单与不可变构建产物。
