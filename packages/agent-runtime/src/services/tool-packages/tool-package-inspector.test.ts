import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectToolPackageDirectory,
  installToolPackageDirectoryAtomic,
} from './tool-package-inspector.js'

const roots: string[] = []

async function fixture(overrides: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-tool-package-'))
  roots.push(root)
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'main.js'), 'process.stdin.resume()\n', 'utf8')
  await writeFile(
    join(root, 'spark-tool.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'Productivity Suite',
      description: 'Neutral package fixture',
      runtime: {
        adapter: 'process',
        protocol: 'spark-tool-process-v1',
        command: './dist/main.js',
        args: [],
        lifecycle: 'persistent',
      },
      tools: [
        {
          name: 'generate_report',
          title: 'Generate report',
          description: 'Generate a report',
          inputSchema: { type: 'object', properties: {} },
          risk: 'read',
          effect: 'read',
          idempotency: 'safe',
        },
      ],
      environment: [],
      permissions: {
        declaredOsEffects: ['filesystem.read'],
        requiredSparkCapabilities: ['files.read'],
        optionalSparkCapabilities: [],
      },
      ...overrides,
    }),
    'utf8',
  )
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('tool package inspection', () => {
  it('validates without executing package code and computes a stable digest', async () => {
    const marker = join(tmpdir(), `spark-tool-marker-${Date.now()}`)
    const root = await fixture()
    await writeFile(
      join(root, 'dist', 'main.js'),
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`,
      'utf8',
    )
    const first = await inspectToolPackageDirectory(root)
    const second = await inspectToolPackageDirectory(root)
    expect(first.integritySha256).toBe(second.integritySha256)
    expect(first.manifest.tools[0]?.name).toBe('generate_report')
    await expect(readFile(marker, 'utf8')).rejects.toThrow()
  })

  it('rejects symlinks, traversal and missing relative commands', async () => {
    const root = await fixture()
    await symlink(join(root, 'dist', 'main.js'), join(root, 'linked.js'))
    await expect(inspectToolPackageDirectory(root)).rejects.toThrow(/symbolic links/)

    const missing = await fixture({
      runtime: {
        adapter: 'process',
        protocol: 'spark-tool-process-v1',
        command: './dist/missing.js',
      },
    })
    await expect(inspectToolPackageDirectory(missing)).rejects.toThrow(/does not exist/)
  })

  it('rejects a package root that is itself a symbolic link', async () => {
    const source = await fixture()
    const linkedRoot = join(tmpdir(), `spark-tool-linked-${Date.now()}`)
    roots.push(linkedRoot)
    await symlink(source, linkedRoot)
    await expect(inspectToolPackageDirectory(linkedRoot)).rejects.toThrow(/symbolic link/)
  })

  it('rejects an oversized manifest before reading it into the main process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-tool-package-large-manifest-'))
    roots.push(root)
    await writeFile(
      join(root, 'spark-tool.json'),
      JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) }),
      'utf8',
    )

    await expect(inspectToolPackageDirectory(root)).rejects.toThrow(/4 MB manifest limit/)
  })

  it('installs immutable versions atomically and rejects content conflicts', async () => {
    const source = await fixture()
    const destination = await mkdtemp(join(tmpdir(), 'spark-tool-installed-'))
    roots.push(destination)
    const first = await installToolPackageDirectoryAtomic(source, destination)
    const second = await installToolPackageDirectoryAtomic(source, destination)
    expect(second.installPath).toBe(first.installPath)
    expect(await readFile(join(first.installPath, 'spark-tool.json'), 'utf8')).toContain(
      'acme.productivity-suite',
    )

    await writeFile(join(source, 'dist', 'main.js'), 'changed\n', 'utf8')
    await expect(installToolPackageDirectoryAtomic(source, destination)).rejects.toThrow(
      /different content/,
    )
  })
})
