import { architectureLayers, runtimeModules } from '../content/architecture'

export function ArchitectureMap() {
  return (
    <div className="architecture-map">
      {architectureLayers.map((layer, index) => (
        <div className="arch-row" key={layer.name}>
          <div className="arch-node">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{layer.name}</strong>
            <p>{layer.detail}</p>
          </div>
          {index < architectureLayers.length - 1 && (
            <div className="arch-line" aria-hidden="true" />
          )}
        </div>
      ))}
      <div className="module-cloud">
        {runtimeModules.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  )
}
