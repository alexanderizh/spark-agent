import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { runProcess } from '../../src/tools/workspace/process.js'

describe('workspace process lifecycle', () => {
  it('captures output and preserves nonzero exit status', async () => {
    const result = await runProcess(
      process.execPath,
      ['-e', 'console.log("out"); console.error("err"); process.exitCode = 7'],
      {
        cwd: process.cwd(),
        signal: new AbortController().signal,
      },
    )
    expect(result).toEqual({ exitCode: 7, stdout: 'out\n', stderr: 'err\n' })
  })

  it.skipIf(process.platform === 'win32')(
    'kills descendants even after their group leader exits successfully',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'spark-process-'))
      const ready = join(directory, 'ready')
      const controller = new AbortController()
      let descendant: number | undefined
      const script = `const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(`process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`)}], {stdio: ['ignore', 1, 2]});
      child.unref();`
      const outcome = runProcess(process.execPath, ['-e', script], {
        cwd: directory,
        signal: controller.signal,
      }).then(
        () => 'completed',
        (error: unknown) => error instanceof Error ? error.name : String(error),
      )
      try {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          try {
            descendant = Number(await readFile(ready, 'utf8'))
            break
          } catch {
            await delay(20)
          }
        }
        expect(descendant).toBeGreaterThan(0)
        // Give the group leader time to exit with code 0 while the descendant holds stdout.
        await delay(200)
        controller.abort()
        expect(await Promise.race([outcome, delay(4000).then(() => 'hung')])).toBe('AbortError')
      } finally {
        controller.abort()
        if (descendant) {
          try {
            process.kill(descendant, 'SIGKILL')
          } catch {
            /* already reaped */
          }
        }
        await outcome
        await rm(directory, { recursive: true, force: true })
      }
    },
    10000,
  )
})
