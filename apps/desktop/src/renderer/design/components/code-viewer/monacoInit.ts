/**
 * Monaco 运行时初始化（renderer 侧，全局一次）。
 *
 * 三件事：
 *  1. self.MonacoEnvironment.getWorker —— 用 vite 原生 `?worker` import 把各语言 worker
 *     作为独立 chunk 打包。electron-vite 生产构建（asar）下 worker 可加载，不依赖 CDN。
 *  2. loader.config({ monaco }) —— 把本地 ESM monaco 注入 @monaco-editor/react，
 *     避免它默认从 jsdelivr/unpkg 拉 AMD bundle（Electron 离线 / 隐私场景不可接受）。
 *  3. configureTsJsLanguageService —— TS/JS 编译选项与诊断过滤，
 *     消除内置编辑器对合法代码的误报爆红（见函数注释）。
 *
 * 本模块有副作用；CodeViewerEditor / CodeViewerDiff 在首次渲染前 import 本模块一次即可，
 * initGuard 保证重复初始化幂等。
 */

import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * 配置 TS/JS 语言服务的编译选项与诊断过滤。
 *
 * Monaco 的 TS worker 是"孤儿"语言服务：只认识内存里已注册的模型，读不到磁盘上的
 * tsconfig、node_modules 和工程其余文件。不配置就按出厂默认值跑：不识别 JSX
 * （.tsx 被当普通 .ts 解析，从出错点开始整段语法误报）、模块解析规则与现代
 * 前端工程不符（import 全线 2307/2792 爆红）。
 *
 * 策略：编译选项给一套贴近现代前端的通用值；诊断保留本地语法/类型校验，
 * 仅按错误码静默「跨文件解析」类必然误报——只要 Monaco 读不到磁盘依赖，
 * 这类错误无论怎么调参都会误报，留着只会让用户把合法代码当有错。
 */
function configureTsJsLanguageService(): void {
  const ts = monaco.languages.typescript
  const compilerOptions: monaco.languages.typescript.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    // 公开枚举未收录 Bundler(100)，但 worker 内核（TS 5.x）支持，与 vite 等打包器工程一致
    moduleResolution: 100 as monaco.languages.typescript.ModuleResolutionKind,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    skipLibCheck: true,
  }
  ts.typescriptDefaults.setCompilerOptions(compilerOptions)
  ts.javascriptDefaults.setCompilerOptions(compilerOptions)

  const diagnosticsOptions: monaco.languages.typescript.DiagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [
      2307, // Cannot find module（node_modules / 工程文件不可见）
      2792, // Cannot find module 的 moduleResolution / paths 配置提示变体
      7016, // Could not find a declaration file ... implicitly has an 'any' type
      7026, // JSX element implicitly has type 'any' ... no interface 'JSX.IntrinsicElements'（未注入 react 类型时的必然误报）
    ],
  }
  ts.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
  ts.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
}

let initialized = false

export function ensureMonacoInit(): void {
  if (initialized) return
  initialized = true

  // globalThis 而非 self：self 在非浏览器上下文（vitest node 环境）未定义。
  ;(
    globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment }
  ).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new JsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker()
        case 'typescript':
        case 'javascript':
          return new TsWorker()
        default:
          return new EditorWorker()
      }
    },
  }

  configureTsJsLanguageService()
  loader.config({ monaco })
}

ensureMonacoInit()
