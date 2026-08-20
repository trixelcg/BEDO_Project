/**
 * The apparatus state machine: what the rig will and will not let you do.
 *
 * ## What this answers
 *
 * *Is this action mechanically and safely valid, right now?* Nothing else. In particular
 * it does **not** answer "is this the step the lesson asked for" — that is the lesson
 * engine's question, and the two are genuinely different. Opening the flow valve during
 * step 2 is mechanically fine and pedagogically premature; only one of those is a safety
 * rule. Keeping them apart is what lets `BEDO-018`'s lesson runner and this module both
 * exist without either one having an opinion about the other.
 *
 * ## Why it exists
 *
 * The five guards from `Jet force_State machine.docx` lived inside React event handlers
 * in `App.tsx`, which meant the 3D scene's click handlers reached the same rules by a
 * different path — and `BUG-04` is exactly what happens when two paths disagree. One pure
 * function, consulted by both, makes that class of bug structurally impossible.
 *
 * ## What it is
 *
 * `attempt(state, action)` — pure, total, deterministic. No React, no DOM, no three.js,
 * no timers, no I/O, no message strings. A rejected action returns the state it was given,
 * unchanged and by identity. Reason codes are typed; the presentation layer maps them to
 * the bilingual copy the student sees (`src/lib/apparatusGate.ts`).
 *
 * Behaviour here is a faithful extraction of what the app already did — including its
 * gaps. See `docs/30` for the transition table, and for the two behaviours the state
 * machine document specifies that the app has never implemented.
 */

/**
 * The smallest state the safety rules actually read.
 *
 * Deliberately not a copy of `SimulationState`: the lesson step, the language, the
 * recorded rows, the monitor and every other application concern are absent, because no
 * apparatus rule depends on them.
 */
export interface ApparatusState {
  /** Is the tank cover lifted off? The rod and the deflector are reachable when it is. */
  readonly isCoverOpen: boolean;
  /** Is the pump running? */
  readonly isPowerOn: boolean;
  /** Flow-control valve opening, n. 0 is shut. */
  readonly valveOpening: number;
  /** The volumetric (drain) valve under the bench. */
  readonly isVolumetricValveOpen: boolean;
  /** Which deflector is on the rod, by angle. */
  readonly selectedDeflectorId: number;
  /** The discs on the weight tray, in grams, in the order they were added. */
  readonly loadedWeightsG: readonly number[];
}

/**
 * What a person can intend to do to the rig.
 *
 * Intents, not clicks: the cover is a single control in the UI, but "open it" and "close
 * it" are different actions with different rules, and only one of them can be refused.
 * Callers decide which one a click means; see `src/lib/apparatusGate.ts`.
 */
export type ApparatusAction =
  | { readonly type: 'OPEN_COVER' }
  | { readonly type: 'CLOSE_COVER' }
  | { readonly type: 'POWER_ON' }
  | { readonly type: 'POWER_OFF' }
  | { readonly type: 'SET_VALVE'; readonly opening: number }
  | { readonly type: 'OPEN_VOLUMETRIC_VALVE' }
  | { readonly type: 'CLOSE_VOLUMETRIC_VALVE' }
  | { readonly type: 'SELECT_DEFLECTOR'; readonly deflectorId: number }
  | { readonly type: 'ADD_WEIGHT'; readonly massG: number }
  | { readonly type: 'REMOVE_ALL_WEIGHTS' };

/**
 * Why an action was refused. Codes, never sentences — the domain has no language.
 *
 * The first five are the guards from BEDO's state-machine document, in its numbering:
 * `error1`..`error5`. The sixth is not one of them; it is the plain fact that a valve
 * cannot pass water the pump is not delivering, and the app has always presented it more
 * gently than a safety refusal.
 */
export type RejectionReason =
  /** error1 — weights may not go on the tray while the tank is open. */
  | 'WEIGHTS_BLOCKED_BY_OPEN_COVER'
  /** error2 — the rod is inside the tank; the cover has to come off first. */
  | 'DEFLECTOR_NEEDS_OPEN_COVER'
  /** error3 — the tank may not be opened while the pump is running. */
  | 'COVER_BLOCKED_BY_POWER'
  /** error4 — the pump may not be started while the tank is open. */
  | 'POWER_BLOCKED_BY_OPEN_COVER'
  /** error5 — the tray must be cleared before the tank is opened. */
  | 'COVER_BLOCKED_BY_WEIGHTS'
  /** Not a documented guard: the pump is not running, so the valve has nothing to open. */
  | 'VALVE_NEEDS_RUNNING_PUMP';

export type TransitionResult =
  | {
      readonly ok: true;
      readonly state: ApparatusState;
      /**
       * False when the action was legal but the rig was already in that condition —
       * closing a closed cover, say. The state is returned by identity in that case.
       */
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      /** The state as given. A refusal never changes anything. */
      readonly state: ApparatusState;
      readonly reason: RejectionReason;
    };

const accept = (next: ApparatusState): TransitionResult => ({
  ok: true,
  state: next,
  changed: true,
});

/** The action was legal but there was nothing to do. */
const unchanged = (state: ApparatusState): TransitionResult => ({
  ok: true,
  state,
  changed: false,
});

const reject = (state: ApparatusState, reason: RejectionReason): TransitionResult => ({
  ok: false,
  state,
  reason,
});

/**
 * Applies an action to the apparatus, or explains why it cannot be.
 *
 * Total: every action is handled, and no input throws. Pure: `state` is never mutated,
 * and the same pair always produces the same result.
 */
export function attempt(state: ApparatusState, action: ApparatusAction): TransitionResult {
  switch (action.type) {
    case 'OPEN_COVER': {
      if (state.isCoverOpen) return unchanged(state);
      // Order matters and is asserted: a running pump is reported before a loaded tray,
      // which is what the app has always done when both are true.
      if (state.isPowerOn) return reject(state, 'COVER_BLOCKED_BY_POWER');
      if (state.loadedWeightsG.length > 0) return reject(state, 'COVER_BLOCKED_BY_WEIGHTS');
      return accept({ ...state, isCoverOpen: true });
    }

    case 'CLOSE_COVER': {
      // Always allowed. Closing the tank cannot be unsafe.
      if (!state.isCoverOpen) return unchanged(state);
      return accept({ ...state, isCoverOpen: false });
    }

    case 'POWER_ON': {
      if (state.isPowerOn) return unchanged(state);
      if (state.isCoverOpen) return reject(state, 'POWER_BLOCKED_BY_OPEN_COVER');
      return accept({ ...state, isPowerOn: true });
    }

    case 'POWER_OFF': {
      if (!state.isPowerOn) return unchanged(state);
      // The valve shuts with the pump: the app has always zeroed it here, so a restart
      // never resumes at the previous flow.
      return accept({ ...state, isPowerOn: false, valveOpening: 0 });
    }

    case 'SET_VALVE': {
      // Shutting the valve is always legal; opening it needs a running pump.
      if (!state.isPowerOn && action.opening > 0) {
        return reject(state, 'VALVE_NEEDS_RUNNING_PUMP');
      }
      if (state.valveOpening === action.opening) return unchanged(state);
      // The opening is taken as given. The app clamps it at the slider and snaps it to
      // the reading setpoints in the lesson layer, because both are lesson concerns; see
      // docs/30 §7.
      return accept({ ...state, valveOpening: action.opening });
    }

    case 'OPEN_VOLUMETRIC_VALVE': {
      if (state.isVolumetricValveOpen) return unchanged(state);
      return accept({ ...state, isVolumetricValveOpen: true });
    }

    case 'CLOSE_VOLUMETRIC_VALVE': {
      if (!state.isVolumetricValveOpen) return unchanged(state);
      return accept({ ...state, isVolumetricValveOpen: false });
    }

    case 'SELECT_DEFLECTOR': {
      if (!state.isCoverOpen) return reject(state, 'DEFLECTOR_NEEDS_OPEN_COVER');
      if (state.selectedDeflectorId === action.deflectorId) return unchanged(state);
      // No check that the deflector belongs to the loaded experiment: the app has never
      // had one, and adding it here would be `BUG-05` fixed by accident. BEDO-022.
      return accept({ ...state, selectedDeflectorId: action.deflectorId });
    }

    case 'ADD_WEIGHT': {
      if (state.isCoverOpen) return reject(state, 'WEIGHTS_BLOCKED_BY_OPEN_COVER');
      return accept({
        ...state,
        loadedWeightsG: [...state.loadedWeightsG, action.massG],
      });
    }

    case 'REMOVE_ALL_WEIGHTS': {
      if (state.loadedWeightsG.length === 0) return unchanged(state);
      // Clearing the tray is unguarded, including while the tank is open — which is how
      // a student recovers from error5. Removing a *single* disc by clicking it on the
      // holder is specified but has never been implemented; see docs/30 §8.
      return accept({ ...state, loadedWeightsG: [] });
    }
  }
}

/** The rig as it powers up: shut, off, drained, nothing on the tray. */
export const restingState = (selectedDeflectorId: number): ApparatusState => ({
  isCoverOpen: false,
  isPowerOn: false,
  valveOpening: 0,
  isVolumetricValveOpen: false,
  selectedDeflectorId,
  loadedWeightsG: [],
});
