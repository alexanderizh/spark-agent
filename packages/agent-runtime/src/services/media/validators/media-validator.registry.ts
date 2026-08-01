import type { MediaProviderKind } from '@spark/protocol'
import { validateAgnesMediaRequest } from './agnes-media.validator.js'
import { validateApimartMediaRequest } from './apimart-media.validator.js'
import { validateGoogleGenerativeAiMediaRequest } from './google-generative-ai-media.validator.js'
import { validateMidjourneyMediaRequest } from './midjourney-media.validator.js'
import { validateMinimaxHailuoMediaRequest } from './minimax-hailuo-media.validator.js'
import { validateOpenAiCompatibleMediaRequest } from './openai-compatible-media.validator.js'
import { validateTencentTokenhubMediaRequest } from './tencent-tokenhub-media.validator.js'
import { validateVolcengineArkMediaRequest } from './volcengine-ark-media.validator.js'
import { validateXaiMediaRequest } from './xai-media.validator.js'
import type { MediaProviderValidator } from './media-validator.types.js'

const VALIDATORS = new Map<MediaProviderKind, MediaProviderValidator>([
  ['xai', validateXaiMediaRequest],
  ['agnes', validateAgnesMediaRequest],
  ['openai-compatible', validateOpenAiCompatibleMediaRequest],
  ['openai-images', validateOpenAiCompatibleMediaRequest],
  ['apimart', validateApimartMediaRequest],
  ['google-generative-ai', validateGoogleGenerativeAiMediaRequest],
  ['omni', validateGoogleGenerativeAiMediaRequest],
  ['volcengine-ark', validateVolcengineArkMediaRequest],
  ['midjourney', validateMidjourneyMediaRequest],
  ['tencent-tokenhub', validateTencentTokenhubMediaRequest],
  ['minimax-hailuo', validateMinimaxHailuoMediaRequest],
])

export function mediaProviderValidator(
  providerKind: MediaProviderKind,
): MediaProviderValidator | undefined {
  return VALIDATORS.get(providerKind)
}
