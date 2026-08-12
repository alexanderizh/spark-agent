/**
 * code-viewer 类型定义
 *
 * 这些类型与具体编辑器内核（Monaco/CodeMirror）无关，便于后续替换。
 * 由 CodeViewerPanel / useCodeViewerFiles / ChatView（code tab 受控状态）共享。
 *
 * 注：项目 tsconfig 开启 exactOptionalPropertyTypes，所有可选属性显式标注 `| undefined`，
 * 这样在构造对象字面量时允许显式传入 undefined（setState / props 透传常见）。
 */

import type { PreviewFileType } from '../ClickableFilePath'

/** 代码查看器视图模式：源码 / 本次改动 diff */
export type CodeViewMode = 'source' | 'diff'

/** 文件变更类型（与 ChatInteractions.FileChangeSummaryItem.changeType 对齐） */
export type CodeFileChangeType = 'create' | 'modify' | 'delete' | 'rename'

/**
 * 「代码」tab 中一个已打开的文件 tab。
 * 多文件切换时，CodeViewerPanel 维护 OpenCodeFile[]，activeAbsPath 指向当前激活项。
 */
export interface OpenCodeFile {
  /** 已 resolve 的绝对路径（作为唯一身份 key） */
  absPath: string
  /** 展示用路径：优先用相对 workspace 的短路径，回退到 absPath */
  displayPath: string
  /** 文件预览类型；代码类文件统一为 'text'（由 getPreviewFileType 判定） */
  fileType: PreviewFileType
  /**
   * 该文件附带的 unified diff 文本（来自变更记录卡片的 FileChangeSummaryItem.diff）。
   * 预留字段：当前 diff 视图改用 workspace:git-file-diff 实时取，不依赖此字段；后续若透传可复用。
   */
  diff?: string | undefined
  /** 打开时希望定位/高亮的行号（点回答里 file.tsx (line 342) 时传入） */
  lineNumber?: number | undefined
  /** 变更类型；delete 时禁止编辑、diff 仅展示删除 */
  changeType?: CodeFileChangeType | undefined
}

/** 单文件加载状态 */
export type CodeFileLoadState = 'idle' | 'loading' | 'ready' | 'error'

/** 单文件在编辑器内的运行时态（内容、脏标、外部变更检测等由 hook 维护） */
export interface CodeFileRuntime {
  /** 最新从磁盘读取（或用户编辑后）的文本内容 */
  content: string
  /** 与磁盘一致的内容快照；content !== savedContent 即脏 */
  savedContent: string
  /** 文件读取/保存错误信息 */
  error?: string | undefined
  /** 加载状态 */
  state: CodeFileLoadState
  /** 磁盘文件在外部被修改（保存前 mtime 校验检测到） */
  externalChanged?: boolean | undefined
}
