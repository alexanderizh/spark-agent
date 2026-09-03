export function Section({
  eyebrow,
  title,
  intro,
  headingLevel = 2,
  children,
}: {
  eyebrow?: string
  title: string
  intro?: string
  headingLevel?: 1 | 2
  children: React.ReactNode
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <section className="section">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <Heading>{title}</Heading>
      {intro && <p className="section-intro">{intro}</p>}
      {children}
    </section>
  )
}
