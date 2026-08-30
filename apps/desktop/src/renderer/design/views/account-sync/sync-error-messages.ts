/**
 * 账号同步错误码 → 面向用户提示的映射。
 *
 * 协议与落库仍保存原始错误码（便于升级与排查），仅在展示层翻译。
 * 未知错误码使用兜底文案，保证界面永远不出现裸错误码。
 */

export type SyncErrorSeverity = 'skipped' | 'degraded' | 'failed'

export interface SyncErrorMessage {
  /** 面向用户的单行提示 */
  message: string
  /** skipped=条目被保护性跳过（非失败）；degraded=部分降级；failed=失败 */
  severity: SyncErrorSeverity
}

const SYNC_ERROR_MESSAGES: Record<string, SyncErrorMessage> = {
  // 保护性跳过：不传敏感信息（属于预期行为，不算失败）
  SECRET_COMMON_API_KEY: {
    message: '部分条目包含疑似密钥，已自动跳过以保护安全',
    severity: 'skipped',
  },
  LOCAL_ABSOLUTE_PATH: {
    message: '部分条目包含本机路径，已自动跳过',
    severity: 'skipped',
  },
  SYNC_FIELD_NOT_ALLOWLISTED: {
    message: '部分条目含不在同步范围内的字段，已自动跳过',
    severity: 'skipped',
  },
  SYNC_FIELD_TYPE_INVALID: {
    message: '部分条目数据格式异常，已自动跳过以保护本地数据',
    severity: 'skipped',
  },
  SYNC_SERVER_ITEM_REJECTED: {
    message: '部分云端数据未通过安全检查，已跳过',
    severity: 'skipped',
  },
  SYNC_SERVER_ITEM_INVALID: {
    message: '部分云端数据格式异常，已跳过',
    severity: 'skipped',
  },
  SYNC_SERVER_ITEM_LIMIT_EXCEEDED: {
    message: '单类别条目数超过上限，超出部分未同步',
    severity: 'degraded',
  },
  // 跨设备数据依赖缺失：内容已同步但引用本机不存在的资源
  SYNC_TEAM_MEMBER_MISSING: {
    message: '部分团队成员本机不存在，团队已同步但暂缺成员',
    severity: 'degraded',
  },
  SYNC_MEMORY_SCOPE_UNAVAILABLE: {
    message: '部分项目记忆对应的项目本机未打开，打开后会随下次同步落地',
    severity: 'degraded',
  },
  // 本地执行失败
  SYNC_LOCAL_COLLECT_FAILED: {
    message: '部分类别本地读取失败，本次未同步该类内容',
    severity: 'failed',
  },
  SYNC_LOCAL_APPLY_FAILED: {
    message: '部分类别已从云端获取但本地应用失败，请再次同步重试',
    severity: 'failed',
  },
  // 服务端与协议
  SYNC_ENCRYPTION_KEY_MISSING: {
    message: '服务端加密密钥未配置，请联系管理员配置后重试',
    severity: 'failed',
  },
  SYNC_CIPHERTEXT_INVALID: {
    message: '云端同步数据损坏，无法读取该类内容',
    severity: 'failed',
  },
  SYNC_SNAPSHOT_INVALID: {
    message: '云端同步数据格式异常，无法读取该类内容',
    severity: 'failed',
  },
  SYNC_SCHEMA_UNSUPPORTED: {
    message: '同步协议版本不兼容，请升级客户端与服务端',
    severity: 'failed',
  },
  SYNC_OPERATION_ID_REUSED: {
    message: '同步请求与历史记录冲突，请重新同步',
    severity: 'failed',
  },
  SYNC_REVISION_AHEAD: {
    message: '本地同步进度领先云端，请重新同步',
    severity: 'failed',
  },
  SYNC_OPERATION_NOT_FOUND: {
    message: '同步记录不存在或已被清理',
    severity: 'failed',
  },
  SYNC_UNAUTHENTICATED: {
    message: '登录状态已失效，请重新登录后重试',
    severity: 'failed',
  },
  SYNC_INVALID_MODE: {
    message: '同步请求无效，请升级客户端后重试',
    severity: 'failed',
  },
  SYNC_INVALID_CONFLICT_CHOICES: {
    message: '冲突选择无效，请重新预览后重试',
    severity: 'failed',
  },
  SYNC_INVALID_CONFLICT_CHOICE: {
    message: '部分冲突选择已失效，请重新预览后重试',
    severity: 'failed',
  },
  SYNC_REPLAY_REQUIRES_RESYNC: {
    message: '上一次同步未完成，请重新同步收敛',
    severity: 'degraded',
  },
  SYNC_CATEGORY_UNSUPPORTED: {
    message: '提示词库同步需要新版服务端，其余内容已正常同步',
    severity: 'degraded',
  },
}

const FALLBACK_MESSAGE: SyncErrorMessage = {
  message: '部分数据未能同步，详见同步记录',
  severity: 'failed',
}

export function translateSyncErrorCode(code: string): SyncErrorMessage {
  return SYNC_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE
}

/** 错误码列表 → 去重后的用户提示列表（未知码兜底），永远不暴露原始码 */
export function translateSyncErrorCodes(codes: readonly string[]): string[] {
  const messages: string[] = []
  for (const code of codes) {
    const message = translateSyncErrorCode(code).message
    if (!messages.includes(message)) messages.push(message)
  }
  return messages.length > 0 ? messages : [FALLBACK_MESSAGE.message]
}
