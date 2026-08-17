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
import { Button, Dropdown, Empty, Input, Modal, Tooltip } from '@lobehub/ui'
import {
  Badge,
  Drawer,
  Modal as AntdModal,
  Popconfirm,
  Spin,
  Switch,
  message as antdMessage,
} from 'antd'
import type {
  SubAppListReleasesResponse,
  SubAppReleaseSummary,
  SubAppSummary,
} from '@spark/protocol'
import { subAppClient } from '../sub-app/subAppClient'
import { useSubAppSurfaces } from '../sub-app/SubAppSurfaceHost'
import { notifySubAppDirectoryChanged } from '../sub-app/subAppEvents'
import { SubAppIcon } from '../sub-app/SubAppIcon'
import { SUB_APP_ICON_OPTIONS } from '../sub-app/subAppIconOptions'
import { useApp } from '../AppContext'
import { useI18n } from '../i18n'
import { Icons } from '../Icons'
import './SubAppsView.less'

// ─── 状态展示 ────────────────────────────────────────────────────────────────

type StatusBadge = { text: string; color: string }

function statusBadgeOf(app: SubAppSummary): StatusBadge {
  // 归档操作会同时置 enabled=0——archived 必须最先判断，
  // 否则归档应用错显「已禁用」，用户找不到入口。
  if (app.publicationStatus === 'archived') return { text: '已归档', color: 'warning' }
  if (!app.enabled) return { text: '已禁用', color: 'default' }
  switch (app.publicationStatus) {
    case 'published':
      return { text: `已发布 v${app.publishedVersion ?? '?'}`, color: 'success' }
    case 'draft':
      return { text: '草稿', color: 'processing' }
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
  const [iconEditorFor, setIconEditorFor] = useState<SubAppSummary | null>(null)
  const [iconSaving, setIconSaving] = useState(false)

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
    (app: SubAppSummary, mode: 'published' | 'draft' = 'published'): void => {
      setTweak('subAppOpenId', app.id)
      setTweak('subAppOpenMode', mode)
      setTweak('view', 'sub-app')
    },
    [setTweak],
  )

  const surfaces = useSubAppSurfaces()
  const openSurface = useCallback(
    async (app: SubAppSummary): Promise<void> => {
      try {
        await surfaces.open(app.id)
      } catch (err) {
        antdMessage.error(`启动失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [surfaces],
  )

  const goChatForAgent = useCallback((): void => {
    setGuideOpen(false)
    setTweak('view', 'chat')
  }, [setTweak])

  const handleIconChange = useCallback(
    async (icon: string | null): Promise<void> => {
      if (iconEditorFor == null) return
      setIconSaving(true)
      try {
        await subAppClient.updateDraft({
          appId: iconEditorFor.id,
          expectedDraftRevision: iconEditorFor.draftRevision,
          patch: { icon },
        })
        notifySubAppDirectoryChanged()
        setIconEditorFor(null)
        await reload()
      } catch (err) {
        antdMessage.error(`图标保存失败：${err instanceof Error ? err.message : String(err)}`)
        await reload()
      } finally {
        setIconSaving(false)
      }
    },
    [iconEditorFor, reload],
  )

  /** CAS 类操作统一收口：失败时提示并刷新列表（revision 可能已过期）。 */
  const withBusy = useCallback(
    async (appId: string, action: () => Promise<unknown>): Promise<void> => {
      setBusyAppId(appId)
      try {
        await action()
        notifySubAppDirectoryChanged()
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

  /** 归档/删除为破坏性操作：收进「更多操作」菜单后无法再用 Popconfirm 包裹，统一走 Modal.confirm 二次确认。 */
  const confirmArchive = useCallback(
    (app: SubAppSummary): void => {
      AntdModal.confirm({
        title: '归档此应用？',
        content: '归档后从列表主视图隐藏，可在此页开启「归档」筛选后查看。',
        okText: '归档',
        cancelText: '取消',
        onOk: () => handleArchive(app),
      })
    },
    [handleArchive],
  )

  const confirmDelete = useCallback(
    (app: SubAppSummary): void => {
      AntdModal.confirm({
        title: '删除此应用？',
        content: '将永久删除源码、全部版本与应用数据，不可恢复。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => handleDelete(app),
      })
    },
    [handleDelete],
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

  const handleDeleteRelease = useCallback(
    (release: SubAppReleaseSummary): Promise<void> => {
      if (releasesFor == null || release.isPublished) return Promise.resolve()
      const app = releasesFor
      return withBusy(app.id, async () => {
        await subAppClient.deleteRelease({
          appId: app.id,
          releaseVersion: release.version,
        })
        setReleases((current) => current?.filter((item) => item.id !== release.id) ?? null)
        antdMessage.success(`已删除 ${app.name} v${release.version}`)
      })
    },
    [releasesFor, withBusy],
  )

  return (
    <div className="sub-apps-view" data-testid="sub-apps-view">
      {/* macOS 下头部整条承担系统窗口拖拽（见 SubAppsView.less），双击触发最大化，
          与 App.tsx 跳过公用 MacWindowDragHeader 的逻辑配套。 */}
      <header
        className="sa-header"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
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
              type="text"
              icon={<Icons.Refresh size={15} />}
              aria-label="刷新"
              loading={loading}
              onClick={() => void reload()}
            >
              刷新
            </Button>
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

              // 低频操作收进「更多操作」菜单，卡片平铺区只保留 打开/发布/版本 三个常用入口。
              const moreMenu = {
                items: [
                  {
                    key: 'preview',
                    label: (
                      <span className="sa-card-menu-item">
                        <Icons.Eye size={14} /> 草稿预览
                      </span>
                    ),
                    onClick: () => openApp(app, 'draft'),
                  },
                  {
                    key: 'icon',
                    label: (
                      <span className="sa-card-menu-item">
                        <Icons.Image size={14} /> 修改图标
                      </span>
                    ),
                    onClick: () => setIconEditorFor(app),
                  },
                  ...(app.surface === 'overlay' || app.surface === 'panel'
                    ? [
                        {
                          key: 'surface',
                          label: (
                            <span className="sa-card-menu-item">
                              <Icons.Box size={14} />{' '}
                              {app.surface === 'overlay' ? '以浮层运行' : '以侧栏运行'}
                            </span>
                          ),
                          onClick: () => void openSurface(app),
                        },
                      ]
                    : []),
                  { type: 'divider' as const },
                  ...(app.publicationStatus === 'archived'
                    ? []
                    : [
                        {
                          key: 'archive',
                          label: (
                            <span className="sa-card-menu-item">
                              <Icons.Archive size={14} /> 归档
                            </span>
                          ),
                          onClick: () => confirmArchive(app),
                        },
                      ]),
                  {
                    key: 'delete',
                    label: (
                      <span className="sa-card-menu-item">
                        <Icons.Trash size={14} /> 删除
                      </span>
                    ),
                    danger: true,
                    onClick: () => confirmDelete(app),
                  },
                ],
              }
              return (
                <div
                  key={app.id}
                  className={`sa-card sa-card-${app.surface}`}
                  data-testid="sub-app-card"
                >
                  <div className="sa-card-top">
                    <span className="sa-card-icon" aria-hidden>
                      <SubAppIcon icon={app.icon} size={20} />
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
                    <div className="sa-card-action-main">
                      <Button size="small" type="text" disabled={busy} onClick={() => openApp(app)}>
                        打开
                      </Button>
                      <Popconfirm
                        title="发布当前草稿？"
                        description={`将以草稿 revision ${app.draftRevision} 生成新版本，发布后不可修改。`}
                        okText="发布"
                        cancelText="取消"
                        onConfirm={() => void handlePublish(app)}
                      >
                        <Button
                          size="small"
                          type="text"
                          disabled={busy || app.publicationStatus === 'archived'}
                        >
                          发布
                        </Button>
                      </Popconfirm>
                      <Button
                        size="small"
                        type="text"
                        disabled={busy}
                        onClick={() => openReleases(app)}
                      >
                        版本
                      </Button>
                    </div>
                    <div className="sa-card-action-secondary">
                      <Dropdown menu={moreMenu} trigger={['click']} placement="bottomRight">
                        <Button size="small" type="text" disabled={busy} title="更多操作">
                          <Icons.More size={16} />
                        </Button>
                      </Dropdown>
                    </div>
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
                <div className="sa-release-actions">
                  <Button
                    size="small"
                    type="text"
                    onClick={() => void handleRollback(rel.version)}
                    loading={busyAppId === releasesFor?.id}
                  >
                    回滚
                  </Button>
                  {rel.isPublished ? (
                    <span className="sa-release-current">当前生效</span>
                  ) : (
                    <Popconfirm
                      title={`删除 v${rel.version}？`}
                      description="删除后不能恢复，但不会影响当前生效版本。"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => void handleDeleteRelease(rel)}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        disabled={busyAppId === releasesFor?.id}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  )}
                </div>
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

      <Modal
        title={iconEditorFor == null ? '设置应用图标' : `设置「${iconEditorFor.name}」图标`}
        open={iconEditorFor != null}
        onCancel={() => setIconEditorFor(null)}
        footer={null}
        width={440}
      >
        <div className="sa-icon-editor">
          <p>选择内置图标或 Emoji。未知的旧文本图标会自动显示为默认应用图标。</p>
          <div className="sa-icon-picker" role="listbox" aria-label="应用图标">
            {SUB_APP_ICON_OPTIONS.map((option) => {
              const selected = (iconEditorFor?.icon ?? null) === option.value
              return (
                <button
                  key={option.value ?? 'default'}
                  type="button"
                  className={`sa-icon-option${selected ? ' is-selected' : ''}`}
                  disabled={iconSaving}
                  aria-label={option.label}
                  aria-selected={selected}
                  onClick={() => void handleIconChange(option.value)}
                >
                  <span className="sa-icon-option-glyph" aria-hidden>
                    <SubAppIcon icon={option.value} size={22} />
                  </span>
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
    </div>
  )
}
