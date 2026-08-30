import { Table, Tag } from 'antd'

import type { CanvasAcceptanceEvidenceEvent } from './canvasAcceptanceEvidence'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'
import {
  buildCanvasAcceptanceAttemptRows,
  type CanvasAcceptanceAttemptRow,
} from './canvasAcceptanceAttemptModel'

export function CanvasAcceptanceAttemptReport({
  plan,
  events,
}: {
  plan: CanvasAcceptancePlan
  events: CanvasAcceptanceEvidenceEvent[]
}) {
  const rows = buildCanvasAcceptanceAttemptRows(plan, events)
  if (rows.length === 0) return null
  return (
    <div className="canvas-panel-section">
      <div className="canvas-panel-title-row">
        <h3>Attempt 历史</h3>
        <Tag color="cyan" bordered>{rows.length} 次调用尝试</Tag>
      </div>
      <Table<CanvasAcceptanceAttemptRow>
        size="small"
        rowKey="key"
        dataSource={rows}
        pagination={rows.length > 8 ? { pageSize: 8, size: 'small' } : false}
        scroll={{ x: 720 }}
        columns={[
          { title: '节点', dataIndex: 'title', width: 190 },
          { title: '次数', dataIndex: 'attemptIndex', width: 70, render: (value) => `#${value}` },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (status: CanvasAcceptanceAttemptRow['status']) => (
              <Tag color={statusColor(status)}>{status}</Tag>
            ),
          },
          { title: 'Task ID', dataIndex: 'taskId', width: 210, ellipsis: true },
          {
            title: '证据',
            width: 120,
            render: (_value, row) =>
              row.observabilityGap ? (
                <Tag color="red">证据缺口</Tag>
              ) : row.failedAssertions > 0 ? (
                <Tag color="orange">{row.failedAssertions} 项失败</Tag>
              ) : (
                <Tag color="green">{row.eventCount} 个事件</Tag>
              ),
          },
        ]}
      />
    </div>
  )
}

function statusColor(status: CanvasAcceptanceAttemptRow['status']): string {
  if (status === 'passed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'blocked') return 'orange'
  if (status === 'running') return 'blue'
  return 'default'
}
