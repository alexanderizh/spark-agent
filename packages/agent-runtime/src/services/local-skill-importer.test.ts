import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectLocalSkills, importLocalSkillDirectory } from './local-skill-importer.js'

let tempDir: string | null = null

afterEach(() => {
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'spark-local-skills-'))
  return tempDir
}

describe('local-skill-importer', () => {
  it('detects Claude and Codex style SKILL.md directories', () => {
    const root = makeTempDir()
    const claudeSkill = join(root, '.claude', 'skills', 'reviewer')
    const codexSkill = join(root, '.codex', 'skills', 'planner')
    mkdirSync(claudeSkill, { recursive: true })
    mkdirSync(codexSkill, { recursive: true })
    writeFileSync(join(claudeSkill, 'SKILL.md'), '---\nname: reviewer\ndescription: Review code\n---\n# Reviewer\n')
    writeFileSync(join(codexSkill, 'SKILL.md'), '---\nname: planner\ndescription: Plan work\n---\n# Planner\n')

    const candidates = detectLocalSkills([join(root, '.claude', 'skills'), join(root, '.codex', 'skills')])

    expect(candidates.map((candidate) => candidate.name).sort()).toEqual(['planner', 'reviewer'])
    expect(candidates.find((candidate) => candidate.name === 'reviewer')?.source).toBe('claude')
    expect(candidates.find((candidate) => candidate.name === 'planner')?.source).toBe('codex')
  })

  it('converts a local SKILL.md directory into a Skill create payload', () => {
    const root = makeTempDir()
    const skillDir = join(root, 'skills', 'writer')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: writer\ndescription: Draft release notes\ntags: writing, release\n---\n# Writer\nUse concise prose.\n',
    )

    const payload = importLocalSkillDirectory(skillDir, 'codex')

    expect(payload.name).toBe('writer')
    expect(payload.rootPath).toBe(skillDir)
    expect(payload.enabled).toBe(true)
    const manifest = JSON.parse(payload.manifestJson) as { desc: string; source: string; tags: string[]; systemPrompt: string }
    expect(manifest.desc).toBe('Draft release notes')
    expect(manifest.source).toBe('Codex 本地')
    expect(manifest.tags).toEqual(['writing', 'release'])
    expect(manifest.systemPrompt).toContain('Use concise prose.')
  })
})
