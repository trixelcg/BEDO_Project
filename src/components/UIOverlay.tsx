import React, { useEffect, useState } from 'react';
import { WalkthroughVideo } from './WalkthroughVideo';
import type {
  CustomParams,
  ExperimentId,
  Language,
  LessonView,
  Mode,
  SimulationView,
} from '../types/index';
import {
  Layers,
  Power,
  Scale,
  RefreshCw,
  AlertTriangle,
  Monitor,
  ClipboardList,
  Info,
  FlaskConical,
  SlidersHorizontal,
  ListChecks,
  CheckCircle2,
} from 'lucide-react';
import { WEIGHTS, type DeflectorDef } from '../domain/apparatus';
import { markReady } from '../lib/readiness';
import { StepInstructionCard } from './StepInstructionCard';
import { StepProgress } from './StepProgress';
import { EXPERIMENTS, type ExperimentDef } from '../domain/experiments';
import { BALANCE_TOLERANCE_G } from '../domain/physics';
import {
  CUSTOM_WEIGHT_CHOICES_G,
  DEFAULT_CUSTOM_WEIGHT_G,
  DEFAULT_PUMP_FLOW_L_MIN,
  PUMP_FLOW_RANGE_L_MIN,
} from '../domain/parameters';
import { forceLawFor } from '../domain/forceLaw';
import type { PanelControl } from '../lesson/schema';

interface UIOverlayProps {
  state: SimulationView;
  lesson: LessonView;
  experiment: ExperimentDef;
  availableDeflectors: DeflectorDef[];
  onSelectLanguage: (lang: Language) => void;
  onSetMode: (mode: Mode) => void;
  onSelectExperiment: (id: ExperimentId) => void;
  onSetParams: (params: Partial<CustomParams>) => void;
  onSelectDeflector: (id: number) => void;
  onSetValve: (val: number) => void;
  onAddWeight: (weight: number) => void;
  onClearWeights: () => void;
  /** Take one disc off the holder, by its position in the stack. */
  onRemoveWeight: (index: number) => void;
  /**
   * False while a disc is in flight, when taking one off is not yet a thing that can
   * happen (`BEDO-021b §14`, §18).
   *
   * Not a lesson refusal — the gate is not involved and no message is shown. A control
   * that cannot act must not look as though it can, which is `BUG-19`'s lesson applied to
   * the panel rather than to the tank.
   */
  canRemoveWeights: boolean;
  onTogglePower: () => void;
  onToggleVolumetricValve: () => void;
  /** Same intent the tank-cover mesh raises. See the button below for why it exists. */
  onCoverClick: () => void;
  /** False while the intro panel is up: the guided dock must not show behind it. */
  started: boolean;
  onToggleMonitor: () => void;
  /** The camera is parked at the printed board. */
  boardView: boolean;
  onToggleBoardView: () => void;
  onReset: () => void;
  clearWarning: () => void;
  clearNotice: () => void;
  onOkClick: () => void;
  onOpenAnswerSheet: () => void;
}

type Panel = 'steps' | 'experiments' | 'params';

export const UIOverlay: React.FC<UIOverlayProps> = ({
  state,
  lesson,
  experiment,
  availableDeflectors,
  onSelectLanguage,
  onSetMode,
  onSelectExperiment,
  onSetParams,
  onSelectDeflector,
  onSetValve,
  onAddWeight,
  onClearWeights,
  onRemoveWeight,
  canRemoveWeights,
  onTogglePower,
  onToggleVolumetricValve,
  onCoverClick,
  started,
  onToggleMonitor,
  boardView,
  onToggleBoardView,
  onReset,
  clearWarning,
  clearNotice,
  onOkClick,
  onOpenAnswerSheet,
}) => {
  const [showVideo, setShowVideo] = useState(false);
  const [panel, setPanel] = useState<Panel>('steps');
  /**
   * In guided mode the full panel is closed by default and opened on demand.
   *
   * The requirement is that no large all-purpose panel is the *primary* guided UI — not
   * that experiment selection and the advanced parameters become unreachable. So they stay
   * one click away behind the footer instead of occupying the left edge of every step.
   */
  const [guidedPanelOpen, setGuidedPanelOpen] = useState(false);
  /** The guided Steps view (F14): open by default, the learner can put it away. */
  const [showSteps, setShowSteps] = useState(true);

  // The training panel is on screen and usable. See src/lib/readiness.ts.
  useEffect(() => markReady('training'), []);

  const {
    language,
    selectedDeflectorId,
    isCoverOpen,
    isPowerOn,
    valveOpening,
    loadedWeightsG,
    lessonRows,
    warningMessage,
    notice,
    params,
  } = state;

  const isAr = language === 'ar';
  const guided = lesson.isGuided;
  const activeStep = lesson.step;

  /**
   * The two steps that ask the learner to click the discs themselves.
   *
   * The tray projects into the bottom-centre of the frame at every supported size — 
   * measured, x 0.37–0.64 and y 0.70–0.98 of the viewport at 1366x768, 1440x900,
   * 1920x1080 and 2560x1440 alike — which is exactly where the reference-aligned dock and
   * footer sit. At the one step whose instruction is *"add weights"*, that layout covers
   * the things being pointed at, so the HUD steps aside for it and returns everywhere else
   * (`docs/51`).
   */
  const asideForWeights = lesson.isGuided && lesson.target === 'weights';

  const totalLoadedWeight = loadedWeightsG.reduce((a, b) => a + b, 0);
  /** A mass no tray denomination has: it can only be the custom weight. */
  const isCustomMass = (g: number) => !WEIGHTS.some((w) => w.grams === g);
  // The runtime's figure, not a second evaluation of the pump curve here (F09).
  const flow = state.live.flowRateLMin;
  const live = state.live;
  const law = forceLawFor(selectedDeflectorId);
  const fitted = lesson.hasInstalledDeflector;
  const customOnCarrier = loadedWeightsG.some((g) => isCustomMass(g));
  const customIndex = Math.max(
    0,
    CUSTOM_WEIGHT_CHOICES_G.indexOf(params.customWeightG) >= 0
      ? CUSTOM_WEIGHT_CHOICES_G.indexOf(params.customWeightG)
      : CUSTOM_WEIGHT_CHOICES_G.findIndex((g) => g >= params.customWeightG)
  );

  /** The balance in words, from the runtime's live readout — the same test the table uses. */
  const balanceText = () => {
    if (live.jetForceOnCarrierN === 0) {
      return isAr
        ? 'لا قوة نفث على الحامل (المضخة متوقفة، أو الغطاء مفتوح، أو لا عاكس).'
        : 'No jet force on the carrier (pump off, tank open or no deflector).';
    }
    if (live.isBalanced) {
      return isAr
        ? `متزن (ضمن ±${BALANCE_TOLERANCE_G} غ)`
        : `Balanced (within ±${BALANCE_TOLERANCE_G} g)`;
    }
    const short = live.balancingMassG - live.loadedMassG;
    return short > 0
      ? isAr
        ? `يحتاج ≈ ${short.toFixed(0)} غ إضافية`
        : `Needs ≈ ${short.toFixed(0)} g more`
      : isAr
        ? `أثقل بـ ≈ ${(-short).toFixed(0)} غ`
        : `≈ ${(-short).toFixed(0)} g too heavy`;
  };

  // Which reading is being balanced is simulation state, and whether the step is ready to
  // confirm is the lesson runner's answer. Both used to be worked out here from the step
  // number, in a predicate that disagreed with the one in `DeviceModel`.
  const activeRow =
    lesson.activeReadingIndex !== null ? lessonRows[lesson.activeReadingIndex] : undefined;
  // One count of recorded readings everywhere (F15): valid, finished readings only — never
  // the live tray. It used to count any lesson row with mass on it, so a disc added at
  // step 6 read "1 / 2" before anything had been recorded. Free mode counts its own
  // readings, out of what its table holds (F10).
  const readingsShown = state.recordedCount;
  const readingsOf = state.recordableCount;
  const readingsDone = guided ? readingsShown >= readingsOf : readingsShown > 0;

  // In Free mode every control is on the panel at once; in Guided mode only the ones the
  // current step asks for.
  const show = (control: PanelControl) => !guided || lesson.panelControls.includes(control);

  const okVisible = lesson.canConfirm;

  const weightOptions = [...WEIGHTS.map((w) => w.grams), params.customWeightG].filter(
    (g, i, arr) => g > 0 && arr.indexOf(g) === i
  );

  /**
   * The apparatus controls, defined once and rendered in whichever layout is active.
   *
   * In guided mode they sit in a compact dock above the step card, so only the control the
   * current step actually needs is on screen — `show()` already gates them on the lesson's
   * `panelControls`. In free mode the same blocks fill the sidebar, which stays the
   * engineering surface. Extracting them keeps one definition rather than two that drift.
   */
  const apparatusControls = (
    <>
      {/* Deflector selection */}
      {show('deflectors') && (
        <div
          className="glass-card"
          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}
        >
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#f58220' }}>
            {isAr ? 'اختر العاكس:' : 'Select deflector:'}
          </span>
          {availableDeflectors.map((d) => (
            <button
              key={d.id}
              // Selected by shape and weight as well as colour (F16): `.is-selected`.
              className={`btn-secondary${selectedDeflectorId === d.id ? ' is-selected' : ''}`}
              aria-pressed={selectedDeflectorId === d.id}
              onClick={() => onSelectDeflector(d.id)}
              // F17: keyboard focus shows this part's card beside it in the 3D view.
              data-component="deflector"
              data-component-variant={d.id}
              style={{ justifyContent: 'flex-start', fontSize: '11px' }}
            >
              {isAr ? d.nameAr : d.nameEn}
            </button>
          ))}
        </div>
      )}

      {/* Power */}
      {show('power') && (
        <button
          className="btn-primary interactive"
          onClick={onTogglePower}
          data-component="powerSwitch"
          style={{
            marginBottom: 12,
            background: isPowerOn ? 'var(--danger-red)' : 'var(--accent-blue)',
            color: isPowerOn ? '#fff' : '#141517',
          }}
        >
          <Power size={16} />
          {isPowerOn
            ? isAr
              ? 'إيقاف المضخة'
              : 'Turn Off Pump'
            : isAr
              ? 'تشغيل المضخة'
              : 'Turn On Pump'}
        </button>
      )}

      {/* Volumetric valve */}
      {show('volumetricValve') && (
        <div className="glass-card" style={{ marginBottom: 12 }}>
          <button
            className="btn-secondary"
            onClick={onToggleVolumetricValve}
            data-component="volumetricValve"
            style={{
              width: '100%',
              fontSize: '11px',
              background: state.isVolumetricValveOpen
                ? 'rgba(245, 130, 32, 0.12)'
                : 'transparent',
              borderColor: state.isVolumetricValveOpen
                ? 'var(--accent-blue)'
                : 'rgba(255,255,255,0.1)',
            }}
          >
            {state.isVolumetricValveOpen
              ? isAr
                ? 'الصمام الحجمي مفتوح'
                : 'Volumetric valve open'
              : isAr
                ? 'فتح الصمام الحجمي'
                : 'Open volumetric valve'}
          </button>
        </div>
      )}

      {/* Flow valve */}
      {show('flowValve') && (
        <div className="glass-card valve-slider-container" style={{ marginBottom: 12 }}>
          <div className="slider-label">
            <span>{isAr ? 'صمام التدفق (n):' : 'Flow control valve (n):'}</span>
            <span className="slider-val">{(valveOpening * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={valveOpening}
            onChange={(e) => onSetValve(parseFloat(e.target.value))}
            data-component="flowValve"
          />
          <div
            style={{
              fontSize: '11px',
              color: '#8fa7ad',
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 4,
            }}
          >
            <span>{isAr ? 'مغلق' : 'Closed'}</span>
            <span>Q ≈ {flow.toFixed(1)} L/min</span>
            <span>{isAr ? 'مفتوح' : 'Open'}</span>
          </div>
        </div>
      )}

      {/* Weights */}
      {show('weights') && (
        <div
          className="glass-card"
          style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>{isAr ? 'الأوزان المضافة:' : 'Added weights:'}</span>
            <span
              // A stable hook, like the cover's. Matching on the visible words breaks in
              // Arabic and moved with the control when the guided dock replaced the
              // sidebar; the value should be readable wherever the row is rendered.
              data-bedo-loaded-weight={totalLoadedWeight}
              style={{ color: 'var(--accent-gold)', fontWeight: 700 }}
            >
              {totalLoadedWeight} g
            </span>
          </div>

          <div className="weight-pan-grid">
            {weightOptions.map((g) =>
              isCustomMass(g) ? (
                // The custom weight is named, not given a mass: it is one part whatever the
                // custom control is set to (F04). Two cells wide, so the name fits.
                <button
                  key={g}
                  className="weight-add-btn"
                  onClick={() => onAddWeight(g)}
                  style={{ gridColumn: 'span 2' }}
                  aria-label={
                    isAr ? `إضافة الوزن المخصص (${g} غ)` : `Add custom weight (${g} g)`
                  }
                  title={isAr ? `الوزن المخصص: ${g} غ` : `Custom weight: ${g} g`}
                >
                  {isAr ? '+وزن مخصص' : '+Custom weight'}
                </button>
              ) : (
                <button
                  key={g}
                  className="weight-add-btn"
                  onClick={() => onAddWeight(g)}
                  data-component="weight"
                  data-component-variant={g}
                >
                  +{g}g
                </button>
              )
            )}
          </div>

          {/*
            The discs on the holder, in the order they were stacked. Clicking one
            takes that one off — the storyboard's "click on the weight on holder"
            (sl. 32), which the panel had no equivalent for. Position, not mass:
            two 50 g discs are two discs.

            Only the top one is available (F03): the discs are threaded on the post, so
            a disc lower down cannot come off until the ones above it have. The others
            stay listed, disabled, so the learner can still see the stack's order.
          */}
          {loadedWeightsG.length > 0 && (
            <div className="weight-pan-grid">
              {loadedWeightsG.map((g, index) => {
                const onTop = index === loadedWeightsG.length - 1;
                const custom = isCustomMass(g);
                const name = custom
                  ? isAr
                    ? 'الوزن المخصص'
                    : 'custom weight'
                  : isAr
                    ? `${g} غ`
                    : `${g} g`;
                const label = onTop
                  ? isAr
                    ? `إزالة ${name}`
                    : `Remove ${name}`
                  : isAr
                    ? `أزل الأوزان الموجودة فوق ${name} أولاً`
                    : `Take off the weights above ${custom ? 'the ' : ''}${name} first`;
                return (
                  <button
                    key={`${index}-${g}`}
                    disabled={!canRemoveWeights || !onTop}
                    onClick={() => onRemoveWeight(index)}
                    title={label}
                    aria-label={
                      onTop
                        ? custom
                          ? label
                          : isAr
                            ? `إزالة ${g} غرام`
                            : `Remove ${g} g`
                        : label
                    }
                    // Removal reads as removal by its "−" and its red edge; the ones under
                    // another weight are disabled and get the shared disabled look (F16).
                    className="weight-add-btn is-danger"
                    style={custom ? { gridColumn: 'span 2' } : undefined}
                  >
                    {custom ? (isAr ? '−وزن مخصص' : '−Custom weight') : `−${g}g`}
                  </button>
                );
              })}
            </div>
          )}

          <button
            className="btn-secondary is-danger"
            disabled={!canRemoveWeights}
            onClick={onClearWeights}
          >
            {isAr ? 'إزالة كافة الأوزان' : 'Clear all weights'}
          </button>

          {activeRow && (
            <div
              className={`indicator-card ${
                activeRow.isBalanced ? 'indicator-balanced' : 'indicator-unbalanced'
              }`}
            >
              {/* Success and warning differ by icon and words, not only by colour (F16). */}
              {activeRow.isBalanced ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <Scale size={16} aria-hidden="true" />
              )}
              <span>
                {activeRow.isBalanced
                  ? isAr
                    ? 'المؤشر متوازن!'
                    : 'Pointer balanced!'
                  : isAr
                    ? `غير متوازن (الهدف ≈ ${activeRow.targetMassG.toFixed(0)} غ)`
                    : `Unbalanced (target ≈ ${activeRow.targetMassG.toFixed(0)} g)`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Monitor */}
      {show('monitor') && (
        // Names the action it will take (F16). It toggles, and with the board already
        // docked it used to still say "Open Data Monitor" in the green of a next step.
        <button
          className={state.showMonitor ? 'btn-secondary' : 'btn-primary'}
          onClick={onToggleMonitor}
          style={state.showMonitor ? undefined : { background: 'var(--success-green)' }}
        >
          <Monitor size={16} />
          {state.showMonitor
            ? isAr
              ? 'إغلاق شاشة البيانات'
              : 'Close Data Monitor'
            : isAr
              ? 'فتح شاشة البيانات'
              : 'Open Data Monitor'}
        </button>
      )}
    </>
  );

  /*
    The two popups (F16): a refusal and an observation, told apart by an icon and a word
    as well as by colour. In Guided they sit in the shell's centre column, clear of the
    rails; elsewhere at the top of the stage.
  */
  const inGuidedShell = guided && started && !guidedPanelOpen;
  const popups = (
    <>
        {/* Blocking guard from the state machine */}
        {warningMessage && (
          // `role="alert"` because this is the interlock's only feedback. A refused action —
          // pressing the tank-cover button while the pump runs, say — changes nothing on
          // screen except this popup, so without a live region a screen-reader user is told
          // nothing at all and the control appears simply not to work.
          <div className={`warning-popup is-warning interactive ${isAr ? 'rtl' : ''}`} role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <strong className="popup-kind">{isAr ? 'غير مسموح' : 'Not allowed'}</strong>
            <span>{isAr ? warningMessage.ar : warningMessage.en}</span>
            <button onClick={clearWarning}>{isAr ? 'حسناً' : 'OK'}</button>
          </div>
        )}

        {/* Non-blocking observation from the experiment sheet */}
        {notice && !warningMessage && (
          <div
            className={`warning-popup is-note interactive ${isAr ? 'rtl' : ''}`}
            // An observation, not a refusal: announced politely so it never interrupts.
            role="status"
          >
            <Info size={18} aria-hidden="true" />
            <strong className="popup-kind">{isAr ? 'ملاحظة' : 'Note'}</strong>
            <span>{isAr ? notice.ar : notice.en}</span>
            {/*
              Not "OK" (F14): the step card's OK advances the procedure, and a second OK
              on screen read as a second step to confirm. This one only dismisses a note.
            */}
            <button onClick={clearNotice} aria-label={isAr ? 'إخفاء الملاحظة' : 'Dismiss note'}>
              {isAr ? 'فهمت' : 'Got it'}
            </button>
          </div>
        )}
    </>
  );

  return (
    /*
      `is-board-view` clears the stage.

      While the camera is parked at the printed board, the contextual dock and the step
      card sit directly over the panel being read — the Total Weight circle, the nozzle
      box and the live figures are all behind them. The global row stays, because that is
      where `Back to Step` lives.
    */
    <div className={`ui-container ${isAr ? 'rtl' : ''}${boardView ? ' is-board-view' : ''}`}>
      {!inGuidedShell && popups}

      {/*
        The sidebar is now the free-mode engineering surface, not the guided UI.

        The reference guided experience puts one instruction at the bottom centre over the
        apparatus and nothing permanent down the left; keeping this panel up during a
        guided step is exactly the "all settings live on the left" shape the rebuild
        removes. Everything it carries stays reachable while guided — the apparatus
        controls move into the dock below, the global actions into the footer.
      */}
      {(!guided || guidedPanelOpen) && (
      <div className="sidebar-panel interactive">
        <div className="sidebar-header">
          <div className="logo-container">
            <Layers size={20} />
          </div>
          <div>
            <h2 className="logo-title">VL-FM009</h2>
            <p className="logo-subtitle">
              {isAr ? 'قياس قوة نفث الماء' : 'Measurement of Jet Forces'}
            </p>
          </div>
          <div className="sidebar-header-actions">
            <button
              className="lang-btn"
              style={{
                background: 'rgba(245,130,32,0.12)',
                borderColor: 'rgba(245,130,32,0.4)',
                color: '#f58220',
                fontSize: '10px',
                padding: '4px 8px',
              }}
              onClick={() => setShowVideo(true)}
            >
              {isAr ? 'فيديو' : 'Video'}
            </button>
            <button
              className="lang-btn"
              style={{ fontSize: '10px', padding: '4px 8px' }}
              onClick={() => onSelectLanguage(isAr ? 'en' : 'ar')}
            >
              {isAr ? 'English' : 'العربية'}
            </button>
          </div>
        </div>

        {/* Free / Guided, as in the reference */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(['free', 'guided'] as const).map((m) => (
            <button
              key={m}
              className={`btn-secondary${(guided ? 'guided' : 'free') === m ? ' is-selected' : ''}`}
              aria-pressed={(guided ? 'guided' : 'free') === m}
              onClick={() => onSetMode(m)}
              style={{ flex: 1, fontSize: '11px', padding: '6px' }}
            >
              {m === 'free'
                ? isAr
                  ? 'الوضع الحر'
                  : 'Free Mode'
                : isAr
                  ? 'الوضع الموجّه'
                  : 'Guided Mode'}
            </button>
          ))}
        </div>

        {/* Panel tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(
            [
              ['steps', ListChecks, isAr ? 'الخطوات' : 'Steps'],
              ['experiments', FlaskConical, isAr ? 'التجارب' : 'Experiments'],
              ['params', SlidersHorizontal, isAr ? 'المعاملات' : 'Parameters'],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              className={`btn-secondary${panel === key ? ' is-selected' : ''}`}
              aria-pressed={panel === key}
              onClick={() => {
                setPanel(key);
                // Returning to Steps returns to the focused guided view.
                if (guided && key === 'steps') setGuidedPanelOpen(false);
              }}
              style={{ flex: 1, fontSize: '10px', padding: '5px 4px', gap: 4 }}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        <div className="menu-content-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
          {/* ------------------------------------------------ Experiments */}
          {panel === 'experiments' && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#f58220' }}>
                {isAr ? 'اختر التجربة:' : 'Select experiment:'}
              </span>
              {EXPERIMENTS.map((exp) => (
                <button
                  key={exp.id}
                  className="btn-secondary"
                  onClick={() => onSelectExperiment(exp.id)}
                  style={{
                    justifyContent: 'flex-start',
                    fontSize: '11px',
                    textAlign: 'left',
                    borderColor: experiment.id === exp.id ? '#f58220' : 'rgba(255,255,255,0.08)',
                    background:
                      experiment.id === exp.id ? 'rgba(245, 130, 32, 0.08)' : 'transparent',
                    color: experiment.id === exp.id ? '#f58220' : '#fff',
                  }}
                >
                  {isAr ? exp.nameAr : exp.nameEn}
                </button>
              ))}
              <div
                style={{
                  fontSize: '10px',
                  color: '#8fa7ad',
                  lineHeight: 1.6,
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  paddingTop: 8,
                }}
              >
                <strong style={{ color: 'var(--accent-blue)' }}>
                  {isAr ? 'قانون هذه التجربة:' : 'This experiment’s force law:'}
                </strong>
                <br />
                {isAr ? experiment.lawAr : experiment.lawEn}
                {/* The deflector actually fitted, which in free mode may be another sheet's. */}
                <br />
                <strong style={{ color: 'var(--accent-blue)' }}>
                  {isAr ? 'العاكس على القضيب:' : 'On the rod now:'}
                </strong>{' '}
                {fitted
                  ? `${isAr ? law.deflector.nameAr : law.deflector.nameEn} — ${law.equation}, ${
                      isAr ? law.factorAr : law.factorEn
                    }`
                  : isAr
                    ? 'لا يوجد'
                    : 'none'}
              </div>
            </div>
          )}

          {/* ------------------------------------------------ Parameters (F09) */}
          {/*
            An editor over the simulation runtime, not a panel of its own numbers.

            It edits the two experiment inputs that are not parts of the rig — Q_total and
            the custom disc's mass — and shows, read-only, what they drive. The deflector is
            *not* chosen here: it is a part, fitted with the tank open, and its control is
            the tray and the Steps list. A second set of deflector buttons here was a second
            path to the same variable (QA F09). Every figure below is read from
            `state.live`, the same selector the board and the monitor read.
          */}
          {panel === 'params' && (
            <div
              className="glass-card params-editor"
              data-bedo-params
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#f58220' }}>
                {isAr ? 'معاملات التجربة' : 'Experiment parameters'}
              </span>

              {/* Q_total */}
              <div>
                <div className="slider-label">
                  <label htmlFor="bedo-param-qtotal">
                    {isAr ? 'تدفق المضخة عند فتح الصمام كلياً، Q_total' : 'Pump delivery at full valve, Q_total'}
                  </label>
                  <span className="slider-val" data-bedo-param-qtotal={params.pumpFlowLMin}>
                    {params.pumpFlowLMin} L/min
                  </span>
                </div>
                <input
                  id="bedo-param-qtotal"
                  type="range"
                  min={PUMP_FLOW_RANGE_L_MIN.min}
                  max={PUMP_FLOW_RANGE_L_MIN.max}
                  step={PUMP_FLOW_RANGE_L_MIN.step}
                  value={params.pumpFlowLMin}
                  aria-valuetext={`${params.pumpFlowLMin} L/min`}
                  onChange={(e) => onSetParams({ pumpFlowLMin: parseFloat(e.target.value) })}
                />
                <p className="param-hint" data-bedo-param-flow={live.flowRateLMin.toFixed(3)}>
                  {valveOpening > 0
                    ? isAr
                      ? `التدفق عبر الفوهة الآن: Q = ${live.flowRateLMin.toFixed(2)} L/min عند فتحة الصمام n = ${(valveOpening * 100).toFixed(0)}%`
                      : `Through the nozzle now: Q = ${live.flowRateLMin.toFixed(2)} L/min at valve n = ${(valveOpening * 100).toFixed(0)} %`
                    : isAr
                      ? 'صمام التدفق مغلق: لا يمر ماء بعد.'
                      : 'Flow valve closed: no water through the nozzle yet.'}
                </p>
              </div>

              {/* Custom disc mass */}
              <div>
                <div className="slider-label">
                  <label htmlFor="bedo-param-custom">
                    {isAr ? 'كتلة الوزن المخصص' : 'Custom weight disc mass'}
                  </label>
                  <span className="slider-val" data-bedo-param-custom={params.customWeightG}>
                    {params.customWeightG} g
                  </span>
                </div>
                <input
                  id="bedo-param-custom"
                  type="range"
                  min={0}
                  max={CUSTOM_WEIGHT_CHOICES_G.length - 1}
                  step={1}
                  value={customIndex}
                  // A disc in flight is on its way to a seat the runtime has already given
                  // it; its mass must not change under it. Disabled, with the reason below.
                  disabled={!canRemoveWeights}
                  aria-valuetext={`${params.customWeightG} g`}
                  onChange={(e) =>
                    onSetParams({
                      customWeightG: CUSTOM_WEIGHT_CHOICES_G[parseInt(e.target.value, 10)],
                    })
                  }
                />
                <p className="param-hint">
                  {!canRemoveWeights
                    ? isAr
                      ? 'انتظر حتى تستقر الأوزان.'
                      : 'Wait for the weights to settle.'
                    : customOnCarrier
                      ? isAr
                        ? 'على الحامل: الحمل والنابض والاتزان تتبع هذه الكتلة.'
                        : 'On the carrier: the load, spring and balance follow this mass.'
                      : isAr
                        ? 'على الصينية. أضفه بزر «+وزن مخصص» في الخطوات.'
                        : 'On the tray. Add it with “+Custom weight” under Steps.'}
                  <br />
                  {isAr
                    ? 'يتخطى 10 و20 و50 و100 و200 و500 غ — أوزان الصينية نفسها.'
                    : 'Skips 10, 20, 50, 100, 200 and 500 g — the tray’s own discs.'}
                </p>
              </div>

              {/* Deflector: read-only */}
              <div className="param-readonly" data-bedo-param-deflector={fitted ? law.deflector.id : 'none'}>
                <span style={{ fontSize: '11px', color: 'var(--accent-blue)' }}>
                  {isAr ? 'العاكس على القضيب' : 'Deflector on the rod'}
                </span>
                {fitted ? (
                  <>
                    <span className="param-value">
                      {isAr ? law.deflector.nameAr : law.deflector.nameEn}
                    </span>
                    <span className="param-mono">{law.equation}</span>
                    <span className="param-mono" data-bedo-param-k={law.k.toFixed(3)}>
                      {isAr ? `معامل الزخم ${law.factorAr}` : `Momentum factor ${law.factorEn}`}
                    </span>
                  </>
                ) : (
                  <span className="param-value">
                    {isAr
                      ? 'لا يوجد — يصعد النفث مباشرة إلى الغطاء.'
                      : 'None fitted — the jet runs straight to the cover.'}
                  </span>
                )}
                <p className="param-hint">
                  {isAr
                    ? 'يُغيَّر من الصينية أو من «اختر العاكس» في الخطوات، والغطاء مفتوح.'
                    : 'Changed on the tray, or with “Select deflector” under Steps, with the tank open.'}
                </p>
              </div>

              {/* What they drive: read-only, from the simulation */}
              <div className="param-readonly">
                <span style={{ fontSize: '11px', color: 'var(--accent-blue)' }}>
                  {isAr ? 'النتائج الآن' : 'Results now'}
                </span>
                <dl className="param-grid">
                  <dt>{isAr ? 'سرعة الخروج v₀' : 'Nozzle velocity v₀'}</dt>
                  <dd>{live.nozzleVelocityMS.toFixed(3)} m/s</dd>
                  <dt>{isAr ? 'القوة على الحامل' : 'Jet force on carrier'}</dt>
                  <dd data-bedo-param-fjet={live.jetForceOnCarrierN.toFixed(4)}>
                    {live.jetForceOnCarrierN.toFixed(4)} N
                  </dd>
                  <dt>{isAr ? 'الحمل على الحامل' : 'Load on carrier'}</dt>
                  <dd data-bedo-param-load={live.loadedMassG}>
                    {live.loadedMassG} g · {live.measuredForceN.toFixed(4)} N
                  </dd>
                  <dt>{isAr ? 'الاتزان' : 'Balance'}</dt>
                  <dd data-bedo-param-balance={live.isBalanced ? 'balanced' : 'unbalanced'}>
                    {balanceText()}
                  </dd>
                </dl>
              </div>

              <button
                className="btn-secondary"
                onClick={() =>
                  onSetParams({
                    pumpFlowLMin: DEFAULT_PUMP_FLOW_L_MIN,
                    customWeightG: DEFAULT_CUSTOM_WEIGHT_G,
                  })
                }
                disabled={
                  !canRemoveWeights ||
                  (params.pumpFlowLMin === DEFAULT_PUMP_FLOW_L_MIN &&
                    params.customWeightG === DEFAULT_CUSTOM_WEIGHT_G)
                }
                style={{ fontSize: '11px' }}
              >
                {isAr
                  ? `استعادة القيم الافتراضية (${DEFAULT_PUMP_FLOW_L_MIN} L/min، ${DEFAULT_CUSTOM_WEIGHT_G} غ)`
                  : `Restore defaults (${DEFAULT_PUMP_FLOW_L_MIN} L/min, ${DEFAULT_CUSTOM_WEIGHT_G} g)`}
              </button>
              <p className="param-hint" style={{ marginTop: -8 }}>
                {isAr
                  ? '«إعادة تعيين المحاكي» يعيد الجهاز ويُبقي هذه القيم.'
                  : '“Reset simulator” restores the rig and keeps these values.'}
              </p>
            </div>
          )}

          {/* ------------------------------------------------ Steps / controls */}
          {panel === 'steps' && (
            <>
              {/*
                The guided step is rendered once, by `StepInstructionCard` in the bottom
                dock. It used to live here too; with the panel now openable during a step
                that produced two copies of the same instruction, two step badges and two
                OK buttons.
              */}
              {!guided && (
                <div
                  className="glass-card"
                  style={{ marginBottom: 14, borderLeft: '3px solid #f58220' }}
                >
                  <p className="step-desc" style={{ margin: 0 }}>
                    {isAr
                      ? 'الوضع الحر: يمكنك التفاعل مع أي جزء من الجهاز بأي ترتيب.'
                      : 'Free mode — interact with any part of the rig, in any order.'}
                  </p>
                </div>
              )}

              {apparatusControls}
            </>
          )}
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            paddingTop: 14,
            marginTop: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: '#8fa7ad',
              marginBottom: 8,
            }}
          >
            <span>{isAr ? 'غطاء الخزان:' : 'Tank cover:'}</span>
            <span
              // A stable hook for the cover's state. Reading it from the visible words is
              // ambiguous now that a "Open tank cover" button sits beside this row, and
              // bilingual text cannot be matched on the English words at all.
              data-bedo-cover-state={isCoverOpen ? 'open' : 'closed'}
              style={{
                color: isCoverOpen ? 'var(--accent-gold)' : 'var(--success-green)',
                fontWeight: 600,
              }}
            >
              {isCoverOpen ? (isAr ? 'مفتوح' : 'Open') : isAr ? 'مغلق' : 'Closed'}
            </span>
          </div>

          {/*
            The tank cover's only real control used to be the plate mesh inside the WebGL
            canvas, which cannot be reached by keyboard: step 1 of the lesson was therefore
            impossible without a pointer. (The `window.__bedoTest.coverClick` adapter is
            dev-only and compiled out of production builds, so it is not an answer.)

            This raises exactly the intent the mesh raises, through the same gate, so
            pressing it out of turn is refused with the same message rather than skipping
            any lesson state. It is deliberately not wrapped in `show(...)`: the mesh is
            always clickable, so gating the keyboard equivalent would make the DOM path
            weaker than the pointer path, which is the defect being fixed.
          */}
          {/*
            No `aria-pressed` here on purpose. This button re-labels itself to name the
            next action ("Open tank cover" / "Close tank cover"), and the ARIA toggle-button
            pattern says to do that OR expose a pressed state, not both: "Close tank cover,
            toggle button, pressed" invites the reading that *closing* is the active state,
            when the flag actually means the cover is open. The label carries the action and
            the status line above carries the state.
          */}
          <button
            className="btn-secondary"
            onClick={onCoverClick}
            data-component="tankCover"
            style={{ width: '100%', fontSize: 11, marginBottom: 8 }}
          >
            {isCoverOpen
              ? isAr
                ? 'إغلاق غطاء الخزان'
                : 'Close tank cover'
              : isAr
                ? 'فتح غطاء الخزان'
                : 'Open tank cover'}
          </button>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: '#8fa7ad',
              marginBottom: 12,
            }}
          >
            <span>{isAr ? 'القراءات المسجلة:' : 'Recorded readings:'}</span>
            <span
              style={{ color: readingsDone ? 'var(--success-green)' : '#fff', fontWeight: 600 }}
            >
              {readingsDone && <CheckCircle2 size={12} aria-hidden="true" style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />}
              {readingsShown} / {readingsOf}
            </span>
          </div>

          <button
            className="btn-secondary"
            onClick={onReset}
            style={{ width: '100%' }}
            title={
              isAr
                ? 'يمسح الجهاز وتقدّم الدرس وجميع القراءات؛ يُبقي Q_total والوزن المخصص. يطلب التأكيد قبل مسح أي شيء.'
                : 'Clears the rig, the lesson progress and all readings; keeps Q_total and the custom weight. Asks first when there is anything to lose.'
            }
          >
            <RefreshCw size={14} />
            {isAr ? 'إعادة تشغيل المعمل' : 'Reset simulator'}
          </button>
        </div>
      </div>
      )}

      {/*
        The focused dock stands down while the full panel is open, so the two never compete
        — and so controls like Free Mode are not on screen twice.
      */}
      {inGuidedShell && (() => {
        /*
          The guided shell (F16).

          A grid on the safe edges instead of hand-placed boxes. Its tracks decide where
          everything goes, at any size:

            [ start rail ]  [ centre: notes ]  [ end rail ]
            [ bottom: the dock (centred layout), then the footer ]

          The start rail carries the title chip and the Steps view; at the weight steps the
          dock moves into it (so the weights sit beside the jet rather than over it) and the
          Steps view moves to the end rail. Nothing is positioned for one resolution: the
          bottom row is as tall as the dock and footer need, the rails get what is left,
          and each long region scrolls inside itself.
        */
        const dock = (
          <>
                    {/*
                      Bottom dock: only the control this step needs, then the instruction.
                      `show()` already gates each control on the lesson's `panelControls`, so the
                      dock is empty on steps that ask for a purely physical action.
                    */}
                    <div className="guided-dock interactive">
                      <div className="guided-controls">{apparatusControls}</div>
                      {activeStep && (
                        <StepInstructionCard
                          lesson={lesson}
                          language={state.language}
                          okVisible={okVisible}
                          onOkClick={onOkClick}
                          showAnswerSheet={show('answerSheet')}
                          onOpenAnswerSheet={onOpenAnswerSheet}
                        />
                      )}
                    </div>
          </>
        );
        const stepsView = (
          <>
                    {/*
                      The Steps view (F14): the procedure and where the learner is on it. Beside the
                      dock rather than over it — at the weight steps the dock moves aside to the
                      left, so the list moves to the right.
                    */}
                    {showSteps && !boardView && (
                      <StepProgress
                        rows={lesson.progress}
                        isComplete={lesson.isComplete}
                        language={state.language}
                        placement={asideForWeights ? 'end' : 'start'}
                        onClose={() => setShowSteps(false)}
                      />
                    )}
          </>
        );
        return (
          <div className={`guided-shell is-${asideForWeights ? 'aside' : 'centre'}`} data-bedo-guided-shell>
            <div className="guided-rail is-start">
                  {/* Quiet identification, so the apparatus keeps the viewport. */}
                  <div className="guided-chip">
                    <span className="guided-chip-code">VL-FM009</span>
                    <span className="guided-chip-title">
                      {isAr ? 'قياس قوة نفث الماء' : 'Measurement of Jet Forces'}
                    </span>
                  </div>
              {asideForWeights ? dock : stepsView}
            </div>
            <div className="guided-centre">{popups}</div>
            <div className="guided-rail is-end">{asideForWeights ? stepsView : null}</div>
            <div className="guided-bottom">
              {asideForWeights ? null : dock}
                  {/* Global actions, deliberately small and out of the way. */}
                  <div className="guided-footer interactive">
                    <button
                      className={`guided-footer-btn${showSteps ? ' is-active' : ''}`}
                      onClick={() => setShowSteps((open) => !open)}
                      aria-pressed={showSteps}
                      data-bedo-steps-toggle
                    >
                      <ListChecks size={13} />
                      {isAr ? 'الخطوات' : 'Steps'}
                    </button>
                    <span className="guided-cover-state">
                      {isAr ? 'غطاء الخزان:' : 'Tank cover:'}{' '}
                      <span
                        data-bedo-cover-state={isCoverOpen ? 'open' : 'closed'}
                        style={{ color: isCoverOpen ? 'var(--accent-gold)' : 'var(--success-green)' }}
                      >
                        {isCoverOpen ? (isAr ? 'مفتوح' : 'Open') : isAr ? 'مغلق' : 'Closed'}
                      </span>
                    </span>
                    {/* Progress across the two readings — the one number the sidebar carried that
                        is genuinely about how far the experiment has got, so it belongs here. */}
                    <span className="guided-cover-state">
                      {isAr ? 'القراءات المسجلة:' : 'Recorded readings:'}{' '}
                      <span style={{ color: readingsDone ? 'var(--success-green)' : '#fff' }}>
                        {readingsDone && <CheckCircle2 size={12} aria-hidden="true" style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />}
                        {readingsShown} / {readingsOf}
                      </span>
                    </span>
                    <button className="guided-footer-btn" onClick={onCoverClick} data-component="tankCover">
                      {isCoverOpen
                        ? isAr
                          ? 'إغلاق غطاء الخزان'
                          : 'Close tank cover'
                        : isAr
                          ? 'فتح غطاء الخزان'
                          : 'Open tank cover'}
                    </button>
                    <button
                      className="guided-footer-btn"
                      onClick={() => {
                        setPanel('experiments');
                        setGuidedPanelOpen(true);
                      }}
                    >
                      {isAr ? 'التجارب' : 'Experiments'}
                    </button>
                    {/*
                      The board as a secondary utility, not a step's contextual control.

                      `panelControls` stays what it is — the one action the current step asks for —
                      and the board is reachable from the global row beside Experiments and Video,
                      throughout the run. It is hidden at the steps whose own contextual control is
                      already the board (9-11), so there is exactly one way to open it at any
                      moment. Opening it changes no simulation state and advances no step, except
                      at `open-monitor`, where opening the board has always been what completes it.
                    */}
                    {/*
                      The printed board, brought into view.

                      The guided step framings are composed around the apparatus, so the wall board
                      is out of shot at every working step — measured. Rather than widen those
                      compositions, this parks the camera at the board and puts it back. It is a
                      utility beside Monitor, not a step's control, and it advances nothing.
                    */}
                    <button
                      className={`guided-footer-btn${boardView ? ' is-active' : ''}`}
                      onClick={onToggleBoardView}
                    >
                      <ClipboardList size={13} />
                      {boardView
                        ? isAr
                          ? 'العودة للخطوة'
                          : 'Back to Step'
                        : isAr
                          ? 'اللوحة'
                          : 'Board'}
                    </button>
                    {!show('monitor') && (
                      <button
                        className="guided-footer-btn"
                        onClick={onToggleMonitor}
                        aria-label={isAr ? 'فتح شاشة البيانات' : 'Open Data Monitor'}
                      >
                        <Monitor size={13} />
                        {isAr ? 'شاشة البيانات' : 'Monitor'}
                      </button>
                    )}
                    <button className="guided-footer-btn" onClick={() => setShowVideo(true)}>
                      {isAr ? 'فيديو' : 'Video'}
                    </button>
                    <button className="guided-footer-btn" onClick={() => onSetMode('free')}>
                      {isAr ? 'الوضع الحر' : 'Free Mode'}
                    </button>
                    <button className="guided-footer-btn" onClick={onReset}>
                      {isAr ? 'إعادة تشغيل المعمل' : 'Reset simulator'}
                    </button>
                    {/* Compact EN | AR, as requested: a footer control, not a panel. */}
                    <button
                      className="guided-footer-btn is-lang"
                      onClick={() => onSelectLanguage(isAr ? 'en' : 'ar')}
                    >
                      {isAr ? 'English' : 'العربية'}
                    </button>
                  </div>
            </div>
          </div>
        );
      })()}


      {showVideo && (
        <WalkthroughVideo isArabic={isAr} onClose={() => setShowVideo(false)} />
      )}
    </div>
  );
};
