import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Select } from '@lobehub/ui'
import { useToast } from '../components/Toast'
import { buildLogReadRequest, type LogViewerLevel, type LogViewerScope } from './log-viewer-model'

export function SettingsLogViewer() {
  const { toast } = useToast()
  const [lines, setLines] = useState<string[]>([])
  const [filePath, setFilePath] = useState<string | null>(null)
  const [sizeBytes, setSizeBytes] = useState(0)
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<LogViewerScope>('canvas')
  const [levelFilter, setLevelFilter] = useState<LogViewerLevel>('all')
  const [keyword, setKeyword] = useState('')

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.spark.invoke('log:read', buildLogReadRequest(scope, levelFilter))
      setLines(res.lines)
      setFilePath(res.filePath)
      setSizeBytes(res.sizeBytes)
    } catch (err) {
      toast.error(`读取日志失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [levelFilter, scope, toast])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(), 0)
    return () => window.clearTimeout(timer)
  }, [loadLogs])

  const handleClear = useCallback(async () => {
    try {
      await window.spark.invoke('log:clear', {})
      toast.success('日志已清空')
      void loadLogs()
    } catch (err) {
      toast.error(`清空日志失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [loadLogs, toast])

  const handleExport = useCallback(async () => {
    try {
      const res = await window.spark.invoke('dialog:save-file', {
        title: scope === 'canvas' ? '导出画布任务日志' : '导出日志',
        defaultPath: scope === 'canvas' ? 'spark-canvas-tasks.log' : 'spark-agent.log',
        filters: [{ name: '日志文件', extensions: ['log', 'txt'] }],
      })
      if (res?.filePath) {
        await window.spark.invoke('file:write-text', {
          path: res.filePath,
          content: lines.join('\n'),
        })
        toast.success(`已导出到：${res.filePath}`)
      }
    } catch (err) {
      toast.error(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [lines, scope, toast])

  const handleReveal = useCallback(async () => {
    try {
      await window.spark.invoke('log:reveal', {})
    } catch (err) {
      toast.error(`打开日志目录失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [toast])

  const filteredLines = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return kw ? lines.filter((line) => line.toLowerCase().includes(kw)) : lines
  }, [lines, keyword])

  return (
    <>
      <div className="subsec-h">日志查看器</div>
      <div className="log-viewer-toolbar">
        <Select
          value={scope}
          onChange={(value) => setScope(value as LogViewerScope)}
          options={[
            { label: '画布任务', value: 'canvas' },
            { label: '全部日志', value: 'all' },
          ]}
        />
        <Select
          value={levelFilter}
          onChange={(value) => setLevelFilter(value as LogViewerLevel)}
          options={[
            { label: '全部级别', value: 'all' },
            { label: 'debug', value: 'debug' },
            { label: 'info', value: 'info' },
            { label: 'warn', value: 'warn' },
            { label: 'error', value: 'error' },
          ]}
        />
        <Input
          placeholder={scope === 'canvas' ? '任务 ID / 项目 / 模型…' : '关键词过滤…'}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          allowClear
          style={{ width: 240 }}
        />
        <Button onClick={() => void loadLogs()} loading={loading}>
          刷新
        </Button>
        <div className="log-viewer-spacer" />
        <Button onClick={() => void handleExport()}>导出</Button>
        <Button onClick={() => void handleReveal()}>在文件夹中显示</Button>
        <Button onClick={() => void handleClear()} danger>
          清空
        </Button>
      </div>

      <div className="log-viewer-meta">
        {filePath != null ? (
          <>
            <span className="log-viewer-path" title={filePath}>
              {filePath}
            </span>
            <span className="log-viewer-size">{formatSize(sizeBytes)}</span>
          </>
        ) : (
          <span className="log-viewer-empty">日志文件尚未初始化（应用刚启动时可能暂未落盘）。</span>
        )}
      </div>

      <div className="log-viewer">
        {filteredLines.length === 0 ? (
          <div className="log-viewer-empty">
            {loading
              ? '加载中…'
              : scope === 'canvas'
                ? '暂无画布任务日志。运行节点后点击“刷新”。'
                : '暂无日志记录。'}
          </div>
        ) : (
          filteredLines.map((line, index) => (
            <div key={index} className={`log-line log-${logLineLevel(line)}`}>
              {line}
            </div>
          ))
        )}
      </div>
    </>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function logLineLevel(line: string): 'debug' | 'info' | 'warn' | 'error' | 'default' {
  const level = line.match(/\]\s*\[(DEBUG|INFO|WARN|ERROR)\]\s*\[/)?.[1]?.toLowerCase()
  if (!level) return 'default'
  return level === 'warn' ? 'warn' : (level as 'debug' | 'info' | 'error')
}
