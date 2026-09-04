import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { WEIGHTS, type DeflectorDef } from '../domain/apparatus';
import type { RecordRow } from '../domain/physics';
import { markReady } from '../lib/readiness';
import { StepInstructionCard } from './StepInstructionCard';
import { EXPERIMENTS, type ExperimentDef } from '../domain/experiments';
import { flowRateLMin } from '../domain/physics';
import { PUMP_FLOW_RANGE_L_MIN } from '../domain/physicsConfig';
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
  /**
   * Take the reading that is on screen.
   *
   * The single explicit event that creates a results row (Phase 1.1/1.2). In guided mode
   * it is the balance step's confirmation, so this control and the step's OK are the same
   * action; in free mode it is the only way to record one.
   */
  onRecordReading: () => void;
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
  onRecordReading,
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

  // The training panel is on screen and usable. See src/lib/readiness.ts.
  useEffect(() => markReady('training'), []);

  const {
    language,
    selectedDeflectorId,
    isCoverOpen,
    isPowerOn,
    valveOpening,
    loadedWeightsG,
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

  /*
    One authority for the mass on the pan.

    `state.live.loadedMassG` is `selectLoadedMassG`, the same selector the board and the
    software monitor read. This used to re-sum `loadedWeightsG` here, which happened to
    agree — but the monitor summed the results table instead and did not, so the three
    surfaces printed three different Total Weights.
  */
  const totalLoadedWeight = state.live.loadedMassG;
  const flow = flowRateLMin(valveOpening, params.pumpFlowLMin);

  /** The rig as one row: balancing mass, signed deviation, tolerance. Never a table row. */
  const liveRow = state.liveRow;
  const readingsTaken = lesson.readingsTaken;

  // In Free mode every control is on the panel at once; in Guided mode only the ones the
  // current step asks for.
  const show = (control: PanelControl) => !guided || lesson.panelControls.includes(control);

  const okVisible = lesson.canConfirm;

  /**
   * The step's confirm lives in the weights panel, as "Record reading".
   *
   * A balance step is finished by recording the reading, and the Record button belongs
   * beside the balance bar that says whether it may be pressed. Without this the card
   * offers a second button with the same label and the same effect.
   */
  const recordInPanel = lesson.recordsReading && show('weights');

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
              className="btn-secondary"
              onClick={() => onSelectDeflector(d.id)}
              style={{
                justifyContent: 'flex-start',
                fontSize: '11px',
                borderColor:
                  selectedDeflectorId === d.id ? '#f58220' : 'rgba(255,255,255,0.08)',
                background:
                  selectedDeflectorId === d.id ? 'rgba(245, 130, 32, 0.08)' : 'transparent',
                color: selectedDeflectorId === d.id ? '#f58220' : '#fff',
              }}
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
        <div className="glass-card weights-panel">
          <div className="weights-total">
            <span>{isAr ? 'الأوزان على القاعدة' : 'Weights on pan'}</span>
            <span
              // A stable hook, like the cover's. Matching on the visible words breaks in
              // Arabic and moved with the control when the guided dock replaced the
              // sidebar; the value should be readable wherever the row is rendered.
              data-bedo-loaded-weight={totalLoadedWeight}
            >
              {totalLoadedWeight} g
            </span>
          </div>

          {/*
            One fixed row per denomination: minus, mass, count, plus.

            **The layout never reflows.** The panel used to render the add buttons, and
            then a *second* grid of remove buttons that only existed once something was on
            the pan. Adding the first disc grew the panel by a row and shoved every button
            up by about 56 px, so the student's next click — aimed at the same place —
            landed on a different denomination. Intending 50 + 20 + 10 produced 750 g.
            Every row is present from the first paint, with a count of zero, so nothing
            moves for the whole of the balancing step.
          */}
          <div className="weight-rows">
            {weightOptions.map((g) => {
              const count = loadedWeightsG.filter((disc) => disc === g).length;
              // By stack position, not by mass: two 50 g discs are two discs, and the one
              // taken off is the one on top.
              const topIndex = loadedWeightsG.lastIndexOf(g);
              return (
                <div className="weight-row" key={g}>
                  <button
                    type="button"
                    className="weight-step"
                    disabled={count === 0 || !canRemoveWeights}
                    onClick={() => onRemoveWeight(topIndex)}
                    aria-label={isAr ? `إزالة ${g} غرام` : `Remove ${g} g`}
                    title={isAr ? `إزالة ${g} غرام` : `Remove ${g} g`}
                  >
                    −
                  </button>
                  <span className="weight-row-mass">{g} g</span>
                  <span className={`weight-row-count${count > 0 ? ' is-loaded' : ''}`}>
                    ×{count}
                  </span>
                  <button
                    type="button"
                    className="weight-step"
                    onClick={() => onAddWeight(g)}
                    aria-label={isAr ? `إضافة ${g} غرام` : `Add ${g} g`}
                    title={isAr ? `إضافة ${g} غرام` : `Add ${g} g`}
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>

          <BalanceBar row={liveRow} isAr={isAr} />

          <div className="weights-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={!canRemoveWeights || totalLoadedWeight === 0}
              onClick={onClearWeights}
            >
              {isAr ? 'إفراغ القاعدة' : 'Clear pan'}
            </button>
            {/*
              The one explicit event that creates a results row.

              Disabled while the tray is off balance, for the same reason the runtime
              ignores the command then: a recorded reading is a balanced reading. The
              counter beside it used to climb on every disc, because the row being
              balanced *was* a table row.
            */}
            <button
              type="button"
              className="btn-primary"
              disabled={!lesson.canRecordReading}
              onClick={onRecordReading}
              style={{
                background: lesson.canRecordReading ? 'var(--success-green)' : undefined,
                color: lesson.canRecordReading ? '#0b1416' : undefined,
              }}
            >
              <ClipboardList size={15} />
              {isAr ? 'تسجيل القراءة' : 'Record reading'}
            </button>
          </div>
        </div>
      )}

      {/* Monitor */}
      {show('monitor') && (
        <button
          className="btn-primary"
          onClick={onToggleMonitor}
          style={{ background: 'var(--success-green)' }}
        >
          <Monitor size={16} />
          {isAr ? 'فتح شاشة البيانات' : 'Open Data Monitor'}
        </button>
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
      {/* Blocking guard from the state machine */}
      {warningMessage && (
        // `role="alert"` because this is the interlock's only feedback. A refused action —
        // pressing the tank-cover button while the pump runs, say — changes nothing on
        // screen except this popup, so without a live region a screen-reader user is told
        // nothing at all and the control appears simply not to work.
        <div className={`warning-popup interactive ${isAr ? 'rtl' : ''}`} role="alert">
          <AlertTriangle size={18} />
          <span>{isAr ? warningMessage.ar : warningMessage.en}</span>
          <button onClick={clearWarning}>{isAr ? 'حسناً' : 'OK'}</button>
        </div>
      )}

      {/* Non-blocking observation from the experiment sheet */}
      {notice && !warningMessage && (
        <div
          className={`warning-popup interactive ${isAr ? 'rtl' : ''}`}
          // An observation, not a refusal: announced politely so it never interrupts.
          role="status"
          style={{ background: 'rgba(0, 162, 255, 0.14)', borderColor: 'var(--accent-blue)' }}
        >
          <Info size={18} />
          <span>{isAr ? notice.ar : notice.en}</span>
          <button onClick={clearNotice}>{isAr ? 'حسناً' : 'OK'}</button>
        </div>
      )}

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
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
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
              className="btn-secondary"
              onClick={() => onSetMode(m)}
              style={{
                flex: 1,
                fontSize: '11px',
                padding: '6px',
                background: (guided ? 'guided' : 'free') === m ? 'rgba(245,130,32,0.14)' : 'transparent',
                borderColor: (guided ? 'guided' : 'free') === m ? '#f58220' : 'rgba(255,255,255,0.08)',
                color: (guided ? 'guided' : 'free') === m ? '#f58220' : '#fff',
                fontWeight: (guided ? 'guided' : 'free') === m ? 700 : 400,
              }}
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
              className="btn-secondary"
              onClick={() => {
                setPanel(key);
                // Returning to Steps returns to the focused guided view.
                if (guided && key === 'steps') setGuidedPanelOpen(false);
              }}
              style={{
                flex: 1,
                fontSize: '10px',
                padding: '5px 4px',
                gap: 4,
                background: panel === key ? 'rgba(0,162,255,0.12)' : 'transparent',
                borderColor: panel === key ? 'var(--accent-blue)' : 'rgba(255,255,255,0.08)',
              }}
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
                  {isAr ? 'القانون:' : 'Force law:'}
                </strong>
                <br />
                {isAr ? experiment.lawAr : experiment.lawEn}
              </div>
            </div>
          )}

          {/* ------------------------------------------------ Custom parameters */}
          {panel === 'params' && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#f58220' }}>
                {isAr ? 'معاملات مخصصة' : 'Custom Parameters'}
              </span>

              <div>
                <div className="slider-label">
                  <span>{isAr ? 'معدل تدفق المضخة Q' : 'Pump flow rate Q_total'}</span>
                  <span className="slider-val">{params.pumpFlowLMin} L/min</span>
                </div>
                {/*
                  Capped at the pump's rating rather than at 200 L/min. A bench of this size
                  delivers 30-40 L/min; at 200 a fully open valve would put 140 N on the
                  vane, which no combination of the discs can balance.
                */}
                <input
                  type="range"
                  min={PUMP_FLOW_RANGE_L_MIN.min}
                  max={PUMP_FLOW_RANGE_L_MIN.max}
                  step={PUMP_FLOW_RANGE_L_MIN.step}
                  value={params.pumpFlowLMin}
                  onChange={(e) => onSetParams({ pumpFlowLMin: parseFloat(e.target.value) })}
                />
              </div>

              <div>
                <div className="slider-label">
                  <span>{isAr ? 'وزن مخصص' : 'Custom weight'}</span>
                  <span className="slider-val">{params.customWeightG} g</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="500"
                  step="5"
                  value={params.customWeightG}
                  onChange={(e) => onSetParams({ customWeightG: parseFloat(e.target.value) })}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '11px', color: 'var(--accent-blue)' }}>
                  {isAr ? 'زاوية العاكس:' : 'Deflector angle:'}
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {availableDeflectors.map((d) => (
                    <button
                      key={d.id}
                      className="btn-secondary"
                      onClick={() => onSelectDeflector(d.id)}
                      style={{
                        fontSize: '11px',
                        padding: '5px 10px',
                        borderColor:
                          selectedDeflectorId === d.id ? '#f58220' : 'rgba(255,255,255,0.08)',
                        color: selectedDeflectorId === d.id ? '#f58220' : '#fff',
                      }}
                    >
                      {d.id}°
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: '10px', color: '#8fa7ad' }}>
                  k = {getFactor(availableDeflectors, selectedDeflectorId)}
                </span>
              </div>
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
              style={{ color: readingsTaken >= 2 ? 'var(--success-green)' : '#fff', fontWeight: 600 }}
            >
              {readingsTaken} / 2
            </span>
          </div>

          <button className="btn-secondary" onClick={onReset} style={{ width: '100%' }}>
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
      {guided && started && !guidedPanelOpen && (
        <>
          {/* Quiet identification, so the apparatus keeps the viewport. */}
          <div className="guided-chip">
            <span className="guided-chip-code">VL-FM009</span>
            <span className="guided-chip-title">
              {isAr ? 'قياس قوة نفث الماء' : 'Measurement of Jet Forces'}
            </span>
          </div>

          {/*
            Bottom dock: only the control this step needs, then the instruction.
            `show()` already gates each control on the lesson's `panelControls`, so the
            dock is empty on steps that ask for a purely physical action.
          */}
          <div className={`guided-dock interactive${asideForWeights ? ' is-aside' : ''}`}>
            <div className="guided-controls">{apparatusControls}</div>
            {activeStep && (
              <StepInstructionCard
                lesson={lesson}
                language={state.language}
                okVisible={okVisible}
                okInPanel={recordInPanel}
                onOkClick={onOkClick}
                showAnswerSheet={show('answerSheet')}
                onOpenAnswerSheet={onOpenAnswerSheet}
              />
            )}
          </div>

          {/* Global actions, deliberately small and out of the way. */}
          <div className={`guided-footer interactive${asideForWeights ? ' is-aside' : ''}`}>
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
              <span style={{ color: readingsTaken >= 2 ? 'var(--success-green)' : '#fff' }}>
                {readingsTaken} / 2
              </span>
            </span>
            {/*
              The mass on the pan, on screen at every step rather than only at the two that
              show the weights panel. Same selector as the board and the monitor — this is
              the third of the three surfaces that used to disagree about Total Weight.
            */}
            <span className="guided-cover-state">
              {isAr ? 'على القاعدة:' : 'On pan:'}{' '}
              <span
                data-bedo-loaded-weight={totalLoadedWeight}
                style={{ color: 'var(--accent-gold)', direction: 'ltr', unicodeBidi: 'isolate' }}
              >
                {totalLoadedWeight} g
              </span>
            </span>
            <button className="guided-footer-btn" onClick={onCoverClick}>
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
        </>
      )}


      {showVideo && (
        <div
          className="monitor-fullscreen"
          style={{
            zIndex: 1000,
            background: 'rgba(20, 21, 23, 0.98)',
            backdropFilter: 'blur(20px)',
            padding: 24,
          }}
        >
          <div className="monitor-header" style={{ marginBottom: 16, paddingBottom: 16 }}>
            <div className="monitor-title-group">
              <h1>{isAr ? 'فيديو توضيحي للتجربة' : 'Experiment Walkthrough Video'}</h1>
            </div>
            <button className="btn-secondary" onClick={() => setShowVideo(false)}>
              {isAr ? 'إغلاق' : 'Close'}
            </button>
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              background: '#000',
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <video
              src="/Bedo_Mesu_J.mp4"
              controls
              autoPlay
              style={{ width: '100%', height: '100%', maxHeight: '72vh', objectFit: 'contain' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};


/**
 * How far the tray is from balancing the jet, and which way.
 *
 * Replaces a boolean and a rounded target. "Unbalanced (target ≈ 260 g)" was true of
 * 250 g and of 0 g alike, and the 250 g case was also being *accepted* as balanced — a
 * 4 % error against a window the panel never showed. This states the deviation, the
 * direction and the number of grams that closes it.
 *
 * The bar's full width is +/-20 % of the required mass; beyond that the marker pins to the
 * end rather than leaving the track. The green band is the tolerance actually in force,
 * which is 2 % or the 5 g floor, whichever is wider — so the band a student aims at is
 * the band the rig judges them by.
 */
const DEVIATION_SCALE = 0.2;

const BalanceBar: React.FC<{ row: RecordRow; isAr: boolean }> = ({ row, isAr }) => {
  // No jet, nothing to balance. Saying "unbalanced" here would be a complaint about a rig
  // that has not been asked to do anything yet.
  if (!(row.balancingMassG > 0)) {
    return (
      <div className="balance-bar is-idle" role="status">
        <Scale size={15} />
        <span>{isAr ? 'افتح صمام التدفق لتحميل العاكس' : 'Open the flow valve to load the deflector'}</span>
      </div>
    );
  }

  const pct = row.deviationFraction * 100;
  const bandPct = (row.toleranceG / row.balancingMassG) * 100;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const markerPct = 50 + clamp(row.deviationFraction / DEVIATION_SCALE) * 50;
  const bandHalf = Math.min(50, (bandPct / 100 / DEVIATION_SCALE) * 50);
  const missingG = Math.round(Math.abs(row.deviationG));

  const hint = row.isBalanced
    ? isAr
      ? 'متوازن'
      : 'Balanced'
    : row.deviationG < 0
      ? isAr
        ? `أضف ${missingG} غرام`
        : `add ${missingG} g`
      : isAr
        ? `أزل ${missingG} غرام`
        : `remove ${missingG} g`;

  return (
    <div
      className={`balance-bar ${row.isBalanced ? 'is-balanced' : 'is-unbalanced'}`}
      // Polite, not assertive: the value changes with every disc, and a student loading
      // the pan should not be interrupted on each one.
      role="status"
      aria-live="polite"
    >
      <div className="balance-bar-head">
        <span className="balance-bar-state">
          <Scale size={15} />
          {row.isBalanced
            ? isAr
              ? 'المؤشر متوازن'
              : 'Pointer balanced'
            : isAr
              ? 'غير متوازن'
              : 'Unbalanced'}
        </span>
        <span className="balance-bar-figures" style={NUMERIC_LTR}>
          {pct >= 0 ? '+' : '−'}
          {Math.abs(pct).toFixed(1)} % · {hint}
        </span>
      </div>

      <div className="balance-bar-track" aria-hidden="true">
        <span
          className="balance-bar-band"
          style={{ left: `${50 - bandHalf}%`, width: `${bandHalf * 2}%` }}
        />
        <span className="balance-bar-datum" />
        <span className="balance-bar-marker" style={{ left: `${markerPct}%` }} />
      </div>

      <div className="balance-bar-foot" style={NUMERIC_LTR}>
        {isAr ? 'المطلوب' : 'Required'} {row.balancingMassG.toFixed(1)} g ·{' '}
        {isAr ? 'السماحية' : 'tolerance'} ±{row.toleranceG.toFixed(1)} g
      </div>
    </div>
  );
};

/**
 * Numbers stay left-to-right inside an Arabic panel.
 *
 * Without the isolate the bidi algorithm reorders the neutral characters in a mixed run
 * and "−16.2 % · add 14 g" comes out with the value detached from its unit.
 */
const NUMERIC_LTR: React.CSSProperties = { direction: 'ltr', unicodeBidi: 'isolate' };

const getFactor = (list: DeflectorDef[], id: number) =>
  list.find((d) => d.id === id)?.momentumFactor.toFixed(3) ?? '—';
