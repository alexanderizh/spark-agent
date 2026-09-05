/**
 * SubAppShareModals — 子应用分享导出 / 导入弹窗。
 *
 * 分享包是 .sparkapp 单文件 JSON（全量语义：manifest + 草稿 + 全部发布版本 +
 * data + 文件空间）。大包在主进程打包/解析，这里只接触摘要与报告：
 *   - 导出：勾选是否带 data/文件空间 → 保存对话框 → 展示结果与疑似密钥警告；
 *   - 导入：选择文件 → 能力检查报告 + 本机冲突识别 → 覆盖（展示具体替换量）
 *     或作为新应用导入 → 成功后关闭该应用的运行中实例（避免旧源码继续跑）。
 */

import React from 'react'
import { Button, Checkbox, Modal } from '@lobehub/ui'
import { Alert, Space, Tag, Typography } from 'antd'
import type {
  SubAppShareConflictInfo,
  SubAppShareImportCheck,
  SubAppShareImportPreviewResponse,
  SubAppSummary,
} from '@spark/protocol'
import { subAppClient } from './subAppClient'
import { useSubAppSurfaces } from './SubAppSurfaceHost'

const { Text } = Typography

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function checkColor(
  level: SubAppShareImportCheck['level'],
): 'success' | 'warning' | 'error' | 'info' {
  switch (level) {
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    default:
      return 'success'
  }
}

// ─── 导出弹窗 ────────────────────────────────────────────────────────────────

export function SubAppExportModal({
  app,
  onClose,
}: {
  app: SubAppSummary | null
  onClose: () => void
}): React.ReactElement {
  const [includeData, setIncludeData] = React.useState(true)
  const [includeFiles, setIncludeFiles] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof subAppClient.shareExport>> | null>(
    null,
  )
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const handleExport = async (): Promise<void> => {
    if (app == null) return
    setBusy(true)
    setErrorMessage(null)
    try {
      const res = await subAppClient.shareExport({
        appId: app.id,
        includeData,
        includeFiles,
      })
      setResult(res)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={app == null ? '分享导出' : `分享导出「${app.name}」`}
      open={app != null}
      onCancel={onClose}
      footer={
        result?.saved ? (
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        ) : (
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void handleExport()}>
              选择保存位置并导出
            </Button>
          </Space>
        )
      }
      width={520}
    >
      {result == null ? (
        <div className="sa-share-export-options">
          <p>将导出完整分享包：清单、草稿、全部发布版本，可直接发给同平台的其他人导入。</p>
          <Space direction="vertical">
            <Checkbox checked={includeData} onChange={(checked) => setIncludeData(checked)}>
              包含应用数据（勾选后导入即带全部数据）
            </Checkbox>
            <Checkbox checked={includeFiles} onChange={(checked) => setIncludeFiles(checked)}>
              包含文件空间（应用生成的文件型内容）
            </Checkbox>
          </Space>
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="AI 渠道与 API Key 不随包分享：导入方使用自己的 Provider。源码或数据里的疑似明文密钥会在导出后提示确认。"
          />
          {errorMessage != null ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message={`导出失败：${errorMessage}`}
            />
          ) : null}
        </div>
      ) : (
        <div className="sa-share-export-result">
          {result.saved ? (
            <Alert type="success" showIcon message={`已导出：${result.savedPath ?? ''}`} />
          ) : result.canceled ? (
            <Alert type="warning" showIcon message="已取消保存。" />
          ) : (
            <Alert type="error" showIcon message={`保存失败：${result.error ?? '未知错误'}`} />
          )}
          <p style={{ marginTop: 12 }}>
            包内：{result.counts.releases} 个发布版本 · {result.counts.dataEntries} 条应用数据 ·{' '}
            {result.counts.files} 个文件
          </p>
          {result.secretWarnings.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="疑似包含明文密钥，分享前请确认："
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.secretWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
        </div>
      )}
    </Modal>
  )
}

// ─── 导入弹窗 ────────────────────────────────────────────────────────────────

export function SubAppImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  /** 导入成功后回调（运行中旧实例已在弹窗内关闭；这里让列表刷新）。 */
  onImported: () => void
}): React.ReactElement {
  const surfaces = useSubAppSurfaces()
  const [preview, setPreview] = React.useState<SubAppShareImportPreviewResponse | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<Awaited<ReturnType<typeof subAppClient.shareImportApply>> | null>(
    null,
  )

  const reset = React.useCallback((): void => {
    setPreview(null)
    setErrorMessage(null)
    setDone(null)
  }, [])

  React.useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const handlePickFile = async (): Promise<void> => {
    setBusy(true)
    setErrorMessage(null)
    try {
      const res = await subAppClient.shareImportPreview()
      if (res.canceled) return
      setPreview(res)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async (mode: 'overwrite' | 'new-app'): Promise<void> => {
    if (preview?.importToken == null) return
    setBusy(true)
    setErrorMessage(null)
    try {
      const res = await subAppClient.shareImportApply({ importToken: preview.importToken, mode })
      // 覆盖导入后关闭该应用的运行中实例：旧源码不再继续跑旧结构数据，
      // 用户重新打开即加载新版本。
      surfaces.instances
        .filter((instance) => instance.appId === res.appId)
        .forEach((instance) => surfaces.close(instance.key))
      setDone(res)
      onImported()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const conflict: SubAppShareConflictInfo | null = preview?.conflict ?? null
  const hasBlockingError = preview?.checks.some((check) => check.level === 'error') ?? false

  return (
    <Modal
      title="导入子应用分享包"
      open={open}
      onCancel={onClose}
      footer={
        done != null ? (
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        ) : preview == null ? (
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void handlePickFile()}>
              选择分享包文件
            </Button>
          </Space>
        ) : (
          <Space>
            <Button disabled={busy} onClick={reset}>
              重选文件
            </Button>
            {conflict?.kind === 'same-id' && !hasBlockingError ? (
              <Button danger loading={busy} onClick={() => void handleApply('overwrite')}>
                覆盖本机应用
              </Button>
            ) : null}
            <Button
              type="primary"
              loading={busy}
              disabled={hasBlockingError || preview.importToken == null}
              onClick={() => void handleApply('new-app')}
            >
              作为新应用导入
            </Button>
          </Space>
        )
      }
      width={560}
    >
      {done != null ? (
        <div>
          <Alert
            type="success"
            showIcon
            message={`已导入「${done.name}」${
              done.publishedVersion != null ? `，当前生效 v${done.publishedVersion}` : '（草稿态）'
            }`}
            description={
              <div>
                <p style={{ margin: '4px 0' }}>
                  载入 {done.importedReleases} 个版本 · {done.importedDataEntries} 条数据 ·{' '}
                  {done.importedFiles} 个文件。该应用已启用并出现在应用入口。
                </p>
                {done.backupPath != null ? (
                  <p style={{ margin: '4px 0' }}>覆盖前的本机应用已备份：{done.backupPath}</p>
                ) : null}
                {done.warnings.map((warning) => (
                  <p key={warning} style={{ margin: '4px 0', color: '#d46b08' }}>
                    {warning}
                  </p>
                ))}
              </div>
            }
          />
        </div>
      ) : preview == null ? (
        <div>
          <p>选择 .sparkapp 分享包文件，导入后将得到完整可用的应用（除 AI 渠道外）。</p>
          {errorMessage != null ? (
            <Alert style={{ marginTop: 12 }} type="error" showIcon message={errorMessage} />
          ) : null}
        </div>
      ) : (
        <div className="sa-share-import-preview">
          {preview.packageSummary != null ? (
            <>
              <p>
                <Text strong>{preview.packageSummary.manifest.name}</Text>
                {preview.packageSummary.manifest.description ? (
                  <Text type="secondary"> — {preview.packageSummary.manifest.description}</Text>
                ) : null}
              </p>
              <p>
                {preview.packageSummary.counts.releases} 个发布版本 ·{' '}
                {preview.packageSummary.counts.dataEntries} 条数据 ·{' '}
                {preview.packageSummary.counts.files} 个文件 ·{' '}
                {formatBytes(preview.byteSize ?? 0)}
              </p>
              <p>
                <Text type="secondary">
                  导出于 {new Date(preview.packageSummary.exportedAt).toLocaleString()} · 平台{' '}
                  {preview.packageSummary.platformVersion}
                </Text>
              </p>
            </>
          ) : null}

          {conflict?.kind === 'same-id' && conflict.current != null ? (
            <Alert
              style={{ marginTop: 8 }}
              type="warning"
              showIcon
              message={`本机已有同 id 应用「${conflict.current.name}」（${
                conflict.current.publishedVersion != null
                  ? `已发布 v${conflict.current.publishedVersion}`
                  : conflict.current.publicationStatus
              }）`}
              description={`覆盖导入将整体替换：${conflict.current.releaseCount} 个版本 / ${conflict.current.dataEntries} 条数据 / ${conflict.current.files} 个文件；替换前会自动备份本机当前应用。`}
            />
          ) : null}
          {conflict?.kind === 'same-name' ? (
            <Alert
              style={{ marginTop: 8 }}
              type="info"
              showIcon
              message="本机有同名但不同身份的应用：默认作为新应用导入，名称会自动加后缀以区分。"
            />
          ) : null}

          <div className="sa-share-import-checks" style={{ marginTop: 12 }}>
            {preview.checks.map((check, index) => (
              <Alert
                key={`${check.code}-${index}`}
                style={{ marginTop: 6 }}
                type={checkColor(check.level)}
                showIcon={check.level !== 'ok'}
                message={check.message}
                description={
                  check.detail != null && check.detail.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {check.detail.slice(0, 8).map((item) => (
                        <li key={item}>
                          <Tag style={{ marginInlineEnd: 4 }}>{item}</Tag>
                        </li>
                      ))}
                      {check.detail.length > 8 ? <li>…等 {check.detail.length} 项</li> : null}
                    </ul>
                  ) : undefined
                }
              />
            ))}
          </div>

          {hasBlockingError ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message="存在阻断性问题时无法导入，请处理后重新导出分享包。"
            />
          ) : null}
          {errorMessage != null ? (
            <Alert style={{ marginTop: 12 }} type="error" showIcon message={errorMessage} />
          ) : null}
        </div>
      )}
    </Modal>
  )
}
