import { useCallback, useEffect, useMemo, useState } from 'react';
import { Scene3D } from './components/Scene3D';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import type { ErrorCode, Language, LessonView, Mode, SimulationView } from './types/index';
import type { RejectionReason } from './domain/stateMachine';
import { REJECTION_PRESENTATION } from './lib/apparatusGate';
import { getDeflector } from './domain/apparatus';
import { buildSteps, type ExperimentId } from './domain/experiments';
import { markReady } from './lib/readiness';
import { SCENE_CONFIG } from './lib/sceneConfig';
import { useSimulationRuntime, useSimulationState } from './lib/useSimulation';
import { useLessonRunner, useLessonState } from './lib/useLesson';
import type { LessonContext, LessonExpectation } from './lesson/schema';
import { CURRENT_LESSON_STEP_COUNT } from './lesson/currentLesson';
import {
  selectAvailableDeflectors,
  selectExperiment,
  selectReadings,
} from './simulation/selectors';
import type { SimulationCommand } from './simulation/runtime';
import { FIRST_READING_VALVE, VALVE_SNAP_MARGIN } from './domain/physics';
import './index.css';

/**
 * What React still owns after BEDO-008.
 *
 * The rig itself lives in the simulation runtime; these are the two things that are not
 * the rig — where the student is in the lesson, and what the interface is showing.
 * `BEDO-018`/`BEDO-019` take the lesson half; the rest is presentation and belongs here.
 */
interface LessonAndUiState {
  language: Language;
  showMonitor: boolean;
  quizAnswer: number | null;
  /** A student-defined weight denomination the panel offers. Buys a button, not physics. */
  customWeightG: number;
  warningMessage: { en: string; ar: string; code: ErrorCode } | null;
  notice: { en: string; ar: string } | null;
}

const initialLessonState = (language: Language = 'en'): LessonAndUiState => ({
  language,
  showMonitor: false,
  quizAnswer: null,
  customWeightG: 25,
  warningMessage: null,
  notice: null,
});

export default function App() {
  const runtime = useSimulationRuntime();
  const simulation = useSimulationState(runtime);
  const runner = useLessonRunner();
  const lessonState = useLessonState(runner);
  const [ui, setUi] = useState<LessonAndUiState>(() => initialLessonState());

  const experiment = useMemo(() => selectExperiment(simulation), [simulation]);
  const readings = useMemo(() => selectReadings(simulation), [simulation]);
  const availableDeflectors = useMemo(() => selectAvailableDeflectors(simulation), [simulation]);
  const steps = useMemo(() => {
    const d = getDeflector(simulation.apparatus.selectedDeflectorId);
    return buildSteps(d.nameEn, d.nameAr);
  }, [simulation.apparatus.selectedDeflectorId]);

  /** Everything a completion condition may look at. */
  const context: LessonContext = useMemo(
    () => ({ simulation, readings }),
    [simulation, readings]
  );

  const clearWarning = useCallback(() => setUi((prev) => ({ ...prev, warningMessage: null })), []);
  const clearNotice = useCallback(() => setUi((prev) => ({ ...prev, notice: null })), []);

  /** Turns a typed refusal into the banner the student sees. Copy lives in the adapter. */
  const showRejection = useCallback((reason: RejectionReason) => {
    const presentation = REJECTION_PRESENTATION[reason];
    setUi((prev) =>
      presentation.severity === 'notice'
        ? { ...prev, warningMessage: null, notice: { en: presentation.en, ar: presentation.ar } }
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

  /**
   * Applies whatever a finished step asks for: its simulation commands, and the
   * observation popup the experiment sheet specifies.
   *
   * The runner decides *that* a step finished; this decides what the interface does about
   * it. `open-monitor` is the one step whose completion has a presentation effect.
   */
  const applyAdvance = useCallback(
    (result: ReturnType<typeof runner.confirm>) => {
      if (!result.advanced) return;
      for (const command of result.commands) runtime.dispatch(command);

      const completed = steps.find((step) => step.stepId === result.completedStepId);
      const notice = completed?.noticeEn
        ? { en: completed.noticeEn, ar: completed.noticeAr ?? completed.noticeEn }
        : null;

      setUi((prev) => ({
        ...prev,
        warningMessage: null,
        notice,
        showMonitor: result.completedStepId === 'open-monitor' ? true : prev.showMonitor,
      }));
    },
    [runtime, steps]
  );

  /**
   * Sends a command to the simulation, then tells the lesson what happened.
   *
   * The simulation decides whether the rig allows it; the lesson decides whether that was
   * the step's action. Neither asks the other's question.
   */
  const dispatch = useCallback(
    (command: SimulationCommand, expectation?: LessonExpectation['type']) => {
      const result = runtime.dispatch(command);
      if (!result.ok) {
        showRejection(result.reason);
        return result;
      }
      setUi((prev) => ({ ...prev, warningMessage: null }));
      if (expectation) {
        // The runner reads the state *after* the command, which is why this is not done
        // from the memoised context above.
        applyAdvance(runner.notify(expectation, { simulation: runtime.getState(), readings: selectReadings(runtime.getState()) }));
      }
      return result;
    },
    [runtime, runner, showRejection, applyAdvance]
  );

  // --- Cover -------------------------------------------------------------------
  const handleCoverClick = () => {
    // One control, two intents: which one a click means depends on where the plate is.
    const wasOpen = runtime.getState().apparatus.isCoverOpen;
    dispatch(
      wasOpen ? { type: 'CLOSE_COVER' } : { type: 'OPEN_COVER' },
      wasOpen ? 'CLOSE_COVER' : 'OPEN_COVER'
    );
  };

  // --- Deflector ---------------------------------------------------------------
  const handleSelectDeflector = (id: number) =>
    dispatch({ type: 'SELECT_DEFLECTOR', deflectorId: id }, 'SELECT_DEFLECTOR');

  // --- Power -------------------------------------------------------------------
  const handleTogglePower = () => {
    const wasOn = runtime.getState().apparatus.isPowerOn;
    dispatch(wasOn ? { type: 'POWER_OFF' } : { type: 'POWER_ON' }, wasOn ? undefined : 'POWER_ON');
  };

  // --- Volumetric valve --------------------------------------------------------
  const handleToggleVolumetricValve = () =>
    dispatch(
      runtime.getState().apparatus.isVolumetricValveOpen
        ? { type: 'CLOSE_VOLUMETRIC_VALVE' }
        : { type: 'OPEN_VOLUMETRIC_VALVE' },
      'OPEN_VOLUMETRIC_VALVE'
    );

  // --- Flow valve --------------------------------------------------------------
  /**
   * The setpoint the current step is aiming at, if it is a flow step.
   *
   * Read off the step's own completion commands rather than from its number: a step that
   * settles the valve says so in its data.
   */
  const currentSetpoint = (): number | null => {
    const command = runner
      .getCurrentStep()
      .onComplete?.find((c) => c.type === 'SET_VALVE');
    return command && command.type === 'SET_VALVE' ? command.opening : null;
  };

  /**
   * The valve snaps to the reading setpoint once the learner is within the margin of it,
   * so the readings land on the exact openings the results table is computed at.
   *
   * A lesson rule, not an apparatus one, so it is applied before the simulation sees the
   * value. Snapping only ever raises an opening that is already near the setpoint, so
   * gating the snapped value is identical to gating the raw one.
   */
  const handleSetValve = (value: number) => {
    const setpoint = currentSetpoint();
    const opening =
      setpoint !== null && value >= setpoint - VALVE_SNAP_MARGIN ? setpoint : value;
    dispatch({ type: 'SET_VALVE', opening }, 'SET_VALVE');
  };

  const handleFlowValveClick = () => handleSetValve(currentSetpoint() ?? FIRST_READING_VALVE);

  // --- Weights -----------------------------------------------------------------
  const handleAddWeight = (weight: number) =>
    dispatch({ type: 'ADD_WEIGHT', massG: weight }, 'ADD_WEIGHT');

  const handleClearWeights = () => dispatch({ type: 'REMOVE_ALL_WEIGHTS' });

  // --- Guided progression ------------------------------------------------------
  const handleStepOkClick = () => applyAdvance(runner.confirm(context));

  const handleCalculate = () =>
    dispatch({ type: 'RECORD_ACTUAL_FORCE' }, 'RECORD_ACTUAL_FORCE');

  const handleAnswerQuiz = (choice: number) => setUi((prev) => ({ ...prev, quizAnswer: choice }));

  const handleToggleMonitor = () => {
    const opening = !ui.showMonitor;
    setUi((prev) => ({ ...prev, warningMessage: null, showMonitor: opening }));
    if (opening) applyAdvance(runner.notify('OPEN_MONITOR', context));
  };

  const handleSetMode = (mode: Mode) => {
    runner.setMode(mode);
    setUi((prev) => ({ ...prev, warningMessage: null, notice: null }));
  };

  /** Switching experiment reloads the rig with that sheet's deflector, and restarts. */
  const handleSelectExperiment = (experimentId: ExperimentId) => {
    runtime.dispatch({ type: 'SELECT_EXPERIMENT', experimentId });
    runner.reset();
    setUi((prev) => initialLessonState(prev.language));
  };

  const handleSetParams = (params: { pumpFlowLMin?: number; customWeightG?: number }) => {
    if (params.pumpFlowLMin !== undefined) {
      runtime.dispatch({ type: 'SET_PUMP_FLOW', lPerMin: params.pumpFlowLMin });
    }
    if (params.customWeightG !== undefined) {
      setUi((prev) => ({ ...prev, customWeightG: params.customWeightG! }));
    }
  };

  const handleReset = () => {
    runtime.reset();
    runner.reset();
    setUi((prev) => initialLessonState(prev.language));
  };

  // The shell is mounted and interactive from here. See src/lib/readiness.ts.
  useEffect(() => markReady('app'), []);

  /**
   * Dev-only test adapter (BEDO-002 §7).
   *
   * The tank cover is the one control with no DOM equivalent — the plate is a mesh inside
   * the WebGL canvas. Rather than have the E2E hunt for screen coordinates on a 3D view
   * that reframes itself between steps, it calls the very handler the mesh calls, so every
   * guard and every guided transition still runs.
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
   * What the components are told about the lesson.
   *
   * Every field is answered by the runner. The components used to work these out
   * themselves by comparing a step number, and two of them disagreed.
   */
  const currentStep = runner.getCurrentStep();
  const isGuided = lessonState.mode === 'guided';
  const lessonView: LessonView = useMemo(
    () => ({
      isGuided,
      stepId: currentStep.id,
      displayNumber: currentStep.displayNumber,
      totalSteps: CURRENT_LESSON_STEP_COUNT,
      step: steps.find((step) => step.stepId === currentStep.id),
      target: isGuided ? currentStep.target : null,
      cameraView: isGuided ? (currentStep.cameraView ?? currentStep.target) : null,
      isSatisfied: runner.isSatisfied(context),
      canConfirm: runner.canConfirm(context),
      highlight: currentStep.highlight,
      panelControls: currentStep.panelControls,
      hasInstalledDeflector: runner.hasReached('install-deflector'),
      activeReadingIndex: simulation.activeReadingIndex,
    }),
    [isGuided, currentStep, steps, runner, context, simulation.activeReadingIndex]
  );

  /**
   * What the components read about the rig.
   *
   * A projection of the simulation runtime and React's own interface state, in the shape
   * the components already expect. One-way and derived; nothing writes to it.
   */
  const view: SimulationView = useMemo(
    () => ({
      mode: lessonState.mode,
      experimentId: simulation.experimentId,
      language: ui.language,
      selectedDeflectorId: simulation.apparatus.selectedDeflectorId,
      isCoverOpen: simulation.apparatus.isCoverOpen,
      isPowerOn: simulation.apparatus.isPowerOn,
      valveOpening: simulation.apparatus.valveOpening,
      loadedWeightsG: simulation.apparatus.loadedWeightsG,
      isVolumetricValveOpen: simulation.apparatus.isVolumetricValveOpen,
      recordedRows: readings,
      showMonitor: ui.showMonitor,
      isCalculated: simulation.isActualForceRecorded,
      quizAnswer: ui.quizAnswer,
      params: { pumpFlowLMin: simulation.pumpFlowLMin, customWeightG: ui.customWeightG },
      warningMessage: ui.warningMessage,
      notice: ui.notice,
    }),
    [ui, simulation, readings, lessonState.mode]
  );

  const deflector = getDeflector(simulation.apparatus.selectedDeflectorId);
  const deflectorName = ui.language === 'ar' ? deflector.nameAr : deflector.nameEn;

  return (
    <div className="app-container">
      <Scene3D
        state={view}
        lesson={lessonView}
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
        lesson={lessonView}
        experiment={experiment}
        availableDeflectors={availableDeflectors}
        onSelectLanguage={(lang) => setUi((prev) => ({ ...prev, language: lang }))}
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
