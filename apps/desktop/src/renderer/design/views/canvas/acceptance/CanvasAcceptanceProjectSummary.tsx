import { useState } from 'react'
import { Alert, Modal, Progress, Space, Tag, message } from 'antd'
import { Button } from '@lobehub/ui'

import { Icons } from '../../../Icons'
import type { CanvasProject } from '../canvas.types'
import { canvasApi } from '../canvas.api'
import { runCanvasAcceptancePlan, type CanvasAcceptanceRunProgress } from './CanvasAcceptanceRunner'
import { CanvasAcceptanceMatrixReport } from './CanvasAcceptanceMatrixReport'
import { CanvasAcceptanceAttemptReport } from './CanvasAcceptanceAttemptReport'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'
import { collectCanvasAcceptanceRetryCaseIds } from './canvasAcceptanceAttemptModel'
import {
  buildCanvasAcceptanceEvidencePath,
  type CanvasAcceptancePersistenceResult,
} from './canvasAcceptancePersistence'
import {
  readCanvasAcceptanceEvidence,
  sanitizeEvidence,
  summarizeCanvasAcceptanceEvidence,
} from './canvasAcceptanceEvidence'

export function CanvasAcceptanceProjectSummary({ project }: { project: CanvasProject }) {
  const [exporting, setExporting] = useState(false)
  const [running, setRunning] = useState(false)
  const [, setEvidenceRevision] = useState(0)
  const [runProgress, setRunProgress] = useState<CanvasAcceptanceRunProgress | null>(null)
  const [persistence, setPersistence] = useState<CanvasAcceptancePersistenceResult | null>(null)
  const latestRun = readLatestRun(project)
  const evidence = latestRun ? readCanvasAcceptanceEvidence(latestRun.runId) : null
  const summary = summarizeCanvasAcceptanceEvidence(evidence?.events ?? [])
  if (!latestRun) return null
  const retryCaseIds = collectCanvasAcceptanceRetryCaseIds(
    latestRun.plan,
    evidence?.events ?? [],
  )
  const expectedEvidencePath = project.rootPath
    ? buildCanvasAcceptanceEvidencePath(project.rootPath, latestRun.runId)
    : null

  const startRun = (options?: { caseIds?: string[]; retryExisting?: boolean }) => {
    const selectedCases = options?.caseIds
      ? latestRun.plan.cases.filter((item) => options.caseIds?.includes(item.caseId))
      : latestRun.plan.cases.filter((item) => item.blockedReasons.length === 0)
    const highCostCases = selectedCases.filter((item) => item.targetKind === 'video').length
    Modal.confirm({
      title: options?.retryExisting ? '重跑失败验收项？' : '开始真实工作流验收？',
      content: `将串行运行 ${selectedCases.length} 个节点，其中 ${highCostCases} 个为视频高成本任务。每次尝试都会创建独立 Attempt，真实调用当前配置的渠道和模型。`,
      okText: '确认真实调用',
      cancelText: '取消',
      onOk: async () => {
        setRunning(true)
        try {
          const results = await runCanvasAcceptancePlan({
            api: canvasApi,
            projectId: project.id,
            boardId: latestRun.boardId,
            plan: latestRun.plan,
            caseNodeIds: latestRun.caseNodeIds,
            project,
            ...(options?.caseIds ? { caseIds: options.caseIds } : {}),
            ...(options?.retryExisting ? { retryExisting: true } : {}),
            onProgress: (progress) => {
              setRunProgress(progress)
              setEvidenceRevision((current) => current + 1)
            },
            onEvidencePersistence: setPersistence,
          })
          const failed = results.filter((item) => item.status === 'failed').length
          const blocked = results.filter((item) => item.status === 'blocked').length
          if (failed > 0) message.error(`验收完成：${failed} 个失败，${blocked} 个阻断`)
          else if (blocked > 0) message.warning(`验收完成：${blocked} 个阻断`)
          else message.success('真实工作流验收完成')
        } catch (error) {
          message.error(error instanceof Error ? error.message : '运行验收失败')
        } finally {
          setRunning(false)
          setEvidenceRevision((current) => current + 1)
        }
      },
    })
  }

  const exportEvidence = async () => {
    setExporting(true)
    try {
      const result = await window.spark.invoke('dialog:save-file', {
        title: '导出无限画布验收证据',
        defaultPath: `${latestRun.runId}.canvas-acceptance.json`,
        filters: [{ name: 'Canvas Acceptance Evidence', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return
      const payload = sanitizeEvidence({
        kind: 'spark.canvas.acceptance-evidence',
        version: 2,
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          title: project.title,
          rootPath: project.rootPath,
        },
        run: latestRun,
        evidence,
      })
      await window.spark.invoke('file:write-text', {
        path: result.filePath,
        content: JSON.stringify(payload, null, 2),
      })
      message.success('验收证据已导出')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出验收证据失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="canvas-panel-section">
      <div className="canvas-panel-title-row">
        <h3>验收运行</h3>
        <Tag color="purple" bordered>
          {latestRun.suite}
        </Tag>
      </div>
      <div className="canvas-project-info-grid">
        <CanvasAcceptanceMetric label="计划 Case" value={latestRun.caseCount} />
        <CanvasAcceptanceMetric label="已采集" value={summary.observedCases} />
        <CanvasAcceptanceMetric label="Attempts" value={summary.totalAttempts} />
        <CanvasAcceptanceMetric label="通过" value={summary.passedCases} />
        <CanvasAcceptanceMetric label="失败" value={summary.failedCases} />
        <CanvasAcceptanceMetric label="运行中" value={summary.runningCases} />
        <CanvasAcceptanceMetric label="证据缺口" value={summary.observabilityGaps} />
      </div>
      <div className="canvas-project-folder-card canvas-project-folder-card-inline">
        <div className="canvas-project-folder-info">
          <span>Run ID</span>
          <strong>{latestRun.runId}</strong>
        </div>
        <Space>
          <Button
            size="middle"
            type="primary"
            icon={<Icons.Play size={14} />}
            loading={running}
            onClick={() => startRun()}
          >
            运行验收
          </Button>
          <Button
            size="middle"
            danger
            disabled={retryCaseIds.length === 0}
            loading={running}
            onClick={() => startRun({ caseIds: retryCaseIds, retryExisting: true })}
          >
            重跑失败 ({retryCaseIds.length})
          </Button>
          <Button
            size="middle"
            icon={<Icons.Download size={14} />}
            loading={exporting}
            onClick={() => void exportEvidence()}
          >
            导出证据
          </Button>
        </Space>
      </div>
      {(persistence?.path || expectedEvidencePath) && (
        <Alert
          type={persistence?.persisted === false ? 'warning' : 'info'}
          showIcon
          message={persistence?.persisted === false ? '项目证据镜像写入失败' : '项目证据自动镜像'}
          description={
            persistence?.persisted === false
              ? `${persistence.error ?? 'unknown_error'}；浏览器本地证据仍保留，可手动导出。`
              : persistence?.path ?? expectedEvidencePath
          }
        />
      )}
      {runProgress && (
        <div>
          <Progress
            percent={Math.round(
              (runProgress.completedCases / Math.max(1, runProgress.totalCases)) * 100,
            )}
            status={running ? 'active' : 'normal'}
          />
          <div>{runProgress.currentCaseId ? `当前：${runProgress.currentCaseId}` : '运行结束'}</div>
        </div>
      )}
      {latestRun.blockedCaseCount > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${latestRun.blockedCaseCount} 个节点在生成计划时被预检阻断`}
          description="请打开对应操作节点查看缺少的 Provider、模型、Manifest 或 Capability；阻断节点不应直接产生真实费用。"
        />
      )}
      {summary.observabilityGaps > 0 && (
        <Alert
          type="error"
          showIcon
          message={`${summary.observabilityGaps} 个 Case 存在证据缺口`}
          description="业务失败与证据缺失会分别记录；请优先补齐 actual request、错误详情或生命周期事件，再重复付费复现。"
        />
      )}
      <CanvasAcceptanceMatrixReport plan={latestRun.plan} events={evidence?.events ?? []} />
      <CanvasAcceptanceAttemptReport plan={latestRun.plan} events={evidence?.events ?? []} />
    </section>
  )
}

function CanvasAcceptanceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="canvas-project-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function readLatestRun(project: CanvasProject): {
  runId: string
  boardId: string
  suite: string
  caseCount: number
  executableCaseCount: number
  blockedCaseCount: number
  highCostCaseCount: number
  caseNodeIds: Record<string, string>
  plan: CanvasAcceptancePlan
} | null {
  const metadata = project.metadata
  if (metadata?.projectKind !== 'acceptance') return null
  const raw = metadata.latestAcceptanceRun
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const latest = raw as Record<string, unknown>
  if (typeof latest.runId !== 'string' || typeof latest.boardId !== 'string') return null
  const plan =
    latest.plan && typeof latest.plan === 'object' && !Array.isArray(latest.plan)
      ? (latest.plan as Record<string, unknown>)
      : null
  if (!plan || !Array.isArray(plan.cases)) return null
  const caseNodeIds =
    latest.caseNodeIds && typeof latest.caseNodeIds === 'object' && !Array.isArray(latest.caseNodeIds)
      ? Object.fromEntries(
          Object.entries(latest.caseNodeIds as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {}
  return {
    runId: latest.runId,
    boardId: latest.boardId,
    suite: typeof latest.suite === 'string' ? latest.suite : 'unknown',
    caseCount: Array.isArray(plan?.cases) ? plan.cases.length : 0,
    executableCaseCount:
      typeof latest.executableCaseCount === 'number' ? latest.executableCaseCount : 0,
    blockedCaseCount:
      typeof latest.blockedCaseCount === 'number' ? latest.blockedCaseCount : 0,
    highCostCaseCount:
      typeof latest.highCostCaseCount === 'number' ? latest.highCostCaseCount : 0,
    caseNodeIds,
    plan: latest.plan as CanvasAcceptancePlan,
  }
}
