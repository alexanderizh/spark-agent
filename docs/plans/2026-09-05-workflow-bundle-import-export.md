# 工作流包(Workflow Bundle)导入导出与隔离空间

> 状态: [已落地] | 最后核对: 2026-09-05

## 1. 背景与目标

现阶段工作流导入导出仅传递流程图 JSON(`WorkflowView.tsx` 前端 `JSON.stringify`),不含技能(Skills)、MCP 配置等运行依赖。企业级场景下分享的工作流需要「直接可用」:

- 导出:流程图 + 依赖技能本体 + MCP 配置(密钥脱敏)+ 校验和,打包为 `.sparkflow`。
- 导入:进入隔离空间(bundle 命名空间),不影响导入方现有技能/MCP/工作流。
- 验证:导出即校验、导入先预览、落地后可复验,提供验证徽章。
- 兼容:旧版纯流程图 `.json` 导入导出行为完全保留。

分支:`fizzlx_20260905_工作流包导入导出隔离空间`(基于 `ba9eed7b`)。

## 2. 现状结论(代码探索)

| 项 | 现状 | 关键位置 |
|---|---|---|
| 导出 | 前端仅 stringify graph,不含 id/技能/MCP | `WorkflowView.tsx:83-92` |
| 导入 | 手写弱校验,graph 透传,每次新建不去重 | `WorkflowView.tsx:648-692` |
| 技能存储 | `{userData}/skills/<slug>/`,DB `skills` 表;ID 前缀即命名空间(`builtin:`/`skill:skillhub:`) | skills 服务 |
| MCP 存储 | `mcp_servers` 表 name/scope/config_json,无来源标记;运行时全量 enabled 挂载 | `session-mcp-tooling.ts:91-136` |
| 防污染关键点 | Agent 无技能配置时回落「全部已启用技能」——bundle 技能必须从该回落中排除 | `runtime-composition.service.ts:134` |
| Schema 先例 | 画布工作流已有 zod Package schema 可仿照 | `packages/protocol/src/canvas-workflow.ts:93-117` |

## 3. 包格式:`.sparkflow`(zip 容器)

```
manifest.json          ← schemaVersion/名称/版本/作者/导出来源应用版本/验证报告
workflows/<n>.json     ← 流程图(含依赖引用声明)
skills/<slug>/…        ← 技能目录原样打包(SKILL.md + manifest 等)
mcp/<refId>.json       ← MCP 配置(密钥替换为占位符)
checksums.json         ← 除自身外全部文件的 sha256
```

manifest 核心结构:

```jsonc
{
  "schemaVersion": 1,
  "name": "…", "version": "1.0.0", "author": "…", "exportedFrom": "…",
  "workflows": [{ "file": "workflows/0.json", "name": "…" }],
  "skills":   [{ "bundleSkillId": "…", "path": "skills/…", "sha256": "…" }],
  "mcpServers": [{ "refId": "…", "transport": "http|stdio", "file": "mcp/…",
                   "requiredSecrets": [{ "path": "headers.X-API-Key", "label": "…" }] }],
  "unresolved": [{ "type": "agent|rule|tool", "nodeId": "…", "hint": "…" }],
  "verification": { "status": "passed|warned|failed", "checks": [{ "id": "…", "ok": true, "message": "…" }] }
}
```

密钥安全:导出时把 MCP config 中 headers/env 的密钥值替换为占位符 `{{secret:<path>}}`,路径登记进 `requiredSecrets`;导入方激活 MCP 前必须补齐。

## 4. 隔离空间设计

- 新表 `workflow_bundles`:`id, name, version, author, manifest_json, source, verification_status, created_at, updated_at`。
- `workflows` 表加可空列 `bundle_id`;`mcp_servers` 表加可空列 `bundle_id`。
- 技能落盘 `{userData}/skills/_bundles/<bundleId>/<slug>/`;DB 行 ID `bundle:<bundleId>:<slug>`。导入时改写流程图节点内的 skillIds 指向新 ID。
- 防污染:`runtime-composition.service.ts` 的「无配置→全部已启用技能」回落排除 `bundle:` 前缀技能;bundle 技能仅被包内工作流显式引用。
- MCP 导入后 `enabled=0` 且挂 `bundle_id`;在包详情页逐个/批量「激活」(补密钥→启动测试)后 `enabled=1`。
- 卸载整包:包内工作流 + 技能目录 + DB 行 + MCP 配置整体移除。
- 旧格式兼容:`.json` 纯流程图路径不动;Agent 绑定/规则/自定义工具不可移植,v1 列入 `unresolved` 显式提示,不导出本体。

## 5. 验证机制(三段)

1. **导出即验证**:graph zod 校验 → 引用解析(技能可打包/MCP 可收集/缺失依赖入 `unresolved`)→ 技能完整性(SKILL.md 存在 + sha256)→ 结果写 manifest.verification。
2. **导入预览**:解压即校验 checksums + schema,失败拒收;依赖预览页列出将装技能/待激活 MCP(标注需补密钥)/待绑定项,确认后才写库。
3. **落地复验**:包详情页「验证此包」——技能可加载、MCP 可启动并列工具、流程图结构可执行;结果回写 `verification_status`(✅/⚠️/❌)。

## 6. 实施步骤

1. ✅ 分支与隔离 worktree(本分支)。
2. 协议层:`packages/protocol/src/workflow-bundle.ts`(zod schema)+ `packages/desktop-db`(或对应 db 包)迁移:新表 + 2 列。
3. 导出服务(main 进程 service)+ IPC `workflow-bundle:export`。
4. 导入服务 + IPC `workflow-bundle:preview` / `workflow-bundle:import`。
5. 验证服务 + `runtime-composition` 回落排除 + 验证状态回写。
6. UI:导出模式选择、导入对话框支持 `.sparkflow`、工作流包管理分组页。
7. 聚焦单测 + `pnpm typecheck` / `lint` / `test:unit` + 手工双 profile 验证隔离性。

## 7. 影响面说明

- GitNexus MCP 本会话不可用,以常规代码检索做等效影响面分析(已覆盖:WorkflowView 导入导出路径、skills 存储与 ID 规则、mcp_servers 生命周期、runtime-composition 回落、protocol schema 先例)。
- 向后兼容:不新增第三方依赖(zip 复用 Node 内置/仓库已有压缩路径;如不满足再评估并说明);旧 `.json` 行为不变;MCP 激活是显式动作,不自动生效。

## 8. 进度记录

- 2026-09-05:方案确认,创建分支与 worktree,本文档建立,依赖安装中。
- 2026-09-05:全部落地。协议层(zod schema + IPC 通道)、迁移 093(workflow_bundles 表 + workflows/mcp_servers.bundle_id)、导出/导入/验证服务(agent-runtime services/workflow-bundle/)、防污染回落(bundle: 前缀排除)、UI(导入下拉 + 导出格式二选一 + 包管理抽屉)。
- 验证:protocol/agent-runtime/storage/desktop 四包 tsc 通过;lint 0 error;单测 protocol 337、storage 287、agent-runtime 相关 33(含全流程 6 例与回落隔离 2 例)全部通过;文件尺寸门禁 WorkflowView.tsx 净减 87 行(2159→2072)。
- 已知限制(v1):宿主链接技能(_links)仅顶层 realpath 跟随;试运行(testRun)报告未做;MCP oauth 授权凭据不随包(需导入方重新授权)。
