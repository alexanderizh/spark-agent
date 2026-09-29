import { useMemo, useState } from 'react'
import { Button, Tooltip, message } from 'antd'
import type { CanvasMediaTaskAsset, CanvasMediaTaskInputFile } from '@spark/protocol'
import { Icons } from '../../Icons'
import { ImagePreviewModal, type LightboxImage } from '../../components/ImagePreviewModal'
import { MediaArtifactViewer } from '../../components/MediaArtifactViewer'
import { copyTextToClipboard } from './canvasClipboard'
import { resolveMediaDisplayUrl } from './canvas-safe-file'
import { taskTextOutput, textOutputCopyMeta } from './quickCreateTaskPresentation'
import type { QuickCreateTaskRecord } from './quickCreateTaskStore'
import './QuickCreateOutputPanel.less'

function assetUrl(asset: CanvasMediaTaskAsset | undefined): string {
  return asset
    ? resolveMediaDisplayUrl({
        url: asset.url,
        filePath: asset.filePath,
        dataUrl: asset.previewDataUrl,
      })
    : ''
}

function inputUrl(input: CanvasMediaTaskInputFile | undefined): string {
  return input ? resolveMediaDisplayUrl({ url: input.url, filePath: input.path }) : ''
}

function fileName(value: string | undefined, fallback: string): string {
  return value?.split(/[\\/]/).pop() || fallback
}

/**
 * 产物没有原始文件名时的兜底名：按产物类型给扩展名，
 * 否则音频产物会被命名成 .png（下载与另存都会带错后缀）。
 */
function defaultOutputFileName(asset: CanvasMediaTaskAsset | undefined, baseName: string): string {
  const extension = asset?.type === 'video' ? 'mp4' : asset?.type === 'audio' ? 'mp3' : 'png'
  return `${baseName}.${extension}`
}

function statusLabel(status: QuickCreateTaskRecord['status']): string {
  return { running: '处理中', succeeded: '已完成', failed: '未完成', cancelled: '已取消' }[status]
}

/** 复制反推产出的提示词：成功/失败都给出明确反馈，不静默失败。 */
async function copyTextOutput(text: string, doneMessage: string) {
  try {
    await copyTextToClipboard(text)
    message.success(doneMessage)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制失败')
  }
}

/**
 * 创作结果面板：产物展示统一交给公用的 MediaArtifactViewer
 * （多图翻页 + 缩略图、输入/输出对比、缩放拖拽、复制下载、打开所在文件夹）。
 * 键盘 ←/→ 翻页、↑/↓ 缩放由 MediaArtifactViewer 负责；大图灯箱盖在上面时把两类按键
 * 都交给灯箱自己接管（keyboardPaging / keyboardZoom 置 false），避免一次按键动两层。
 */
export function QuickCreateOutputPanel({ task }: { task?: QuickCreateTaskRecord | undefined }) {
  const [outputIndex, setOutputIndex] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)

  const outputs = useMemo(
    () =>
      task?.assets.filter(
        (asset) => asset.type === 'image' || asset.type === 'video' || asset.type === 'audio',
      ) ?? [],
    [task?.assets],
  )
  const safeOutputIndex = Math.min(outputIndex, Math.max(outputs.length - 1, 0))
  const currentOutput = outputs[safeOutputIndex]
  const currentUrl = assetUrl(currentOutput)
  const inputImage = task?.inputFiles.find((input) => input.type === 'image')
  const inputImageUrl = inputUrl(inputImage)
  const imageOutputs = outputs.filter((asset) => asset.type === 'image')
  const lightboxImages: LightboxImage[] = imageOutputs
    .map((asset, index) => {
      const src = assetUrl(asset)
      return src
        ? {
            src,
            alt: asset.title ?? `生成结果 ${index + 1}`,
            fileName: fileName(asset.filePath, `quick-create-${index + 1}.png`),
          }
        : null
    })
    .filter((item): item is LightboxImage => item != null)
  const lightboxStartIndex = lightboxImages.findIndex((image) => image.src === currentUrl)

  if (!task) {
    return (
      <section className="quick-create-output-panel is-empty" aria-label="输出预览">
        <div className="quick-create-output-empty">
          <div className="quick-create-output-empty-label">
            <Icons.Image size={17} />
            <strong>等待生成</strong>
          </div>
          <span>填写提示词并点击「生成」，结果会显示在这里。</span>
        </div>
      </section>
    )
  }

  const textOutput = textOutputCopyMeta(task.mode)
  // 反推产物落在 task.text，识别产物落在 text 资产的 contentText；统一从这里取。
  const textResult = taskTextOutput(task)

  return (
    <section className="quick-create-output-panel" aria-label="输出预览">
      <div className="quick-create-output-meta">
        <span className={`quick-create-task-status is-${task.status}`}>
          <i />
          {statusLabel(task.status)}
        </span>
        <span className="quick-create-output-count">
          {outputs.length > 0
            ? `${outputs.length} 个输出`
            : task.status === 'running'
              ? '队列处理中'
              : '暂无输出'}
        </span>
      </div>

      {outputs.length > 0 && currentOutput && currentUrl ? (
        <>
          <div className="quick-create-output-stage">
            <MediaArtifactViewer
              media={{
                src: currentUrl,
                alt: currentOutput.title ?? '生成结果',
                fileName: fileName(
                  currentOutput.filePath,
                  defaultOutputFileName(currentOutput, 'quick-create-output'),
                ),
                ...(currentOutput.filePath ? { filePath: currentOutput.filePath } : {}),
                type:
                  currentOutput.type === 'video'
                    ? 'video'
                    : currentOutput.type === 'audio'
                      ? 'audio'
                      : 'image',
              }}
              {...(inputImageUrl ? { inputImage: { src: inputImageUrl } } : {})}
              pagination={{
                index: safeOutputIndex,
                total: outputs.length,
                onPrev: () =>
                  setOutputIndex((current) => (current - 1 + outputs.length) % outputs.length),
                onNext: () => setOutputIndex((current) => (current + 1) % outputs.length),
              }}
              onOpenFullscreen={imageOutputs.length > 0 ? () => setPreviewOpen(true) : undefined}
              keyboardPaging={!previewOpen}
              keyboardZoom={!previewOpen}
            />
          </div>
          {outputs.length > 1 && (
            <div className="quick-create-output-thumbs" role="tablist" aria-label="输出缩略图">
              {outputs.map((asset, index) => {
                const url = assetUrl(asset)
                if (!url) return null
                return (
                  <button
                    type="button"
                    role="tab"
                    key={`${asset.filePath ?? url}-${index}`}
                    aria-selected={index === safeOutputIndex}
                    className={index === safeOutputIndex ? 'is-active' : ''}
                    aria-label={`查看第 ${index + 1} 个输出`}
                    onClick={() => setOutputIndex(index)}
                  >
                    {asset.type === 'video' ? (
                      <video src={url} muted />
                    ) : asset.type === 'audio' ? (
                      <span className="quick-create-output-thumb-audio" aria-hidden="true">
                        <Icons.AudioLines size={15} />
                      </span>
                    ) : (
                      <img src={url} alt={asset.title ?? `输出 ${index + 1}`} loading="lazy" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : textResult ? (
        // 反推/识别任务的产物就是文本（提示词/转写文本），直接给出可复制入口，
        // 避免用户手动选中长文本。
        <div className="quick-create-output-text-block">
          <div className="quick-create-output-text-head">
            <span>{textOutput.label}</span>
            <Tooltip title={`复制${textOutput.label}`} placement="top">
              <Button
                type="text"
                size="small"
                icon={<Icons.Copy size={13} />}
                aria-label={`复制${textOutput.label}`}
                title={`复制${textOutput.label}`}
                onClick={() => void copyTextOutput(textResult, textOutput.doneMessage)}
              >
                复制
              </Button>
            </Tooltip>
          </div>
          <pre className="quick-create-output-text">{textResult}</pre>
        </div>
      ) : task.status === 'running' ? (
        <div className="quick-create-output-pending">
          <div className="quick-create-output-loader" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <strong>创作进行中</strong>
          <span>任务已加入队列，完成后会自动展示结果。</span>
          {task.progress !== undefined && (
            <div
              className="quick-create-output-progress"
              aria-label={`处理进度 ${Math.round(task.progress)}%`}
            >
              <span style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }} />
            </div>
          )}
          <small>
            {task.progress !== undefined
              ? `${Math.round(task.progress)}%`
              : '可在任务管理中查看详情'}
          </small>
        </div>
      ) : task.status === 'failed' ? (
        <div className="quick-create-output-pending is-error" role="alert">
          <Icons.AlertTriangle size={20} />
          <strong>这次创作没有完成</strong>
          <span>{task.error?.message ?? '任务未能返回结果，请检查配置后重试。'}</span>
        </div>
      ) : (
        <div className="quick-create-output-pending is-cancelled">
          <Icons.XCircle size={20} />
          <strong>任务已取消</strong>
          <span>可以在任务管理中重新提交这项创作。</span>
        </div>
      )}

      {previewOpen && currentOutput?.type === 'image' && lightboxImages.length > 0 && (
        <ImagePreviewModal
          src={currentUrl}
          alt={currentOutput.title ?? '生成结果'}
          fileName={fileName(currentOutput.filePath, 'quick-create-output.png')}
          onClose={() => setPreviewOpen(false)}
          navigation={{
            images: lightboxImages,
            startIndex: Math.max(
              lightboxStartIndex >= 0 ? lightboxStartIndex : imageOutputs.indexOf(currentOutput),
              0,
            ),
          }}
        />
      )}
    </section>
  )
}
