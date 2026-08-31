import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Scene3D } from './components/Scene3D';
import type { WeightAvailability } from './components/DeviceModel';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import { LoadingScreen, type LoadingPhase } from './components/LoadingScreen';
import { useProgress } from '@react-three/drei';
import { AnswerSheet } from './components/AnswerSheet';
import type { ErrorCode, Language, LessonView, Mode, SimulationView } from './types/index';
import type { ApparatusAction, RejectionReason } from './domain/stateMachine';
import { LESSON_BLOCK_PRESENTATION, REJECTION_PRESENTATION } from './lib/apparatusGate';
import { DEFLECTORS, getDeflector } from './domain/apparatus';
import { answerSheetFor, buildSteps, type ExperimentId } from './domain/experiments';
import { isReady, markReady, subscribeReady } from './lib/readiness';
import { readLanguagePreference, writeLanguagePreference } from './lib/languagePreference';
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
  /**
   * A deflector has been installed on the rod in this run.
   *
   * BEDO's state machine starts the rig with *"the weights and deflectors on the table"*
   * (storyboard sl. 29) and only puts one in the rod when the learner installs it (sl. 31,
   * state C). "Has the lesson reached step 2" is not the same question and gave the wrong
   * answer at exactly the wrong moment: the deflector step 2 says to drag was already
   * drawn on the rod, and therefore not on the tray to be dragged (`BEDO-021`, `docs/38
   * §3.1`).
   *
   * Kept beside the lesson rather than inside the runner because it is not a step: a
   * learner who confirms step 2 without touching anything has still installed the disc the
   * sheet loads with, which is what the `hasCompleted` fallback below covers.
   */
  deflectorInstalled: boolean;
  /** Bumped by Reset and by loading another sheet. See `LessonView.runId`. */
  runId: number;
  warningMessage: { en: string; ar: string; code: ErrorCode } | null;
  notice: { en: string; ar: string } | null;
}

const initialLessonState = (
  language: Language = 'en',
  runId: number = 0
): LessonAndUiState => ({
  language,
  showMonitor: false,
  showAnswerSheet: false,
  quizAnswer: null,
  customWeightG: 25,
  deflectorInstalled: false,
  runId,
  warningMessage: null,
  notice: null,
});

export default function App() {
  const runtime = useSimulationRuntime();
  const simulation = useSimulationState(runtime);
  const runner = useLessonRunner();
  const lessonState = useLessonState(runner);
  /**
   * The language is read synchronously here, in the initializer, rather than applied by an
   * effect after mount. The loading overlay is the first thing rendered, so a returning
   * Arabic user must get Arabic on the FIRST render — an effect would paint English first
   * and then flip, which is exactly the flash this is meant to avoid.
   *
   * The default lives here, not in the helper: `null` from storage means "no preference
   * yet", which is a different fact from "chose English".
   */
  const [ui, setUi] = useState<LessonAndUiState>(() =>
    initialLessonState(readLanguagePreference() ?? 'en')
  );

  // The language switch is document state, not only panel styling. Screen readers,
  // browser translation, punctuation order and native form controls all read these
  // attributes from the root element. Keep them in sync with the visible language.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = ui.language;
    root.dir = ui.language === 'ar' ? 'rtl' : 'ltr';
  }, [ui.language]);

  /**
   * When the experience is actually usable.
   *
   * `scene` is the existing milestone for "the apparatus is in the scene graph", and it
   * is reached only after the suspended `useGLTF` calls resolve — the apparatus plus the
   * eight water plumes. Subscribing to it rather than inventing a second readiness model
   * is deliberate: the loading screen and the Playwright/capture waits then agree by
   * construction. `app` and `training` fire far earlier (React mounted, panel mounted)
   * and would uncover the orange wireframe placeholder.
   */
  const sceneReady = useSyncExternalStore(
    subscribeReady,
    () => isReady('scene'),
    () => false,
  );

  /**
   * How far startup has actually got, for the loading screen's segmented progress.
   *
   * Each value is read from a readiness marker the app already publishes, so a segment
   * fills only because something real happened. Measured on production, `app` lands at
   * ~1.5 s and `scene` at ~3.8 s of a ~3.9 s startup, which is why the apparatus phase is
   * the one the user spends most of the wait in.
   */
  const appReady = useSyncExternalStore(subscribeReady, () => isReady('app'), () => false);
  const phase: LoadingPhase = sceneReady ? 'ready' : appReady ? 'apparatus' : 'app';

  /**
   * Only the error list is taken from the loader manager.
   *
   * Its `progress` counts items rather than bytes, so on a throttled cold load it reached
   * 89% in 8.7 s and then stalled there for 22.5 s while the 11.9 MB apparatus GLB — one
   * item, and most of the wait — finished. The loading screen therefore shows an
   * indeterminate indicator rather than a number that would sit at 89% and look stuck.
   */
  const { errors } = useProgress();

  /**
   * A floor on how briefly the loading screen can appear.
   *
   * On production startup takes ~3.9 s and this never engages. On a warm cache or a local
   * preview the whole load finishes in about a second, and the overlay would appear and
   * vanish inside a few frames — a flash that reads as a glitch rather than as loading.
   *
   * The rule is strictly `reveal = max(actual readiness, MIN_LOADING_MS)`. It can only
   * ever delay a reveal that has ALREADY been earned; it can never reveal early, and on
   * any genuinely slow load it contributes nothing.
   */
  const MIN_LOADING_MS = 400;
  const [minWindowDone, setMinWindowDone] = useState(false);
  const overlayShownAt = useRef(performance.now());
  useEffect(() => {
    const remaining = MIN_LOADING_MS - (performance.now() - overlayShownAt.current);
    if (remaining <= 0) {
      setMinWindowDone(true);
      return;
    }
    const id = window.setTimeout(() => setMinWindowDone(true), remaining);
    return () => window.clearTimeout(id);
  }, []);

  /** Readiness is necessary; the presentation floor only postpones an earned reveal. */
  const revealed = sceneReady && minWindowDone;

  /**
   * The overlay stays mounted for the length of its fade, then stops rendering so the
   * segment animation cannot keep running behind a live interface. This timeout is the
   * CSS transition's duration, not a delay on readiness — the scene is already
   * interactive when it starts.
   */
  const [overlayMounted, setOverlayMounted] = useState(true);
  useEffect(() => {
    if (!revealed) return;
    const id = window.setTimeout(() => setOverlayMounted(false), 350);
    return () => window.clearTimeout(id);
  }, [revealed]);

  // A genuine asset failure, not a slow one: three reports it through the same manager.
  const startupFailed = !sceneReady && errors.length > 0;

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
  /**
   * Install a deflector on the rod.
   *
   * Returns the gate's answer, because the scene needs it: an accepted drop seats the disc
   * and plays the storyboard's two-second transfer, a refused one sends it back to the
   * tray. Note the flag is set only on acceptance — the one place that knows whether the
   * rig took it is the one that asked (`docs/38 §3.3`).
   */
  const handleSelectDeflector = (id: number): boolean => {
    const accepted = act({ type: 'SELECT_DEFLECTOR', deflectorId: id }, 'SELECT_DEFLECTOR');
    if (accepted) setUi((prev) => ({ ...prev, deflectorInstalled: true }));
    return accepted;
  };

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
  /**
   * What the learner may do to the weights while discs are in flight (`BEDO-021b §14`, §15).
   *
   * Adding is refused while one is on its way *off* the holder; taking one off is refused
   * while anything is moving at all. The reason is bookkeeping made physical — a removal
   * renumbers the stack, and a disc still travelling to seat *n* would find that seat is
   * now somebody else's. Adding while discs *arrive* stays open, because the runtime gave
   * each one its own seat the moment it was clicked and balancing a reading means three or
   * four discs in a row.
   *
   * A scene fact, not a lesson rule: it never reaches the gate and produces no refusal
   * message, because nothing is being disallowed — it simply has not finished happening.
   *
   * `handleClearWeights` is deliberately **not** guarded. `REMOVE_ALL_WEIGHTS` is also what
   * a reading step dispatches when it completes, and the lesson must never be held up by an
   * animation; the scene reconciles any flight the clear invalidates. The learner's button
   * is disabled instead, which is the half of it that is a learner's choice.
   */
  const [weights, setWeights] = useState<WeightAvailability>({ canAdd: true, canRemove: true });

  const handleAddWeight = (weight: number) => {
    if (!weights.canAdd) return;
    act({ type: 'ADD_WEIGHT', massG: weight }, 'ADD_WEIGHT');
  };

  const handleClearWeights = () => act({ type: 'REMOVE_ALL_WEIGHTS' });

  /**
   * Take one disc back off the holder.
   *
   * By stack position, which is what the storyboard's *"click on the weight on holder"*
   * means when two discs of the same denomination are on the pan. Same gate, same runtime,
   * same state machine as adding one.
   */
  const handleRemoveWeight = (index: number) => {
    if (!weights.canRemove) return false;
    return act({ type: 'REMOVE_WEIGHT', index });
  };

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
    setUi((prev) => initialLessonState(prev.language, prev.runId + 1));
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
    setUi((prev) => initialLessonState(prev.language, prev.runId + 1));
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
    const globals = window as unknown as Record<string, any>;
    globals.__bedoTest = {
      // Merged, not replaced: the scene registers its own drag probe under the same
      // handle (see DeviceModel), and whichever effect runs second must not erase the
      // other's contribution.
      ...globals.__bedoTest,
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
      // `hasCompleted`, not `hasReached`: while the learner is standing *on* the step that
      // says to install a deflector, the rod is empty and the tray is full — which is what
      // makes the instruction performable. The flag covers the learner who installs one
      // during that step; the fallback covers the one who just presses OK.
      hasInstalledDeflector: ui.deflectorInstalled || runner.hasCompleted('install-deflector'),
      runId: ui.runId,
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
      ui.deflectorInstalled,
      ui.runId,
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
      {/*
        `display: contents` keeps the existing layout exactly as it was while still giving
        the shell a node to mark inert. Without this the overlay would block the mouse but
        a Tab press would still walk into the controls behind it.
      */}
      <div style={{ display: 'contents' }} inert={overlayMounted && !revealed}>
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
          onWeightAvailability={setWeights}
        />

        <UIOverlay
          state={view}
          lesson={lessonView}
          experiment={experiment}
          availableDeflectors={availableDeflectors}
          onSelectLanguage={(lang) => {
            // Persist only an explicit choice. Nothing is written on startup, so a user
            // who never touches the control leaves no stored preference behind.
            writeLanguagePreference(lang);
            setUi((prev) => ({ ...prev, language: lang }));
          }}
          onSetMode={handleSetMode}
          onSelectExperiment={handleSelectExperiment}
          onSetParams={handleSetParams}
          onSelectDeflector={handleSelectDeflector}
          onSetValve={handleSetValve}
          canRemoveWeights={weights.canRemove}
          onAddWeight={handleAddWeight}
          onClearWeights={handleClearWeights}
          onRemoveWeight={handleRemoveWeight}
          onTogglePower={handleTogglePower}
          onCoverClick={handleCoverClick}
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

      {overlayMounted && (
        <LoadingScreen
          visible={!revealed}
          language={ui.language}
          phase={phase}
          failed={startupFailed}
          onRetry={() => window.location.reload()}
        />
      )}
    </div>
  );
}
