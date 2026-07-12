import type { OnboardingStep } from './OnboardingView'

import agentTemplatePoster from '../../assets/onboarding-posters/agent-template-v1.png'
import canvasGuidePoster from '../../assets/onboarding-posters/canvas-guide-v1.png'
import connectionTestPoster from '../../assets/onboarding-posters/connection-test-v1.png'
import firstSessionPoster from '../../assets/onboarding-posters/first-session-v1.png'
import localCliPoster from '../../assets/onboarding-posters/local-cli-v1.png'
import modelSourcePoster from '../../assets/onboarding-posters/model-source-v1.png'
import skillsGuidePoster from '../../assets/onboarding-posters/skills-guide-v1.png'
import sparkAccountPoster from '../../assets/onboarding-posters/spark-account-v1.png'
import thirdPartyProviderPoster from '../../assets/onboarding-posters/third-party-provider-v1.png'
import welcomePoster from '../../assets/onboarding-posters/welcome-v1.png'

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
