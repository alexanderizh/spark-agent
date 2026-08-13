import type { SessionId } from '@spark/protocol'
import { OutcomeRoomPanel } from './OutcomeRoomPanel'
import { useOutcomeRoom } from './useOutcomeRoom'
import { TeamP1Panel } from './TeamP1Panel'
import { TeamRuntimePanel } from './TeamRuntimePanel'
import { EvidenceCostPanel } from './EvidenceCostPanel'
import { ReplayPlaybookPanel } from './ReplayPlaybookPanel'

export function OutcomeRoomContainer({
  sessionId,
  runningMemberCount,
}: {
  sessionId: SessionId | undefined
  runningMemberCount: number
}) {
  const room = useOutcomeRoom(sessionId)
  return <>
    <OutcomeRoomPanel
      snapshot={room.snapshot}
      loading={room.loading}
      error={room.error}
      runningMemberCount={runningMemberCount}
      mutatingKey={room.mutatingKey}
      onRefresh={() => void room.refresh()}
      onMutate={room.mutate}
    />
    <TeamP1Panel sessionId={sessionId} />
    <TeamRuntimePanel sessionId={sessionId} />
    <EvidenceCostPanel sessionId={sessionId} discussionId={room.snapshot?.discussion?.id} />
    <ReplayPlaybookPanel sessionId={sessionId} discussionId={room.snapshot?.discussion?.id} />
  </>
}
