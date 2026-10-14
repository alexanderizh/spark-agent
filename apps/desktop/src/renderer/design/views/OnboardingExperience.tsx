import { Feather, Files, CalendarCheck2, SquareTerminal } from 'lucide-react'
import { useI18n } from '../i18n'
import { SparkRibbon } from '../components/brand/SparkRibbon'
import logo from '../../assets/spark-logo.png'

/**
 * 用途卡片。文案以 i18n key 形式存放（而非字面量），由使用方在渲染时翻译：
 * 这样语言切换后能正确更新，同时 `as const` 的字面量类型（id / templateId）保持不变。
 */
export const EXPERIENCE_CASES = [
  {
    id: 'daily',
    templateId: 'general',
    titleKey: 'onboarding.useCase.dailyTitle',
    descKey: 'onboarding.useCase.dailyDesc',
    icon: Feather,
    headlineKeys: ['onboarding.useCase.dailyHeadline1', 'onboarding.useCase.dailyHeadline2'],
    captionKey: 'onboarding.useCase.dailyCaption',
  },
  {
    id: 'document',
    templateId: 'document',
    titleKey: 'onboarding.useCase.documentTitle',
    descKey: 'onboarding.useCase.documentDesc',
    icon: Files,
    headlineKeys: ['onboarding.useCase.documentHeadline1', 'onboarding.useCase.documentHeadline2'],
    captionKey: 'onboarding.useCase.documentCaption',
  },
  {
    id: 'work',
    templateId: 'work',
    titleKey: 'onboarding.useCase.workTitle',
    descKey: 'onboarding.useCase.workDesc',
    icon: CalendarCheck2,
    headlineKeys: ['onboarding.useCase.workHeadline1', 'onboarding.useCase.workHeadline2'],
    captionKey: 'onboarding.useCase.workCaption',
  },
  {
    id: 'developer',
    templateId: 'developer',
    titleKey: 'onboarding.useCase.developerTitle',
    descKey: 'onboarding.useCase.developerDesc',
    icon: SquareTerminal,
    headlineKeys: ['onboarding.useCase.developerHeadline1', 'onboarding.useCase.developerHeadline2'],
    captionKey: 'onboarding.useCase.developerCaption',
  },
] as const

export function OnboardingBanner({ useCase }: { useCase: string | null }) {
  const { t } = useI18n()
  const item = EXPERIENCE_CASES.find((item) => item.id === useCase) ?? EXPERIENCE_CASES[0]
  return (
    <aside className="experience-banner">
      <div className="experience-brand">
        <img src={logo} alt="" />
        SparkWork
      </div>
      <div className="experience-art">
        <SparkRibbon />
      </div>
      <div className="experience-story">
        <h2>
          {t(item.headlineKeys[0])}
          <br />
          {t(item.headlineKeys[1])}
        </h2>
        <p>{t(item.captionKey)}</p>
      </div>
      <footer>
        SPARKWORK <span>{t('onboarding.bannerTagline')}</span>
      </footer>
    </aside>
  )
}

export function OnboardingProgress({ phase }: { phase: number }) {
  const { t } = useI18n()
  const labels = [
    t('onboarding.progressStep1'),
    t('onboarding.progressStep2'),
    t('onboarding.progressStep3'),
  ]
  return (
    <ol className="experience-progress" aria-label={t('onboarding.progressAria')}>
      {labels.map((label, index) => (
        <li
          key={label}
          aria-current={index === phase ? 'step' : undefined}
          className={index === phase ? 'active' : ''}
        >
          <span>{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  )
}
