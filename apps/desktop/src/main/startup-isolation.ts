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

/** 是否在启动后巡检并回收已安装完成的 dmg 安装镜像（见 services/InstallArtifactHousekeeping.ts）。 */
export function shouldRunInstallArtifactHousekeeping(env: StartupEnvironment): boolean {
  return env.SPARK_SKIP_INSTALL_HOUSEKEEPING !== '1'
}

export function resolveAuthKeytarService(env: StartupEnvironment, isDevPackage = false): string {
  return (
    env.SPARK_AUTH_KEYTAR_SERVICE?.trim() ||
    (isDevPackage ? `${DEFAULT_AUTH_KEYTAR_SERVICE}.Dev` : DEFAULT_AUTH_KEYTAR_SERVICE)
  )
}
