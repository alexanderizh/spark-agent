import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase, WorkspaceRepository } from '@spark/storage'

import { SessionService } from '../../services/session.service.js'
import { NO_PROJECT_WORKSPACE_NAME } from '../../services/session-workspace-root.js'

describe('SessionService no-project work directory', () => {
  let database: SparkDatabase
  let testRoot: string

  beforeEach(() => {
    testRoot = mkdtempSync(path.join(tmpdir(), 'spark-session-workdir-'))
    database = new SparkDatabase(path.join(testRoot, 'test.db'))
    database.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))
  })

  afterEach(() => {
    database.close()
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('creates a session-id child directory for a no-project session only', async () => {
    const workspaceRepository = new WorkspaceRepository(database)
    const noProjectRoot = path.join(testRoot, 'no-project')
    const projectRoot = path.join(testRoot, 'project')
    const noProject = workspaceRepository.create({
      id: 'workspace-no-project',
      name: NO_PROJECT_WORKSPACE_NAME,
      rootPath: noProjectRoot,
    })
    const project = workspaceRepository.create({
      id: 'workspace-project',
      name: 'Spark Agent',
      rootPath: projectRoot,
    })
    const service = new SessionService(database, () => {})

    const temporarySession = await service.createSession({
      providerProfileId: 'provider-test',
      workspaceId: noProject.id,
    })
    const projectSession = await service.createSession({
      providerProfileId: 'provider-test',
      workspaceId: project.id,
    })

    const temporarySessionRoot = path.join(noProjectRoot, temporarySession.sessionId)
    expect(statSync(temporarySessionRoot).isDirectory()).toBe(true)
    expect(existsSync(path.join(projectRoot, projectSession.sessionId))).toBe(false)
  })
})
