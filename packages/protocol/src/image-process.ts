/** 图片处理操作请求（sharp 实现，覆盖探测与缩放压缩）。 */
export interface ImageProcessRequest {
  operation: 'probe' | 'scaleCompress'
  /** 源图片文件绝对路径 */
  input: string
  /** 各操作的参数（结构因 operation 而异） */
  params: Record<string, unknown>
  /** 用于关联进度推送的唯一 id */
  requestId: string
}

export interface ImageProcessResponse {
  success: boolean
  /** probe 返回 ImageProbeInfo；scaleCompress 返回输出路径、尺寸、格式和体积。 */
  result?: unknown
  error?: string
}

/** 图片元数据（宽高为应用 EXIF 方向后的显示像素尺寸，fileSize 为字节数）。 */
export interface ImageProbeInfo {
  width: number
  height: number
  /** sharp 识别的源格式（jpeg/png/webp/...） */
  format: string
  fileSize: number
  hasAlpha: boolean
  /** 多页/多帧数量；静态图片为 1 */
  pages: number
  /** 是否为多帧 GIF/WebP 动图 */
  animated: boolean
}

export interface ImageProcessProgress {
  requestId: string
  percent: number
  stage: string
}
