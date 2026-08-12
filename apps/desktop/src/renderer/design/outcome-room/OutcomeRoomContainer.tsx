import type { SessionId } from '@spark/protocol'
import { OutcomeRoomPanel } from './OutcomeRoomPanel'
import { useOutcomeRoom } from './useOutcomeRoom'
import { TeamP1Panel } from './TeamP1Panel'

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
  </>
}
