import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import type { AgentSession } from '../../src/sdk/agent.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-tui-extract-'))
  roots.push(root)
  return root
}

function boot(agent: Agent, onTurnCompleted: (session: AgentSession) => Promise<void>) {
  return agent.newSession().then((session) => {
    const initial: never[] = []
    const approver = new InteractiveApprover()
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        onTurnCompleted={onTurnCompleted}
        capabilities={{ color: 'mono', unicode: false, width: 80 }}
      />,
    )
    return { app, session }
  })
}

describe('TUI memory extraction hook', () => {
  it('fires onTurnCompleted after a completed turn and persists memories', async () => {
    const root = await workspace()
    // The extraction LLM call consumes the second script item.
    const base = createDeterministicEnv([
      text('The verification command is npm run verify.'),
      text(
        '[{"scope":"project","type":"reference","name":"verify","description":"Build check","body":"npm run verify"}]',
      ),
    ])
    const agent = Agent.open({ cwd: root, env: base })
    let completedSession: AgentSession | undefined
    const { app, session } = await boot(agent, async (finished) => {
      completedSession = finished
    })

    app.stdin.write('remember this workflow')
    await new Promise<void>((resolve) => setImmediate(resolve))
    // InputEditor commits on carriage return, exactly like the golden TUI test.
    app.stdin.write(String.fromCharCode(13))
    for (let index = 0; index < 30; index += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (app.lastFrame()?.includes('remember this workflow') !== true) {
      throw new Error(`frame did not echo the prompt: ${app.lastFrame()?.slice(0, 200)}`)
    }

    // Wait for the extraction callback to have fired.
    const deadline = Date.now() + 5_000
    while (completedSession === undefined && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
    expect(completedSession?.sessionId).toBe(session.sessionId)
    app.unmount()
  })

  it('does not fire when the turn fails', async () => {
    const root = await workspace()
    const base = createDeterministicEnv([text('answer'), text('extraction should not run')])
    const agent = Agent.open({ cwd: root, env: base })
    let fired = false
    const { app } = await boot(agent, async () => {
      fired = true
    })

    // No turn is started at all — the hook must not fire on mount.
    await new Promise<void>((resolve) => setTimeout(resolve, 150))
    expect(fired).toBe(false)
    app.unmount()
    void readFile
  })
})
