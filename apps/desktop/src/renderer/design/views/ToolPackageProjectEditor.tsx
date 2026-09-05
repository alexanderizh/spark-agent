import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Select } from '@lobehub/ui'
import type { ToolPackageDetail, ToolPackageProjectFile } from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'

interface ToolPackageProjectEditorProps {
  detail: ToolPackageDetail
  requestConfirm(input: {
    title: string
    description: string
    confirmText?: string
  }): Promise<boolean>
  onInstalled(): Promise<void>
}

export function ToolPackageProjectEditor({
  detail,
  requestConfirm,
  onInstalled,
}: ToolPackageProjectEditorProps) {
  const [files, setFiles] = useState<ToolPackageProjectFile[]>([])
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { invoke: listFiles } = useIpcInvoke('tool-packages:project-files:list')
  const { invoke: readFile } = useIpcInvoke('tool-packages:project-file:read')
  const { invoke: writeFile } = useIpcInvoke('tool-packages:project-file:write')
  const { invoke: installProject } = useIpcInvoke('tool-packages:project:install')
  const dirty = content !== savedContent

  const loadFile = useCallback(
    async (nextPath: string, force = false) => {
      if (!force && dirty) {
        const confirmed = await requestConfirm({
          title: '放弃未保存的源码修改？',
          description: `切换到 ${nextPath} 会丢弃当前文件的未保存内容。`,
          confirmText: '放弃修改',
        })
        if (!confirmed) return
      }
      setBusy(true)
      setError(null)
      try {
        const response = await readFile({ packageId: detail.package.id, path: nextPath })
        setPath(response.path)
        setContent(response.content)
        setSavedContent(response.content)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '源码读取失败')
      } finally {
        setBusy(false)
      }
    },
    [detail.package.id, dirty, readFile, requestConfirm],
  )

  useEffect(() => {
    let cancelled = false
    void listFiles({ packageId: detail.package.id })
      .then(async (response) => {
        if (cancelled) return
        setFiles(response.files)
        const first =
          response.files.find((file) => file.path === 'spark-tool.json')?.path ??
          response.files[0]?.path
        if (first != null) {
          const file = await readFile({ packageId: detail.package.id, path: first })
          if (cancelled) return
          setPath(file.path)
          setContent(file.content)
          setSavedContent(file.content)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '源码列表读取失败')
      })
    return () => {
      cancelled = true
    }
  }, [detail.package.id, listFiles, readFile])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const options = useMemo(
    () => files.map((file) => ({ label: `${file.path} · ${file.size} B`, value: file.path })),
    [files],
  )

  const save = useCallback(async () => {
    if (!path || !dirty) return
    setBusy(true)
    setError(null)
    try {
      await writeFile({ packageId: detail.package.id, path, content })
      setSavedContent(content)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '源码保存失败')
    } finally {
      setBusy(false)
    }
  }, [content, detail.package.id, dirty, path, writeFile])

  const install = useCallback(async () => {
    if (dirty) {
      setError('请先保存当前文件，再安装不可变版本。')
      return
    }
    const confirmed = await requestConfirm({
      title: '安装受管工程的新版本？',
      description:
        '将重新校验完整工程，并按 spark-tool.json 的版本安装不可变快照；不会覆盖已安装的不同版本。',
      confirmText: '安装版本',
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await installProject({ packageId: detail.package.id })
      await onInstalled()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工程安装失败')
    } finally {
      setBusy(false)
    }
  }, [detail.package.id, dirty, installProject, onInstalled, requestConfirm])

  return (
    <section className="tp_section">
      <div className="tp_sectionHeading">
        <strong>源码工程</strong>
        <span className="tp_muted">{dirty ? '有未保存修改' : '已保存'}</span>
      </div>
      <div className="tp_editorToolbar">
        <Select
          value={path || undefined}
          options={options}
          placeholder="选择工程文件"
          onChange={(value) => void loadFile(value)}
        />
        <Button disabled={!dirty || busy} onClick={() => void save()}>
          保存文件
        </Button>
        <Button type="primary" disabled={dirty || busy} onClick={() => void install()}>
          安装新版本
        </Button>
      </div>
      {error != null && (
        <div className="tp_inlineError" role="alert">
          {error}
        </div>
      )}
      <textarea
        className="tp_sourceEditor"
        aria-label={path ? `编辑 ${path}` : '工具包源码编辑器'}
        disabled={!path || busy}
        spellCheck={false}
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
    </section>
  )
}
