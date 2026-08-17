/**
 * SubAppRunView — 单个子应用运行页（内容区 surface）
 *
 * 读取 AppContext.subAppOpenId，加载应用详情后用 SubAppRunner 挂载沙箱 iframe。
 * 支持在「发布版 / 草稿预览」间切换：发布版不可变，草稿用于开发调试；
 * 发布操作带 revision CAS，成功后就地刷新详情。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Badge, Popconfirm, Segmented, Spin, Switch, message as antdMessage } from 'antd'
import type { SubAppDetails } from '@spark/protocol'
import { subAppClient } from '../sub-app/subAppClient'
import { SubAppRunner } from '../sub-app/SubAppRunner'
import { notifySubAppDirectoryChanged } from '../sub-app/subAppEvents'
import { SubAppIcon } from '../sub-app/SubAppIcon'
import { MacWindowDragHeader } from '../components/MacWindowDragHeader'
import { useApp } from '../AppContext'
import { Icons } from '../Icons'
import './SubAppRunView.less'

type RunMode = 'published' | 'draft'

export function SubAppRunView(): React.ReactElement {
  const { t, setTweak } = useApp()
  const appId = t.subAppOpenId

  const [details, setDetails] = useState<SubAppDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mode, setMode] = useState<RunMode>(t.subAppOpenMode)
  const [publishing, setPublishing] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (appId == null) return
    setLoading(true)
    setErrorMessage(null)
    try {
      const res = await subAppClient.get({ appId })
      setDetails(res)
      // 默认优先运行发布版；未发布过的应用直接进草稿预览。
      setMode((prev) => (prev === 'published' && res.publishedRelease == null ? 'draft' : prev))
    } catch (err) {
      setDetails(null)
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [appId])

  useEffect(() => {
    // 切换应用或首次进入时重置为默认模式，避免上一个应用的偏好带过来。
    setMode(t.subAppOpenMode)
    void reload()
  }, [reload, t.subAppOpenMode])

  const backToList = useCallback((): void => {
    setTweak('subAppOpenId', null)
    setTweak('view', 'sub-apps')
  }, [setTweak])

  const handlePublish = useCallback(async (): Promise<void> => {
    if (details == null) return
    setPublishing(true)
    try {
      const res = await subAppClient.publish({
        appId: details.id,
        expectedDraftRevision: details.draftRevision,
      })
      setDetails(res)
      notifySubAppDirectoryChanged()
      antdMessage.success(`已发布 ${res.name} v${res.publishedVersion ?? ''}`)
    } catch (err) {
      antdMessage.error(`发布失败：${err instanceof Error ? err.message : String(err)}`)
      await reload()
    } finally {
      setPublishing(false)
    }
  }, [details, reload])

  const handleSetEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (details == null) return
      try {
        await subAppClient.setEnabled({ appId: details.id, enabled })
        notifySubAppDirectoryChanged()
        await reload()
      } catch (err) {
        antdMessage.error(`操作失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [details, reload],
  )

  if (appId == null) {
    return (
      <div className="sub-app-run-view" data-testid="sub-app-run-view">
        <div className="sar-missing">
          <p>没有指定要打开的应用</p>
          <Button type="primary" onClick={backToList}>
            返回应用列表
          </Button>
        </div>
      </div>
    )
  }

  const hasPublished = details?.publishedRelease != null
  const runnerSource =
    details == null
      ? null
      : mode === 'published' && details.publishedRelease != null
        ? { source: details.publishedRelease.source, manifest: details.publishedRelease.manifest }
        : { source: details.draft.source, manifest: details.draft.manifest }
  const sourceIsEmpty = runnerSource != null && runnerSource.source.trim().length === 0
  // 已发布的 content 应用是用户真正使用的工作区内容，不再套一层平台运行
  // 工具栏；草稿预览仍保留工具栏，方便切换版本、发布和重载。
  const isPublishedContent = mode === 'published' && hasPublished && details?.surface === 'content'
  const showRuntimeHeader = !isPublishedContent
  // 「已发布 content」模式下本页不渲染 sar-header，macOS 需要自备拖拽条兜底；
  // 渲染期求值（SettingsView 同款写法），避免模块加载早于 spark 注入。
  const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

  return (
    <div
      className={`sub-app-run-view${isPublishedContent ? ' is-published-content' : ''}`}
      data-testid="sub-app-run-view"
    >
      {/* App.tsx 对 sub-app 视图跳过公用 MacWindowDragHeader，由本页 sar-header 承担
       * 拖拽与双击最大化（macOS）。「已发布 content」模式无 header，自渲染拖拽条兜底。 */}
      {isPublishedContent && isPlatformDarwin ? <MacWindowDragHeader /> : null}
      {showRuntimeHeader ? (
        <header
          className="sar-header"
          onDoubleClick={() => {
            window.spark?.invoke('window:maximize', {}).catch(() => {})
          }}
        >
          <div className="sar-header-left">
            <Button
              size="small"
              type="text"
              icon={<Icons.ArrowLeft size={12} />}
              aria-label="返回应用列表"
              title="返回应用列表"
              onClick={backToList}
            >
              列表
            </Button>
            {details != null ? (
              <>
                <span className="sar-icon" aria-hidden>
                  <SubAppIcon icon={details.icon} size={18} />
                </span>
                <div className="sar-title-block">
                  <span className="sar-name" title={details.name}>
                    {details.name}
                  </span>
                  {details.enabled ? (
                    <Badge
                      color="success"
                      text={hasPublished ? `已发布 v${details.publishedVersion ?? '?'}` : '草稿'}
                    />
                  ) : (
                    <Badge color="default" text="已禁用" />
                  )}
                </div>
              </>
            ) : null}
          </div>
          <div className="sar-header-right">
            {details != null ? (
              <>
                <Segmented<RunMode>
                  size="small"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'published', label: '发布版', disabled: !hasPublished },
                    { value: 'draft', label: '草稿预览' },
                  ]}
                />
                <Tooltip
                  title={details.enabled ? '禁用后从菜单隐藏且不可启动' : '启用后在菜单显示'}
                >
                  <Switch
                    size="small"
                    checked={details.enabled}
                    onChange={(checked) => void handleSetEnabled(checked)}
                  />
                </Tooltip>
                <Popconfirm
                  title="发布当前草稿？"
                  description={`将以草稿 revision ${details.draftRevision} 生成新版本，发布后不可修改。`}
                  okText="发布"
                  cancelText="取消"
                  onConfirm={() => void handlePublish()}
                >
                  <Button type="primary" size="small" loading={publishing}>
                    发布
                  </Button>
                </Popconfirm>
                <Tooltip title="重新加载应用">
                  <Button
                    size="small"
                    type="text"
                    icon={<Icons.Refresh size={15} />}
                    aria-label="重新加载应用"
                    onClick={() => void reload()}
                  />
                </Tooltip>
              </>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className="sar-body">
        {loading && details == null && errorMessage == null ? (
          <div className="sar-center">
            <Spin />
          </div>
        ) : null}

        {errorMessage != null ? (
          <div className="sar-center sar-error" role="alert">
            <p>应用加载失败：{errorMessage}</p>
            <div className="sar-error-actions">
              <Button onClick={() => void reload()}>重试</Button>
              <Button onClick={backToList}>返回列表</Button>
            </div>
          </div>
        ) : null}

        {!loading && details == null && errorMessage == null ? (
          <div className="sar-center">
            <p>应用不存在或已被删除</p>
            <Button type="primary" onClick={backToList}>
              返回列表
            </Button>
          </div>
        ) : null}

        {details != null && sourceIsEmpty ? (
          <div className="sar-center sar-empty-source" role="status">
            <p>这个应用还没有可运行的源码。</p>
            <span>请在任意会话中让 Agent 更新该应用草稿后，再回来预览或发布。</span>
            <div className="sar-error-actions">
              <Button type="primary" onClick={() => setTweak('view', 'chat')}>
                去会话修复
              </Button>
              <Button onClick={backToList}>返回列表</Button>
            </div>
          </div>
        ) : null}

        {details != null && runnerSource != null && !sourceIsEmpty ? (
          <SubAppRunner
            appId={details.id}
            manifest={runnerSource.manifest}
            source={runnerSource.source}
            mode={mode}
            release={mode === 'published' ? details.publishedRelease : null}
            className="sar-runner"
          />
        ) : null}
      </div>
    </div>
  )
}
