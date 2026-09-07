import { useState } from 'react'
import { Modal, Radio, Typography } from 'antd'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import type { WorkflowItem } from '@spark/protocol'

/**
 * 工作流导出弹窗:同一入口提供两种格式 ——
 *  1. 仅流程图 JSON(兼容旧版,与旧导出文件互认)
 *  2. 完整工作流包 .sparkflow(流程图 + 随包技能 + 脱敏 MCP 配置 + 校验和)
 */

export type WorkflowExportFormat = 'json' | 'bundle'

export function WorkflowExportModal({
  open,
  workflowIds,
  workflows,
  onClose,
}: {
  open: boolean
  /** 要导出的工作流 id;空数组 = 全部自建工作流 */
  workflowIds: string[]
  workflows: WorkflowItem[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const { invoke: saveFileDialog } = useIpcInvoke('dialog:save-file')
  const { invoke: writeTextFile } = useIpcInvoke('file:write-text')
  const { invoke: exportBundle } = useIpcInvoke('workflow-bundle:export')

  const [format, setFormat] = useState<WorkflowExportFormat>('bundle')
  const [exporting, setExporting] = useState(false)

  const targets =
    workflowIds.length > 0
      ? workflows.filter((workflow) => workflowIds.includes(workflow.id))
      : workflows

  const handleExport = async () => {
    if (targets.length === 0) {
      toast.warning('没有可导出的工作流')
      onClose()
      return
    }
    setExporting(true)
    try {
      if (format === 'json') {
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          workflows: targets.map((workflow) => ({
            scope: workflow.scope,
            version: workflow.version,
            name: workflow.name,
            description: workflow.description,
            status: workflow.status,
            tags: workflow.tags,
            enabled: workflow.enabled,
            graph: workflow.graph,
          })),
        }
        const result = await saveFileDialog({
          title: '导出工作流',
          defaultPath: `workflows-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        if (result.canceled || !result.filePath) return
        await writeTextFile({ path: result.filePath, content: JSON.stringify(payload, null, 2) })
        toast.success(`已导出 ${targets.length} 个工作流(仅流程图)`)
      } else {
        const result = await saveFileDialog({
          title: '导出工作流包',
          defaultPath: `workflows-${new Date().toISOString().slice(0, 10)}.sparkflow`,
          filters: [{ name: 'SparkFlow 工作流包', extensions: ['sparkflow'] }],
        })
        if (result.canceled || !result.filePath) return
        const exported = await exportBundle({
          workflowIds: targets.map((workflow) => workflow.id),
          outputPath: result.filePath,
        })
        const summary = exported.manifest
        toast.success(
          `已导出工作流包:${summary.workflows.length} 个工作流、${summary.skills.length} 个技能、` +
            `${summary.mcpServers.length} 个 MCP(密钥已脱敏)` +
            (summary.unresolved.length > 0 ? `,${summary.unresolved.length} 项依赖未随包` : ''),
        )
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={() => void handleExport()}
      okText="导出"
      okButtonProps={{ loading: exporting }}
      title="导出工作流"
      width={520}
    >
      <div style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">
          将导出 {targets.length} 个工作流;选择导出格式:
        </Typography.Text>
      </div>
      <Radio.Group
        value={format}
        onChange={(e) => setFormat(e.target.value as WorkflowExportFormat)}
        options={[
          {
            value: 'bundle',
            label: (
              <span>
                <strong>完整工作流包(.sparkflow)</strong>
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  含流程图、随包技能、MCP 配置(密钥脱敏)与校验和;对方导入后即可验证使用
                </Typography.Text>
              </span>
            ),
          },
          {
            value: 'json',
            label: (
              <span>
                <strong>仅流程图(JSON)</strong>
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  兼容旧版;不含技能与 MCP,对方需自行配置依赖
                </Typography.Text>
              </span>
            ),
          },
        ]}
      />
    </Modal>
  )
}
