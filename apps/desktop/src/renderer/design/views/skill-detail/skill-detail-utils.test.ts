import { describe, expect, it } from 'vitest'
import type { SkillFileNode } from '@spark/protocol'
import {
  composeVirtualSkillMarkdown,
  countFiles,
  dirnameAbsolute,
  fileExtension,
  findNodeByPath,
  formatFileSize,
  isImageFile,
  isMarkdownFile,
  joinAbsolutePath,
  joinSkillPath,
  parseVirtualSkillMarkdown,
  sortSkillNodes,
  toSafeFileUrl,
  toSingleLine,
  utf8ByteLength,
} from './skill-detail-utils'

const TREE: SkillFileNode[] = [
  { path: 'SKILL.md', name: 'SKILL.md', type: 'file', size: 12 },
  {
    path: 'references',
    name: 'references',
    type: 'directory',
    children: [{ path: 'references/docs.md', name: 'docs.md', type: 'file', size: 30 }],
  },
  { path: 'assets', name: 'assets', type: 'directory', children: [] },
  { path: 'notes.txt', name: 'notes.txt', type: 'file', size: 5 },
]

describe('file type and size helpers', () => {
  it('classifies extensions case-insensitively', () => {
    expect(fileExtension('SKILL.MD')).toBe('.md')
    expect(fileExtension('LICENSE')).toBe('')
    expect(isMarkdownFile('SKILL.md')).toBe(true)
    expect(isMarkdownFile('helper.ts')).toBe(false)
    expect(isImageFile('logo.png')).toBe(true)
    expect(isImageFile('notes.txt')).toBe(false)
  })

  it('formats byte sizes with sensible precision', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(900)).toBe('900 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(31744)).toBe('31 KB')
    expect(formatFileSize(1556480)).toBe('1.5 MB')
    expect(formatFileSize(undefined)).toBe('')
  })

  it('collapses multi-line descriptions into a single subtitle line', () => {
    expect(toSingleLine('a\n\nb   c')).toBe('a b c')
    expect(toSingleLine('x'.repeat(20), 10)).toHaveLength(10)
  })

  it('counts nested files and resolves paths / absolute joins', () => {
    expect(countFiles(TREE)).toBe(3)
    expect(findNodeByPath(TREE, 'references/docs.md')?.name).toBe('docs.md')
    expect(findNodeByPath(TREE, 'missing.md')).toBeNull()
    expect(joinSkillPath('references', 'docs.md')).toBe('references/docs.md')
    expect(joinSkillPath('', 'SKILL.md')).toBe('SKILL.md')
    expect(joinAbsolutePath('/Users/me/skill', 'references/docs.md')).toBe(
      '/Users/me/skill/references/docs.md',
    )
    expect(joinAbsolutePath('C:\\skills\\demo\\', 'SKILL.md')).toBe('C:\\skills\\demo\\SKILL.md')
    expect(dirnameAbsolute('/Users/me/skill/SKILL.md')).toBe('/Users/me/skill')
    expect(dirnameAbsolute('SKILL.md')).toBeNull()
  })

  it('encodes absolute paths into safe-file URLs', () => {
    expect(toSafeFileUrl('/tmp/a b.png')).toMatch(/^safe-file:\/\/x\/[A-Za-z0-9_-]+$/)
    expect(utf8ByteLength('中文')).toBe(6)
  })
})

describe('sortSkillNodes', () => {
  it('pins SKILL.md first, then directories, then files', () => {
    const sorted = sortSkillNodes(TREE)
    expect(sorted.map((node) => node.name)).toEqual([
      'SKILL.md',
      'assets',
      'references',
      'notes.txt',
    ])
  })
})

const FIELDS = {
  name: '预算表单助手',
  description: '创建/修改预算表单：需要: 冒号与换行\n也要能处理',
  version: '1.2.0',
  author: 'Zhang Yang',
  category: 'utility',
  tags: ['budget', 'form'],
  requiredTools: ['Bash', 'Read'],
  body: '# 指令\n\n按规则执行。',
}

describe('virtual skill <-> SKILL.md round trip', () => {
  it('composes a SKILL.md with frontmatter and body', () => {
    const text = composeVirtualSkillMarkdown(FIELDS)
    expect(text.startsWith('---\n')).toBe(true)
    expect(text).toContain('name: 预算表单助手')
    expect(text).toContain('tags: budget, form')
    expect(text).toContain('requiredTools: Bash, Read')
    expect(text.endsWith('# 指令\n\n按规则执行。\n')).toBe(true)
  })

  it('parses the composed document back into the same fields', () => {
    const parsed = parseVirtualSkillMarkdown(composeVirtualSkillMarkdown(FIELDS))
    expect(parsed.name).toBe(FIELDS.name)
    expect(parsed.description).toBe(FIELDS.description.replace(/\n/g, ' '))
    expect(parsed.version).toBe('1.2.0')
    expect(parsed.author).toBe('Zhang Yang')
    expect(parsed.category).toBe('utility')
    expect(parsed.tags).toEqual(['budget', 'form'])
    expect(parsed.requiredTools).toEqual(['Bash', 'Read'])
    expect(parsed.body).toBe('# 指令\n\n按规则执行。')
  })

  it('tolerates documents without frontmatter or with bracketed lists', () => {
    const bare = parseVirtualSkillMarkdown('# 只有正文')
    expect(bare.name).toBe('')
    expect(bare.body).toBe('# 只有正文')

    const bracketed = parseVirtualSkillMarkdown('---\ntags: [a, b]\nname: "带, 逗号"\n---\nbody')
    expect(bracketed.tags).toEqual(['a', 'b'])
    expect(bracketed.name).toBe('带, 逗号')
    expect(bracketed.body).toBe('body')
  })
})
