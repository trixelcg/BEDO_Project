import { useCallback, useEffect, useMemo, useState } from 'react';
import { Scene3D } from './components/Scene3D';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import type { ErrorCode, Language, Mode, SimulationView } from './types/index';
import type { ApparatusAction, RejectionReason } from './domain/stateMachine';
import { REJECTION_PRESENTATION } from './lib/apparatusGate';
import { getDeflector } from './domain/apparatus';
import { buildSteps, type ExperimentId } from './domain/experiments';
import { markReady } from './lib/readiness';
import { SCENE_CONFIG } from './lib/sceneConfig';
import { useSimulationRuntime, useSimulationState } from './lib/useSimulation';
import {
  selectAvailableDeflectors,
  selectExperiment,
  selectReadings,
} from './simulation/selectors';
import type { SimulationCommand } from './simulation/runtime';
import { FIRST_READING_VALVE, SECOND_READING_VALVE, VALVE_SNAP_MARGIN } from './domain/physics';
import './index.css';

/**
 * What React still owns after BEDO-008.
 *
 * The rig itself lives in the simulation runtime; these are the two things that are not
 * the rig — where the student is in the lesson, and what the interface is showing.
 * `BEDO-018`/`BEDO-019` take the lesson half; the rest is presentation and belongs here.
 */
interface LessonAndUiState {
  mode: Mode;
  currentStep: number;
  language: Language;
  showMonitor: boolean;
  quizAnswer: number | null;
  /** A student-defined weight denomination the panel offers. Buys a button, not physics. */
  customWeightG: number;
  warningMessage: { en: string; ar: string; code: ErrorCode } | null;
  notice: { en: string; ar: string } | null;
}

const initialLessonState = (language: Language = 'en'): LessonAndUiState => ({
  mode: 'guided',
  currentStep: 1,
  language,
  showMonitor: false,
  quizAnswer: null,
  customWeightG: 25,
  warningMessage: null,
  notice: null,
});

/**
 * Which results row each guided step is balancing.
 *
 * The last index-keyed rule in the application, and it is **lesson orchestration** — the
 * simulation no longer knows step numbers, it is told "begin reading 1". `BEDO-019`
 * deletes this table when the steps get stable ids; until then it is the compatibility
 * adapter between today's numbering and the runtime's semantics.
 */
const READING_FOR_STEP: Record<number, number> = { 7: 1, 9: 2 };

export default function App() {
  const runtime = useSimulationRuntime();
  const simulation = useSimulationState(runtime);
  const [lesson, setLesson] = useState<LessonAndUiState>(() => initialLessonState());

  const experiment = useMemo(() => selectExperiment(simulation), [simulation]);
  const readings = useMemo(() => selectReadings(simulation), [simulation]);
  const availableDeflectors = useMemo(() => selectAvailableDeflectors(simulation), [simulation]);
  const steps = useMemo(() => {
    const d = getDeflector(simulation.apparatus.selectedDeflectorId);
    return buildSteps(d.nameEn, d.nameAr);
  }, [simulation.apparatus.selectedDeflectorId]);

  const clearWarning = useCallback(
    () => setLesson((prev) => ({ ...prev, warningMessage: null })),
    []
  );
  const clearNotice = useCallback(() => setLesson((prev) => ({ ...prev, notice: null })), []);

  /** Turns a typed refusal into the banner the student sees. Copy lives in the adapter. */
  const showRejection = useCallback((reason: RejectionReason) => {
    const presentation = REJECTION_PRESENTATION[reason];
    setLesson((prev) =>
      presentation.severity === 'notice'
        ? {
            ...prev,
            warningMessage: null,
            notice: { en: presentation.en, ar: presentation.ar },
          }
        : {
            ...prev,
            warningMessage: {
              en: presentation.en,
              ar: presentation.ar,
              code: presentation.code!,
            },
          }
    );
  }, []);

  /** Raise the step's observation popup, if it has one and we are guiding. */
  const noticeFor = (mode: Mode, step: number) => {
    if (mode !== 'guided') return null;
    const s = steps.find((x) => x.id === step);
    return s?.noticeEn ? { en: s.noticeEn, ar: s.noticeAr ?? s.noticeEn } : null;
  };

  /** In guided mode, advance only when the action matches the step being asked for. */
  const advance = (prev: LessonAndUiState, from: number, to: number): LessonAndUiState =>
    prev.mode === 'guided' && prev.currentStep === from
      ? { ...prev, currentStep: to, notice: noticeFor(prev.mode, from) }
      : prev;

  /**
   * Sends a command to the runtime and reflects the outcome in the interface.
   *
   * The runtime answers whether the rig allowed it — it consults the same
   * `attempt(state, action)` the 3D scene's clicks reach, so the two cannot disagree.
   * What the *lesson* does about a success is decided here, because the simulation has no
   * idea a lesson exists.
   */
  const dispatch = useCallback(
    (command: SimulationCommand, onAccepted?: (prev: LessonAndUiState) => LessonAndUiState) => {
      const result = runtime.dispatch(command);
      if (!result.ok) {
        showRejection(result.reason);
        return result;
      }
      setLesson((prev) => onAccepted?.({ ...prev, warningMessage: null }) ?? { ...prev, warningMessage: null });
      return result;
    },
    [runtime, showRejection]
  );

  // --- Cover (steps 1 and 3) --------------------------------------------------
  const handleCoverClick = () => {
    // One control, two intents: which one a click means depends on where the plate is.
    const wasOpen = runtime.getState().apparatus.isCoverOpen;
    const action: ApparatusAction = wasOpen ? { type: 'CLOSE_COVER' } : { type: 'OPEN_COVER' };
    dispatch(action, (prev) => (wasOpen ? advance(prev, 3, 4) : advance(prev, 1, 2)));
  };

  // --- Deflector (step 2) ------------------------------------------------------
  const handleSelectDeflector = (id: number) =>
    dispatch({ type: 'SELECT_DEFLECTOR', deflectorId: id });

  // --- Power (step 4) ----------------------------------------------------------
  const handleTogglePower = () => {
    const wasOn = runtime.getState().apparatus.isPowerOn;
    const action: ApparatusAction = wasOn ? { type: 'POWER_OFF' } : { type: 'POWER_ON' };
    dispatch(action, (prev) => (wasOn ? prev : advance(prev, 4, 5)));
  };

  // --- Volumetric valve (step 5) ----------------------------------------------
  const handleToggleVolumetricValve = () =>
    dispatch(
      runtime.getState().apparatus.isVolumetricValveOpen
        ? { type: 'CLOSE_VOLUMETRIC_VALVE' }
        : { type: 'OPEN_VOLUMETRIC_VALVE' }
    );

  // --- Flow valve (steps 6 and 8) ---------------------------------------------
  /**
   * The valve snaps to a reading setpoint once the student is within the margin of it.
   *
   * A **lesson** rule, not an apparatus one — it exists so steps 6 and 8 land on the exact
   * openings the results table is computed at — so it is applied before the runtime sees
   * the value. Snapping only ever raises an opening that is already above 0.38, so gating
   * the snapped value is identical to gating the raw one.
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
    dispatch({ type: 'SET_VALVE', opening: snapToReadingSetpoint(val, lesson.currentStep) });

  const handleFlowValveClick = () =>
    handleSetValve(lesson.currentStep === 8 ? SECOND_READING_VALVE : FIRST_READING_VALVE);

  // --- Weights (steps 7 and 9) -------------------------------------------------
  const handleAddWeight = (weight: number) => dispatch({ type: 'ADD_WEIGHT', massG: weight });

  const handleClearWeights = () => dispatch({ type: 'REMOVE_ALL_WEIGHTS' });

  // --- Guided progression ------------------------------------------------------
  const handleStepOkClick = () => {
    const step = lesson.currentStep;

    // The simulation side of confirming a step, as semantic commands.
    switch (step) {
      case 5:
        runtime.dispatch({ type: 'OPEN_VOLUMETRIC_VALVE' });
        break;
      case 6:
        runtime.dispatch({ type: 'SET_VALVE', opening: FIRST_READING_VALVE });
        runtime.dispatch({ type: 'BEGIN_READING', index: READING_FOR_STEP[7] });
        break;
      case 7:
        runtime.dispatch({ type: 'END_READING' });
        runtime.dispatch({ type: 'REMOVE_ALL_WEIGHTS' });
        break;
      case 8:
        runtime.dispatch({ type: 'SET_VALVE', opening: SECOND_READING_VALVE });
        runtime.dispatch({ type: 'BEGIN_READING', index: READING_FOR_STEP[9] });
        break;
      case 9:
        runtime.dispatch({ type: 'END_READING' });
        runtime.dispatch({ type: 'REMOVE_ALL_WEIGHTS' });
        break;
    }

    setLesson((prev) => {
      const next: LessonAndUiState = { ...prev, warningMessage: null };
      switch (step) {
        case 2:
          next.currentStep = 3;
          break;
        case 5:
          next.currentStep = 6;
          break;
        case 6:
          next.currentStep = 7;
          break;
        case 7:
          next.currentStep = 8;
          break;
        case 8:
          next.currentStep = 9;
          break;
        case 9:
          next.currentStep = 10;
          break;
        case 10:
          next.showMonitor = true;
          next.currentStep = 11;
          break;
        case 11:
          next.currentStep = 12;
          break;
      }
      next.notice = noticeFor(prev.mode, step);
      return next;
    });
  };

  /** Step 11 — record F_ac in the table. */
  const handleCalculate = () => {
    runtime.dispatch({ type: 'RECORD_ACTUAL_FORCE' });
    setLesson((prev) =>
      prev.mode === 'guided' && prev.currentStep === 11
        ? { ...prev, currentStep: 12, notice: noticeFor(prev.mode, 11) }
        : prev
    );
  };

  const handleAnswerQuiz = (choice: number) =>
    setLesson((prev) => ({ ...prev, quizAnswer: choice }));

  const handleToggleMonitor = () =>
    setLesson((prev) => ({
      ...prev,
      warningMessage: null,
      showMonitor: !prev.showMonitor,
      ...(prev.mode === 'guided' && prev.currentStep === 10 && !prev.showMonitor
        ? { currentStep: 11 }
        : {}),
    }));

  const handleSetMode = (mode: Mode) =>
    setLesson((prev) => ({ ...prev, mode, warningMessage: null, notice: null }));

  /** Switching experiment reloads the rig with that sheet's deflector. */
  const handleSelectExperiment = (experimentId: ExperimentId) => {
    runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId });
    setLesson((prev) => initialLessonState(prev.language));
  };

  const handleSetParams = (params: { pumpFlowLMin?: number; customWeightG?: number }) => {
    if (params.pumpFlowLMin !== undefined) {
      runtime.dispatch({ type: 'SET_PUMP_FLOW', lPerMin: params.pumpFlowLMin });
    }
    if (params.customWeightG !== undefined) {
      setLesson((prev) => ({ ...prev, customWeightG: params.customWeightG! }));
    }
  };

  const handleReset = () => {
    runtime.reset();
    setLesson((prev) => initialLessonState(prev.language));
  };

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

  /**
   * What the components read.
   *
   * A projection of the two owners — the runtime for the rig, React for the lesson and the
   * interface — assembled into the shape the components already expect. It is one-way and
   * derived: nothing writes to it, so there is no second source of truth. `BEDO-019` and
   * the UI work will let components read from the runtime directly and retire it.
   */
  const view: SimulationView = useMemo(
    () => ({
      mode: lesson.mode,
      experimentId: simulation.experimentId,
      currentStep: lesson.currentStep,
      language: lesson.language,
      selectedDeflectorId: simulation.apparatus.selectedDeflectorId,
      isCoverOpen: simulation.apparatus.isCoverOpen,
      isPowerOn: simulation.apparatus.isPowerOn,
      valveOpening: simulation.apparatus.valveOpening,
      loadedWeightsG: simulation.apparatus.loadedWeightsG,
      isVolumetricValveOpen: simulation.apparatus.isVolumetricValveOpen,
      recordedRows: readings,
      showMonitor: lesson.showMonitor,
      isCalculated: simulation.isActualForceRecorded,
      quizAnswer: lesson.quizAnswer,
      params: { pumpFlowLMin: simulation.pumpFlowLMin, customWeightG: lesson.customWeightG },
      warningMessage: lesson.warningMessage,
      notice: lesson.notice,
    }),
    [lesson, simulation, readings]
  );

  const deflector = getDeflector(simulation.apparatus.selectedDeflectorId);
  const deflectorName = lesson.language === 'ar' ? deflector.nameAr : deflector.nameEn;

  return (
    <div className="app-container">
      <Scene3D
        state={view}
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
        state={view}
        steps={steps}
        experiment={experiment}
        availableDeflectors={availableDeflectors}
        onSelectLanguage={(lang) => setLesson((prev) => ({ ...prev, language: lang }))}
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

      {view.showMonitor && (
        <SoftwareMonitor
          state={view}
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
