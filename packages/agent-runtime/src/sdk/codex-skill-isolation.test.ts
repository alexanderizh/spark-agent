import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCodexSkillConfigOverride,
  buildCodexSkillConfigTomlOverride,
  resolveCodexSkillIsolation,
} from './codex-skill-isolation.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Codex skill isolation', () => {
  it('disables a malformed repository skill while preserving existing user config entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-codex-skill-isolation-'))
    roots.push(root)
    mkdirSync(join(root, '.git'))
    const skillDir = join(root, '.agents', 'skills', 'broken')
    mkdirSync(skillDir, { recursive: true })
    const brokenSkill = join(skillDir, 'SKILL.md')
    writeFileSync(brokenSkill, '# Missing frontmatter\n', 'utf8')

    const codexHome = join(root, 'codex-home')
    mkdirSync(codexHome)
    const userDisabledSkill = join(root, 'user-disabled', 'SKILL.md')
    writeFileSync(
      join(codexHome, 'config.toml'),
      `[[skills.config]]\npath = ${JSON.stringify(userDisabledSkill)}\nenabled = false\n`,
      'utf8',
    )

    const isolation = resolveCodexSkillIsolation(root, { CODEX_HOME: codexHome })

    expect(isolation.issues).toContainEqual(
      expect.objectContaining({ path: resolve(brokenSkill), code: 'missing_frontmatter' }),
    )
    expect(isolation.configEntries).toEqual(
      expect.arrayContaining([
        { path: resolve(userDisabledSkill), enabled: false },
        { path: resolve(brokenSkill), enabled: false },
      ]),
    )
    expect(buildCodexSkillConfigOverride(isolation)).toMatchObject({
      skills: { config: expect.arrayContaining([{ path: resolve(brokenSkill), enabled: false }]) },
    })
    expect(buildCodexSkillConfigTomlOverride(isolation)).toContain(
      `path=${JSON.stringify(resolve(brokenSkill))}`,
    )
  })

  it('returns no override when every discovered skill is valid', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-codex-skill-valid-'))
    roots.push(root)
    mkdirSync(join(root, '.git'))
    const skillDir = join(root, '.agents', 'skills', 'valid')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: valid\ndescription: Valid skill\n---\nUse it.\n',
      'utf8',
    )
    const codexHome = join(root, 'empty-codex-home')
    mkdirSync(codexHome)

    const isolation = resolveCodexSkillIsolation(root, { CODEX_HOME: codexHome })

    expect(isolation.issues).toEqual([])
    expect(isolation.configEntries).toEqual([])
    expect(buildCodexSkillConfigTomlOverride(isolation)).toBeNull()
  })

  it('keeps user config entries whose path contains "#" inside quotes', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-codex-skill-hash-'))
    roots.push(root)
    mkdirSync(join(root, '.git'))
    const skillDir = join(root, '.agents', 'skills', 'broken')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), 'no frontmatter\n', 'utf8')

    const codexHome = join(root, 'codex-home')
    mkdirSync(codexHome)
    const hashPath = join(root, 'weird#dir', 'SKILL.md')
    writeFileSync(
      join(codexHome, 'config.toml'),
      `[[skills.config]]\npath = ${JSON.stringify(hashPath)} # disabled skill\nenabled = false\n`,
      'utf8',
    )

    const isolation = resolveCodexSkillIsolation(root, { CODEX_HOME: codexHome })

    expect(isolation.configEntries).toEqual(
      expect.arrayContaining([{ path: resolve(hashPath), enabled: false }]),
    )
  })

  it('parses inline skills.config arrays from user config', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-codex-skill-inline-'))
    roots.push(root)
    mkdirSync(join(root, '.git'))
    const skillDir = join(root, '.agents', 'skills', 'broken')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), 'no frontmatter\n', 'utf8')

    const codexHome = join(root, 'codex-home')
    mkdirSync(codexHome)
    const disabledSkill = join(root, 'inline-disabled', 'SKILL.md')
    writeFileSync(
      join(codexHome, 'config.toml'),
      `skills.config = [{ name = "legacy-helper", enabled = false }, { path = ${JSON.stringify(
        disabledSkill,
      )}, enabled = false }]\n`,
      'utf8',
    )

    const isolation = resolveCodexSkillIsolation(root, { CODEX_HOME: codexHome })

    expect(isolation.configEntries).toEqual(
      expect.arrayContaining([
        { name: 'legacy-helper', enabled: false },
        { path: resolve(disabledSkill), enabled: false },
      ]),
    )
  })

  it('never merges project-level .codex/config.toml entries into the override', () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-codex-skill-trust-'))
    roots.push(root)
    mkdirSync(join(root, '.git'))
    const skillDir = join(root, '.agents', 'skills', 'broken')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), 'no frontmatter\n', 'utf8')

    const codexHome = join(root, 'codex-home')
    mkdirSync(codexHome)
    const projectCodexDir = join(root, '.codex')
    mkdirSync(projectCodexDir)
    const untrustedDisable = join(root, 'untrusted', 'SKILL.md')
    writeFileSync(
      join(projectCodexDir, 'config.toml'),
      `[[skills.config]]\npath = ${JSON.stringify(untrustedDisable)}\nenabled = false\n`,
      'utf8',
    )

    const isolation = resolveCodexSkillIsolation(root, { CODEX_HOME: codexHome })

    // 项目级配置仅在项目受 Codex 信任时生效；Spark 不复刻该信任判定，
    // 因此其条目绝不能被提权合入 turn 级覆盖。
    expect(isolation.configEntries).toEqual([
      { path: resolve(join(skillDir, 'SKILL.md')), enabled: false },
    ])
  })
})
