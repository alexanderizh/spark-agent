import { errorMessage } from '../config/config-file.js'
import {
  loadSparkSettings,
  resolvePlatformSettings,
  type ResolvedPlatformSettings,
  type SparkSettingsOptions,
} from '../config/settings.js'
import type { FetchLike } from '../llm/http/client.js'
import { createRuntimeLogger } from '../observability/logger.js'
import type { ExternalUrlOpener } from '../platform/browser.js'
import {
  PlatformCredentialStore,
  type PlatformAccount,
  type StoredPlatformCredentials,
} from '../platform/credentials.js'
import {
  EduServerClient,
  PlatformApiError,
  PlatformAuthExpiredError,
} from '../platform/edu-server-client.js'
import { PlatformLoginError, runPlatformLogin } from '../platform/login-flow.js'
import { bootstrapPlatformModels, type PlatformModelsStatus } from '../platform/models.js'
import { PlatformModelStore } from '../platform/model-store.js'

/**
 * `spark login | logout | whoami` — the CLI's own Spark account session.
 *
 * The credential file is the only place tokens are stored, and it is never
 * printed: text output shows the account identity and the file path only.
 */
export interface AuthCommandOptions {
  readonly subcommand: string
  readonly args: readonly string[]
  readonly json: boolean
  readonly cwd: string
  readonly sparkHome?: string
  readonly env?: NodeJS.ProcessEnv
  /** false = print the login url instead of launching the system browser. */
  readonly openBrowser?: boolean
  readonly fetch?: FetchLike
  readonly openExternal?: ExternalUrlOpener
  readonly pollIntervalMs?: number
  readonly loginTimeoutMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

const AUTH_USAGE = 'Usage: spark login [--no-browser] | spark logout | spark whoami\n'

export async function executeAuthCommand(options: AuthCommandOptions): Promise<number> {
  try {
    switch (options.subcommand) {
      case 'login':
        return await login(options)
      case 'logout':
        return await logout(options)
      case 'whoami':
        return await whoami(options)
      default:
        options.stderr(
          `Unknown \`spark ${options.subcommand || '<command>'}\`: use login | logout | whoami\n${AUTH_USAGE}`,
        )
        return 2
    }
  } catch (error) {
    options.stderr(`${formatError(error)}\n`)
    return 1
  }
}

async function login(options: AuthCommandOptions): Promise<number> {
  const { store, platform, serverUrl, settings } = await openStore(options)
  const logger = createRuntimeLogger('platform')

  let existing: StoredPlatformCredentials | null = null
  try {
    existing = await store.load()
  } catch (error) {
    // A corrupt file must not block a fresh login; the new session replaces it.
    options.stderr(`Warning: ${errorMessage(error)}\n`)
  }
  if (existing !== null && existing.serverUrl !== serverUrl) {
    options.stderr(
      `Note: replacing the stored session for ${existing.serverUrl} with a session for ${serverUrl}.\n`,
    )
  }

  const client = new EduServerClient({
    baseUrl: serverUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    logger,
  })
  // Progress belongs on stderr in --json mode so stdout stays machine-readable.
  const progress = options.json ? options.stderr : options.stdout
  const result = await runPlatformLogin({
    client,
    ...(platform.webLoginUrl === undefined ? {} : { webLoginUrl: platform.webLoginUrl }),
    ...(options.openBrowser === undefined ? {} : { openBrowser: options.openBrowser }),
    ...(options.openExternal === undefined ? {} : { openExternal: options.openExternal }),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.loginTimeoutMs === undefined ? {} : { timeoutMs: options.loginTimeoutMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    logger,
    onProgress: ({ loginUrl, opened }) => {
      progress(
        opened
          ? `Opened the login page in your browser:\n  ${loginUrl}\n`
          : 'Open this page in a browser to finish signing in:\n' +
              `  ${loginUrl}\n` +
              'Waiting for the browser to complete the login…\n',
      )
    },
  })

  client.setSession(result.session)
  let account: PlatformAccount | undefined
  try {
    account = await client.getMe()
  } catch (error) {
    // The session is valid even when the profile read fails; keep the login.
    options.stderr(`Warning: cannot read the account profile: ${errorMessage(error)}\n`)
  }

  await store.save({
    serverUrl,
    session: result.session,
    ...(account === undefined ? {} : { account }),
  })

  // Bind platform models right away so the fresh session can select a model
  // without extra steps. Any bootstrap failure never invalidates the login.
  let platformModels: PlatformModelsStatus | undefined
  let platformModelsError: string | undefined
  try {
    platformModels = await bootstrapPlatformModels({
      sparkHome: settings.paths.sparkHome,
      serverUrl,
      session: result.session,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      logger,
    })
  } catch (error) {
    platformModelsError = formatError(error)
    options.stderr(`Warning: platform models are not bound: ${platformModelsError}\n`)
  }

  if (options.json) {
    options.stdout(
      `${JSON.stringify(
        {
          authenticated: true,
          userId: result.session.userId,
          serverUrl,
          loginUrl: result.loginUrl,
          openedInBrowser: result.opened,
          credentialPath: store.path,
          account: account ?? null,
          platformModels: platformModels ?? (platformModelsError ? null : undefined),
        },
        null,
        2,
      )}\n`,
    )
    return 0
  }
  options.stdout(`${accountLine(account, result.session.userId)}\n`)
  options.stdout(`Signed in to ${serverUrl}\n`)
  options.stdout(`Credentials saved to ${store.path}\n`)
  if (platformModels?.providerReady === true) {
    options.stdout(
      `Platform models bound (${platformModels.models.length} available) via ${platformModels.baseUrl}\n`,
    )
  } else if (platformModels?.sessionConflict === true) {
    options.stderr(`${platformModels.message}\n`)
  }
  return 0
}

async function logout(options: AuthCommandOptions): Promise<number> {
  const { store, settings } = await openStore(options)
  const cleared = await store.clear()
  // The platform-model binding belongs to the signed-in account; keeping it
  // would let a later unrelated user silently reuse this machine's gateway.
  await new PlatformModelStore({
    sparkHome: settings.paths.sparkHome,
    logger: createRuntimeLogger('platform'),
  })
    .clear()
    .catch(() => undefined)
  if (options.json) {
    options.stdout(
      `${JSON.stringify({ signedOut: cleared, credentialPath: store.path }, null, 2)}\n`,
    )
    return 0
  }
  options.stdout(cleared ? 'Signed out of the Spark account.\n' : 'Not signed in.\n')
  return 0
}

async function whoami(options: AuthCommandOptions): Promise<number> {
  const { store, serverUrl } = await openStore(options)
  const logger = createRuntimeLogger('platform')

  let stored: StoredPlatformCredentials | null
  try {
    stored = await store.load()
  } catch (error) {
    options.stderr(`${errorMessage(error)}\n`)
    return 1
  }
  if (stored === null) {
    options.stderr('Not signed in. Run `spark login` first.\n')
    return 1
  }
  if (stored.serverUrl !== serverUrl) {
    options.stderr(
      `Note: this session belongs to ${stored.serverUrl}, not the configured ${serverUrl}.\n` +
        'Run `spark logout && spark login` to move it to the configured server.\n',
    )
  }

  const client = new EduServerClient({
    baseUrl: stored.serverUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    logger,
    session: stored.session,
    onSessionRefreshed: async (session) => {
      await store.save({
        serverUrl: stored.serverUrl,
        session,
        ...(stored.account === undefined ? {} : { account: stored.account }),
      })
    },
  })

  try {
    const account = await client.getMe()
    const activeSession = client.session ?? stored.session
    const rotated =
      activeSession.token !== stored.session.token ||
      activeSession.refreshToken !== stored.session.refreshToken
    // Read-mostly command: only rewrite the file when something actually changed.
    if (rotated || !sameAccount(stored.account, account)) {
      await store.save({ serverUrl: stored.serverUrl, session: activeSession, account })
    }
    if (options.json) {
      options.stdout(
        `${JSON.stringify(
          {
            authenticated: true,
            userId: activeSession.userId,
            serverUrl: stored.serverUrl,
            credentialPath: store.path,
            account,
          },
          null,
          2,
        )}\n`,
      )
      return 0
    }
    options.stdout(`${accountLine(account, activeSession.userId)}\n`)
    options.stdout(`Server: ${stored.serverUrl}\n`)
    return 0
  } catch (error) {
    if (error instanceof PlatformAuthExpiredError) {
      await store.clear().catch(() => undefined)
      options.stderr('Your Spark account session expired. Run `spark login` again.\n')
      return 1
    }
    options.stderr(`${formatError(error)}\n`)
    return 1
  }
}

interface AuthContext {
  readonly store: PlatformCredentialStore
  readonly platform: ResolvedPlatformSettings
  readonly serverUrl: string
  readonly settings: Awaited<ReturnType<typeof loadSparkSettings>>
}

async function openStore(options: AuthCommandOptions): Promise<AuthContext> {
  const settingsOptions: SparkSettingsOptions = {
    cwd: options.cwd,
    ...(options.sparkHome === undefined ? {} : { sparkHome: options.sparkHome }),
    ...(options.env === undefined ? {} : { env: options.env }),
  }
  const settings = await loadSparkSettings(settingsOptions)
  const platform = resolvePlatformSettings(settings, options.env ?? process.env)
  return {
    store: new PlatformCredentialStore({
      sparkHome: settings.paths.sparkHome,
      logger: createRuntimeLogger('platform'),
    }),
    platform,
    serverUrl: platform.serverUrl,
    settings,
  }
}

function accountLine(account: PlatformAccount | undefined, userId: string): string {
  if (account === undefined) return `Signed in as user ${userId}`
  const name = account.nickname.trim() === '' ? account.account : account.nickname
  const label = account.account.trim() === '' ? name : `${name} (${account.account})`
  return `Signed in as ${label}`
}

function sameAccount(stored: PlatformAccount | undefined, current: PlatformAccount): boolean {
  if (stored === undefined) return false
  return (
    stored.id === current.id &&
    stored.account === current.account &&
    stored.nickname === current.nickname &&
    stored.role === current.role
  )
}

function formatError(error: unknown): string {
  if (error instanceof PlatformLoginError) return error.message
  if (error instanceof PlatformApiError) return error.message
  return errorMessage(error)
}
