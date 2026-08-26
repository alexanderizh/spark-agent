/**
 * 开发/生产数据目录（userData）隔离
 *
 * 背景：打包产物 asar 内的 package.json 只有 name（@spark/desktop）、没有
 * productName，Electron 用它推导默认 userData，导致 `pnpm dev`、签名生产安装包
 * 与本地未签名安装包三方共用同一目录 ~/Library/Application Support/@spark/desktop，
 * 曾在版本切换时触发数据库在线恢复 split-brain 丢失数据
 * （见 todo/桌面端数据库实例隔离与安全恢复计划.md）。
 *
 * 策略（最小改动，只隔离数据来源）：
 *   - 生产安装包：默认 userData 保持不变。
 *   - dev 运行（!app.isPackaged）：userData 切到兄弟目录 <basename>-dev，
 *     即 @spark/desktop-dev。
 *   - SPARK_DATA_PROFILE=dev 可强制任何构建（含打包产物）使用隔离目录。
 *   - SPARK_DATA_PROFILE=production 可让 dev 运行时强制使用生产目录，
 *     仅在需要主动检查生产数据时显式使用。
 *
 * 本地打 dev 安装包时请使用 package.json 中的 *:dev 脚本（通过
 * --config.extraMetadata.name=@spark/desktop-dev 修改包内 name，使 userData 天然隔离，
 * 不触碰 productName / 可执行名 / appId / 安装包名）。
 */

import { basename, dirname, join } from 'path'

type StartupEnvironment = Record<string, string | undefined>

type PathApp = {
  getPath: (name: 'userData') => string
  setPath: (name: 'userData', path: string) => void
}

const DEV_USERDATA_SUFFIX = '-dev'

function normalizeProfile(env: StartupEnvironment): string | null {
  const value = env.SPARK_DATA_PROFILE?.trim().toLowerCase()
  return value ? value : null
}

/** dev 数据目录是否应生效；SPARK_DATA_PROFILE=production 显式优先生效为否 */
export function shouldUseDevUserData(isDevelopment: boolean, env: StartupEnvironment): boolean {
  const profile = normalizeProfile(env)
  if (profile === 'production') return false
  if (profile === 'dev') return true
  return isDevelopment
}

/** 隔离目录 = 原目录的兄弟目录（@spark/desktop → @spark/desktop-dev） */
export function devUserDataPath(currentUserDataPath: string): string {
  return join(
    dirname(currentUserDataPath),
    `${basename(currentUserDataPath)}${DEV_USERDATA_SUFFIX}`,
  )
}

/**
 * 在任何 userData 消费者（数据库、单实例锁、各服务）之前调用。
 * 返回隔离后的目录；未命中 dev profile 时返回 null 且不做任何修改。
 */
export function applyDevUserData(
  appLike: PathApp,
  isDevelopment: boolean,
  env: StartupEnvironment,
): string | null {
  if (!shouldUseDevUserData(isDevelopment, env)) return null
  const next = devUserDataPath(appLike.getPath('userData'))
  appLike.setPath('userData', next)
  return next
}
