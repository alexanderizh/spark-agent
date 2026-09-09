#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  inspectConfiguredModels,
  loadConfiguredModel,
  type ConfiguredModelCatalog,
  type ConfiguredModelRuntime,
} from '../config/model-config.js'
import { createDefaultEnv, defaultSparkHome } from '../env.js'
import { JsonlSessionStore, shortSessionId } from '../events/ledger.js'
import type { AgentEvent } from '../events/schema.js'
import type { LlmDelta, ReasoningEffort } from '../llm/types.js'
import { isReasoningEffort } from '../llm/types.js'
import { isPermissionMode, type PermissionMode } from '../permission/types.js'
import { Agent, type AgentSession } from '../sdk/agent.js'
import {
  buildInstallReport,
  findSparkOnPath,
  initSparkConfig,
  installLauncher,
  launcherPathFor,
  resolveSparkInstall,
  uninstallLauncher,
  type InstallReport,
} from './install.js'
import { installWarnings, renderInstallReport } from './diagnostics.js'
import { executeUpdate } from './update.js'
import { uninstallSparkPackage } from './uninstall-package.js'
import { NOTICE_TIMEOUT_MS, updateNoticeLine } from './update-notice.js'
import type { SparkUpdateRunner } from '../tui/update-runner.js'

interface CliOptions {
  readonly help: boolean
  readonly version: boolean
  readonly plain: boolean
  readonly json: boolean
  /** Machine-readable output contract for a single task invocation. */
  readonly outputFormat: CliOutputFormat
  /** Backward-compatible `--json` event JSONL, which predates output-format. */
  readonly legacyJson: boolean
  readonly prompt?: string
  readonly model?: string
  readonly bin?: string
  readonly base?: string
  readonly target?: string
  readonly force: boolean
  readonly check: boolean
  readonly allowPrerelease: boolean
  readonly package: boolean
  readonly permissionMode: PermissionMode
  readonly permissionModeExplicit: boolean
  readonly reasoningEffort?: ReasoningEffort
  readonly continueSession: boolean
  /** '' = picker sentinel (bare --resume); a concrete session id otherwise. */
  readonly resume?: string
  readonly positionals: readonly string[]
}

type CliOutputFormat = 'text' | 'json' | 'stream-json'

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: CliOptions
  try {
    options = parseCli(argv)
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n\n${helpText()}`)
    return 2
  }
  if (options.help) {
    process.stdout.write(helpText(await runningVersion()))
    return 0
  }
  if (options.version) {
    process.stdout.write(`${await runningVersion()}\n`)
    return 0
  }
  if (options.positionals[0] === 'serve') {
    process.stderr.write(
      'spark serve is not part of the M1 kernel slice; the versioned App Server lands in M3.\n',
    )
    return 2
  }
  if (options.positionals[0] === 'models' || options.positionals[0] === 'doctor') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write(`${options.positionals[0]} does not accept a task prompt.\n`)
      return 2
    }
    return inspectModels(options.positionals[0], options.json)
  }
  const maintenance = options.positionals[0]
  if (maintenance === 'update' || maintenance === 'upgrade') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write(`spark ${maintenance} does not accept extra arguments.\n`)
      return 2
    }
    return executeUpdate(
      {
        checkOnly: options.check,
        ...(options.base === undefined ? {} : { base: options.base }),
        ...(options.target === undefined ? {} : { target: options.target }),
        allowPrerelease: options.allowPrerelease,
        json: options.json,
        sparkHome: defaultSparkHome(),
      },
      {
        stdout: (text) => {
          process.stdout.write(text)
        },
        stderr: (text) => {
          process.stderr.write(text)
        },
      },
    )
  }
  if (maintenance === 'install' || maintenance === 'uninstall' || maintenance === 'init') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write(`spark ${maintenance} does not accept extra arguments.\n`)
      return 2
    }
    return runMaintenanceCommand(maintenance, options)
  }
  if (maintenance === 'sessions') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write('spark sessions does not accept extra arguments.\n')
      return 2
    }
    return listSessionsCommand(options.json)
  }

  const positionalPrompt = options.positionals.join(' ').trim()
  let prompt = options.prompt ?? positionalPrompt
  if (!prompt && !process.stdin.isTTY) prompt = (await readStdin()).trim()

  const tuiAvailable =
    !options.plain &&
    !options.json &&
    options.outputFormat === 'text' &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    process.env.CI !== 'true' &&
    process.env.TERM !== 'dumb'
  if (tuiAvailable && !prompt) {
    // Interactive first-run contract: enter the TUI even without a configured
    // model — the onboarding picker resolves or configures one in-terminal.
    // The daily update notice check starts here and is awaited with a hard
    // budget after the TUI exits, so a slow release host never blocks startup.
    const noticePromise = updateNoticeLine({
      sparkHome: defaultSparkHome(),
      cwd: process.cwd(),
      currentVersion: await runningVersion(),
    }).catch(() => undefined)
    const { runTui } = await import('../tui/index.js')
    let runtime: ConfiguredModelRuntime | undefined
    let startupError: string | undefined
    try {
      runtime = await loadConfiguredModel({
        cwd: process.cwd(),
        ...(options.model === undefined ? {} : { model: options.model }),
      })
    } catch (error) {
      startupError = terminalSafe(message(error))
    }
    let resumeSessionId: string | undefined
    try {
      resumeSessionId = await resolveResumeTarget(options)
    } catch (error) {
      process.stderr.write(`${terminalSafe(message(error))}\n`)
      return 2
    }
    await runTui({
      cwd: process.cwd(),
      version: await runningVersion(),
      updateRunner: createTuiUpdateRunner(),
      ...(options.permissionModeExplicit ? { permissionMode: options.permissionMode } : {}),
      ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      ...(options.resume === '' ? { resumePicker: true } : {}),
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
      ...(runtime ? { llm: runtime.service, model: runtime.modelId } : { startupError }),
    })
    const notice = await Promise.race([
      noticePromise,
      new Promise<undefined>((resolveNotice) => {
        setTimeout(resolveNotice, NOTICE_TIMEOUT_MS, undefined)
      }),
    ])
    if (notice !== undefined) process.stderr.write(`${notice}\n`)
    return 0
  }

  // Usage errors take precedence over model-resolution errors: a bad or
  // non-TTY --resume must be reported even when no model is configured yet.
  let resumeSessionId: string | undefined
  try {
    resumeSessionId = await resolveResumeTarget(options)
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
  if (resumeSessionId === undefined && options.resume === '') {
    process.stderr.write(
      'Bare --resume opens the interactive session picker; pickers need a TUI.\n',
    )
    return 2
  }
  let runtime: ConfiguredModelRuntime
  try {
    runtime = await loadConfiguredModel({
      cwd: process.cwd(),
      ...(options.model === undefined ? {} : { model: options.model }),
    })
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
  if (prompt) return runOnce(prompt, options, runtime, resumeSessionId)

  if (process.stdin.isTTY && process.stdout.isTTY && options.plain) {
    return runPlainRepl(runtime, options, resumeSessionId)
  }
  process.stderr.write(
    'No task was provided. Pass a prompt, pipe stdin, or run spark in an interactive TTY.\n',
  )
  return 2
}

async function runMaintenanceCommand(
  command: 'install' | 'uninstall' | 'init',
  options: CliOptions,
): Promise<number> {
  const binDir = resolve(options.bin ?? join(defaultSparkHome(), 'bin'))
  try {
    if (command === 'init') {
      const result = await initSparkConfig(defaultSparkHome())
      if (result.created) {
        process.stdout.write(
          `Created ${result.path} with a starter configuration.\n` +
            'Next: export your provider credential (see api_key_env in the file), then run `spark models`.\n',
        )
      } else {
        process.stdout.write(`${result.path} already exists; leaving it unchanged.\n`)
      }
      return 0
    }
    if (command === 'uninstall') {
      if (options.package) {
        return await uninstallSparkPackage(
          { sparkHome: defaultSparkHome(), binDir },
          {
            stdout: (text) => {
              process.stdout.write(text)
            },
            stderr: (text) => {
              process.stderr.write(text)
            },
          },
          options.json,
        )
      }
      const result = await uninstallLauncher({ binDir })
      const launcher = launcherPathFor(binDir, process.platform)
      process.stdout.write(
        result === 'removed'
          ? `Removed launcher ${launcher}.\n`
          : `No spark launcher found at ${launcher}.\n`,
      )
      return 0
    }
    const install = await resolveSparkInstall()
    const result = await installLauncher({ install, binDir, force: options.force })
    const candidates = await findSparkOnPath()
    process.stdout.write(
      `Spark v${install.version} at ${install.root}\n` +
        (result.replaced ? 'Replaced existing launcher:\n' : 'Installed launcher:\n') +
        `  ${result.launcherPath} -> ${install.entry}\n`,
    )
    for (const warning of installWarnings(binDir, candidates, process.env.PATH)) {
      process.stdout.write(`${warning}\n`)
    }
    process.stdout.write('Verify with: spark doctor\n')
    return 0
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
}

async function inspectModels(command: 'models' | 'doctor', json: boolean): Promise<number> {
  let catalog: ConfiguredModelCatalog
  try {
    catalog = await inspectConfiguredModels({ cwd: process.cwd() })
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
  let configurationError: string | undefined
  if (command === 'doctor') {
    try {
      await loadConfiguredModel({ cwd: process.cwd() })
    } catch (error) {
      configurationError = terminalSafe(message(error))
    }
  }
  let report: InstallReport | undefined
  let reportError: string | undefined
  if (command === 'doctor') {
    try {
      report = await buildInstallReport({
        install: await resolveSparkInstall(),
        sparkHome: defaultSparkHome(),
      })
    } catch (error) {
      reportError = terminalSafe(message(error))
    }
  }
  const exitCode = catalog.entries.length > 0 && !configurationError ? 0 : 1
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        ...catalog,
        configurationReady: !configurationError,
        ...(configurationError ? { configurationError } : {}),
        ...(report ? { install: report } : reportError ? { installError: reportError } : {}),
      })}\n`,
    )
    return exitCode
  }
  if (command === 'doctor') {
    process.stdout.write(
      `SparkWork bridge: ${catalog.sparkWorkConnected ? 'connected' : 'not connected'}\n`,
    )
    if (catalog.sparkWorkDiagnostic) {
      process.stdout.write(`Diagnostic: ${terminalSafe(catalog.sparkWorkDiagnostic)}\n`)
    }
    if (catalog.sparkWorkStaleBridgeDescriptors > 0) {
      process.stdout.write(
        `Stale bridge descriptors: ${catalog.sparkWorkStaleBridgeDescriptors} (left by SparkWork instances that are no longer running; ignored)\n`,
      )
    }
    process.stdout.write(`Selected model: ${terminalSafe(catalog.selectedModel ?? 'none')}\n`)
    process.stdout.write(`Available models: ${catalog.entries.length}\n`)
    process.stdout.write(
      `Configuration: ${configurationError ? `error — ${configurationError}` : 'ready'}\n`,
    )
    if (report) process.stdout.write(renderInstallReport(report))
    else if (reportError) process.stdout.write(`Install: unavailable — ${reportError}\n`)
    return exitCode
  }
  if (catalog.entries.length === 0) {
    process.stdout.write(
      'No models are available. Open SparkWork, or run `spark init` to configure ~/.spark/config.toml.\n',
    )
    if (catalog.sparkWorkDiagnostic) {
      process.stdout.write(`${terminalSafe(catalog.sparkWorkDiagnostic)}\n`)
    }
    return 1
  }
  for (const entry of catalog.entries) {
    const marker = entry.selected ? '*' : ' '
    process.stdout.write(
      `${marker} ${terminalSafe(entry.model)}  ${terminalSafe(entry.providerName)}  ${entry.protocol}  [${entry.source}]\n`,
    )
  }
  return 0
}

/**
 * node:util parseArgs rejects a valueless `--resume`; users expect
 * `spark --resume` (no id) to open the in-TUI session picker. Rewrite a bare
 * flag into an empty-string value before parsing — '' is the picker sentinel.
 */
function normalizeResumeArgv(argv: readonly string[]): string[] {
  const out = [...argv]
  for (let index = 0; index < out.length; index += 1) {
    const token = out[index]
    if (token === '--resume' || token === '-r') {
      const next = out[index + 1]
      if (next === undefined || next.startsWith('-')) out.splice(index + 1, 0, '')
    }
  }
  return out
}

function parseCli(argv: readonly string[]): CliOptions {
  const parsed = parseArgs({
    args: normalizeResumeArgv(argv),
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'V', default: false },
      plain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      prompt: { type: 'string', short: 'p' },
      model: { type: 'string', short: 'm' },
      bin: { type: 'string' },
      base: { type: 'string' },
      target: { type: 'string' },
      check: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'allow-prerelease': { type: 'boolean', default: false },
      package: { type: 'boolean', default: false },
      effort: { type: 'string' },
      'permission-mode': { type: 'string' },
      'dangerously-skip-permissions': { type: 'boolean', default: false },
      'output-format': { type: 'string' },
      continue: { type: 'boolean', short: 'c', default: false },
      resume: { type: 'string', short: 'r' },
    },
  })
  const requestedOutputFormat = parsed.values['output-format']
  if (requestedOutputFormat && !['text', 'json', 'stream-json'].includes(requestedOutputFormat)) {
    throw new Error(`Unsupported --output-format: ${requestedOutputFormat}`)
  }
  if (
    parsed.values.json &&
    requestedOutputFormat !== undefined &&
    requestedOutputFormat !== 'stream-json'
  ) {
    throw new Error('--json conflicts with --output-format text/json; use stream-json explicitly')
  }
  const legacyJson = parsed.values.json && requestedOutputFormat === undefined
  const outputFormat =
    requestedOutputFormat === undefined
      ? legacyJson
        ? 'stream-json'
        : 'text'
      : (requestedOutputFormat as CliOutputFormat)
  const configuredPermissionMode = parsed.values['permission-mode']
  if (configuredPermissionMode !== undefined && !isPermissionMode(configuredPermissionMode)) {
    throw new Error(`Unsupported --permission-mode: ${configuredPermissionMode}`)
  }
  const configuredEffort = parsed.values.effort
  if (configuredEffort !== undefined && !isReasoningEffort(configuredEffort)) {
    throw new Error(`Unsupported --effort: ${configuredEffort} (off | low | medium | high | max)`)
  }
  const dangerousBypass = parsed.values['dangerously-skip-permissions'] ?? false
  if (dangerousBypass && configuredPermissionMode && configuredPermissionMode !== 'bypass') {
    throw new Error('--dangerously-skip-permissions conflicts with --permission-mode')
  }
  const continueLatest = parsed.values.continue ?? false
  const resume = parsed.values.resume
  if (continueLatest && resume !== undefined) {
    throw new Error('--continue and --resume are mutually exclusive')
  }
  return {
    help: parsed.values.help ?? false,
    version: parsed.values.version ?? false,
    plain: parsed.values.plain,
    json: parsed.values.json || outputFormat !== 'text',
    outputFormat,
    legacyJson,
    ...(parsed.values.prompt === undefined ? {} : { prompt: parsed.values.prompt }),
    ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
    ...(parsed.values.bin === undefined ? {} : { bin: parsed.values.bin }),
    ...(parsed.values.base === undefined ? {} : { base: parsed.values.base }),
    ...(parsed.values.target === undefined ? {} : { target: parsed.values.target }),
    force: parsed.values.force ?? false,
    check: parsed.values.check ?? false,
    allowPrerelease: parsed.values['allow-prerelease'] ?? false,
    package: parsed.values.package ?? false,
    permissionMode: dangerousBypass ? 'bypass' : (configuredPermissionMode ?? 'manual'),
    permissionModeExplicit: dangerousBypass || configuredPermissionMode !== undefined,
    // Always explicit: no channel-dependent "auto" default anywhere in the CLI.
    reasoningEffort: configuredEffort ?? 'high',
    continueSession: continueLatest,
    // '' sentinel = bare --resume → in-TUI session picker; otherwise a concrete id.
    ...(resume === undefined ? {} : { resume }),
    positionals: parsed.positionals,
  }
}

function openProjectSessionStore(): JsonlSessionStore {
  return new JsonlSessionStore({ dataRoot: defaultSparkHome(), projectDir: process.cwd() })
}

/**
 * `--continue` / `--resume <id>` target resolution against the on-disk ledger
 * of the current project. Returns undefined for "start a new session" (no
 * sessions yet, or the bare-`--resume` picker sentinel). Throws when an
 * explicitly requested session id does not exist.
 */
async function resolveResumeTarget(options: CliOptions): Promise<string | undefined> {
  if (!options.continueSession && options.resume === undefined) return undefined
  if (options.resume === '') return undefined // picker sentinel; TUI handles it
  const sessions = await openProjectSessionStore().list(
    null,
    options.continueSession ? {} : { includeSubagents: true },
  )
  if (options.continueSession) {
    const latest = sessions[0]
    if (latest === undefined) {
      process.stderr.write('No sessions recorded here yet; starting a new session.\n')
      return undefined
    }
    return latest.sessionId
  }
  const requested = options.resume ?? ''
  const found = sessions.find((session) => session.sessionId === requested)
  if (found === undefined) {
    const recent = sessions
      .slice(0, 5)
      .map((session) =>
        `  ${shortSessionId(session.sessionId)}  ${session.preview ?? ''}`.trimEnd(),
      )
      .join('\n')
    throw new Error(
      `Session not found: ${requested}${recent === '' ? '' : `\nRecent sessions:\n${recent}`}`,
    )
  }
  return requested
}

/**
 * Resume semantics shared by the TUI, print, and plain-REPL paths: an explicit
 * `--permission-mode` overrides the mode restored from the ledger; without the
 * flag the session keeps whatever mode it ran under before.
 */
async function openOrCreateSession(
  agent: Agent,
  config: Readonly<Record<string, unknown>>,
  resumeSessionId: string | undefined,
  explicitPermissionMode: PermissionMode | undefined,
): Promise<AgentSession> {
  if (resumeSessionId === undefined) return agent.newSession(config)
  const session = await agent.openSession(resumeSessionId)
  if (explicitPermissionMode !== undefined) session.setPermissionMode(explicitPermissionMode)
  return session
}

async function listSessionsCommand(json: boolean): Promise<number> {
  const sessions = await openProjectSessionStore().list(null)
  if (json) {
    for (const session of sessions) process.stdout.write(`${JSON.stringify(session)}\n`)
    return 0
  }
  if (sessions.length === 0) {
    process.stdout.write('No sessions recorded for this directory yet.\n')
    return 0
  }
  for (const session of sessions) {
    const updated = new Date(session.updatedAt).toISOString()
    process.stdout.write(
      `${updated}  #${session.latestSeq}  ${shortSessionId(session.sessionId)}  ${session.preview ?? ''}\n`,
    )
  }
  return 0
}

async function runOnce(
  prompt: string,
  options: CliOptions,
  runtime: ConfiguredModelRuntime,
  resumeSessionId?: string,
): Promise<number> {
  const agent = createConfiguredAgent(runtime)
  warnPermissionBypass(options.permissionMode)
  const session = await openOrCreateSession(
    agent,
    {
      output: options.outputFormat,
      model: runtime.modelId,
      route: runtime.route,
      config: runtime.configSnapshot,
      permissionMode: options.permissionMode,
    },
    resumeSessionId,
    options.permissionModeExplicit ? options.permissionMode : undefined,
  )
  const eventJson = options.legacyJson || options.outputFormat === 'stream-json'
  const finalJson = options.outputFormat === 'json' && !options.legacyJson
  if (eventJson) {
    for await (const event of session.events()) {
      process.stdout.write(`${JSON.stringify(event)}\n`)
    }
  }
  const controller = new AbortController()
  const onSigint = () => {
    controller.abort('SIGINT')
  }
  process.once('SIGINT', onSigint)
  let wroteText = false
  let finalText = ''
  try {
    const result = await session.turn(prompt, {
      signal: controller.signal,
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
      onEvent: eventJson
        ? (event) => {
            process.stdout.write(`${JSON.stringify(event)}\n`)
          }
        : (event) => {
            if (event.type === 'assistant.completed' && event.message.text) {
              finalText = event.message.text
            }
            renderPlainEvent(event)
          },
      onDelta:
        eventJson && options.outputFormat === 'stream-json' && !options.legacyJson
          ? (delta) => {
              process.stdout.write(`${JSON.stringify({ type: 'delta', delta })}\n`)
            }
          : eventJson || finalJson
            ? undefined
            : (delta) => {
                if (delta.type === 'text') {
                  wroteText = true
                  process.stdout.write(delta.text)
                }
              },
    })
    if (!eventJson && !finalJson && !wroteText && finalText !== '') {
      process.stdout.write(finalText)
      wroteText = true
    }
    if (finalJson) {
      process.stdout.write(
        `${JSON.stringify({
          type: 'result',
          sessionId: session.sessionId,
          turnId: result.turnId,
          status: terminalStatus(result.terminal),
          message: finalText || null,
          terminal: result.terminal,
        })}\n`,
      )
    } else if (!eventJson && wroteText) {
      process.stdout.write('\n')
    }
    if (result.terminal.type === 'turn.completed') return 0
    if (result.terminal.type === 'turn.cancelled') return 130
    return 1
  } finally {
    process.removeListener('SIGINT', onSigint)
  }
}

function terminalStatus(terminal: AgentEvent): 'completed' | 'cancelled' | 'failed' {
  switch (terminal.type) {
    case 'turn.completed':
      return 'completed'
    case 'turn.cancelled':
      return 'cancelled'
    case 'turn.failed':
      return 'failed'
    default:
      throw new Error(`Expected terminal event, got ${terminal.type}`)
  }
}

async function runPlainRepl(
  runtime: ConfiguredModelRuntime,
  options: CliOptions,
  resumeSessionId?: string,
): Promise<number> {
  const agent = createConfiguredAgent(runtime)
  warnPermissionBypass(options.permissionMode)
  const session = await openOrCreateSession(
    agent,
    {
      output: 'plain-repl',
      model: runtime.modelId,
      route: runtime.route,
      config: runtime.configSnapshot,
      permissionMode: options.permissionMode,
    },
    resumeSessionId,
    options.permissionModeExplicit ? options.permissionMode : undefined,
  )
  const reasoningEffort = options.reasoningEffort
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
  process.stdout.write('spark plain REPL · /exit 退出\n> ')
  try {
    for await (const line of terminal) {
      if (line.trim() === '/exit' || line.trim() === '/quit') break
      if (line.trim()) await runPlainTurn(session, line, reasoningEffort)
      process.stdout.write('> ')
    }
    return 0
  } finally {
    terminal.close()
  }
}

async function runPlainTurn(
  session: AgentSession,
  prompt: string,
  reasoningEffort: ReasoningEffort | undefined,
): Promise<void> {
  let wroteText = false
  let finalText = ''
  await session.turn(prompt, {
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    onDelta: (delta: LlmDelta) => {
      if (delta.type === 'text') {
        wroteText = true
        process.stdout.write(delta.text)
      }
    },
    onEvent: (event) => {
      if (event.type === 'assistant.completed' && event.message.text) {
        finalText = event.message.text
      }
      renderPlainEvent(event)
    },
  })
  if (!wroteText && finalText !== '') {
    process.stdout.write(finalText)
    wroteText = true
  }
  if (wroteText) process.stdout.write('\n')
}

function renderPlainEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'tool.call':
      process.stderr.write(
        `[tool ${terminalSafe(event.tool)}] requested ${previewCliValue(event.args)}\n`,
      )
      break
    case 'tool.intent':
      process.stderr.write(`[tool ${event.callId}] running\n`)
      break
    case 'tool.result':
      process.stderr.write(
        `[tool ${event.callId}] ${event.ok ? 'ok' : 'failed'} (${event.durationMs}ms): ${terminalSafe(event.content)}\n`,
      )
      break
    case 'permission.requested':
      process.stderr.write(
        `[permission ${event.risk.tool}] approval required: ${terminalSafe(event.risk.argsPreview)}\n`,
      )
      break
    case 'permission.decided':
      process.stderr.write(
        `[permission ${event.requestId}] ${event.decision}${event.grantScope ? ` (${event.grantScope})` : ''}\n`,
      )
      break
    case 'turn.failed':
      process.stderr.write(
        `${terminalSafe(event.error.code)}: ${terminalSafe(event.error.message)}\n`,
      )
      break
    case 'turn.cancelled':
      process.stderr.write('Turn cancelled.\n')
      break
    case 'turn.completed':
      if (event.reason === 'budget') {
        process.stderr.write(
          `Turn stopped at budget: ${event.stats.steps} steps, ${event.stats.toolCalls} tool calls.\n`,
        )
      }
      break
    default:
      break
  }
}

function previewCliValue(value: unknown): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    serialized = '[unserializable]'
  }
  return terminalSafe(serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function helpText(version?: string): string {
  return `spark ${version === undefined ? '' : `${version} `}— deterministic coding agent

Usage:
  spark                     Interactive TUI
  spark "task"              Run one task
  spark -p "task"           Run one task
  spark --plain             Plain interactive REPL
  spark --json "task"       NDJSON fact events
  spark --output-format json "task"
                            One final JSON result object
  spark --output-format stream-json "task"
                            Event and streaming-delta JSONL
  spark models              List local and SparkWork-synced models
  spark doctor              Diagnose install, discovery, and model selection
  spark sessions            List sessions recorded for the current directory
  spark install [--bin dir] Link the spark launcher onto PATH
  spark uninstall [--bin dir]
                            Remove the spark launcher only
  spark uninstall --package
                            Remove the npm package, its shims, and the launcher;
                            ~/.spark config/sessions/caches are kept
  spark update [--check]    Check for or install a release upgrade
  spark upgrade             Alias for spark update
  spark init                Write a starter ~/.spark/config.toml

Update exit codes:
  0 update available / update applied        1 up to date, older remote, or prerelease gated
  2 usage error                               3 check or upgrade failed
  4 another update is in progress

Options:
  -p, --prompt <text>       Task prompt
  -m, --model <id>          Select a local id, SparkWork route id, or unique model name
  -c, --continue            Continue the most recent session in this directory
  -r, --resume [<id>]       Resume a session; without an id pick one in the TUI
      --bin <dir>           Launcher directory for install/uninstall (default ~/.spark/bin)
      --base <url>          Release base for update (default SPARK_RELEASE_BASE, SPARK_INSTALL_BASE,
                            [update] base_url in config.toml, then the built-in release host)
      --target <semver>     Pin an exact version for update (checksum via the .sha256 sidecar)
      --check               Only report the update status; apply nothing
      --allow-prerelease    Consider prerelease releases for update
      --package             With uninstall: remove the installed npm package too
      --force               Replace a foreign launcher during install
      --plain               Disable color and terminal redraw
      --json                Backward-compatible persisted-event NDJSON output
      --output-format <fmt> text | json | stream-json
                            json emits one final result; stream-json emits events and deltas
      --permission-mode <m> manual | auto | bypass (default: manual)
      --effort <level>      Reasoning effort: off | low | medium | high | max (default: high)
      --dangerously-skip-permissions
                             Alias for --permission-mode bypass
  -h, --help                Show help
  -V, --version             Show version
`
}

async function runningVersion(): Promise<string> {
  try {
    return (await resolveSparkInstall()).version
  } catch {
    return 'unknown'
  }
}

/**
 * Bridges the TUI /update command onto the same transactional `spark update`
 * path the shell command uses. Output is buffered and surfaced by the TUI as
 * a notice; exit-code semantics stay in update-runner's describe mapping.
 */
function createTuiUpdateRunner(): SparkUpdateRunner {
  return {
    run: async ({ checkOnly }) => {
      let output = ''
      const io = {
        stdout: (text: string) => {
          output += text
        },
        stderr: (text: string) => {
          output += text
        },
      }
      const exitCode = await executeUpdate(
        {
          checkOnly,
          allowPrerelease: false,
          json: false,
          sparkHome: defaultSparkHome(),
        },
        io,
      )
      return { exitCode, output }
    },
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function terminalSafe(value: string): string {
  const safe: string[] = []
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    safe.push(codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? '�' : character)
  }
  return safe.join('')
}

function createConfiguredAgent(runtime: ConfiguredModelRuntime): Agent {
  const cwd = process.cwd()
  return Agent.open({ cwd, env: createDefaultEnv({ cwd, llm: runtime.service }) })
}

function warnPermissionBypass(mode: PermissionMode): void {
  if (mode === 'bypass') {
    process.stderr.write(
      'DANGER: permission bypass is active; registered tools may execute without approval.\n',
    )
  }
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exitCode = 0
  else throw error
})

process.exitCode = await main()
