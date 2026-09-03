/**
 * @spark/storage 单元测试
 *
 * 测试数据库初始化、migration、基础 CRUD 操作
 * 使用内存数据库（:memory:）避免文件系统依赖
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from './database.js'
import { BaseRepository } from './repository.js'
import { CustomToolRepository } from './repositories/custom-tool.repository.js'
import { join } from 'path'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

function applyMigrationsThrough(
  db: SparkDatabase,
  migrationsDir: string,
  maxVersion: number,
): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const insertMigration = db.raw.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
  )
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  for (const name of files) {
    const version = Number.parseInt(name, 10)
    if (!Number.isFinite(version) || version > maxVersion) continue
    db.raw.exec(readFileSync(join(migrationsDir, name), 'utf8'))
    insertMigration.run(version, name)
  }
}

describe('SparkDatabase', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    // 每个测试使用独立的临时目录
    testDir = join(tmpdir(), `spark-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (db != null) {
      db.close()
    }
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should open database and enable WAL mode', () => {
    const dbPath = join(testDir, 'test.db')
    db = new SparkDatabase(dbPath)

    const result = db.raw.pragma('journal_mode', { simple: true }) as string
    expect(result).toBe('wal')

    db.close()
  })

  it('should run migrations from specified directory', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    // 验证 schema_migrations 表中有记录
    const rows = db.raw.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as {
      count: number
    }
    expect(rows.count).toBeGreaterThanOrEqual(1)

    // 验证核心表已创建
    const tables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>

    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('workspaces')
    expect(tableNames).toContain('sessions')
    expect(tableNames).toContain('agent_events')
    expect(tableNames).toContain('provider_profiles')
    expect(tableNames).toContain('model_profiles')
    expect(tableNames).toContain('usage_ledger')
    expect(tableNames).toContain('rules')
    expect(tableNames).toContain('mcp_servers')
    expect(tableNames).toContain('skills')
    expect(tableNames).toContain('workflows')
    expect(tableNames).toContain('slash_commands')
    expect(tableNames).toContain('resource_samples')
    expect(tableNames).toContain('media_model_manifests')
    expect(tableNames).toContain('media_provider_models')
    expect(tableNames).toContain('media_generation_tasks')

    const canvasAssistant = db.raw
      .prepare('SELECT name, built_in, enabled, skill_ids_json, prompt FROM agents WHERE id = ?')
      .get('canvas-assistant-agent') as
      | {
          name: string
          built_in: number
          enabled: number
          skill_ids_json: string
          prompt: string
        }
      | undefined
    expect(canvasAssistant?.name).toBe('画布助手')
    expect(canvasAssistant?.built_in).toBe(1)
    expect(canvasAssistant?.enabled).toBe(1)
    expect(JSON.parse(canvasAssistant?.skill_ids_json ?? '[]')).toEqual([
      'builtin:platform-manager',
      'builtin:canvas-studio',
      'builtin:multimedia-use',
    ])
    expect(canvasAssistant?.prompt).toContain('canvas_get_available_actions')
    expect(canvasAssistant?.prompt).toContain('canvas_get_production_plan')
    expect(canvasAssistant?.prompt).toContain('默认只创建并配置操作节点')

    const sparkAssistant = db.raw
      .prepare(
        'SELECT name, description, permission_mode, reasoning_effort, skill_ids_json, prompt FROM agents WHERE id = ?',
      )
      .get('platform-manager-agent') as
      | {
          name: string
          description: string
          permission_mode: string
          reasoning_effort: string
          skill_ids_json: string
          prompt: string
        }
      | undefined
    expect(sparkAssistant?.name).toBe('Spark助手')
    expect(sparkAssistant?.description).toContain('平台管理、全栈开发')
    expect(sparkAssistant?.permission_mode).toBe('claude-auto-edits')
    expect(sparkAssistant?.reasoning_effort).toBe('high')
    expect(JSON.parse(sparkAssistant?.skill_ids_json ?? '[]')).toEqual(
      expect.arrayContaining([
        'builtin:platform-manager',
        'builtin:browser-use',
        'builtin:commit',
        'builtin:react',
        'builtin:spark-debug',
      ]),
    )
    expect(sparkAssistant?.prompt).toContain('平台管理与全栈开发能力')
    expect(sparkAssistant?.prompt).toContain('用户默认只能看到最后一段最终正文')
    expect(sparkAssistant?.prompt).toContain('该回复块必须携带完整答复')

    const removedFullstackAgent = db.raw
      .prepare('SELECT id FROM agents WHERE id = ?')
      .get('93785cf1-d570-4a2a-8919-108fbf7f39c3')
    expect(removedFullstackAgent).toBeUndefined()
  })

  it('should migrate fullstack agent references into Spark助手', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')
    const oldAgentId = '93785cf1-d570-4a2a-8919-108fbf7f39c3'

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 61)

    db.raw
      .prepare(
        `UPDATE agents
         SET prompt = 'custom fullstack prompt',
             disabled_skill_ids_json = '["builtin:spark-debug"]',
             hook_config_json = '{"enabled":true}'
         WHERE id = ?`,
      )
      .run(oldAgentId)

    db.raw
      .prepare(
        `INSERT INTO sessions (id, kind, title, status, project_id, agent_id, metadata_json)
         VALUES ('merge-session', 'chat', 'merge', 'idle', 'default', ?, ?)`,
      )
      .run(
        oldAgentId,
        JSON.stringify({
          team: {
            hostAgentId: oldAgentId,
            memberAgentIds: [oldAgentId, 'platform-manager-agent'],
          },
        }),
      )
    db.raw
      .prepare(
        `INSERT INTO scheduled_tasks (id, name, agent_id, prompt_template)
         VALUES ('merge-task', 'merge', ?, 'test')`,
      )
      .run(oldAgentId)
    db.raw
      .prepare(
        `INSERT INTO agent_teams (
           id, name, host_agent_id, member_agent_ids_json, created_at, updated_at
         ) VALUES ('merge-team', 'merge', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(oldAgentId, JSON.stringify([oldAgentId, 'platform-manager-agent']))
    db.raw
      .prepare(
        `INSERT INTO rules (id, scope, scope_ref, name, content)
         VALUES ('merge-rule', 'agent', ?, 'merge', 'test')`,
      )
      .run(oldAgentId)
    db.raw
      .prepare(
        `INSERT INTO app_settings (category, key, value)
         VALUES ('runtime.prompts', ?, '{"enabled":true,"content":"legacy"}')`,
      )
      .run(`agent:${oldAgentId}`)
    db.raw
      .prepare(
        `INSERT INTO app_settings (category, key, value)
         VALUES ('runtime.prompts', 'agent:platform-manager-agent', '{"enabled":true,"content":"base"}')`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO app_settings (category, key, value)
         VALUES ('runtime.skills', ?, '["skill:legacy"]')`,
      )
      .run(`agent:${oldAgentId}`)
    db.raw
      .prepare(
        `INSERT INTO app_settings (category, key, value)
         VALUES ('runtime.skills', 'agent:platform-manager-agent', '["skill:base"]')`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO workflows (id, scope, name, version, graph_json)
         VALUES ('merge-workflow', 'project', 'merge', '1.0.0', ?)`,
      )
      .run(JSON.stringify({ nodes: [{ config: { agentId: oldAgentId } }] }))
    db.raw
      .prepare(
        `INSERT INTO memory_entry (
           id, scope, scope_ref, type, name, description, file_path,
           confidence, archived, created_at, updated_at
         ) VALUES (?, 'agent', ?, 'feedback', 'shared-name', 'test', ?, 1, 0, 1, 1)`,
      )
      .run('memory-base', 'platform-manager-agent', '/tmp/memory-base.md')
    db.raw
      .prepare(
        `INSERT INTO memory_entry (
           id, scope, scope_ref, type, name, description, file_path,
           confidence, archived, created_at, updated_at
         ) VALUES (?, 'agent', ?, 'feedback', 'shared-name', 'test', ?, 1, 0, 1, 1)`,
      )
      .run('memory-legacy', oldAgentId, '/tmp/memory-legacy.md')
    db.raw
      .prepare(
        `INSERT INTO memory_entity (id, scope, scope_ref, name, normalized_name, created_at)
         VALUES ('entity-base', 'agent', 'platform-manager-agent', 'Shared', 'shared', 1),
                ('entity-legacy', 'agent', ?, 'Shared', 'shared', 1)`,
      )
      .run(oldAgentId)
    db.raw
      .prepare(
        `INSERT INTO memory_entity_link (memory_id, entity_id)
         VALUES ('memory-legacy', 'entity-legacy')`,
      )
      .run()

    db.runMigrations(migrationsDir)

    expect(
      (
        db.raw.prepare("SELECT agent_id FROM sessions WHERE id = 'merge-session'").get() as {
          agent_id: string
        }
      ).agent_id,
    ).toBe('platform-manager-agent')
    const sessionMetadata = db.raw
      .prepare("SELECT metadata_json FROM sessions WHERE id = 'merge-session'")
      .get() as { metadata_json: string }
    expect(JSON.parse(sessionMetadata.metadata_json).team).toEqual({
      hostAgentId: 'platform-manager-agent',
      memberAgentIds: ['platform-manager-agent'],
    })
    expect(
      (
        db.raw.prepare("SELECT agent_id FROM scheduled_tasks WHERE id = 'merge-task'").get() as {
          agent_id: string
        }
      ).agent_id,
    ).toBe('platform-manager-agent')
    const team = db.raw
      .prepare(
        "SELECT host_agent_id, member_agent_ids_json FROM agent_teams WHERE id = 'merge-team'",
      )
      .get() as { host_agent_id: string; member_agent_ids_json: string }
    expect(team.host_agent_id).toBe('platform-manager-agent')
    expect(JSON.parse(team.member_agent_ids_json)).toEqual(['platform-manager-agent'])
    expect(
      (
        db.raw.prepare("SELECT scope_ref FROM rules WHERE id = 'merge-rule'").get() as {
          scope_ref: string
        }
      ).scope_ref,
    ).toBe('platform-manager-agent')
    expect(
      db.raw
        .prepare("SELECT value FROM app_settings WHERE category = 'runtime.prompts' AND key = ?")
        .get('agent:platform-manager-agent'),
    ).toBeDefined()
    const mergedPromptLayer = db.raw
      .prepare("SELECT value FROM app_settings WHERE category = 'runtime.prompts' AND key = ?")
      .get('agent:platform-manager-agent') as { value: string }
    expect(JSON.parse(mergedPromptLayer.value)).toEqual({
      enabled: true,
      content: 'base\n\n[原全栈编码助手补充]\nlegacy',
    })
    const mergedSkillLayer = db.raw
      .prepare("SELECT value FROM app_settings WHERE category = 'runtime.skills' AND key = ?")
      .get('agent:platform-manager-agent') as { value: string }
    expect(JSON.parse(mergedSkillLayer.value)).toEqual(
      expect.arrayContaining(['skill:base', 'skill:legacy']),
    )
    const mergedAgent = db.raw
      .prepare('SELECT disabled_skill_ids_json, metadata_json FROM agents WHERE id = ?')
      .get('platform-manager-agent') as {
      disabled_skill_ids_json: string
      metadata_json: string
    }
    expect(JSON.parse(mergedAgent.disabled_skill_ids_json)).toContain('builtin:spark-debug')
    expect(JSON.parse(mergedAgent.metadata_json).mergedFullstackConfig).toEqual(
      expect.objectContaining({
        prompt: 'custom fullstack prompt',
        hookConfig: { enabled: true },
      }),
    )
    const mergedMemories = db.raw
      .prepare(
        `SELECT id, name FROM memory_entry
         WHERE scope = 'agent' AND scope_ref = 'platform-manager-agent'
         ORDER BY id`,
      )
      .all() as Array<{ id: string; name: string }>
    expect(mergedMemories).toHaveLength(2)
    expect(mergedMemories.find((item) => item.id === 'memory-legacy')?.name).toContain(
      '原全栈编码助手',
    )
    expect(
      db.raw
        .prepare(
          `SELECT 1 FROM memory_entity_link
           WHERE memory_id = 'memory-legacy' AND entity_id = 'entity-base'`,
        )
        .get(),
    ).toBeDefined()
    expect(
      (
        db.raw.prepare("SELECT graph_json FROM workflows WHERE id = 'merge-workflow'").get() as {
          graph_json: string
        }
      ).graph_json,
    ).toContain('platform-manager-agent')
  })

  it('should add the complete final-response reminder without replacing custom prompt content', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 86)
    db.raw
      .prepare("UPDATE agents SET prompt = prompt || '\n\n用户自定义补充' WHERE id = ?")
      .run('platform-manager-agent')

    db.runMigrations(migrationsDir)

    const { prompt } = db.raw
      .prepare('SELECT prompt FROM agents WHERE id = ?')
      .get('platform-manager-agent') as { prompt: string }
    expect(prompt).toContain('用户自定义补充')
    expect(prompt).toContain('用户默认只能看到最后一段最终正文')
    expect(prompt).toContain('该回复块必须携带完整答复')
    expect(prompt.match(/用户默认只能看到最后一段最终正文/g)).toHaveLength(1)
  })

  it('should preserve v88 custom tools and traces when upgrading to Tool Studio', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')
    const createdAt = '2026-08-30T00:00:00.000Z'
    const draft = {
      id: 'legacy_http_tool',
      title: '旧版 HTTP 工具',
      description: '验证旧版本自定义工具可以无损升级到 Tool Studio',
      type: 'http' as const,
      inputSchema: { type: 'object' as const, properties: {} },
      risk: 'read' as const,
      effect: 'read' as const,
      idempotency: 'safe' as const,
      timeoutMs: 30_000,
      spec: {
        request: { method: 'GET' as const, urlTemplate: 'https://api.example.com/items' },
        response: { format: 'json' as const },
      },
    }

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 88)
    db.raw
      .prepare(
        `INSERT INTO custom_tools
           (id, title, description, type, input_schema_json, spec_json,
            risk, effect, idempotency, timeout_ms, enabled, origin,
            last_test_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        draft.id,
        draft.title,
        draft.description,
        draft.type,
        JSON.stringify(draft.inputSchema),
        JSON.stringify({ spec: draft.spec }),
        draft.risk,
        draft.effect,
        draft.idempotency,
        draft.timeoutMs,
        1,
        'local',
        createdAt,
        createdAt,
      )
    db.raw
      .prepare(
        `INSERT INTO custom_tool_invocations
           (tool_id, session_id, turn_id, input_sha256, status, duration_ms,
            error_code, output_bytes, created_at)
         VALUES (?, ?, ?, ?, 'ok', 12, NULL, 24, ?)`,
      )
      .run(draft.id, 'session-1', 'turn-1', 'a'.repeat(64), createdAt)

    db.runMigrations(migrationsDir)
    const repository = new CustomToolRepository(db)
    repository.ensureVersionHistory()

    expect(repository.get(draft.id)).toMatchObject({
      ...draft,
      enabled: true,
      publishedVersion: 1,
      draftVersion: 1,
    })
    expect(repository.listVersions(draft.id)).toEqual([
      expect.objectContaining({ version: 1, status: 'published' }),
    ])
    expect(repository.listInvocations({ toolId: draft.id })).toEqual([
      expect.objectContaining({ source: 'model', toolVersion: null, status: 'ok' }),
    ])
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO custom_tools
             (id, title, description, type, input_schema_json, spec_json,
              risk, effect, idempotency, timeout_ms, enabled, origin,
              published_version, draft_version, last_test_at, created_at, updated_at)
           VALUES (?, ?, ?, 'code', '{}', ?, 'read', 'read', 'safe', 5000, 0,
                   'local', NULL, 1, NULL, ?, ?)`,
        )
        .run(
          'native_code_tool',
          '原生代码工具',
          '验证 v89 的 type CHECK 接受 code',
          JSON.stringify({
            spec: {
              runtime: {
                kind: 'trusted-worker',
                language: 'typescript',
                source: 'export default async function(input) { return input }',
                entryExport: 'default',
              },
              permissions: { toolIds: [] },
              limits: { memoryMb: 64, maxOutputBytes: 65_536 },
              trust: 'trusted-local',
            },
          }),
          createdAt,
          createdAt,
        ),
    ).not.toThrow()
  })

  it('should not re-apply already applied migrations', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    // 记录当前 migration 数量
    const countBefore = (
      db.raw.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number }
    ).count

    // 再次运行 migration，不应增加记录
    db.runMigrations(migrationsDir)

    const countAfter = (
      db.raw.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number }
    ).count

    expect(countAfter).toBe(countBefore)
  })

  it('should upgrade legacy usage ledger schema when applying migration 11', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 10)

    db.runMigrations(migrationsDir)

    const columns = db.raw.prepare('PRAGMA table_info(usage_ledger)').all() as Array<{
      name: string
    }>
    const columnNames = columns.map((column) => column.name)

    expect(columnNames).toContain('model_id')
    expect(columnNames).toContain('input_tokens')
    expect(columnNames).toContain('output_tokens')
    expect(columnNames).toContain('request_timestamp')
  })

  it('should mark session metadata migration applied when the column already exists', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 17)
    db.raw.exec("ALTER TABLE sessions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")

    db.runMigrations(migrationsDir)

    const applied = db.raw
      .prepare('SELECT name FROM schema_migrations WHERE version = 18')
      .get() as { name: string } | undefined
    expect(applied?.name).toBe('018_add_session_metadata_json.sql')
  })

  it('should complete agent event performance migration when one generated column already exists', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 47)
    db.raw.exec(`
      ALTER TABLE agent_events
        ADD COLUMN seq INTEGER
        GENERATED ALWAYS AS (CAST(json_extract(event_json, '$.seq') AS INTEGER)) VIRTUAL
    `)

    db.runMigrations(migrationsDir)

    const columns = db.raw.prepare('PRAGMA table_xinfo(agent_events)').all() as Array<{
      name: string
    }>
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('seq')
    expect(columnNames).toContain('event_mode')

    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'agent_events'")
      .all() as Array<{ name: string }>
    const indexNames = indexes.map((index) => index.name)
    expect(indexNames).toContain('idx_agent_events_session_seq')
    expect(indexNames).toContain('idx_agent_events_session_turn_seq')
    expect(indexNames).toContain('idx_agent_events_session_type_mode_seq')

    const applied = db.raw
      .prepare('SELECT name FROM schema_migrations WHERE version = 48')
      .get() as { name: string } | undefined
    expect(applied?.name).toBe('048_agent_event_query_performance.sql')
  })

  it('should upgrade legacy agent teams with discussion settings defaults', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 45)
    db.raw.exec(`
      INSERT INTO agent_teams (
        id, name, description, host_agent_id, member_agent_ids_json,
        max_depth, allow_nesting, prompt, metadata_json, created_at, updated_at
      ) VALUES (
        'legacy-team', 'Legacy Team', '', 'dev-agent', '["qa-agent"]',
        1, 0, '', '{}', datetime('now'), datetime('now')
      );
    `)

    db.runMigrations(migrationsDir)

    const columns = db.raw.prepare('PRAGMA table_info(agent_teams)').all() as Array<{
      name: string
    }>
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('max_discussion_rounds')
    expect(columnNames).toContain('enable_peer_messaging')

    const row = db.raw
      .prepare('SELECT max_discussion_rounds, enable_peer_messaging FROM agent_teams WHERE id = ?')
      .get('legacy-team') as {
      max_discussion_rounds: number
      enable_peer_messaging: number
    }
    expect(row.max_discussion_rounds).toBe(6)
    expect(row.enable_peer_messaging).toBe(0)
  })

  it('should upgrade historical media polling defaults without overwriting explicit values', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 54)
    const insertProvider = db.raw.prepare(`
      INSERT INTO provider_profiles (id, provider_type, name, config_json)
      VALUES (?, 'openai', ?, ?)
    `)
    insertProvider.run(
      'video-short',
      'Video short',
      JSON.stringify({
        modelType: 'video',
        mediaDefaults: { polling: { intervalMs: 5000, timeoutMs: 600000 } },
      }),
    )
    insertProvider.run(
      'video-long',
      'Video long',
      JSON.stringify({
        mediaCapabilities: ['video.generate'],
        mediaDefaults: { polling: { timeoutMs: 172800000 } },
      }),
    )
    insertProvider.run(
      'image-short',
      'Image short',
      JSON.stringify({
        modelType: 'image',
        mediaDefaults: { polling: { timeoutMs: 240000 } },
      }),
    )
    insertProvider.run(
      'image-explicit',
      'Image explicit',
      JSON.stringify({
        modelType: 'image',
        mediaDefaults: { polling: { timeoutMs: 300000 } },
      }),
    )
    db.raw
      .prepare(
        `
      INSERT INTO media_model_manifests (
        id, provider_kind, model_id, display_name, manifest_json
      ) VALUES (?, 'custom', ?, ?, ?)
    `,
      )
      .run(
        'custom:video',
        'video',
        'Video',
        JSON.stringify({
          domains: ['video'],
          invocation: { mode: 'async_polling', polling: { timeoutMs: 600000 } },
        }),
      )
    db.raw
      .prepare(
        `
      INSERT INTO media_model_manifests (
        id, provider_kind, model_id, display_name, manifest_json
      ) VALUES (?, 'custom', ?, ?, ?)
    `,
      )
      .run(
        'custom:image',
        'image',
        'Image',
        JSON.stringify({
          domains: ['image'],
          invocation: { mode: 'async_polling', polling: { timeoutMs: 240000 } },
        }),
      )

    db.runMigrations(migrationsDir)

    const providerTimeout = (id: string): number =>
      (
        db.raw
          .prepare(
            `
        SELECT json_extract(config_json, '$.mediaDefaults.polling.timeoutMs') AS timeout
        FROM provider_profiles WHERE id = ?
      `,
          )
          .get(id) as { timeout: number }
      ).timeout
    expect(providerTimeout('video-short')).toBe(172_800_000)
    expect(providerTimeout('video-long')).toBe(172_800_000)
    expect(providerTimeout('image-short')).toBe(600_000)
    expect(providerTimeout('image-explicit')).toBe(300_000)

    const manifest = db.raw
      .prepare(
        `
      SELECT json_extract(manifest_json, '$.invocation.polling.timeoutMs') AS timeout
      FROM media_model_manifests WHERE id = 'custom:video'
    `,
      )
      .get() as { timeout: number }
    expect(manifest.timeout).toBe(172_800_000)
    const imageManifest = db.raw
      .prepare(
        `
      SELECT json_extract(manifest_json, '$.invocation.polling.timeoutMs') AS timeout
      FROM media_model_manifests WHERE id = 'custom:image'
    `,
      )
      .get() as { timeout: number }
    expect(imageManifest.timeout).toBe(600_000)
  })

  it('should copy legacy media polling timeouts into provider interface timeouts', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 59)
    const insertProvider = db.raw.prepare(`
      INSERT INTO provider_profiles (id, provider_type, name, config_json)
      VALUES (?, 'openai', ?, ?)
    `)
    insertProvider.run(
      'legacy-timeout',
      'Legacy timeout',
      JSON.stringify({ mediaDefaults: { polling: { intervalMs: 5000, timeoutMs: 600000 } } }),
    )
    insertProvider.run(
      'new-timeout',
      'New timeout',
      JSON.stringify({
        mediaDefaults: {
          timeoutMs: 6000000,
          polling: { intervalMs: 5000, timeoutMs: 600000 },
        },
      }),
    )
    insertProvider.run(
      'invalid-timeout',
      'Invalid timeout',
      JSON.stringify({ mediaDefaults: { polling: { timeoutMs: 500 } } }),
    )

    db.runMigrations(migrationsDir)

    const timeout = (id: string, path: string): number | null =>
      (
        db.raw
          .prepare(
            `SELECT json_extract(config_json, ?) AS timeout FROM provider_profiles WHERE id = ?`,
          )
          .get(path, id) as { timeout: number | null }
      ).timeout
    expect(timeout('legacy-timeout', '$.mediaDefaults.timeoutMs')).toBe(600_000)
    expect(timeout('legacy-timeout', '$.mediaDefaults.polling.timeoutMs')).toBe(600_000)
    expect(timeout('new-timeout', '$.mediaDefaults.timeoutMs')).toBe(6_000_000)
    expect(timeout('invalid-timeout', '$.mediaDefaults.timeoutMs')).toBeNull()
  })

  it('should throw error for invalid migration filename', () => {
    const dbPath = join(testDir, 'test.db')
    const invalidDir = join(testDir, 'migrations')

    mkdirSync(invalidDir, { recursive: true })

    // 创建一个不符合命名规范的 migration 文件
    writeFileSync(join(invalidDir, 'invalid_no_number.sql'), 'SELECT 1;')

    db = new SparkDatabase(dbPath)

    expect(() => db.runMigrations(invalidDir)).toThrow('Invalid migration filename')
  })

  it('should throw when two migrations share the same version number', () => {
    const dbPath = join(testDir, 'test.db')
    const dupDir = join(testDir, 'migrations')

    mkdirSync(dupDir, { recursive: true })
    // 两个文件撞号（都是 028）——历史上这会导致后者被静默跳过
    writeFileSync(join(dupDir, '028_first.sql'), 'CREATE TABLE a (id TEXT);')
    writeFileSync(join(dupDir, '028_second.sql'), 'CREATE TABLE b (id TEXT);')

    db = new SparkDatabase(dbPath)

    expect(() => db.runMigrations(dupDir)).toThrow(/Duplicate migration version 28/)
  })
})

describe('BaseRepository', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-repo-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')
    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should perform basic CRUD operations', () => {
    // 创建一个简单的 test repository，暴露 protected 方法用于测试
    class TestWorkspaceRepo extends BaseRepository {
      constructor(db: SparkDatabase) {
        super(db, 'workspaces')
      }

      insert(id: string, name: string, rootPath: string): void {
        this.raw
          .prepare(
            `INSERT INTO workspaces (id, name, root_path, spark_config_path, agent_runtime_path, project_kind)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(id, name, rootPath, `${rootPath}/.spark`, `${rootPath}/.agent_spark`, 'generic')
      }

      // 将 protected 方法暴露为 public，用于测试
      get(id: string) {
        return this.findById(id)
      }
      getAll() {
        return this.findAll()
      }
      getCount() {
        return this.count()
      }
      remove(id: string) {
        return this.deleteById(id)
      }
    }

    const repo = new TestWorkspaceRepo(db)

    // Create
    repo.insert('ws-1', 'test-project', '/tmp/test')
    repo.insert('ws-2', 'another-project', '/tmp/another')

    // Read by ID
    const ws = repo.get('ws-1')
    expect(ws).not.toBeNull()
    expect((ws as Record<string, unknown>)['name']).toBe('test-project')

    // Read all
    const all = repo.getAll()
    expect(all).toHaveLength(2)

    // Count
    expect(repo.getCount()).toBe(2)

    // Delete
    expect(repo.remove('ws-1')).toBe(true)
    expect(repo.getCount()).toBe(1)
    expect(repo.get('ws-1')).toBeNull()
  })
})
