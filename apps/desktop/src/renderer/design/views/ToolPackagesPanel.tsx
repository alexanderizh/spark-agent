import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Select, Tag } from '@lobehub/ui'
import { Empty, Switch, message } from 'antd'
import type {
  ToolEnvironmentVariable,
  ToolPackageDetail,
  ToolPackageDevelopmentStep,
  ToolPackageProjectStepResult,
  ToolPackageSummary,
} from '@spark/protocol'
import { useApp } from '../AppContext'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'

interface ToolPackagesPanelProps {
  /** 打开统一导入入口（本地目录 / 压缩包 / Git 仓库）。 */
  onImport?: () => void
}

export function ToolPackagesPanel({ onImport }: ToolPackagesPanelProps) {
  const { requestConfirm } = useApp()
  const [packages, setPackages] = useState<ToolPackageSummary[]>([])
  const [detail, setDetail] = useState<ToolPackageDetail | null>(null)
  const detailRef = useRef<ToolPackageDetail | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [stepResult, setStepResult] = useState<ToolPackageProjectStepResult | null>(null)
  const [runningStep, setRunningStep] = useState<ToolPackageDevelopmentStep | null>(null)
  const [removing, setRemoving] = useState(false)
  const [loading, setLoading] = useState(true)
  const { invoke: listPackages } = useIpcInvoke('tool-packages:list')
  const { invoke: getPackage } = useIpcInvoke('tool-packages:get')
  const { invoke: runProjectStep } = useIpcInvoke('tool-packages:run-project-step')
  const { invoke: configureEnvironment } = useIpcInvoke('tool-packages:configure-environment')
  const { invoke: requestSecret } = useIpcInvoke('tool-packages:request-secret')
  const { invoke: setPermission } = useIpcInvoke('tool-packages:set-permission')
  const { invoke: setEnabled } = useIpcInvoke('tool-packages:set-enabled')
  const { invoke: uninstallPackage } = useIpcInvoke('tool-packages:uninstall')
  const { invoke: deleteVersion } = useIpcInvoke('tool-packages:delete-version')

  const refresh = useCallback(async () => {
    try {
      const response = await listPackages({})
      setPackages(response.packages)
      const nextId =
        selectedId != null && response.packages.some((item) => item.id === selectedId)
          ? selectedId
          : (response.packages[0]?.id ?? null)
      setSelectedId(nextId)
      if (nextId != null) {
        const currentDetail = detailRef.current
        const result = await getPackage({
          packageId: nextId,
          ...(currentDetail?.package.id === nextId ? { version: currentDetail.version } : {}),
        })
        detailRef.current = result.detail
        setDetail(result.detail)
      } else {
        detailRef.current = null
        setDetail(null)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Tool Package 加载失败')
    } finally {
      setLoading(false)
    }
  }, [getPackage, listPackages, selectedId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IPC completion updates remote state.
    void refresh()
  }, [refresh])

  useIpcStream('stream:tool-packages:changed', () => void refresh())

  const variables = useMemo(
    () =>
      detail?.manifest.environment.map((variable) => ({
        variable,
        status: detail.environment.find((item) => item.name === variable.name),
      })) ?? [],
    [detail],
  )

  const selectPackage = useCallback(
    async (packageId: string) => {
      setDraftValues({})
      try {
        const result = await getPackage({ packageId })
        setSelectedId(packageId)
        detailRef.current = result.detail
        setDetail(result.detail)
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'Tool Package 详情加载失败')
      }
    },
    [getPackage],
  )

  const saveVariable = useCallback(
    async (variable: ToolEnvironmentVariable) => {
      if (detail == null) return
      try {
        const status = detail.environment.find((item) => item.name === variable.name)
        await configureEnvironment({
          packageId: detail.package.id,
          version: detail.version,
          name: variable.name,
          value: parseEnvironmentValue(
            variable,
            resolveDraftValue(variable, status?.value, draftValues),
          ),
        })
        setDraftValues((current) => {
          const next = { ...current }
          delete next[variable.name]
          return next
        })
        message.success(`${variable.title} 已保存`)
        await refresh()
      } catch (error) {
        message.error(error instanceof Error ? error.message : '环境变量保存失败')
      }
    },
    [configureEnvironment, detail, draftValues, refresh],
  )

  const beginSecretInput = useCallback(
    async (variable: ToolEnvironmentVariable) => {
      if (detail == null) return
      try {
        await requestSecret({
          packageId: detail.package.id,
          version: detail.version,
          name: variable.name,
        })
      } catch (error) {
        message.error(error instanceof Error ? error.message : '无法发起安全配置')
      }
    },
    [detail, requestSecret],
  )

  const selectVersion = useCallback(
    async (version: string) => {
      if (detail == null) return
      setDraftValues({})
      try {
        const result = await getPackage({ packageId: detail.package.id, version })
        detailRef.current = result.detail
        setDetail(result.detail)
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'Tool Package 版本加载失败')
      }
    },
    [detail, getPackage],
  )

  const changePermission = useCallback(
    async (permission: ToolPackageDetail['permissions'][number], state: 'granted' | 'denied') => {
      if (detail == null) return
      try {
        await setPermission({
          packageId: detail.package.id,
          version: detail.version,
          kind: permission.kind,
          permission: permission.permission,
          state,
        })
        await refresh()
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'Tool Package 权限更新失败')
      }
    },
    [detail, refresh, setPermission],
  )

  const changeEnabled = useCallback(
    async (enabled: boolean) => {
      if (detail == null) return
      if (enabled) {
        const confirmed = await requestConfirm({
          title: `启用 ${detail.package.name}？`,
          description:
            'trusted-local 工具进程拥有当前用户权限。manifest 中的 OS 行为是告知项，不是操作系统沙箱；Spark Capability 会按授权强制拦截。',
          confirmText: '启用工具包',
        })
        if (!confirmed) return
      }
      try {
        await setEnabled({
          packageId: detail.package.id,
          version: enabled ? detail.version : null,
        })
        await refresh()
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'Tool Package 状态更新失败')
      }
    },
    [detail, refresh, requestConfirm, setEnabled],
  )

  const removePackage = useCallback(async () => {
    if (detail == null) return
    if (detail.package.enabledVersion != null) {
      message.warning('请先停用工具包，再执行卸载')
      return
    }
    const confirmed = await requestConfirm({
      title: `卸载 ${detail.package.name}？`,
      description: `将永久删除全部 ${detail.package.versions.length} 个不可变版本（${detail.package.versions.join('、')}）与已配置的 Keychain 密钥，数据库记录一并清除，无法恢复。`,
      confirmText: '卸载工具包',
    })
    if (!confirmed) return
    let removeManagedProject = false
    if (detail.package.source === 'managed-project') {
      removeManagedProject = await requestConfirm({
        title: '同时删除受管工程源码？',
        description:
          '保留受管工程源码时可以继续开发并重新安装；删除后源码目录（tool-projects）不可恢复。选择取消则仅卸载已安装版本。',
        confirmText: '删除源码',
      })
    }
    setRemoving(true)
    try {
      const response = await uninstallPackage({
        packageId: detail.package.id,
        ...(removeManagedProject ? { removeManagedProject: true } : {}),
      })
      message.success(
        `已卸载 ${response.result.packageId}：移除 ${response.result.removedVersions.length} 个版本、清理 ${response.result.removedSecrets} 个密钥`,
      )
      setDraftValues({})
      setStepResult(null)
      detailRef.current = null
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Tool Package 卸载失败')
    } finally {
      setRemoving(false)
    }
  }, [detail, refresh, requestConfirm, uninstallPackage])

  const removeVersion = useCallback(async () => {
    if (detail == null) return
    const { package: pkg, version } = detail
    if (pkg.enabledVersion === version) {
      message.warning('请先停用该版本，再删除')
      return
    }
    if (pkg.versions.length <= 1) {
      message.warning('最后一个版本只能整体卸载')
      return
    }
    const confirmed = await requestConfirm({
      title: `删除版本 v${version}？`,
      description: `将永久移除 v${version} 的不可变安装快照与数据库记录，无法恢复；其他版本不受影响。`,
      confirmText: '删除版本',
    })
    if (!confirmed) return
    setRemoving(true)
    try {
      await deleteVersion({ packageId: pkg.id, version })
      message.success(`已删除版本 ${version}`)
      detailRef.current = null
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本删除失败')
    } finally {
      setRemoving(false)
    }
  }, [deleteVersion, detail, refresh, requestConfirm])

  const runDevelopmentStep = useCallback(
    async (step: ToolPackageDevelopmentStep) => {
      if (detail == null || detail.package.source !== 'managed-project') return
      const declared =
        step === 'install'
          ? detail.manifest.development?.installCommand
          : detail.manifest.development?.buildCommand
      const commandPreview =
        declared != null && declared.trim().length > 0
          ? declared
          : '按工程 lockfile 推断（pnpm / yarn / bun / npm install）'
      const confirmed = await requestConfirm({
        title: `在受管工程执行「${step === 'install' ? '安装依赖' : '构建'}」？`,
        description: `将执行：${commandPreview}。步骤以 trusted-local 权限在工程目录运行；完成后仍需执行「安装」才会生成新的不可变版本。`,
        confirmText: step === 'install' ? '安装依赖' : '开始构建',
      })
      if (!confirmed) return
      setRunningStep(step)
      setStepResult(null)
      try {
        const response = await runProjectStep({ packageId: detail.package.id, step })
        setStepResult(response.result)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '开发步骤执行失败')
      } finally {
        setRunningStep(null)
      }
    },
    [detail, requestConfirm, runProjectStep],
  )

  if (loading && packages.length === 0) {
    return <div className="ct_loading">正在读取 Tool Packages...</div>
  }
  if (packages.length === 0) {
    return (
      <Empty
        description="还没有安装 Tool Package；可从本地目录、压缩包或 Git 仓库导入，也可让 Agent 创建"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        {onImport != null && (
          <Button type="primary" onClick={onImport}>
            导入工具包
          </Button>
        )}
      </Empty>
    )
  }

  return (
    <div style={{ display: 'grid', minHeight: 0, gridTemplateColumns: '260px minmax(0, 1fr)' }}>
      <div style={{ overflow: 'auto', borderRight: '1px solid var(--border)' }}>
        {packages.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => void selectPackage(item.id)}
            style={{
              display: 'flex',
              width: '100%',
              flexDirection: 'column',
              gap: 5,
              padding: '14px 12px',
              textAlign: 'left',
              color: 'inherit',
              background: item.id === selectedId ? 'var(--hover)' : 'transparent',
              border: 0,
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            <strong style={{ fontSize: 13 }}>{item.name}</strong>
            <code style={{ color: 'var(--text-faint)', fontSize: 11 }}>{item.id}</code>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {item.enabledVersion == null ? '已安装 · 未启用' : `已启用 v${item.enabledVersion}`}
            </span>
          </button>
        ))}
      </div>

      {detail != null && (
        <div style={{ minHeight: 0, overflow: 'auto', padding: '4px 20px 24px' }}>
          <section style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>{detail.package.name}</strong>
              <Tag>{detail.package.trust}</Tag>
              <Tag>v{detail.version}</Tag>
              <Switch
                size="small"
                checked={detail.package.enabledVersion === detail.version}
                onChange={(enabled) => void changeEnabled(enabled)}
              />
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{detail.package.description}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Select
                value={detail.version}
                options={detail.package.versions.map((version) => ({
                  label: version,
                  value: version,
                }))}
                onChange={(version) => void selectVersion(version)}
              />
              <Button
                size="small"
                danger
                loading={removing}
                disabled={detail.package.enabledVersion != null}
                title={
                  detail.package.enabledVersion != null ? '需先停用工具包' : '删除全部版本与密钥'
                }
                onClick={() => void removePackage()}
              >
                卸载工具包
              </Button>
              <Button
                size="small"
                danger
                disabled={
                  removing ||
                  detail.package.enabledVersion === detail.version ||
                  detail.package.versions.length <= 1
                }
                title={
                  detail.package.enabledVersion === detail.version
                    ? '需先停用该版本'
                    : detail.package.versions.length <= 1
                      ? '最后一个版本只能整体卸载'
                      : '删除当前查看的版本'
                }
                onClick={() => void removeVersion()}
              >
                删除此版本
              </Button>
            </div>
            {detail.sourceUrl != null && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  wordBreak: 'break-all',
                }}
              >
                来源：{detail.sourceUrl}
                {detail.sourceRef != null ? ` @ ${detail.sourceRef}` : ''}
                {detail.sourceSubdirectory != null ? ` /${detail.sourceSubdirectory}` : ''}
              </p>
            )}
          </section>

          {detail.package.source === 'managed-project' && (
            <section style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ fontSize: 13 }}>开发工作流</strong>
              <p style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                步骤在受管工程目录执行，以工程当前 spark-tool.json
                为准；完成后仍需执行「安装」生成新的不可变版本。
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  size="small"
                  disabled={runningStep != null}
                  onClick={() => void runDevelopmentStep('install')}
                >
                  {runningStep === 'install' ? '安装中…' : '安装依赖'}
                </Button>
                <Button
                  size="small"
                  disabled={
                    runningStep != null ||
                    detail.manifest.development?.buildCommand == null ||
                    detail.manifest.development.buildCommand.trim().length === 0
                  }
                  onClick={() => void runDevelopmentStep('build')}
                >
                  {runningStep === 'build' ? '构建中…' : '构建'}
                </Button>
              </div>
              {stepResult != null && detail.package.id === stepResult.packageId && (
                <StepResultView result={stepResult} />
              )}
            </section>
          )}

          <section style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
            <strong style={{ fontSize: 13 }}>环境变量</strong>
            {variables.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>这个版本没有声明环境变量</p>
            ) : (
              variables.map(({ variable, status }) => (
                <div
                  key={variable.name}
                  style={{ padding: '13px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <strong style={{ fontSize: 12 }}>{variable.title}</strong>
                    <code style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                      {variable.name}
                    </code>
                    {variable.required && <Tag color="gold">必填</Tag>}
                    {variable.secret && <Tag color="purple">Keychain</Tag>}
                    <Tag color={status?.source === 'missing' ? 'red' : 'green'}>
                      {status?.source === 'configured'
                        ? '已配置'
                        : status?.source === 'default'
                          ? '使用默认值'
                          : '未配置'}
                    </Tag>
                  </div>
                  {variable.description && (
                    <p style={{ margin: '6px 0', color: 'var(--text-muted)', fontSize: 11 }}>
                      {variable.description}
                    </p>
                  )}
                  {variable.secret ? (
                    <Button size="small" onClick={() => void beginSecretInput(variable)}>
                      {status?.configured ? '更新密钥' : '安全配置'}
                    </Button>
                  ) : variable.type === 'boolean' ? (
                    <Switch
                      checked={resolveDraftValue(variable, status?.value, draftValues) === 'true'}
                      onChange={(checked) =>
                        setDraftValues((current) => ({
                          ...current,
                          [variable.name]: String(checked),
                        }))
                      }
                      onClick={(_checked, event) => event.stopPropagation()}
                    />
                  ) : (
                    <div style={{ display: 'flex', maxWidth: 620, gap: 8, marginTop: 8 }}>
                      <Input
                        value={resolveDraftValue(variable, status?.value, draftValues)}
                        placeholder={
                          variable.default === undefined
                            ? `输入 ${variable.type} 值`
                            : `默认：${stringifyDefault(variable.default)}`
                        }
                        onChange={(event) =>
                          setDraftValues((current) => ({
                            ...current,
                            [variable.name]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        disabled={!Object.prototype.hasOwnProperty.call(draftValues, variable.name)}
                        onClick={() => void saveVariable(variable)}
                      >
                        保存
                      </Button>
                    </div>
                  )}
                  {variable.type === 'boolean' && (
                    <Button
                      size="small"
                      style={{ marginLeft: 8 }}
                      onClick={() => void saveVariable(variable)}
                    >
                      保存
                    </Button>
                  )}
                </div>
              ))
            )}
          </section>

          <section style={{ padding: '16px 0' }}>
            <strong style={{ fontSize: 13 }}>权限与行为声明</strong>
            {detail.permissions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>没有声明额外权限</p>
            ) : (
              detail.permissions.map((permission) => (
                <div
                  key={`${permission.kind}:${permission.permission}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '11px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <code style={{ flex: 1, fontSize: 11 }}>{permission.permission}</code>
                  <Tag>{permission.kind === 'os-effect' ? 'OS 行为告知' : 'Spark 强制授权'}</Tag>
                  <Tag
                    color={
                      permission.state === 'granted'
                        ? 'green'
                        : permission.state === 'denied'
                          ? 'red'
                          : 'gold'
                    }
                  >
                    {permission.state}
                  </Tag>
                  <Button
                    size="small"
                    onClick={async () => {
                      await changePermission(permission, 'granted')
                    }}
                  >
                    允许
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={async () => {
                      await changePermission(permission, 'denied')
                    }}
                  >
                    拒绝
                  </Button>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function StepResultView({ result }: { result: ToolPackageProjectStepResult }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12 }}>{result.step === 'install' ? '安装依赖' : '构建'}</strong>
        <code style={{ fontSize: 11, color: 'var(--text-faint)' }}>{result.command}</code>
        <Tag color={result.timedOut ? 'gold' : result.exitCode === 0 ? 'green' : 'red'}>
          {result.timedOut ? '超时终止' : `exit ${result.exitCode ?? '—'}`}
        </Tag>
        <Tag>{result.inferred ? '推断命令' : '声明命令'}</Tag>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {(result.durationMs / 1000).toFixed(1)}s{result.truncated ? ' · 输出已截断' : ''}
        </span>
      </div>
      {result.stdout.length > 0 && <pre style={stepOutputStyle}>{result.stdout}</pre>}
      {result.stderr.length > 0 && (
        <pre style={{ ...stepOutputStyle, color: 'var(--text-muted)' }}>{result.stderr}</pre>
      )}
    </div>
  )
}

const stepOutputStyle = {
  maxHeight: 180,
  overflow: 'auto',
  margin: '10px 0 0',
  padding: 10,
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'var(--hover)',
  borderRadius: 4,
} as const

function resolveDraftValue(
  variable: ToolEnvironmentVariable,
  configuredValue: unknown,
  drafts: Record<string, string>,
): string {
  if (Object.prototype.hasOwnProperty.call(drafts, variable.name)) {
    return drafts[variable.name] ?? ''
  }
  const value = configuredValue !== undefined ? configuredValue : variable.default
  return value === undefined ? '' : stringifyDefault(value)
}

function parseEnvironmentValue(variable: ToolEnvironmentVariable, value: string): unknown {
  if (variable.type === 'string') return value
  if (variable.type === 'boolean') return value === 'true'
  if (variable.type === 'number' || variable.type === 'integer') {
    if (value.trim().length === 0) throw new Error(`${variable.title} 不能为空`)
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`${variable.title} 必须是数字`)
    return parsed
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`${variable.title} 必须是合法 JSON`)
  }
}

function stringifyDefault(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
