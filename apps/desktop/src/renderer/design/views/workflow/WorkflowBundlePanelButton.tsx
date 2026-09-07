import { useCallback, useState } from 'react'
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import type { WorkflowBundleRecord, WorkflowBundleValidateResult } from '@spark/protocol'

/**
 * 工作流包管理入口:抽屉内列出已导入的 .sparkflow 包,
 * 支持验证徽章复验、包内 MCP 补密钥激活、卸载整包。
 */

const VERIFICATION_BADGE: Record<string, { color: string; text: string }> = {
  passed: { color: 'green', text: '已验证' },
  warned: { color: 'orange', text: '有警告' },
  failed: { color: 'red', text: '验证失败' },
  unverified: { color: 'default', text: '未验证' },
}

interface ActivatingSecret {
  bundleId: string
  serverId: string
  serverName: string
  secretPaths: string[]
}

export function WorkflowBundlePanelButton() {
  const { toast } = useToast()
  const { invoke: listBundles, loading: listLoading } = useIpcInvoke('workflow-bundle:list')
  const { invoke: validateBundle } = useIpcInvoke('workflow-bundle:validate')
  const { invoke: uninstallBundle } = useIpcInvoke('workflow-bundle:uninstall')
  const { invoke: activateMcp } = useIpcInvoke('workflow-bundle:activate-mcp')
  const { invoke: updateMcp } = useIpcInvoke('mcp:update')
  const { invoke: listMcpServers } = useIpcInvoke('mcp:list')

  const [open, setOpen] = useState(false)
  const [bundles, setBundles] = useState<WorkflowBundleRecord[]>([])
  const [validateResult, setValidateResult] = useState<WorkflowBundleValidateResult | null>(null)
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [activating, setActivating] = useState<ActivatingSecret | null>(null)
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      const { bundles: rows } = await listBundles({})
      setBundles(rows)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取工作流包列表失败')
    }
  }, [listBundles, toast])

  const openPanel = () => {
    setOpen(true)
    setValidateResult(null)
    void refresh()
  }

  const runValidate = async (bundleId: string) => {
    setValidatingId(bundleId)
    try {
      const { result } = await validateBundle({ bundleId })
      setValidateResult(result)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '验证失败')
    } finally {
      setValidatingId(null)
    }
  }

  const startActivate = (bundle: WorkflowBundleRecord, server: { id: string; name: string }) => {
    const manifestServer = bundle.manifest.mcpServers.find((m) => m.name === server.name)
    setActivating({
      bundleId: bundle.id,
      serverId: server.id,
      serverName: server.name,
      secretPaths: manifestServer?.requiredSecrets.map((s) => s.path) ?? [],
    })
    setSecretValues({})
  }

  const confirmActivate = async () => {
    if (activating == null) return
    try {
      if (activating.secretPaths.length > 0) {
        // 读取当前 config(含占位符),把占位符替换为用户输入后保存
        const { servers } = await listMcpServers({})
        const row = servers.find((s) => s.id === activating.serverId)
        let configText = row?.configJson ?? '{}'
        for (const path of activating.secretPaths) {
          const value = secretValues[path]
          if (value == null || value.trim().length === 0) {
            toast.warning(`请填写密钥:${path}`)
            return
          }
          configText = configText.replaceAll(`{{secret:${path}}}`, escapeReplacement(value.trim()))
        }
        await updateMcp({ id: activating.serverId, configJson: configText })
      }
      const result = await activateMcp({
        bundleId: activating.bundleId,
        mcpServerId: activating.serverId,
      })
      if (result.missingSecrets.length > 0) {
        toast.warning(`仍有未补齐的密钥:${result.missingSecrets.join('、')}`)
      } else if (result.started) {
        toast.success(`MCP「${activating.serverName}」已激活并启动`)
      } else {
        toast.info(`MCP「${activating.serverName}」已启用,将在下次启动时连接`)
      }
      setActivating(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '激活 MCP 失败')
    }
  }

  const runUninstall = async (bundleId: string) => {
    try {
      await uninstallBundle({ bundleId })
      toast.success('已卸载工作流包(含其工作流、技能与 MCP 配置)')
      setValidateResult(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '卸载失败')
    }
  }

  return (
    <>
      <Button size="middle" type="text" icon={<Icons.Package size={12} />} onClick={openPanel}>
        工作流包
      </Button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span>
            <Icons.Package size={14} /> 工作流包
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              隔离空间:包内技能与 MCP 不影响现有环境
            </Typography.Text>
          </span>
        }
        width={520}
      >
        {listLoading && bundles.length === 0 ? (
          <Spin />
        ) : bundles.length === 0 ? (
          <Empty description="还没有导入工作流包;通过「导入 → 工作流包(.sparkflow)」添加" />
        ) : (
          <div className="wf-bundle-list">
            {bundles.map((bundle) => {
              const badge = VERIFICATION_BADGE[bundle.verificationStatus] ?? {
                color: 'default',
                text: '未验证',
              }
              return (
                <div key={bundle.id} className="wf-bundle-card">
                  <div className="wf-bundle-card-head">
                    <strong>{bundle.name}</strong>
                    <Tag>v{bundle.version}</Tag>
                    <Tag color={badge.color}>{badge.text}</Tag>
                  </div>
                  {bundle.description && (
                    <div className="wf-bundle-card-desc">{bundle.description}</div>
                  )}
                  <div className="wf-bundle-card-meta">
                    {bundle.workflowCount} 个工作流 · {bundle.skillCount} 个技能 ·{' '}
                    {bundle.mcpServerCount} 个 MCP
                  </div>
                  {bundle.mcpServers.length > 0 && (
                    <div className="wf-bundle-card-mcp">
                      {bundle.mcpServers.map((server) => (
                        <div key={server.id} className="wf-bundle-card-mcp-row">
                          <span>{server.name}</span>
                          {server.enabled ? (
                            <Tag color="green">已启用</Tag>
                          ) : (
                            <Button size="small" onClick={() => startActivate(bundle, server)}>
                              激活
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <Space className="wf-bundle-card-actions">
                    <Button
                      size="small"
                      loading={validatingId === bundle.id}
                      onClick={() => void runValidate(bundle.id)}
                    >
                      验证此包
                    </Button>
                    <Popconfirm
                      title="卸载整包?"
                      description="将移除包内全部工作流、技能与 MCP 配置,不可恢复。"
                      okText="卸载"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void runUninstall(bundle.id)}
                    >
                      <Button size="small" danger>
                        卸载
                      </Button>
                    </Popconfirm>
                  </Space>
                  {validateResult?.bundleId === bundle.id && (
                    <div className="wf-bundle-card-checks">
                      {validateResult.checks.map((check) => (
                        <div key={check.id} className="wf-bundle-card-check">
                          <Tag
                            color={check.ok ? 'green' : check.level === 'warn' ? 'orange' : 'red'}
                          >
                            {check.ok ? '通过' : check.level === 'warn' ? '警告' : '失败'}
                          </Tag>
                          <span>{check.message ?? check.id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Drawer>

      <Modal
        open={activating != null}
        onCancel={() => setActivating(null)}
        onOk={() => void confirmActivate()}
        okText={activating != null && activating.secretPaths.length > 0 ? '补齐并激活' : '激活'}
        title={activating != null ? `激活 MCP「${activating.serverName}」` : ''}
      >
        {activating != null && activating.secretPaths.length > 0 ? (
          <div>
            <Alert
              type="info"
              showIcon
              message="该 MCP 配置包含密钥占位符,导出时已脱敏;请补填后激活。密钥仅保存在本机。"
              style={{ marginBottom: 12 }}
            />
            {activating.secretPaths.map((path) => (
              <div key={path} style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {path}
                </Typography.Text>
                <Input.Password
                  placeholder={`填写 ${path}`}
                  value={secretValues[path] ?? ''}
                  onChange={(e) => setSecretValues((prev) => ({ ...prev, [path]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        ) : (
          <span>确认启用该 MCP 并尝试连接?</span>
        )}
      </Modal>
    </>
  )
}

/** 替换 JSON 字符串中的占位符时转义 $ 等替换模式特殊字符。 */
function escapeReplacement(value: string): string {
  return value.replace(/\$/g, '$$$$')
}
