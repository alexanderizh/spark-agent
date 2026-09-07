import { useState } from 'react'
import { Alert, Button, Dropdown, Modal, Spin, Tag } from 'antd'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import type { WorkflowBundleImportPreview, WorkflowGraph } from '@spark/protocol'

/**
 * 工作流导入入口:下拉二选一 ——
 *  1. 工作流包 .sparkflow(含技能/MCP,先预览再落地到隔离空间)
 *  2. 纯流程图 JSON(兼容旧版,行为与旧导入一致)
 */

const VERIFICATION_TAG: Record<string, { color: string; text: string }> = {
  passed: { color: 'green', text: '导出时校验通过' },
  warned: { color: 'orange', text: '导出时有警告' },
  failed: { color: 'red', text: '导出时校验失败' },
  unverified: { color: 'default', text: '未校验' },
}

export function WorkflowBundleImportButton({ onImported }: { onImported: () => void }) {
  const { toast } = useToast()
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: readTextFile } = useIpcInvoke('file:read-text')
  const { invoke: createWorkflow } = useIpcInvoke('workflow:create')
  const { invoke: previewImport } = useIpcInvoke('workflow-bundle:preview-import')
  const { invoke: importBundle } = useIpcInvoke('workflow-bundle:import')

  const [preview, setPreview] = useState<WorkflowBundleImportPreview | null>(null)
  const [previewPath, setPreviewPath] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  const closePreview = () => {
    setPreview(null)
    setPreviewPath('')
  }

  const pickFile = async (extensions: string[]): Promise<string | null> => {
    const result = await openFileDialog({
      title: '导入工作流',
      filters: [{ name: extensions.join('/').toUpperCase(), extensions }],
    })
    const filePath = result.filePaths?.[0] ?? result.filePath
    if (result.canceled || !filePath) return null
    return filePath
  }

  const importJson = async () => {
    try {
      const filePath = await pickFile(['json'])
      if (filePath == null) return
      const file = await readTextFile({ path: filePath })
      const parsed = JSON.parse(file.content) as { workflows?: unknown }
      const records = Array.isArray(parsed.workflows) ? parsed.workflows : []
      if (records.length === 0) {
        toast.warning('未找到可导入的工作流')
        return
      }
      for (const workflow of records) {
        const w = workflow as Record<string, unknown>
        const rawGraph = w.graph as { nodes?: unknown; edges?: unknown } | undefined
        const graph: WorkflowGraph =
          rawGraph != null && Array.isArray(rawGraph.nodes) && Array.isArray(rawGraph.edges)
            ? (rawGraph as unknown as WorkflowGraph)
            : { nodes: [], edges: [] }
        await createWorkflow({
          ...(typeof w.scope === 'string' && w.scope.trim().length > 0 ? { scope: w.scope } : {}),
          ...(typeof w.version === 'string' && w.version.trim().length > 0
            ? { version: w.version }
            : {}),
          name: typeof w.name === 'string' && w.name.trim().length > 0 ? w.name : '导入的工作流',
          description: typeof w.description === 'string' ? w.description : '',
          status: w.status === 'active' || w.status === 'archived' ? w.status : 'draft',
          tags: Array.isArray(w.tags)
            ? w.tags.filter((t): t is string => typeof t === 'string')
            : [],
          enabled: typeof w.enabled === 'boolean' ? w.enabled : true,
          graph,
        })
      }
      toast.success(`已导入 ${records.length} 个工作流`)
      onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入工作流失败')
    }
  }

  const openBundlePreview = async () => {
    try {
      const filePath = await pickFile(['sparkflow', 'zip'])
      if (filePath == null) return
      setPreviewLoading(true)
      const { preview: result } = await previewImport({ filePath })
      setPreviewPath(filePath)
      setPreview(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取工作流包失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  const confirmImport = async () => {
    if (preview == null) return
    setImporting(true)
    try {
      const { result } = await importBundle({ filePath: previewPath })
      toast.success(
        `已导入工作流包:${result.workflowIds.length} 个工作流、${result.installedSkillIds.length} 个技能、` +
          `${result.importedMcpServerIds.length} 个 MCP(未激活)`,
      )
      closePreview()
      onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入工作流包失败')
    } finally {
      setImporting(false)
    }
  }

  const verification =
    preview != null ? VERIFICATION_TAG[preview.manifest.verification?.status ?? 'unverified'] : null

  return (
    <>
      <Dropdown
        menu={{
          items: [
            {
              key: 'bundle',
              icon: <Icons.Package size={12} />,
              label: '工作流包(.sparkflow,含技能与 MCP)',
            },
            { key: 'json', icon: <Icons.FileText size={12} />, label: '流程图 JSON(兼容旧版)' },
          ],
          onClick: ({ key }) => {
            if (key === 'bundle') void openBundlePreview()
            if (key === 'json') void importJson()
          },
        }}
        trigger={['click']}
      >
        <Button size="middle" type="text" icon={<Icons.Upload size={12} />}>
          导入
        </Button>
      </Dropdown>

      <Modal
        open={preview != null}
        onCancel={closePreview}
        title="导入工作流包 — 依赖预览"
        width={640}
        okText="确认导入"
        okButtonProps={{ loading: importing, disabled: preview != null && !preview.integrityOk }}
        onOk={() => void confirmImport()}
      >
        {preview == null || previewLoading ? (
          <Spin />
        ) : (
          <div className="wf-bundle-preview">
            {!preview.integrityOk && (
              <Alert
                type="error"
                showIcon
                message="包完整性校验未通过,无法导入"
                description={preview.integrityErrors.slice(0, 5).join(';')}
                style={{ marginBottom: 12 }}
              />
            )}
            <div className="wf-bundle-preview-head">
              <strong>{preview.manifest.name}</strong>
              <Tag>v{preview.manifest.version}</Tag>
              {verification != null && <Tag color={verification.color}>{verification.text}</Tag>}
            </div>
            {preview.manifest.description && (
              <p className="wf-bundle-preview-desc">{preview.manifest.description}</p>
            )}
            <ul className="wf-bundle-preview-list">
              <li>
                工作流 <b>{preview.workflows.length}</b> 个:
                {preview.workflows.map((w) => w.name).join('、')}
              </li>
              <li>
                随包技能 <b>{preview.skills.length}</b> 个(安装到隔离空间,不影响现有技能)
                {preview.skills.length > 0 && (
                  <span className="wf-bundle-preview-sub">
                    {preview.skills.map((s) => s.slug).join('、')}
                  </span>
                )}
              </li>
              <li>
                MCP 配置 <b>{preview.mcpServers.length}</b> 个(导入后默认停用,需补齐密钥再激活)
                {preview.mcpServers.map((m) => (
                  <span key={m.refId} className="wf-bundle-preview-sub">
                    {m.name}
                    {m.requiredSecrets.length > 0 &&
                      ` — 需补密钥:${m.requiredSecrets.map((s) => s.label).join('、')}`}
                    {m.nameConflict && '(注意:已有同名 MCP)'}
                  </span>
                ))}
              </li>
              {preview.unresolved.length > 0 && (
                <li>
                  <Alert
                    type="warning"
                    showIcon
                    message={`${preview.unresolved.length} 项依赖不随包迁移,导入后需手动处理`}
                    description={preview.unresolved
                      .slice(0, 8)
                      .map(
                        (u) =>
                          `${u.type === 'agent' ? 'Agent' : u.type === 'rule' ? '规则' : u.type === 'tool' ? '工具' : u.type === 'skill' ? '技能' : u.type === 'mcp' ? 'MCP' : '依赖'}:${u.name}${u.hint ? `(${u.hint})` : ''}`,
                      )
                      .join(';')}
                  />
                </li>
              )}
            </ul>
          </div>
        )}
      </Modal>
    </>
  )
}
