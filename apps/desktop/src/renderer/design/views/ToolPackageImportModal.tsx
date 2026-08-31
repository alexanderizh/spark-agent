import { useEffect, useState } from 'react'
import { Button, Input, Modal, Select } from '@lobehub/ui'
import { message } from 'antd'
import type { McpServerItem, ToolPackageSource, ToolPackageSummary } from '@spark/protocol'
import { useApp } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'

export interface ToolPackageImportResult {
  packageId: string
  name: string
  version: string
  source: ToolPackageSource
}

interface ToolPackageImportModalProps {
  open: boolean
  onCancel: () => void
  onImported: (result: ToolPackageImportResult) => void
}

type ImportMethod = 'directory' | 'archive' | 'git' | 'mcp'

const METHOD_LABELS: Record<ImportMethod, string> = {
  directory: '本地目录',
  archive: '压缩包',
  git: 'Git 仓库',
  mcp: 'MCP 服务器',
}

const METHOD_HINTS: Record<ImportMethod, string> = {
  directory: '选择包含 spark-tool.json 的完整工程目录，安装为不可变版本。',
  archive: '选择 .zip 压缩包（可含单层包裹目录），解压校验后安装。',
  git: '输入 Git 仓库地址（支持 owner/repo 简写），浅克隆后安装。',
  mcp: '把已配置 MCP 服务器的工具导入为工具包；调用时仍经宿主代理到原服务器。',
}

export function ToolPackageImportModal({
  open,
  onCancel,
  onImported,
}: ToolPackageImportModalProps) {
  const { requestConfirm } = useApp()
  const [method, setMethod] = useState<ImportMethod>('directory')
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [gitRef, setGitRef] = useState('')
  const [gitSubdirectory, setGitSubdirectory] = useState('')
  const [mcpServers, setMcpServers] = useState<McpServerItem[] | null>(null)
  const [mcpServerId, setMcpServerId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: listMcpServers } = useIpcInvoke('mcp:list')
  const { invoke: installDirectory } = useIpcInvoke('tool-packages:install-directory')
  const { invoke: installArchive } = useIpcInvoke('tool-packages:install-archive')
  const { invoke: installGit } = useIpcInvoke('tool-packages:install-git')
  const { invoke: installMcpImport } = useIpcInvoke('tool-packages:install-mcp-import')

  useEffect(() => {
    if (open) return
    // 关闭时重置一次性状态，下次打开从头开始。
    setLocalPath(null)
    setGitUrl('')
    setGitRef('')
    setGitSubdirectory('')
    setMcpServers(null)
    setMcpServerId(null)
    setImporting(false)
  }, [open])

  const loadMcpServers = async () => {
    if (mcpServers != null || importing) return
    try {
      const response = await listMcpServers({})
      setMcpServers(response.servers)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'MCP 服务器列表读取失败')
    }
  }

  const pickDirectory = async () => {
    try {
      const selected = await openDirectoryDialog({ title: '选择 Tool Package 工程目录' })
      if (!selected.canceled && selected.filePath != null) setLocalPath(selected.filePath)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '目录选择失败')
    }
  }

  const pickArchive = async () => {
    try {
      const selected = await openFileDialog({
        title: '选择 Tool Package 压缩包',
        filters: [{ name: 'Tool Package 压缩包', extensions: ['zip'] }],
      })
      if (!selected.canceled && selected.filePath != null) setLocalPath(selected.filePath)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '压缩包选择失败')
    }
  }

  const sourcePreview = (): string => {
    if (method === 'git') {
      const refSuffix = gitRef.trim().length > 0 ? `（分支/标签 ${gitRef.trim()}）` : ''
      const subSuffix =
        gitSubdirectory.trim().length > 0 ? `（子目录 ${gitSubdirectory.trim()}）` : ''
      return `${gitUrl.trim()}${refSuffix}${subSuffix}`
    }
    if (method === 'mcp') {
      const server = mcpServers?.find((candidate) => candidate.id === mcpServerId)
      return server != null ? `${server.name}（${server.id}）` : ''
    }
    return localPath ?? ''
  }

  const canImport = (): boolean => {
    if (importing) return false
    if (method === 'git') return gitUrl.trim().length > 0
    if (method === 'mcp') return mcpServerId != null
    return localPath != null && localPath.length > 0
  }

  const confirmDescription = (preview: string): string => {
    if (method === 'mcp') {
      return `来源：MCP 服务器 ${preview}。导入会读取该服务器的工具清单并登记为不可变版本（停用状态）；调用时仍经宿主代理到原服务器，导入的工具默认按保守权限处理。`
    }
    return `来源：${preview}。安装仅做只读校验并生成不可变版本，不会执行工具代码；启用前请确认声明的 OS 行为与 Spark 权限。工具包以 trusted-local 当前用户权限运行，不是沙箱。`
  }

  const runImport = async () => {
    const preview = sourcePreview()
    if (preview.length === 0) return
    const confirmed = await requestConfirm({
      title: `从${METHOD_LABELS[method]}安装 Tool Package？`,
      description: confirmDescription(preview),
      confirmText: '安装',
    })
    if (!confirmed) return
    setImporting(true)
    try {
      let result: { package: ToolPackageSummary; version: string }
      let importedToolCount: number | null = null
      if (method === 'directory' && localPath != null) {
        result = await installDirectory({ sourcePath: localPath })
      } else if (method === 'archive' && localPath != null) {
        result = await installArchive({ archivePath: localPath })
      } else if (method === 'git') {
        result = await installGit({
          url: gitUrl.trim(),
          ...(gitRef.trim().length > 0 ? { ref: gitRef.trim() } : {}),
          ...(gitSubdirectory.trim().length > 0 ? { subdirectory: gitSubdirectory.trim() } : {}),
        })
      } else {
        const mcpResult = await installMcpImport({ serverId: mcpServerId ?? '' })
        result = mcpResult
        importedToolCount = mcpResult.importedTools.length
        if (mcpResult.skippedTools.length > 0) {
          message.warning(
            `已跳过 ${String(mcpResult.skippedTools.length)} 个不可导入工具（名称无法规范化或 Schema 超限）`,
          )
        }
      }
      const toolSuffix =
        importedToolCount != null ? `，导入 ${String(importedToolCount)} 个工具` : ''
      message.success(
        `已安装 ${result.package.name} v${result.version}${toolSuffix}，当前为停用状态`,
      )
      onImported({
        packageId: result.package.id,
        name: result.package.name,
        version: result.version,
        source: result.package.source,
      })
      onCancel()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Tool Package 安装失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      open={open}
      width={620}
      title="导入工具包"
      onCancel={() => {
        if (!importing) onCancel()
      }}
      footer={
        <div className="ct_modal_actions">
          <Button disabled={importing} onClick={onCancel}>
            取消
          </Button>
          <Button
            type="primary"
            disabled={!canImport()}
            loading={importing}
            onClick={() => void runImport()}
          >
            安装
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(Object.keys(METHOD_LABELS) as ImportMethod[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => {
                setMethod(candidate)
                setLocalPath(null)
                if (candidate === 'mcp') void loadMcpServers()
              }}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                color: method === candidate ? 'var(--text)' : 'var(--text-muted)',
                background: method === candidate ? 'var(--hover)' : 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {METHOD_LABELS[candidate]}
            </button>
          ))}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>
          {METHOD_HINTS[method]}
        </p>

        {method === 'directory' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button disabled={importing} onClick={() => void pickDirectory()}>
              选择工程目录
            </Button>
            {localPath != null && (
              <code
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  wordBreak: 'break-all',
                }}
              >
                {localPath}
              </code>
            )}
          </div>
        )}

        {method === 'archive' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button disabled={importing} onClick={() => void pickArchive()}>
              选择 .zip 压缩包
            </Button>
            {localPath != null && (
              <code
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  wordBreak: 'break-all',
                }}
              >
                {localPath}
              </code>
            )}
          </div>
        )}

        {method === 'git' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              placeholder="https://github.com/acme/suite.git 或 acme/suite"
              value={gitUrl}
              disabled={importing}
              onChange={(event) => setGitUrl(event.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                style={{ flex: 1 }}
                placeholder="分支 / 标签（可选，默认默认分支）"
                value={gitRef}
                disabled={importing}
                onChange={(event) => setGitRef(event.target.value)}
              />
              <Input
                style={{ flex: 1 }}
                placeholder="包所在子目录（可选）"
                value={gitSubdirectory}
                disabled={importing}
                onChange={(event) => setGitSubdirectory(event.target.value)}
              />
            </div>
            {importing && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                正在克隆仓库（浅克隆，最长 5 分钟）…
              </span>
            )}
          </div>
        )}

        {method === 'mcp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Select
              placeholder={mcpServers == null ? '正在读取 MCP 服务器…' : '选择要导入的 MCP 服务器'}
              value={mcpServerId}
              disabled={importing}
              loading={mcpServers == null}
              style={{ width: '100%' }}
              onChange={(value) => setMcpServerId(value)}
              options={(mcpServers ?? []).map((server) => ({
                label: server.enabled ? server.name : `${server.name}（已停用）`,
                value: server.id,
              }))}
              notFoundContent={
                mcpServers != null && mcpServers.length === 0
                  ? '尚无已配置的 MCP 服务器，请先在 MCP 管理页添加'
                  : undefined
              }
            />
            {mcpServerId != null && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                将读取该服务器当前的工具清单并登记为不可变版本；调用时仍经宿主代理到原服务器。
              </span>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
