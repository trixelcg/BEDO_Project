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
  Info,
  FlaskConical,
  SlidersHorizontal,
  ListChecks,
} from 'lucide-react';
import { WEIGHTS, type DeflectorDef } from '../domain/apparatus';
import { markReady } from '../lib/readiness';
import { StepInstructionCard } from './StepInstructionCard';
import { EXPERIMENTS, type ExperimentDef } from '../domain/experiments';
import { flowRateLMin } from '../domain/physics';
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
    recordedRows,
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
  const flow = flowRateLMin(valveOpening, params.pumpFlowLMin);

  // Which reading is being balanced is simulation state, and whether the step is ready to
  // confirm is the lesson runner's answer. Both used to be worked out here from the step
  // number, in a predicate that disagreed with the one in `DeviceModel`.
  const activeRow =
    lesson.activeReadingIndex !== null ? recordedRows[lesson.activeReadingIndex] : undefined;
  const readingsTaken = [1, 2].filter((i) => (recordedRows[i]?.loadedMassG ?? 0) > 0).length;

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
            {weightOptions.map((g) => (
              <button key={g} className="weight-add-btn" onClick={() => onAddWeight(g)}>
                +{g}g
              </button>
            ))}
          </div>

          {/*
            The discs on the holder, in the order they were stacked. Clicking one
            takes that one off — the storyboard's "click on the weight on holder"
            (sl. 32), which the panel had no equivalent for. Position, not mass:
            two 50 g discs are two discs.
          */}
          {loadedWeightsG.length > 0 && (
            <div className="weight-pan-grid">
              {loadedWeightsG.map((g, index) => (
                <button
                  key={`${index}-${g}`}
                  className="weight-add-btn"
                  disabled={!canRemoveWeights}
                  onClick={() => onRemoveWeight(index)}
                  title={isAr ? `إزالة ${g} غ` : `Remove ${g} g`}
                  aria-label={isAr ? `إزالة ${g} غرام` : `Remove ${g} g`}
                  style={{ borderColor: 'var(--danger-red)', color: 'var(--danger-red)' }}
                >
                  −{g}g
                </button>
              ))}
            </div>
          )}

          <button
            className="btn-secondary"
            disabled={!canRemoveWeights}
            onClick={onClearWeights}
            style={{ color: 'var(--danger-red)' }}
          >
            {isAr ? 'إزالة كافة الأوزان' : 'Clear all weights'}
          </button>

          {activeRow && (
            <div
              className={`indicator-card ${
                activeRow.isBalanced ? 'indicator-balanced' : 'indicator-unbalanced'
              }`}
            >
              <Scale size={16} />
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
    <div className={`ui-container ${isAr ? 'rtl' : ''}`}>
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
                <input
                  type="range"
                  min="20"
                  max="200"
                  step="5"
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

const getFactor = (list: DeflectorDef[], id: number) =>
  list.find((d) => d.id === id)?.momentumFactor.toFixed(3) ?? '—';
