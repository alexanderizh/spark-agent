import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildRegistrationPayload, pickInstallersFor } from '../register-release.mjs'

test('selects only matching platform and architecture installers', () => {
  assert.deepEqual(
    pickInstallersFor('win', 'x64', [
      'SparkWork-1.2.0-win-x64.exe',
      'SparkWork-1.2.0-win-x64.exe.blockmap',
      'SparkWork-1.2.0-mac-arm64.dmg',
    ]),
    [{ fileName: 'SparkWork-1.2.0-win-x64.exe', blockmap: 'SparkWork-1.2.0-win-x64.exe.blockmap' }],
  )
})

test('includes the matching changelog entry in the registration payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spark-register-release-'))
  const distDir = join(root, 'dist')
  const changelogPath = join(root, 'CHANGELOG.md')
  await mkdir(distDir)
  await Promise.all([
    writeFile(join(distDir, 'SparkWork-1.2.0-win-x64.exe'), 'installer'),
    writeFile(changelogPath, '## [1.2.0] - 2026-09-07\n\n- 新增版本更新说明。\n'),
  ])
  try {
    const payload = await buildRegistrationPayload({
      version: '1.2.0',
      platform: 'win',
      arch: 'x64',
      channel: 'stable',
      distDir,
      objectPrefix: 'stable/1.2.0',
      autoPublish: true,
    }, changelogPath)
    assert.equal(payload.releaseNotes, '- 新增版本更新说明。')
    assert.equal(payload.files[0]?.objectKey, 'stable/1.2.0/SparkWork-1.2.0-win-x64.exe')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
