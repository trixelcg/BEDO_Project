import { useCallback, useEffect, useMemo, useState } from 'react';
import { Scene3D } from './components/Scene3D';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import type { ExperimentId, SimulationState } from './types/index';
import { attempt, type ApparatusAction } from './domain/stateMachine';
import {
  toApparatusState,
  withApparatusState,
  withRejection,
} from './lib/apparatusGate';
import { getDeflector } from './domain/apparatus';
import { buildSteps, getExperiment, deflectorsFor } from './domain/experiments';
import { markReady } from './lib/readiness';
import { SCENE_CONFIG } from './lib/sceneConfig';
import {
  FIRST_READING_VALVE,
  ROW_VALVE_SETTINGS,
  SECOND_READING_VALVE,
  TOTAL_FLOW_L_MIN,
  VALVE_SNAP_MARGIN,
  computeRow,
} from './domain/physics';
import './index.css';

const initialState = (
  language: SimulationState['language'] = 'en',
  experimentId: ExperimentId = 'flat'
): SimulationState => ({
  mode: 'guided',
  experimentId,
  currentStep: 1,
  language,
  selectedDeflectorId: getExperiment(experimentId).defaultAngle,
  isCoverOpen: false,
  isPowerOn: false,
  valveOpening: 0.0,
  loadedWeightsG: [],
  isVolumetricValveOpen: false,
  recordedRows: [],
  currentRecordIndex: 0,
  showMonitor: false,
  isCalculated: false,
  quizAnswer: null,
  params: { pumpFlowLMin: TOTAL_FLOW_L_MIN, customWeightG: 25 },
  warningMessage: null,
  notice: null,
});

/** Steps where the student is loading weights, and the table row each one fills in. */
const BALANCE_ROW: Record<number, number> = { 7: 1, 9: 2 };

export default function App() {
  const [state, setState] = useState<SimulationState>(() => initialState());

  const experiment = useMemo(() => getExperiment(state.experimentId), [state.experimentId]);
  const steps = useMemo(() => {
    const d = getDeflector(state.selectedDeflectorId);
    return buildSteps(d.nameEn, d.nameAr);
  }, [state.selectedDeflectorId]);

  // Keep the results table in step with the apparatus. The row the student is currently
  // balancing shows the live weights; rows already taken keep theirs.
  useEffect(() => {
    setState((prev) => {
      const activeRow = BALANCE_ROW[prev.currentStep];

      const recordedRows = ROW_VALVE_SETTINGS.map((n, idx) => {
        const weights =
          idx === activeRow
            ? prev.loadedWeightsG
            : idx < prev.currentRecordIndex
              ? (prev.recordedRows[idx]?.loadedWeightsG ?? [])
              : [];

        return computeRow(idx, n, prev.selectedDeflectorId, weights, prev.params.pumpFlowLMin);
      });

      return { ...prev, recordedRows };
    });
  }, [
    state.selectedDeflectorId,
    state.loadedWeightsG,
    state.currentStep,
    state.currentRecordIndex,
    state.params.pumpFlowLMin,
  ]);

  /**
   * Every apparatus action goes through the domain state machine (BEDO-006).
   *
   * `attempt` decides whether the rig allows it and returns either the new apparatus
   * state or a typed reason; this turns that into application state — the refusal banner,
   * and any guided step the successful action completes. The 3D scene and the control
   * panel both arrive here, so they cannot disagree about the rules.
   *
   * `advanceOnSuccess` is the lesson's business, not the apparatus's: the state machine
   * has no idea what step the student is on, and this is where the two meet.
   */
  const dispatchApparatus = useCallback(
    (
      action: ApparatusAction,
      advanceOnSuccess?: (prev: SimulationState) => Partial<SimulationState>
    ) => {
      setState((prev) => {
        const result = attempt(toApparatusState(prev), action);
        if (!result.ok) return withRejection(prev, result.reason);

        const next = withApparatusState(prev, result.state);
        return {
          ...next,
          warningMessage: null,
          ...(advanceOnSuccess?.(prev) ?? {}),
        };
      });
    },
    []
  );

  const clearWarning = useCallback(
    () => setState((prev) => ({ ...prev, warningMessage: null })),
    []
  );
  const clearNotice = useCallback(() => setState((prev) => ({ ...prev, notice: null })), []);

  /** Raise the step's observation popup, if it has one and we are guiding. */
  const noticeFor = (prev: SimulationState, step: number) => {
    if (prev.mode !== 'guided') return null;
    const s = steps.find((x) => x.id === step);
    return s?.noticeEn ? { en: s.noticeEn, ar: s.noticeAr ?? s.noticeEn } : null;
  };

  /** In guided mode, advance only when the action matches the step being asked for. */
  const advance = (prev: SimulationState, from: number, to: number): Partial<SimulationState> =>
    prev.mode === 'guided' && prev.currentStep === from
      ? { currentStep: to, notice: noticeFor(prev, from) }
      : {};

  // --- Cover (steps 1 and 3) --------------------------------------------------
  const handleCoverClick = () => {
    // One control, two intents: which one a click means depends on where the plate is.
    setState((prev) => {
      const action: ApparatusAction = prev.isCoverOpen
        ? { type: 'CLOSE_COVER' }
        : { type: 'OPEN_COVER' };
      const result = attempt(toApparatusState(prev), action);
      if (!result.ok) return withRejection(prev, result.reason);

      const next = withApparatusState(prev, result.state);
      return {
        ...next,
        warningMessage: null,
        ...(next.isCoverOpen ? advance(prev, 1, 2) : advance(prev, 3, 4)),
      };
    });
  };

  // --- Deflector (step 2) ------------------------------------------------------
  const handleSelectDeflector = (id: number) =>
    dispatchApparatus({ type: 'SELECT_DEFLECTOR', deflectorId: id });

  // --- Power (step 4) ----------------------------------------------------------
  const handleTogglePower = () => {
    setState((prev) => {
      const action: ApparatusAction = prev.isPowerOn ? { type: 'POWER_OFF' } : { type: 'POWER_ON' };
      const result = attempt(toApparatusState(prev), action);
      if (!result.ok) return withRejection(prev, result.reason);

      const next = withApparatusState(prev, result.state);
      return {
        ...next,
        warningMessage: null,
        ...(next.isPowerOn ? advance(prev, 4, 5) : {}),
      };
    });
  };

  // --- Volumetric valve (step 5) ----------------------------------------------
  const handleToggleVolumetricValve = () =>
    setState((prev) => {
      const action: ApparatusAction = prev.isVolumetricValveOpen
        ? { type: 'CLOSE_VOLUMETRIC_VALVE' }
        : { type: 'OPEN_VOLUMETRIC_VALVE' };
      const result = attempt(toApparatusState(prev), action);
      if (!result.ok) return withRejection(prev, result.reason);
      return { ...withApparatusState(prev, result.state), warningMessage: null };
    });

  // --- Flow valve (steps 6 and 8) ---------------------------------------------
  /**
   * The valve snaps to a reading setpoint once the student is within the margin of it.
   *
   * That is a **lesson** rule, not an apparatus one — it exists so steps 6 and 8 land on
   * the exact openings the results table is computed at — so it is applied here, before
   * the domain sees the value. The state machine only asks whether the pump is running.
   */
  const snapToReadingSetpoint = (opening: number, step: number): number => {
    if (step === 6 && opening >= FIRST_READING_VALVE - VALVE_SNAP_MARGIN) {
      return FIRST_READING_VALVE;
    }
    if (step === 8 && opening >= SECOND_READING_VALVE - VALVE_SNAP_MARGIN) {
      return SECOND_READING_VALVE;
    }
    return opening;
  };

  const handleSetValve = (val: number) =>
    setState((prev) => {
      const result = attempt(toApparatusState(prev), { type: 'SET_VALVE', opening: val });
      if (!result.ok) return withRejection(prev, result.reason);

      // Snap after the gate, so a rejected setting never moves the valve at all.
      const opening = snapToReadingSetpoint(val, prev.currentStep);
      const snapped = attempt(toApparatusState(prev), { type: 'SET_VALVE', opening });
      if (!snapped.ok) return withRejection(prev, snapped.reason);

      return { ...withApparatusState(prev, snapped.state), warningMessage: null };
    });

  const handleFlowValveClick = () =>
    handleSetValve(state.currentStep === 8 ? SECOND_READING_VALVE : FIRST_READING_VALVE);

  // --- Weights (steps 7 and 9) -------------------------------------------------
  const handleAddWeight = (weight: number) =>
    dispatchApparatus({ type: 'ADD_WEIGHT', massG: weight });

  const handleClearWeights = () => dispatchApparatus({ type: 'REMOVE_ALL_WEIGHTS' });

  // --- Guided progression ------------------------------------------------------
  const handleStepOkClick = () => {
    clearWarning();
    clearNotice();

    setState((prev) => {
      const next: SimulationState = { ...prev };

      switch (prev.currentStep) {
        case 2:
          next.currentStep = 3;
          break;
        case 5:
          next.isVolumetricValveOpen = true;
          next.currentStep = 6;
          break;
        case 6:
          next.valveOpening = FIRST_READING_VALVE;
          next.currentStep = 7;
          next.currentRecordIndex = 1;
          break;
        case 7:
          next.currentStep = 8;
          next.currentRecordIndex = 2;
          next.loadedWeightsG = [];
          break;
        case 8:
          next.valveOpening = SECOND_READING_VALVE;
          next.currentStep = 9;
          break;
        case 9:
          next.currentStep = 10;
          next.currentRecordIndex = 3;
          next.loadedWeightsG = [];
          break;
        case 10:
          next.showMonitor = true;
          next.currentStep = 11;
          break;
        case 11:
          next.currentStep = 12;
          break;
      }

      next.notice = noticeFor(prev, prev.currentStep);
      return next;
    });
  };

  /** Step 11 — record F_ac in the table. */
  const handleCalculate = () => {
    setState((prev) => ({
      ...prev,
      isCalculated: true,
      ...(prev.mode === 'guided' && prev.currentStep === 11
        ? { currentStep: 12, notice: noticeFor(prev, 11) }
        : {}),
    }));
  };

  const handleAnswerQuiz = (choice: number) =>
    setState((prev) => ({ ...prev, quizAnswer: choice }));

  const handleToggleMonitor = () => {
    clearWarning();
    setState((prev) => ({
      ...prev,
      showMonitor: !prev.showMonitor,
      ...(prev.mode === 'guided' && prev.currentStep === 10 && !prev.showMonitor
        ? { currentStep: 11 }
        : {}),
    }));
  };

  const handleSetMode = (mode: SimulationState['mode']) =>
    setState((prev) => ({ ...prev, mode, warningMessage: null, notice: null }));

  /** Switching experiment reloads the rig with that sheet's deflector. */
  const handleSelectExperiment = (experimentId: ExperimentId) =>
    setState((prev) => initialState(prev.language, experimentId));

  const handleSetParams = (params: Partial<SimulationState['params']>) =>
    setState((prev) => ({ ...prev, params: { ...prev.params, ...params } }));

  const handleReset = () => setState(initialState(state.language, state.experimentId));

  // The shell is mounted and interactive from here. See src/lib/readiness.ts.
  useEffect(() => markReady('app'), []);

  /**
   * Dev-only test adapter (BEDO-002 §7).
   *
   * The tank cover is the one control with no DOM equivalent — steps 1 and 3 are
   * performed by clicking a mesh inside the WebGL canvas. Rather than have the E2E hunt
   * for screen coordinates on a 3D view that reframes itself between steps, it calls the
   * very handler the mesh calls, so every guard and every guided transition still runs.
   *
   * `import.meta.env.DEV` is compiled to the literal `false` by `vite build`, so this
   * block is dead code the bundler drops; `tests/unit/bundle.spec.ts` asserts the symbol
   * is absent from `dist/`.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__bedoTest = {
      coverClick: handleCoverClick,
    };
  });

  const deflector = getDeflector(state.selectedDeflectorId);
  const deflectorName = state.language === 'ar' ? deflector.nameAr : deflector.nameEn;

  return (
    <div className="app-container">
      <Scene3D
        state={state}
        steps={steps}
        sceneConfig={SCENE_CONFIG}
        onCoverClick={handleCoverClick}
        onSelectDeflector={handleSelectDeflector}
        onPowerClick={handleTogglePower}
        onFlowValveClick={handleFlowValveClick}
        onVolumetricValveClick={handleToggleVolumetricValve}
        onAddWeight={handleAddWeight}
      />

      <UIOverlay
        state={state}
        steps={steps}
        experiment={experiment}
        availableDeflectors={deflectorsFor(state.experimentId)}
        onSelectLanguage={(lang) => setState((prev) => ({ ...prev, language: lang }))}
        onSetMode={handleSetMode}
        onSelectExperiment={handleSelectExperiment}
        onSetParams={handleSetParams}
        onSelectDeflector={handleSelectDeflector}
        onSetValve={handleSetValve}
        onAddWeight={handleAddWeight}
        onClearWeights={handleClearWeights}
        onTogglePower={handleTogglePower}
        onToggleVolumetricValve={handleToggleVolumetricValve}
        onToggleMonitor={handleToggleMonitor}
        onReset={handleReset}
        clearWarning={clearWarning}
        clearNotice={clearNotice}
        onOkClick={handleStepOkClick}
      />

      {state.showMonitor && (
        <SoftwareMonitor
          state={state}
          experiment={experiment}
          deflectorName={deflectorName}
          onCalculate={handleCalculate}
          onAnswerQuiz={handleAnswerQuiz}
          onClose={handleToggleMonitor}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
