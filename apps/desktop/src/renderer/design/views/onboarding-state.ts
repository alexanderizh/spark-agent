const ONBOARDING_COMPLETED_KEY = 'spark-agent:onboarding-completed'
const ONBOARDING_DISMISSED_KEY = 'spark-agent:onboarding-dismissed'
const ONBOARDING_SETTINGS_CATEGORY = 'onboarding'
const ONBOARDING_SETTINGS_KEY = 'data'

type OnboardingStateRecord = {
  completed: boolean
  dismissed: boolean
}

function readLocalOnboarding(): OnboardingStateRecord {
  if (typeof window === 'undefined') return { completed: false, dismissed: false }
  return {
    completed: window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true',
    dismissed: window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === 'true',
  }
}

export function writeOnboardingState(state: OnboardingStateRecord): void {
  window.spark
    ?.invoke('settings:set', {
      category: ONBOARDING_SETTINGS_CATEGORY,
      key: ONBOARDING_SETTINGS_KEY,
      value: state,
    })
    .catch(() => {
      // IPC 失败不阻塞当前引导；下次启动仍会重新判定。
    })
}

async function readRemoteOnboarding(): Promise<OnboardingStateRecord> {
  try {
    const res = await window.spark?.invoke('settings:get', {
      category: ONBOARDING_SETTINGS_CATEGORY,
      key: ONBOARDING_SETTINGS_KEY,
    })
    const value = res?.value
    if (value != null && typeof value === 'object') {
      const record = value as Partial<OnboardingStateRecord>
      return {
        completed: record.completed === true,
        dismissed: record.dismissed === true,
      }
    }

    const local = readLocalOnboarding()
    if (local.completed || local.dismissed) {
      await window.spark?.invoke('settings:set', {
        category: ONBOARDING_SETTINGS_CATEGORY,
        key: ONBOARDING_SETTINGS_KEY,
        value: local,
      })
      window.localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
      window.localStorage.removeItem(ONBOARDING_DISMISSED_KEY)
    }
    return local
  } catch {
    return readLocalOnboarding()
  }
}

export function clearOnboardingState(): void {
  window.spark
    ?.invoke('settings:set', {
      category: ONBOARDING_SETTINGS_CATEGORY,
      key: ONBOARDING_SETTINGS_KEY,
      value: null,
    })
    .catch(() => {
      /* ignore */
    })
}

export async function shouldShowOnboardingAsync(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const { completed, dismissed } = await readRemoteOnboarding()
  return !completed && !dismissed
}
