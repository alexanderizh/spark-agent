import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase } from '../database.js'
import { ModelProfileRepository } from './model-profile.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('ModelProfileRepository', () => {
  let db: SparkDatabase
  let repo: ModelProfileRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-model-profile-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repo = new ModelProfileRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('stores routing model cards in config_json without schema changes', () => {
    const config = {
      kind: 'router',
      adapter: 'codex',
      candidates: {
        simple: { providerProfileId: 'provider-cheap', modelId: 'small-coder' },
        default: { providerProfileId: 'provider-main', modelId: 'main-coder' },
        complex: { providerProfileId: 'provider-strong', modelId: 'strong-coder' },
      },
    }

    const created = repo.create({
      providerId: 'codex-auto-router',
      name: 'Auto Codex',
      configJson: JSON.stringify(config),
    })

    const found = repo.getById(created.id)
    expect(found?.provider_id).toBe('codex-auto-router')
    expect(found?.name).toBe('Auto Codex')
    expect(JSON.parse(found?.config_json ?? '{}')).toEqual(config)
  })

  it('updates and disables routing model cards', () => {
    const created = repo.create({
      providerId: 'claude-auto-router',
      name: 'Auto Claude',
      configJson: JSON.stringify({
        kind: 'router',
        adapter: 'claude',
        candidates: {
          default: { providerProfileId: 'anthropic-main', modelId: 'claude-sonnet' },
        },
      }),
    })

    const updated = repo.update(created.id, {
      name: 'Auto Claude Quality',
      enabled: false,
      configJson: JSON.stringify({
        kind: 'router',
        adapter: 'claude',
        candidates: {
          default: { providerProfileId: 'anthropic-main', modelId: 'claude-sonnet' },
          complex: { providerProfileId: 'anthropic-strong', modelId: 'claude-opus' },
        },
      }),
    })

    expect(updated?.name).toBe('Auto Claude Quality')
    expect(updated?.enabled).toBe(0)
    expect(JSON.parse(updated?.config_json ?? '{}').candidates.complex).toEqual({
      providerProfileId: 'anthropic-strong',
      modelId: 'claude-opus',
    })
  })
})
