/**
 * @module migrations
 *
 * Migration 文件索引
 *
 * 当新增 migration 时，只需在 packages/storage/migrations/ 目录下
 * 添加新的 {序号}_{描述}.sql 文件即可，无需修改此文件。
 *
 * Migration runner 会自动扫描 migrations 目录并按序号顺序执行。
 * 已执行的 migration 通过 schema_migrations 表跟踪，不会重复执行。
 *
 * 命名约定：
 *   001_initial_schema.sql      — 核心表结构
 *   002_xxx.sql                 — 后续 migration...
 */
