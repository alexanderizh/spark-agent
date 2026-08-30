import { roadmap } from '../content/roadmap'
export function RoadmapTimeline() {
  return (
    <div className="timeline">
      {roadmap.map((phase, index) => (
        <article className="timeline-item" key={phase.phase}>
          <span>{index + 1}</span>
          <h3>{phase.phase}</h3>
          <ul>
            {phase.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}
