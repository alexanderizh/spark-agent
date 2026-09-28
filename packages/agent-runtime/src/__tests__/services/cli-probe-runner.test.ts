import { describe, expect, it } from 'vitest'
import { runCliProbe, withDeadline } from '../../services/cli-probe-runner.js'

const isWin = process.platform === 'win32'

describe('runCliProbe', () => {
  it('resolves with stdout on success', async () => {
    const command = isWin ? ['cmd.exe', '/d', '/s', '/c', 'echo ok'] : ['sh', '-c', 'echo ok']
    const result = await runCliProbe(command, 5000)
    expect(result.stdout.trim()).toBe('ok')
  })

  it('rejects when the command exits non-zero', async () => {
    const command = isWin ? ['cmd.exe', '/d', '/s', '/c', 'exit /b 3'] : ['sh', '-c', 'exit 3']
    await expect(runCliProbe(command, 5000)).rejects.toThrow(/exited with code 3/)
  })

  it.runIf(isWin)(
    'settles on timeout even when a grandchild holds the stdio pipes',
    // 复现 provider 卡死的根因场景：cmd.exe 派生的 node 孙进程长期持有 stdio
    // 管道。旧实现（exec + timeout）会因 'close' 永不触发而永久挂起，
    // provider:list 随之被无限卡死；runCliProbe 必须按时以 timeout rejection 收场。
    async () => {
      const command = [
        'cmd.exe',
        '/d',
        '/s',
        '/c',
        '"node -e "setTimeout(function(){}, 60000)""',
      ]
      const startedAt = Date.now()
      await expect(
        runCliProbe(command, 1200, { windowsVerbatimArguments: true }),
      ).rejects.toThrow(/timed out/)
      expect(Date.now() - startedAt).toBeLessThan(10_000)
    },
    15_000,
  )
})

describe('withDeadline', () => {
  it('resolves with the underlying value when it settles in time', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 1000, 'test-probe')).resolves.toBe('ok')
  })

  it('rejects when the deadline fires first', async () => {
    await expect(
      withDeadline(new Promise<never>(() => {}), 50, 'test-probe'),
    ).rejects.toThrow(/deadline of 50ms exceeded/)
  })
})
