import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SKILL_TREE_MAX_ENTRIES,
  assertInsideRealRoot,
  buildSkillFileTree,
  isLikelyTextFile,
  looksBinary,
  resolveSkillFilePath,
} from './skillFilesUtils.js'

describe('resolveSkillFilePath', () => {
  const root = '/tmp/spark-skill-root'

  it('accepts nested relative paths and returns an absolute path inside the root', () => {
    expect(resolveSkillFilePath(root, 'SKILL.md')).toBe('/tmp/spark-skill-root/SKILL.md')
    expect(resolveSkillFilePath(root, 'references/docs.md')).toBe(
      '/tmp/spark-skill-root/references/docs.md',
    )
  })

  it('normalises backslash separators so Windows-style input cannot bypass the guard', () => {
    expect(resolveSkillFilePath(root, 'references\\docs.md')).toBe(
      '/tmp/spark-skill-root/references/docs.md',
    )
  })

  it('rejects traversal, absolute paths, empty input and the root itself', () => {
    expect(() => resolveSkillFilePath(root, '../secret.txt')).toThrow()
    expect(() => resolveSkillFilePath(root, 'a/../../secret.txt')).toThrow()
    expect(() => resolveSkillFilePath(root, '/etc/passwd')).toThrow()
    expect(() => resolveSkillFilePath(root, '')).toThrow()
    expect(() => resolveSkillFilePath(root, '.')).toThrow()
  })
})

describe('buildSkillFileTree', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-skill-files-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('builds a nested tree with directories first and ignores dotfiles / node_modules', async () => {
    await writeFile(join(root, 'SKILL.md'), '# hi')
    await writeFile(join(root, 'notes.txt'), 'notes')
    await writeFile(join(root, '.DS_Store'), 'junk')
    await mkdir(join(root, 'references'), { recursive: true })
    await writeFile(join(root, 'references', 'docs.md'), 'docs')
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'index.js'), 'x')

    const { files, truncated } = await buildSkillFileTree(root)

    expect(truncated).toBe(false)
    // 目录在前；文件同类按名称升序（SKILL.md 置顶由渲染端 sortSkillNodes 负责）
    expect(files.map((node) => node.name)).toEqual(['references', 'notes.txt', 'SKILL.md'])
    const references = files[0]
    expect(references?.type).toBe('directory')
    expect(references?.children?.map((node) => node.path)).toEqual(['references/docs.md'])
    expect(files.find((node) => node.name === 'SKILL.md')?.size).toBe(4)
  })

  it('follows symlinked directories and skips broken links', async () => {
    const target = await mkdtemp(join(tmpdir(), 'spark-skill-target-'))
    try {
      await writeFile(join(target, 'SKILL.md'), '# linked')
      await symlink(target, join(root, 'linked'), 'dir')
      await symlink(join(root, 'missing-dir'), join(root, 'broken'), 'dir')

      const { files } = await buildSkillFileTree(root)
      expect(files.map((node) => node.name)).toEqual(['linked'])
      expect(files[0]?.children?.map((node) => node.name)).toEqual(['SKILL.md'])
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  it('stops after SKILL_TREE_MAX_ENTRIES entries and flags the result as truncated', async () => {
    await Promise.all(
      Array.from({ length: SKILL_TREE_MAX_ENTRIES + 5 }, (_, index) =>
        writeFile(join(root, `file-${index}.md`), 'x'),
      ),
    )

    const { files, truncated } = await buildSkillFileTree(root)
    expect(truncated).toBe(true)
    expect(files.length).toBeLessThanOrEqual(SKILL_TREE_MAX_ENTRIES)
  })
})

describe('assertInsideRealRoot', () => {
  let root: string
  let outside: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-skill-guard-'))
    outside = await mkdtemp(join(tmpdir(), 'spark-skill-outside-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('allows files inside the root (including not-yet-created ones)', async () => {
    await writeFile(join(root, 'SKILL.md'), '# hi')
    const realRoot = await import('node:fs/promises').then((fs) => fs.realpath(root))

    await expect(assertInsideRealRoot(realRoot, join(root, 'SKILL.md'))).resolves.toBeUndefined()
    await expect(
      assertInsideRealRoot(realRoot, join(root, 'references', 'new.md')),
    ).resolves.toBeUndefined()
  })

  it('rejects a symlink inside the skill directory that escapes the root', async () => {
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'))
    const realRoot = await import('node:fs/promises').then((fs) => fs.realpath(root))

    await expect(assertInsideRealRoot(realRoot, join(root, 'escape.txt'))).rejects.toThrow(
      '路径超出技能目录范围',
    )
  })
})

describe('text / binary sniffing', () => {
  it('treats common source and document extensions as text', () => {
    expect(isLikelyTextFile('SKILL.md')).toBe(true)
    expect(isLikelyTextFile('scripts/helper.ts')).toBe(true)
    expect(isLikelyTextFile('LICENSE')).toBe(true)
    expect(isLikelyTextFile('assets/logo.png')).toBe(false)
  })

  it('detects NUL bytes as binary', () => {
    expect(looksBinary(Buffer.from('hello'))).toBe(false)
    expect(looksBinary(Buffer.from([0x68, 0x00, 0x69]))).toBe(true)
  })
})
