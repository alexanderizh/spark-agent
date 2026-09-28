-- Migration 112: wiki 核心 8 表（AI-Native 知识库 / Wiki，S0）
--
-- 方案：docs/spark-work开发相关/plans/2026-09-29-AI-Native知识库Wiki功能落地方案.md §5.1。
-- 分层映射（WikiSkill 三层）：Raw=既有会话轨迹（wiki_source 轻量关联，不重复存储）；
-- Wiki=wiki_page + 空间/目录/双链/版本；Skills=既有 skills 表（wiki_skill_proposal 提议，S3）。
--
-- 设计要点：
--   - scope='team' 只保留枚举值（v1.3 决定首期不建团队功能，无 UI/权限/共享）。
--   - space_type 区分 manual（知识库 Tab）/ repo（Repo Wiki Tab，可重建），共享同一套表。
--   - wiki_page.version 为 CAS 乐观锁；content_hash 为正文 SHA-256 守卫（对齐 memory S1B.1）。
--   - wiki_fts 为 contentless FTS5（content='' + contentless_delete=1），rowid 与
--     wiki_page 隐式 rowid 对齐；写入前必须过 segmentCjk()（JS 侧 CJK 逐字预分词），
--     查询侧用 buildFtsMatchQuery()。存量回填由代码侧 backfillFtsIfNeeded() 完成，
--     以 app_settings(wiki / ftsBackfillDone) 标记幂等。
--   - 索引语义：归档空间释放唯一名槽位（WHERE archived = 0 部分索引）；
--     归档页面释放 slug 槽位（WHERE status != 'archived'）。
--   - 候选确认制（S2 用，表先建齐）：content_digest 确认绑定，decided_via 仅
--     'user_ipc'——模型自称确认结构性无效（对齐 memory_candidate 109）。
--
-- 存量数据：全部空表起步，无回填。
--
-- 索引注意：SQLite 唯一索引对 NULL 的语义是"NULL 互不相等"，user scope 的
-- scope_ref 为 NULL 时 (scope, scope_ref, space_type, name) 唯一索引不生效。
-- 因此唯一名索引用 COALESCE(scope_ref, '') 表达式索引；slug 唯一索引不受
-- 影响（slug 非空）。

CREATE TABLE IF NOT EXISTS wiki_space (
  id            TEXT PRIMARY KEY,             -- wsp_<8hex>
  scope         TEXT NOT NULL CHECK(scope IN ('user','project','agent','team')),
  scope_ref     TEXT,                         -- workspace_id / agent_id / team_id；user 为 NULL
  space_type    TEXT NOT NULL DEFAULT 'manual' CHECK(space_type IN ('manual','repo')),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  icon          TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  repo_path     TEXT,                         -- space_type='repo'：关联仓库路径
  repo_rev      TEXT,                         -- space_type='repo'：生成时代码版本（漂移检测）
  created_by    TEXT,                         -- 'user' | agent_id
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wiki_space_name
  ON wiki_space(scope, COALESCE(scope_ref, ''), space_type, name) WHERE archived = 0;
CREATE INDEX IF NOT EXISTS idx_wiki_space_scope
  ON wiki_space(scope, scope_ref, space_type, archived);

CREATE TABLE IF NOT EXISTS wiki_page (
  id            TEXT PRIMARY KEY,             -- wp_<8hex>
  space_id      TEXT NOT NULL,
  parent_id     TEXT,                         -- 目录树父节点，NULL 为根
  kind          TEXT NOT NULL CHECK(kind IN ('knowledge','experience','pattern','reference','note')),
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL,                -- 空间内唯一，[[双链]] 解析键
  summary       TEXT NOT NULL DEFAULT '',     -- 检索与卡片展示（落库侧 ≤240 字）
  file_path     TEXT NOT NULL,                -- 正文 markdown 绝对路径
  tags_json     TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  confidence    REAL NOT NULL DEFAULT 1.0,
  version       INTEGER NOT NULL DEFAULT 1,   -- CAS 乐观锁
  content_hash  TEXT,                         -- 正文 SHA-256（读取守卫）
  sort_order    INTEGER NOT NULL DEFAULT 0,
  source_type   TEXT,                         -- 'manual' | 'extraction' | 'import' | 'skill'
  source_session_id TEXT,
  author_role   TEXT,                         -- 'manual_user' | 'extraction' | 'import' | 'agent'
  hit_count     INTEGER NOT NULL DEFAULT 0,
  last_hit_at   INTEGER,
  valid_from    INTEGER,
  invalid_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wiki_page_slug
  ON wiki_page(space_id, slug) WHERE status != 'archived';
CREATE INDEX IF NOT EXISTS idx_wiki_page_space ON wiki_page(space_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_wiki_page_parent ON wiki_page(parent_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_kind ON wiki_page(space_id, kind, status);

-- contentless FTS5：正文写入前经 segmentCjk() 预分词（同 memory_fts / 042 范式）。
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
  title, summary, body,
  content='', contentless_delete=1, tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS wiki_link (
  id          TEXT PRIMARY KEY,               -- wlnk_<8hex>
  space_id    TEXT NOT NULL,
  from_page   TEXT NOT NULL,
  to_page     TEXT,                           -- 被链页未创建时 NULL（"红链"）
  to_title    TEXT NOT NULL,                  -- 原始 [[标题]]
  link_type   TEXT NOT NULL DEFAULT 'wiki' CHECK(link_type IN ('wiki','reference')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wiki_link_from ON wiki_link(from_page);
CREATE INDEX IF NOT EXISTS idx_wiki_link_to ON wiki_link(to_page);
CREATE INDEX IF NOT EXISTS idx_wiki_link_title ON wiki_link(space_id, to_title);

CREATE TABLE IF NOT EXISTS wiki_revision (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     TEXT NOT NULL,
  version     INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  body_snapshot_path TEXT,                    -- 旧正文快照（受控命名空间，可枚举清理）
  change_kind TEXT NOT NULL DEFAULT 'edit',   -- 'create' | 'edit' | 'restore' | 'delete'
  change_note TEXT,
  actor       TEXT,                           -- 'user' | agent_id
  created_at  INTEGER NOT NULL
);
-- 版本记录幂等锚点：同 (page_id, version) 重复写入（重试路径）由唯一约束兜底。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wiki_rev_page ON wiki_revision(page_id, version);
CREATE INDEX IF NOT EXISTS idx_wiki_rev_page ON wiki_revision(page_id, version DESC);

-- 溯源 → Raw Layer：无来源不入库（每条候选/页面绑定 session + turn + 摘录片段）。
CREATE TABLE IF NOT EXISTS wiki_source (
  page_id     TEXT NOT NULL,
  session_id  TEXT,
  turn_index  INTEGER,
  tool_call_id TEXT,
  excerpt     TEXT,                           -- 抽取依据的最小片段（不复制整段轨迹）
  created_at  INTEGER NOT NULL,
  PRIMARY KEY(page_id, session_id, turn_index, tool_call_id)
);

CREATE TABLE IF NOT EXISTS wiki_candidate (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,
  scope_ref     TEXT,
  space_id      TEXT,                         -- 目标空间（NULL = 确认时选择/新建）
  kind          TEXT NOT NULL,
  content_digest TEXT NOT NULL,               -- 展示内容 SHA-256（确认绑定）
  payload_json  TEXT NOT NULL,                -- 提议全文（确认时原文落库）
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','confirmed','rejected','expired')),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_via   TEXT,                         -- 仅 'user_ipc'（可信界面）
  page_id       TEXT,                         -- 确认晋级创建的页面 id
  confirmed_digest TEXT
);
CREATE INDEX IF NOT EXISTS idx_wikicand_pending
  ON wiki_candidate(scope, scope_ref, status, created_at);
CREATE INDEX IF NOT EXISTS idx_wikicand_digest
  ON wiki_candidate(scope, scope_ref, content_digest);

CREATE TABLE IF NOT EXISTS wiki_skill_proposal (
  id            TEXT PRIMARY KEY,             -- wskp_<8hex>
  scope         TEXT NOT NULL,
  scope_ref     TEXT,
  name          TEXT NOT NULL,
  purpose       TEXT NOT NULL,                -- PURPOSE.md 内容（为何创建/解决哪个 pattern）
  skill_draft_json TEXT NOT NULL,             -- SKILL.md 草稿 + 元数据
  source_page_ids_json TEXT NOT NULL,         -- 溯源：来自哪些 wiki_page
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','accepted','rejected','superseded')),
  reject_reason TEXT,                         -- 被拒原因（知识保留，供下一轮避免重蹈）
  skill_id      TEXT,                         -- 接受后生成的 skills.id
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wikiskp_status ON wiki_skill_proposal(scope, scope_ref, status);
