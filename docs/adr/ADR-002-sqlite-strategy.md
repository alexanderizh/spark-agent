# ADR-002: SQLite 技术选型与使用策略

- **状态**: 已接受 (Accepted)
- **日期**: 2026-05-26
- **决策者**: 子涵-架构师
- **关联任务**: P0-06

---

## 背景

Spark Agent 需要本地持久化存储：会话历史、事件流、Provider 配置引用、Usage 统计、Workspace 元数据等。

## 决策

**使用 `better-sqlite3` + 手写 SQL migration，不使用 ORM。**

### 理由

| 评估维度 | `better-sqlite3` | `@databases/sqlite` | Drizzle ORM | Prisma |
|---------|-----------------|---------------------|------------|--------|
| API 风格 | 同步 | 异步 | ORM 抽象 | ORM 抽象 |
| Electron 兼容性 | ✅ 极好 | ⚠️ 偶有问题 | 依赖底层 | 复杂 |
| 性能 | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ |
| 代码复杂度 | 低 | 中 | 中 | 高 |
| Schema 迁移 | 手写 | 手写/库 | 自动 | 自动 |

**选择理由**：
1. Electron 主进程是单线程事件循环，同步 SQLite 不会产生阻塞问题（对话数据写入 < 1ms）
2. PRD 已设计好完整 SQL Schema，用 ORM 反而是额外翻译成本
3. `better-sqlite3` 社区成熟，electron-builder 对其的 rebuild 支持完善
4. MVP 阶段追求代码简单和可调试性，手写 SQL 更直观

### WAL 模式

```typescript
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('temp_store = MEMORY')
db.pragma('mmap_size = 268435456') // 256MB
```

WAL 模式允许读写并发（Renderer 通过 IPC 查询时，主进程写入不阻塞），对 Agent 事件流高频写入场景有明显优势。

### Migration 策略

采用简单的版本号递增策略：

```
packages/storage/migrations/
  001_initial_schema.sql
  002_add_usage_ledger.sql
  003_add_workflow.sql
  ...
```

Migration runner 在应用启动时自动执行未应用的 migration（通过 `schema_migrations` 表跟踪版本）。

## 约束

- `packages/storage` 是唯一合法的数据库访问入口
- 所有 SQL 通过 prepared statement 执行，禁止字符串拼接 SQL
- 数据库文件路径：`{app.getPath('userData')}/spark.db`
- 开发环境：`{app.getPath('userData')}/spark-dev.db`（通过 `NODE_ENV` 区分）

## 后续

- P0-06 实现 `packages/storage` 的完整骨架
- P1-03 实现 Session/Event 相关的 Repository
