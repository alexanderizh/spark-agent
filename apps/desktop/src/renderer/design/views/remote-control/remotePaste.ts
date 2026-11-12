/**
 * 远程输入框的粘贴取图。
 *
 * 桌面端主输入区的粘贴是「截图/复制的图 → 落盘 → 作为附件」，远程这边多一步
 * 「把落到本机的文件传到目标电脑」。这里只负责前半段里纯计算的部分：
 * 从 clipboardData 里挑出图片项、把 Blob 读成 data URL，方便单测。
 *
 * paste 事件结束后 DataTransferItem 可能不可读，所以先同步取出 File 快照，之后才能
 * 异步落盘/上传。没有图片时返回空数组，调用方必须放行原生粘贴 —— 用户可能只是贴文字。
 */

/** 粘贴进来的图片（本机落盘前） */
export interface PastedImageSource {
  dataUrl: string
  mimeType: string
  suggestedBaseName: string
}

const IMAGE_MIME_PREFIX = 'image/'

/** 剪贴板里可以当图片处理的项（截图、复制的图片、复制的图片文件） */
export function pickImageFiles<T extends { type: string; getAsFile(): File | null }>(
  items: ArrayLike<T> | null | undefined,
): File[] {
  if (items == null) return []
  const picked: File[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item == null) continue
    if (!item.type.startsWith(IMAGE_MIME_PREFIX)) continue
    const file = item.getAsFile()
    if (file != null) picked.push(file)
  }
  return picked
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('读取剪贴板图片失败'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取剪贴板图片失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 把 File 转成 `file:save-pasted-image` 的入参。
 * 扩展名交给主进程按 mimeType 推导，这里只给「pasted-image-1」这类前缀。
 */
export async function toPastedImageSource(file: Blob, index: number): Promise<PastedImageSource> {
  const dataUrl = await readBlobAsDataUrl(file)
  return {
    dataUrl,
    mimeType: file.type || 'image/png',
    suggestedBaseName: `pasted-image-${index + 1}`,
  }
}
