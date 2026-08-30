/**
 * 同一画布项目的快照读写必须按 IPC 到达顺序串行完成。
 *
 * 不同 renderer 窗口各自只能约束本窗口内的保存；主进程协调器是所有窗口共享的最终
 * 一致性边界。load 也进入同一队列，可避免它在 latest.json 与 SQLite 尚未同步时
 * 取得中间版本，并防止等待结束后又与新到达的 save 重叠。
 */
export class CanvasSnapshotWriteCoordinator {
  private readonly tails = new Map<string, Promise<void>>()

  run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(projectId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(projectId, tail)
    void tail.then(() => {
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId)
    })
    return result
  }
}
