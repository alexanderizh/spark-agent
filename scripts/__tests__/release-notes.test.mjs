import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readReleaseNotes, runReleaseNotesCli } from '../release-notes.mjs'

async function withChangelog(content, run) {
  const directory = await mkdtemp(join(tmpdir(), 'spark-release-notes-'))
  const changelogPath = join(directory, 'CHANGELOG.md')
  await writeFile(changelogPath, content, 'utf8')
  try {
    return await run(changelogPath, directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const CHANGELOG = `# Changelog

## [1.2.0] - 2026-09-07

### Added

- 新增同步更新说明。

---

## [1.1.0] - 2026-09-01

- 旧版本说明。

## [Unreleased]

- 尚未发布。
`

test('extracts only the matching version section', async () => {
  await withChangelog(CHANGELOG, async (changelogPath) => {
    const notes = await readReleaseNotes({ version: 'v1.2.0', changelogPath })
    assert.equal(notes, '### Added\n\n- 新增同步更新说明。')
  })
})

test('allows missing version sections but rejects unreleased and empty sections', async () => {
  await withChangelog(CHANGELOG, async (changelogPath) => {
    assert.equal(await readReleaseNotes({ version: '1.3.0', changelogPath }), '')
    await assert.rejects(
      () => readReleaseNotes({ version: 'Unreleased', changelogPath }),
      /Unreleased 不能作为正式发布版本/,
    )
  })
  await withChangelog('## [1.2.0] - 2026-09-07\n\n', async (changelogPath) => {
    await assert.rejects(
      () => readReleaseNotes({ version: '1.2.0', changelogPath }),
      /更新说明为空/,
    )
  })
})

test('allows the changelog file itself to be absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spark-release-notes-'))
  try {
    assert.equal(
      await readReleaseNotes({ version: '1.2.0', changelogPath: join(directory, 'CHANGELOG.md') }),
      '',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('writes the exact release notes to the requested output file', async () => {
  await withChangelog(CHANGELOG, async (changelogPath, directory) => {
    const outputPath = join(directory, 'release-notes.md')
    const notes = await runReleaseNotesCli([
      '--version',
      '1.2.0',
      '--changelog',
      changelogPath,
      '--output',
      outputPath,
    ])
    assert.equal(notes, '### Added\n\n- 新增同步更新说明。')
    assert.equal(await readFile(outputPath, 'utf8'), '### Added\n\n- 新增同步更新说明。\n')
  })
})
