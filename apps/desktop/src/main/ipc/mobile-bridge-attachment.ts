/**
 * 移动桥接附件读取的结果契约（纯类型 + 纯函数，零依赖，便于单测）。
 *
 * 2026-11-25 修复：此前 readAttachmentContent 所有失败一律返回 null，
 * 中继层统一折成 404「附件不存在或不在白名单内」，白名单外 / 不存在 /
 * 超大三态无法区分，远程面板取回失败时没法排障。现在失败带 reason，
 * 由中继层映射成不同的 HTTP 状态码 + 用户文案（控制端直接透传展示）。
 */

/** 附件读取成功 */
export interface MobileBridgeAttachmentReadSuccess {
  ok: true
  data: Buffer
  mimeType: string
}

export type MobileBridgeAttachmentReadFailureReason =
  | 'outside_whitelist' // 路径不在「粘贴图目录 ∪ 已注册工作区根」白名单内
  | 'symlink_escape' // realpath 复核发现软链逃逸出白名单（与白名单外同文案）
  | 'not_found' // 白名单内但文件不存在 / 已被移动
  | 'too_large' // 超过 MAX_ATTACHMENT_READ_BYTES

/** 附件读取失败（带结构化原因） */
export interface MobileBridgeAttachmentReadFailure {
  ok: false
  reason: MobileBridgeAttachmentReadFailureReason
}

export type MobileBridgeAttachmentReadResult =
  | MobileBridgeAttachmentReadSuccess
  | MobileBridgeAttachmentReadFailure

/** 失败原因 → 中继 HTTP 状态码 + 机器码 + 用户文案（控制端直接透传展示） */
export function attachmentReadFailureToHttp(reason: MobileBridgeAttachmentReadFailureReason): {
  status: number
  code: string
  message: string
} {
  switch (reason) {
    case 'outside_whitelist':
    case 'symlink_escape':
      return {
        status: 403,
        code: 'ATTACHMENT_OUTSIDE_WHITELIST',
        message: '文件不在允许访问的工作区白名单内',
      }
    case 'not_found':
      return { status: 404, code: 'ATTACHMENT_NOT_FOUND', message: '文件不存在或已被移动' }
    case 'too_large':
      return { status: 413, code: 'ATTACHMENT_TOO_LARGE', message: '文件超过 20 MiB 传输上限' }
  }
}
