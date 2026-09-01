import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ensureSessionWorkspaceRootPath,
  NO_PROJECT_WORKSPACE_NAME,
  resolveSessionWorkspaceRootPath,
} from '../../services/session-workspace-root.js'

describe('session workspace root', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
  })

  it('isolates no-project sessions under directories named by session id', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'spark-no-project-'))
    temporaryRoots.push(rootPath)
    const workspace = { name: NO_PROJECT_WORKSPACE_NAME, root_path: rootPath }

    const first = await ensureSessionWorkspaceRootPath(workspace, 'session-1')
    const second = await ensureSessionWorkspaceRootPath(workspace, 'session-2')

    expect(first).toBe(path.join(rootPath, 'session-1'))
    expect(second).toBe(path.join(rootPath, 'session-2'))
    expect(first).not.toBe(second)
    expect((await stat(first)).isDirectory()).toBe(true)
    expect((await stat(second)).isDirectory()).toBe(true)
  })

  it('keeps project sessions on the existing workspace root', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'spark-project-'))
    temporaryRoots.push(rootPath)

    await expect(
      ensureSessionWorkspaceRootPath({ name: 'Spark Agent', root_path: rootPath }, 'session-1'),
    ).resolves.toBe(rootPath)
  })

  it('rejects session ids that could escape the no-project directory', () => {
    expect(() =>
      resolveSessionWorkspaceRootPath(
        { name: NO_PROJECT_WORKSPACE_NAME, root_path: '/tmp/no-project' },
        '../another-session',
      ),
    ).toThrow('Invalid session id for workspace directory')
  })
})
