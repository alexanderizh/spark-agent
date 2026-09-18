import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { collectEvents } from '../helpers.js'

describe('invariant: byte-identical golden event log', () => {
  it('matches the reviewed read-edit-answer ledger', async () => {
    const env = createDeterministicEnv(
      [
        toolCall('read-1', 'read', { path: 'a.ts' }),
        toolCall('edit-1', 'edit', { path: 'a.ts', old: 'one', new: 'two' }),
        text('done'),
      ],
      {
        files: { 'a.ts': 'one' },
        approvals: [{ decision: 'allow', grantScope: 'once' }],
      },
    )
    const session = await Agent.open({ cwd: '/workspace', env }).newSession({ z: 1, a: 2 })
    await session.turn('edit a.ts')
    const actual = `${(await collectEvents(session)).map((event) => JSON.stringify(event)).join('\n')}\n`
    const expectedFile = await readFile(
      new URL('../golden/read-edit-answer.jsonl', import.meta.url),
      'utf8',
    )
    // The fixture records a canonical POSIX cwd; the engine stores
    // resolve(cwd), which is platform-shaped ('G:\workspace' on Windows).
    // Normalize just that field so the byte-identical invariant covers the
    // event structure on every platform.
    const expected = expectedFile
      // Git may check the fixture out with CRLF (core.autocrlf); the ledger
      // always joins events with LF.
      .replaceAll('\r\n', '\n')
      .replaceAll('"cwd":"/workspace"', `"cwd":${JSON.stringify(resolve('/workspace'))}`)
    expect(actual).toBe(expected)
  })
})
