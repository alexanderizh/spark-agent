import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

  it('rejects escaping and broken symlinks, traversal and missing relative commands', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'spark-tool-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'outside payload', 'utf8')
    const escaping = await fixture()
    await symlink(join(outside, 'secret.txt'), join(escaping, 'dist', 'escape.js'))
    await expect(inspectToolPackageDirectory(escaping)).rejects.toThrow(/escapes the package root/)

    const broken = await fixture()
    await symlink(join(broken, 'dist', 'gone.js'), join(broken, 'dist', 'dangling.js'))
    await expect(inspectToolPackageDirectory(broken)).rejects.toThrow(/broken symbolic link/)

    const looped = await fixture()
    await mkdir(join(looped, 'dist', 'cycle'), { recursive: true })
    await symlink(join(looped, 'dist'), join(looped, 'dist', 'cycle', 'back'))
    await expect(inspectToolPackageDirectory(looped)).rejects.toThrow(/symlink loop/)

    const missing = await fixture({
      runtime: {
        adapter: 'process',
        protocol: 'spark-tool-process-v1',
        command: './dist/missing.js',
      },
    })
    await expect(inspectToolPackageDirectory(missing)).rejects.toThrow(/does not exist/)
  })

  it('materializes in-package symlinks (npm .bin / pnpm layouts) as real files', async () => {
    const root = await fixture()
    // npm install 后 node_modules/.bin 里是指向包内脚本的符号链接。
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'qrcode'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'qrcode', 'cli.js'), '#!/usr/bin/env node\n', 'utf8')
    await symlink(
      join(root, 'node_modules', 'qrcode', 'cli.js'),
      join(root, 'node_modules', '.bin', 'qrcode'),
    )
    // 符号链接目录同样按目标内容展开。
    await symlink(join(root, 'dist'), join(root, 'dist-alias'))

    const inspection = await inspectToolPackageDirectory(root)
    expect(inspection.fileCount).toBeGreaterThan(3)

    const destination = await mkdtemp(join(tmpdir(), 'spark-tool-installed-'))
    roots.push(destination)
    const installed = await installToolPackageDirectoryAtomic(root, destination)
    // 安装副本中符号链接被物化为真实文件，且内容与目标一致。
    const materialized = await lstat(join(installed.installPath, 'node_modules', '.bin', 'qrcode'))
    expect(materialized.isSymbolicLink()).toBe(false)
    expect(
      await readFile(join(installed.installPath, 'node_modules', '.bin', 'qrcode'), 'utf8'),
    ).toBe('#!/usr/bin/env node\n')
    const aliased = await lstat(join(installed.installPath, 'dist-alias', 'main.js'))
    expect(aliased.isSymbolicLink()).toBe(false)
    // 重复安装同源内容仍命中同一完整性摘要（解引用路径与 staging 复检一致）。
    const again = await installToolPackageDirectoryAtomic(root, destination)
    expect(again.installPath).toBe(installed.installPath)
  })

  it('rejects runtime.command that embeds arguments instead of a single executable', async () => {
    const embedded = await fixture({
      runtime: {
        adapter: 'process',
        protocol: 'spark-tool-process-v1',
        command: 'node index.js',
        args: [],
      },
    })
    await expect(inspectToolPackageDirectory(embedded)).rejects.toThrow(/single executable/)
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
