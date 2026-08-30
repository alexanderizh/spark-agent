import { useState } from 'react'
import { Button, Modal, TextArea } from '@lobehub/ui'
import { parseCurlToEditorDraft, type CustomToolEditorDraft } from './custom-tools-model'

interface CustomToolCurlImportModalProps {
  open: boolean
  onCancel: () => void
  onImport: (editor: CustomToolEditorDraft) => void
}

export function CustomToolCurlImportModal({
  open,
  onCancel,
  onImport,
}: CustomToolCurlImportModalProps) {
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parse = () => {
    try {
      onImport(parseCurlToEditorDraft(source))
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'cURL 解析失败')
    }
  }

  return (
    <Modal
      open={open}
      width={680}
      title="从 cURL 创建草稿"
      onCancel={onCancel}
      footer={
        <div className="ct_modal_actions">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" disabled={source.trim().length === 0} onClick={parse}>
            解析并审查
          </Button>
        </div>
      }
    >
      <div className="ct_curl_import">
        <p>
          只解析常见 HTTP 参数，不执行命令。Authorization、API Key 等敏感 Header 会转为本机 Keychain
          字段，不写入草稿文件。
        </p>
        <TextArea
          className="ct_code_input"
          rows={10}
          value={source}
          placeholder="curl https://api.example.com/v1/items -H 'Authorization: Bearer …'"
          onChange={(event) => {
            setSource(event.target.value)
            setError(null)
          }}
        />
        {error != null && <div className="ct_schema_error">{error}</div>}
      </div>
    </Modal>
  )
}
