import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ThHTMLAttributes,
} from 'react'
import { Table, Tag, Tooltip, type TableProps } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { ShotGroup, ShotSegment } from './canvasFilmAssets'
import type { CanvasAsset } from './canvas.types'
import { resolveSegmentDuration } from './canvasShotSplit'
import { DEFAULT_MAX_CLIP_SEC } from './canvasAgentPromptPresets'
import { formatTimecode } from './canvasFilmTimeline'

// ── 局部窄类型：避免与 CanvasFilmAssetCenter 形成循环依赖 ─────────────
type SegmentGenerationInput = {
  group: ShotGroup
  segment: ShotSegment
  characters: CanvasAsset[]
  scene?: CanvasAsset
}

type ShotSegmentTableHandlers = {
  onGenerateSegmentKeyframes?: (input: SegmentGenerationInput) => void
  onGenerateSegmentVideo?: (input: SegmentGenerationInput) => void
  deleteShotSegment: (groupId: string, segmentId: string) => Promise<void>
}

type ShotSegmentRow = {
  segment: ShotSegment
  duration: number
  inSec: number
  outSec: number
  characters: CanvasAsset[]
  scene: CanvasAsset | undefined
}

// ── 可拖拽列宽 ────────────────────────────────────────────────────────
type ColKey = 'idx' | 'time' | 'dur' | 'desc' | 'shot' | 'line' | 'refs' | 'ops'

const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  idx: 64,
  time: 116,
  dur: 72,
  desc: 220,
  shot: 140,
  line: 160,
  refs: 160,
  ops: 176,
}

const MIN_COL_WIDTH = 60
const RESIZABLE_KEY = 'data-resizable-key' as const

type ResizeHandler = (key: ColKey, width: number) => void
const ColumnResizeContext = createContext<ResizeHandler>(() => {})

/** onHeaderCell 返回值：把列标识 + 当前列宽透传给自定义表头单元格。
 *  必须显式返回 width——@rc-component/table 的 Cell 只会把 onHeaderCell 返回值 spread 到 th，
 *  column.width 不会自动注入；不返回 width 则 ResizableHeaderCell 拿不到、拖拽手柄不会渲染。 */
function resizableHeaderAttrs(key: ColKey, width: number): HTMLAttributes<HTMLTableCellElement> {
  return {
    [RESIZABLE_KEY]: key,
    width,
  } as unknown as HTMLAttributes<HTMLTableCellElement>
}

/** document 级拖拽：按下 → mousemove 实时更新列宽 → mouseup 收尾。零依赖、可控。 */
function startColumnResize(
  event: ReactMouseEvent,
  colKey: ColKey,
  startWidth: number,
  onResize: ResizeHandler,
) {
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const onMove = (ev: MouseEvent) => {
    const next = Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX))
    onResize(colKey, next)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

type ResizableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  width?: number
  'data-resizable-key'?: ColKey
}

function ResizableHeaderCell({
  width,
  'data-resizable-key': colKey,
  children,
  style,
  ...rest
}: ResizableHeaderCellProps) {
  const onResize = useContext(ColumnResizeContext)
  if (!colKey || !width) {
    return (
      <th style={style} {...rest}>
        {children}
      </th>
    )
  }
  return (
    <th style={{ ...style, position: 'relative' }} {...rest}>
      {children}
      <span
        className="canvas-shot-segment-resizer"
        onMouseDown={(e) => startColumnResize(e, colKey, width, onResize)}
      />
    </th>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────────
export function ShotSegmentTable({
  group,
  characterAssets,
  sceneAssets,
  handlers,
  onEdit,
  onSplit,
}: {
  group: ShotGroup
  characterAssets: CanvasAsset[]
  sceneAssets: CanvasAsset[]
  handlers: ShotSegmentTableHandlers
  onEdit: (id: string) => void
  onSplit: (segment: ShotSegment) => void
}) {
  const [widths, setWidths] = useState<Record<ColKey, number>>(DEFAULT_COL_WIDTHS)
  const handleResize: ResizeHandler = (key, width) =>
    setWidths((prev) => ({ ...prev, [key]: width }))

  // 累计时间码：优先用片段自带 inSec，否则按时长顺序累加（算法沿用原实现）
  let cursor = 0
  const rows: ShotSegmentRow[] = group.segments.map((segment) => {
    const duration = resolveSegmentDuration(segment)
    const inSec = typeof segment.inSec === 'number' ? segment.inSec : cursor
    const outSec = typeof segment.outSec === 'number' ? segment.outSec : inSec + duration
    cursor = outSec
    const characters = (segment.characterAssetIds ?? [])
      .map((id) => characterAssets.find((asset) => asset.id === id))
      .filter((asset): asset is CanvasAsset => Boolean(asset))
    const scene = segment.sceneAssetId
      ? sceneAssets.find((asset) => asset.id === segment.sceneAssetId)
      : undefined
    return { segment, duration, inSec, outSec, characters, scene }
  })
  const totalSec = rows.reduce((sum, row) => sum + row.duration, 0)

  const triggerGen = (row: ShotSegmentRow) => ({
    group,
    segment: row.segment,
    characters: row.characters,
    ...(row.scene ? { scene: row.scene } : {}),
  })

  const columns: TableProps<ShotSegmentRow>['columns'] = [
    {
      key: 'idx',
      title: '镜号',
      width: widths.idx,
      onHeaderCell: () => resizableHeaderAttrs('idx', widths.idx),
      render: (_value, row) => (
        <span className="canvas-shot-seg-idx">
          #{row.segment.index}
          {row.segment.keyframeNodeIds && row.segment.keyframeNodeIds.length > 0 && (
            <span className="canvas-shot-seg-kf" title="已设关键帧">
              🎞{row.segment.keyframeNodeIds.length}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'time',
      title: '时间码',
      width: widths.time,
      onHeaderCell: () => resizableHeaderAttrs('time', widths.time),
      render: (_value, row) => (
        <span className="canvas-shot-seg-time">
          {formatTimecode(row.inSec)}–{formatTimecode(row.outSec)}
        </span>
      ),
    },
    {
      key: 'dur',
      title: '时长',
      width: widths.dur,
      onHeaderCell: () => resizableHeaderAttrs('dur', widths.dur),
      render: (_value, row) => {
        const overLimit = row.duration > DEFAULT_MAX_CLIP_SEC
        return (
          <span className={overLimit ? 'canvas-shot-seg-over' : undefined}>
            {row.duration}s
            {overLimit && (
              <Tooltip title={`超过单段上限 ${DEFAULT_MAX_CLIP_SEC}s，建议拆分`}>
                <span className="canvas-shot-seg-warn">!</span>
              </Tooltip>
            )}
          </span>
        )
      },
    },
    {
      key: 'desc',
      title: '画面 / 动作',
      width: widths.desc,
      onHeaderCell: () => resizableHeaderAttrs('desc', widths.desc),
      render: (_value, row) => (
        <div className="canvas-shot-seg-desc">
          <div className="canvas-shot-seg-title">{row.segment.title}</div>
          {row.segment.description && <div>{row.segment.description}</div>}
        </div>
      ),
    },
    {
      key: 'shot',
      title: '镜头',
      width: widths.shot,
      onHeaderCell: () => resizableHeaderAttrs('shot', widths.shot),
      render: (_value, row) => (
        <span className="canvas-shot-seg-text">{row.segment.shotPrompt || '—'}</span>
      ),
    },
    {
      key: 'line',
      title: '对白',
      width: widths.line,
      onHeaderCell: () => resizableHeaderAttrs('line', widths.line),
      render: (_value, row) => (
        <span className="canvas-shot-seg-text">{row.segment.dialogue || '—'}</span>
      ),
    },
    {
      key: 'refs',
      title: '角色 / 场景',
      width: widths.refs,
      onHeaderCell: () => resizableHeaderAttrs('refs', widths.refs),
      render: (_value, row) => (
        <div className="canvas-shot-seg-refs">
          {row.scene && <Tag color="blue">{row.scene.title ?? '场景'}</Tag>}
          {row.characters.map((character) => (
            <Tag key={character.id} color="orange">
              {character.title}
            </Tag>
          ))}
          {!row.scene && row.characters.length === 0 && '—'}
        </div>
      ),
    },
    {
      key: 'ops',
      title: '操作',
      width: widths.ops,
      // 操作列不注入 RESIZABLE_KEY → 不可拖拽，固定宽度
      render: (_value, row) => (
        <div className="canvas-shot-seg-ops">
          {handlers.onGenerateSegmentKeyframes && (
            <Tooltip title="生成关键帧（首/尾帧）">
              <Button
                size="small"
                type="text"
                icon={<Icons.Image size={13} />}
                onClick={() => handlers.onGenerateSegmentKeyframes?.(triggerGen(row))}
              />
            </Tooltip>
          )}
          {handlers.onGenerateSegmentVideo && (
            <Tooltip title="生成视频">
              <Button
                size="small"
                type="text"
                icon={<Icons.Play size={13} />}
                onClick={() => handlers.onGenerateSegmentVideo?.(triggerGen(row))}
              />
            </Tooltip>
          )}
          <Tooltip title="拆分为多段（适配短视频模型）">
            <Button
              size="small"
              type="text"
              icon={<Icons.Scissors size={13} />}
              onClick={() => onSplit(row.segment)}
            />
          </Tooltip>
          <Button
            size="small"
            type="text"
            icon={<Icons.Edit size={13} />}
            onClick={() => onEdit(row.segment.id)}
          />
          <Button
            size="small"
            type="text"
            danger
            icon={<Icons.Trash size={13} />}
            onClick={() => void handlers.deleteShotSegment(group.id, row.segment.id)}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="canvas-shot-segment-table-wrap">
      <ColumnResizeContext.Provider value={handleResize}>
        <Table<ShotSegmentRow>
          size="small"
          rowKey={(row) => row.segment.id}
          dataSource={rows}
          columns={columns}
          pagination={false}
          components={{ header: { cell: ResizableHeaderCell } }}
          scroll={{ x: 'max-content', y: 360 }}
        />
      </ColumnResizeContext.Provider>
      <div className="canvas-shot-seg-foot">
        共 {rows.length} 镜 · 总时长 {formatTimecode(totalSec)}（{totalSec}s）
      </div>
    </div>
  )
}
