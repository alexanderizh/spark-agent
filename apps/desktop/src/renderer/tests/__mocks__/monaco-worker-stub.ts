/**
 * monaco 语言 worker 的 vitest stub：单元测试不会真正创建 worker，
 * 只需要 `?worker` import 返回一个可 new 的构造器（monacoInit.ts 的 getWorker 用）。
 */
export default class MonacoWorkerStub {
  terminate(): void {
    /* no-op */
  }
}
