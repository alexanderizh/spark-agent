import type { OnboardingStep } from './OnboardingView'
import { onboardingPosterUrl } from '../assets/remoteAssetUrls'

const agentTemplatePoster = onboardingPosterUrl('agent-template-v1.png')
const canvasGuidePoster = onboardingPosterUrl('canvas-guide-v1.png')
const connectionTestPoster = onboardingPosterUrl('connection-test-v1.png')
const firstSessionPoster = onboardingPosterUrl('first-session-v1.png')
const localCliPoster = onboardingPosterUrl('local-cli-v1.png')
const modelSourcePoster = onboardingPosterUrl('model-source-v1.png')
const skillsGuidePoster = onboardingPosterUrl('skills-guide-v1.png')
const sparkAccountPoster = onboardingPosterUrl('spark-account-v1.png')
const thirdPartyProviderPoster = onboardingPosterUrl('third-party-provider-v1.png')
const welcomePoster = onboardingPosterUrl('welcome-v1.png')

export const ONBOARDING_POSTERS: Record<OnboardingStep, string> = {
  welcome: welcomePoster,
  'model-source': modelSourcePoster,
  'spark-account': sparkAccountPoster,
  'third-party-provider': thirdPartyProviderPoster,
  'local-cli': localCliPoster,
  'connection-test': connectionTestPoster,
  'agent-template': agentTemplatePoster,
  'first-session': firstSessionPoster,
  'canvas-guide': canvasGuidePoster,
  'skills-guide': skillsGuidePoster,
  'workflows-guide': modelSourcePoster,
  'media-guide': firstSessionPoster,
  done: welcomePoster,
}
