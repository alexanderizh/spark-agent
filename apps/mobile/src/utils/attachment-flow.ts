/**
 * 附件选择与上传（图片 / 拍照 / 会话文件）。
 *
 * 会话页与「新建会话」输入框共用同一条链路：
 *   弹菜单 → 选来源 → 拿本地临时文件 → base64 → 桌面端 /attachments 落盘 → 白名单路径
 * 路径随后随 turns 一起提交（桌面端只接受本链路落盘产生的路径）。
 *
 * 「新建会话」在首条消息发出前还没有 sessionId，这里用 PENDING_SESSION_ID 占位：
 * 桌面端 saveAttachments 只按 userData/attachments 白名单目录落盘、不校验会话是否存在，
 * 占位 id 仅用于满足 /v1/sessions/:id/attachments 的路由形状。
 */

import * as bridge from '../api/bridge'

/** 单条消息附件上限（与桌面端 /attachments 的 20 条硬顶一致） */
export const MAX_ATTACHMENTS = 20
/** 桌面端请求体上限 12MiB（base64 后 ≈ 原始 8MB），端上先拦一道避免无信息量的 500 */
export const MAX_ATTACHMENT_BASE64_CHARS = 11 * 1024 * 1024
/** 新会话尚未创建时的上传占位会话 id */
export const PENDING_SESSION_ID = 'draft'

export type AttachmentKind = 'image' | 'file'

export interface LocalAttachment {
  type: AttachmentKind
  localPath: string
  name: string
  mimeType: string
}

/** 桌面端落盘结果（path 为白名单目录内的绝对路径） */
export interface UploadedAttachment {
  type: AttachmentKind
  path: string
  name: string
}

/** attach-sheet 弹层的条目结构（图标取 app.wxss 里的 icon-* 类） */
export interface AttachMenuItem {
  key: string
  label: string
  sub?: string
  icon: string
}

/** 相册选图 / 拍照（compressed）；用户取消时 reject，调用方按取消处理 */
export async function pickImages(
  count: number,
  sourceType: ('album' | 'camera')[] = ['album'],
): Promise<LocalAttachment[]> {
  const result = await wx.chooseMedia({
    count,
    mediaType: ['image'],
    sizeType: ['compressed'],
    sourceType,
  })
  return result.tempFiles.map((file, index) => ({
    type: 'image' as const,
    localPath: file.tempFilePath,
    name: `image-${Date.now()}-${index}.png`,
    mimeType: 'image/png',
  }))
}

/** 会话文件（微信聊天记录里的文件） */
export async function pickMessageFiles(count: number): Promise<LocalAttachment[]> {
  const result = await wx.chooseMessageFile({ count, type: 'file' })
  return result.tempFiles.map((file) => ({
    type: 'file' as const,
    localPath: file.path,
    name: file.name,
    mimeType: '',
  }))
}

export function readAttachmentBase64(localPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: localPath,
      encoding: 'base64',
      success: (res) => resolve(String(res.data)),
      fail: (err) => reject(new Error(err.errMsg || '读取文件失败')),
    })
  })
}

/**
 * 单个附件上传：读 base64 → 体积校验 → 桌面端落盘。
 * 中继偶发抖动直接丢帧，本地重试一次，避免「图片发不出去」。
 */
export async function uploadAttachment(
  sessionId: string,
  input: LocalAttachment,
  deviceId?: string,
): Promise<UploadedAttachment> {
  const dataBase64 = await readAttachmentBase64(input.localPath)
  if (dataBase64.length > MAX_ATTACHMENT_BASE64_CHARS) {
    throw new Error('附件超过 8MB，请压缩后重试')
  }
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await bridge.uploadAttachments(
        sessionId,
        [{ name: input.name, mimeType: input.mimeType || undefined, dataBase64 }],
        deviceId,
      )
      const first = result.attachments[0]
      if (first == null) throw new Error('附件上传失败')
      return { type: first.type, path: first.path, name: first.name ?? input.name }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('附件上传失败')
}

/** 剩余可选数量（欠配额时返回 0） */
export function remainingAttachmentSlots(current: number): number {
  return Math.max(0, MAX_ATTACHMENTS - current)
}
