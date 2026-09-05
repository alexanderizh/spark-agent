import { useMemo, useState } from 'react'
import { Button, Modal, TextArea } from '@lobehub/ui'
import { Checkbox } from 'antd'
import { useIpcInvoke } from '../hooks/useIpc'
import { parseOpenApiToEditorDrafts, type OpenApiImportResult } from './openapi-custom-tool-import'
import type { CustomToolEditorDraft } from './custom-tools-model'

interface CustomToolOpenApiImportModalProps {
  open: boolean
  onCancel: () => void
  onImport: (editors: CustomToolEditorDraft[]) => Promise<void>
}

export function CustomToolOpenApiImportModal({
  open,
  onCancel,
  onImport,
}: CustomToolOpenApiImportModalProps) {
  const [source, setSource] = useState('')
  const [result, setResult] = useState<OpenApiImportResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: readTextFile } = useIpcInvoke('file:read-text')

  const selectedEditors = useMemo(
    () =>
      result?.operations
        .filter((operation) => selected.has(operation.key) && operation.editor != null)
        .map((operation) => operation.editor as CustomToolEditorDraft) ?? [],
    [result, selected],
  )

  const parse = (nextSource: string) => {
    try {
      const next = parseOpenApiToEditorDrafts(nextSource)
      setResult(next)
      setSelected(
        new Set(
          next.operations
            .filter((operation) => operation.editor != null)
            .map((operation) => operation.key),
        ),
      )
      setError(null)
    } catch (parseError) {
      setResult(null)
      setSelected(new Set())
      setError(parseError instanceof Error ? parseError.message : 'OpenAPI 解析失败')
    }
  }

  const chooseFile = async () => {
    try {
      const selectedFile = await openFileDialog({
        title: '选择 OpenAPI 规范',
        filters: [{ name: 'OpenAPI JSON / YAML', extensions: ['json', 'yaml', 'yml'] }],
      })
      const path = selectedFile.filePaths?.[0] ?? selectedFile.filePath
      if (selectedFile.canceled || path == null) return
      const file = await readTextFile({ path })
      setSource(file.content)
      parse(file.content)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'OpenAPI 文件读取失败')
    }
  }

  return (
    <Modal
      open={open}
      width={760}
      title="导入 OpenAPI"
      onCancel={onCancel}
      footer={
        <div className="ct_modal_actions">
          <Button onClick={onCancel}>取消</Button>
          {result == null ? (
            <Button
              type="primary"
              disabled={source.trim().length === 0}
              onClick={() => parse(source)}
            >
              解析规范
            </Button>
          ) : (
            <Button
              type="primary"
              loading={importing}
              disabled={selectedEditors.length === 0}
              onClick={async () => {
                setImporting(true)
                setError(null)
                try {
                  await onImport(selectedEditors)
                } catch (importError) {
                  setError(importError instanceof Error ? importError.message : 'OpenAPI 导入失败')
                } finally {
                  setImporting(false)
                }
              }}
            >
              导入 {selectedEditors.length} 个草稿
            </Button>
          )}
        </div>
      }
    >
      <div className="ct_openapi_import">
        <div className="ct_openapi_intro">
          <p>
            支持 OpenAPI 3.0 / 3.1 与 Swagger 2.0 的 JSON、YAML
            文件。导入结果只保存为待审草稿，不会自动发布。
          </p>
          <Button onClick={() => void chooseFile()}>选择文件</Button>
        </div>
        {result == null ? (
          <TextArea
            className="ct_code_input"
            rows={12}
            value={source}
            placeholder="粘贴 OpenAPI JSON 或 YAML"
            onChange={(event) => {
              setSource(event.target.value)
              setError(null)
            }}
          />
        ) : (
          <div className="ct_openapi_operations">
            <div className="ct_openapi_summary">
              <strong>{result.title}</strong>
              <span>
                {result.version} · {result.operations.length} 个 operation
              </span>
              <button type="button" onClick={() => setResult(null)}>
                返回编辑规范
              </button>
            </div>
            {result.operations.map((operation) => (
              <label
                key={operation.key}
                className={operation.editor == null ? 'is-disabled' : undefined}
              >
                <Checkbox
                  disabled={operation.editor == null}
                  checked={selected.has(operation.key)}
                  onChange={(event) => {
                    const next = new Set(selected)
                    if (event.target.checked) next.add(operation.key)
                    else next.delete(operation.key)
                    setSelected(next)
                  }}
                />
                <code>{operation.method}</code>
                <span>
                  <strong>{operation.title}</strong>
                  <small>{operation.path}</small>
                  {operation.diagnostics.map((diagnostic) => (
                    <small key={diagnostic} className="is-error">
                      {diagnostic}
                    </small>
                  ))}
                  {operation.warnings.map((warning) => (
                    <small key={warning} className="is-warning">
                      {warning}
                    </small>
                  ))}
                </span>
              </label>
            ))}
          </div>
        )}
        {error != null && <div className="ct_schema_error">{error}</div>}
      </div>
    </Modal>
  )
}
