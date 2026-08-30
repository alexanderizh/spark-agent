import { Table, Tag } from 'antd'

import type { CanvasAcceptanceEvidenceEvent } from './canvasAcceptanceEvidence'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'
import {
  buildCanvasAcceptanceMatrixRows,
  type CanvasAcceptanceMatrixRow,
} from './canvasAcceptanceMatrixModel'

export function CanvasAcceptanceMatrixReport({
  plan,
  events,
}: {
  plan: CanvasAcceptancePlan
  events: CanvasAcceptanceEvidenceEvent[]
}) {
  const rows = buildCanvasAcceptanceMatrixRows(plan, events)
  if (rows.length === 0) return null
  return (
    <div className="canvas-panel-section">
      <div className="canvas-panel-title-row">
        <h3>模型矩阵结果</h3>
        <Tag color="blue" bordered>{rows.length} 个对比 Case</Tag>
      </div>
      <Table<CanvasAcceptanceMatrixRow>
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={rows}
        scroll={{ x: 640 }}
        columns={[
          { title: '节点', dataIndex: 'title', width: 190 },
          { title: '渠道', dataIndex: 'providerName', width: 130 },
          { title: '模型', dataIndex: 'modelId', width: 190 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (status: CanvasAcceptanceMatrixRow['status']) => (
              <Tag color={statusColor(status)}>{status}</Tag>
            ),
          },
          {
            title: '证据',
            width: 110,
            render: (_value, row) =>
              row.observabilityGap ? (
                <Tag color="red">证据缺口</Tag>
              ) : row.failedAssertions > 0 ? (
                <Tag color="orange">{row.failedAssertions} 项失败</Tag>
              ) : (
                <Tag color="green">完整</Tag>
              ),
          },
        ]}
      />
    </div>
  )
}

function statusColor(status: CanvasAcceptanceMatrixRow['status']): string {
  if (status === 'passed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'blocked') return 'orange'
  if (status === 'running') return 'blue'
  if (status === 'cancelled') return 'default'
  return 'default'
}
