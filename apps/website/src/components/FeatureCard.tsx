import {
  Boxes,
  Braces,
  Code2,
  Cpu,
  Database,
  Film,
  GitBranch,
  LayoutDashboard,
  ShieldCheck,
  UsersRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { FeatureGroup } from '../content/features'

const icons: Record<string, LucideIcon> = {
  code: Code2,
  branch: GitBranch,
  team: UsersRound,
  runtime: Cpu,
  tools: Wrench,
  audit: ShieldCheck,
  canvas: LayoutDashboard,
  film: Film,
  provider: Database,
}

export function FeatureCard({ title, icon, summary, href, proof, items }: FeatureGroup) {
  const Icon = icons[icon] ?? Boxes
  return (
    <article className="card feature-card" id={href.split('#')[1]}>
      <div className="card-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={1.8} />
      </div>
      <h3>{title}</h3>
      <p>{summary}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="feature-proof">
        <Braces size={16} strokeWidth={1.8} />
        <span>{proof}</span>
      </div>
    </article>
  )
}
