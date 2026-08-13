/**
 * CodeViewerEditor —— Monaco Editor 封装（源码视图）。
 *
 * - 只读 / 可编辑切换（delete 类文件强制只读）。
 * - 语言识别（getMonacoLanguage）、跟随应用主题（vs-dark / vs）。
 * - 跳转行：revealLineInCenter + deltaDecorations 高亮（点回答里 file (line N) 时用）。
 * - Cmd/Ctrl+S 保存（遵循项目编辑器快捷键约定）。
 * - 右键：禁用 monaco 原生英文菜单，改弹自建中文浮层（EditorContextMenu）。
 *
 * import './monacoInit' 触发 worker 注册 + 注入本地 ESM monaco（幂等）。
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import './monacoInit'
import { getMonacoLanguage } from './codeLanguage'
import { registerCodeViewerMenuActions } from './editorMenuActions'
import { EditorContextMenu } from './EditorContextMenu'

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor
type MonacoNS = typeof Monaco

export interface CodeViewerEditorProps {
  filePath: string
  content: string
  readOnly: boolean
  theme: 'dark' | 'light'
  /** 打开 / 跳转时定位并高亮的行号 */
  lineNumber?: number | undefined
  /** 是否显示右侧小地图（minimap），由工具栏开关控制 */
  minimapEnabled: boolean
  onContentChange: (value: string) => void
  onSave: () => void
}

export function CodeViewerEditor({
  filePath,
  content,
  readOnly,
  theme,
  lineNumber,
  minimapEnabled,
  onContentChange,
  onSave,
}: CodeViewerEditorProps) {
  const editorRef = useRef<MonacoEditor | null>(null)
  const monacoRef = useRef<MonacoNS | null>(null)
  const decorationsRef = useRef<string[]>([])
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const lineNumberRef = useRef(lineNumber)
  lineNumberRef.current = lineNumber
  // tab 切换时 filePath 变化，右键 action 闭包用 ref 取最新值，避免 stale。
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  // 自建右键浮层坐标（null = 关闭）。monaco 原生 contextmenu 已禁用，改由 onContextMenu 弹浮层。
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // 切 tab（filePath 变化）时关闭浮层，避免引用到旧文件
  useEffect(() => {
    setContextMenu(null)
  }, [filePath])

  const revealJump = useCallback((editor: MonacoEditor, monaco: MonacoNS, ln?: number) => {
    if (ln == null || ln < 1) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [])
      return
    }
    editor.revealLineInCenter(ln)
    editor.setPosition({ lineNumber: ln, column: 1 })
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
      {
        range: new monaco.Range(ln, 1, ln, 1),
        options: {
          isWholeLine: true,
          className: 'code-viewer-jump-line',
          overviewRuler: { color: '#4f7cff', position: monaco.editor.OverviewRulerLane.Center },
        },
      },
    ])
  }, [])

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveRef.current()
      })
      // 「添加到会话」两项的快捷键（原生右键菜单已禁用，改由自建浮层承载中文菜单）
      registerCodeViewerMenuActions(editor, monaco, () => filePathRef.current)
      revealJump(editor, monaco, lineNumberRef.current)
    },
    [revealJump],
  )

  // lineNumber 变化时重新定位（editor 已挂载后）
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (editor != null && monaco != null) {
      revealJump(editor, monaco, lineNumber)
    }
  }, [lineNumber, revealJump])

  return (
    <>
      <Editor
        language={getMonacoLanguage(filePath)}
        value={content}
        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
        onMount={handleMount}
        onChange={(value) => onContentChange(value ?? '')}
        loading={<div className="code-viewer-loading">加载编辑器…</div>}
        options={{
          readOnly,
          contextmenu: false,
          minimap: { enabled: minimapEnabled },
          fontSize: 13,
          lineHeight: 20,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'off',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: 'active', indentation: true },
          fixedOverflowWidgets: true,
          padding: { top: 10 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        }}
        wrapperProps={{
          onContextMenu: (event: MouseEvent<HTMLDivElement>) => {
            event.preventDefault()
            setContextMenu({ x: event.clientX, y: event.clientY })
          },
        }}
      />
      {contextMenu != null && editorRef.current != null && (
        <EditorContextMenu
          editor={editorRef.current}
          filePath={filePath}
          readOnly={readOnly}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
