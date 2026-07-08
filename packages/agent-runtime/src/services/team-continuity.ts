/**
 * @module team-continuity
 *
 * 团队成员讨论内 SDK 会话连续性 key 构造（Phase D · FR-5）。
 *
 * 同一场讨论（discussionId）内，同一成员跨多次 dispatch 复用同一 sdkSessionId，
 * 使成员"记得自己上一轮怎么想的"（SDK 内部会话状态延续）。不同成员 / 不同讨论 /
 * 与 mention 路径（`mention:${agent.id}` scope）互不交叉污染。
 *
 * 抽成独立纯函数模块（而非内联 session.service.ts），便于独立单测；scope 设计为
 * 通用字符串，未来 workflow 循环节点零成本复用（scope 换成 `workflow-loop:${loopNodeId}`，
 * 见原方案第九节 8-2 条）。
 */

/** 构造讨论连续性 scope：`team:${discussionId}`。 */
export function buildTeamContinuityScope(discussionId: string): string {
  return `team:${discussionId}`
}

/**
 * 构造成员在某 scope 内的连续性 key：`${scope}:${memberId}`。
 * 传给 makeSdkRuntimeSessionId 的 turnId 参数位，作为 stable session 命名空间。
 */
export function buildMemberContinuityKey(scope: string, memberId: string): string {
  return `${scope}:${memberId}`
}
