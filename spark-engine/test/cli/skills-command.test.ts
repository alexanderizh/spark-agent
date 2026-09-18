import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('spark skills contract', () => {
  it('lists compact metadata and reads a selected skill body', async () => {
    const { home, project } = await workspace()
    await writeSkill(project, 'review', 'Review', 'Review the change', '# Review\n\nRun checks.')

    const list = await runCli(['skills', 'list', '--json'], project, home)
    expect(list.code).toBe(0)
    const listed = JSON.parse(list.stdout) as {
      readonly skills: readonly { readonly id: string; readonly description: string }[]
    }
    expect(listed.skills).toHaveLength(1)
    expect(listed.skills[0]).toMatchObject({ description: 'Review the change' })
    expect(list.stdout).not.toContain('Run checks.')

    const read = await runCli(['skills', 'read', listed.skills[0]!.id], project, home)
    expect(read.code).toBe(0)
    expect(read.stdout).toContain('# Review\n\nRun checks.')
  })

  it('supports query and limit, and reports missing skill ids as command failures', async () => {
    const { home, project } = await workspace()
    await writeSkill(project, 'one', 'One', 'Alpha skill', 'one')
    await writeSkill(project, 'two', 'Two', 'Beta skill', 'two')

    const filtered = await runCli(
      ['skills', 'list', 'beta', '--limit', '1', '--json'],
      project,
      home,
    )
    expect(filtered.code).toBe(0)
    expect(JSON.parse(filtered.stdout)).toMatchObject({ total: 1 })

    const missing = await runCli(['skills', 'read', 'missing'], project, home)
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('Skill not found: missing')
  })
})

/**
 * The CLI workspace lives INSIDE the isolated home: the skill catalog scans
 * project ancestors up to the home boundary, so this layout keeps the real
 * user's installed skills out of the sandbox on any machine.
 */
async function workspace(): Promise<{
  readonly root: string
  readonly home: string
  readonly project: string
}> {
  const root = await mkdtemp(resolve(tmpdir(), 'spark-skills-cli-'))
  roots.push(root)
  const home = resolve(root, 'home')
  const project = resolve(home, 'project')
  await mkdir(project, { recursive: true })
  return { root, home, project }
}

async function writeSkill(
  root: string,
  nameDirectory: string,
  name: string,
  description: string,
  body: string,
): Promise<void> {
  const directory = resolve(root, '.agents', 'skills', nameDirectory)
  await mkdir(directory, { recursive: true })
  await writeFile(
    resolve(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
    'utf8',
  )
}

async function runCli(
  args: readonly string[],
  cwd: string,
  home: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const binary = resolve('dist/cli/main.js')
  const child = spawn(process.execPath, [binary, ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', resolveCode)
  })
  return { code, stdout, stderr }
}
