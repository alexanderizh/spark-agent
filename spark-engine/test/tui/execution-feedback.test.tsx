import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { createDeterministicEnv } from '../../src/env.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import { collectEvents } from '../helpers.js'

async function tick() {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

async function fixture() {
  const env = createDeterministicEnv([
    toolCall(
      'write',
      'write',
      { path: 'a.txt', content: 'hello' },
      {
        text: 'Preparing the requested write.',
        thinking: 'Inspect the file first.',
      },
    ),
    text('Write finished.'),
  ])
  const approver = new InteractiveApprover()
  const agent = Agent.open({
    cwd: '/workspace',
    env: { ...env, permission: { ...env.permission, approver } },
  })
  const session = await agent.newSession()
  const initialEvents = await collectEvents(session)
  const mount = () =>
    render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initialEvents}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake"
        capabilities={{ color: 'mono', unicode: false, width: 64, height: 32 }}
      />,
    )
  return { session, mount }
}

describe('TUI execution feedback', () => {
  it('settles streamed text once and clears approval activity after rejection', async () => {
    const { mount } = await fixture()
    const app = mount()
    try {
      app.stdin.write('write it')
      await tick()
      app.stdin.write('\r')
      await tick()
      const frame = app.lastFrame() ?? ''
      expect(frame.split('Preparing the requested write.')).toHaveLength(2)
      expect(frame).toContain('waiting for approval')
      expect(frame).toContain('esc 拒绝当前工具')
      const border = frame.split('\n').find(line => line.startsWith('╭'))
      expect(border?.length).toBe(64)
      app.stdin.write('\u001b')
      await new Promise((resolve) => setTimeout(resolve, 40))
      await tick()
      expect(app.lastFrame()).not.toContain('waiting for approval')
      expect(app.lastFrame()).toContain('Write finished.')
    } finally {
      app.unmount()
    }
  })

  it('reports a rejected turn promise and leaves the input usable', async () => {
    const { session, mount } = await fixture()
    const mock = vi.spyOn(session, 'turn').mockRejectedValueOnce(new Error('ledger unavailable'))
    const app = mount()
    try {
      app.stdin.write('try task')
      await tick()
      app.stdin.write('\r')
      await tick()
      expect(app.lastFrame()).toContain('ledger unavailable')
      expect(app.lastFrame()).not.toContain('Enter 加入队列')
      app.stdin.write('new draft')
      await tick()
      expect(app.lastFrame()).toContain('new draft')
    } finally {
      app.unmount()
      mock.mockRestore()
    }
  })

  it('shows cancellation cleanup and preserves a draft until tools settle', async () => {
    const base = createDeterministicEnv([toolCall('read', 'read', { path: 'a.txt' })])
    let finishTool: (() => void) | undefined
    const approver = new InteractiveApprover()
    const env = {
      ...base,
      tools: {
        ...base.tools,
        executor: {
          execute: async () =>
            new Promise<{ ok: boolean; content: string }>((resolve) => {
              finishTool = () => {
                resolve({ ok: false, content: 'aborted' })
              }
            }),
        },
      },
    }
    const agent = Agent.open({ cwd: '/workspace', env })
    const session = await agent.newSession({ permissionMode: 'auto' })
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={await collectEvents(session)}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake"
        capabilities={{ color: 'mono', unicode: false, width: 64, height: 32 }}
      />,
    )
    try {
      app.stdin.write('read it')
      await tick()
      app.stdin.write('\r')
      await tick()
      expect(finishTool).toBeTypeOf('function')
      expect(app.lastFrame()).toContain('Enter 加入队列')
      app.stdin.write('keep this draft')
      await tick()
      app.stdin.write('\u001b')
      await new Promise((resolve) => setTimeout(resolve, 40))
      await tick()
      expect(app.lastFrame()).toContain('等待工具清理')
      expect(app.lastFrame()).toContain('keep this draft')
      finishTool?.()
      await tick()
      expect(app.lastFrame()).not.toContain('等待工具清理')
      expect(app.lastFrame()).toContain('已中断')
      expect(app.lastFrame()).toContain('keep this draft')
    } finally {
      finishTool?.()
      app.unmount()
    }
  })

  it('toggles settled thinking in the scrollable transcript', async () => {
    const { session, mount } = await fixture()
    session.setPermissionMode('auto')
    const app = mount()
    try {
      app.stdin.write('write it')
      await tick()
      app.stdin.write('\r')
      await tick()
      expect(app.lastFrame()).toContain('Inspect the file first.')
      app.stdin.write('\u000f')
      await tick()
      expect(app.lastFrame()).not.toContain('Inspect the file first.')
      expect(app.lastFrame()).toContain('Write finished.')
      app.stdin.write('\u000f')
      await tick()
      expect(app.lastFrame()).toContain('Inspect the file first.')
    } finally {
      app.unmount()
    }
  })
})
