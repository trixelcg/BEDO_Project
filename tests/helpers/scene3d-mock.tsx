import type React from 'react';
import { DEFLECTORS, WEIGHTS } from '../../src/domain/apparatus';

/**
 * Stand-in for the WebGL scene, used by the jsdom integration specs.
 *
 * `Scene3D` is the only part of the app that needs a GPU, and it contributes no
 * behaviour of its own: every mesh click calls one of the handlers `App` passes down.
 * This double exposes those same handlers as buttons, so the integration suite exercises
 * the real `App` state machine — the real guards, the real guided transitions — including
 * the two steps whose only affordance is a 3D mesh.
 *
 * One deliberate simplification: clicking the plate here calls `onCoverClick`
 * immediately, where the real `DeviceModel` plays the unscrew animation first and calls
 * the same handler when it finishes (`DeviceModel.tsx:720-739`). The state transition and
 * every guard are identical; only the animation is absent, and animation is what the
 * Playwright suite is for.
 *
 * Like the real hotspots, these stay clickable at every step — a rig cannot hide a part.
 * What happens next is `App`'s to decide: since `BEDO-020` every click here reaches the
 * same interaction gate the panel's buttons reach, which answers the lesson's question and
 * the apparatus's in that order. Before then, a click here went straight to the rig at any
 * step, and that was `BUG-04`.
 *
 * Nothing here is imported by the application.
 */
interface MockProps {
  onCoverClick: () => void;
  onSelectDeflector: (id: number) => void;
  onPowerClick: () => void;
  onFlowValveClick: () => void;
  onVolumetricValveClick: () => void;
  onAddWeight: (grams: number) => void;
}

export const Scene3D: React.FC<MockProps> = ({
  onCoverClick,
  onSelectDeflector,
  onPowerClick,
  onFlowValveClick,
  onVolumetricValveClick,
  onAddWeight,
}) => (
  <div data-testid="scene-3d">
    <button data-testid="scene-cover" onClick={onCoverClick}>
      cover
    </button>
    <button data-testid="scene-power" onClick={onPowerClick}>
      power switch
    </button>
    <button data-testid="scene-flow-valve" onClick={onFlowValveClick}>
      flow valve
    </button>
    <button data-testid="scene-volumetric-valve" onClick={onVolumetricValveClick}>
      volumetric valve
    </button>
    {DEFLECTORS.map((d) => (
      <button
        key={d.id}
        data-testid={`scene-deflector-${d.id}`}
        onClick={() => onSelectDeflector(d.id)}
      >
        {`tray deflector ${d.id}`}
      </button>
    ))}
    {WEIGHTS.filter((w) => w.mesh).map((w) => (
      <button
        key={w.grams}
        data-testid={`scene-weight-${w.grams}`}
        onClick={() => onAddWeight(w.grams)}
      >
        {`tray weight ${w.grams}`}
      </button>
    ))}
  </div>
);
