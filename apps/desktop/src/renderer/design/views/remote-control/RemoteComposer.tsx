/**
 * 远程输入区（对齐桌面端主输入区的形态）：
 *
 *   附件条
 *   textarea（@ 添加上下文 · / 调用技能与指令）
 *   工具条  + | 助手 | 权限 …………… 模型 | 语音 | 发送/停止
 *
 * 编排仍在 RemoteChatPane：本组件只负责输入交互、配置下拉与命令补全，
 * 所有写操作通过 props 回调出去（配置写回见 useRemoteComposerConfig）。
 *
 * 语音：复用桌面端本地语音输入（useComposerVoice → 本地 ASR），
 * 录到的文本直接追加进草稿，不经过目标电脑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from 'react'
import type { MobileBridgeCatalog, MobileBridgeCommandItem } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useComposerVoice } from '../../voice/useComposerVoice'
import { RemoteAttachmentStrip, type RemoteAttachmentRef } from './RemoteAttachmentStrip'
import { RemoteComposerMenu, type RemoteMenuSection } from './RemoteComposerMenu'
import {
  agentLabel,
  applyCommandPick,
  buildAgentOptions,
  buildModelOptions,
  buildPermissionOptions,
  filterRemoteCommands,
  modelLabel,
  permissionLabel,
  resolveAdapter,
  slashTriggerAt,
  type RemoteModelOption,
  type RemoteSelectOption,
} from './remoteComposerModel'
import type { RemoteComposerConfigState } from './useRemoteComposerConfig'

type OpenMenu = 'agent' | 'model' | 'permission' | null

export interface RemoteComposerProps {
  deviceId: string
  draft: string
  /** 直接用父级 setDraft：语音输入需要一个 updater 形式才能不读到过期草稿 */
  onChangeDraft: Dispatch<SetStateAction<string>>
  attachments: RemoteAttachmentRef[]
  onRemoveAttachment: (path: string) => void
  onPickFiles: () => void
  running: boolean
  sending: boolean
  uploading: boolean
  onSend: () => void
  onStop: () => void
  /** 运行时配置（助手 / 模型 / 权限） */
  config: RemoteComposerConfigState
  /** 目标端斜杠命令目录（旧版目标端为空数组 → 不弹补全） */
  commands: MobileBridgeCommandItem[]
}

export function RemoteComposer({
  deviceId,
  draft,
  onChangeDraft,
  attachments,
  onRemoveAttachment,
  onPickFiles,
  running,
  sending,
  uploading,
  onSend,
  onStop,
  config,
  commands,
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

  // 随内容增高，上限由 CSS max-height 控制
  useEffect(() => {
    const node = textareaRef.current
    if (node == null) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`
  }, [draft])

  const catalog: MobileBridgeCatalog | null = config.catalog
  const adapter = resolveAdapter(catalog, config.runtime)

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

  const agentText = agentLabel(catalog, config.runtime)
  const modelText = modelLabel(catalog, config.runtime)
  const permission = permissionLabel(catalog, config.runtime)

  // 模型按渠道分组，避免几十个模型摊平成一坨
  const modelSections = useMemo<RemoteMenuSection[]>(() => {
    const groups = new Map<string, RemoteSelectOption[]>()
    for (const option of modelOptions) {
      const providerId = option.providerProfileId
      const bucket = groups.get(providerId) ?? []
      // 分组标题已经是渠道名，选项里只留模型短名
      bucket.push({ ...option, label: option.shortLabel })
      groups.set(providerId, bucket)
    }
    return [...groups.entries()].map(([providerId, options]) => ({
      title: catalog?.providers.find((item) => item.id === providerId)?.name ?? providerId,
      options,
    }))
  }, [catalog, modelOptions])

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

  const configDisabled = config.saving || !config.catalogSupported
  return (
    <div className={`rc-composer${voiceInputActive ? ' is-voice' : ''}`}>
      {installToast}
      <RemoteAttachmentStrip
        deviceId={deviceId}
        attachments={attachments}
        onRemove={onRemoveAttachment}
      />

      <div className="rc-input-row">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            onChangeDraft(event.target.value)
            setCaret(event.target.selectionStart)
          }}
          onKeyDown={handleKeyDown}
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

      <div className="rc-composer-toolbar">
        <div className="rc-toolbar-left">
          <button
            type="button"
            className="rc-tool-icon"
            onClick={onPickFiles}
            disabled={uploading}
            title="添加附件"
            aria-label="添加附件"
          >
            {uploading ? <Icons.Spinner size={15} className="spin" /> : <Icons.Plus size={16} />}
          </button>

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
                <Icons.Agent size={13} />
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
        </div>

        <div className="rc-toolbar-right">
          {modelOptions.length > 0 && (
            <div className="rc-chip-wrap">
              <button
                type="button"
                className="rc-chip"
                onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'model'}
                disabled={configDisabled}
                title={modelText}
              >
                <Icons.Cpu size={13} />
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
                />
              )}
            </div>
          )}

          {!config.catalogSupported && (
            <span className="rc-composer-hint">目标电脑版本较旧，暂不支持切换配置</span>
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
    </div>
  )
}
