/**
 * PresentedMedia — 会话里 presented_files 事件中的媒体文件(图片/音频/视频)渲染
 *
 * 为什么单独成模块
 * ──────────────
 * presented_files 同时承载「文档产物」和「媒体产物」两类。文档走 DocumentOutputCard，
 * 媒体此前被文档白名单 filterDocumentOutputFiles 误杀——生图/配音/生视频成功后，
 * 后端确实把媒体推进了 presented_files 事件，但前端两道过滤点(ChatActivitySegments /
 * ChatView)都把媒体当成「非文档」扔掉，导致会话内容区什么都不显示。
 *
 * 本模块补齐媒体的分类、过滤与渲染：
 *   - 图片：复用 MarkdownImage（本地路径→safe-file→<img>，自带 hover 工具条 + 全屏预览 + 失败占位）
 *   - 音频：<audio controls>，本地路径经 encodeToSafeFileUrl 转 safe-file://
 *   - 视频：<video controls>，同样转 safe-file://
 *
 * 扩展名白名单与后端 MediaPresentationCollector 对齐（media-presentation-collector.ts:9-36），
 * 保证「后端收集到的」与「前端能渲染的」集合一致。
 */
import type { ReactNode } from 'react'
import { useCallback } from 'react'
import { MarkdownImage } from '../../components/MarkdownImage'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import './PresentedMedia.less'

/** presented_files 里的文件引用，与后端 extractPresentedFiles 返回结构一致 */
export interface PresentedFile {
  path: string
  title?: string
}

const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
])
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav'])
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm'])

export type PresentedFileKind = 'image' | 'audio' | 'video'

/** 取路径扩展名（小写、去 query/hash）；无扩展名返回空串 */
function getExtension(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const lower = fileName.toLowerCase()
  const queryStripped = lower.split('?')[0] ?? lower
  const hashStripped = queryStripped.split('#')[0] ?? queryStripped
  const lastDot = hashStripped.lastIndexOf('.')
  return lastDot >= 0 ? hashStripped.slice(lastDot + 1) : ''
}

/** 判断一个 presented 文件属于哪种媒体类型；非媒体（含文档/代码/未知）返回 null */
export function classifyPresentedFile(filePath: string): PresentedFileKind | null {
  const ext = getExtension(filePath)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return null
}

/** 过滤出媒体文件（图片/音频/视频），与 filterDocumentOutputFiles 对称 */
export function filterMediaPresentedFiles<T extends { path: string }>(files: T[]): T[] {
  return files.filter((file) => classifyPresentedFile(file.path) != null)
}

/**
 * 把本地绝对路径转成 safe-file:// URL，供 <audio>/<video> 的 src 使用。
 * 编码方式与主进程 SafeFileProtocol.toSafeFileUrl、MarkdownImage 内部的 encodeToSafeFileUrl 完全一致。
 */
export function encodeToSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

function getBaseName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

/**
 * 媒体卡片的「用默认应用打开」按钮。
 * 音视频产物本就在本地磁盘，在系统默认播放器里打开比「下载」更实用。
 */
function PresentedMediaOpenButton({ filePath }: { filePath: string }): ReactNode {
  const { invoke: openFile } = useIpcInvoke('file:open')
  const { toast } = useToast()
  const handleOpen = useCallback(async () => {
    try {
      const res = await openFile({ filePath })
      if (!res.opened) toast.error(res.error ?? '无法打开文件')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件失败')
    }
  }, [filePath, openFile, toast])
  return (
    <button
      type="button"
      className="presented-media-action"
      title="用默认应用打开"
      onClick={handleOpen}
    >
      <Icons.ExternalLink size={13} />
    </button>
  )
}

/**
 * 渲染 presented_files 中的媒体部分。媒体自包含预览能力（图片走 MarkdownImage 全屏，
 * 音视频走原生 controls），不依赖外部 onFilePreview。
 */
export function PresentedMediaList<T extends PresentedFile>({
  files,
}: {
  files: T[]
}): ReactNode {
  const mediaFiles = files.filter((file) => classifyPresentedFile(file.path) != null)
  if (mediaFiles.length === 0) return null

  return (
    <div className="presented-media-list">
      {mediaFiles.map((file) => {
        const kind = classifyPresentedFile(file.path)
        const label = file.title ?? getBaseName(file.path)
        if (kind === 'image') {
          return <MarkdownImage key={file.path} src={file.path} alt={label} />
        }
        if (kind === 'audio') {
          const ext = getExtension(file.path).toUpperCase()
          return (
            <div key={file.path} className="presented-media-audio">
              <div className="presented-media-audio-head">
                <span className="presented-media-audio-icon" aria-hidden="true">
                  <Icons.AudioLines size={15} />
                </span>
                <span className="presented-media-audio-name" title={file.path}>
                  {label}
                </span>
                {ext && <span className="presented-media-audio-ext">{ext}</span>}
                <PresentedMediaOpenButton filePath={file.path} />
              </div>
              <audio controls preload="metadata" src={encodeToSafeFileUrl(file.path)}>
                当前环境不支持音频播放，可点击右侧按钮用默认应用打开。
              </audio>
            </div>
          )
        }
        return (
          <div key={file.path} className="presented-media-video-wrap">
            <div className="presented-media-video-head">
              <span className="presented-media-video-name" title={file.path}>
                {label}
              </span>
              <PresentedMediaOpenButton filePath={file.path} />
            </div>
            <video
              className="presented-media-video"
              controls
              preload="metadata"
              src={encodeToSafeFileUrl(file.path)}
            />
          </div>
        )
      })}
    </div>
  )
}
