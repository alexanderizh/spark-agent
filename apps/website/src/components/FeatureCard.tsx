export function FeatureCard({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="card feature-card">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  )
}
