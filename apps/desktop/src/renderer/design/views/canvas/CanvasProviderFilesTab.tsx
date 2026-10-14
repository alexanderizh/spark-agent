import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button } from '@lobehub/ui'
import {
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tag,
  Tooltip,
  message,
} from 'antd'
import type {
  BailianFilePurpose,
  IpcRequest,
  ProviderFileObject,
  ProviderFilesApiKind,
  ProviderProfile,
  VolcengineVideoPreprocessInput,
} from '@spark/protocol'
import { useIpcInvoke } from '../../hooks/useIpc'
import { translate, useI18n } from '../../i18n'
import { Icons } from '../../Icons'
import { CanvasOverlayBoundary } from './CanvasOverlayBoundary'
import { providerFilesApiKindForProfile } from './canvasProviderFiles'
import './CanvasProviderFilesTab.less'

const MAX_BATCH_DELETE = 20
const MAX_LOCAL_UPLOADS = 20
const FILE_PAGE_SIZE = 20

type FileStatusFilter = 'all' | 'processing' | 'active' | 'failed'
type UploadSource = 'local' | 'url'

export function CanvasProviderFilesTab({
  onAddToCanvas,
}: {
  /** 把该 provider 文件作为节点加入画布；运行时会按渠道协议解析 file_id。 */
  onAddToCanvas?: (file: ProviderFileObject, providerProfileId: string) => void
}) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const { invoke: listProviders, loading: providersLoading } = useIpcInvoke('provider:list')
  const { invoke: listFiles, loading: filesLoading } = useIpcInvoke('provider:files:list')
  const { invoke: getFile, loading: getFileLoading } = useIpcInvoke('provider:files:get')
  const { invoke: uploadFile, loading: uploadLoading } = useIpcInvoke('provider:files:upload')
  const { invoke: deleteFile } = useIpcInvoke('provider:files:delete')
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [providerProfileId, setProviderProfileId] = useState('')
  const [files, setFiles] = useState<ProviderFileObject[]>([])
  const [paginationToken, setPaginationToken] = useState<string>()
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FileStatusFilter>('all')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [errorMessage, setErrorMessage] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [detailsFile, setDetailsFile] = useState<ProviderFileObject | null>(null)
  const [previewFile, setPreviewFile] = useState<ProviderFileObject | null>(null)
  const pollingRef = useRef(false)
  const loadSequenceRef = useRef(0)
  const providerProfileIdRef = useRef(providerProfileId)
  const providerKind = useMemo<Extract<
    ProviderFilesApiKind,
    'xai' | 'bailian' | 'volcengine-ark' | 'minimax-hailuo'
  > | null>(
    () =>
      providerFilesApiKindForProfile(
        providers.find((profile) => profile.id === providerProfileId) ?? {},
      ),
    [providerProfileId, providers],
  )
  const providerLabel =
    providerKind === 'xai'
      ? 'xAI'
      : providerKind === 'bailian'
        ? translate('canvasProviderFiles.t1')
        : providerKind === 'minimax-hailuo'
          ? 'MiniMax'
          : translate('canvasProviderFiles.t2')

  useEffect(() => {
    providerProfileIdRef.current = providerProfileId
  }, [providerProfileId])

  useEffect(() => {
    void listProviders({})
      .then((result) => {
        const next = result.profiles.filter(
          (profile) => providerFilesApiKindForProfile(profile) !== null,
        )
        const currentProviderProfileId = providerProfileIdRef.current
        const nextProviderProfileId = next.some(
          (profile) => profile.id === currentProviderProfileId,
        )
          ? currentProviderProfileId
          : (next[0]?.id ?? '')
        setProviders(next)
        providerProfileIdRef.current = nextProviderProfileId
        setProviderProfileId(nextProviderProfileId)
      })
      .catch((error) => setErrorMessage(filesErrorMessage(error)))
  }, [listProviders])

  const loadFiles = useCallback(
    async (after?: string) => {
      if (!providerProfileId) return false
      const sequence = ++loadSequenceRef.current
      try {
        const result = await listFiles({
          providerProfileId,
          order,
          limit: 100,
          ...(providerKind === 'volcengine-ark'
            ? { purpose: 'user_data' as const, ...(after ? { after } : {}) }
            : {}),
          ...((providerKind === 'bailian' || providerKind === 'xai') && after
            ? { paginationToken: after }
            : {}),
        })
        if (sequence !== loadSequenceRef.current) return false
        setFiles((current) => (after ? mergeFiles(current, result.files) : result.files))
        setPaginationToken(result.paginationToken)
        if (!after) setSelectedIds(new Set())
        setErrorMessage('')
        return true
      } catch (error) {
        if (sequence !== loadSequenceRef.current) return false
        setErrorMessage(filesErrorMessage(error))
        return false
      }
    },
    [listFiles, order, providerKind, providerProfileId],
  )

  useEffect(() => {
    if (!providerProfileId) return
    const timer = window.setTimeout(() => void loadFiles(), 0)
    return () => window.clearTimeout(timer)
  }, [loadFiles, providerProfileId])

  const processingIds = useMemo(
    () => files.filter((file) => file.status === 'processing').map((file) => file.id),
    [files],
  )

  useEffect(() => {
    if (!providerProfileId || processingIds.length === 0) return
    const poll = async () => {
      if (pollingRef.current) return
      const pollingProviderProfileId = providerProfileId
      pollingRef.current = true
      try {
        const results = await Promise.allSettled(
          processingIds
            .slice(0, 20)
            .map((fileId) => getFile({ providerProfileId: pollingProviderProfileId, fileId })),
        )
        if (providerProfileIdRef.current !== pollingProviderProfileId) return
        const updates = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value.file] : [],
        )
        if (updates.length > 0) setFiles((current) => mergeFiles(current, updates))
      } finally {
        pollingRef.current = false
      }
    }
    const timer = window.setInterval(() => void poll(), 3_000)
    return () => window.clearInterval(timer)
  }, [getFile, processingIds, providerProfileId])

  const visibleFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return files.filter((file) => {
      if (statusFilter !== 'all' && file.status !== statusFilter) return false
      if (!normalizedQuery) return true
      return (
        file.filename.toLowerCase().includes(normalizedQuery) ||
        file.id.toLowerCase().includes(normalizedQuery) ||
        file.mimeType?.toLowerCase().includes(normalizedQuery) === true
      )
    })
  }, [files, query, statusFilter])

  const totalCount = visibleFiles.length
  const totalPages = Math.max(1, Math.ceil(totalCount / FILE_PAGE_SIZE))
  // 删除文件后当前页可能越界，夹回到最末页
  const safePage = Math.min(currentPage, totalPages)
  const pagedFiles = useMemo(
    () => visibleFiles.slice((safePage - 1) * FILE_PAGE_SIZE, safePage * FILE_PAGE_SIZE),
    [visibleFiles, safePage],
  )
  const hasMoreFromProvider = Boolean(paginationToken)

  const goToPrevPage = useCallback(() => {
    setCurrentPage((page) => Math.max(1, page - 1))
  }, [])

  const goToNextPage = useCallback(async () => {
    if (safePage < totalPages) {
      setCurrentPage(safePage + 1)
      return
    }
    // 已到已加载数据末页：若后端还有更多批次，先拉取再翻页（游标分页只能单向前进）
    if (hasMoreFromProvider && paginationToken) {
      const loaded = await loadFiles(paginationToken)
      if (loaded) setCurrentPage((page) => page + 1)
    }
  }, [hasMoreFromProvider, loadFiles, paginationToken, safePage, totalPages])

  const refreshOne = async (fileId: string) => {
    const requestedProviderProfileId = providerProfileId
    try {
      const result = await getFile({ providerProfileId: requestedProviderProfileId, fileId })
      if (providerProfileIdRef.current !== requestedProviderProfileId) return
      setFiles((current) => mergeFiles(current, [result.file]))
      setErrorMessage('')
    } catch (error) {
      if (providerProfileIdRef.current !== requestedProviderProfileId) return
      setErrorMessage(filesErrorMessage(error))
    }
  }

  const openPreview = async (file: ProviderFileObject) => {
    const requestedProviderProfileId = providerProfileId
    try {
      const target = file.downloadUrl
        ? file
        : (await getFile({ providerProfileId: requestedProviderProfileId, fileId: file.id })).file
      if (providerProfileIdRef.current !== requestedProviderProfileId) return
      if (!target.downloadUrl) {
        setErrorMessage(translate('canvasProviderFiles.t3LongDesc'))
        return
      }
      setFiles((current) => mergeFiles(current, [target]))
      setPreviewFile(target)
    } catch (error) {
      if (providerProfileIdRef.current !== requestedProviderProfileId) return
      setErrorMessage(filesErrorMessage(error))
    }
  }

  const deleteFiles = async (targets: ProviderFileObject[]) => {
    const requestedProviderProfileId = providerProfileId
    const limited = targets.slice(0, MAX_BATCH_DELETE)
    const ids = limited.map((file) => file.id)
    setDeletingIds((current) => new Set([...current, ...ids]))
    const results = await Promise.allSettled(
      limited.map((file) =>
        deleteFile({ providerProfileId: requestedProviderProfileId, fileId: file.id }),
      ),
    )
    if (providerProfileIdRef.current !== requestedProviderProfileId) return
    const deleted = new Set<string>()
    let failed = 0
    results.forEach((result, index) => {
      const id = ids[index]
      if (id && result.status === 'fulfilled' && result.value.deleted) deleted.add(id)
      else failed += 1
    })
    setFiles((current) => current.filter((file) => !deleted.has(file.id)))
    setSelectedIds((current) => new Set([...current].filter((id) => !deleted.has(id))))
    setDeletingIds((current) => new Set([...current].filter((id) => !ids.includes(id))))
    if (failed > 0) setErrorMessage(translate('canvasProviderFiles.tpl1Desc', { deleted: deleted.size, failed }))
    else message.success(translate('canvasProviderFiles.tpl2Desc', { count: deleted.size }))
  }

  const confirmDelete = (targets: ProviderFileObject[]) => {
    Modal.confirm({
      title:
        targets.length > 1
          ? translate('canvasProviderFiles.tpl3Desc', { count: targets.length, provider: providerLabel })
          : translate('canvasProviderFiles.tpl4Desc', { provider: providerLabel }),
      content:
        targets.length > 1
          ? translate('canvasProviderFiles.tpl5Desc', { max: MAX_BATCH_DELETE })
          : translate('canvasProviderFiles.tpl6Desc', { name: targets[0]?.filename ?? '', id: targets[0]?.id ?? '' }),
      okText: translate('canvasProviderFiles.t4'),
      cancelText: translate('canvasProviderFiles.t5'),
      okButtonProps: { danger: true },
      onOk: () => deleteFiles(targets),
    })
  }

  const selectedFiles = files.filter((file) => selectedIds.has(file.id))

  return (
    <div className="canvas-provider-files">
      <div className="canvas-provider-files-channel-tabs" role="tablist" aria-label={translate('canvasProviderFiles.t38')}>
        <button
          type="button"
          role="tab"
          aria-selected
          className="canvas-provider-files-channel-tab active"
        >
          {providerLabel}
        </button>
        <span className="canvas-provider-files-note">
          {translate('canvasProviderFiles.t98LongDesc')}
        </span>
      </div>

      <Alert
        type="info"
        message={
          providerKind === 'xai'
            ? translate('canvasProviderFiles.t6LongDesc')
            : providerKind === 'bailian'
              ? translate('canvasProviderFiles.t7LongDesc')
              : providerKind === 'minimax-hailuo'
                ? translate('canvasProviderFiles.t8LongDesc')
                : translate('canvasProviderFiles.t9LongDesc')
        }
      />
      {errorMessage && (
        <Alert type="error" message={errorMessage} closable onClose={() => setErrorMessage('')} />
      )}

      <CanvasOverlayBoundary className="canvas-provider-files-toolbar">
        <div className="canvas-provider-files-toolbar-main">
          <Select
            value={providerProfileId || null}
            placeholder={translate('canvasProviderFiles.t39Desc')}
            options={providers.map((profile) => ({
              value: profile.id,
              label: `${profile.name} · ${profile.defaultModel}`,
            }))}
            onChange={(profileId) => {
              loadSequenceRef.current += 1
              providerProfileIdRef.current = profileId
              setProviderProfileId(profileId)
              setFiles([])
              setPaginationToken(undefined)
              setCurrentPage(1)
              setSelectedIds(new Set())
              setDeletingIds(new Set())
              setErrorMessage('')
            }}
            style={{ minWidth: 240, maxWidth: 420 }}
          />
          <Input
            allowClear
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCurrentPage(1)
            }}
            placeholder={translate('canvasProviderFiles.t40Desc')}
            style={{ width: 220 }}
          />
          <Select
            value={statusFilter}
            onChange={(nextStatus) => {
              setStatusFilter(nextStatus)
              setCurrentPage(1)
            }}
            options={[
              { value: 'all', label: translate('canvasProviderFiles.t10') },
              { value: 'active', label: translate('canvasProviderFiles.t11') },
              { value: 'processing', label: translate('canvasProviderFiles.t12') },
              { value: 'failed', label: translate('canvasProviderFiles.t13') },
            ]}
            style={{ width: 112 }}
          />
          <Select
            value={order}
            onChange={(nextOrder) => {
              setOrder(nextOrder)
              setCurrentPage(1)
            }}
            options={[
              { value: 'desc', label: translate('canvasProviderFiles.t14') },
              { value: 'asc', label: translate('canvasProviderFiles.t15') },
            ]}
            style={{ width: 112 }}
          />
        </div>
        <div className="canvas-provider-files-actions">
          {selectedFiles.length > 0 && (
            <Button danger onClick={() => confirmDelete(selectedFiles)}>
              {translate('canvasProviderFiles.tpl18Desc', { count: Math.min(selectedFiles.length, MAX_BATCH_DELETE) })}
            </Button>
          )}
          <Button
            icon={<Icons.Refresh size={13} />}
            loading={filesLoading}
            disabled={!providerProfileId}
            onClick={() => void loadFiles()}
          >
            {translate('canvasProviderFiles.t53')}
          </Button>
          {providerKind !== 'xai' && (
            <Button
              type="primary"
              icon={<Icons.Upload size={13} />}
              disabled={!providerProfileId}
              onClick={() => setUploadOpen(true)}
            >
              {translate('canvasProviderFiles.t54')}
            </Button>
          )}
        </div>
      </CanvasOverlayBoundary>

      {!providersLoading && providers.length === 0 ? (
        <Empty description={translate('canvasProviderFiles.t41LongDesc')} />
      ) : visibleFiles.length === 0 && !filesLoading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={files.length === 0 ? translate('canvasProviderFiles.t16Desc') : translate('canvasProviderFiles.t17')}
        />
      ) : (
        <div className="canvas-provider-files-list">
          {pagedFiles.map((file) => {
            const deleting = deletingIds.has(file.id)
            return (
              <div
                key={file.id}
                className={`canvas-provider-file-row${file.status === 'failed' ? ' is-failed' : ''}`}
              >
                <Checkbox
                  checked={selectedIds.has(file.id)}
                  disabled={deleting}
                  onChange={(event) =>
                    setSelectedIds((current) =>
                      toggleSelection(current, file.id, event.target.checked),
                    )
                  }
                />
                <div className="canvas-provider-file-body">
                  <div className="canvas-provider-file-head">
                    <Tooltip title={`${file.filename}\n${file.id}`}>
                      <span className="canvas-provider-file-name">{file.filename}</span>
                    </Tooltip>
                    <span className="canvas-provider-file-id">{shortenFileId(file.id)}</span>
                  </div>
                  <div className="canvas-provider-files-meta">
                    <FileStatusTag status={file.status} />
                    <span className="canvas-provider-file-attr">{formatBytes(file.bytes)}</span>
                    <span className="canvas-provider-file-sep">·</span>
                    <span className="canvas-provider-file-attr">{file.mimeType ?? translate('canvasProviderFiles.t18')}</span>
                  </div>
                  <div className="canvas-provider-file-submeta">
                    <span>{file.purpose}</span>
                    <span className="canvas-provider-file-sep">·</span>
                    <span>{formatTime(file.createdAt)}</span>
                    {file.tos?.bucket && (
                      <>
                        <span className="canvas-provider-file-sep">·</span>
                        <span>TOS · {file.tos.bucket}</span>
                      </>
                    )}
                    {file.expiresAt !== undefined && (
                      <>
                        <span className="canvas-provider-file-sep">·</span>
                        <span className="canvas-provider-file-expiry">
                          {translate('canvasProviderFiles.tpl19Desc', { time: formatTime(file.expiresAt) })}
                        </span>
                      </>
                    )}
                  </div>
                  {file.status === 'failed' && (
                    <div className="canvas-provider-file-error">
                      {[file.error?.code, file.error?.message].filter(Boolean).join(' · ') ||
                        translate('canvasProviderFiles.t19Desc')}
                    </div>
                  )}
                </div>
                <div className="canvas-provider-files-actions">
                  <Button size="small" onClick={() => void copyFileId(file.id)}>
                    {translate('canvasProviderFiles.t55')}
                  </Button>
                  {providerKind === 'minimax-hailuo' &&
                    file.status === 'active' &&
                    onAddToCanvas && (
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => onAddToCanvas(file, providerProfileId)}
                      >
                        {translate('canvasProviderFiles.t56')}
                      </Button>
                    )}
                  {providerKind === 'volcengine-ark' && file.status === 'active' && (
                    <Button size="small" onClick={() => void openPreview(file)}>
                      {translate('canvasProviderFiles.t21')}
                    </Button>
                  )}
                  {providerKind !== 'xai' && (
                    <Button
                      size="small"
                      loading={getFileLoading && file.status === 'processing'}
                      onClick={() => void refreshOne(file.id)}
                    >
                      {translate('canvasProviderFiles.t57')}
                    </Button>
                  )}
                  <Button size="small" onClick={() => setDetailsFile(file)}>
                    {translate('canvasProviderFiles.t58')}
                  </Button>
                  <Button
                    size="small"
                    danger
                    loading={deleting}
                    onClick={() => confirmDelete([file])}
                  >
                    {translate('canvasProviderFiles.t59')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {totalCount > 0 && (totalCount > FILE_PAGE_SIZE || hasMoreFromProvider) && (
        <div className="canvas-provider-files-pagination">
          <span className="canvas-provider-files-pagination-info">
            {translate('canvasProviderFiles.tpl20Desc', {
              from: Math.min((safePage - 1) * FILE_PAGE_SIZE + 1, totalCount),
              to: Math.min(safePage * FILE_PAGE_SIZE, totalCount),
              total: totalCount,
            })}
          </span>
          <div className="canvas-provider-files-pagination-controls">
            <Button size="small" disabled={safePage <= 1} onClick={goToPrevPage}>
              {translate('canvasProviderFiles.t60')}
            </Button>
            <span className="canvas-provider-files-pagination-page">
              {translate('canvasProviderFiles.tpl21Desc', { page: safePage, pages: totalPages })}
            </span>
            <Button
              size="small"
              loading={filesLoading}
              disabled={safePage >= totalPages && !hasMoreFromProvider}
              onClick={() => void goToNextPage()}
            >
              {translate('canvasProviderFiles.t61')}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={detailsFile !== null}
        title={detailsFile ? translate('canvasProviderFiles.tpl22Desc', { name: detailsFile.filename }) : translate('canvasProviderFiles.t20')}
        footer={null}
        onCancel={() => setDetailsFile(null)}
        destroyOnClose
        zIndex={1500}
      >
        {detailsFile && (
          <pre
            style={{
              maxHeight: 420,
              overflow: 'auto',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {JSON.stringify(detailsFile, null, 2)}
          </pre>
        )}
      </Modal>

      <Modal
        open={previewFile !== null}
        title={previewFile ? translate('canvasProviderFiles.tpl23Desc', { name: previewFile.filename }) : translate('canvasProviderFiles.t21')}
        footer={null}
        onCancel={() => setPreviewFile(null)}
        destroyOnClose
        width={860}
        zIndex={1500}
      >
        {previewFile?.downloadUrl && <ProviderFilePreview file={previewFile} />}
      </Modal>

      {providerKind === 'xai' ? null : providerKind === 'bailian' ? (
        <BailianFileUploadModal
          open={uploadOpen}
          providerProfileId={providerProfileId}
          uploading={uploadLoading}
          onClose={() => setUploadOpen(false)}
          onUpload={async (requests) => {
            const requestedProviderProfileId = requests[0]?.providerProfileId ?? ''
            let succeeded = 0
            const failures: string[] = []
            for (const request of requests) {
              try {
                const result = await uploadFile(request)
                if (providerProfileIdRef.current === requestedProviderProfileId) {
                  setFiles((current) => mergeFiles([result.file], current))
                }
                succeeded += 1
              } catch (error) {
                failures.push(filesErrorMessage(error, translate('canvasProviderFiles.t22')))
              }
            }
            if (providerProfileIdRef.current !== requestedProviderProfileId) return
            if (failures.length > 0) {
              setErrorMessage(
                translate('canvasProviderFiles.tpl8Desc', { ok: succeeded, failed: failures.length, reason: failures[0] }),
              )
            } else {
              message.success(translate('canvasProviderFiles.tpl7Desc', { count: succeeded }))
              setUploadOpen(false)
            }
          }}
        />
      ) : providerKind === 'minimax-hailuo' ? (
        <MinimaxFileUploadModal
          open={uploadOpen}
          providerProfileId={providerProfileId}
          uploading={uploadLoading}
          onClose={() => setUploadOpen(false)}
          onUpload={async (requests) => {
            const requestedProviderProfileId = requests[0]?.providerProfileId ?? ''
            let succeeded = 0
            const failures: string[] = []
            for (const request of requests) {
              try {
                const result = await uploadFile(request)
                if (providerProfileIdRef.current === requestedProviderProfileId) {
                  setFiles((current) => mergeFiles([result.file], current))
                }
                succeeded += 1
              } catch (error) {
                failures.push(filesErrorMessage(error, 'MiniMax'))
              }
            }
            if (providerProfileIdRef.current !== requestedProviderProfileId) return
            if (failures.length > 0) {
              setErrorMessage(
                translate('canvasProviderFiles.tpl8Desc', { ok: succeeded, failed: failures.length, reason: failures[0] }),
              )
            } else {
              message.success(translate('canvasProviderFiles.tpl9Desc', { count: succeeded }))
              setUploadOpen(false)
            }
          }}
        />
      ) : (
        <VolcengineFileUploadModal
          open={uploadOpen}
          providerProfileId={providerProfileId}
          uploading={uploadLoading}
          onClose={() => setUploadOpen(false)}
          onUpload={async (requests) => {
            const requestedProviderProfileId = requests[0]?.providerProfileId ?? ''
            let succeeded = 0
            const failures: string[] = []
            for (const request of requests) {
              try {
                const result = await uploadFile(request)
                if (providerProfileIdRef.current === requestedProviderProfileId) {
                  setFiles((current) => mergeFiles([result.file], current))
                }
                succeeded += 1
              } catch (error) {
                failures.push(filesErrorMessage(error))
              }
            }
            if (providerProfileIdRef.current !== requestedProviderProfileId) return
            if (failures.length > 0) {
              setErrorMessage(
                translate('canvasProviderFiles.tpl10Desc', { ok: succeeded, failed: failures.length, reason: failures[0] }),
              )
            } else {
              message.success(translate('canvasProviderFiles.tpl11Desc', { count: succeeded }))
              setUploadOpen(false)
            }
          }}
        />
      )}
    </div>
  )
}

function BailianFileUploadModal({
  open,
  providerProfileId,
  uploading,
  onClose,
  onUpload,
}: {
  open: boolean
  providerProfileId: string
  uploading: boolean
  onClose: () => void
  onUpload: (requests: Array<IpcRequest<'provider:files:upload'>>) => Promise<void>
}) {
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [purpose, setPurpose] = useState<BailianFilePurpose>('file-extract')
  const [description, setDescription] = useState('')

  const pickFiles = async () => {
    const picked = await window.spark.invoke('dialog:open-file', {
      title: translate('canvasProviderFiles.t23Desc'),
      multiple: true,
    })
    if (picked.canceled) return
    const paths = (picked.filePaths ?? (picked.filePath ? [picked.filePath] : [])).slice(
      0,
      MAX_LOCAL_UPLOADS,
    )
    setFilePaths(paths)
    if ((picked.filePaths?.length ?? 0) > MAX_LOCAL_UPLOADS) {
      message.warning(translate('canvasProviderFiles.tpl12Desc', { max: MAX_LOCAL_UPLOADS }))
    }
  }

  const submit = async () => {
    if (!providerProfileId) return
    if (filePaths.length === 0) {
      message.warning(translate('canvasProviderFiles.t24'))
      return
    }
    await onUpload(
      filePaths.map((filePath) => ({
        providerProfileId,
        filePath,
        purpose,
        ...(description.trim() ? { description: description.trim() } : {}),
      })),
    )
  }

  return (
    <Modal
      open={open}
      title={translate('canvasProviderFiles.t42Desc')}
      width={620}
      okText={translate('canvasProviderFiles.t43')}
      cancelText={translate('canvasProviderFiles.t5')}
      confirmLoading={uploading}
      onCancel={onClose}
      onOk={() => void submit()}
      destroyOnClose={false}
      zIndex={1500}
    >
      <div className="canvas-provider-files-upload-form">
        <Alert
          type="info"
          message={translate('canvasProviderFiles.t44LongDesc')}
        />
        <div className="canvas-provider-files-upload-row">
          <Button icon={<Icons.FolderOpen size={13} />} onClick={() => void pickFiles()}>
            {translate('canvasProviderFiles.t62')}
          </Button>
          <span className="canvas-provider-files-note">
            {filePaths.length > 0
              ? translate('canvasProviderFiles.tpl13Desc', { count: filePaths.length, names: filePaths.map(fileNameFromPath).join('、') })
              : translate('canvasProviderFiles.t25Desc')}
          </span>
        </div>
        <div className="canvas-provider-files-upload-grid">
          <label className="canvas-provider-files-field">
            <span>{translate('canvasProviderFiles.t63')}</span>
            <Select
              value={purpose}
              onChange={setPurpose}
              options={[
                { value: 'file-extract', label: translate('canvasProviderFiles.t26Desc') },
                { value: 'batch', label: translate('canvasProviderFiles.t27Desc') },
                {
                  value: 'fine-tune',
                  label: translate('canvasProviderFiles.t28LongDesc'),
                },
              ]}
            />
          </label>
          <label className="canvas-provider-files-field">
            <span>{translate('canvasProviderFiles.t64')}</span>
            <Input
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={translate('canvasProviderFiles.t45Desc')}
            />
          </label>
        </div>
      </div>
    </Modal>
  )
}

function MinimaxFileUploadModal({
  open,
  providerProfileId,
  uploading,
  onClose,
  onUpload,
}: {
  open: boolean
  providerProfileId: string
  uploading: boolean
  onClose: () => void
  onUpload: (requests: Array<IpcRequest<'provider:files:upload'>>) => Promise<void>
}) {
  const [filePaths, setFilePaths] = useState<string[]>([])

  const pickFiles = async () => {
    const picked = await window.spark.invoke('dialog:open-file', {
      title: translate('canvasProviderFiles.t29Desc'),
      multiple: true,
    })
    if (picked.canceled) return
    const paths = (picked.filePaths ?? (picked.filePath ? [picked.filePath] : [])).slice(
      0,
      MAX_LOCAL_UPLOADS,
    )
    setFilePaths(paths)
    if ((picked.filePaths?.length ?? 0) > MAX_LOCAL_UPLOADS) {
      message.warning(translate('canvasProviderFiles.tpl12Desc', { max: MAX_LOCAL_UPLOADS }))
    }
  }

  const submit = async () => {
    if (!providerProfileId) return
    if (filePaths.length === 0) {
      message.warning(translate('canvasProviderFiles.t24'))
      return
    }
    await onUpload(
      filePaths.map((filePath) => ({
        providerProfileId,
        filePath,
        purpose: 'video_generation_input',
      })),
    )
  }

  return (
    <Modal
      open={open}
      title={translate('canvasProviderFiles.t46Desc')}
      width={620}
      okText={translate('canvasProviderFiles.t43')}
      cancelText={translate('canvasProviderFiles.t5')}
      confirmLoading={uploading}
      onCancel={onClose}
      onOk={() => void submit()}
      destroyOnClose={false}
      zIndex={1500}
    >
      <div className="canvas-provider-files-upload-form">
        <Alert
          type="info"
          message={translate('canvasProviderFiles.t47LongDesc')}
        />
        <div className="canvas-provider-files-upload-row">
          <Button icon={<Icons.FolderOpen size={13} />} onClick={() => void pickFiles()}>
            {translate('canvasProviderFiles.t62')}
          </Button>
          <span className="canvas-provider-files-note">
            {filePaths.length > 0
              ? translate('canvasProviderFiles.tpl13Desc', { count: filePaths.length, names: filePaths.map(fileNameFromPath).join('、') })
              : translate('canvasProviderFiles.t25Desc')}
          </span>
        </div>
      </div>
    </Modal>
  )
}

function VolcengineFileUploadModal({
  open,
  providerProfileId,
  uploading,
  onClose,
  onUpload,
}: {
  open: boolean
  providerProfileId: string
  uploading: boolean
  onClose: () => void
  onUpload: (requests: Array<IpcRequest<'provider:files:upload'>>) => Promise<void>
}) {
  const [source, setSource] = useState<UploadSource>('local')
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [url, setUrl] = useState('')
  const [expireDays, setExpireDays] = useState(7)
  const [useTos, setUseTos] = useState(false)
  const [tosBucket, setTosBucket] = useState('')
  const [tosPrefix, setTosPrefix] = useState('arkfiles/')
  const [preprocessEnabled, setPreprocessEnabled] = useState(false)
  const [fps, setFps] = useState<number | null>(1)
  const [model, setModel] = useState('')
  const [maxVideoTokens, setMaxVideoTokens] = useState<number | null>(null)
  const [minFrameTokens, setMinFrameTokens] = useState<number | null>(null)
  const [maxFrameTokens, setMaxFrameTokens] = useState<number | null>(null)
  const [minFrames, setMinFrames] = useState<number | null>(null)

  const pickFiles = async () => {
    const picked = await window.spark.invoke('dialog:open-file', {
      title: translate('canvasProviderFiles.t30Desc'),
      multiple: true,
      filters: [
        {
          name: translate('canvasProviderFiles.t31'),
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'gif',
            'webp',
            'bmp',
            'tiff',
            'ico',
            'icns',
            'sgi',
            'jp2',
            'heic',
            'heif',
            'mp4',
            'avi',
            'mov',
            'pdf',
            'mp3',
            'wav',
            'aac',
            'm4a',
          ],
        },
      ],
    })
    if (picked.canceled) return
    const paths = (picked.filePaths ?? (picked.filePath ? [picked.filePath] : [])).slice(
      0,
      MAX_LOCAL_UPLOADS,
    )
    setFilePaths(paths)
    if ((picked.filePaths?.length ?? 0) > MAX_LOCAL_UPLOADS)
      message.warning(translate('canvasProviderFiles.tpl12Desc', { max: MAX_LOCAL_UPLOADS }))
  }

  const submit = async () => {
    if (!providerProfileId) return
    const normalizedUrl = url.trim()
    if (source === 'local' && filePaths.length === 0) {
      message.warning(translate('canvasProviderFiles.t24'))
      return
    }
    if (source === 'url' && !/^(?:https?:\/\/|tos:\/\/)/i.test(normalizedUrl)) {
      message.warning(translate('canvasProviderFiles.t32Desc'))
      return
    }
    const needsTos = useTos || isTosUrl(normalizedUrl)
    if (needsTos && (!tosBucket.trim() || !tosPrefix.trim())) {
      message.warning(translate('canvasProviderFiles.t33Desc'))
      return
    }
    const preprocessVideo: VolcengineVideoPreprocessInput | undefined = preprocessEnabled
      ? compactPreprocess({ fps, model, maxVideoTokens, minFrameTokens, maxFrameTokens, minFrames })
      : undefined
    const common = {
      providerProfileId,
      purpose: 'user_data' as const,
      expireAt: expireAtFromDays(expireDays),
      ...(needsTos ? { tos: { bucket: tosBucket.trim(), prefix: tosPrefix.trim() } } : {}),
      waitUntilActive: false,
    }
    const requests =
      source === 'local'
        ? filePaths.map((filePath) => ({
            ...common,
            filePath,
            ...(preprocessVideo && isVideoFileName(filePath) ? { preprocessVideo } : {}),
          }))
        : [{ ...common, url: normalizedUrl, ...(preprocessVideo ? { preprocessVideo } : {}) }]
    await onUpload(requests)
  }

  return (
    <Modal
      open={open}
      title={translate('canvasProviderFiles.t48Desc')}
      width={720}
      okText={translate('canvasProviderFiles.t43')}
      cancelText={translate('canvasProviderFiles.t5')}
      confirmLoading={uploading}
      onCancel={onClose}
      onOk={() => void submit()}
      destroyOnClose={false}
      zIndex={1500}
    >
      <div className="canvas-provider-files-upload-form">
        <Alert
          type="info"
          message={translate('canvasProviderFiles.t49LongDesc')}
        />
        <Select
          value={source}
          onChange={setSource}
          options={[
            { value: 'local', label: translate('canvasProviderFiles.t34') },
            { value: 'url', label: 'HTTP / HTTPS / TOS URI' },
          ]}
        />
        {source === 'local' ? (
          <div className="canvas-provider-files-upload-row">
            <Button icon={<Icons.FolderOpen size={13} />} onClick={() => void pickFiles()}>
              {translate('canvasProviderFiles.t62')}
            </Button>
            <span className="canvas-provider-files-note">
              {filePaths.length > 0
                ? translate('canvasProviderFiles.tpl13Desc', { count: filePaths.length, names: filePaths.map(fileNameFromPath).join('、') })
                : translate('canvasProviderFiles.t25Desc')}
            </span>
          </div>
        ) : (
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={translate('canvasProviderFiles.t50LongDesc')}
          />
        )}

        <div className="canvas-provider-files-upload-grid">
          <label className="canvas-provider-files-field">
            <span>{translate('canvasProviderFiles.t65')}</span>
            <InputNumber
              min={1}
              max={30}
              precision={0}
              value={expireDays}
              onChange={(value) => setExpireDays(value ?? 7)}
            />
          </label>
          <label className="canvas-provider-files-field">
            <span>{translate('canvasProviderFiles.t66')}</span>
            <Switch
              checked={useTos || isTosUrl(url)}
              disabled={isTosUrl(url)}
              onChange={setUseTos}
            />
          </label>
        </div>

        {(useTos || isTosUrl(url)) && (
          <div className="canvas-provider-files-upload-grid">
            <label className="canvas-provider-files-field">
              <span>TOS bucket</span>
              <Input
                value={tosBucket}
                onChange={(event) => setTosBucket(event.target.value)}
                placeholder="my-bucket"
              />
            </label>
            <label className="canvas-provider-files-field">
              <span>{translate('canvasProviderFiles.t67Desc')}</span>
              <Input
                value={tosPrefix}
                onChange={(event) => setTosPrefix(event.target.value)}
                placeholder="arkfiles/"
              />
            </label>
          </div>
        )}

        <div className="canvas-provider-files-upload-row">
          <Switch checked={preprocessEnabled} onChange={setPreprocessEnabled} />
          <span>{translate('canvasProviderFiles.t68Desc')}</span>
        </div>
        {preprocessEnabled && (
          <div className="canvas-provider-files-upload-grid">
            <label className="canvas-provider-files-field">
              <span>fps（0.2–5）</span>
              <InputNumber min={0.2} max={5} step={0.1} value={fps} onChange={setFps} />
            </label>
            <label className="canvas-provider-files-field">
              <span>{translate('canvasProviderFiles.t69Desc')}</span>
              <Input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={translate('canvasProviderFiles.t51')}
              />
            </label>
            <NumberField
              label="max_video_tokens（10240–204800）"
              value={maxVideoTokens}
              min={10_240}
              max={204_800}
              onChange={setMaxVideoTokens}
            />
            <NumberField
              label="min_frame_tokens（16–128）"
              value={minFrameTokens}
              min={16}
              max={128}
              onChange={setMinFrameTokens}
            />
            <NumberField
              label="max_frame_tokens（128–640）"
              value={maxFrameTokens}
              min={128}
              max={640}
              onChange={setMaxFrameTokens}
            />
            <NumberField
              label="min_frames（5–16）"
              value={minFrames}
              min={5}
              max={16}
              onChange={setMinFrames}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number | null
  min: number
  max: number
  onChange: (value: number | null) => void
}) {
  return (
    <label className="canvas-provider-files-field">
      <span>{label}</span>
      <InputNumber
        min={min}
        max={max}
        precision={0}
        value={value}
        placeholder={translate('canvasProviderFiles.t51')}
        onChange={onChange}
      />
    </label>
  )
}

function compactPreprocess(input: {
  fps: number | null
  model: string
  maxVideoTokens: number | null
  minFrameTokens: number | null
  maxFrameTokens: number | null
  minFrames: number | null
}): VolcengineVideoPreprocessInput {
  return {
    ...(input.fps !== null ? { fps: input.fps } : {}),
    ...(input.model.trim() ? { model: input.model.trim() } : {}),
    ...(input.maxVideoTokens !== null ? { maxVideoTokens: input.maxVideoTokens } : {}),
    ...(input.minFrameTokens !== null ? { minFrameTokens: input.minFrameTokens } : {}),
    ...(input.maxFrameTokens !== null ? { maxFrameTokens: input.maxFrameTokens } : {}),
    ...(input.minFrames !== null ? { minFrames: input.minFrames } : {}),
  }
}

function FileStatusTag({ status }: { status?: ProviderFileObject['status'] }) {
  if (status === 'active') return <Tag color="green">{translate('canvasProviderFiles.t70')}</Tag>
  if (status === 'processing') return <Tag color="blue">{translate('canvasProviderFiles.t71Desc')}</Tag>
  if (status === 'failed') return <Tag color="red">{translate('canvasProviderFiles.t72')}</Tag>
  return <Tag>{translate('canvasProviderFiles.t73')}</Tag>
}

function ProviderFilePreview({ file }: { file: ProviderFileObject }) {
  const url = file.downloadUrl
  if (!url) return <Empty description={translate('canvasProviderFiles.t52')} />
  const mimeType = file.mimeType?.toLowerCase() ?? ''
  if (mimeType.startsWith('image/')) {
    return (
      <img
        src={url}
        alt={file.filename}
        style={{ display: 'block', maxWidth: '100%', margin: '0 auto' }}
      />
    )
  }
  if (mimeType.startsWith('video/')) {
    return <video src={url} controls style={{ display: 'block', width: '100%', maxHeight: 560 }} />
  }
  if (mimeType.startsWith('audio/')) {
    return <audio src={url} controls style={{ width: '100%' }} />
  }
  if (mimeType === 'application/pdf') {
    return (
      <iframe src={url} title={file.filename} style={{ width: '100%', height: 560, border: 0 }} />
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {translate('canvasProviderFiles.t74')}
    </a>
  )
}

function mergeFiles(
  current: ProviderFileObject[],
  incoming: ProviderFileObject[],
): ProviderFileObject[] {
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

function expireAtFromDays(days: number): number {
  const now = Math.floor(Date.now() / 1_000)
  if (days <= 1) return now + 86_460
  if (days >= 30) return now + 2_591_940
  return now + Math.floor(days) * 86_400
}

function filesErrorMessage(error: unknown, providerName = translate('canvasProviderFiles.t2')): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (/401|api key|auth/i.test(detail))
    return translate('canvasProviderFiles.tpl14Desc', { provider: providerName })
  if (/403|forbidden|permission/i.test(detail))
    return translate('canvasProviderFiles.tpl15Desc', { provider: providerName })
  if (/429|rate.?limit/i.test(detail)) return translate('canvasProviderFiles.tpl16Desc', { provider: providerName })
  return translate('canvasProviderFiles.tpl17Desc', { provider: providerName, reason: detail })
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MiB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GiB`
}

function formatTime(value: number): string {
  if (!value) return translate('canvasProviderFiles.t35')
  return new Date(toMilliseconds(value)).toLocaleString()
}

function shortenFileId(id: string): string {
  if (id.length <= 16) return id
  return `${id.slice(0, 12)}…${id.slice(-4)}`
}

function toMilliseconds(value: number): number {
  return value < 10_000_000_000 ? value * 1_000 : value
}

function fileNameFromPath(value: string): string {
  return value.split(/[\\/]/).pop() ?? value
}

function isTosUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith('tos://')
}

function isVideoFileName(value: string): boolean {
  return /\.(?:mp4|avi|mov)$/i.test(value.split(/[?#]/, 1)[0] ?? '')
}

async function copyFileId(fileId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(fileId)
    message.success(translate('canvasProviderFiles.t36'))
  } catch {
    message.error(translate('canvasProviderFiles.t37'))
  }
}
