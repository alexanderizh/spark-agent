import type { CSSProperties } from 'react'

type ParticleZone = 'left' | 'right'

type Particle = {
  zone: ParticleZone
  x: number
  y: number
  size: number
  tail: number
  duration: number
  delay: number
  opacity: number
}

type ParticleStyle = CSSProperties & {
  '--reasoning-particle-x': string
  '--reasoning-particle-y': string
  '--reasoning-particle-size': string
  '--reasoning-particle-tail': string
  '--reasoning-particle-duration': string
  '--reasoning-particle-delay': string
  '--reasoning-particle-opacity': string
}

const PARTICLES: Particle[] = [
  { zone: 'left', x: 12, y: 28, size: 2, tail: 8, duration: 3.8, delay: -1.2, opacity: 0.62 },
  { zone: 'left', x: 31, y: 69, size: 2, tail: 9, duration: 4.4, delay: -3.1, opacity: 0.58 },
  { zone: 'left', x: 48, y: 40, size: 2, tail: 8, duration: 3.7, delay: -0.7, opacity: 0.68 },
  { zone: 'right', x: 61, y: 22, size: 2, tail: 10, duration: 4.1, delay: -2.2, opacity: 0.7 },
  { zone: 'right', x: 71, y: 70, size: 2, tail: 9, duration: 3.6, delay: -1.8, opacity: 0.74 },
  { zone: 'right', x: 80, y: 38, size: 2, tail: 11, duration: 4.2, delay: -3.4, opacity: 0.82 },
  { zone: 'right', x: 88, y: 62, size: 2, tail: 10, duration: 3.5, delay: -0.9, opacity: 0.86 },
  { zone: 'right', x: 94, y: 24, size: 2, tail: 12, duration: 4, delay: -2.6, opacity: 0.9 },
]

export function ReasoningMaxParticles() {
  return (
    <span className="composer-reasoning-particles" aria-hidden="true">
      {PARTICLES.map((particle, index) => {
        const style: ParticleStyle = {
          '--reasoning-particle-x': `${particle.x}%`,
          '--reasoning-particle-y': `${particle.y}%`,
          '--reasoning-particle-size': `${particle.size}px`,
          '--reasoning-particle-tail': `${particle.tail}px`,
          '--reasoning-particle-duration': `${particle.duration}s`,
          '--reasoning-particle-delay': `${particle.delay}s`,
          '--reasoning-particle-opacity': String(particle.opacity),
        }

        return (
          <span
            key={index}
            className="composer-reasoning-comet"
            data-reasoning-particle
            data-particle-zone={particle.zone}
            style={style}
          />
        )
      })}
    </span>
  )
}
