import type { CanvasOperationOutputView, CanvasOperationRunView } from './canvasOperationRuns'

export type CanvasOperationMediaThumbnailItem = {
  key: string
  runIndex: number
  outputIndex: number
  output: CanvasOperationOutputView
  previewUrl: string
  previewKind: 'image' | 'video'
}

/**
 * 将已按时间倒序排列的运行历史展平成单行媒体切换项。
 * 图片可直接使用原始 URL；视频缺少 poster 时保留 video URL，由视图渲染静音画面。
 */
export function buildCanvasOperationMediaThumbnailItems(
  runs: CanvasOperationRunView[],
): CanvasOperationMediaThumbnailItem[] {
  return runs.flatMap((run, runIndex) =>
    run.outputs.flatMap((output, outputIndex) => {
      if (output.type !== 'image' && output.type !== 'video') return []
      const previewUrl = output.thumbnailUrl ?? output.url
      if (!previewUrl) return []
      return [
        {
          key: `${run.taskId}:${output.id}`,
          runIndex,
          outputIndex,
          output,
          previewUrl,
          previewKind: output.thumbnailUrl || output.type === 'image' ? 'image' : 'video',
        } satisfies CanvasOperationMediaThumbnailItem,
      ]
    }),
  )
}
