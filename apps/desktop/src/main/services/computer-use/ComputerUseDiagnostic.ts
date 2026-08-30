/**
 * Structured, machine-readable diagnostics attached to Computer Use errors.
 *
 * The wire error `code` is a coarse, schema-validated enum that cannot grow without a
 * protocol migration. `diagnosticCode` carries the fine-grained sub-classification
 * (e.g. `host_handshake_mismatch`, `screen_permission_missing`, `artifact_version_too_low`)
 * while `stage` names the pipeline phase that produced the failure and `repairAction`
 * offers an actionable, user-facing remediation hint. None of these fields ever alter a
 * policy decision; they only make an existing failure easier to surface and recover from.
 *
 * Kept in a standalone module so both {@link ComputerUseBrokerError} (transport/runtime
 * failures) and {@link NativeHostArtifactError} (artifact trust failures) can share the
 * same shape without either domain depending on the other.
 */
export interface ComputerUseDiagnostic {
  readonly diagnosticCode: string
  readonly stage:
    | 'discover'
    | 'verify'
    | 'spawn'
    | 'handshake'
    | 'observe'
    | 'execute'
    | 'persist'
    | 'verify_task'
    | 'approve'
  readonly repairAction?: string
}
