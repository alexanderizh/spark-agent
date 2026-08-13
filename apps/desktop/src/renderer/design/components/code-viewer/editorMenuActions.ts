/**
 * editorMenuActions —— Monaco 编辑器右键菜单（自建中文浮层）+ 「添加到会话」能力。
 *
 * 命名警示：本文件不能叫 editorContextMenu.ts —— 会与 EditorContextMenu.tsx 仅大小写不同，
 * macOS 大小写不敏感文件系统 + Vite 解析 .ts 优先于 .tsx，import './EditorContextMenu'
 * 会被折叠解析到本文件（无该导出，运行时直接报错）。工具/组件文件名须整体不同。
 *
 * 为什么自建浮层（不再 patch 内置项 label）：
 *   Monaco 右键菜单项来自内部 MenuRegistry 注册的 MenuItemAction（contextmenu.js 经
 *   _menuService.getMenuActions 读取），而 editor.getSupportedActions() 返回的是另一套
 *   editor action 实例——两者不是同一批对象，patch label 改在了没人读的地方（已验证无效）。
 *   monaco 公开 API 没有提供运行时改内置菜单文案的入口，故内置项中文化只能靠自建浮层：
 *   CodeViewerEditor 禁用原生 contextmenu，改为 onContextMenu 弹出本模块配置驱动的浮层，
 *   浮层点击调 editor.getAction(id).run() 复用 monaco 原生能力。
 *
 * 「添加到会话」两项：
 *   - registerCodeViewerMenuActions 注册快捷键（Cmd/Ctrl+Alt+I、Cmd/Ctrl+Alt+F），不进原生菜单；
 *   - 自建浮层底部也提供这两个入口（有选区才可点「添加选中代码」）。
 *   走 composerInsert 的「追加」通道，代码以 CodeReference（路径:行号）chip 形式进入输入框。
 */
import type * as Monaco from 'monaco-editor'
import { insertToComposer, type CodeReference } from './composerInsert'

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor
type MonacoNS = typeof Monaco

export interface EditorMenuItem {
  key: string
  label: string
  /** 分隔线：仅渲染分隔，label/onSelect 无意义 */
  separator?: boolean
  disabled?: boolean
  onSelect?: () => void
}

/**
 * Monaco 原生右键项的中文名 + 是否仅编辑态（只读时禁用）。按组组织，组间自动插分隔线。
 * id 取自 monaco 源码（editor.api / browser contributions）；getAction(id) 返回 null 时该项跳过。
 */
const NATIVE_ACTION_GROUPS: Array<{ id: string; label: string; editOnly?: boolean }[]> = [
  [
    { id: 'editor.action.clipboardCutAction', label: '剪切', editOnly: true },
    { id: 'editor.action.clipboardCopyAction', label: '复制' },
    { id: 'editor.action.clipboardPasteAction', label: '粘贴', editOnly: true },
    { id: 'editor.action.selectAll', label: '全选' },
  ],
  [{ id: 'actions.find', label: '查找' }, { id: 'editor.action.startFindReplaceAction', label: '替换' }],
  [
    { id: 'editor.action.formatDocument', label: '格式化文档', editOnly: true },
    { id: 'editor.action.formatSelection', label: '格式化选定内容', editOnly: true },
  ],
  [
    // 折叠 action id 无 .action. 中段（monaco 0.52 实测：editor.fold / editor.unfold，
    // 写成 editor.action.fold 会被 getAction 判为 null 而静默从菜单消失）
    { id: 'editor.fold', label: '折叠区域' },
    { id: 'editor.unfold', label: '展开区域' },
  ],
]

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** 当前是否有非空选区。 */
export function editorHasSelection(editor: MonacoEditor): boolean {
  const sel = editor.getSelection()
  return sel != null && !sel.isEmpty()
}

/** 取当前选区的代码位置引用；无选区 / 无文件路径时返回 null。 */
export function getSelectionCodeReference(editor: MonacoEditor, filePath: string): CodeReference | null {
  if (filePath.length === 0) return null
  const selection = editor.getSelection()
  if (selection == null || selection.isEmpty()) return null
  return {
    path: filePath,
    name: basename(filePath),
    startLine: selection.startLineNumber,
    endLine: selection.endLineNumber,
  }
}

/** 添加选中代码到会话（以 CodeReference chip 形式）。 */
export function addSelectionToComposer(editor: MonacoEditor, filePath: string): void {
  const ref = getSelectionCodeReference(editor, filePath)
  if (ref == null) return
  void insertToComposer({ codeReferences: [ref] })
}

/** 添加当前文件到会话（作为 file 附件，语义同拖文件进输入框）。 */
export function addFileToComposer(filePath: string): void {
  if (filePath.length === 0) return
  void insertToComposer({ attachments: [{ type: 'file', path: filePath, name: basename(filePath) }] })
}

/**
 * 注册「添加到会话」两个 action 的快捷键（不进原生右键菜单——原生菜单已禁用，改由自建浮层承载）。
 * addAction 返回的 IDisposable 由 editor 实例生命周期托管，组件卸载随 editor 销毁自动清理。
 * getFilePath 用函数取值（filePath 随 tab 切换变化，走 ref 避免闭包 stale）。
 */
export function registerCodeViewerMenuActions(
  editor: MonacoEditor,
  monaco: MonacoNS,
  getFilePath: () => string,
): void {
  editor.addAction({
    id: 'codeviewer.addSelectionToComposer',
    label: '添加选中代码到会话',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyI],
    run: (ed) => addSelectionToComposer(ed, getFilePath()),
  })
  editor.addAction({
    id: 'codeviewer.addFileToComposer',
    label: '添加文件到会话',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
    run: () => addFileToComposer(getFilePath()),
  })
}

/**
 * 构造自建右键浮层的菜单项。
 * 原生项经 editor.getAction(id) 校验：环境不支持的（返回 null，如无剪贴板权限）自动跳过，
 * 整组都不存在时该组的分隔线也不渲染。
 */
export function getEditorMenuItems(
  editor: MonacoEditor,
  filePath: string,
  readOnly: boolean,
): EditorMenuItem[] {
  const items: EditorMenuItem[] = []
  NATIVE_ACTION_GROUPS.forEach((group, groupIndex) => {
    const groupItems: EditorMenuItem[] = []
    for (const cfg of group) {
      const action = editor.getAction(cfg.id)
      if (action == null) continue
      groupItems.push({
        key: cfg.id,
        label: cfg.label,
        disabled: readOnly && cfg.editOnly === true,
        onSelect: () => void action.run(),
      })
    }
    if (groupItems.length === 0) return
    if (items.length > 0) items.push({ key: `sep-native-${groupIndex}`, separator: true })
    items.push(...groupItems)
  })

  // 「添加到会话」两项
  if (items.length > 0) items.push({ key: 'sep-codeviewer', separator: true })
  items.push({
    key: 'cv-add-selection',
    label: '添加选中代码到会话',
    disabled: !editorHasSelection(editor) || filePath.length === 0,
    onSelect: () => addSelectionToComposer(editor, filePath),
  })
  items.push({
    key: 'cv-add-file',
    label: '添加文件到会话',
    disabled: filePath.length === 0,
    onSelect: () => addFileToComposer(filePath),
  })
  return items
}
