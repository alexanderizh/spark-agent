# Spark 连接器系统与连接器市场

> 状态: 实施中 | 最后核对: 2026-08-09

Spark 的插件系统是一个声明式扩展平台：插件包通过 `plugin.json` 声明 Skill、MCP Server 和 Connector manifest，安装后由主进程统一登记、授权、启停和审计。第三方 JavaScript 不会被注入 Renderer 或 Main；需要执行代码的扩展必须在后续版本使用独立沙箱协议，不能把 npm 包或脚本当作当前插件格式的隐式入口。

## 产品信息架构

应用内统一使用“扩展中心”作为外部能力入口，提供 MCP 与连接器两个分区。连接器是安装来源、完整性、权限、账号连接和生命周期的治理边界，贡献的 Connector manifest 仍由连接器运行时执行，MCP 仍由 MCP 运行时执行。Skill 保持独立入口，用于编排、发现和维护提示词工作流，避免与连接器目录混为一谈。

## 当前可用性边界

连接器导入验收包含 Gmail 和 Notion 的正式 manifest、OAuth PKCE 配置、只读 scope、keystore 存储声明和 Skill 挂载；这证明包校验、权限记录和资源登记链路可用，但不等于账号已经连接。当前四个首批 runtime 均已进入统一 Runtime Broker：GitHub、Google Workspace（Gmail + Calendar）、Notion 和 Obsidian。内置连接器自动登记，连接动作通过通用连接器运行时 IPC 完成，凭据只以 keystore 引用形式进入 SQLite；Agent 工具在每次调用前检查连接器启用状态、必需权限、账号状态、能力范围、资源范围和风险确认。停用连接器会立即阻断工具调用。未连接账号仍显示“待连接账号”，不会把“已启用”误报为“可调用”。

## 已落地的边界

- 协议入口：`packages/protocol/src/plugin.ts`，提供 manifest、权限、市场条目和 IPC 合同。
- 本地安装：选择目录后先解析与校验 `plugin.json`，检查版本、路径穿越、软链接、文件数量/大小和 Skill 的 `SKILL.md`，再做原子目录切换。
- 完整性：包内容按稳定的相对路径 + 文件内容计算 SHA-256；市场安装必须匹配市场返回的摘要。
- 权限：`network`、文件、进程、凭据、浏览器、MCP 和连接器访问均为显式权限。必需权限未授权时插件保持 blocked，不能被启用。
- 激活：Skill / MCP 资源通过 `plugin_resources` 建立来源映射；禁用插件会同步禁用它贡献的 Skill 和 MCP Server，卸载时只删除插件拥有的资源。
- 内置运行时：manifest 可声明受 allow-list 约束的 `runtime`；当前 `spark.github`、`spark.google`、`spark.notion` 和 `spark.obsidian` 使用 `builtin` runtime。内置包可停用、不可移除，不执行插件包内的任意 JavaScript。
- Agent 闭环：`SessionService` 将同一 `PluginManager` 注入 `spark_plugins` MCP Bridge；四个 runtime 的工具都由动态目录生成，调用仍经过同一运行时守卫，因此 UI 状态、账号连接、Agent 调用和停用行为不会分叉。旧 GitHub IPC 保留一版兼容期。
- 市场：市场源独立存储，支持搜索、摘要校验、源启停和企业内网 API 地址替换。市场页面只展示已启用且配置可信公钥指纹的来源；未部署或未配置的占位地址不会以“连接器市场”呈现，也不会发起网络请求。
- 账号体验：运行时返回 provider 的真实账号名和头像；旧连接器迁移时优先复用 `account_json` 中的真实名称、登录名或邮箱，避免回退为泛化的连接器名称。账号状态与错误原因分层展示，断开后刷新运行时快照并关闭空账号弹窗。令牌和 OAuth Client ID 表单提供连接器描述中声明的官方配置页面入口，未来连接器可复用同一元数据。
- 兼容与展示：旧连接器迁移产生的 transport 能力值会按 runtime descriptor 自动归一化，历史 `mcp_tools` 不会再进入新的能力选择提交；同名内置连接器与本地导入连接器在扩展中心合并为一张卡片并保留各自生命周期 ID，内置连接器不可误删，市场多源结果按插件 ID 和信任级别去重。
- 品牌图标：GitHub、Google、Notion 和 Obsidian 使用 Lobe Icons 的品牌组件；Gmail 与 Google Calendar 使用随应用打包的彩色 SVG，运行时不依赖外部图片 URL，避免离线时图标缺失。

## 插件包格式

```text
my-plugin/
├── plugin.json
└── skills/
    └── weekly-report/
        └── SKILL.md
```

`plugin.json` 的最小形态：

```json
{
  "schemaVersion": 1,
  "id": "acme.weekly-report",
  "version": "1.0.0",
  "displayName": "Weekly Report",
  "description": "Create a weekly report from approved sources.",
  "author": { "name": "Acme" },
  "permissions": { "required": ["network"], "optional": [] },
  "activation": "manual",
  "contributions": {
    "skills": [{ "id": "weekly-report", "path": "skills/weekly-report" }],
    "mcpServers": [],
    "connectors": []
  }
}
```

市场 API 需要返回 `plugins` 或 `items` 数组。每个条目至少包含 `id`、`version`、`packageUrl`、64 位十六进制 `packageSha256`、`manifestUrl` 和 `requiredPermissions`。生产市场还必须返回 `signature` 与 `signingKey`：客户端使用市场配置的受信任公钥指纹，验证 `id\\nversion\\npackageSha256` 的 Ed25519 签名；未验证条目只能展示，不能安装。插件包可以是 tar archive；服务端必须在发布前生成摘要并在传输层使用 HTTPS。

## 参考 OpenWorker 的取舍

参考代码保存在工作区外的 `/Users/zhangyang/spark_ai_project/openworker-reference`，来源是 Andrew Ng 的 `andrewyng/openworker`。本实现吸收了它的本地优先、能力目录、连接器工具治理和操作前确认原则；市场与插件生命周期则按 Spark 已有 IPC、SQLite、Skill/MCP 运行时进行原生化，而不是复制其 Python/Tauri 运行时。

## 运营与后续兼容约束

市场服务必须对插件包做签名发布，并在条目中返回签名和签名公钥；客户端在本地维护 trusted key fingerprints，分别完成摘要完整性和发行者身份验证。新增可执行插件运行时前，必须提供独立 host、最小权限 token、崩溃隔离、超时/取消、资源配额和审计事件，不能复用当前声明式包的安装路径。当前自动验收覆盖：Gmail/Notion 真实目录导入、四个内置 adapter contract、OAuth PKCE/refresh rotation、Skill/Connector/Runtime 资源挂载、连接器启停与不可卸载、禁用后的 Agent 工具拒绝，以及桌面扩展中心的图标、连接状态和连接弹窗。真实 provider acceptance 仅在隔离测试凭据显式提供时执行；没有凭据时测试会 skip，不会冒充通过。第三方 worker 仍保持不可执行门禁，直到隔离 Worker Host 完成。
