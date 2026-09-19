import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import { createDeterministicEnv } from '../../src/env.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { SLASH_COMMANDS, TUI_SHORTCUTS } from '../../src/tui/slash-commands.js'
import { collectEvents } from '../helpers.js'

const ROOT = '/workspace'

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

/** Boots the TUI with a real (fake-model) session and runs one slash command. */
async function runCommand(command: string): Promise<readonly string[]> {
  const env = createDeterministicEnv([text('ok')])
  const agent = Agent.open({ cwd: ROOT, env })
  const session = await agent.newSession()
  const initial = await collectEvents(session)
  const app = render(
    <SparkTuiApp
      initialSession={session}
      initialEvents={initial}
      approver={new InteractiveApprover()}
      createSession={async () => agent.newSession()}
      model="fake-m1"
      capabilities={{ color: 'mono', unicode: false, width: 120, height: 44 }}
    />,
  )
  app.stdin.write(command)
  await settle()
  app.stdin.write(String.fromCharCode(13))
  await settle()
  const frame = stripAnsi(app.lastFrame() ?? '')
  app.unmount()
  return frame.split('\n')
}

describe('/help command', () => {
  it('renders one aligned line per command and shortcut', async () => {
    const lines = await runCommand('/help')
    expect(lines).toContain('命令：')
    expect(lines).toContain('快捷键：')

    // Every entry owns its line: its summary sits on the label's own row.
    const entries = [
      ...SLASH_COMMANDS.map((command) => ({ label: command.name, summary: command.summary })),
      ...TUI_SHORTCUTS.map((shortcut) => ({ label: shortcut.keys, summary: shortcut.summary })),
    ]
    const columns = entries.map((entry) => {
      const rows = lines.filter((line) => line.trimStart().startsWith(`${entry.label} `))
      expect(rows, `no dedicated /help row for ${entry.label}`).toHaveLength(1)
      const row = rows[0] ?? ''
      expect(row).toContain(entry.summary)
      return row.indexOf(entry.summary)
    })
    // One shared label column for the whole list, not a per-section grid.
    expect(new Set(columns).size).toBe(1)
  })

  it('keeps the last shortcut row visible inside the terminal height', async () => {
    const lines = await runCommand('/help')
    const tail = lines.find((line) => line.includes('Ctrl+C×2'))
    expect(tail, '/help is clipped by the notice region').toBeDefined()
    expect(tail).toContain('退出')
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
