import { useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Input, Modal, Popover, message } from 'antd'
import { Icons } from '../../Icons'
import { CanvasPromptEditor } from './CanvasPromptEditor'
import { CanvasPromptLibraryPanel } from './CanvasPromptLibraryPanel'
import { readAssetKind } from './canvasFilmAssets'
import { parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import { isRenderableShotScriptText } from './canvasShotScriptPresentation'
import { appendPromptFragment, buildPromptOptimizationInstruction } from './canvasPromptEditing'
import type { CanvasAsset, CanvasNode, CanvasTask } from './canvas.types'

const EMPTY_SHOT_ROW: ParsedShotRow = {
  title: '镜头',
  description: '',
}

function serializeShotRowsToMarkdown(rows: ParsedShotRow[]): string {
  const body = rows.map((row, index) =>
    [
      row.index ?? index + 1,
      row.durationSec ?? '',
      row.shotSize ?? '',
      row.movement ?? '',
      row.sceneLayout ?? '',
      row.blocking ?? '',
      row.lighting ?? '',
      row.cameraParams ?? '',
      row.performance ?? '',
      row.description ?? row.title ?? '',
      row.dialogue ?? '',
      row.characterNames?.join('、') ?? '',
      row.shotPrompt ?? '',
      row.negativePrompt ?? '',
    ]
      .map((cell) => String(cell).replace(/\|/g, '｜').replace(/\n/g, ' '))
      .join(' | '),
  )
  return [
    '| 镜号 | 时长(秒) | 景别 | 运镜 | 场景描述 | 站位调度 | 光照 | 镜头参数 | 微表情动作 | 画面/动作 | 对白 | 角色 | 生成提示词 | 反向提示词 |',
    '|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...body.map((line) => `| ${line} |`),
  ].join('\n')
}

function updateShotRowField(
  rows: ParsedShotRow[],
  index: number,
  patch: Partial<ParsedShotRow>,
): ParsedShotRow[] {
  return rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
}

function CanvasShotScriptEditPanel({
  rows,
  characterAssets,
  onRowsChange,
}: {
  rows: ParsedShotRow[]
  characterAssets: CanvasAsset[]
  onRowsChange: (rows: ParsedShotRow[]) => void
}) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const updateRow = (index: number, patch: Partial<ParsedShotRow>) =>
    onRowsChange(updateShotRowField(rows, index, patch))
  const toggleCharacter = (index: number, characterName: string) => {
    const current = rows[index]?.characterNames ?? []
    updateRow(index, {
      characterNames: current.includes(characterName)
        ? current.filter((name) => name !== characterName)
        : [...current, characterName],
    })
  }
  const handleTableWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return
    const tableWrap = tableWrapRef.current
    if (!tableWrap) return
    const maxScrollLeft = tableWrap.scrollWidth - tableWrap.clientWidth
    if (maxScrollLeft <= 0) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) return
    event.preventDefault()
    tableWrap.scrollLeft += delta
  }
  return (
    <div className="canvas-shot-script-editor">
      <div className="canvas-shot-script-editor-toolbar">
        <span>{rows.length} 个镜头</span>
        <Button
          size="middle"
          type="text"
          icon={<Icons.Plus size={13} />}
          onClick={() =>
            onRowsChange([
              ...rows,
              {
                ...EMPTY_SHOT_ROW,
                index: rows.length + 1,
                title: `镜${rows.length + 1}`,
              },
            ])
          }
        >
          添加镜头
        </Button>
      </div>
      <div
        ref={tableWrapRef}
        className="canvas-shot-script-editor-table-wrap"
        onWheel={handleTableWheel}
      >
        <table className="canvas-shot-script-editor-table">
          <thead>
            <tr>
              <th>镜号</th>
              <th>时长</th>
              <th>景别</th>
              <th>运镜</th>
              <th>场景描述</th>
              <th>站位调度</th>
              <th>光照</th>
              <th>镜头参数</th>
              <th>微表情动作</th>
              <th>画面 / 动作</th>
              <th>对白</th>
              <th>角色</th>
              <th>生成提示词</th>
              <th>反向提示词</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>
                  <Input
                    size="middle"
                    value={row.index ?? index + 1}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10)
                      if (Number.isFinite(next)) {
                        updateRow(index, { index: next })
                        return
                      }
                      onRowsChange(
                        rows.map((item, rowIndex) => {
                          if (rowIndex !== index) return item
                          const { index: _index, ...rest } = item
                          return rest
                        }),
                      )
                    }}
                  />
                </td>
                <td>
                  <Input
                    size="middle"
                    value={row.durationSec ?? ''}
                    suffix="s"
                    onChange={(event) => {
                      const next = Number.parseFloat(event.target.value)
                      if (Number.isFinite(next) && next > 0) {
                        updateRow(index, { durationSec: next })
                        return
                      }
                      onRowsChange(
                        rows.map((item, rowIndex) => {
                          if (rowIndex !== index) return item
                          const { durationSec: _durationSec, ...rest } = item
                          return rest
                        }),
                      )
                    }}
                  />
                </td>
                <td>
                  <Input
                    size="middle"
                    value={row.shotSize ?? ''}
                    onChange={(event) => updateRow(index, { shotSize: event.target.value })}
                  />
                </td>
                <td>
                  <Input
                    size="middle"
                    value={row.movement ?? ''}
                    onChange={(event) => updateRow(index, { movement: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.sceneLayout ?? ''}
                    onChange={(event) => updateRow(index, { sceneLayout: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.blocking ?? ''}
                    onChange={(event) => updateRow(index, { blocking: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.lighting ?? ''}
                    onChange={(event) => updateRow(index, { lighting: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.cameraParams ?? ''}
                    onChange={(event) => updateRow(index, { cameraParams: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.performance ?? ''}
                    onChange={(event) => updateRow(index, { performance: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    value={row.description ?? row.title ?? ''}
                    onChange={(event) =>
                      updateRow(index, {
                        description: event.target.value,
                        title: row.title || `镜${row.index ?? index + 1}`,
                      })
                    }
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.dialogue ?? ''}
                    onChange={(event) => updateRow(index, { dialogue: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-character">
                  <div className="canvas-shot-script-character-cell">
                    {characterAssets.length > 0 ? (
                      characterAssets.map((asset) => {
                        const name = asset.title ?? asset.id
                        const active = row.characterNames?.includes(name)
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            className={`canvas-shot-script-character-chip${active ? ' is-active' : ''}`}
                            onClick={() => toggleCharacter(index, name)}
                          >
                            {name}
                          </button>
                        )
                      })
                    ) : (
                      <span className="canvas-shot-script-empty">暂无角色资产</span>
                    )}
                    <Input
                      size="middle"
                      value={row.characterNames?.join('、') ?? ''}
                      placeholder="可手动输入角色名"
                      onChange={(event) =>
                        updateRow(index, {
                          characterNames: event.target.value
                            .split(/[,，、/\s]+/)
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    value={row.shotPrompt ?? ''}
                    onChange={(event) => updateRow(index, { shotPrompt: event.target.value })}
                  />
                </td>
                <td className="canvas-shot-script-editor-cell is-multiline">
                  <Input.TextArea
                    className="canvas-shot-script-editor-textarea"
                    value={row.negativePrompt ?? ''}
                    onChange={(event) => updateRow(index, { negativePrompt: event.target.value })}
                  />
                </td>
                <td>
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Trash size={13} />}
                    disabled={rows.length <= 1}
                    onClick={() => onRowsChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CanvasNodeEditModal({
  node,
  open,
  assets,
  tasks,
  placement = 'floating',
  onClose,
  onSave,
}: {
  node: CanvasNode | null
  open: boolean
  assets: CanvasAsset[]
  tasks: CanvasTask[]
  placement?: 'floating' | 'inline'
  onClose: () => void
  onSave: (node: CanvasNode, patch: Partial<CanvasNode>, data: CanvasNode['data']) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [messageText, setMessageText] = useState('')
  const [url, setUrl] = useState('')
  const [editFullscreen, setEditFullscreen] = useState(false)
  const [shotRows, setShotRows] = useState<ParsedShotRow[]>([])
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false)
  const [optimizeRequirement, setOptimizeRequirement] = useState('')
  const [optimizing, setOptimizing] = useState(false)
  const isTextLike = node?.type === 'text' || node?.type === 'prompt'
  const isShotScriptNode =
    node?.type === 'text' &&
    isRenderableShotScriptText(node.data.text)

  useEffect(() => {
    if (!node) return
    setSaving(false)
    setTitle(node.title ?? '')
    setText(node.data.text ?? '')
    setPrompt(node.data.prompt ?? '')
    setNegativePrompt('')
    setMessageText(node.data.message ?? '')
    setUrl(node.data.url ?? '')
    setShotRows(parseShotTable(node.data.text ?? ''))
    setOptimizeModalOpen(false)
    setOptimizeRequirement('')
  }, [node])

  const insertPromptText = (fragment: string) => {
    setText((current) => appendPromptFragment(current, fragment))
  }

  const openOptimizeModal = () => {
    const source = text.trim()
    if (!source) {
      message.warning('请先输入需要优化的文本或 Prompt')
      return
    }
    setOptimizeRequirement('')
    setOptimizeModalOpen(true)
  }

  const confirmPromptOptimize = async () => {
    const source = text.trim()
    if (!source) {
      message.warning('请先输入需要优化的文本或 Prompt')
      return
    }
    setOptimizing(true)
    try {
      const runtimeTask = node?.taskId ? tasks.find((task) => task.id === node.taskId) : undefined
      const response = await window.spark.invoke('canvas:task:generate-text', {
        operation: 'prompt_optimize',
        prompt: buildPromptOptimizationInstruction(source, negativePrompt, optimizeRequirement),
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        ...(runtimeTask?.agentId ? { agentId: runtimeTask.agentId } : {}),
        ...(runtimeTask?.providerProfileId
          ? { providerProfileId: runtimeTask.providerProfileId }
          : {}),
        ...(runtimeTask?.modelId ? { modelId: runtimeTask.modelId } : {}),
        ...(runtimeTask?.reasoningEffort ? { reasoningEffort: runtimeTask.reasoningEffort } : {}),
        ...(runtimeTask?.skillIds && runtimeTask.skillIds.length > 0
          ? { skillIds: runtimeTask.skillIds }
          : {}),
      })
      if (response.status !== 'succeeded' || !response.text.trim()) {
        throw new Error(response.error?.message ?? 'AI 优化失败')
      }
      setText(response.text.trim())
      setOptimizeModalOpen(false)
      message.success('已应用 AI 优化结果')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 优化失败')
    } finally {
      setOptimizing(false)
    }
  }

  const save = async () => {
    if (!node) return
    setSaving(true)
    try {
      const nextData: CanvasNode['data'] = { ...node.data }
      if (node.type === 'text' || node.type === 'prompt' || node.type === 'group') {
        nextData.text = isShotScriptNode ? serializeShotRowsToMarkdown(shotRows) : text
      }
      if (node.type === 'text' || node.type === 'prompt') {
        nextData.format = node.type === 'prompt' ? 'prompt' : 'markdown'
      }
      if (node.type === 'task') {
        nextData.prompt = prompt
      }
      if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
        nextData.url = url.trim()
      }
      if (node.type !== 'text' && node.type !== 'prompt') {
        nextData.message = messageText
      }

      await onSave(
        node,
        {
          title: title.trim().length > 0 ? title.trim() : null,
        },
        nextData,
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存节点失败')
      setSaving(false)
    }
  }

  if (!open || !node) return null
  const fullscreenLabel = editFullscreen ? '退出全屏' : '全屏编辑'
  const fullscreenIcon = editFullscreen ? (
    <Icons.Minimize size={14} />
  ) : (
    <Icons.Maximize size={14} />
  )
  const toggleFullscreen = () => setEditFullscreen((current) => !current)

  const optimizeModal = (
    <Modal
      title="AI 优化提示词"
      open={optimizeModalOpen}
      onCancel={() => setOptimizeModalOpen(false)}
      onOk={() => void confirmPromptOptimize()}
      okText="开始优化"
      cancelText="取消"
      confirmLoading={optimizing}
      destroyOnHidden
    >
      <div className="canvas-node-edit-optimize-modal-body">
        <p>请输入本次优化的具体要求，AI 将基于当前提示词生成新版本并直接替换。</p>
        <Input.TextArea
          value={optimizeRequirement}
          rows={4}
          placeholder="例如：增强镜头语言和光影描写、更简洁、突出角色情绪…（可留空，使用默认优化策略）"
          onChange={(event) => setOptimizeRequirement(event.target.value)}
          autoFocus
        />
      </div>
    </Modal>
  )

  if (isShotScriptNode && placement === 'inline') {
    return (
      <div
        className={`canvas-bottom-floating-panel canvas-node-edit-bottom-panel canvas-shot-script-edit-panel is-inline${editFullscreen ? ' is-fullscreen' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="canvas-bottom-floating-head canvas-node-edit-bottom-head">
          <div>
            <strong>编辑分镜脚本</strong>
            <span>以表格方式编辑镜号、景别、运镜、画面、对白和角色</span>
          </div>
          <div className="canvas-node-edit-bottom-actions">
            <Tooltip title={fullscreenLabel}>
              <Button
                size="middle"
                type="text"
                icon={fullscreenIcon}
                aria-label={fullscreenLabel}
                onClick={toggleFullscreen}
              />
            </Tooltip>
            <Button size="middle" type="primary" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </div>
        </div>
        <div className="canvas-bottom-floating-body canvas-node-edit-bottom-body">
          <CanvasShotScriptEditPanel
            rows={shotRows}
            characterAssets={assets.filter((asset) => readAssetKind(asset) === 'character')}
            onRowsChange={setShotRows}
          />
        </div>
      </div>
    )
  }

  if (isTextLike && placement === 'inline' && !editFullscreen) {
    return (
      <>
        <div
          className="canvas-bottom-floating-panel canvas-node-edit-bottom-panel is-inline is-composer"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="canvas-node-text-composer-top">
            <div className="canvas-node-text-composer-title">
              <Tag color="default" bordered>
                {node.type === 'prompt' ? 'Prompt' : 'Text'}
              </Tag>
              <label className="canvas-node-text-composer-title-input">
                <span>标题</span>
                <Input
                  size="middle"
                  value={title}
                  placeholder="节点标题"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="canvas-node-text-composer-file">
                <Icons.File size={13} />
                <span>{node.id}</span>
              </div>
            </div>
            <div className="canvas-node-text-composer-actions">
              <Tooltip title="全屏编辑">
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Maximize size={15} />}
                  aria-label="全屏编辑"
                  onClick={() => setEditFullscreen(true)}
                />
              </Tooltip>
            </div>
          </div>

          <div className="canvas-node-text-composer-main">
            <Input.TextArea
              className="canvas-node-text-composer-textarea"
              value={text}
              rows={4}
              placeholder="输入文本、剧情段落、生成提示词或需要 agent 改写的要求"
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <div className="canvas-node-text-composer-bottom">
            <div className="canvas-node-text-composer-params">
              <Popover
                trigger="hover"
                mouseEnterDelay={0.08}
                mouseLeaveDelay={0.22}
                placement="top"
                content={
                  <div className="canvas-node-text-composer-library-popover">
                    <CanvasPromptLibraryPanel
                      assets={assets}
                      className="canvas-node-edit-prompt-library canvas-node-edit-prompt-library-compact"
                      limit={24}
                      onApply={(entry) => insertPromptText(entry.text)}
                    />
                  </div>
                }
              >
                <Button size="middle" icon={<Icons.Folder size={13} />}>
                  提示词库
                </Button>
              </Popover>
              <Popover
                trigger="hover"
                mouseEnterDelay={0.08}
                mouseLeaveDelay={0.22}
                placement="top"
                content={
                  <div className="canvas-node-text-composer-popover">
                    <div className="canvas-node-text-composer-popover-title">反向提示词</div>
                    <Input.TextArea
                      value={negativePrompt}
                      rows={5}
                      placeholder="可选：输入不希望出现的内容，AI 优化时会一并参考"
                      onChange={(event) => setNegativePrompt(event.target.value)}
                    />
                  </div>
                }
              >
                <Button size="middle" type={negativePrompt.trim() ? 'primary' : 'default'}>
                  反向提示词
                </Button>
              </Popover>
              <Button
                size="middle"
                icon={<Icons.Sparkles size={13} />}
                disabled={text.trim().length === 0}
                onClick={openOptimizeModal}
              >
                AI 优化
              </Button>
            </div>
            <div className="canvas-node-text-composer-save">
              <span>{text.trim().length} 字符</span>
              <Button size="middle" type="primary" loading={saving} onClick={() => void save()}>
                保存
              </Button>
            </div>
          </div>
        </div>
        {optimizeModal}
      </>
    )
  }

  const content = (
    <div className="canvas-node-edit-dialog">
      <div className="canvas-node-edit-dialog-head">
        <Tag color="default" bordered>
          {node.type}
        </Tag>
        <span>{node.id}</span>
      </div>
      <label className="canvas-node-edit-field canvas-node-edit-field-wide">
        <span>标题</span>
        <Input
          value={title}
          placeholder="节点标题"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {isTextLike && (
        <div className="canvas-node-edit-prompt-layout">
          <div className="canvas-node-edit-prompt-main">
            <CanvasPromptEditor
              prompt={text}
              negativePrompt={negativePrompt}
              promptPlaceholder="输入文本、剧情段落、生成提示词或需要 agent 改写的要求"
              negativePlaceholder="可选：输入不希望出现的内容，AI 优化时会一并参考"
              optimizeDisabled={text.trim().length === 0}
              onPromptChange={setText}
              onNegativePromptChange={setNegativePrompt}
              onOptimizePrompt={openOptimizeModal}
            />
          </div>
          <CanvasPromptLibraryPanel
            assets={assets}
            className="canvas-node-edit-prompt-library"
            onApply={(entry) => insertPromptText(entry.text)}
          />
        </div>
      )}
      {node.type === 'group' && (
        <label className="canvas-node-edit-field canvas-node-edit-field-wide">
          <span>组说明</span>
          <Input.TextArea
            value={text}
            rows={5}
            placeholder="输入节点内容"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      {node.type === 'task' && (
        <div className="canvas-node-edit-task-prompt">
          <label className="canvas-node-edit-field canvas-node-edit-field-wide">
            <span>任务指令</span>
            <Input.TextArea
              value={prompt}
              rows={6}
              placeholder="任务使用的 prompt"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <CanvasPromptLibraryPanel
            assets={assets}
            className="canvas-node-edit-prompt-library canvas-node-edit-prompt-library-compact"
            limit={24}
            onApply={(entry) => setPrompt((current) => appendPromptFragment(current, entry.text))}
          />
        </div>
      )}
      {(node.type === 'image' || node.type === 'video' || node.type === 'audio') && (
        <label className="canvas-node-edit-field canvas-node-edit-field-wide">
          <span>媒体 URL</span>
          <Input
            value={url}
            placeholder="https:// 或 data: URL"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
      )}
      {node.type !== 'text' && node.type !== 'prompt' && (
        <label className="canvas-node-edit-field canvas-node-edit-field-wide">
          <span>备注 / 展示文本</span>
          <Input.TextArea
            value={messageText}
            rows={5}
            placeholder="节点内展示的辅助文本"
            onChange={(event) => setMessageText(event.target.value)}
          />
        </label>
      )}
    </div>
  )

  if (isTextLike || placement === 'inline') {
    return (
      <>
        <div
          className={`canvas-bottom-floating-panel canvas-node-edit-bottom-panel${placement === 'inline' ? ' is-inline' : ''}${editFullscreen ? ' is-fullscreen' : ''}`}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="canvas-bottom-floating-head canvas-node-edit-bottom-head">
            <div>
              <strong>{isTextLike ? '编辑文本 / Prompt 节点' : '编辑节点'}</strong>
              <span>
                {placement === 'inline'
                  ? '在节点内部直接调整，保持画布上下文'
                  : '统一在底部工具栏上方编辑，避免遮挡画布上下文'}
              </span>
            </div>
            <div className="canvas-node-edit-bottom-actions">
              <Tooltip title={fullscreenLabel}>
                <Button
                  size="middle"
                  type="text"
                  icon={fullscreenIcon}
                  aria-label={fullscreenLabel}
                  onClick={toggleFullscreen}
                />
              </Tooltip>
              {placement !== 'inline' && (
                <Button size="middle" onClick={onClose}>
                  取消
                </Button>
              )}
              <Button size="middle" type="primary" loading={saving} onClick={() => void save()}>
                保存
              </Button>
            </div>
          </div>
          <div className="canvas-bottom-floating-body canvas-node-edit-bottom-body">{content}</div>
        </div>
        {optimizeModal}
      </>
    )
  }

  return (
    <>
      <Modal
        className={`canvas-node-edit-modal${editFullscreen ? ' canvas-node-edit-modal-fullscreen' : ''}`}
        title={
          <div className="canvas-node-edit-modal-title">
            <span>编辑节点</span>
            <Tooltip title={fullscreenLabel}>
              <Button
                size="middle"
                type="text"
                icon={fullscreenIcon}
                aria-label={fullscreenLabel}
                onClick={toggleFullscreen}
              />
            </Tooltip>
          </div>
        }
        open={open}
        width={editFullscreen ? 'calc(100vw - 24px)' : 560}
        destroyOnHidden
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        onOk={() => void save()}
        onCancel={onClose}
      >
        {content}
      </Modal>
      {optimizeModal}
    </>
  )
}
