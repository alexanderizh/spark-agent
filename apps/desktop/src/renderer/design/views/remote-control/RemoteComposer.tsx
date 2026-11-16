/**
 * 远程输入区（对齐桌面端主输入区的形态）：
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ 附件条                                        │
 *   │ textarea（@ 添加上下文 · / 调用技能与指令）      │
 *   │                                  [模型] 🎤 (发送) │
 *   ├───────────────────────────────────────────────┤  ← 淡色页脚
 *   │ [助手] [权限] [推理]              发送到 xxxx │
 *   └───────────────────────────────────────────────┘
 *
 * 分两层的原因：发送相关的动作（模型 / 语音 / 发送）要贴着输入文本，
 * 而「这一轮按什么策略跑」（助手 / 权限 / 推理）是低频开关，收进页脚条里，
 * 主行就不会被四五枚 chip 挤成一条灰带。
 *
 * 编排仍在 RemoteChatPane：本组件只负责输入交互、配置下拉与命令补全，
 * 所有写操作通过 props 回调出去（配置写回见 useRemoteComposerConfig）。
 *
 * 语音：复用桌面端本地语音输入（useComposerVoice → 本地 ASR），
 * 录到的文本直接追加进草稿，不经过目标电脑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from 'react'
import type {
  MobileBridgeCatalog,
  MobileBridgeCommandItem,
  SessionGetQueueResponse,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { useComposerVoice } from '../../voice/useComposerVoice'
import { QuickReplySuggestions } from '../chat/QuickReplySuggestions'
import { usePinnedModels } from '../chat/pinned-models'
import { RemoteAttachmentStrip, type RemoteAttachmentRef } from './RemoteAttachmentStrip'
import { RemoteComposerMenu } from './RemoteComposerMenu'
import { RemoteQueuePanel } from './RemoteQueuePanel'
import { pickImageFiles } from './remotePaste'
import {
  agentLabel,
  applyCommandPick,
  buildAgentOptions,
  buildModelMenuSections,
  buildModelOptions,
  buildPermissionOptions,
  buildReasoningOptions,
  filterRemoteCommands,
  modelLabel,
  permissionLabel,
  reasoningLabel,
  resolveAdapter,
  slashTriggerAt,
  type RemoteModelOption,
  type RemoteSelectOption,
} from './remoteComposerModel'
import type { RemoteComposerConfigState } from './useRemoteComposerConfig'

type OpenMenu = 'agent' | 'model' | 'permission' | 'reasoning' | null

export interface RemoteComposerProps {
  deviceId: string
  /** 目标电脑名字：页脚标注「发送到 xxx」，避免在远程视图里发错机器 */
  deviceName?: string
  draft: string
  /** 直接用父级 setDraft：语音输入需要一个 updater 形式才能不读到过期草稿 */
  onChangeDraft: Dispatch<SetStateAction<string>>
  attachments: RemoteAttachmentRef[]
  onRemoveAttachment: (path: string) => void
  onPickFiles: () => void
  /** 粘贴图片：剪贴板里的图片项（本机落盘 + 传目标端由宿主完成） */
  onPasteImages: (files: File[]) => void
  running: boolean
  sending: boolean
  uploading: boolean
  onSend: () => void
  onStop: () => void
  queueSnapshot: SessionGetQueueResponse | null
  /** 运行时配置（助手 / 模型 / 权限） */
  config: RemoteComposerConfigState
  /** 目标端斜杠命令目录（旧版目标端为空数组 → 不弹补全） */
  commands: MobileBridgeCommandItem[]
  /**
   * 目标端 agent 给出的快捷回复建议（`mcp__spark_ui__suggest_replies`）。
   * 空数组 / 缺省 = 不渲染；由父级负责「用户已发言即失效」与「关闭过」的判定。
   */
  quickReplies?: string[]
  /** 点建议：父级会把「建议 + 用户补充」拼成一条消息直接发出去 */
  onPickQuickReply?: (reply: string) => void
  onDismissQuickReplies?: () => void
}

export function RemoteComposer({
  deviceId,
  deviceName,
  draft,
  onChangeDraft,
  attachments,
  onRemoveAttachment,
  onPickFiles,
  onPasteImages,
  running,
  sending,
  uploading,
  onSend,
  onStop,
  queueSnapshot,
  config,
  commands,
  quickReplies,
  onPickQuickReply,
  onDismissQuickReplies,
}: RemoteComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [caret, setCaret] = useState(0)
  /** 高亮项与它所属的查询串一起存：查询变了自动回到第 0 项，不用 effect 回写 */
  const [commandNav, setCommandNav] = useState<{ query: string | null; index: number }>({
    query: null,
    index: 0,
  })

  const busy = sending || uploading
  const canSend = draft.trim().length > 0 || attachments.length > 0

  // 语音输入：识别结果追加进草稿。父级传的是 setDraft，updater 形式天然拿到最新值
  const { micButton, installToast, voiceInputActive } = useComposerVoice({
    setValue: onChangeDraft,
    disabled: sending,
  })

  // 随内容增高，上限由 CSS max-height 控制。
  // 下限 54px：空草稿时也要像个输入区，而不是一条单行搜索框（对齐桌面端主输入区）。
  useEffect(() => {
    const node = textareaRef.current
    if (node == null) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 54), 168)}px`
  }, [draft])

  const catalog: MobileBridgeCatalog | null = config.catalog
  const adapter = resolveAdapter(catalog, config.runtime)

  // 置顶模型（与桌面端主对话区同一份 settings 存储，跨视图互通）
  const { pinned, togglePinned } = usePinnedModels()

  const agentOptions = useMemo(
    () => buildAgentOptions(catalog, config.runtime),
    [catalog, config.runtime],
  )
  const modelOptions = useMemo(
    () => buildModelOptions(catalog, config.runtime),
    [catalog, config.runtime],
  )
  const permissionOptions = useMemo(
    () => buildPermissionOptions(catalog, adapter, config.runtime?.permissionMode),
    [adapter, catalog, config.runtime?.permissionMode],
  )
  const reasoningOptions = useMemo(
    () => buildReasoningOptions(catalog, config.runtime),
    [catalog, config.runtime],
  )

  const agentText = agentLabel(catalog, config.runtime)
  const modelText = modelLabel(catalog, config.runtime)
  const permission = permissionLabel(catalog, config.runtime)
  const reasoningText = reasoningLabel(config.runtime)

  // 模型按渠道分组 + 置顶汇总「常用」组（与主对话区同一套 pinned 存储，跨视图互通）
  const modelSections = useMemo(
    () => buildModelMenuSections(catalog, modelOptions, pinned),
    [catalog, modelOptions, pinned],
  )

  /** 模型菜单的置顶切换：选项 id 解析回 providerId/modelId（AutoRouter 项无 pinned 字段不会进来） */
  const toggleModelPin = useCallback(
    (option: RemoteSelectOption) => {
      const sep = option.id.indexOf('::')
      if (sep <= 0) return
      togglePinned(option.id.slice(0, sep), option.id.slice(sep + 2))
    },
    [togglePinned],
  )

  const trigger = slashTriggerAt(draft, caret)
  const commandMatches = useMemo(
    () => (trigger == null ? [] : filterRemoteCommands(commands, trigger.query)),
    [commands, trigger],
  )
  const commandOpen = trigger != null && commandMatches.length > 0 && openMenu == null
  const commandQuery = trigger?.query ?? null
  const commandIndex = commandNav.query === commandQuery ? commandNav.index : 0
  const moveCommandIndex = useCallback(
    (delta: number) => {
      if (commandMatches.length === 0) return
      setCommandNav({
        query: commandQuery,
        index: (commandIndex + delta + commandMatches.length) % commandMatches.length,
      })
    },
    [commandIndex, commandMatches.length, commandQuery],
  )

  const handleSelectCommand = useCallback(
    (command: MobileBridgeCommandItem) => {
      const at = slashTriggerAt(draft, caret)
      if (at == null) return
      const next = applyCommandPick(draft, at, command.name)
      onChangeDraft(next.text)
      setCaret(next.caret)
      // 回填后把光标放回插入点，保持连续输入
      requestAnimationFrame(() => {
        const node = textareaRef.current
        if (node == null) return
        node.focus()
        node.setSelectionRange(next.caret, next.caret)
      })
    },
    [caret, draft, onChangeDraft],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // 命令补全优先吃键
      if (commandOpen) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveCommandIndex(1)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveCommandIndex(-1)
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          const picked = commandMatches[commandIndex] ?? commandMatches[0]
          if (picked != null) handleSelectCommand(picked)
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpenMenu(null)
          setCaret(textareaRef.current?.selectionStart ?? 0)
          return
        }
      }

      // @ 只在行首/空白后触发附件选择，避免误伤邮箱等正常输入
      if (event.key === '@' && !event.metaKey && !event.ctrlKey) {
        const node = event.currentTarget
        const before = node.value.slice(0, node.selectionStart)
        if (before.length === 0 || /\s$/.test(before)) {
          event.preventDefault()
          onPickFiles()
          return
        }
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        if (openMenu != null) {
          setOpenMenu(null)
          return
        }
        if (canSend && !busy) onSend()
      }
    },
    [
      busy,
      canSend,
      commandIndex,
      commandMatches,
      commandOpen,
      handleSelectCommand,
      moveCommandIndex,
      onPickFiles,
      onSend,
      openMenu,
    ],
  )

  const pickAgent = useCallback(
    (option: RemoteSelectOption) => {
      setOpenMenu(null)
      void config.setAgent(option.id)
    },
    [config],
  )

  const pickModel = useCallback(
    (option: RemoteSelectOption) => {
      setOpenMenu(null)
      void config.setModel(option as RemoteModelOption)
    },
    [config],
  )

  const pickPermission = useCallback(
    (option: RemoteSelectOption) => {
      setOpenMenu(null)
      void config.setPermission(option.id)
    },
    [config],
  )

  const pickReasoning = useCallback(
    (option: RemoteSelectOption) => {
      setOpenMenu(null)
      void config.setReasoning(option.id)
    },
    [config],
  )

  const configDisabled = config.saving || !config.catalogSupported
  const targetLabel =
    deviceName != null && deviceName.length > 0 ? `发送到 ${deviceName}` : '发送到目标电脑'

  return (
    <div className={`rc-composer${voiceInputActive ? ' is-voice' : ''}`}>
      {installToast}
      <RemoteQueuePanel snapshot={queueSnapshot} />
      <RemoteAttachmentStrip
        deviceId={deviceId}
        attachments={attachments}
        onRemove={onRemoveAttachment}
      />

      {/* 目标端 agent 的下一步建议：与桌面端主输入区同一形态与位置（输入框上方） */}
      {quickReplies != null && quickReplies.length > 0 && onPickQuickReply != null && (
        <QuickReplySuggestions
          replies={quickReplies}
          disabled={busy || running}
          onSelect={onPickQuickReply}
          onDismiss={onDismissQuickReplies ?? (() => undefined)}
        />
      )}

      <div className="rc-composer-body">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            onChangeDraft(event.target.value)
            setCaret(event.target.selectionStart)
          }}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            // 只有剪贴板里真有图片才接管；纯文本粘贴留给浏览器原生行为
            const images = pickImageFiles(event.clipboardData?.items)
            if (images.length === 0) return
            event.preventDefault()
            onPasteImages(images)
          }}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart)}
          placeholder="今天帮你做些什么？ @ 添加上下文，/调用技能与指令"
          rows={1}
          aria-label="远程指令输入框"
        />

        {commandOpen && (
          <div className="rc-command-popover" role="listbox" aria-label="斜杠命令">
            <div className="rc-command-head">
              <Icons.Command size={12} />
              技能与指令
              <span className="rc-command-count">{commandMatches.length}</span>
            </div>
            {commandMatches.map((command, index) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === commandIndex}
                className={`rc-command-item${index === commandIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setCommandNav({ query: commandQuery, index })}
                onClick={() => handleSelectCommand(command)}
              >
                <span className="rc-command-name">/{command.name}</span>
                <span className="rc-command-desc">{command.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 主行只留发送相关动作：加附件在左，模型/语音/发送在右，和桌面端主输入区一致 */}
      <div className="rc-composer-actions">
        <button
          type="button"
          className="rc-composer-add"
          onClick={onPickFiles}
          disabled={uploading}
          title="添加附件"
          aria-label="添加附件"
        >
          {uploading ? <Icons.Spinner size={15} className="spin" /> : <Icons.Plus size={17} />}
        </button>

        <div className="rc-actions-right">
          {modelOptions.length > 0 && (
            <div className="rc-chip-wrap">
              <button
                type="button"
                className="rc-chip rc-chip-model"
                onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'model'}
                disabled={configDisabled}
                title={modelText}
              >
                <Icons.Cpu size={12} />
                <span className="rc-chip-text">{modelText}</span>
                <Icons.ChevronDown size={11} />
              </button>
              {openMenu === 'model' && (
                <RemoteComposerMenu
                  ariaLabel="选择模型"
                  sections={modelSections}
                  busy={config.saving}
                  alignRight
                  onPick={pickModel}
                  onClose={() => setOpenMenu(null)}
                  onTogglePin={toggleModelPin}
                />
              )}
            </div>
          )}

          {micButton}

          <button
            type="button"
            className={`rc-send-orb${running ? ' is-running' : ''}`}
            onClick={running ? onStop : onSend}
            disabled={running ? false : !canSend || busy}
            title={running ? '停止' : '发送'}
            aria-label={running ? '停止' : '发送'}
          >
            {running ? (
              <Icons.Stop size={12} />
            ) : sending ? (
              <Icons.Spinner size={13} className="spin" />
            ) : (
              <Icons.ArrowUp size={15} />
            )}
          </button>
        </div>
      </div>

      {/* 页脚：这一轮按什么策略跑（低频开关），右侧标注消息落在哪台电脑 */}
      <div className="rc-composer-footer">
        <div className="rc-footer-chips">
          {agentOptions.length > 0 && (
            <div className="rc-chip-wrap">
              <button
                type="button"
                className="rc-chip"
                onClick={() => setOpenMenu(openMenu === 'agent' ? null : 'agent')}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'agent'}
                disabled={configDisabled}
                title="切换助手"
              >
                <Icons.Agent size={12} />
                <span className="rc-chip-text">{agentText}</span>
                <Icons.ChevronDown size={11} />
              </button>
              {openMenu === 'agent' && (
                <RemoteComposerMenu
                  ariaLabel="选择助手"
                  sections={[{ options: agentOptions }]}
                  busy={config.saving}
                  onPick={pickAgent}
                  onClose={() => setOpenMenu(null)}
                />
              )}
            </div>
          )}

          {permissionOptions.length > 0 && (
            <div className="rc-chip-wrap">
              <button
                type="button"
                className={`rc-chip${permission.danger ? ' is-danger' : ''}`}
                onClick={() => setOpenMenu(openMenu === 'permission' ? null : 'permission')}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'permission'}
                disabled={configDisabled}
                title="权限策略"
              >
                {permission.danger ? <Icons.AlertTriangle size={12} /> : <Icons.Shield size={12} />}
                <span className="rc-chip-text">{permission.label}</span>
                <Icons.ChevronDown size={11} />
              </button>
              {openMenu === 'permission' && (
                <RemoteComposerMenu
                  ariaLabel="选择权限策略"
                  sections={[{ options: permissionOptions }]}
                  busy={config.saving}
                  onPick={pickPermission}
                  onClose={() => setOpenMenu(null)}
                />
              )}
            </div>
          )}

          {reasoningOptions.length > 0 && (
            <div className="rc-chip-wrap">
              <button
                type="button"
                className="rc-chip"
                onClick={() => setOpenMenu(openMenu === 'reasoning' ? null : 'reasoning')}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'reasoning'}
                disabled={configDisabled}
                title={`推理强度：${reasoningText}`}
              >
                <Icons.Brain size={12} />
                <span className="rc-chip-text">{reasoningText}</span>
                <Icons.ChevronDown size={11} />
              </button>
              {openMenu === 'reasoning' && (
                <RemoteComposerMenu
                  ariaLabel="选择推理强度"
                  sections={[{ options: reasoningOptions }]}
                  busy={config.saving}
                  onPick={pickReasoning}
                  onClose={() => setOpenMenu(null)}
                />
              )}
            </div>
          )}

          {!config.catalogSupported && (
            <span className="rc-composer-hint">目标电脑版本较旧，暂不支持切换配置</span>
          )}
        </div>

        <span className="rc-footer-target" title={targetLabel}>
          <Icons.RemoteMonitor size={11} />
          <span className="rc-footer-target-text">{targetLabel}</span>
        </span>
      </div>
    </div>
  )
}
