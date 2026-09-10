import { Feather, Files, CalendarCheck2, SquareTerminal } from 'lucide-react'
import { SparkRibbon } from '../components/brand/SparkRibbon'
import logo from '../../assets/spark-logo.png'

export const EXPERIENCE_CASES = [
  {
    id: 'daily',
    templateId: 'general',
    title: '写作与表达',
    desc: '写文章、润色邮件、整理思路',
    icon: Feather,
    headline: ['让表达，', '更进一步。'],
    caption: '邮件、文章与灵感，都有一个好的开始。',
  },
  {
    id: 'document',
    templateId: 'document',
    title: '资料与文件',
    desc: '读文档、提炼重点、整理信息',
    icon: Files,
    headline: ['让信息，', '清晰起来。'],
    caption: '从繁杂资料中，找到真正重要的内容。',
  },
  {
    id: 'work',
    templateId: 'work',
    title: '日常工作',
    desc: '做计划、写总结、拆解任务',
    icon: CalendarCheck2,
    headline: ['让每天，', '从容一些。'],
    caption: '理清优先级，为重要的事情留出时间。',
  },
  {
    id: 'developer',
    templateId: 'developer',
    title: '代码与创造',
    desc: '理解项目、开发功能、自动化',
    icon: SquareTerminal,
    headline: ['让创造，', '发生得更快。'],
    caption: '从第一行代码，到下一次突破。',
  },
] as const
export function OnboardingBanner({ useCase }: { useCase: string | null }) {
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
          {item.headline[0]}
          <br />
          {item.headline[1]}
        </h2>
        <p>{item.caption}</p>
      </div>
      <footer>
        SPARKWORK <span>一点灵感，无限可能</span>
      </footer>
    </aside>
  )
}
export function OnboardingProgress({ phase }: { phase: number }) {
  return (
    <ol className="experience-progress" aria-label="新手引导进度">
      {['选择用途', '连接 AI', '开始创作'].map((label, index) => (
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
