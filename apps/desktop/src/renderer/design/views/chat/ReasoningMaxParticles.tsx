import type { CSSProperties } from 'react'

type ParticleZone = 'left' | 'right'

type Particle = {
  zone: ParticleZone
  x: number
  y: number
  size: number
  driftX: number
  driftY: number
  duration: number
  delay: number
  opacity: number
}

type ParticleStyle = CSSProperties & {
  '--reasoning-particle-x': string
  '--reasoning-particle-y': string
  '--reasoning-particle-size': string
  '--reasoning-particle-drift-x': string
  '--reasoning-particle-drift-y': string
  '--reasoning-particle-duration': string
  '--reasoning-particle-delay': string
  '--reasoning-particle-opacity': string
}

const PARTICLES: Particle[] = [
  { zone: 'left', x: 5, y: 31, size: 2, driftX: 12, driftY: 2, duration: 5.2, delay: -1.4, opacity: 0.28 },
  { zone: 'left', x: 16, y: 72, size: 2, driftX: 15, driftY: -3, duration: 5.5, delay: -3.1, opacity: 0.31 },
  { zone: 'left', x: 27, y: 45, size: 2, driftX: 13, driftY: 1, duration: 4.9, delay: -0.7, opacity: 0.34 },
  { zone: 'left', x: 38, y: 25, size: 2, driftX: 16, driftY: 3, duration: 5.1, delay: -2.3, opacity: 0.37 },
  { zone: 'left', x: 47, y: 74, size: 2, driftX: 14, driftY: -2, duration: 4.8, delay: -4.2, opacity: 0.4 },
  { zone: 'right', x: 54, y: 36, size: 3, driftX: 17, driftY: 2, duration: 4.4, delay: -1.8, opacity: 0.43 },
  { zone: 'right', x: 59, y: 65, size: 2, driftX: 13, driftY: -2, duration: 5, delay: -3.7, opacity: 0.45 },
  { zone: 'right', x: 64, y: 20, size: 2, driftX: 17, driftY: 3, duration: 4.6, delay: -0.9, opacity: 0.47 },
  { zone: 'right', x: 68, y: 48, size: 3, driftX: 14, driftY: -1, duration: 4.2, delay: -2.8, opacity: 0.49 },
  { zone: 'right', x: 72, y: 77, size: 2, driftX: 15, driftY: -3, duration: 5.1, delay: -4.1, opacity: 0.51 },
  { zone: 'right', x: 76, y: 29, size: 2, driftX: 12, driftY: 2, duration: 4.7, delay: -2.1, opacity: 0.53 },
  { zone: 'right', x: 79, y: 58, size: 3, driftX: 14, driftY: -2, duration: 4.1, delay: -3.3, opacity: 0.55 },
  { zone: 'right', x: 82, y: 16, size: 2, driftX: 13, driftY: 3, duration: 4.8, delay: -1.1, opacity: 0.57 },
  { zone: 'right', x: 85, y: 76, size: 2, driftX: 11, driftY: -2, duration: 4.5, delay: -2.6, opacity: 0.59 },
  { zone: 'right', x: 88, y: 40, size: 3, driftX: 12, driftY: 1, duration: 4, delay: -3.8, opacity: 0.61 },
  { zone: 'right', x: 91, y: 65, size: 2, driftX: 10, driftY: -3, duration: 4.6, delay: -0.6, opacity: 0.63 },
  { zone: 'right', x: 93, y: 23, size: 2, driftX: 9, driftY: 2, duration: 4.3, delay: -2.5, opacity: 0.65 },
  { zone: 'right', x: 95, y: 51, size: 3, driftX: 8, driftY: -1, duration: 3.9, delay: -1.7, opacity: 0.67 },
  { zone: 'right', x: 97, y: 78, size: 2, driftX: 7, driftY: -2, duration: 4.4, delay: -3.5, opacity: 0.69 },
  { zone: 'right', x: 98, y: 31, size: 2, driftX: 6, driftY: 2, duration: 4.1, delay: -0.8, opacity: 0.71 },
]

export function ReasoningMaxParticles() {
  return (
    <span className="composer-reasoning-particles" aria-hidden="true">
      {PARTICLES.map((particle, index) => {
        const style: ParticleStyle = {
          '--reasoning-particle-x': `${particle.x}%`,
          '--reasoning-particle-y': `${particle.y}%`,
          '--reasoning-particle-size': `${particle.size}px`,
          '--reasoning-particle-drift-x': `${particle.driftX}px`,
          '--reasoning-particle-drift-y': `${particle.driftY}px`,
          '--reasoning-particle-duration': `${particle.duration}s`,
          '--reasoning-particle-delay': `${particle.delay}s`,
          '--reasoning-particle-opacity': String(particle.opacity),
        }

        return (
          <span
            key={index}
            className="composer-reasoning-particle"
            data-reasoning-particle
            data-particle-zone={particle.zone}
            style={style}
          />
        )
      })}
    </span>
  )
}
