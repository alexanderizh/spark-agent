import { useEffect, useState } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Input, Modal, Popover, message } from 'antd'
import { Icons } from '../../Icons'
import { CanvasPromptEditor } from './CanvasPromptEditor'
import { CanvasPromptLibraryPanel } from './CanvasPromptLibraryPanel'
import { CanvasShotScriptEditor } from './CanvasShotScriptEditor'
import { readAssetKind } from './canvasFilmAssets'
import { isRenderableShotScriptText } from './canvasShotScriptPresentation'
import {
  formatStoryboardRowsAsMarkdown,
  resolveStoryboardRowsForEditing,
} from './canvasTextInputPresentation'
import type { ParsedShotRow } from './canvasShotTableParse'
import { appendPromptFragment, buildPromptOptimizationInstruction } from './canvasPromptEditing'
import type { CanvasAsset, CanvasNode, CanvasTask } from './canvas.types'

export function CanvasNodeEditModal({
  node,
  open,
  assets,
  tasks,
  nodes,
  placement = 'floating',
  showInlineBack = false,
  fullscreen,
  onFullscreenChange,
  onClose,
  onSave,
}: {
  node: CanvasNode | null
  open: boolean
  assets: CanvasAsset[]
  tasks: CanvasTask[]
  nodes: CanvasNode[]
  placement?: 'floating' | 'inline'
  showInlineBack?: boolean
  fullscreen?: boolean
  onFullscreenChange?: (fullscreen: boolean) => void
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
  const effectiveFullscreen = fullscreen ?? editFullscreen
  const isTextLike = node?.type === 'text' || node?.type === 'prompt'
  const isShotScriptNode = node?.type === 'text' && isRenderableShotScriptText(node.data.text)

  useEffect(() => {
    if (!effectiveFullscreen) return
    const handleFullscreenKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (onFullscreenChange) {
        onFullscreenChange(false)
        return
      }
      setEditFullscreen(false)
    }
    window.addEventListener('keydown', handleFullscreenKeyDown)
    return () => window.removeEventListener('keydown', handleFullscreenKeyDown)
  }, [effectiveFullscreen, onFullscreenChange])

  useEffect(() => {
    if (!node) return
    setSaving(false)
    setTitle(node.title ?? '')
    setText(node.data.text ?? '')
    setPrompt(node.data.prompt ?? '')
    setNegativePrompt('')
    setMessageText(node.data.message ?? '')
    setUrl(node.data.url ?? '')
    setShotRows(resolveStoryboardRowsForEditing(node.data.text ?? '', nodes))
    setOptimizeModalOpen(false)
    setOptimizeRequirement('')
  }, [node, nodes])

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
        nextData.text = isShotScriptNode ? formatStoryboardRowsAsMarkdown(shotRows) : text
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
  const fullscreenLabel = effectiveFullscreen ? '退出全屏' : '全屏编辑'
  const fullscreenIcon = effectiveFullscreen ? (
    <Icons.Minimize size={14} />
  ) : (
    <Icons.Maximize size={14} />
  )
  const toggleFullscreen = () => {
    const nextFullscreen = !effectiveFullscreen
    if (onFullscreenChange) {
      onFullscreenChange(nextFullscreen)
      return
    }
    setEditFullscreen(nextFullscreen)
  }

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
        className={`canvas-bottom-floating-panel canvas-node-edit-bottom-panel canvas-shot-script-edit-panel is-inline${effectiveFullscreen ? ' is-fullscreen' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="canvas-bottom-floating-head canvas-node-edit-bottom-head">
          <div>
            <strong>编辑分镜脚本</strong>
            <span>{shotRows.length} 个镜头</span>
          </div>
          <div className="canvas-node-edit-bottom-actions">
            {showInlineBack ? (
              <Button size="middle" type="text" icon={<Icons.Eye size={13} />} onClick={onClose}>
                返回预览
              </Button>
            ) : null}
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
          <CanvasShotScriptEditor
            rows={shotRows}
            characterAssets={assets.filter((asset) => readAssetKind(asset) === 'character')}
            onRowsChange={setShotRows}
          />
        </div>
      </div>
    )
  }

  if (isTextLike && placement === 'inline' && !effectiveFullscreen) {
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
              {showInlineBack ? (
                <Button size="middle" type="text" icon={<Icons.Eye size={13} />} onClick={onClose}>
                  返回预览
                </Button>
              ) : null}
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
          className={`canvas-bottom-floating-panel canvas-node-edit-bottom-panel${placement === 'inline' ? ' is-inline' : ''}${effectiveFullscreen ? ' is-fullscreen' : ''}`}
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
              {placement === 'inline' && showInlineBack ? (
                <Button size="middle" type="text" icon={<Icons.Eye size={13} />} onClick={onClose}>
                  返回预览
                </Button>
              ) : null}
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
        className={`canvas-node-edit-modal${effectiveFullscreen ? ' canvas-node-edit-modal-fullscreen' : ''}`}
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
        width={effectiveFullscreen ? 'calc(100vw - 24px)' : 560}
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
