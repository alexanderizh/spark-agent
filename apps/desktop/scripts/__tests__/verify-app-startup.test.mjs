import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyAppStartup } from '../verify-app-startup.mjs'

async function withAppFixture(source, check) {
  const root = await mkdtemp(join(tmpdir(), 'spark-startup-fixture-'))
  const entry = join(root, 'app.cjs')
  try {
    await writeFile(entry, source)
    await check({ appExecutable: process.execPath, args: [entry] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('rejects a silent initialization failure even when the application exits with code zero', async () => {
  await withAppFixture('process.exit(0)', async (options) => {
    await assert.rejects(verifyAppStartup(options), /Application exited before startup: code=0/)
  })
})

test('terminates a stalled startup within its timeout instead of accepting a live process', async () => {
  await withAppFixture('setInterval(() => {}, 1000)', async (options) => {
    await assert.rejects(
      verifyAppStartup({ ...options, timeoutMs: 1_000 }),
      /Application startup timed out/,
    )
  })
})
