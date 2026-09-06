/**
 * session-runtime-config 的存储层全量 mock 补位。
 *
 * 这些仓库在被测 turn 中只会被装配进 MCP backend，不执行领域读写；独立文件避免继续
 * 扩大已经超过 3000 行的主测试夹具。
 */
export class SessionRuntimeConfigSubAppRepositoryStub {}

export class SessionRuntimeConfigTurnPerfRepositoryStub {
  recordFinal(): void {}
}

export class SessionRuntimeConfigCustomToolRepositoryStub {
  ensureVersionHistory(): void {}

  listEnabled(): never[] {
    return []
  }
}

export class SessionRuntimeConfigToolInvocationRepositoryStub {}

export class SessionRuntimeConfigSessionHistoryRepositoryStub {}
