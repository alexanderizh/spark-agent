import { describe, expect, it } from 'vitest'
import { parseSkillDocument } from './skill-document.js'

describe('parseSkillDocument', () => {
  it('parses YAML frontmatter with multiline metadata', () => {
    const result = parseSkillDocument(
      [
        '---',
        'name: release-notes',
        'description: >-',
        '  Draft release notes from',
        '  verified repository changes.',
        'tags:',
        '  - writing',
        '  - release',
        '---',
        '# Workflow',
        'Inspect the diff.',
      ].join('\n'),
    )

    expect(result).toMatchObject({
      valid: true,
      name: 'release-notes',
      description: 'Draft release notes from verified repository changes.',
      body: '# Workflow\nInspect the diff.',
    })
  })

  it.each([
    ['# Missing metadata', 'missing_frontmatter'],
    ['---\nname: broken\ndescription: [\n---\nBody', 'invalid_frontmatter_yaml'],
    ['---\nname: broken\n---\nBody', 'missing_description'],
  ])('rejects malformed skill documents without throwing', (raw, code) => {
    expect(parseSkillDocument(raw)).toMatchObject({ valid: false, issue: { code } })
  })
})
