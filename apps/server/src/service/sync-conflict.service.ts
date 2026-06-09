import { Provide, Inject } from '@midwayjs/core'

@Provide()
export class SyncConflictService {
  resolve(clientVersion: number, serverVersion: number): 'no_conflict' | 'client_wins' | 'server_wins' {
    if (clientVersion >= serverVersion) return 'no_conflict'
    return 'server_wins'
  }
}
