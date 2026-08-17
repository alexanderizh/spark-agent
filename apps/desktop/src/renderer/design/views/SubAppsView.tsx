/**
 * SubAppsView — 自定义子应用管理主视图
 *
 * 子应用是独立于会话的长期资源：这里只做展示、启动与生命周期操作；
 * 创建与修改主要通过 Agent 会话完成（spark_app 工具链）。
 *
 * 布局：header（搜索/刷新/Agent 创建引导）+ 卡片网格 + 版本历史抽屉。
 * 发布/回滚带 revision CAS；删除为破坏性操作，双重确认。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Input, Modal, Tooltip } from '@lobehub/ui'
import { Badge, Drawer, Popconfirm, Spin, Switch, message as antdMessage } from 'antd'
import type {
  SubAppListReleasesResponse,
  SubAppReleaseSummary,
  SubAppSummary,
} from '@spark/protocol'
import { subAppClient } from '../sub-app/subAppClient'
import { useApp } from '../AppContext'
import { useI18n } from '../i18n'
import { Icons } from '../Icons'
import './SubAppsView.less'

// ─── 状态展示 ────────────────────────────────────────────────────────────────

type StatusBadge = { text: string; color: string }

function statusBadgeOf(app: SubAppSummary): StatusBadge {
  if (!app.enabled) return { text: '已禁用', color: 'default' }
  switch (app.publicationStatus) {
    case 'published':
      return { text: `已发布 v${app.publishedVersion ?? '?'}`, color: 'success' }
    case 'draft':
      return { text: '草稿', color: 'processing' }
    case 'archived':
      return { text: '已归档', color: 'warning' }
    default:
      return { text: app.publicationStatus, color: 'default' }
  }
}

function surfaceLabel(surface: string): string {
  switch (surface) {
    case 'content':
      return '内容区'
    case 'sidebar':
      return '侧栏'
    case 'overlay':
      return '浮层'
    case 'global-window':
      return '全局窗口'
    case 'desktop-pet':
      return '桌面宠物'
    default:
      return surface
  }
}

function formatTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '-'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

// ─── 视图 ────────────────────────────────────────────────────────────────────

export function SubAppsView(): React.ReactElement {
  const { setTweak } = useApp()
  const { t: tr } = useI18n()

  const [apps, setApps] = useState<SubAppSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [busyAppId, setBusyAppId] = useState<string | null>(null)

  // 版本历史抽屉
  const [releasesFor, setReleasesFor] = useState<SubAppSummary | null>(null)
  const [releases, setReleases] = useState<SubAppReleaseSummary[] | null>(null)
  const [releasesLoading, setReleasesLoading] = useState(false)

  // Agent 创建引导
  const [guideOpen, setGuideOpen] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const trimmed = query.trim()
      const res = await subAppClient.list({
        ...(trimmed ? { query: trimmed } : {}),
        includeArchived,
        limit: 200,
      })
      setApps(res.items)
      setTotal(res.total)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [query, includeArchived])

  useEffect(() => {
    void reload()
  }, [reload])

  const openApp = useCallback(
    (app: SubAppSummary): void => {
      setTweak('subAppOpenId', app.id)
      setTweak('view', 'sub-app')
    },
    [setTweak],
  )

  const goChatForAgent = useCallback((): void => {
    setGuideOpen(false)
    setTweak('view', 'chat')
  }, [setTweak])

  /** CAS 类操作统一收口：失败时提示并刷新列表（revision 可能已过期）。 */
  const withBusy = useCallback(
    async (appId: string, action: () => Promise<unknown>): Promise<void> => {
      setBusyAppId(appId)
      try {
        await action()
        await reload()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        antdMessage.error(`操作失败：${msg}`)
        await reload()
      } finally {
        setBusyAppId(null)
      }
    },
    [reload],
  )

  const handlePublish = useCallback(
    (app: SubAppSummary): Promise<void> =>
      withBusy(app.id, async () => {
        await subAppClient.publish({ appId: app.id, expectedDraftRevision: app.draftRevision })
        antdMessage.success(`已发布 ${app.name} v${(app.publishedVersion ?? 0) + 1}`)
      }),
    [withBusy],
  )

  const handleSetEnabled = useCallback(
    (app: SubAppSummary, enabled: boolean): Promise<void> =>
      withBusy(app.id, async () => {
        await subAppClient.setEnabled({ appId: app.id, enabled })
      }),
    [withBusy],
  )

  const handleArchive = useCallback(
    (app: SubAppSummary): Promise<void> =>
      withBusy(app.id, async () => {
        await subAppClient.archive({ appId: app.id })
        antdMessage.success(`已归档 ${app.name}`)
      }),
    [withBusy],
  )

  const handleDelete = useCallback(
    (app: SubAppSummary): Promise<void> =>
      withBusy(app.id, async () => {
        await subAppClient.delete({ appId: app.id })
        antdMessage.success(`已删除 ${app.name}`)
      }),
    [withBusy],
  )

  const openReleases = useCallback((app: SubAppSummary): void => {
    setReleasesFor(app)
    setReleases(null)
  }, [])

  useEffect(() => {
    if (releasesFor == null) return
    let cancelled = false
    setReleasesLoading(true)
    subAppClient
      .listReleases({ appId: releasesFor.id })
      .then((res: SubAppListReleasesResponse) => {
        if (!cancelled) setReleases(res.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setReleases([])
          antdMessage.error(`版本历史加载失败：${err instanceof Error ? err.message : String(err)}`)
        }
      })
      .finally(() => {
        if (!cancelled) setReleasesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [releasesFor])

  const handleRollback = useCallback(
    (version: number): Promise<void> => {
      if (releasesFor == null) return Promise.resolve()
      const app = releasesFor
      return withBusy(app.id, async () => {
        await subAppClient.rollback({
          appId: app.id,
          releaseVersion: version,
          expectedDraftRevision: app.draftRevision,
        })
        antdMessage.success(`已将草稿回滚到 v${version}（未自动发布）`)
        setReleasesFor(null)
      })
    },
    [releasesFor, withBusy],
  )

  return (
    <div className="sub-apps-view" data-testid="sub-apps-view">
      <header className="sa-header">
        <div className="sa-header-left">
          <h2>{tr('nav.subApps')}</h2>
          {!loading && errorMessage == null ? <span className="sa-count">{total}</span> : null}
        </div>
        <div className="sa-header-right">
          <Input
            className="sa-search"
            allowClear
            placeholder="搜索应用名称 / 描述"
            prefix={<Icons.Search size={14} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Tooltip title="显示已归档的应用">
            <label className="sa-archived-toggle">
              <Switch
                size="small"
                checked={includeArchived}
                onChange={(setChecked) => setIncludeArchived(setChecked)}
              />
              <span>归档</span>
            </label>
          </Tooltip>
          <Tooltip title="刷新">
            <Button
              icon={<Icons.Refresh size={15} />}
              loading={loading}
              onClick={() => void reload()}
            />
          </Tooltip>
          <Button
            type="primary"
            icon={<Icons.MessageSquare size={15} />}
            onClick={() => setGuideOpen(true)}
          >
            通过 Agent 创建
          </Button>
        </div>
      </header>

      <div className="sa-body">
        {errorMessage != null ? (
          <div className="sa-error" role="alert">
            <span>加载失败：{errorMessage}</span>
            <Button size="small" onClick={() => void reload()}>
              重试
            </Button>
          </div>
        ) : null}

        {loading && apps.length === 0 ? (
          <div className="sa-loading">
            <Spin />
          </div>
        ) : null}

        {!loading && errorMessage == null && apps.length === 0 ? (
          <div className="sa-empty">
            <Empty
              description={
                query.trim()
                  ? '没有匹配的应用，换个关键词试试'
                  : '还没有子应用 — 在任意对话中让 Agent 帮你创建，例如「帮我做一个读书打卡子应用」'
              }
            >
              {query.trim() ? null : (
                <Button type="primary" onClick={() => setGuideOpen(true)}>
                  查看创建方式
                </Button>
              )}
            </Empty>
          </div>
        ) : null}

        {apps.length > 0 ? (
          <div className="sa-grid">
            {apps.map((app) => {
              const badge = statusBadgeOf(app)
              const busy = busyAppId === app.id
              return (
                <div key={app.id} className="sa-card" data-testid="sub-app-card">
                  <div className="sa-card-top">
                    <span className="sa-card-icon" aria-hidden>
                      {app.icon ?? app.name.slice(0, 1)}
                    </span>
                    <div className="sa-card-title-block">
                      <span className="sa-card-name" title={app.name}>
                        {app.name}
                      </span>
                      <Badge color={badge.color} text={badge.text} />
                    </div>
                    <Tooltip
                      title={
                        app.enabled ? '禁用后从菜单隐藏且不可启动' : '启用后显示在菜单并可启动'
                      }
                    >
                      <Switch
                        size="small"
                        checked={app.enabled}
                        loading={busy}
                        disabled={app.publicationStatus === 'archived'}
                        onChange={(checked) => void handleSetEnabled(app, checked)}
                      />
                    </Tooltip>
                  </div>

                  <p className="sa-card-desc" title={app.description}>
                    {app.description || '暂无描述'}
                  </p>

                  <div className="sa-card-meta">
                    <span className="sa-surface-tag">{surfaceLabel(app.surface)}</span>
                    <span className="sa-updated">更新于 {formatTime(app.updatedAt)}</span>
                  </div>

                  <div className="sa-card-actions">
                    <Button
                      size="small"
                      type="primary"
                      disabled={busy}
                      onClick={() => openApp(app)}
                    >
                      打开
                    </Button>
                    <Popconfirm
                      title="发布当前草稿？"
                      description={`将以草稿 revision ${app.draftRevision} 生成新版本，发布后不可修改。`}
                      okText="发布"
                      cancelText="取消"
                      onConfirm={() => void handlePublish(app)}
                    >
                      <Button size="small" disabled={busy || app.publicationStatus === 'archived'}>
                        发布
                      </Button>
                    </Popconfirm>
                    <Button size="small" disabled={busy} onClick={() => openReleases(app)}>
                      版本
                    </Button>
                    <span className="sa-card-actions-spacer" />
                    {app.publicationStatus === 'archived' ? null : (
                      <Popconfirm
                        title="归档此应用？"
                        description="归档后从列表主视图隐藏，可在此页开启「归档」筛选后查看。"
                        okText="归档"
                        cancelText="取消"
                        onConfirm={() => void handleArchive(app)}
                      >
                        <Button size="small" disabled={busy}>
                          归档
                        </Button>
                      </Popconfirm>
                    )}
                    <Popconfirm
                      title="删除此应用？"
                      description="将永久删除源码、全部版本与应用数据，不可恢复。"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => void handleDelete(app)}
                    >
                      <Button size="small" danger disabled={busy}>
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      <Drawer
        title={releasesFor ? `${releasesFor.name} · 版本历史` : '版本历史'}
        placement="right"
        width={380}
        open={releasesFor != null}
        onClose={() => setReleasesFor(null)}
      >
        {releasesLoading ? (
          <div className="sa-drawer-loading">
            <Spin />
          </div>
        ) : releases == null || releases.length === 0 ? (
          <Empty description="暂无发布版本，发布草稿后会在这里生成版本记录" />
        ) : (
          <ul className="sa-release-list">
            {releases.map((rel) => (
              <li key={rel.id} className="sa-release-item">
                <div className="sa-release-head">
                  <span className="sa-release-version">v{rel.version}</span>
                  <span className="sa-release-time">{formatTime(rel.publishedAt)}</span>
                </div>
                <Button
                  size="small"
                  onClick={() => void handleRollback(rel.version)}
                  loading={busyAppId === releasesFor?.id}
                >
                  回滚草稿到此版本
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <Modal
        title="让 Agent 创建子应用"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={
          <Button type="primary" onClick={goChatForAgent}>
            去对话创建
          </Button>
        }
      >
        <div className="sa-guide">
          <p>子应用在任意对话中创建与修改，代码、配置和数据长期保存，与会话无关。</p>
          <ul>
            <li>直接描述需求，例如「帮我开发一个记账子应用，支持月度统计」</li>
            <li>
              或使用强制命令：<code>/spark-app-create 记账工具</code>
            </li>
            <li>创建后在本页面管理：打开、发布、回滚、禁用、归档</li>
          </ul>
        </div>
      </Modal>
    </div>
  )
}
