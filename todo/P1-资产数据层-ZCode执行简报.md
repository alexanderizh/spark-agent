# P1 资产数据层 — ZCode 执行简报

> 任务状态: 待执行 | 执行端: ZCode | 调度与验收: Spark助手 | 下发日期: 2026-08-29

**唯一设计事实源**：`todo/步骤模式与资产库全面改造设计.md`（先通读第 2.1 / 4.3 / 4.4 / 7 节，本简报与设计文档冲突时以设计文档为准）。

## 任务范围（只做数据层，不动 UI）

在画布渲染端新建资产数据层模块，并修复 4 项既有缺陷。**本阶段不替换、不重构任何 UI 组件**（`CanvasFilmAssetCenter` / `CanvasAssetManagerPanel` 的替换是 P2 的事），只在既有调用点上做最小侵入的缺陷修复。

### 交付物 1：`canvas/assetLibrary/` 新模块

位置：`apps/desktop/src/renderer/design/views/canvas/assetLibrary/`，按职责拆多文件（类型 / Repository 接口 / 快照实现），单文件不超 800 行：

1. **`FilmAssetPayload` 判别联合 + 类型守卫**（设计文档 4.3 的定义原样落地）：`character | scene | prop | effect | manuscript/chapter/script/prompt_library/shot_group(raw)` 五分支，配套 `parseFilmAssetPayload(metadata): FilmAssetPayload | null` 守卫，未知 kind 回落 raw 分支，不得抛错。
2. **`AssetRepository` 接口 + 一期实现**：`list / get / upsert / batchDelete / addReference / removeReference / recordGenerationOrigin`，签名见设计文档 4.3。一期实现基于现有内存快照 db（`readDb()/writeDb()` + 防抖 flush，参考 `canvasRuntimeSnapshotPersist.ts` 的既有模式），**所有资产读写逐步收口到 Repository**，为未来抽表演进留缝。
3. **`AssetListQuery / AssetPage / BatchDeleteResult` 支撑类型**：分页 + 筛选（kind / type / 关键词 / 收藏）。

### 交付物 2：四项缺陷修复（设计文档 4.4）

| #   | 缺陷                                             | 修复要求                                                                                                                | 锚点                                                                                                        |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | 引用计数：统计含 `hidden` 软删节点、删节点不回收 | `referencesByAsset` 统计过滤 `hidden`；`deleteNodes` 软删时调用 `removeReference` 回收                                  | `CanvasAssetManagerPanel.tsx`（统计处）、`canvas.tools.ts`（删节点链路，已有 `canvasNodeDeletion.test.ts`） |
| 2   | AI 生成资产缺 Provider 元数据 → 文件清理泄漏     | `applyMediaTaskResult` 落库时强制写 `metadata.providerProfileId / fileId / originTaskId`（已有值不覆盖）                | `canvas.store.ts`（已有 `canvasMediaOutputIntegrity.test.ts`）                                              |
| 3   | `storageKey` 绝对/相对不统一                     | 新写入一律存相对 key（相对 `project.rootPath`）；读取端兼容绝对路径历史数据（归一 helper + 双端兼容）                   | 写入散点自行检索 `storageKey`                                                                               |
| 4   | 批量删除 N+1 串行                                | 一次遍历收集全部文件清理请求后**单次 IPC** 发出；删除走 `batchDelete`（已有 `CanvasProjectDetail.batchDelete.test.ts`） | `CanvasWorkspaceView.tsx` / `canvas.tools.ts` 的 `deleteFilmAsset` 调用链                                   |

## 硬性约束

- **向后兼容第一**：`metadata.kind` 既有散读必须继续工作；`FilmAssetPayload` 是收窄读取层，不是破坏性替换；存量项目快照不做任何迁移。
- **不动 UI 形态**：两个既有资产 UI 的布局、交互、视觉零变化（缺陷修复引起的行为变化除外：引用数变准、批删变快、AI 资产可被正确清理）。
- **工作树有并行改动**：`git status` 已有多处他人修改（main 进程 / media 服务 / CanvasInspector 等），只碰本任务相关文件；**不要 stage / commit**，改完留在工作区由验收方处理。
- TypeScript strict：不新增 `any`、不新增依赖、单文件 < 3000 行（新模块建议 < 800 行/文件）。
- `CanvasWorkspaceView.tsx` 已 9262 行：插入调用点保持最小 diff，**不趁机重构该文件**；新逻辑一律放 `assetLibrary/` 模块内。

## 验收标准（验收方逐条核对）

1. `assetLibrary/` 模块导出 `FilmAssetPayload` 判别联合 + 守卫 + `AssetRepository` 接口与实现，无 `any`。
2. 引用统计过滤 `hidden`、删节点回收引用——`canvasNodeDeletion.test.ts` 补断言并通过。
3. AI 生成资产 metadata 三字段补齐——`canvasMediaOutputIntegrity.test.ts` 补断言并通过。
4. `storageKey` 新写相对、读兼容绝对。
5. 批删单次 IPC，`CanvasProjectDetail.batchDelete.test.ts` 通过。
6. 项目 typecheck 通过（`apps/desktop` 对应命令）。
7. 既有资产库 UI 手动冒烟无回归（由用户真机确认）。

## 完成后

在仓库根输出简短交付说明（改了哪些文件、每项缺陷的修法一句话、跑了哪些验证及结果），不写 commit。
