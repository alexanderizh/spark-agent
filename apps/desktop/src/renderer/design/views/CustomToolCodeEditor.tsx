import { Select, TextArea } from '@lobehub/ui'
import { InputNumber } from 'antd'
import type { RuntimeEffect, RuntimeIdempotency, RuntimeRisk } from '@spark/protocol'
import type { CustomToolEditorDraft } from './custom-tools-model'
import { CustomToolSchemaEditor } from './CustomToolSchemaEditor'

interface CustomToolCodeEditorProps {
  editor: CustomToolEditorDraft
  onChange: (next: CustomToolEditorDraft) => void
}

const RISK_OPTIONS: Array<{ label: string; value: RuntimeRisk }> = [
  { label: '只读', value: 'read' },
  { label: '低风险写入', value: 'low-write' },
  { label: '高风险写入', value: 'high-write' },
  { label: '破坏性操作', value: 'destructive' },
]
const EFFECT_OPTIONS: Array<{ label: string; value: RuntimeEffect }> = [
  { label: '读取', value: 'read' },
  { label: '创建', value: 'create' },
  { label: '更新', value: 'update' },
  { label: '删除', value: 'delete' },
  { label: '发送', value: 'send' },
  { label: '发布', value: 'publish' },
]
const IDEMPOTENCY_OPTIONS: Array<{ label: string; value: RuntimeIdempotency }> = [
  { label: '可安全重试', value: 'safe' },
  { label: '需幂等键', value: 'keyed' },
  { label: '不可自动重试', value: 'unsafe' },
]

export function CustomToolCodeEditor({ editor, onChange }: CustomToolCodeEditorProps) {
  const patch = <K extends keyof CustomToolEditorDraft>(key: K, value: CustomToolEditorDraft[K]) =>
    onChange({ ...editor, [key]: value })
  const effectOptions = editor.codeRisk === 'read' ? EFFECT_OPTIONS.slice(0, 1) : EFFECT_OPTIONS
  const idempotencyOptions =
    editor.codeRisk === 'destructive'
      ? IDEMPOTENCY_OPTIONS.filter((option) => option.value === 'unsafe')
      : IDEMPOTENCY_OPTIONS

  return (
    <>
      <section id="ct-section-execution" className="ct_editor_section">
        <div className="ct_editor_section_title">TypeScript 逻辑</div>
        <div className="ct_security_note">
          代码运行在独立 Worker，不进入 Electron 或 Agent 进程。当前为“受信任本地代码”模式；请勿粘贴来源不明的第三方代码。
        </div>
        <label className="ct_field">
          <span>工具源码</span>
          <TextArea
            className="ct_code_input ct_code_source"
            rows={20}
            value={editor.codeSource}
            spellCheck={false}
            onChange={(event) => patch('codeSource', event.target.value)}
          />
          <small>
            导出 default async function(input, sdk)。外部能力统一通过
            sdk.tools.call(toolId, input) 调用下方授权工具。
          </small>
        </label>
        <div className="ct_field">
          <span>输入参数 Schema</span>
          <CustomToolSchemaEditor
            value={editor.inputSchemaJson}
            onChange={(value) => patch('inputSchemaJson', value)}
          />
        </div>
      </section>

      <section id="ct-section-routing" className="ct_editor_section">
        <div className="ct_editor_section_title">能力与权限</div>
        <label className="ct_field">
          <span>允许组合的工具 ID</span>
          <TextArea
            className="ct_code_input"
            rows={4}
            value={editor.codeToolIdsText}
            placeholder={'weather_lookup\ncompany_search'}
            onChange={(event) => patch('codeToolIdsText', event.target.value)}
          />
          <small>
            每行一个已发布工具 ID。Worker 只能调用这里列出的工具；发布和启用时会校验依赖与风险等级。
          </small>
        </label>
        <div className="ct_field_grid ct_field_grid_three">
          <label className="ct_field">
            <span>风险等级</span>
            <Select
              value={editor.codeRisk}
              options={RISK_OPTIONS}
              onChange={(value) => {
                const risk = value as RuntimeRisk
                onChange({
                  ...editor,
                  codeRisk: risk,
                  ...(risk === 'read' ? { codeEffect: 'read' as const } : {}),
                  ...(risk === 'destructive' ? { codeIdempotency: 'unsafe' as const } : {}),
                })
              }}
            />
          </label>
          <label className="ct_field">
            <span>副作用</span>
            <Select
              value={editor.codeEffect}
              options={effectOptions}
              onChange={(value) => patch('codeEffect', value as RuntimeEffect)}
            />
          </label>
          <label className="ct_field">
            <span>重试语义</span>
            <Select
              value={editor.codeIdempotency}
              options={idempotencyOptions}
              onChange={(value) => patch('codeIdempotency', value as RuntimeIdempotency)}
            />
          </label>
        </div>
        <div className="ct_field_grid">
          <label className="ct_field">
            <span>Worker 内存</span>
            <InputNumber
              min={64}
              max={512}
              step={32}
              addonAfter="MB"
              value={editor.codeMemoryMb}
              onChange={(value) => patch('codeMemoryMb', Number(value ?? 128))}
            />
          </label>
          <label className="ct_field">
            <span>最大输出字节</span>
            <InputNumber
              min={1_024}
              max={10_485_760}
              value={editor.codeMaxOutputBytes}
              onChange={(value) => patch('codeMaxOutputBytes', Number(value ?? 1_048_576))}
            />
          </label>
        </div>
      </section>
    </>
  )
}
