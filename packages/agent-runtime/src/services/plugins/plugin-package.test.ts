import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectPluginDirectory, installPluginDirectoryAtomic } from './plugin-package.js'

const roots: string[] = []

async function fixture(manifest: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'spark-plugin-test-'))
  roots.push(root)
  await mkdir(join(root, 'skills', 'demo'), { recursive: true })
  await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), '# Demo\n', 'utf8')
  await writeFile(join(root, 'plugin.json'), JSON.stringify(manifest), 'utf8')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('plugin package validation', () => {
  it('validates a declarative plugin and computes a stable digest', async () => {
    const manifest = {
      schemaVersion: 1,
      id: 'acme.demo',
      version: '1.0.0',
      displayName: 'Demo',
      description: 'A test plugin',
      author: { name: 'Acme' },
      permissions: { required: ['network'], optional: [] },
      activation: 'manual',
      contributions: {
        skills: [{ id: 'demo', path: 'skills/demo' }],
        mcpServers: [],
        connectors: [],
      },
    }
    const first = await inspectPluginDirectory(await fixture(manifest))
    const second = await inspectPluginDirectory(first.sourcePath)
    expect(first.manifest.id).toBe('acme.demo')
    expect(first.packageSha256).toBe(second.packageSha256)
    expect(first.requiredPermissions).toEqual([{ permission: 'network', risk: 'medium' }])
  })

  it('rejects path traversal and symlinks', async () => {
    const root = await fixture({
      schemaVersion: 1,
      id: 'acme.escape',
      version: '1.0.0',
      displayName: 'Escape',
      description: 'Invalid',
      author: { name: 'Acme' },
      permissions: { required: [], optional: [] },
      activation: 'manual',
      contributions: {
        skills: [{ id: 'demo', path: '../outside' }],
        mcpServers: [],
        connectors: [],
      },
    })
    await expect(inspectPluginDirectory(root)).rejects.toThrow()

    const safeRoot = await fixture({
      schemaVersion: 1,
      id: 'acme.link',
      version: '1.0.0',
      displayName: 'Link',
      description: 'Invalid',
      author: { name: 'Acme' },
      permissions: { required: [], optional: [] },
      activation: 'manual',
      contributions: {
        skills: [{ id: 'demo', path: 'skills/demo' }],
        mcpServers: [],
        connectors: [],
      },
    })
    await symlink(join(safeRoot, 'plugin.json'), join(safeRoot, 'linked.txt')).catch(
      () => undefined,
    )
    await expect(inspectPluginDirectory(safeRoot)).rejects.toThrow(/symbolic links/)
  })

  it('installs a package through an atomic managed directory', async () => {
    const source = await fixture({
      schemaVersion: 1,
      id: 'acme.atomic',
      version: '1.0.0',
      displayName: 'Atomic',
      description: 'Atomic',
      author: { name: 'Acme' },
      permissions: { required: [], optional: [] },
      activation: 'manual',
      contributions: {
        skills: [{ id: 'demo', path: 'skills/demo' }],
        mcpServers: [],
        connectors: [],
      },
    })
    const destination = await mkdtemp(join(tmpdir(), 'spark-plugin-dest-'))
    roots.push(destination)
    const installed = await installPluginDirectoryAtomic(source, destination, 'acme.atomic')
    expect(await readFile(join(installed, 'plugin.json'), 'utf8')).toContain('acme.atomic')
  })
})
