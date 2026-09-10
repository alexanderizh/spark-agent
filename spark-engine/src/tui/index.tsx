import { render, type RenderOptions } from 'ink'
import React from 'react'

import { loadCustomCommands, type CustomCommand } from '../commands/custom-commands.js'
import { persistCliPreferences } from '../config/model-config.js'
import { createDefaultEnv, defaultSparkHome } from '../env.js'
import type { PermissionMode } from '../permission/types.js'
import type { LlmService, SessionMeta } from '../seams.js'
import { InteractiveApprover } from '../permission/interactive.js'
import { SLASH_COMMANDS } from './slash-commands.js'
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
  /** Whether permissionMode came from an explicit CLI flag. */
  readonly permissionModeExplicit?: boolean | undefined
  /** In-TUI /update channel; the CLI layer injects the real transaction. */
  readonly updateRunner?: SparkUpdateRunner | undefined
  /** Initial reasoning effort (from --effort); adjustable via /effort. */
  readonly reasoningEffort?: ReasoningEffort | undefined
  /**
   * Startup model-resolution failure. When set (with no llm/model), the TUI
   * still opens and shows the onboarding picker instead of dying in the shell.
   */
  readonly startupError?: string | undefined
  /** Resume a recorded session instead of creating a new one (ledger replay). */
  readonly resumeSessionId?: string | undefined
  /** Open the session picker at startup (bare `spark --resume`). */
  readonly resumePicker?: boolean | undefined
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
  const permissionMode = options.permissionMode ?? 'manual'
  const permissionModeExplicit =
    options.permissionModeExplicit ?? options.permissionMode !== undefined
  let currentModel = options.model
  const createSession = async (): Promise<AgentSession> =>
    agent.newSession({
      permissionMode,
      ...(currentModel === undefined ? {} : { model: currentModel }),
    })
  // Resume keeps the mode recorded in the ledger; an explicitly passed
  // --permission-mode overrides it, matching the print/plain paths.
  const session =
    options.resumeSessionId === undefined
      ? await createSession()
      : await agent.openSession(options.resumeSessionId)
  if (
    options.resumeSessionId !== undefined &&
    permissionModeExplicit &&
    options.permissionMode !== undefined
  ) {
    session.setPermissionMode(options.permissionMode)
  }
  const permission = session.permissionMode
  const initialEvents = await collect(session)
  const customCommands = await loadCustomCommands({
    cwd,
    ...(options.dataRoot === undefined ? {} : { userDir: options.dataRoot }),
    reservedNames: SLASH_COMMANDS.map((command) => command.name),
  }).catch(() => [])
  let preferencesWrite: Promise<void> = Promise.resolve()
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
      openSession={(sessionId) => agent.openSession(sessionId)}
      listSessions={() => agent.listSessions()}
      switchable={switchable}
      cwd={cwd}
      initialModel={options.model}
      startupError={options.startupError}
      permissionMode={permission}
      persistPreferences={(preferences) => {
        const next = preferencesWrite
          .catch(() => undefined)
          .then(async () => {
            await persistCliPreferences({ sparkHome: defaultSparkHome(), ...preferences })
          })
        preferencesWrite = next
        return next
      }}
      resumePicker={options.resumePicker === true ? true : undefined}
      {...(options.updateRunner === undefined ? {} : { updateRunner: options.updateRunner })}
      {...(options.version === undefined ? {} : { version: options.version })}
      {...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort })}
      {...(customCommands.length === 0 ? {} : { customCommands })}
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
  readonly openSession: (sessionId: string) => Promise<AgentSession>
  readonly listSessions: () => Promise<readonly SessionMeta[]>
  readonly switchable: SwitchableLlmService
  readonly initialModel?: string | undefined
  readonly startupError?: string | undefined
  readonly version?: string | undefined
  readonly permissionMode: PermissionMode
  readonly resumePicker?: boolean | undefined
  readonly updateRunner?: SparkUpdateRunner | undefined
  readonly reasoningEffort?: ReasoningEffort | undefined
  readonly persistPreferences?: (preferences: {
    readonly permissionMode: PermissionMode
    readonly reasoningEffort: ReasoningEffort
  }) => Promise<void>
  readonly customCommands?: readonly CustomCommand[] | undefined
  readonly cwd?: string | undefined
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
      openSession={props.openSession}
      listSessions={props.listSessions}
      permissionMode={props.permissionMode}
      {...(props.persistPreferences === undefined
        ? {}
        : { persistPreferences: props.persistPreferences })}
      {...(props.resumePicker === true ? { resumePicker: true } : {})}
      {...(props.updateRunner === undefined ? {} : { updateRunner: props.updateRunner })}
      {...(props.version === undefined ? {} : { version: props.version })}
      {...(props.reasoningEffort === undefined ? {} : { reasoningEffort: props.reasoningEffort })}
      {...(props.customCommands === undefined ? {} : { customCommands: props.customCommands })}
      {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
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
export * from './display-name.js'
export * from './components/input-editor.js'
export * from './components/effort-picker.js'
export * from './components/markdown.js'
export * from './components/permission-card.js'
export * from './components/session-picker.js'
export * from './components/rows.js'
export * from './components/scroll-region.js'
export * from './components/spinner.js'
export * from './components/welcome.js'
