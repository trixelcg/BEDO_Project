import { useCallback, useEffect, useMemo, useState } from 'react';
import { Scene3D } from './components/Scene3D';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import type { ErrorCode, ExperimentId, SimulationState } from './types/index';
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

/**
 * The five guards from BEDO's state machine document. Every control stays clickable at
 * all times — these are what stop an unsafe action, in both Free and Guided mode.
 */
const ERRORS: Record<ErrorCode, { en: string; ar: string }> = {
  error1: {
    en: 'You can’t add weights while the tank is open.',
    ar: 'لا يمكن إضافة الأوزان أثناء فتح الخزان.',
  },
  error2: {
    en: 'Remove the tank cover first.',
    ar: 'يرجى إزالة غطاء الخزان أولاً.',
  },
  error3: {
    en: 'You can’t open the tank while the power is on.',
    ar: 'لا يمكن فتح الخزان أثناء تشغيل الطاقة.',
  },
  error4: {
    en: 'You can’t turn on the power while the tank is open.',
    ar: 'لا يمكن تشغيل الطاقة أثناء فتح الخزان.',
  },
  error5: {
    en: 'Remove all weights first before opening the tank.',
    ar: 'يرجى إزالة جميع الأوزان قبل فتح الخزان.',
  },
};

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

  const raise = useCallback((code: ErrorCode) => {
    setState((prev) => ({ ...prev, warningMessage: { ...ERRORS[code], code } }));
  }, []);

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
    clearWarning();

    if (!state.isCoverOpen) {
      if (state.isPowerOn) return raise('error3');
      if (state.loadedWeightsG.length > 0) return raise('error5');
    }

    setState((prev) => {
      const isCoverOpen = !prev.isCoverOpen;
      return {
        ...prev,
        isCoverOpen,
        ...(isCoverOpen ? advance(prev, 1, 2) : advance(prev, 3, 4)),
      };
    });
  };

  // --- Deflector (step 2) ------------------------------------------------------
  const handleSelectDeflector = (id: number) => {
    clearWarning();
    // Error 2: the rod is inside the tank, so the cover has to come off first.
    if (!state.isCoverOpen) return raise('error2');
    setState((prev) => ({ ...prev, selectedDeflectorId: id }));
  };

  // --- Power (step 4) ----------------------------------------------------------
  const handleTogglePower = () => {
    clearWarning();
    if (!state.isPowerOn && state.isCoverOpen) return raise('error4');

    setState((prev) => {
      const isPowerOn = !prev.isPowerOn;
      return {
        ...prev,
        isPowerOn,
        valveOpening: isPowerOn ? prev.valveOpening : 0.0,
        ...(isPowerOn ? advance(prev, 4, 5) : {}),
      };
    });
  };

  // --- Volumetric valve (step 5) ----------------------------------------------
  const handleToggleVolumetricValve = () => {
    clearWarning();
    setState((prev) => ({ ...prev, isVolumetricValveOpen: !prev.isVolumetricValveOpen }));
  };

  // --- Flow valve (steps 6 and 8) ---------------------------------------------
  const handleSetValve = (val: number) => {
    clearWarning();
    if (!state.isPowerOn && val > 0) {
      // Not one of the five documented guards — the pump simply isn't running.
      setState((prev) => ({
        ...prev,
        notice: {
          en: 'Turn on the power switch before opening the valve.',
          ar: 'يرجى تشغيل مفتاح الطاقة قبل فتح الصمام.',
        },
      }));
      return;
    }

    setState((prev) => {
      let valveOpening = val;
      if (prev.currentStep === 6 && val >= FIRST_READING_VALVE - VALVE_SNAP_MARGIN) {
        valveOpening = FIRST_READING_VALVE;
      } else if (prev.currentStep === 8 && val >= SECOND_READING_VALVE - VALVE_SNAP_MARGIN) {
        valveOpening = SECOND_READING_VALVE;
      }
      return { ...prev, valveOpening };
    });
  };

  const handleFlowValveClick = () =>
    handleSetValve(state.currentStep === 8 ? SECOND_READING_VALVE : FIRST_READING_VALVE);

  // --- Weights (steps 7 and 9) -------------------------------------------------
  const handleAddWeight = (weight: number) => {
    clearWarning();
    if (state.isCoverOpen) return raise('error1');
    setState((prev) => ({ ...prev, loadedWeightsG: [...prev.loadedWeightsG, weight] }));
  };

  const handleClearWeights = () => {
    clearWarning();
    setState((prev) => ({ ...prev, loadedWeightsG: [] }));
  };

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
