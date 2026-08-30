const DEFAULT_AUTH_KEYTAR_SERVICE = 'SparkAgent.CloudAuth'

type StartupEnvironment = Record<string, string | undefined>

export function shouldEnableSingleInstanceLock(
  isDevelopment: boolean,
  env: StartupEnvironment,
): boolean {
  return !isDevelopment && env.SPARK_ALLOW_MULTIPLE_INSTANCES !== '1'
}

export function shouldRegisterDefaultProtocolClient(env: StartupEnvironment): boolean {
  return env.SPARK_SKIP_PROTOCOL_REGISTRATION !== '1'
}

export function resolveAuthKeytarService(env: StartupEnvironment): string {
  return env.SPARK_AUTH_KEYTAR_SERVICE?.trim() || DEFAULT_AUTH_KEYTAR_SERVICE
}
