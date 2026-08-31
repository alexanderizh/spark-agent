import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cloneGitRepository,
  extractToolPackageArchive,
  resolveGitImportSource,
  validateGitRef,
  validateGitSubdirectory,
} from './tool-package-import.js'

const execFileAsync = promisify(execFile)

const roots: string[] = []

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function manifestJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: 'acme.productivity-suite',
    version: '1.0.0',
    name: 'Productivity Suite',
    description: 'Neutral package fixture',
    runtime: {
      adapter: 'process',
      protocol: 'spark-tool-process-v1',
      command: 'node',
      args: ['runner.mjs'],
      lifecycle: 'per-call',
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
  })
}

async function writeZip(path: string, entries: Record<string, Uint8Array>): Promise<void> {
  const archive = zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, [data, { level: 0 }]])),
  )
  await writeFile(path, archive)
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('tool package archive import', () => {
  it('extracts an archive with the manifest at the root', async () => {
    const archivePath = join(await tempRoot('spark-archive-'), 'suite.zip')
    await writeZip(archivePath, {
      'spark-tool.json': text(manifestJson()),
      'runner.mjs': text('process.stdin.resume()\n'),
    })
    const extractRoot = await tempRoot('spark-extract-')

    const materialized = await extractToolPackageArchive({ archivePath, extractRoot })
    roots.push(materialized.root)

    expect(materialized.root).not.toBe(extractRoot)
    expect(await readFile(join(materialized.root, 'spark-tool.json'), 'utf8')).toBe(manifestJson())
    await materialized.cleanup()
    await expect(readFile(join(materialized.root, 'spark-tool.json'), 'utf8')).rejects.toThrow()
  })

  it('detects a single wrapping directory containing the manifest', async () => {
    const archivePath = join(await tempRoot('spark-archive-'), 'wrapped.zip')
    await writeZip(archivePath, {
      'acme-suite/spark-tool.json': text(manifestJson()),
      'acme-suite/runner.mjs': text('process.stdin.resume()\n'),
    })
    const extractRoot = await tempRoot('spark-extract-')

    const materialized = await extractToolPackageArchive({ archivePath, extractRoot })
    roots.push(materialized.root)

    expect(materialized.root.endsWith('acme-suite')).toBe(true)
    expect(await readFile(join(materialized.root, 'runner.mjs'), 'utf8')).toContain('stdin')
  })

  it('skips .git, __MACOSX and .DS_Store entries without materializing them', async () => {
    const archivePath = join(await tempRoot('spark-archive-'), 'junk.zip')
    await writeZip(archivePath, {
      'spark-tool.json': text(manifestJson()),
      '.git/config': text('[core]'),
      '__MACOSX/spark-tool.json': text('junk'),
      '.DS_Store': text('junk'),
      'runner.mjs': text('process.stdin.resume()\n'),
    })
    const extractRoot = await tempRoot('spark-extract-')

    const materialized = await extractToolPackageArchive({ archivePath, extractRoot })
    roots.push(materialized.root)

    await expect(readFile(join(materialized.root, 'runner.mjs'), 'utf8')).resolves.toContain(
      'stdin',
    )
    await expect(readFile(join(materialized.root, '.git', 'config'))).rejects.toThrow()
    await expect(readFile(join(materialized.root, '__MACOSX', 'spark-tool.json'))).rejects.toThrow()
    await expect(readFile(join(materialized.root, '.DS_Store'))).rejects.toThrow()
  })

  it.each([
    ['zip-slip traversal', { '../evil.txt': text('evil') }],
    ['absolute path', { '/etc/passwd': text('evil') }],
    ['backslash path', { 'dist\\evil.txt': text('evil') }],
  ])('rejects a %s entry', async (_label, evilEntries) => {
    const archivePath = join(await tempRoot('spark-archive-'), 'evil.zip')
    await writeZip(archivePath, {
      'spark-tool.json': text(manifestJson()),
      ...evilEntries,
    })
    const extractRoot = await tempRoot('spark-extract-')

    await expect(extractToolPackageArchive({ archivePath, extractRoot })).rejects.toThrow(
      /absolute entry path|path traversal|backslash/,
    )
    // 失败路径必须清理临时解压目录，不泄漏到 extractRoot。
    const leftovers = await (await import('node:fs/promises')).readdir(extractRoot)
    expect(leftovers).toEqual([])
  })

  it('enforces injected entry-count limits', async () => {
    const archivePath = join(await tempRoot('spark-archive-'), 'bomb.zip')
    const entries: Record<string, Uint8Array> = { 'spark-tool.json': text(manifestJson()) }
    for (let index = 0; index < 8; index += 1) entries[`dist/file-${index}.js`] = text('x')
    await writeZip(archivePath, entries)
    const extractRoot = await tempRoot('spark-extract-')

    await expect(
      extractToolPackageArchive({
        archivePath,
        extractRoot,
        limits: { maxEntries: 4 },
      }),
    ).rejects.toThrow(/entry limit/)
  })

  it('rejects an archive whose root has no manifest in any detectable location', async () => {
    const archivePath = join(await tempRoot('spark-archive-'), 'no-manifest.zip')
    await writeZip(archivePath, { 'dist/main.js': text('process.stdin.resume()\n') })
    const extractRoot = await tempRoot('spark-extract-')

    await expect(extractToolPackageArchive({ archivePath, extractRoot })).rejects.toThrow(
      /does not contain spark-tool\.json/,
    )
  })

  it('rejects a missing archive file', async () => {
    const extractRoot = await tempRoot('spark-extract-')
    await expect(
      extractToolPackageArchive({
        archivePath: join(extractRoot, 'missing.zip'),
        extractRoot,
      }),
    ).rejects.toThrow(/not found/)
  })
})

describe('git import source resolution', () => {
  it('expands owner/repo shorthand to a GitHub https url', () => {
    expect(resolveGitImportSource('acme/suite')).toEqual({
      url: 'https://github.com/acme/suite.git',
      expandedShorthand: true,
      localPath: false,
    })
  })

  it('accepts full https, ssh and scp-style urls unchanged', () => {
    expect(resolveGitImportSource('https://gitlab.com/acme/suite.git')).toMatchObject({
      url: 'https://gitlab.com/acme/suite.git',
      expandedShorthand: false,
      localPath: false,
    })
    expect(resolveGitImportSource('ssh://git@github.com/acme/suite.git')).toMatchObject({
      localPath: false,
    })
    expect(resolveGitImportSource('git@github.com:acme/suite.git')).toMatchObject({
      url: 'git@github.com:acme/suite.git',
      localPath: false,
    })
  })

  it('recognizes local repository paths', () => {
    expect(resolveGitImportSource('/tmp/repos/suite')).toMatchObject({ localPath: true })
    expect(resolveGitImportSource('./relative-repo')).toMatchObject({ localPath: true })
    expect(resolveGitImportSource('../sibling-repo')).toMatchObject({ localPath: true })
  })

  it.each([
    ['empty', '   '],
    ['option injection', '--upload-pack=evil'],
    ['whitespace', 'https://example.com/a b.git'],
    ['unsupported', 'not a git source'],
  ])('rejects %s input', (_label, input) => {
    expect(() => resolveGitImportSource(input)).toThrow()
  })
})

describe('git ref and subdirectory validation', () => {
  it('accepts branch and tag shaped refs', () => {
    expect(validateGitRef('main')).toBe('main')
    expect(validateGitRef('release/v1.2')).toBe('release/v1.2')
    expect(validateGitRef('v2.0.0')).toBe('v2.0.0')
  })

  it.each([
    ['empty', ''],
    ['leading dash', '-bmain'],
    ['leading slash', '/main'],
    ['parent segment', 'refs/../../etc'],
    ['bad characters', 'main;rm -rf'],
  ])('rejects a %s ref', (_label, ref) => {
    expect(() => validateGitRef(ref)).toThrow()
  })

  it('accepts relative subdirectories and rejects escapes', () => {
    expect(validateGitSubdirectory('packages/tools')).toBe('packages/tools')
    expect(() => validateGitSubdirectory('/absolute')).toThrow(/Unsafe/)
    expect(() => validateGitSubdirectory('..')).toThrow(/Unsafe/)
    expect(() => validateGitSubdirectory('a\\b')).toThrow(/Unsafe/)
  })
})

describe('git repository clone', () => {
  it('shallow-clones a local repository and ignores .git during install', async () => {
    const originDir = await tempRoot('spark-git-origin-')
    await writeFile(join(originDir, 'spark-tool.json'), manifestJson(), 'utf8')
    await writeFile(join(originDir, 'runner.mjs'), 'process.stdin.resume()\n', 'utf8')
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: originDir })
    await execFileAsync('git', ['add', '.'], { cwd: originDir })
    await execFileAsync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
      { cwd: originDir },
    )

    const targetDir = join(await tempRoot('spark-git-target-'), 'clone')
    const result = await cloneGitRepository({
      source: resolveGitImportSource(originDir),
      targetDir,
    })

    expect(result.ref).toBeNull()
    expect(await readFile(join(targetDir, 'spark-tool.json'), 'utf8')).toBe(manifestJson())
    await rm(targetDir, { recursive: true, force: true })
  })

  it('clones a specific branch when one is requested', async () => {
    const originDir = await tempRoot('spark-git-origin-')
    await writeFile(join(originDir, 'spark-tool.json'), manifestJson(), 'utf8')
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: originDir })
    await execFileAsync('git', ['add', '.'], { cwd: originDir })
    await execFileAsync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
      { cwd: originDir },
    )
    await execFileAsync(
      'git',
      [
        '-c',
        'user.email=test@example.com',
        '-c',
        'user.name=Test',
        'checkout',
        '-b',
        'release/1.0',
      ],
      { cwd: originDir },
    )
    await writeFile(join(originDir, 'runner.mjs'), 'process.stdin.resume()\n', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: originDir })
    await execFileAsync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'runner'],
      { cwd: originDir },
    )

    const targetDir = join(await tempRoot('spark-git-target-'), 'clone')
    const result = await cloneGitRepository({
      source: resolveGitImportSource(originDir),
      ref: 'release/1.0',
      targetDir,
    })

    expect(result.ref).toBe('release/1.0')
    expect(await readFile(join(targetDir, 'runner.mjs'), 'utf8')).toContain('stdin')
    await rm(targetDir, { recursive: true, force: true })
  })

  it('reports a missing branch with an existence hint', async () => {
    const originDir = await tempRoot('spark-git-origin-')
    await writeFile(join(originDir, 'spark-tool.json'), manifestJson(), 'utf8')
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: originDir })
    await execFileAsync('git', ['add', '.'], { cwd: originDir })
    await execFileAsync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
      { cwd: originDir },
    )

    const targetDir = join(await tempRoot('spark-git-target-'), 'clone')
    await expect(
      cloneGitRepository({
        source: resolveGitImportSource(originDir),
        ref: 'does-not-exist',
        targetDir,
      }),
    ).rejects.toThrow(/branch or tag "does-not-exist" exists|not found/)
    await rm(targetDir, { recursive: true, force: true })
  })

  it('rejects a local source without a .git directory', async () => {
    const plainDir = await tempRoot('spark-git-plain-')
    await mkdir(plainDir, { recursive: true })
    const targetDir = join(await tempRoot('spark-git-target-'), 'clone')

    await expect(
      cloneGitRepository({ source: resolveGitImportSource(plainDir), targetDir }),
    ).rejects.toThrow(/Local git repository not found/)
  })
})
