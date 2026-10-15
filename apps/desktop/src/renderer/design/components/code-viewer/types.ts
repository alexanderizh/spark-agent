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

/**
 * 代码查看器视图模式：
 *  - source  源码（Monaco 编辑器）
 *  - preview 预览（内容区原地渲染 HTML/Markdown/图片/音视频/Office 渲染结果）
 *  - split   分屏实时预览（左源码右预览，中间分隔条可拖；仅「可编辑 + 可预览」类型可用）
 *  - diff    本次改动 diff
 */
export type CodeViewMode = 'source' | 'preview' | 'split' | 'diff'

/**
 * 跨文件视图偏好（sticky 开关）：用户在工具栏切到预览/分屏后，切换文件仍保持该偏好；
 * 与文件能力不匹配时由渲染期收窄（不可预览 → 源码，只能看不能编的富媒体 → 预览），偏好本身不丢。
 * diff 是上下文绑定视图（看某个文件的改动），不参与偏好，只走 tab 级覆盖。
 */
export type CodeViewPreference = 'source' | 'preview' | 'split'

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
  /** 当前 tab 若来自提交历史，则 diff 固定读取该提交的 patch。 */
  gitCommitHash?: string | undefined
  /**
   * 该文件 tab 的一次性视图覆盖（不承载跨文件偏好，偏好见 ChatView 的 viewPreference）：
   *  - 'diff'：Git 面板/审查面板/提交历史等「看改动」入口写入，切走再切回仍停在 diff；
   *  - 'preview'：右键「预览」等显式单次意图写入；
   *  - undefined：跟随全局偏好（按文件能力收窄）。
   * 用户在工具栏切换 source/preview/split 时会清掉覆盖（此后跟随偏好）；切到 diff 时写入覆盖。
   */
  viewMode?: 'diff' | 'preview' | undefined
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
  /** file:read 识别出的源编码；保存时原样传回 file:write-text 以保持文件编码不变 */
  encoding?: string | undefined
}
