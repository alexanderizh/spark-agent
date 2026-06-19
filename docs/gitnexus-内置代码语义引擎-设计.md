# 内置 GitNexus 代码语义引擎 —— 设计文档

> 状态: 待开发（Phase 0 spike 已完成，架构已定，待 @ladybugdb 预编译确认后进入 Phase 1） | 最后核对: 2026-06-19
>
> 关联演进计划：[演进计划-桌面助手与无限画布.md](./演进计划-桌面助手与无限画布.md) §2「代码库语义理解」
> 复用范式：`apps/desktop/src/main/services/PlaywrightMcpRegistration.ts`（managed MCP）、[runtime-readiness-and-context.md](./runtime-readiness-and-context.md)（Electron-as-Node，不依赖宿主机 Node）

---

## 1. 目标与约束

让桌面助手 Agent 获得**代码库语义理解**能力（符号 / 调用图 / 影响面 / 执行流），追赶 Cursor 的 `@codebase`。

**硬约束（用户决策）**：
- 索引引擎用 **GitNexus**。
- **不依赖用户宿主机环境**（不调用系统 Node / npm / npx / 编译工具链）。
- **首次使用时按需下载**引擎到用户数据目录，**基础安装包不内置**（避免 +400~500MB 体积翻倍）。

## 2. Phase 0 Spike 结论（2026-06-19）

| 验证项 | 结果 |
|---|---|
| GitNexus 形态 | npm 包 `gitnexus@1.6.7`，bin `dist/cli/index.js`，含 MCP server（`@modelcontextprotocol/sdk`） |
| 体积 | 本体 ~123MB；`onnxruntime-node` ~266MB（embedding）；合计 ~400-500MB → **故选按需下载** |
| embedding 是否可分离 | `run.cjs` 将 `onnxruntime-node` 单列为 EMBEDDINGS 组 → **MVP 可不启用 embedding**（符号/调用图/impact 不需要向量） |
| tree-sitter 系 | `install: node-gyp-build` + `build: prebuildify --napi` → **N-API 预编译**，跨 Node/Electron ABI 稳定 ✅ |
| onnxruntime-node | 自带平台预编译，N-API；MVP 不启用 |
| @ladybugdb/core | `node-addon-api`(N-API ✅) + `cmake-js` + `install: node install.js` → **唯一待确认**：install.js 是下载预编译还是现场 cmake 编译 |

**关键结论**：因核心原生模块是 **N-API 预编译**，下载标准 npm 包即可在打包的 **Electron-as-Node** 下直接运行，**无需按 Electron ABI 重编译**。这使"按需下载、不依赖宿主机"在工程上可行。

**Phase 0 收尾待办**：实际拉取 `@ladybugdb/core`，确认 `install.js` 走预编译下载；若是 cmake 现场编译，则改为从 ladybug release CDN 取该平台预编译二进制（其余模块不受影响）。

## 3. 架构总览

```mermaid
graph TB
    subgraph Main["Main 进程"]
        EM["GitNexusEngineManager<br/>探测 / 下载 / 校验 / 解析路径"]
        REG["GitNexusMcpRegistration<br/>(仿 Playwright)"]
        AN["AnalyzeOrchestrator<br/>项目打开后台建索引"]
    end
    subgraph Data["用户数据目录"]
        ENG[("engines/gitnexus/&lt;version&gt;/<br/>下载的引擎 + N-API 预编译")]
        IDX[("&lt;project&gt;/.gitnexus/<br/>索引产物")]
    end
    EM -->|首次使用按需下载| ENG
    REG -->|stdio: execPath + ELECTRON_RUN_AS_NODE<br/>args=[engineCli, mcp, --project root]| ENG
    AN -->|execPath 跑 analyze| ENG
    AN --> IDX
    REG -->|managed MCP 行 enabled| AGENT["Agent 自动获得<br/>impact/query/context/detect_changes"]
```

## 4. 引擎按需下载（GitNexusEngineManager）

**职责**：`isInstalled(version)` / `install(onProgress)` / `resolveCliPath()` / `currentVersion()`。

**下载策略（不依赖宿主机 npm）**：
- 用应用打包的 Electron-as-Node 执行下载逻辑（Node 内置 https，无需系统 Node）。
- 从 npm registry 拉取 `gitnexus` 及其依赖的 tarball，解包到 `userData/engines/gitnexus/<version>/`，仅保留当前平台所需的 N-API 预编译。
- embedding 组（onnxruntime-node / transformers）**MVP 不下载**，留可选开关。
- 校验：版本锁定 + 完整性校验；失败可重试；离线时给明确提示。

**存储布局**：
```text
<userData>/engines/gitnexus/
  1.6.7/
    node_modules/gitnexus/dist/cli/index.js   # 引擎入口
    node_modules/...                          # 仅当前平台 N-API 预编译
  current -> 1.6.7
```

## 5. MCP 注册（GitNexusMcpRegistration）

仿 `PlaywrightMcpRegistration`，新增 managed MCP 行 `scope=managed, name=gitnexus`：

```ts
{
  type: 'stdio',
  command: process.execPath,                 // 打包的 Electron
  args: [engineCli, 'mcp', '--project', projectRoot],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}
```

- 仅在引擎已下载 + 项目已索引时 enabled，否则保持 disabled 并提示去"启用代码智能"。
- agent-runtime 新增常量 `GITNEXUS_MCP_NAME`（与 `PLAYWRIGHT_MCP_NAME` 并列）。
- Agent 自动发现 `mcp__gitnexus__*` 工具（impact / query / context / detect_changes）。

## 6. 自动索引（AnalyzeOrchestrator）

- 打开 git 项目时，若引擎就绪则后台跑 `gitnexus analyze`（Electron-as-Node），产出 `<project>/.gitnexus/`。
- 重 CPU → 后台 + 进度事件 + 可取消；完成后启用 gitnexus MCP。
- 陈旧检测 / 增量重建（复用 GitNexus 自身的 detect_changes / 增量能力）。
- `.gitnexus/` 体积可观（本仓库 lbug 106MB）→ 纳入清理策略 + `.gitignore` 提示。

## 7. UX 显性化

- **首次使用**：点"启用代码智能" → 下载进度条（"正在准备代码智能引擎…"）→ 首次 analyze 进度。
- **索引状态**：项目信息面板显示索引版本/新鲜度/符号数，提供"重建索引"。
- **Phase 3**：`@codebase` / `@symbol` 引用、编辑前影响面提示卡。

## 8. 分阶段

| 阶段 | 内容 | 退出标准 |
|---|---|---|
| **0** | spike（本文档）+ @ladybugdb 预编译确认 | 确认按需下载可行 |
| **1** | EngineManager（下载/解析）+ GitNexusMcpRegistration + 常量 | Agent 在已索引项目能用 gitnexus 工具 |
| **2** | AnalyzeOrchestrator 项目打开自动索引 + 进度/取消 + 陈旧检测 | 开箱即用 |
| **3** | UI：启用入口、索引状态面板、`@codebase` 引用、影响面提示 | 体验追上 Cursor |
| **可选** | embedding 组按需启用（语义向量检索） | 高级语义检索 |

## 9. 风险登记

| 风险 | 缓解 |
|---|---|
| @ladybugdb install.js 现场编译 | 改为从 ladybug release CDN 取平台预编译；其余模块 N-API 预编译不受影响 |
| 下载源/网络/离线 | 版本锁定 + 校验 + 重试 + 离线明确提示；可配置镜像源 |
| 索引产物体积大 | 清理策略 + 仅索引必要语言 + `.gitignore` |
| analyze CPU 重 | 后台化 + 进度 + 可取消 + 增量 |
| 跨平台预编译缺失 | 启动前探测平台支持矩阵，不支持则禁用并提示 |
