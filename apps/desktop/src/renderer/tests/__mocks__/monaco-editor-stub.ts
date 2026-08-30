/**
 * monaco-editor 测试 stub（仅 vitest 通过 resolve.alias 注入）。
 *
 * 真实 monaco 的 ESM 模块图在 vitest 下加载需要数秒（冒烟测试 5s 超时）且依赖
 * jsdom 未实现的 API。单元测试不验证 monaco 本身，这里提供 code-viewer 用到的
 * 最小运行时面（KeyMod/KeyCode/Range/OverviewRulerLane/editor/languages 等），
 * 其余属性经 Proxy 自动返回可调用 no-op，保证 import 阶段零开销。
 */

let autoId = 0

type Stub = Record<string | symbol, unknown> & ((...args: unknown[]) => unknown)

function createAutoStub(): Stub {
  const cache = new Map<string | symbol, Stub>()
  const fn = function stubFn() {
    return createAutoStub()
  } as Stub
  return new Proxy(fn, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => 0
      if (!cache.has(key)) cache.set(key, createAutoStub())
      return cache.get(key)
    },
    apply() {
      return createAutoStub()
    },
  })
}

/** 真实 monaco 常量位值；测试只要求按位或运算可用，不要求与上游一致。 */
export const KeyMod = {
  CtrlCmd: 2048,
  Shift: 1024,
  Alt: 512,
  WinCtrl: 256,
}

export const KeyCode = new Proxy(
  {},
  {
    get(target, key) {
      const map = target as Record<string | symbol, number>
      if (typeof map[key] !== 'number') map[key] = 100 + (autoId += 1) % 600
      return map[key]
    },
  },
)

export class Range {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  constructor(
    startLineNumber = 1,
    startColumn = 1,
    endLineNumber = 1,
    endColumn = 1,
  ) {
    this.startLineNumber = startLineNumber
    this.startColumn = startColumn
    this.endLineNumber = endLineNumber
    this.endColumn = endColumn
  }
}

export const Uri = {
  parse(value: string): { toString: () => string; fsPath: string } {
    return { toString: () => value, fsPath: value }
  },
}

const fakeEditorInstance = {
  addCommand: () => undefined,
  addAction: () => undefined,
  deltaDecorations: () => [],
  createDecorationsCollection: () => ({ set: () => undefined, clear: () => undefined }),
  revealLineInCenter: () => undefined,
  setPosition: () => undefined,
  getValue: () => '',
  setValue: () => undefined,
  getModel: () => null,
  setModel: () => undefined,
  updateOptions: () => undefined,
  layout: () => undefined,
  focus: () => undefined,
  dispose: () => undefined,
}

export const editor = {
  OverviewRulerLane: {
    Left: 1,
    Center: 2,
    Right: 4,
    Full: 7,
  },
  create: () => ({ ...fakeEditorInstance }),
  defineTheme: () => undefined,
  setTheme: () => undefined,
  getModels: () => [],
  createModel: (value: string) => ({
    getValue: () => value,
    setValue: () => undefined,
    dispose: () => undefined,
  }),
  EditorFocus: { Text: 1 },
}

export const languages = {
  register: () => undefined,
  getLanguages: () => [],
  setMonarchTokensProvider: () => ({ dispose: () => undefined }),
  registerCompletionItemProvider: () => ({ dispose: () => undefined }),
  registerDefinitionProvider: () => ({ dispose: () => undefined }),
  registerHoverProvider: () => ({ dispose: () => undefined }),
  setLanguageConfiguration: () => ({ dispose: () => undefined }),
}

export const MarkerSeverity = { Hint: 1, Info: 2, Warning: 4, Error: 8 }
export const MarkerTag = {}

export const Selection = class {
  constructor(public a = 0, public b = 0, public c = 0, public d = 0) {}
}

// 未显式列出的导出（如 token、theme 相关）经 default 兜底为自动 no-op stub。
export default createAutoStub()
