import type { ProviderProfile, SessionListResponse } from '@spark/protocol'
import {
  isAutoRouterProvider,
  isBuiltInLocalCliProvider,
  isLocalCodexCliProvider,
} from '@spark/protocol'

type FastModeSession = Pick<SessionListResponse['sessions'][number], 'fastMode'>

/** Legacy session responses may omit fastMode; an existing session must then remain standard. */
export function resolveComposerFastMode(
  session: FastModeSession | null | undefined,
  draftFastMode: boolean,
): boolean {
  return session == null ? draftFastMode : session.fastMode === true
}

/** Built-in CLIs use their Spark override when selected, otherwise their native transport. */
export function resolveOpenAIFastModeProvider(
  selectedProvider: ProviderProfile | null | undefined,
  cliSparkProvider: ProviderProfile | null | undefined,
): ProviderProfile | null | undefined {
  return selectedProvider != null && isBuiltInLocalCliProvider(selectedProvider)
    ? (cliSparkProvider ?? selectedProvider)
    : selectedProvider
}

/**
 * UI capability check is protocol-based. Compatible third-party providers may reject Fast mode;
 * those upstream errors remain visible instead of being silently downgraded.
 */
export function supportsOpenAIFastModeProvider(
  provider: ProviderProfile | null | undefined,
): boolean {
  return (
    provider != null &&
    (!isBuiltInLocalCliProvider(provider) || isLocalCodexCliProvider(provider)) &&
    !isAutoRouterProvider(provider) &&
    provider.provider !== 'anthropic' &&
    provider.codexApiKind !== 'embedding'
  )
}
