import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@lobehub/ui'
import { Switch } from 'antd'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import { CustomCommandEditPanel } from './CustomCommandEditPanel'
import CustomCommandImportModal from './CustomCommandImportModal'
import {
  CUSTOM_COMMANDS_CATEGORY,
  CUSTOM_COMMANDS_KEY,
  CUSTOM_COMMAND_EXPORT_VERSION,
  createCustomCommandDraft,
  formatCustomCommandDate,
  mergeCustomCommandImports,
  normalizeCustomCommandInput,
  parseCustomCommandExportPayload,
  parseCustomCommandItems,
  type CustomCommandExportPayload,
  type CustomCommandImportMode,
  type CustomCommandImportParseResult,
  type CustomCommandItem,
} from './custom-command-model'

type ImportState = {
  filePath: string
  parseResult: CustomCommandImportParseResult
}

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

export function CustomCommandsSection() {
  const [commands, setCommands] = useState<CustomCommandItem[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<CustomCommandItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [importState, setImportState] = useState<ImportState | null>(null)
  const { requestConfirm } = useApp()
  const { toast } = useToast()
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: saveFileDialog } = useIpcInvoke('dialog:save-file')
  const { invoke: writeTextFile } = useIpcInvoke('file:write-text')
  const { invoke: readTextFile } = useIpcInvoke('file:read-text')

  const loadCommands = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.spark.invoke('settings:get', {
        category: CUSTOM_COMMANDS_CATEGORY,
        key: CUSTOM_COMMANDS_KEY,
      })
      setCommands(parseCustomCommandItems(typeof res.value === 'string' ? res.value : null))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => deferEffect(loadCommands), [loadCommands])

  const persistCommands = useCallback(async (next: CustomCommandItem[]) => {
    setCommands(next)
    await window.spark.invoke('settings:set', {
      category: CUSTOM_COMMANDS_CATEGORY,
      key: CUSTOM_COMMANDS_KEY,
      value: JSON.stringify(next),
    })
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleCommands = commands.filter((command) => {
    if (!normalizedQuery) return true
    return [command.name, command.description, command.prompt, command.script]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  })
  const enabledCount = commands.filter((command) => command.enabled).length

  const handleSave = async (draft: CustomCommandItem) => {
    const normalizedName = normalizeCustomCommandInput(draft.name)
    if (normalizedName == null) {
      toast.error('命令名需形如 /custom-plan，并以字母开头，仅支持字母、数字和短横线。')
      return
    }
    if (!draft.prompt.trim() && !draft.script.trim()) {
      toast.error('请至少填写提示词或脚本。')
      return
    }
    if (
      commands.some(
        (command) =>
          command.id !== draft.id && normalizeCustomCommandInput(command.name) === normalizedName,
      )
    ) {
      toast.error(`命令 ${normalizedName} 已存在。`)
      return
    }
    const nextCommand: CustomCommandItem = {
      ...draft,
      name: normalizedName,
      description: draft.description.trim(),
      prompt: draft.prompt.trim(),
      script: draft.script.trimEnd(),
      updatedAt: new Date().toISOString(),
    }
    const next = commands.some((command) => command.id === draft.id)
      ? commands.map((command) => (command.id === draft.id ? nextCommand : command))
      : [nextCommand, ...commands]
    await persistCommands(next)
    setEditing(null)
    toast.success('自定义命令已保存，重新打开 / 命令列表即可使用。')
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    await persistCommands(
      commands.map((command) =>
        command.id === id ? { ...command, enabled, updatedAt: new Date().toISOString() } : command,
      ),
    )
  }

  const handleDelete = async (id: string) => {
    const confirmed = await requestConfirm({
      title: '删除自定义命令？',
      description: '删除后会立即从会话斜杠命令列表中移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    await persistCommands(commands.filter((command) => command.id !== id))
  }

  const handleExport = async () => {
    if (commands.length === 0) {
      toast.warning('当前没有可导出的自定义命令。')
      return
    }
    const payload: CustomCommandExportPayload = {
      version: CUSTOM_COMMAND_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      commands,
    }
    const result = await saveFileDialog({
      title: '导出自定义命令',
      defaultPath: `spark-custom-commands-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return
    await writeTextFile({
      path: result.filePath,
      content: JSON.stringify(payload, null, 2),
    })
    toast.success(`已导出 ${commands.length} 个自定义命令。`)
  }

  const handleImportPick = async () => {
    try {
      const result = await openFileDialog({
        title: '导入自定义命令',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      const filePath = result.filePaths?.[0] ?? result.filePath
      if (result.canceled || !filePath) return
      const file = await readTextFile({ path: filePath })
      const parseResult = parseCustomCommandExportPayload(file.content)
      if (
        parseResult == null ||
        (parseResult.accepted.length === 0 && parseResult.rejected.length === 0)
      ) {
        toast.warning('未在文件中找到可导入的自定义命令。')
        return
      }
      setImportState({ filePath, parseResult })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取导入文件失败')
    }
  }

  const handleImportConfirm = async (mode: CustomCommandImportMode) => {
    if (importState == null) return
    const merged = mergeCustomCommandImports(commands, importState.parseResult.accepted, mode)
    await persistCommands(merged.commands)
    setImportState(null)
    const summary = [`新增 ${merged.added} 个`]
    if (merged.updated > 0) summary.push(`覆盖 ${merged.updated} 个`)
    if (merged.skipped > 0) summary.push(`跳过 ${merged.skipped} 个`)
    toast.success(`导入完成：${summary.join('，')}。重新打开 / 命令列表即可使用。`)
  }

  const existingNames = new Set(
    commands
      .map((command) => normalizeCustomCommandInput(command.name))
      .filter((name): name is string => name != null),
  )

  return (
    <>
      <div className="settings-section section-wider">
        <h2>自定义命令</h2>
        <div className="lede">
          将常用流程沉淀为 / 命令。可先运行 JavaScript / Python 脚本，再把配置好的提示词交给 Agent
          继续处理。
        </div>
        <div className="row info-banner">
          <Icons.Command size={14} className="color-primary flex-shrink-0" />
          <div className="flex1 info-banner-text">
            <strong>{enabledCount} 个启用</strong> · {commands.length} 个自定义命令 ·
            会显示在会话输入框的「工具」分组。
          </div>
          <Button
            size="middle"
            type="primary"
            icon={<Icons.Plus size={13} />}
            onClick={() => setEditing(createCustomCommandDraft())}
          >
            新增命令
          </Button>
        </div>
        <div className="custom-command-toolbar">
          <Input
            size="middle"
            allowClear
            prefix={<Icons.Search size={14} />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索命令名、描述、提示词或脚本…"
          />
          <Button size="middle" onClick={() => void loadCommands()}>
            刷新
          </Button>
          <Button
            size="middle"
            icon={<Icons.Upload size={13} />}
            onClick={() => void handleImportPick()}
          >
            导入
          </Button>
          <Button
            size="middle"
            icon={<Icons.Download size={13} />}
            onClick={() => void handleExport()}
          >
            导出
          </Button>
        </div>
        {loading ? (
          <div className="card loading-card">正在加载自定义命令...</div>
        ) : visibleCommands.length === 0 ? (
          <div className="placeholder-section">
            <Icons.Command size={28} />
            <h3>{commands.length === 0 ? '还没有自定义命令' : '没有匹配的命令'}</h3>
            <p>建议从 /custom-plan 开始，把固定计划、审查或总结流程变成一键入口。</p>
          </div>
        ) : (
          <div className="custom-command-grid">
            {visibleCommands.map((command) => (
              <div
                key={command.id}
                className={`custom-command-card ${command.enabled ? '' : 'disabled'}`}
              >
                <div className="custom-command-card-h">
                  <div>
                    <div className="custom-command-name">{command.name}</div>
                    <div className="custom-command-desc">{command.description || '未填写描述'}</div>
                  </div>
                  <Switch
                    size="middle"
                    checked={command.enabled}
                    onChange={(enabled) => void handleToggle(command.id, enabled)}
                  />
                </div>
                <div className="custom-command-meta">
                  <span>{command.prompt.trim() ? '提示词' : '无提示词'}</span>
                  <span>
                    {command.script.trim()
                      ? command.scriptLanguage === 'python'
                        ? 'Python'
                        : 'JavaScript'
                      : '无脚本'}
                  </span>
                  <span>{formatCustomCommandDate(command.updatedAt)}</span>
                </div>
                <div className="custom-command-preview">
                  {command.prompt || command.script || '未配置内容'}
                </div>
                <div className="row gap-8">
                  <Button size="middle" onClick={() => setEditing(command)}>
                    编辑
                  </Button>
                  <Button size="middle" danger onClick={() => void handleDelete(command.id)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing != null && (
        <CustomCommandEditPanel
          command={editing}
          onClose={() => setEditing(null)}
          onSave={(draft) => void handleSave(draft)}
        />
      )}
      {importState != null && (
        <CustomCommandImportModal
          filePath={importState.filePath}
          parseResult={importState.parseResult}
          existingNames={existingNames}
          onConfirm={(mode) => void handleImportConfirm(mode)}
          onClose={() => setImportState(null)}
        />
      )}
    </>
  )
}
