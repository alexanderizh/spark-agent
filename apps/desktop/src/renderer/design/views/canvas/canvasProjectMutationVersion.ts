export class CanvasProjectMutationVersion {
  private readonly versions = new Map<string, number>()

  mark(projectId: string): void {
    this.versions.set(projectId, (this.versions.get(projectId) ?? 0) + 1)
  }

  capture(projectIds: Iterable<string>): ReadonlyMap<string, number> {
    return new Map(Array.from(projectIds, (projectId) => [projectId, this.current(projectId)]))
  }

  isCurrent(projectId: string, expectedVersion: number | undefined): boolean {
    return this.current(projectId) === (expectedVersion ?? 0)
  }

  reset(): void {
    this.versions.clear()
  }

  private current(projectId: string): number {
    return this.versions.get(projectId) ?? 0
  }
}
