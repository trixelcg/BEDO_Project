import React, { useState } from 'react';
import type { CustomParams, ExperimentId, Language, SimulationState } from '../types/index';
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
import { WEIGHTS, type DeflectorDef } from '../lib/apparatus';
import { EXPERIMENTS, TOTAL_STEPS, type ExperimentDef, type ExperimentStep } from '../lib/experiments';
import {
  FIRST_READING_VALVE,
  SECOND_READING_VALVE,
  VALVE_SNAP_MARGIN,
  flowRateLMin,
} from '../lib/physics';

interface UIOverlayProps {
  state: SimulationState;
  steps: ExperimentStep[];
  experiment: ExperimentDef;
  availableDeflectors: DeflectorDef[];
  onSelectLanguage: (lang: Language) => void;
  onSetMode: (mode: SimulationState['mode']) => void;
  onSelectExperiment: (id: ExperimentId) => void;
  onSetParams: (params: Partial<CustomParams>) => void;
  onSelectDeflector: (id: number) => void;
  onSetValve: (val: number) => void;
  onAddWeight: (weight: number) => void;
  onClearWeights: () => void;
  onTogglePower: () => void;
  onToggleVolumetricValve: () => void;
  onToggleMonitor: () => void;
  onReset: () => void;
  clearWarning: () => void;
  clearNotice: () => void;
  onOkClick: () => void;
}

type Panel = 'steps' | 'experiments' | 'params';

export const UIOverlay: React.FC<UIOverlayProps> = ({
  state,
  steps,
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
  onTogglePower,
  onToggleVolumetricValve,
  onToggleMonitor,
  onReset,
  clearWarning,
  clearNotice,
  onOkClick,
}) => {
  const [showVideo, setShowVideo] = useState(false);
  const [panel, setPanel] = useState<Panel>('steps');

  const {
    mode,
    currentStep,
    language,
    selectedDeflectorId,
    isCoverOpen,
    isPowerOn,
    valveOpening,
    loadedWeights,
    recordedRows,
    warningMessage,
    notice,
    params,
  } = state;

  const isAr = language === 'ar';
  const guided = mode === 'guided';
  const activeStep = steps.find((s) => s.id === currentStep);

  const totalLoadedWeight = loadedWeights.reduce((a, b) => a + b, 0);
  const flow = flowRateLMin(valveOpening, params.qTotal);

  const valveReady =
    (currentStep === 6 && valveOpening >= FIRST_READING_VALVE - VALVE_SNAP_MARGIN) ||
    (currentStep === 8 && valveOpening >= SECOND_READING_VALVE - VALVE_SNAP_MARGIN);

  const balanceRow = currentStep === 7 ? 1 : currentStep === 9 ? 2 : null;
  const activeRow = balanceRow !== null ? recordedRows[balanceRow] : undefined;
  const readingsTaken = [1, 2].filter((i) => (recordedRows[i]?.actualWeightMass ?? 0) > 0).length;

  // In Free mode every control is on the panel at once; in Guided mode only the one the
  // current step asks for.
  const show = (...stepIds: number[]) => !guided || stepIds.includes(currentStep);

  const okVisible =
    guided &&
    ((currentStep === 2 && isCoverOpen) ||
      (currentStep === 5 && state.isVolumetricValveOpen) ||
      valveReady ||
      (balanceRow !== null && !!activeRow?.balanced) ||
      currentStep === 10);

  const weightOptions = [...WEIGHTS.map((w) => w.grams), params.customWeightG].filter(
    (g, i, arr) => g > 0 && arr.indexOf(g) === i
  );

  return (
    <div className={`ui-container ${isAr ? 'rtl' : ''}`}>
      {/* Blocking guard from the state machine */}
      {warningMessage && (
        <div className={`warning-popup interactive ${isAr ? 'rtl' : ''}`}>
          <AlertTriangle size={18} />
          <span>{isAr ? warningMessage.ar : warningMessage.en}</span>
          <button onClick={clearWarning}>{isAr ? 'حسناً' : 'OK'}</button>
        </div>
      )}

      {/* Non-blocking observation from the experiment sheet */}
      {notice && !warningMessage && (
        <div
          className={`warning-popup interactive ${isAr ? 'rtl' : ''}`}
          style={{ background: 'rgba(0, 162, 255, 0.14)', borderColor: 'var(--accent-blue)' }}
        >
          <Info size={18} />
          <span>{isAr ? notice.ar : notice.en}</span>
          <button onClick={clearNotice}>{isAr ? 'حسناً' : 'OK'}</button>
        </div>
      )}

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
                background: mode === m ? 'rgba(245,130,32,0.14)' : 'transparent',
                borderColor: mode === m ? '#f58220' : 'rgba(255,255,255,0.08)',
                color: mode === m ? '#f58220' : '#fff',
                fontWeight: mode === m ? 700 : 400,
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
              onClick={() => setPanel(key)}
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
                  <span className="slider-val">{params.qTotal} L/min</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="200"
                  step="5"
                  value={params.qTotal}
                  onChange={(e) => onSetParams({ qTotal: parseFloat(e.target.value) })}
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
              {guided && activeStep && (
                <div
                  className="glass-card"
                  style={{ borderLeft: '3px solid var(--accent-blue)', marginBottom: '14px' }}
                >
                  <div className="step-badge">
                    {isAr
                      ? `الخطوة ${currentStep} / ${TOTAL_STEPS}`
                      : `Step ${currentStep} / ${TOTAL_STEPS}`}
                  </div>
                  <h3 className="step-title" style={{ marginTop: 8, marginBottom: 6 }}>
                    {isAr ? activeStep.titleAr : activeStep.titleEn}
                  </h3>
                  <p className="step-desc">{isAr ? activeStep.bodyAr : activeStep.bodyEn}</p>

                  {okVisible && (
                    <button
                      className="btn-primary interactive ok-confirm-btn"
                      onClick={onOkClick}
                      style={{
                        marginTop: 12,
                        width: '100%',
                        background: '#f58220',
                        color: '#fff',
                        fontWeight: 'bold',
                        boxShadow: '0 0 12px rgba(245, 130, 32, 0.4)',
                      }}
                    >
                      {isAr ? 'موافق' : 'OK'}
                    </button>
                  )}
                </div>
              )}

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

              {/* Deflector selection */}
              {show(2) && (
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
              {show(4) && (
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
              {show(5) && (
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
              {show(6, 8) && (
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
              {show(7, 9) && (
                <div
                  className="glass-card"
                  style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>{isAr ? 'الأوزان المضافة:' : 'Added weights:'}</span>
                    <span style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>
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

                  <button
                    className="btn-secondary"
                    onClick={onClearWeights}
                    style={{ color: 'var(--danger-red)' }}
                  >
                    {isAr ? 'إزالة كافة الأوزان' : 'Clear all weights'}
                  </button>

                  {activeRow && (
                    <div
                      className={`indicator-card ${
                        activeRow.balanced ? 'indicator-balanced' : 'indicator-unbalanced'
                      }`}
                    >
                      <Scale size={16} />
                      <span>
                        {activeRow.balanced
                          ? isAr
                            ? 'المؤشر متوازن!'
                            : 'Pointer balanced!'
                          : isAr
                            ? `غير متوازن (الهدف ≈ ${activeRow.idealMass.toFixed(0)} غ)`
                            : `Unbalanced (target ≈ ${activeRow.idealMass.toFixed(0)} g)`}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Monitor */}
              {show(10, 11, 12) && (
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
              style={{
                color: isCoverOpen ? 'var(--accent-gold)' : 'var(--success-green)',
                fontWeight: 600,
              }}
            >
              {isCoverOpen ? (isAr ? 'مفتوح' : 'Open') : isAr ? 'مغلق' : 'Closed'}
            </span>
          </div>

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
  list.find((d) => d.id === id)?.factor.toFixed(3) ?? '—';
