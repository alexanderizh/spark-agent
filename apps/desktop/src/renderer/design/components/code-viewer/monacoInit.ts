/**
 * Monaco 运行时初始化（renderer 侧，全局一次）。
 *
 * 两件事：
 *  1. self.MonacoEnvironment.getWorker —— 用 vite 原生 `?worker` import 把各语言 worker
 *     作为独立 chunk 打包。electron-vite 生产构建（asar）下 worker 可加载，不依赖 CDN。
 *  2. loader.config({ monaco }) —— 把本地 ESM monaco 注入 @monaco-editor/react，
 *     避免它默认从 jsdelivr/unpkg 拉 AMD bundle（Electron 离线 / 隐私场景不可接受）。
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

let initialized = false

export function ensureMonacoInit(): void {
  if (initialized) return
  initialized = true

  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
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

  loader.config({ monaco })
}

ensureMonacoInit()
