import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button } from '@lobehub/ui'
import { Checkbox, Empty, Modal, Select, Tag, Tooltip } from 'antd'
import type { ProviderFileObject } from '@spark/protocol'
import { useIpcInvoke } from '../../hooks/useIpc'
import { providerFilesErrorMessage } from './providerFiles.utils'

const MAX_BATCH_DELETE = 30

type FileSort = 'created_at' | 'filename' | 'size'
type SortOrder = 'asc' | 'desc'

export function ProviderFilesPanel({ providerProfileId }: { providerProfileId: string }) {
  const [files, setFiles] = useState<ProviderFileObject[]>([])
  const [paginationToken, setPaginationToken] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [purpose, setPurpose] = useState('user_input')
  const [sortBy, setSortBy] = useState<FileSort>('created_at')
  const [order, setOrder] = useState<SortOrder>('desc')
  const [message, setMessage] = useState('')
  const list = useIpcInvoke('provider:files:list')
  const remove = useIpcInvoke('provider:files:delete')

  const load = useCallback(async (pageToken?: string) => {
    try {
      const result = await list.invoke({
        providerProfileId,
        sortBy,
        order,
        limit: 50,
        ...(pageToken ? { paginationToken: pageToken } : {}),
      })
      setFiles((current) => pageToken ? mergeFiles(current, result.files) : result.files)
      setPaginationToken(result.paginationToken)
      if (!pageToken) setSelectedIds(new Set())
      setMessage('')
    } catch (error) {
      setMessage(providerFilesErrorMessage(error))
    }
  }, [list.invoke, order, providerProfileId, sortBy])

  useEffect(() => {
    void load()
  }, [load])

  const visibleFiles = useMemo(
    () => purpose === 'all'
      ? files
      : purpose === 'user_input'
        ? files.filter((file) => file.purpose === 'user_data' || file.purpose === 'input')
        : files.filter((file) => file.purpose === purpose),
    [files, purpose],
  )
  const purposes = useMemo(
    () => Array.from(new Set(['user_data', 'input', 'assistants', ...files.map((file) => file.purpose)])),
    [files],
  )

  const deleteFiles = async (targets: ProviderFileObject[]) => {
    const limited = targets.slice(0, MAX_BATCH_DELETE)
    const ids = limited.map((file) => file.id)
    setDeletingIds((current) => new Set([...current, ...ids]))
    setFailedIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => next.delete(id))
      return next
    })
    const results = await Promise.allSettled(
      limited.map((file) => remove.invoke({ providerProfileId, fileId: file.id })),
    )
    const deleted = new Set<string>()
    const failed = new Set<string>()
    results.forEach((result, index) => {
      const id = ids[index]
      if (!id) return
      if (result.status === 'fulfilled' && result.value.deleted) deleted.add(id)
      else failed.add(id)
    })
    setFiles((current) => current.filter((file) => !deleted.has(file.id)))
    setSelectedIds((current) => new Set([...current].filter((id) => !deleted.has(id))))
    setDeletingIds((current) => new Set([...current].filter((id) => !ids.includes(id))))
    setFailedIds((current) => new Set([...current, ...failed]))
    if (failed.size > 0) setMessage(`${deleted.size} 个文件已删除，${failed.size} 个删除失败；失败行已标红，可重试。`)
  }

  const confirmDelete = (targets: ProviderFileObject[]) => {
    Modal.confirm({
      title: targets.length > 1 ? `删除 ${targets.length} 个 xAI 文件？` : '删除 xAI 文件？',
      content: targets.length > 1
        ? `单次最多删除 ${MAX_BATCH_DELETE} 个，删除后无法恢复。`
        : `${targets[0]?.filename ?? ''}（${targets[0]?.id ?? ''}）删除后无法恢复。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: () => deleteFiles(targets),
    })
  }

  const selectedFiles = files.filter((file) => selectedIds.has(file.id))

  return (
    <div className="pv_section">
      <div className="pv_section_head">
        <span className="pv_section_title">xAI Files</span>
        <span className="pv_section_hint">官方 Files API · 单文件上限 48 MiB</span>
      </div>
      <div className="pv_section_body">
        {message && <Alert type="error" message={message} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Select
              size="small"
              value={purpose}
              onChange={setPurpose}
              options={[
                { value: 'user_input', label: '用户与输入文件' },
                { value: 'all', label: '全部用途' },
                ...purposes.map((value) => ({ value, label: value })),
              ]}
              style={{ minWidth: 112 }}
            />
            <Select
              size="small"
              value={`${sortBy}:${order}`}
              onChange={(value) => {
                const [nextSortBy, nextOrder] = value.split(':') as [FileSort, SortOrder]
                setSortBy(nextSortBy)
                setOrder(nextOrder)
              }}
              options={[
                { value: 'created_at:desc', label: '最新创建' },
                { value: 'created_at:asc', label: '最早创建' },
                { value: 'filename:asc', label: '文件名 A–Z' },
                { value: 'filename:desc', label: '文件名 Z–A' },
                { value: 'size:desc', label: '文件最大优先' },
                { value: 'size:asc', label: '文件最小优先' },
              ]}
              style={{ minWidth: 126 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {selectedFiles.length > 0 && (
              <Button size="small" danger onClick={() => confirmDelete(selectedFiles)}>
                批量删除 ({Math.min(selectedFiles.length, MAX_BATCH_DELETE)})
              </Button>
            )}
            <Button size="small" loading={list.loading} onClick={() => void load()}>刷新</Button>
          </div>
        </div>

        {visibleFiles.length === 0 && !list.loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={files.length === 0 ? '暂无 xAI Files 文件' : '当前筛选无文件'} />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {visibleFiles.map((file) => {
              const deleting = deletingIds.has(file.id)
              const failed = failedIds.has(file.id)
              return (
                <div
                  key={file.id}
                  style={{
                    display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                    border: `1px solid ${failed ? 'var(--colorError, #ff4d4f)' : 'var(--colorBorderSecondary, rgba(127,127,127,.2))'}`,
                    borderRadius: 8, padding: 8,
                  }}
                >
                  <Checkbox
                    checked={selectedIds.has(file.id)}
                    disabled={deleting}
                    onChange={(event) => setSelectedIds((current) => toggleSelection(current, file.id, event.target.checked))}
                  />
                  <div style={{ minWidth: 0 }}>
                    <Tooltip title={`${file.filename}\n${file.id}\n创建：${formatTime(file.createdAt)}${file.expiresAt ? `\n到期：${formatTime(file.expiresAt)}` : ''}`}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.filename}</div>
                    </Tooltip>
                    <div className="pv_form_hint" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span>{formatBytes(file.bytes)}</span>
                      {file.bytes >= 48 * 1024 * 1024 ? <Tag color="red">超出安全上限</Tag> : file.bytes >= 40 * 1024 * 1024 ? <Tag color="orange">接近上限</Tag> : null}
                      <Tag>{file.purpose}</Tag>
                      <Tag>{file.object}</Tag>
                      <span>{formatRelativeTime(file.createdAt)}</span>
                      <ExpiryTag {...(file.expiresAt !== undefined ? { expiresAt: file.expiresAt } : {})} />
                    </div>
                  </div>
                  <Button size="small" danger loading={deleting} onClick={() => confirmDelete([file])}>删除</Button>
                </div>
              )
            })}
          </div>
        )}
        {paginationToken && (
          <Button block size="small" loading={list.loading} onClick={() => void load(paginationToken)} style={{ marginTop: 10 }}>
            加载更多
          </Button>
        )}
      </div>
    </div>
  )
}

function ExpiryTag({ expiresAt }: { expiresAt?: number }) {
  if (!expiresAt) return <Tag color="green">永久</Tag>
  const remaining = toMilliseconds(expiresAt) - Date.now()
  if (remaining <= 0) return <Tag color="red">已过期</Tag>
  if (remaining < 24 * 60 * 60 * 1000) return <Tag color="orange">{formatDuration(remaining)}后到期</Tag>
  return <Tag>{formatDuration(remaining)}后到期</Tag>
}

function mergeFiles(current: ProviderFileObject[], incoming: ProviderFileObject[]): ProviderFileObject[] {
  const byId = new Map(current.map((file) => [file.id, file]))
  incoming.forEach((file) => byId.set(file.id, file))
  return [...byId.values()]
}

function toggleSelection(current: Set<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(current)
  if (checked) next.add(id)
  else next.delete(id)
  return next
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function formatTime(value: number): string {
  return new Date(toMilliseconds(value)).toLocaleString()
}

function formatRelativeTime(value: number): string {
  const elapsed = Date.now() - toMilliseconds(value)
  if (elapsed < 60_000) return '刚刚创建'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
  return `${Math.floor(elapsed / 86_400_000)} 天前`
}

function formatDuration(value: number): string {
  if (value < 3_600_000) return `${Math.max(1, Math.ceil(value / 60_000))} 分钟`
  if (value < 86_400_000) return `${Math.ceil(value / 3_600_000)} 小时`
  return `${Math.ceil(value / 86_400_000)} 天`
}

function toMilliseconds(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value
}
