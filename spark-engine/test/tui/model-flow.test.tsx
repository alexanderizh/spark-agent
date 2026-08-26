import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { FakeModel } from '../../src/llm/fake/model.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { SwitchableLlmService } from '../../src/llm/switchable.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { RulePermissionPolicy } from '../../src/permission/policy.js'
import { Agent, type AgentSession } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import { ModelPicker, ProviderConfigForm } from '../../src/tui/model-flow.js'
import { useModelRuntime, type ModelRuntimeSeams } from '../../src/tui/use-model-runtime.js'
import { defaultTheme } from '../../src/tui/theme.js'
import type { ConfiguredModelCatalog } from '../../src/config/model-config.js'
import type { AgentEvent } from '../../src/events/schema.js'

const CAPABILITIES = { color: 'mono' as const, unicode: false, width: 100 }

describe('ModelPicker', () => {
  it('renders the catalog and selects entries with the keyboard', async () => {
    const onSelect = vi.fn()
    const app = render(
      <ModelPicker
        catalog={fakeCatalog()}
        refreshing={false}
        busy={false}
        notice={undefined}
        error={undefined}
        selectedModel={undefined}
        theme={defaultTheme}
        canClose={false}
        onSelect={onSelect}
        onConfigureLocal={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
        onExit={vi.fn()}
      />,
    )
    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('gpt-host')
    expect(frame).toContain('[sparkwork]')

    app.stdin.write('\u001b[B') // down
    await flush()
    app.stdin.write('\r')
    await flush()
    expect(onSelect).toHaveBeenCalledWith('local-main')
  })

  it('exposes configure and refresh shortcuts and closes only when allowed', async () => {
    const onConfigureLocal = vi.fn()
    const onRefresh = vi.fn()
    const onClose = vi.fn()
    const app = render(
      <ModelPicker
        catalog={fakeCatalog()}
        refreshing={false}
        busy={false}
        notice={undefined}
        error={undefined}
        selectedModel={undefined}
        theme={defaultTheme}
        canClose={false}
        onSelect={vi.fn()}
        onConfigureLocal={onConfigureLocal}
        onRefresh={onRefresh}
        onClose={onClose}
        onExit={vi.fn()}
      />,
    )
    app.stdin.write('c')
    await flush()
    expect(onConfigureLocal).toHaveBeenCalledTimes(1)
    app.stdin.write('r')
    await flush()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    app.stdin.write('\u001b') // esc: unconfigured must not close
    await flush()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ProviderConfigForm', () => {
  it('walks the fields, derives defaults, and submits a credential-free draft', async () => {
    const onSubmit = vi.fn()
    const app = render(
      <ProviderConfigForm
        theme={defaultTheme}
        error={undefined}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        onExit={vi.fn()}
      />,
    )
    app.stdin.write('2') // anthropic-messages
    await flush()
    app.stdin.write('\r')
    await flush()
    app.stdin.write('claude-sonnet-4-5')
    await flush()
    app.stdin.write('\r') // model id → base_url
    await flush()
    app.stdin.write('\r') // base_url skipped
    await flush()
    app.stdin.write('\r') // api key env skipped → default
    await flush()
    app.stdin.write('\r') // alias skipped → derived
    await flush()
    expect(app.lastFrame()).toContain('claude-sonnet-4-5')
    expect(app.lastFrame()).toContain('ANTHROPIC_API_KEY')
    app.stdin.write('\r') // confirm
    await flush()
    expect(onSubmit).toHaveBeenCalledWith({
      alias: 'claude-sonnet-4-5',
      protocol: 'anthropic-messages',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      modelId: 'claude-sonnet-4-5',
    })
  })

  it('cancels back to the picker on escape', async () => {
    const onCancel = vi.fn()
    const app = render(
      <ProviderConfigForm
        theme={defaultTheme}
        error={undefined}
        onSubmit={vi.fn()}
        onCancel={onCancel}
        onExit={vi.fn()}
      />,
    )
    app.stdin.write('\u001b')
    await sleep(250)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('unconfigured TUI onboarding', () => {
  it('shows the picker, blocks turns until a model is selected, then runs turns', async () => {
    const harness = await createHarness()
    const frame1 = harness.app.lastFrame() ?? ''
    expect(frame1).toContain('gpt-host')

    // The picker owns the keyboard while open: typing must not start a turn.
    harness.app.stdin.write('hello\r')
    await flush(20)
    expect(harness.app.lastFrame()).toContain('选择模型')
    expect(harness.app.lastFrame()).not.toContain('step')

    // Select the first SparkWork route with Enter; the harness runtime installs
    // the FakeModel-based service on the shared switchable.
    harness.app.stdin.write('\r')
    await flush(20)
    expect(harness.seams.createRuntime).toHaveBeenCalledWith({
      cwd: expect.any(String),
      model: 'sparkwork:p1:gpt-host',
    })
    expect(harness.app.lastFrame() ?? '').toContain('gpt-host')

    harness.app.stdin.write('hi')
    await flush()
    harness.app.stdin.write('\r')
    await flush(40)
    const frame2 = harness.app.lastFrame() ?? ''
    expect(frame2).toContain('host done')
    harness.app.unmount()
  })

  it('runs the terminal provider configuration flow end to end', async () => {
    const harness = await createHarness()
    harness.app.stdin.write('c')
    await flush()
    expect(harness.app.lastFrame()).toContain('配置本地模型渠道')

    for (const step of ['\r', 'gpt-5.6', '\r', '\r', '\r', '\r', '\r']) {
      harness.app.stdin.write(step)
      await flush()
    }
    await flush(20)
    expect(harness.seams.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: 'gpt-5-6',
        protocol: 'openai-responses',
        apiKeyEnv: 'OPENAI_API_KEY',
        modelId: 'gpt-5.6',
      }),
    )
    const frame = harness.app.lastFrame() ?? ''
    expect(frame).not.toContain('配置本地模型渠道')
    expect(frame).not.toContain('选择模型')
    harness.app.unmount()
  })
})

interface Harness {
  readonly app: ReturnType<typeof render>
  readonly seams: FakeSeams
  readonly switchable: SwitchableLlmService
}

interface FakeSeams extends ModelRuntimeSeams {
  readonly createRuntime: ReturnType<typeof vi.fn>
  readonly configure: ReturnType<typeof vi.fn>
  readonly inspect: ReturnType<typeof vi.fn>
}

async function createHarness(): Promise<Harness> {
  const llm = new FakeModel([text('host done')])
  const seams: FakeSeams = {
    cwd: '/workspace',
    sparkHome: '/tmp/spark-test-home',
    inspect: vi.fn(async () => fakeCatalog()),
    createRuntime: vi.fn(async () => ({
      service: llm,
      modelId: 'sparkwork:p1:gpt-host',
      route: ['sparkwork:p1:gpt-host'],
      configSnapshot: {},
    })),
    configure: vi.fn(async (input: { alias: string }) => ({
      configPath: '/tmp/spark-test-home/config.toml',
      modelEntryId: input.alias,
    })),
  }
  // The second runtime (after configureLocal) reuses the same fake service.
  seams.createRuntime.mockImplementation(async (options: { model: string }) => ({
    service: llm,
    modelId: options.model,
    route: [options.model],
    configSnapshot: {},
  }))

  const approver = new InteractiveApprover()
  const switchable = new SwitchableLlmService()
  const env = {
    ...createDeterministicEnv([]),
    llm: switchable,
    permission: { policy: new RulePermissionPolicy(), approver },
  }
  const agent = Agent.open({ cwd: '/workspace', env })
  const session = await agent.newSession()
  const initial: AgentEvent[] = []
  for await (const event of session.events()) initial.push(event)

  const app = render(
    <HarnessApp
      session={session}
      initialEvents={initial}
      approver={approver}
      createSession={async () => agent.newSession()}
      seams={seams}
      switchable={switchable}
    />,
  )
  await flush(10)
  return { app, seams, switchable }
}

interface HarnessAppProps {
  readonly session: AgentSession
  readonly initialEvents: readonly AgentEvent[]
  readonly approver: InteractiveApprover
  readonly createSession: () => Promise<AgentSession>
  readonly seams: ModelRuntimeSeams
  readonly switchable: SwitchableLlmService
}

function HarnessApp(props: HarnessAppProps): React.ReactElement {
  const modelRuntime = useModelRuntime({ switchable: props.switchable, seams: props.seams })
  return (
    <SparkTuiApp
      initialSession={props.session}
      initialEvents={props.initialEvents}
      approver={props.approver}
      createSession={props.createSession}
      modelRuntime={modelRuntime}
      capabilities={CAPABILITIES}
    />
  )
}

function fakeCatalog(): ConfiguredModelCatalog {
  return {
    entries: [
      {
        id: 'sparkwork:p1:gpt-host',
        source: 'sparkwork',
        providerId: 'p1',
        providerName: 'P One',
        protocol: 'openai-responses',
        model: 'gpt-host',
        selected: false,
      },
      {
        id: 'local-main',
        source: 'local',
        providerId: 'local',
        providerName: 'local',
        protocol: 'anthropic-messages',
        model: 'claude-x',
        selected: false,
      },
    ],
    sparkWorkConnected: true,
    sparkWorkStaleBridgeDescriptors: 0,
  }
}

async function flush(ticks = 3): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
