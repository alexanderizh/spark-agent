-- 043: Memory V2 — 实体关联图（memory_entity + memory_entity_link）
--
-- 让"找到一条记忆后顺藤摸瓜拉出关联记忆"成为可能（search 一跳实体扩展）。
-- 实体从抽取 prompt 的 entities 字段获得（人名/库名/模块名/系统名），
-- 写入时规范化（lowercase + trim + 常见别名映射）后按 (scope, scope_ref, normalized_name) 去重。
--
-- memory_entity_link 是 memory_entry ↔ memory_entity 的多对多边（替换 V1 死数据 links 字段）。
-- 检索时：命中 entry → 取其 entity_id 集合 → 反查同 entity 的其他 entry（一跳扩展）。

CREATE TABLE IF NOT EXISTS memory_entity (
  id              TEXT PRIMARY KEY,             -- ent_<8hex>
  scope           TEXT NOT NULL CHECK(scope IN ('user','project','agent')),
  scope_ref       TEXT,                          -- user 层为 NULL；与 memory_entry.scope_ref 同义
  name            TEXT NOT NULL,                 -- 原始写法（展示用）
  normalized_name TEXT NOT NULL,                 -- 规范化键（lowercase + trim + 别名映射）
  created_at      INTEGER NOT NULL
);

-- 同 scope 下规范化名唯一（不同写法"Arco"/"arco design"归一行）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mem_entity
  ON memory_entity(scope, scope_ref, normalized_name);

CREATE TABLE IF NOT EXISTS memory_entity_link (
  memory_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY(memory_id, entity_id)
);

-- 反查：给定实体，找共享该实体的所有记忆（一跳扩展）
CREATE INDEX IF NOT EXISTS idx_mem_entity_link_entity
  ON memory_entity_link(entity_id);
