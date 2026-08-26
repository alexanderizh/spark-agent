# 存储占用优化清单(2026-08-27 排查)

> 状态: 实施中 | 最后核对: 2026-08-27

## 进度

- ✅ P0-1 更新器缓存清理 — 已落地:`services/updaterCache.ts`(纯函数,保留最近 2 个版本目录)+ `UpdateService.initialize` 启动时接入;单测 `updaterCache.test.ts`。
- ✅ P0-2 迁移备份保留策略 — 已落地:`DatabaseBackupService` 默认保留 2 份 + 14 天上限 + 超过 24h 的 `.tmp-` 残留回收,同版本快照复用路径也会触发清理;单测 `DatabaseBackupService.test.ts`。子项「改用 SQLite backup API」暂缓:备份发生在 DB 打开前、无写入者,裸拷贝 db+wal+shm 即崩溃一致,待与在线恢复方案(todo/桌面端数据库实例隔离与安全恢复计划)一并改造。
- ✅ P0-3 画布快照保留策略 — 已落地:`services/CanvasSnapshotRetention.ts`(保存后每项目保留最近 10 份时间戳快照 + **退出编辑时收紧到 2 份**,latest.json 永不删);保存路径接入 `writeCanvasProjectPackageFiles`,退出路径经 `CanvasWindowService.onProjectExited`(窗口关闭/切换项目)由 ipc 层收紧;单测覆盖两个保留档位与退出钩子。
- ⬜ P0-4 agent_events TTL、P0-5 媒体任务 base64 落盘、P1-6/7/8、P2-9~12 — 待开发。

## 背景

用户实测:`~/Library/Application Support/@spark` 占用 43G(应用),`Spark-Agent` 项目目录占用 35.2G。排查确认八类数据"只增不删",缺少统一的存储配额、按龄清理和孤儿回收机制。本次已做一次性手工清理(合计释放约 56G),本清单为代码层修复项。

## P0 — 直接造成几十 G 级累积的缺陷

### 1. 更新器永久保留所有历史版本安装包(11G/38 个版本)【已落地】

- 位置:`apps/desktop/src/main/services/UpdateService.ts:704`(每版本一个子目录存完整 DMG)、`resolveCachedDownloadPath` L1081-1090
- 修复:安装成功/校验完成后,删除 `updaterCacheDirName` 下除当前版本外的所有子目录;启动时顺带做一次孤儿版本回收。建议同时加 3 天 × 2 个版本的上限。

### 2. 每次迁移全量备份 DB,保留 5 份(11.5G),且 .tmp 残留永不回收

- 位置:`apps/desktop/src/main/services/DatabaseBackupService.ts`
  - `pruneDatabaseBackups()` L116-127 默认保留 5 份全量(单份 ~2.3G),只按数量不按天数;
  - L120 候选过滤 `!entry.name.includes('.tmp-')` 把崩溃残留的临时目录排除在清理之外(实测残留 `pre-migration-v0.8.5.tmp-48766` 达 2.1G);
  - L74-79 用裸 `copyFile` 复制 db+wal+shm,非 SQLite online backup(`todo/桌面端数据库实例隔离与安全恢复计划.md` L56-61 已要求改)。
- 修复:
  - maxBackups 降为 2 + 增加天数上限(如 14 天);
  - prune 纳入 `.tmp-` 目录(按 mtime 超过 24h 即删);
  - 改用 SQLite backup API 或 `VACUUM INTO` 产出一致快照。

### 3. 画布自动保存每次写全量时间戳快照,无保留上限(3.4G/4,582 个文件)

- 位置:`apps/desktop/src/main/ipc/index.ts:1008-1048`(`writeCanvasProjectPackageFiles` 在每次 `canvas:snapshot:save` 时追加 `${stamp}.json`)
- 修复:快照保留策略(如每项目最近 10 份 + 距今 7 天内每天 1 份);或在启动后台维护中做按项目修剪。本次手工清理为"每项目保留 3 份",线上应把该逻辑产品化。

### 4. `agent_events` 无 TTL,工具结果全文/截图 base64 原样入库(1.59G + 270M 索引)

- 位置:
  - 写入:`packages/agent-runtime/src/services/session-event-sequencer.ts:112-126`(`JSON.stringify(event)` 无截断);
  - 维护:`apps/desktop/src/main/workers/background-maintenance.worker.ts:24-37` 只清 delta 和 30 天前 terminal turn_requests,无 agent_events 按龄清理;
  - 手动瘦身:`packages/storage/src/repositories/event.repository.ts:680-732` 仅在设置页手动触发。
- 实测构成:`tool_result` 604M(bash 59,835 条 431M、read_file 15,887 条 96M)、`terminal_output` 355M、base64 事件 4,867 条 201M。
- 修复:
  - 写入侧:超长 `tool_result.output` 截断落盘(大输出转文件,事件里只存引用),截图 base64 一律走文件 + 路径引用;
  - 留存侧:后台维护加"90 天前的非会话头尾事件裁剪"(保留 turn 结构,删 payload),定期 `PRAGMA incremental_vacuum`。

### 5. 媒体任务把输入图片 base64 内联进 SQLite(513M,其中 509M 在 `input_files_json`)

- 位置:`packages/agent-runtime/src/services/media/media-task-runtime.service.ts:168`;schema:`packages/storage/migrations/029_media_generation_tasks.sql`;`media-generation-task.repository.ts` 无任何 DELETE。
- 修复:输入文件落盘到任务工作目录,行内只存路径/哈希;补 failed/finished 任务的 retention(如保留 14 天)。

## P1 — 成倍复制与无限增长

### 6. 视频处理链路每次操作产出新 UUID 副本,不清理

- 位置:`apps/desktop/src/main/services/videoProcessHandler.ts:121-123`(`makeOutputPath` → `.spark-artifacts/media/video-workbench/<uuid>.mp4`)、`scaleCompress` L373-438;渲染端 `canvas.api.ts` `materializeVideoScaleCompress`(注释明示"原节点保留")。commit 94cb0ab7 的百分比转码同模式。
- 修复:删除媒体节点时删除底层文件(引用计数);`.spark-artifacts` 产物目录纳入启动清理(未被任何节点引用的孤儿文件,超过 N 天删除);考虑"转码前原图若被新节点替代且无其他引用则删"。

### 7. 浏览器 profileId 无限创建持久 Partition(2.3G/41 个)

- 位置:`apps/desktop/src/main/services/InternalBrowserService.ts:42,188-196`(`persist:spark-browser:` 前缀,`validateProfileId` 不限数量)。
- 修复:任务式临时 profile(如 `media-evidence-*`)用 session 分区而非 persist;启动时列出 Partition 目录,不在 profile 列表中的按最后访问时间回收;设置页加"清理浏览器数据"入口。

### 8. 历史孤儿一次性回收(约 5.4G,建议做启动迁移清理)

- `spark-dev.db`(440M):`packages/shared/src/constants/index.ts:15` 的 `DB_FILENAME_DEV` 已是死常量,建议删除常量 + 启动时发现孤儿 `spark-dev.db` 提示删除;
- `spark-agent-dev-updater`(257M)与 `desktop-test/desktop1/desktopx` 目录:启动时检测 userData 兄弟目录中的历史残留,设置页提供一键清理;
- `spark.db.before-*.bak`/`spark.db.bak-*`(3.1G):本次为手工残留,无代码创建;上述清理入口应覆盖该 glob。

## P2 — 工程规范

9. **.gitignore 补充**:`docs/marketing/` 视频工程(未跟踪但未忽略,曾累积 3.4G)与 `apps/desktop/native/**/target/` 建议加入 ignore,防止再次混入。
10. **worktree 用后即删**:本次清理掉 4 个已合并 worktree(约 11G)。约定发布冒烟 worktree 放 `/tmp` 且脚本退出时 `git worktree remove`。
11. **pnpm store 全局化**:项目内 `.pnpm-store` 曾累积 14G,现已切回全局 `~/Library/pnpm/store`;不要在项目 `.npmrc` 配置本地 store-dir。
12. **设置页存储看板**:把备份/更新缓存/快照/事件库/媒体产物/Partition 各目录的占用与一键清理做成"存储与备份"页的可视化分区(现有页仅有事件瘦身+VACUUM)。

## 本次已执行的一次性清理(2026-08-27)

| 对象 | 前 → 后 | 动作 |
|---|---|---|
| `@spark` 应用数据 | 43G → 14G | 删 4 份旧迁移备份+2 个 .tmp 残留、37 个旧版本 DMG、2 个手工 .bak、spark-dev.db、dev updater、desktop-test/1/x 目录;快照每项目留 3 份(5G→1.7G) |
| `Spark-Agent` 项目 | 35.2G → 8.1G | 删 4 个已合并 worktree(11G)、.pnpm-store(14G,store 已全局化)、native target(2.7G)、.spark-agent/recovery-backups(2.3G);marketing 旧版 v1/v3/prototype 移入废纸篓(2.3G) |

保留未动:`spark.db`(用户会话数据)、`Partitions`(含登录态)、`desktop-dev`(现役开发实例)、`Cache/Code Cache`(应用运行中)、`.gitnexus`(代码索引)。
