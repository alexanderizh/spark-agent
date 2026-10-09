/**
 * WikiVersionHistory — 版本历史弹层（预览 + 回滚）。
 *
 * 数据口径（与存储契约一致）：wiki_revision 只记录**被替代**的版本，当前版本是
 * wiki_page 行 + 正文文件（head 不入表）。因此这里在列表顶部合成一行 head，
 * 避免用户误以为「当前版本没有记录」。
 *
 * 回滚语义：还原 = 用历史正文做一次普通提交（CAS 保护，自身也产生新版本），
 * 历史链不丢。因此回滚不是"穿越"，而是"基于旧内容向前走一步" —— 文案必须如实
 * 表达，否则用户会以为当前版本被抹掉了。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Empty } from '@lobehub/ui'
import { Modal, Spin } from 'antd'
import type { WikiPageDetail, WikiPageVersionEntry, WikiRevisionDetail } from '@spark/protocol'
import { MarkdownText } from '../chat/ChatMarkdown'
import { Icons } from '../../Icons'

const CHANGE_LABEL: Record<WikiPageVersionEntry['changeKind'], string> = {
  create: '创建',
  edit: '编辑',
  restore: '回滚',
  delete: '删除',
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

export interface WikiVersionHistoryProps {
  open: boolean
  page: WikiPageDetail | null
  versions: readonly WikiPageVersionEntry[]
  loading: boolean
  onClose: () => void
  /** 读取某个历史版本的快照正文（预览用）；快照缺失时 details.body 为 null */
  onPreview: (version: number) => Promise<WikiRevisionDetail | null>
  /** 把某个历史版本还原为当前版本；返回是否成功 */
  onRestore: (version: number) => Promise<boolean>
}

export function WikiVersionHistory({
  open,
  page,
  versions,
  loading,
  onClose,
  onPreview,
  onRestore,
}: WikiVersionHistoryProps) {
  const ordered = [...versions].sort((a, b) => b.version - a.version)
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [preview, setPreview] = useState<WikiRevisionDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  // 关闭时清空预览：下次打开不应残留上一页的历史内容
  useEffect(() => {
    if (!open) {
      setPreviewVersion(null)
      setPreview(null)
    }
  }, [open])

  const togglePreview = useCallback(
    async (version: number) => {
      if (previewVersion === version) {
        setPreviewVersion(null)
        setPreview(null)
        return
      }
      setPreviewVersion(version)
      setPreview(null)
      setPreviewLoading(true)
      try {
        setPreview(await onPreview(version))
      } finally {
        setPreviewLoading(false)
      }
    },
    [previewVersion, onPreview],
  )

  const confirmRestore = useCallback(
    (version: number) => {
      Modal.confirm({
        title: `还原到 v${version}？`,
        content:
          '还原会以该版本的正文生成一个新版本（当前版本进入历史，可再还原回来），不会抹掉历史。',
        okText: '还原',
        cancelText: '取消',
        onOk: async () => {
          setRestoring(true)
          try {
            await onRestore(version)
          } finally {
            setRestoring(false)
          }
        },
      })
    },
    [onRestore],
  )

  return (
    <Modal
      className="wiki_modal"
      open={open}
      onCancel={onClose}
      title="版本历史"
      width={640}
      footer={
        <Button size="middle" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="wiki_history_list">
        {loading ? (
          <div className="wiki_empty" style={{ minHeight: 160 }}>
            <Spin />
          </div>
        ) : page == null ? (
          <Empty description="未选择页面" />
        ) : (
          <>
            <div className="wiki_history_row">
              <span className="wiki_history_ver">v{page.version}</span>
              <div className="wiki_history_main">
                <div className="wiki_history_title">{page.title}</div>
                <div className="wiki_history_sub">
                  当前版本 · 更新于 {formatTime(page.updatedAt)}
                </div>
              </div>
              <span className="wiki_tag is-ok">
                <Icons.Check size={11} />
                当前
              </span>
            </div>
            {ordered.length === 0 ? (
              <div className="wiki_empty" style={{ minHeight: 120 }}>
                <div className="wiki_empty_desc">还没有被替代的历史版本。</div>
              </div>
            ) : (
              ordered.map((v) => (
                <div key={`${v.version}-${v.contentHash}`} className="wiki_history_item">
                  <div className="wiki_history_row">
                    <span className="wiki_history_ver">v{v.version}</span>
                    <div className="wiki_history_main">
                      <div className="wiki_history_title">{v.title}</div>
                      <div className="wiki_history_sub">
                        {CHANGE_LABEL[v.changeKind]} · {formatTime(v.createdAt)}
                        {v.actor != null && v.actor.length > 0 ? ` · ${v.actor}` : ''}
                        {v.changeNote != null && v.changeNote.length > 0
                          ? ` · ${v.changeNote}`
                          : ''}
                      </div>
                    </div>
                    <div className="wiki_history_actions">
                      <Button size="small" onClick={() => void togglePreview(v.version)}>
                        {previewVersion === v.version ? '收起' : '预览'}
                      </Button>
                      <Button
                        size="small"
                        disabled={restoring}
                        onClick={() => confirmRestore(v.version)}
                      >
                        还原
                      </Button>
                    </div>
                  </div>
                  {previewVersion === v.version && (
                    <div className="wiki_history_preview">
                      {previewLoading ? (
                        <Spin />
                      ) : preview == null ? (
                        <div className="wiki_hint">该版本内容不可读。</div>
                      ) : preview.body == null ? (
                        <div className="wiki_hint">{preview.unavailableReason ?? '快照不可读'}</div>
                      ) : (
                        <MarkdownText content={preview.body} />
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            <div className="wiki_hint" style={{ paddingTop: 10 }}>
              历史记录保存被替代版本的正文快照；还原会生成新版本，历史不会丢失。
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
