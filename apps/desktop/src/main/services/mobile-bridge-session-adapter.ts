/**
 * mobile-bridge-session-adapter — 移动桥渠道切换的会话引擎校准。
 *
 * 移动端 PATCH /v1/sessions/:id 只带 provider/model，不带引擎；若新渠道协议
 * 与会话当前引擎不兼容（如 codex 会话切到 Anthropic 协议渠道），下一轮 turn
 * 会撞 assertEngineProviderCompatible 守卫直接报错。这里与远程 /use-channel、
 * 渠道删除级联重绑同策略：写库前按新渠道协议校准引擎并回落权限档位。
 *
 * 校准判定本身在 session-adapter-compat.calibrateSessionAdapter（纯函数），
 * 本模块只负责装配：查渠道（悬空 id 直接拒绝）、读会话行、映射权限档位。
 * 会话行读取通过 getCurrentAdapter 注入，模块不直接依赖数据库，可单测。
 */

import type { ProviderProfile, SessionAgentAdapter, SessionPermissionMode } from '@spark/protocol'
import { createLogger, SparkError } from '@spark/shared'

import { calibrateSessionAdapter, toAdapterCompatProvider } from './session-adapter-compat.js'
import { defaultRemotePermissionMode } from '../ipc/remote-command-utils.js'

const log = createLogger('mobile-bridge:adapter-calibration')

/** 渠道切换校准结果：null = 引擎兼容，不动会话引擎与权限。 */
export interface MobileBridgeAdapterCalibration {
  agentAdapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
}

/**
 * 校准移动桥「切渠道」后的会话引擎。
 *
 * 目标渠道不存在时抛 SparkError——悬空 providerProfileId 此前会假成功、
 * 下一轮 turn 才报「Provider profile not found」，改为切换时即给出明确报错。
 * getCurrentAdapter 返回 null（会话行缺失）时同样返回 null，交由
 * SessionService.updateSession 按既有行为报错。
 */
export async function calibrateMobileBridgeSessionAdapter(input: {
  sessionId: string
  providerProfileId: string
  providers: readonly ProviderProfile[]
  /** 读取会话当前 agent_adapter；会话行缺失时返回 null */
  getCurrentAdapter: (sessionId: string) => string | null
}): Promise<MobileBridgeAdapterCalibration | null> {
  const provider = input.providers.find((item) => item.id === input.providerProfileId)
  if (provider == null) {
    throw new SparkError('VALIDATION_FAILED', '目标渠道不存在或已删除，请重新选择模型')
  }
  const currentAdapter = input.getCurrentAdapter(input.sessionId)
  if (currentAdapter == null) return null
  const calibrated = calibrateSessionAdapter(currentAdapter, toAdapterCompatProvider(provider))
  if (calibrated == null) return null
  log.info('mobile bridge provider switch calibrated session engine', {
    sessionId: input.sessionId,
    providerProfileId: input.providerProfileId,
    fromAdapter: currentAdapter,
    toAdapter: calibrated,
  })
  return { agentAdapter: calibrated, permissionMode: defaultRemotePermissionMode(calibrated) }
}
