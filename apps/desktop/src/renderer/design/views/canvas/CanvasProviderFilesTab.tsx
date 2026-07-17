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
import { Icons } from '../../Icons'
import { providerFilesApiKindForProfile } from './canvasProviderFiles'
import './CanvasProviderFilesTab.less'

const MAX_BATCH_DELETE = 20
const MAX_LOCAL_UPLOADS = 20

type FileStatusFilter = 'all' | 'processing' | 'active' | 'failed'
type UploadSource = 'local' | 'url'

export function CanvasProviderFilesTab() {
  const { invoke: listProviders, loading: providersLoading } = useIpcInvoke('provider:list')
  const { invoke: listFiles, loading: filesLoading } = useIpcInvoke('provider:files:list')
  const { invoke: getFile, loading: getFileLoading } = useIpcInvoke('provider:files:get')
  const { invoke: uploadFile, loading: uploadLoading } = useIpcInvoke('provider:files:upload')
  const { invoke: deleteFile } = useIpcInvoke('provider:files:delete')
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [providerProfileId, setProviderProfileId] = useState('')
  const [files, setFiles] = useState<ProviderFileObject[]>([])
  const [paginationToken, setPaginationToken] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FileStatusFilter>('all')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [errorMessage, setErrorMessage] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const pollingRef = useRef(false)
  const loadSequenceRef = useRef(0)
  const providerProfileIdRef = useRef(providerProfileId)
  const providerKind = useMemo<Extract<ProviderFilesApiKind, 'bailian' | 'volcengine-ark'> | null>(
    () =>
      providerFilesApiKindForProfile(
        providers.find((profile) => profile.id === providerProfileId) ?? {},
      ),
    [providerProfileId, providers],
  )
  const providerLabel = providerKind === 'bailian' ? '阿里云百炼' : '火山方舟'

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
      if (!providerProfileId) return
      const sequence = ++loadSequenceRef.current
      try {
        const result = await listFiles({
          providerProfileId,
          order,
          limit: 100,
          ...(providerKind === 'volcengine-ark'
            ? { purpose: 'user_data' as const, ...(after ? { after } : {}) }
            : {}),
          ...(providerKind === 'bailian' && after ? { paginationToken: after } : {}),
        })
        if (sequence !== loadSequenceRef.current) return
        setFiles((current) => (after ? mergeFiles(current, result.files) : result.files))
        setPaginationToken(result.paginationToken)
        if (!after) setSelectedIds(new Set())
        setErrorMessage('')
      } catch (error) {
        if (sequence !== loadSequenceRef.current) return
        setErrorMessage(filesErrorMessage(error))
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
    if (failed > 0) setErrorMessage(`${deleted.size} 个文件已删除，${failed} 个删除失败，请重试。`)
    else message.success(`已删除 ${deleted.size} 个文件`)
  }

  const confirmDelete = (targets: ProviderFileObject[]) => {
    Modal.confirm({
      title:
        targets.length > 1
          ? `删除 ${targets.length} 个${providerLabel}文件？`
          : `删除${providerLabel}文件？`,
      content:
        targets.length > 1
          ? `单次最多删除 ${MAX_BATCH_DELETE} 个；远端文件可能仍被其他任务引用，删除后无法恢复。`
          : `${targets[0]?.filename ?? ''}（${targets[0]?.id ?? ''}）可能仍被其他任务引用，删除后无法恢复。`,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => deleteFiles(targets),
    })
  }

  const selectedFiles = files.filter((file) => selectedIds.has(file.id))

  return (
    <div className="canvas-provider-files">
      <div className="canvas-provider-files-channel-tabs" role="tablist" aria-label="Files 渠道">
        <button
          type="button"
          role="tab"
          aria-selected
          className="canvas-provider-files-channel-tab active"
        >
          {providerLabel}
        </button>
        <span className="canvas-provider-files-note">
          已支持火山方舟与百炼 DashScope 原生 Files；文件 ID 不会跨渠道或自动注入多媒体素材。
        </span>
      </div>

      <Alert
        type="info"
        message={
          providerKind === 'bailian'
            ? '百炼 DashScope Files 仅用于文件解析、Batch 和模型微调；官方未声明 file_id 可直接传给万相图片或视频生成，因此画布不会自动引用它。该 API 仅在北京 Region 开放。'
            : 'Files API 用于 Chat / Responses 的图片、视频、音频和 PDF 输入；文件必须为 active 才能引用。远端文件属于所选 Provider 项目，不随当前画布复制或导出；Seedance 视频生成不使用 file_id。'
        }
      />
      {errorMessage && (
        <Alert type="error" message={errorMessage} closable onClose={() => setErrorMessage('')} />
      )}

      <div className="canvas-provider-files-toolbar">
        <div className="canvas-provider-files-toolbar-main">
          <Select
            value={providerProfileId || null}
            placeholder="选择已配置的 Files Provider"
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
              setSelectedIds(new Set())
              setDeletingIds(new Set())
              setErrorMessage('')
            }}
            style={{ minWidth: 240, maxWidth: 420 }}
          />
          <Input
            allowClear
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件名 / File ID / MIME"
            style={{ width: 220 }}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '可用' },
              { value: 'processing', label: '处理中' },
              { value: 'failed', label: '失败' },
            ]}
            style={{ width: 112 }}
          />
          <Select
            value={order}
            onChange={setOrder}
            options={[
              { value: 'desc', label: '最新创建' },
              { value: 'asc', label: '最早创建' },
            ]}
            style={{ width: 112 }}
          />
        </div>
        <div className="canvas-provider-files-actions">
          {selectedFiles.length > 0 && (
            <Button danger onClick={() => confirmDelete(selectedFiles)}>
              批量删除 ({Math.min(selectedFiles.length, MAX_BATCH_DELETE)})
            </Button>
          )}
          <Button
            icon={<Icons.Refresh size={13} />}
            loading={filesLoading}
            disabled={!providerProfileId}
            onClick={() => void loadFiles()}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<Icons.Upload size={13} />}
            disabled={!providerProfileId}
            onClick={() => setUploadOpen(true)}
          >
            上传 / 导入
          </Button>
        </div>
      </div>

      {!providersLoading && providers.length === 0 ? (
        <Empty description="暂无可用的 Files Provider，请先在模型管理中配置 API Key 与官方 Base URL" />
      ) : visibleFiles.length === 0 && !filesLoading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={files.length === 0 ? '当前 Provider 暂无 Files 文件' : '当前筛选无文件'}
        />
      ) : (
        <div className="canvas-provider-files-list">
          {visibleFiles.map((file) => {
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
                <div style={{ minWidth: 0 }}>
                  <Tooltip title={`${file.filename}\n${file.id}`}>
                    <div className="canvas-provider-file-name">{file.filename}</div>
                  </Tooltip>
                  <div className="canvas-provider-file-id">{file.id}</div>
                  <div className="canvas-provider-files-meta">
                    <FileStatusTag status={file.status} />
                    <Tag>{file.mimeType ?? '未知类型'}</Tag>
                    <Tag>{formatBytes(file.bytes)}</Tag>
                    <Tag>{file.purpose}</Tag>
                    {file.tos?.bucket && <Tag color="blue">TOS · {file.tos.bucket}</Tag>}
                    <span className="canvas-provider-files-note">{formatTime(file.createdAt)}</span>
                    <ExpiryTag
                      {...(file.expiresAt !== undefined ? { expiresAt: file.expiresAt } : {})}
                    />
                  </div>
                  {file.status === 'failed' && (
                    <div className="canvas-provider-file-error">
                      {[file.error?.code, file.error?.message].filter(Boolean).join(' · ') ||
                        '预处理失败，官方响应未提供详情'}
                    </div>
                  )}
                </div>
                <div className="canvas-provider-files-actions">
                  <Button size="small" onClick={() => void copyFileId(file.id)}>
                    复制 ID
                  </Button>
                  <Button
                    size="small"
                    loading={getFileLoading && file.status === 'processing'}
                    onClick={() => void refreshOne(file.id)}
                  >
                    查询
                  </Button>
                  <Button
                    size="small"
                    danger
                    loading={deleting}
                    onClick={() => confirmDelete([file])}
                  >
                    删除
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {paginationToken && (
        <div className="canvas-provider-files-pagination">
          <Button loading={filesLoading} onClick={() => void loadFiles(paginationToken)}>
            加载更多
          </Button>
        </div>
      )}

      {providerKind === 'bailian' ? (
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
                failures.push(filesErrorMessage(error, '百炼'))
              }
            }
            if (providerProfileIdRef.current !== requestedProviderProfileId) return
            if (failures.length > 0) {
              setErrorMessage(
                `${succeeded} 个文件已上传，${failures.length} 个失败：${failures[0]}`,
              )
            } else {
              message.success(`已上传 ${succeeded} 个百炼文件`)
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
                `${succeeded} 个文件已提交，${failures.length} 个失败：${failures[0]}`,
              )
            } else {
              message.success(`已提交 ${succeeded} 个文件，处理中项目会自动刷新`)
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
      title: '选择上传到阿里云百炼 Files 的文件',
      multiple: true,
    })
    if (picked.canceled) return
    const paths = (picked.filePaths ?? (picked.filePath ? [picked.filePath] : [])).slice(
      0,
      MAX_LOCAL_UPLOADS,
    )
    setFilePaths(paths)
    if ((picked.filePaths?.length ?? 0) > MAX_LOCAL_UPLOADS) {
      message.warning(`单次最多选择 ${MAX_LOCAL_UPLOADS} 个文件`)
    }
  }

  const submit = async () => {
    if (!providerProfileId) return
    if (filePaths.length === 0) {
      message.warning('请先选择本地文件')
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
      title="上传到阿里云百炼 Files"
      width={620}
      okText="开始上传"
      cancelText="取消"
      confirmLoading={uploading}
      onCancel={onClose}
      onOk={() => void submit()}
      destroyOnClose={false}
      zIndex={1500}
    >
      <div className="canvas-provider-files-upload-form">
        <Alert
          type="info"
          message="仅支持本地 multipart 上传。该文件平台用于文件解析、Batch 和模型微调；不会作为万相图像/视频生成的素材引用。"
        />
        <div className="canvas-provider-files-upload-row">
          <Button icon={<Icons.FolderOpen size={13} />} onClick={() => void pickFiles()}>
            选择文件
          </Button>
          <span className="canvas-provider-files-note">
            {filePaths.length > 0
              ? `已选择 ${filePaths.length} 个：${filePaths.map(fileNameFromPath).join('、')}`
              : '可多选，单次最多 20 个'}
          </span>
        </div>
        <div className="canvas-provider-files-upload-grid">
          <label className="canvas-provider-files-field">
            <span>用途（purpose）</span>
            <Select
              value={purpose}
              onChange={setPurpose}
              options={[
                { value: 'file-extract', label: 'file-extract · 文件解析（150 MB）' },
                { value: 'batch', label: 'batch · 批量任务（500 MB）' },
                {
                  value: 'fine-tune',
                  label: 'fine-tune · 模型微调（300 MB；视频/图像 ZIP 特例 1 GiB）',
                },
              ]}
            />
          </label>
          <label className="canvas-provider-files-field">
            <span>文件描述（可选）</span>
            <Input
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="将随 descriptions 字段上传"
            />
          </label>
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
      title: '选择上传到火山方舟 Files 的文件',
      multiple: true,
      filters: [
        {
          name: '方舟支持的文件',
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
      message.warning(`单次最多选择 ${MAX_LOCAL_UPLOADS} 个文件`)
  }

  const submit = async () => {
    if (!providerProfileId) return
    const normalizedUrl = url.trim()
    if (source === 'local' && filePaths.length === 0) {
      message.warning('请先选择本地文件')
      return
    }
    if (source === 'url' && !/^(?:https?:\/\/|tos:\/\/)/i.test(normalizedUrl)) {
      message.warning('请输入 HTTP、HTTPS 或 TOS URI')
      return
    }
    const needsTos = useTos || isTosUrl(normalizedUrl)
    if (needsTos && (!tosBucket.trim() || !tosPrefix.trim())) {
      message.warning('使用 TOS 时必须填写 bucket 和 prefix')
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
      title="上传到火山方舟 Files"
      width={720}
      okText="开始上传"
      cancelText="取消"
      confirmLoading={uploading}
      onCancel={onClose}
      onOk={() => void submit()}
      destroyOnClose={false}
      zIndex={1500}
    >
      <div className="canvas-provider-files-upload-form">
        <Alert
          type="info"
          message="支持图片、MP4/AVI/MOV、PDF、MP3/WAV/AAC/M4A。平台托管单文件上限 512 MB；TOS 视频上限 2 GB。"
        />
        <Select
          value={source}
          onChange={setSource}
          options={[
            { value: 'local', label: '本地文件' },
            { value: 'url', label: 'HTTP / HTTPS / TOS URI' },
          ]}
        />
        {source === 'local' ? (
          <div className="canvas-provider-files-upload-row">
            <Button icon={<Icons.FolderOpen size={13} />} onClick={() => void pickFiles()}>
              选择文件
            </Button>
            <span className="canvas-provider-files-note">
              {filePaths.length > 0
                ? `已选择 ${filePaths.length} 个：${filePaths.map(fileNameFromPath).join('、')}`
                : '可多选，单次最多 20 个'}
            </span>
          </div>
        ) : (
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://.../file.mp4 或 tos://bucket/prefix/file.mp4"
          />
        )}

        <div className="canvas-provider-files-upload-grid">
          <label className="canvas-provider-files-field">
            <span>保存时长（天，1–30）</span>
            <InputNumber
              min={1}
              max={30}
              precision={0}
              value={expireDays}
              onChange={(value) => setExpireDays(value ?? 7)}
            />
          </label>
          <label className="canvas-provider-files-field">
            <span>写入用户 TOS</span>
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
              <span>TOS prefix（相对路径）</span>
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
          <span>配置视频预处理（非视频文件请关闭）</span>
        </div>
        {preprocessEnabled && (
          <div className="canvas-provider-files-upload-grid">
            <label className="canvas-provider-files-field">
              <span>fps（0.2–5）</span>
              <InputNumber min={0.2} max={5} step={0.1} value={fps} onChange={setFps} />
            </label>
            <label className="canvas-provider-files-field">
              <span>视频理解 Model / Endpoint ID</span>
              <Input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="可选"
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
        placeholder="可选"
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
  if (status === 'active') return <Tag color="green">active · 可用</Tag>
  if (status === 'processing') return <Tag color="blue">processing · 处理中</Tag>
  if (status === 'failed') return <Tag color="red">failed · 失败</Tag>
  return <Tag>状态未知</Tag>
}

function ExpiryTag({ expiresAt }: { expiresAt?: number }) {
  if (!expiresAt) return null
  return <Tag>到期 · {formatTime(expiresAt)}</Tag>
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

function filesErrorMessage(error: unknown, providerName = '火山方舟'): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (/401|api key|auth/i.test(detail))
    return `${providerName} API Key 无效或未配置，请检查当前 Provider 凭据。`
  if (/403|forbidden|permission/i.test(detail))
    return `当前 API Key 没有 ${providerName} Files 权限，或文件与 Provider 不属于同一项目。`
  if (/429|rate.?limit/i.test(detail)) return `${providerName} Files 请求过于频繁，请稍后重试。`
  return `${providerName} Files 请求失败：${detail}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MiB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GiB`
}

function formatTime(value: number): string {
  if (!value) return '创建时间未知'
  return new Date(toMilliseconds(value)).toLocaleString()
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
    message.success('File ID 已复制')
  } catch {
    message.error('复制失败，请稍后重试')
  }
}
