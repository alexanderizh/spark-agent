import { render, type RenderOptions } from 'ink'
import React from 'react'

import { createDefaultEnv } from '../env.js'
import type { PermissionMode } from '../permission/types.js'
import type { LlmService } from '../seams.js'
import { InteractiveApprover } from '../permission/interactive.js'
import { Agent, type AgentSession } from '../sdk/agent.js'
import type { AgentEvent } from '../events/schema.js'
import { SwitchableLlmService } from '../llm/switchable.js'
import type { ReasoningEffort } from '../llm/types.js'
import { SparkTuiApp } from './app.js'
import { useModelRuntime } from './use-model-runtime.js'
import { detectTerminalCapabilities } from './theme.js'
import type { SparkUpdateRunner } from './update-runner.js'

export interface RunTuiOptions {
  readonly cwd?: string
  readonly dataRoot?: string
  readonly stdout?: NodeJS.WriteStream
  readonly stdin?: NodeJS.ReadStream
  readonly llm?: LlmService | undefined
  readonly model?: string | undefined
  /** Real package version for the welcome screen; avoids stale fallback text. */
  readonly version?: string | undefined
  readonly permissionMode?: PermissionMode | undefined
  /** In-TUI /update channel; the CLI layer injects the real transaction. */
  readonly updateRunner?: SparkUpdateRunner | undefined
  /** Initial reasoning effort (from --effort); adjustable via /effort. */
  readonly reasoningEffort?: ReasoningEffort | undefined
  /**
   * Startup model-resolution failure. When set (with no llm/model), the TUI
   * still opens and shows the onboarding picker instead of dying in the shell.
   */
  readonly startupError?: string | undefined
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const approver = new InteractiveApprover()
  const switchable = new SwitchableLlmService()
  if (options.llm) switchable.set(options.llm)
  const env = createDefaultEnv({
    cwd,
    approver,
    llm: switchable,
    ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
  })
  const agent = Agent.open({ cwd, env })
  const permissionMode = options.permissionMode ?? 'default'
  let currentModel = options.model
  const createSession = async (): Promise<AgentSession> =>
    agent.newSession({
      permissionMode,
      ...(currentModel === undefined ? {} : { model: currentModel }),
    })
  const session = await createSession()
  const initialEvents = await collect(session)
  const stdout = options.stdout ?? process.stdout
  const renderOptions: RenderOptions = {
    stdout,
    stdin: options.stdin ?? process.stdin,
    exitOnCtrlC: false,
    maxFps: 30,
    incrementalRendering: true,
    alternateScreen: false,
  }
  const instance = render(
    <SparkTuiRoot
      initialSession={session}
      initialEvents={initialEvents}
      approver={approver}
      createSession={createSession}
      switchable={switchable}
      initialModel={options.model}
      startupError={options.startupError}
      permissionMode={permissionMode}
      {...(options.updateRunner === undefined ? {} : { updateRunner: options.updateRunner })}
      {...(options.version === undefined ? {} : { version: options.version })}
      {...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort })}
      onModelChanged={(model) => {
        currentModel = model
      }}
      stdout={stdout}
    />,
    renderOptions,
  )
  await instance.waitUntilExit()
}

interface SparkTuiRootProps {
  readonly initialSession: AgentSession
  readonly initialEvents: readonly AgentEvent[]
  readonly approver: InteractiveApprover
  readonly createSession: () => Promise<AgentSession>
  readonly switchable: SwitchableLlmService
  readonly initialModel?: string | undefined
  readonly startupError?: string | undefined
  readonly version?: string | undefined
  readonly permissionMode: PermissionMode
  readonly updateRunner?: SparkUpdateRunner | undefined
  readonly reasoningEffort?: ReasoningEffort | undefined
  readonly onModelChanged: (model: string | undefined) => void
  readonly stdout: NodeJS.WriteStream
}

function SparkTuiRoot(props: SparkTuiRootProps): React.ReactElement {
  const modelRuntime = useModelRuntime({
    switchable: props.switchable,
    ...(props.initialModel === undefined ? {} : { initialModel: props.initialModel }),
    ...(props.startupError === undefined ? {} : { startupError: props.startupError }),
    onModelChanged: props.onModelChanged,
  })
  return (
    <SparkTuiApp
      initialSession={props.initialSession}
      initialEvents={props.initialEvents}
      approver={props.approver}
      createSession={props.createSession}
      permissionMode={props.permissionMode}
      {...(props.updateRunner === undefined ? {} : { updateRunner: props.updateRunner })}
      {...(props.version === undefined ? {} : { version: props.version })}
      {...(props.reasoningEffort === undefined ? {} : { reasoningEffort: props.reasoningEffort })}
      modelRuntime={modelRuntime}
      capabilities={detectTerminalCapabilities(props.stdout)}
    />
  )
}

async function collect(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of session.events()) events.push(event)
  return events
}

export * from './app.js'
export * from './ime-guard.js'
export * from './model-flow.js'
export * from './use-model-runtime.js'
export * from './projection.js'
export * from './theme.js'
export * from './update-runner.js'
export * from './components/input-editor.js'
export * from './components/permission-card.js'
export * from './components/rows.js'
export * from './components/spinner.js'
export * from './components/welcome.js'
