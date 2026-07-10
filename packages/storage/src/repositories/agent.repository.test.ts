import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase } from '../database.js'
import { AgentRepository } from './agent.repository.js'

describe('AgentRepository reasoning effort', () => {
  let db: SparkDatabase
  let repo: AgentRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-agent-reasoning-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new AgentRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('preserves every Spark reasoning effort and normalizes unknown stored values', () => {
    const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

    for (const effort of efforts) {
      repo.create({ id: `agent-${effort}`, name: effort, reasoningEffort: effort })
      expect(repo.get(`agent-${effort}`)?.reasoningEffort).toBe(effort)
    }

    repo.create({ id: 'agent-legacy', name: 'legacy', reasoningEffort: 'unknown' })
    expect(repo.get('agent-legacy')?.reasoningEffort).toBe('max')
  })
})
