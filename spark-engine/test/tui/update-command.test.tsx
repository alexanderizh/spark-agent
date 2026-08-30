import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { RulePermissionPolicy } from '../../src/permission/policy.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import type { SparkUpdateRunner } from '../../src/tui/update-runner.js'
import type { AgentEvent } from '../../src/events/schema.js'

function updateRunnerStub(
  impl: (options: { checkOnly: boolean }) => Promise<{ exitCode: number; output: string }>,
): SparkUpdateRunner & { calls: { checkOnly: boolean }[] } {
  const calls: { checkOnly: boolean }[] = []
  return {
    calls,
    run: async (options) => {
      calls.push(options)
      return impl(options)
    },
  }
}

async function renderApp(updateRunner?: SparkUpdateRunner) {
  const base = createDeterministicEnv([text('ok.')])
  const approver = new InteractiveApprover()
  const env = {
    ...base,
    permission: { policy: new RulePermissionPolicy(), approver },
  }
  const agent = Agent.open({ cwd: '/workspace', env })
  const session = await agent.newSession()
  const initial: AgentEvent[] = []
  for await (const event of session.events()) initial.push(event)
  return render(
    <SparkTuiApp
      initialSession={session}
      initialEvents={initial}
      approver={approver}
      createSession={async () => agent.newSession()}
      model="fake-m1"
      capabilities={{ color: 'mono', unicode: false, width: 80 }}
      {...(updateRunner === undefined ? {} : { updateRunner })}
    />,
  )
}

async function flush(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('SparkTuiApp /update command', () => {
  it('applies an update through the injected runner and shows the restart hint', async () => {
    const runner = updateRunnerStub(async () => ({
      exitCode: 0,
      output: 'Updated spark 0.2.0 -> 0.3.0 at /global/node_modules/@spark/agent',
    }))
    const app = await renderApp(runner)

    app.stdin.write('/update')
    await flush(2)
    app.stdin.write('\r')
    await flush()

    expect(runner.calls).toEqual([{ checkOnly: false }])
    const frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('Updated spark 0.2.0 -> 0.3.0')
    expect(frame).toContain('重新运行 spark')
    expect(frame).not.toContain('正在更新 Spark')
    app.unmount()
  })

  it('forwards --check as a check-only request and reports availability only', async () => {
    const runner = updateRunnerStub(async () => ({
      exitCode: 0,
      output: 'Update available: 0.2.0 -> 0.3.0',
    }))
    const app = await renderApp(runner)

    app.stdin.write('/update --check')
    await flush(2)
    app.stdin.write('\r')
    await flush()

    expect(runner.calls).toEqual([{ checkOnly: true }])
    const frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('Update available: 0.2.0 -> 0.3.0')
    expect(frame).not.toContain('重新运行 spark')
    app.unmount()
  })

  it('surfaces nothing-to-do reports without success coloring the hint away', async () => {
    const runner = updateRunnerStub(async () => ({
      exitCode: 1,
      output: '',
    }))
    const app = await renderApp(runner)

    app.stdin.write('/update')
    await flush(2)
    app.stdin.write('\r')
    await flush()

    expect(stripAnsi(app.lastFrame() ?? '')).toContain('已是最新版本。')
    app.unmount()
  })

  it('rejects unknown arguments with usage help and never reaches the runner', async () => {
    const runner = updateRunnerStub(async () => ({ exitCode: 0, output: '' }))
    const app = await renderApp(runner)

    app.stdin.write('/update force')
    await flush(2)
    app.stdin.write('\r')
    await flush()

    expect(runner.calls).toEqual([])
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('用法：/update 或 /update --check')
    app.unmount()
  })

  it('tells users to fall back to the shell command when no channel is wired', async () => {
    const app = await renderApp(undefined)

    app.stdin.write('/update')
    await flush(2)
    app.stdin.write('\r')
    await flush()

    expect(stripAnsi(app.lastFrame() ?? '')).toContain('未接入更新通道')
    app.unmount()
  })
})

describe('SparkTuiApp shortcut wiring', () => {
  it('Shift+Tab walks permission modes without opening the picker', async () => {
    const app = await renderApp(undefined)
    const shiftTab = async (times: number): Promise<void> => {
      for (let index = 0; index < times; index += 1) {
        app.stdin.write('\u001b[Z')
        await flush(2)
      }
    }
    await shiftTab(1) // default -> acceptEdits
    expect(stripAnsi(app.lastFrame() ?? '')).toContain(
      '权限策略已切换为 自动权限（本会话生效）。',
    )

    await shiftTab(3) // -> plan -> default -> acceptEdits
    const frame = stripAnsi(app.lastFrame() ?? '')
    // The picker never opened: no mode list is rendered, only status notices.
    expect(frame).not.toContain('权限策略切换(本会话生效)')
    expect(frame).toContain('权限策略已切换为 自动权限（本会话生效）。')
    app.unmount()
  })
})

function stripAnsi(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
      index += 2
      while (index < value.length) {
        const code = value.charCodeAt(index)
        if (code >= 0x40 && code <= 0x7e) break
        index += 1
      }
    } else {
      output += value[index] ?? ''
    }
  }
  return output
}
