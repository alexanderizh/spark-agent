import { useMemo, useState } from 'react'
import { Button, Input, Tag, Tooltip, message } from 'antd'
import { Select as LobeSelect } from '@lobehub/ui'
import { Icons } from '../../Icons'
import {
  CAMERA_PROMPT_LIBRARY,
  buildCameraPromptFragment,
} from './canvasFilmPrompts'
import { PERFORMANCE_PROMPT_LIBRARY, buildPerformancePromptFragment as buildPerf } from './canvasFilmPerformancePrompts'
import type { CanvasFilmProjectMetadata } from './canvasFilmTypes'

type FilmSeries = NonNullable<NonNullable<CanvasFilmProjectMetadata['series']>>
type FilmFormat = NonNullable<FilmSeries['format']>
type FilmVisualStyle = NonNullable<FilmSeries['visualStyle']>

/**
 * 影视开发面板（文档 §7.10）。
 *
 * 第一阶段（无 AI 解析依赖）：
 *   - 项目影视设置（series：剧名/格式/视觉风格/画幅/旁白风格）
 *   - 镜头语言选择器：从静态库选景别/角度/运镜/构图/质感/节奏，
 *     实时生成合并 prompt 片段，可复制或作为节点插入
 *   - 表情/动作/情绪选择器（同上）
 *   - 角色/场景/分镜入口（占位，提示后续 AI 拆解能力）
 *
 * 数据写入 project.metadata.film（CanvasFilmProjectMetadata）。
 */

const FORMAT_OPTIONS = [
  { label: '电影', value: 'film' },
  { label: '剧集', value: 'series' },
  { label: '短剧', value: 'short_drama' },
  { label: '动画', value: 'animation' },
  { label: '广告', value: 'commercial' },
]

const STYLE_OPTIONS = [
  { label: '2D', value: '2d' },
  { label: '3D', value: '3d' },
  { label: '写实', value: 'realistic' },
  { label: '动漫', value: 'anime' },
  { label: '自定义', value: 'custom' },
]

export function CanvasFilmPanel({
  film,
  onSaveFilm,
}: {
  film: CanvasFilmProjectMetadata | null
  onSaveFilm: (film: CanvasFilmProjectMetadata) => void
}) {
  const [series, setSeries] = useState<FilmSeries>(film?.series ?? {})
  const [selectedCamera, setSelectedCamera] = useState<string[]>([])
  const [selectedPerformance, setSelectedPerformance] = useState<string[]>([])

  const cameraFragment = useMemo(() => buildCameraPromptFragment(selectedCamera), [selectedCamera])
  const performanceFragment = useMemo(() => buildPerf(selectedPerformance), [selectedPerformance])
  const mergedPrompt = [cameraFragment, performanceFragment].filter(Boolean).join(', ')

  const handleSaveSeries = () => {
    const next: CanvasFilmProjectMetadata = {
      ...(film ?? {}),
      series: { ...series },
    }
    onSaveFilm(next)
    message.success('影视项目设置已保存')
  }

  const toggleId = (
    id: string,
    list: string[],
    setter: (next: string[]) => void,
  ) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const copyPrompt = async () => {
    if (!mergedPrompt) {
      message.warning('请先选择镜头语言或表演提示词')
      return
    }
    try {
      await navigator.clipboard.writeText(mergedPrompt)
      message.success('已复制提示词片段')
    } catch {
      message.error('复制失败，请手动选择复制')
    }
  }

  return (
    <div className="canvas-film-panel">
      {/* 项目影视设置 */}
      <section className="canvas-film-section">
        <div className="canvas-film-section-title">
          <Icons.Sparkles size={14} />
          <span>项目设置</span>
        </div>
        <div className="canvas-film-form">
          <label className="canvas-film-field">
            <span>剧名</span>
            <Input
              size="small"
              value={series.title ?? ''}
              placeholder="输入剧名"
              onChange={(e) => setSeries({ ...series, title: e.target.value })}
            />
          </label>
          <div className="canvas-film-field-row">
            <label className="canvas-film-field">
              <span>格式</span>
              <LobeSelect
                size="small"
                value={series.format ?? 'short_drama'}
                onChange={(v) => setSeries({ ...series, format: v as FilmFormat })}
                options={FORMAT_OPTIONS}
              />
            </label>
            <label className="canvas-film-field">
              <span>视觉风格</span>
              <LobeSelect
                size="small"
                value={series.visualStyle ?? 'realistic'}
                onChange={(v) => setSeries({ ...series, visualStyle: v as FilmVisualStyle })}
                options={STYLE_OPTIONS}
              />
            </label>
          </div>
          <div className="canvas-film-field-row">
            <label className="canvas-film-field">
              <span>画幅</span>
              <LobeSelect
                size="small"
                value={series.aspectRatio ?? '9:16'}
                onChange={(v) => setSeries({ ...series, aspectRatio: v })}
                options={[
                  { label: '9:16 竖屏', value: '9:16' },
                  { label: '16:9 横屏', value: '16:9' },
                  { label: '1:1 方形', value: '1:1' },
                  { label: '2.35:1 宽幕', value: '2.35:1' },
                ]}
              />
            </label>
            <label className="canvas-film-field">
              <span>旁白风格</span>
              <LobeSelect
                size="small"
                value={series.narrationStyle ?? 'suspense'}
                onChange={(v) => setSeries({ ...series, narrationStyle: v })}
                options={[
                  { label: '悬疑解说', value: 'suspense' },
                  { label: '爽文解说', value: 'cool' },
                  { label: '情感解说', value: 'emotional' },
                  { label: '纪录片', value: 'documentary' },
                ]}
              />
            </label>
          </div>
          <Button size="small" type="primary" onClick={handleSaveSeries}>
            保存项目设置
          </Button>
        </div>
      </section>

      {/* 镜头语言选择器 */}
      <section className="canvas-film-section">
        <div className="canvas-film-section-title">
          <Icons.Image size={14} />
          <span>镜头语言</span>
          {selectedCamera.length > 0 && (
            <Tag color="blue" bordered className="canvas-film-count">已选 {selectedCamera.length}</Tag>
          )}
        </div>
        {CAMERA_PROMPT_LIBRARY.map((group) => (
          <div key={group.category} className="canvas-film-prompt-group">
            <div className="canvas-film-prompt-group-label">{group.label}</div>
            <div className="canvas-film-prompt-chips">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`canvas-film-chip${selectedCamera.includes(item.id) ? ' active' : ''}`}
                  title={item.promptFragment}
                  onClick={() => toggleId(item.id, selectedCamera, setSelectedCamera)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 表演提示词选择器 */}
      <section className="canvas-film-section">
        <div className="canvas-film-section-title">
          <Icons.Play size={14} />
          <span>表情 / 动作 / 情绪</span>
          {selectedPerformance.length > 0 && (
            <Tag color="orange" bordered className="canvas-film-count">已选 {selectedPerformance.length}</Tag>
          )}
        </div>
        {PERFORMANCE_PROMPT_LIBRARY.map((group) => (
          <div key={group.category} className="canvas-film-prompt-group">
            <div className="canvas-film-prompt-group-label">{group.label}</div>
            <div className="canvas-film-prompt-chips">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`canvas-film-chip${selectedPerformance.includes(item.id) ? ' active perf' : ''}`}
                  title={item.promptFragment}
                  onClick={() => toggleId(item.id, selectedPerformance, setSelectedPerformance)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 合并 prompt 预览 */}
      <section className="canvas-film-section canvas-film-prompt-preview">
        <div className="canvas-film-section-title">
          <Icons.File size={14} />
          <span>合并提示词</span>
        </div>
        {mergedPrompt ? (
          <pre className="canvas-film-prompt-text">{mergedPrompt}</pre>
        ) : (
          <div className="canvas-film-empty">选择镜头语言或表演提示词后，这里会生成可复制的提示词片段</div>
        )}
        <Button size="small" icon={<Icons.Copy size={13} />} disabled={!mergedPrompt} onClick={() => void copyPrompt()}>
          复制片段
        </Button>
      </section>

      {/* 占位：角色/场景/分镜（后续 AI 拆解） */}
      <section className="canvas-film-section canvas-film-placeholders">
        <div className="canvas-film-section-title">
          <Icons.Layers size={14} />
          <span>结构化资产</span>
        </div>
        <div className="canvas-film-placeholder-grid">
          <Tooltip title="剧本导入与自动拆解（开发中）">
            <div className="canvas-film-placeholder-card">
              <Icons.File size={18} />
              <span>剧本拆解</span>
            </div>
          </Tooltip>
          <Tooltip title="角色库（开发中）">
            <div className="canvas-film-placeholder-card">
              <Icons.Image size={18} />
              <span>角色库</span>
            </div>
          </Tooltip>
          <Tooltip title="场景库（开发中）">
            <div className="canvas-film-placeholder-card">
              <Icons.Layers size={18} />
              <span>场景库</span>
            </div>
          </Tooltip>
          <Tooltip title="分镜脚本（开发中）">
            <div className="canvas-film-placeholder-card">
              <Icons.Play size={18} />
              <span>分镜脚本</span>
            </div>
          </Tooltip>
        </div>
      </section>
    </div>
  )
}
