import { registerTeamEvidenceCostIpc } from './registerTeamEvidenceCostIpc.js'
import { registerTeamReplayPlaybookIpc } from './registerTeamReplayPlaybookIpc.js'
import { registerTeamRuntimeIpc } from './registerTeamRuntimeIpc.js'

type Registrar = () => void

/** Single wiring point for the P2 Team/Outcome IPC registrars. */
export function registerTeamOutcomeIpc(options: {
  registerRuntime?: Registrar
  registerEvidenceCost?: Registrar
  registerReplayPlaybook?: Registrar
} = {}): void {
  const registerRuntime = options.registerRuntime ?? registerTeamRuntimeIpc
  const registerEvidenceCost = options.registerEvidenceCost ?? registerTeamEvidenceCostIpc
  const registerReplayPlaybook = options.registerReplayPlaybook ?? registerTeamReplayPlaybookIpc
  registerRuntime()
  registerEvidenceCost()
  registerReplayPlaybook()
}
