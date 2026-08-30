/**
 * jsdom 环境缺失 API 的最小补丁。
 *
 * monaco-editor（经 code-viewer/monacoInit.ts 引入）在模块加载阶段就会访问
 * document.queryCommandSupported（clipboard contrib 的能力探测），jsdom 未实现
 * 该 API，导致渲染层冒烟测试在 import 阶段即崩溃。仅在存在 document 的环境下生效。
 */
if (typeof document !== 'undefined') {
  const doc = document as Document & {
    queryCommandSupported?: (command: string) => boolean
    queryCommandEnabled?: (command: string) => boolean
  }
  doc.queryCommandSupported ??= () => false
  doc.queryCommandEnabled ??= () => false
}
