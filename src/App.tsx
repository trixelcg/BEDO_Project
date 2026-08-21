import { useCallback, useEffect, useMemo, useState } from 'react';
import { Scene3D } from './components/Scene3D';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import { AnswerSheet } from './components/AnswerSheet';
import type { ErrorCode, Language, LessonView, Mode, SimulationView } from './types/index';
import type { ApparatusAction, RejectionReason } from './domain/stateMachine';
import { LESSON_BLOCK_PRESENTATION, REJECTION_PRESENTATION } from './lib/apparatusGate';
import { DEFLECTORS, getDeflector } from './domain/apparatus';
import { answerSheetFor, buildSteps, type ExperimentId } from './domain/experiments';
import { markReady } from './lib/readiness';
import { SCENE_CONFIG } from './lib/sceneConfig';
import { useSimulationRuntime, useSimulationState } from './lib/useSimulation';
import { useLessonRunner, useLessonState } from './lib/useLesson';
import type { LessonContext, LessonExpectation } from './lesson/schema';
import { CURRENT_LESSON, CURRENT_LESSON_STEP_COUNT } from './lesson/currentLesson';
import { selectExperiment, selectReadings } from './simulation/selectors';
import {
  availableAffordances,
  deflectorsSelectableIn,
  evaluateInteraction,
  type Interaction,
  type InteractionDecision,
  type LessonBlockReason,
} from './interaction/gate';
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
  /** The worksheet overlay, opened by the closing step. */
  showAnswerSheet: boolean;
  quizAnswer: number | null;
  /** A student-defined weight denomination the panel offers. Buys a button, not physics. */
  customWeightG: number;
  warningMessage: { en: string; ar: string; code: ErrorCode } | null;
  notice: { en: string; ar: string } | null;
}

const initialLessonState = (language: Language = 'en'): LessonAndUiState => ({
  language,
  showMonitor: false,
  showAnswerSheet: false,
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
  /**
   * The deflectors the panel and the tray offer.
   *
   * Read from the gate, not from the experiment directly: the list a learner is shown and
   * the list the gate will accept have to be the same list, and `BUG-05` is what happens
   * when the panel filters and nothing else does. In free mode all seven are offered,
   * which is also what the 3D tray has always shown — so the two surfaces finally agree.
   */
  const selectableDeflectorIds = useMemo(
    () => deflectorsSelectableIn(simulation.experimentId, lessonState.mode),
    [simulation.experimentId, lessonState.mode]
  );
  const availableDeflectors = useMemo(
    () => DEFLECTORS.filter((d) => selectableDeflectorIds.includes(d.id)),
    [selectableDeflectorIds]
  );
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
   * What the learner sees when the *lesson* refuses.
   *
   * A blue notice, never the red safety banner — `BEDO-020 §10` requires the two stay
   * distinguishable, and nothing unsafe has happened.
   */
  const showLessonBlock = useCallback((reason: LessonBlockReason) => {
    const presentation = LESSON_BLOCK_PRESENTATION[reason];
    setUi((prev) => ({
      ...prev,
      warningMessage: null,
      notice: { en: presentation.en, ar: presentation.ar },
    }));
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
   * **The one way a learner interaction reaches the simulation.**
   *
   * Every control — the 2D panel's buttons and the 3D scene's hotspots alike — arrives
   * here, and here is the only place that decides. That is the whole of `BUG-04`: the
   * panel used to enforce the lesson by hiding its buttons, which the scene could not do
   * and did not do, so the same click meant different things on the two surfaces.
   *
   * The gate answers first, and only then does anything change:
   *
   *   1. gate (apparatus legality, then lesson legality — `src/interaction/gate.ts`)
   *   2. commit to the simulation
   *   3. tell the lesson what happened
   *   4. feedback
   *
   * A refused interaction returns before step 2, so `BEDO-020 §12` holds by construction:
   * nothing is committed, nothing advances, and there is no partial mutation to undo.
   */
  const interact = useCallback(
    (interaction: Interaction, expectation?: LessonExpectation['type']): boolean => {
      const decision: InteractionDecision = evaluateInteraction({
        interaction,
        apparatus: runtime.getState().apparatus,
        experimentId: runtime.getState().experimentId,
        step: runner.getCurrentStep(),
        lesson: CURRENT_LESSON,
        mode: runner.getState().mode,
      });

      if (!decision.allowed) {
        if (decision.blockedBy === 'apparatus') showRejection(decision.reason);
        else showLessonBlock(decision.reason);
        return false;
      }

      if (interaction.kind === 'apparatus') {
        const result = runtime.dispatch(interaction.action);
        // The gate already asked `attempt()` and the runtime asks it again. Both are the
        // same pure function on the same state, so this cannot fire — it is here because
        // the runtime, not the gate, is the authority on what the rig accepted.
        if (!result.ok) {
          showRejection(result.reason);
          return false;
        }
      }

      setUi((prev) => ({ ...prev, warningMessage: null }));
      if (expectation) {
        // The runner reads the state *after* the command, which is why this is not done
        // from the memoised context above.
        applyAdvance(runner.notify(expectation, { simulation: runtime.getState(), readings: selectReadings(runtime.getState()) }));
      }
      return true;
    },
    [runtime, runner, showRejection, showLessonBlock, applyAdvance]
  );

  /** Shorthand for the common case: an apparatus intent. */
  const act = useCallback(
    (action: ApparatusAction, expectation?: LessonExpectation['type']) =>
      interact({ kind: 'apparatus', action }, expectation),
    [interact]
  );

  // --- Cover -------------------------------------------------------------------
  const handleCoverClick = () => {
    // One control, two intents: which one a click means depends on where the plate is.
    const wasOpen = runtime.getState().apparatus.isCoverOpen;
    act(
      wasOpen ? { type: 'CLOSE_COVER' } : { type: 'OPEN_COVER' },
      wasOpen ? 'CLOSE_COVER' : 'OPEN_COVER'
    );
  };

  // --- Deflector ---------------------------------------------------------------
  const handleSelectDeflector = (id: number) =>
    act({ type: 'SELECT_DEFLECTOR', deflectorId: id }, 'SELECT_DEFLECTOR');

  // --- Power -------------------------------------------------------------------
  const handleTogglePower = () => {
    const wasOn = runtime.getState().apparatus.isPowerOn;
    act(wasOn ? { type: 'POWER_OFF' } : { type: 'POWER_ON' }, wasOn ? undefined : 'POWER_ON');
  };

  // --- Volumetric valve --------------------------------------------------------
  const handleToggleVolumetricValve = () =>
    act(
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
    act({ type: 'SET_VALVE', opening }, 'SET_VALVE');
  };

  const handleFlowValveClick = () => handleSetValve(currentSetpoint() ?? FIRST_READING_VALVE);

  // --- Weights -----------------------------------------------------------------
  const handleAddWeight = (weight: number) =>
    act({ type: 'ADD_WEIGHT', massG: weight }, 'ADD_WEIGHT');

  const handleClearWeights = () => act({ type: 'REMOVE_ALL_WEIGHTS' });

  /**
   * Take one disc back off the holder.
   *
   * By stack position, which is what the storyboard's *"click on the weight on holder"*
   * means when two discs of the same denomination are on the pan. Same gate, same runtime,
   * same state machine as adding one.
   */
  const handleRemoveWeight = (index: number) => act({ type: 'REMOVE_WEIGHT', index });

  // --- Guided progression ------------------------------------------------------
  const handleStepOkClick = () => applyAdvance(runner.confirm(context));

  /**
   * Calculate, inside the monitor. A screen action, so no apparatus rule applies — but the
   * lesson still governs when it is available, through the same gate.
   */
  const handleCalculate = () => {
    if (!interact({ kind: 'presentation', action: 'RECORD_ACTUAL_FORCE' })) return;
    runtime.dispatch({ type: 'RECORD_ACTUAL_FORCE' });
    applyAdvance(
      runner.notify('RECORD_ACTUAL_FORCE', {
        simulation: runtime.getState(),
        readings: selectReadings(runtime.getState()),
      })
    );
  };

  const handleAnswerQuiz = (choice: number) => setUi((prev) => ({ ...prev, quizAnswer: choice }));

  /**
   * The closing step: open this experiment's worksheet.
   *
   * The document is fetched only when asked for — it is never part of the initial load.
   * Opening it finishes the numbered procedure; the assessment stays where it is, beside
   * the lesson rather than inside it.
   */
  const handleOpenAnswerSheet = () => {
    if (!interact({ kind: 'presentation', action: 'OPEN_ANSWER_SHEET' })) return;
    setUi((prev) => ({ ...prev, showAnswerSheet: true }));
    applyAdvance(runner.notify('OPEN_ANSWER_SHEET', context));
  };

  const handleCloseAnswerSheet = () => setUi((prev) => ({ ...prev, showAnswerSheet: false }));

  /**
   * Only *opening* the monitor is gated. Closing a fullscreen overlay must always work —
   * an overlay you cannot dismiss is the shape of the video-modal defect, and BEDO-019
   * went to some trouble not to reproduce it.
   */
  const handleToggleMonitor = () => {
    const opening = !ui.showMonitor;
    if (opening && !interact({ kind: 'presentation', action: 'OPEN_MONITOR' })) return;
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
      // The tray is seven meshes inside the canvas with no DOM equivalent, and the panel
      // only ever offers the in-scope ones — so this is how the browser suite reaches
      // past it to check that the gate, and not the shorter list, is what refuses.
      selectDeflector: handleSelectDeflector,
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
      // The step's own controls, plus the ones available at any point — the volumetric
      // valve, which is part of the rig but not part of the procedure.
      panelControls: [...currentStep.panelControls, ...(CURRENT_LESSON.alwaysAvailable ?? [])],
      selectableDeflectorIds,
      // What the gate will accept, handed to the scene so a blocked hotspot need not
      // re-derive the policy — and so an always-available one is not drawn as dead.
      available: [...availableAffordances(CURRENT_LESSON, currentStep, lessonState.mode)],
      hasInstalledDeflector: runner.hasReached('install-deflector'),
      activeReadingIndex: simulation.activeReadingIndex,
      isComplete: lessonState.isComplete,
      answerSheetUrl: answerSheetFor(simulation.experimentId),
    }),
    [
      isGuided,
      lessonState.mode,
      selectableDeflectorIds,
      currentStep,
      steps,
      runner,
      context,
      simulation.activeReadingIndex,
      simulation.experimentId,
      lessonState.isComplete,
    ]
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
        onRemoveWeight={handleRemoveWeight}
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
        onRemoveWeight={handleRemoveWeight}
        onTogglePower={handleTogglePower}
        onToggleVolumetricValve={handleToggleVolumetricValve}
        onToggleMonitor={handleToggleMonitor}
        onReset={handleReset}
        clearWarning={clearWarning}
        clearNotice={clearNotice}
        onOkClick={handleStepOkClick}
        onOpenAnswerSheet={handleOpenAnswerSheet}
      />

      {ui.showAnswerSheet && lessonView.answerSheetUrl && (
        <AnswerSheet
          url={lessonView.answerSheetUrl}
          experimentName={ui.language === 'ar' ? experiment.nameAr : experiment.nameEn}
          isArabic={ui.language === 'ar'}
          onClose={handleCloseAnswerSheet}
        />
      )}

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
