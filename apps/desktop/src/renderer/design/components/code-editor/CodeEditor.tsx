/**
 * CodeEditor —— 通用代码 / JSON 输入框（Monaco）。
 *
 * 定位：表单里的「带高亮的输入控件」，不是代码视图。与 components/code-viewer 的关系是
 * **只共用运行时**（`monacoInit` 注册 worker + 注入本地 ESM monaco、`useResolvedTheme` 跟随主题），
 * 不共用 CodeViewerEditor：后者绑定文件路径 model、跳转行、Ctrl+S 保存、git diff、minimap、
 * 只为代码视图服务；这里的控件面是 value / onChange / language / rows，两者混用会互相牵制。
 *
 * 行为约定：
 *  - 高度：rows 沿用旧 TextArea 的口径，换算集中在 codeEditorLayout；
 *  - 主题：跟随应用 data-theme（vs / vs-dark）；
 *  - 校验：拿到 marker 后在字段下方给一行「第 N 行：…」摘要，规则与降噪见 codeEditorDiagnostics；
 *  - 模型 URI：带语言对应的扩展名（见 createEditorModelPath）。Monaco 的 TS worker 按扩展名判定
 *    脚本类型，匿名模型（inmemory://model/1）会被当 JS，对合法 TS 报 8008/8010「Type annotations
 *    can only be used in TypeScript files」，所以每个字段给一个唯一且带扩展名的内存 URI；
 *  - 布局：automaticLayout 自适应父容器宽度（面板变窄 / 弹窗缩放都不需要额外处理）；
 *  - 占位：走 Monaco 0.52 原生 placeholder，空内容时才显示。
 *
 * 已知取舍：右键沿用 Monaco 原生菜单（剪切/复制/粘贴/查找），文案为英文。代码视图那边因为
 * 需要「添加到会话」等业务项才自建了中文浮层（code-viewer/EditorContextMenu）；本控件是纯输入框，
 * 未接入那套浮层，避免为一个右键菜单把带有业务动作的菜单组件反向依赖进来。
 */

import { useCallback, useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { OnValidate } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import '../code-viewer/monacoInit'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { classNames } from '../../utils/class-names'
import {
  CODE_EDITOR_FONT_FAMILY,
  CODE_EDITOR_FONT_SIZE,
  CODE_EDITOR_LINE_HEIGHT,
  CODE_EDITOR_VERTICAL_PADDING,
  codeEditorHeightForRows,
} from './codeEditorLayout'
import {
  diagnoseCodeEditor,
  formatCodeEditorDiagnostic,
  type CodeEditorDiagnosticSummary,
} from './codeEditorDiagnostics'
import { ensureTemplateJsonLanguage } from './templateJsonLanguage'
import './index.less'

/**
 * 语言 → 模型 URI 扩展名。Monaco 的 TS/JS worker 按模型 URI 的扩展名决定脚本类型；
 * 没有扩展名的匿名模型会被当成 JS，对合法 TS 报 8008/8010。其余语言的 worker 不依赖扩展名，
 * 这里一并给出只是为了让模型 URI 可读、可排查。
 */
const LANGUAGE_MODEL_EXTENSIONS: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  shell: 'sh',
  markdown: 'md',
  python: 'py',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  ini: 'ini',
}

/** 每个编辑器实例一个自增序号：模型 URI 全局唯一，避免同名字段互相串模型 */
let editorModelSeq = 0

/** 为本次挂载生成唯一的模型 URI（同一次挂载内保持不变，值随 value 同步） */
function createEditorModelPath(language: string): string {
  editorModelSeq += 1
  const extension = LANGUAGE_MODEL_EXTENSIONS[language] ?? 'txt'
  return `inmemory://spark-code-editor/${editorModelSeq}.${extension}`
}

/** 未指定 rows 时的默认高度（约等于旧 TextArea 的 rows=6） */
const DEFAULT_ROWS = 6

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  /** Monaco language id；JSON 模板字段用 JSON_TEMPLATE_LANGUAGE_ID */
  language: string
  /** 可见行数（沿用旧 TextArea 的 rows 口径） */
  rows?: number
  /** 直接指定像素高度；给了就不再按 rows 换算 */
  height?: number
  readOnly?: boolean
  /** 空内容时的占位提示 */
  placeholder?: string
  /** 无障碍名称（读屏 / 自动化测试定位用） */
  ariaLabel?: string
  /** 是否在编辑器下方展示诊断摘要（默认展示） */
  showDiagnostics?: boolean
  className?: string
}

export function CodeEditor({
  value,
  onChange,
  language,
  rows,
  height,
  readOnly = false,
  placeholder,
  ariaLabel,
  showDiagnostics = true,
  className,
}: CodeEditorProps) {
  const theme = useResolvedTheme()
  // 挂载时定一次：path 变了 Monaco 会重建模型（丢光标与撤销栈），所以只按首帧的语言决定
  const [modelPath] = useState(() => createEditorModelPath(language))
  const [validated, setValidated] = useState<{
    language: string
    summary: CodeEditorDiagnosticSummary | null
  } | null>(null)

  const handleValidate = useCallback<OnValidate>(
    (markers) => {
      setValidated({ language, summary: diagnoseCodeEditor(language, markers) })
    },
    [language],
  )

  // 语言在挂载前注册（此时 monaco 实例已就绪），避免模型带着未注册语言创建
  const beforeMount = useCallback(() => {
    ensureTemplateJsonLanguage()
  }, [])

  const handleChange = useCallback(
    (next: string | undefined) => {
      onChange?.(next ?? '')
    },
    [onChange],
  )

  const options = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(() => {
    const base: Monaco.editor.IStandaloneEditorConstructionOptions = {
      readOnly,
      minimap: { enabled: false },
      folding: false,
      glyphMargin: false,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 6,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      fontSize: CODE_EDITOR_FONT_SIZE,
      lineHeight: CODE_EDITOR_LINE_HEIGHT,
      fontFamily: CODE_EDITOR_FONT_FAMILY,
      padding: { top: CODE_EDITOR_VERTICAL_PADDING, bottom: CODE_EDITOR_VERTICAL_PADDING },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'off',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active', indentation: true },
      // 表单字段里自动弹出的补全建议只会挡视线；Ctrl+Space 仍可手动唤起
      quickSuggestions: false,
      fixedOverflowWidgets: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    }
    // exactOptionalPropertyTypes：可选选项必须「有值才给」，不能显式传 undefined
    if (ariaLabel != null) base.ariaLabel = ariaLabel
    if (placeholder != null) base.placeholder = placeholder
    return base
  }, [readOnly, ariaLabel, placeholder])

  // 摘要与产出它的语言绑定：language 变了旧摘要立即失效（如 OpenAPI 粘贴时 json ↔ yaml 自动切换）
  const summary =
    showDiagnostics && validated != null && validated.language === language
      ? validated.summary
      : null

  return (
    <div className={classNames('code-editor-field', className)}>
      <div className="code-editor">
        <Editor
          path={modelPath}
          // 每个字段都是独立短生命周期实例，没有「回到同一个文件」的场景；
          // 关掉视图状态缓存，避免 @monaco-editor/react 的模块级 Map 随每次挂载无限增长
          saveViewState={false}
          value={value}
          language={language}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          height={height ?? codeEditorHeightForRows(rows ?? DEFAULT_ROWS)}
          options={options}
          beforeMount={beforeMount}
          onValidate={handleValidate}
          onChange={handleChange}
          loading={<div className="code-editor-loading">加载编辑器…</div>}
        />
      </div>
      {summary != null && (
        <div className="code-editor-diagnostic" role="status">
          {formatCodeEditorDiagnostic(summary)}
        </div>
      )}
    </div>
  )
}
