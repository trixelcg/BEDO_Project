import React, { useState } from 'react';
import type { Language, StepDefinition, SimulationState } from '../types/index';
import { Layers, Power, Scale, RefreshCw, AlertTriangle, Monitor } from 'lucide-react';

const STEPS: StepDefinition[] = [
  {
    id: 0,
    nameEn: "",
    nameAr: "",
    descEn: "",
    descAr: ""
  },
  {
    id: 1,
    nameEn: "Step 1: Unscrew Upper Plate",
    nameAr: "الخطوة 1: فك اللوحة العلوية",
    descEn: "Press the upper plate to unscrew it.",
    descAr: "اضغط على اللوحة العلوية لفكها."
  },
  {
    id: 2,
    nameEn: "Step 2: Install Deflector",
    nameAr: "الخطوة 2: تثبيت العاكس",
    descEn: "Click on the deflector to install it in the rod.",
    descAr: "انقر على موجه التدفق لتثبيته في القضيب."
  },
  {
    id: 3,
    nameEn: "Step 3: Screw Tank Cover",
    nameAr: "الخطوة 3: إغلاق غطاء الخزان",
    descEn: "Press the plate again to mount it to the tank.",
    descAr: "اضغط على اللوحة مرة أخرى لتثبيتها في الخزان."
  },
  {
    id: 4,
    nameEn: "Step 4: Power Switch",
    nameAr: "الخطوة 4: تشغيل الطاقة",
    descEn: "Turn on the power switch of the unit.",
    descAr: "قم بتشغيل مفتاح الطاقة للوحدة."
  },
  {
    id: 5,
    nameEn: "Step 5: Volumetric Valve",
    nameAr: "الخطوة 5: صمام التحكم الحجمي",
    descEn: "Slightly open the Volumetric control valve of the unit.",
    descAr: "افتح صمام التحكم الحجمي للوحدة قليلاً."
  },
  {
    id: 6,
    nameEn: "Step 6: Adjust Flow Valve",
    nameAr: "الخطوة 6: صمام التحكم في التدفق",
    descEn: "Slightly open the flow control valve of the unit to control the flow rate.",
    descAr: "افتح صمام التحكم في التدفق للوحدة قليلاً للتحكم في معدل التدفق."
  },
  {
    id: 7,
    nameEn: "Step 7: Load Weights & Balance (Row 1)",
    nameAr: "الخطوة 7: إضافة أوزان وموازنة المؤشر",
    descEn: "Add weights to balance the weight base with the Pointer tip.",
    descAr: "أضف أوزاناً لموازنة قاعدة الأوزان مع طرف المؤشر."
  },
  {
    id: 8,
    nameEn: "Step 8: Increase Flow Rate",
    nameAr: "الخطوة 8: زيادة تدفق المياه",
    descEn: "Increase the opening of the flow control valve.",
    descAr: "قم بزيادة فتحة صمام التحكم في التدفق."
  },
  {
    id: 9,
    nameEn: "Step 9: Balance (Row 2)",
    nameAr: "الخطوة 9: موازنة المؤشر مرة أخرى",
    descEn: "Add weights to balance the weight base with the Pointer tip.",
    descAr: "أضف أوزاناً لموازنة قاعدة الأوزان مع طرف المؤشر."
  },
  {
    id: 10,
    nameEn: "Step 10: View Software Monitor",
    nameAr: "الخطوة 10: عرض شاشة المراقبة",
    descEn: "Switch to the software monitor.",
    descAr: "انتقل إلى شاشة برنامج المراقبة."
  }
];

interface UIOverlayProps {
  state: SimulationState;
  onSelectLanguage: (lang: Language) => void;
  onSelectDeflector: (id: number) => void;
  onSetValve: (val: number) => void;
  onAddWeight: (weight: number) => void;
  onClearWeights: () => void;
  onTogglePower: () => void;
  onToggleMonitor: () => void;
  onReset: () => void;
  clearWarning: () => void;
  onOkClick: () => void;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  state,
  onSelectLanguage,
  onSelectDeflector,
  onSetValve,
  onAddWeight,
  onClearWeights,
  onTogglePower,
  onToggleMonitor,
  onReset,
  clearWarning,
  onOkClick
}) => {
  const [showVideo, setShowVideo] = useState<boolean>(false);

  const { currentStep, language, selectedDeflectorId, isCoverOpen, isPowerOn, valveOpening, loadedWeights, recordedRows, warningMessage } = state;
  const isAr = language === 'ar';
  const activeStep = STEPS[currentStep] || STEPS[0];

  const deflectors = [
    { id: 0, nameEn: 'Flat Plate (90°)', nameAr: 'لوحة مسطحة (90 درجة)', factor: 1.0 },
    { id: 5, nameEn: 'Hemispherical Cup (180°)', nameAr: 'كوب نصف كروي (180 درجة)', factor: 2.0 },
    { id: 2, nameEn: '120° Cone', nameAr: 'مخروط 120 درجة', factor: 0.5 },
    { id: 4, nameEn: 'Oblique Plate (45°)', nameAr: 'لوح مائل (45 درجة)', factor: 0.293 },
  ];

  const totalLoadedWeight = loadedWeights.reduce((a, b) => a + b, 0);

  // Compute values for HUD
  const flowLMin = 120 * (-4.9138 * Math.pow(valveOpening, 4) + 8.8783 * Math.pow(valveOpening, 3) - 3.7629 * Math.pow(valveOpening, 2) + 0.7265 * valveOpening);
  const correctedFlow = Math.max(0, flowLMin);

  return (
    <div className={`ui-container ${isAr ? 'rtl' : ''}`}>
      {/* Warning popup banner */}
      {warningMessage && (
        <div className={`warning-popup interactive ${isAr ? 'rtl' : ''}`}>
          <AlertTriangle size={18} />
          <span>{isAr ? warningMessage.ar : warningMessage.en}</span>
          <button onClick={clearWarning}>{isAr ? 'حسناً' : 'OK'}</button>
        </div>
      )}

      {/* Sidebar step instruction panel */}
      <div className="sidebar-panel interactive">
        <div className="sidebar-header">
          <div className="logo-container">
            <Layers size={20} />
          </div>
          <div>
            <h2 className="logo-title">VL-FM009</h2>
            <p className="logo-subtitle">{isAr ? 'قياس قوة نفث الماء' : 'Measurement of Jet Forces'}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button className="lang-btn" style={{ background: 'rgba(245,130,32,0.12)', borderColor: 'rgba(245,130,32,0.4)', color: '#f58220', fontSize: '10px', padding: '4px 8px' }} onClick={() => setShowVideo(true)}>
              {isAr ? 'فيديو توضيحي' : 'Help Video'}
            </button>
            <button className="lang-btn" style={{ fontSize: '10px', padding: '4px 8px' }} onClick={() => onSelectLanguage(language === 'en' ? 'ar' : 'en')}>
              {language === 'en' ? 'العربية' : 'English'}
            </button>
          </div>
        </div>

        {/* Active step block */}
        <div className="glass-card" style={{ borderLeft: '3px solid var(--accent-blue)', marginBottom: '16px' }}>
          <div className="step-badge">
            {isAr ? `الخطوة ${currentStep}` : `Step ${currentStep}`}
          </div>
          <h3 className="step-title" style={{ marginTop: '8px', marginBottom: '6px' }}>
            {isAr ? activeStep.nameAr : activeStep.nameEn}
          </h3>
          <p className="step-desc">
            {isAr ? activeStep.descAr : activeStep.descEn}
          </p>

          {/* Render OK Button for confirmed conditions */}
          {((currentStep === 2 && selectedDeflectorId !== undefined) ||
            (currentStep === 5 && state.isVolumetricValveOpen) ||
            (currentStep === 6 && valveOpening >= 0.18) ||
            (currentStep === 7 && state.recordedRows[1]?.balanced) ||
            (currentStep === 8 && valveOpening >= 0.38) ||
            (currentStep === 9 && state.recordedRows[2]?.balanced) ||
            (currentStep === 10)) && (
            <button
              className="btn-primary interactive ok-confirm-btn"
              onClick={onOkClick}
              style={{
                marginTop: '12px',
                width: '100%',
                background: '#f58220',
                color: '#fff',
                fontWeight: 'bold',
                boxShadow: '0 0 12px rgba(245, 130, 32, 0.4)'
              }}
            >
              {isAr ? 'موافق' : 'OK'}
            </button>
          )}
        </div>

        {/* Step-specific controls */}
        <div className="menu-content-wrapper" style={{ flex: 1 }}>
          {/* Step 2: Deflector selection */}
          {currentStep === 2 && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#f58220' }}>
                {isAr ? 'اختر العاكس المائي:' : 'Select Deflector:'}
              </span>
              {deflectors.map((def) => (
                <button
                  key={def.id}
                  className={`btn-secondary ${selectedDeflectorId === def.id ? 'active' : ''}`}
                  onClick={() => onSelectDeflector(def.id)}
                  style={{
                    justifyContent: 'flex-start',
                    borderColor: selectedDeflectorId === def.id ? '#f58220' : 'rgba(255,255,255,0.08)',
                    background: selectedDeflectorId === def.id ? 'rgba(245, 130, 32, 0.08)' : 'transparent',
                    color: selectedDeflectorId === def.id ? '#f58220' : '#fff'
                  }}
                >
                  {isAr ? def.nameAr : def.nameEn}
                </button>
              ))}
            </div>
          )}

          {/* Step 4: Power Switch control */}
          {currentStep === 4 && (
            <button
              className={`btn-primary interactive`}
              onClick={onTogglePower}
              style={{
                background: isPowerOn ? 'var(--danger-red)' : 'var(--accent-blue)',
                color: isPowerOn ? '#fff' : '#141517'
              }}
            >
              <Power size={16} />
              {isPowerOn
                ? (isAr ? 'إيقاف تشغيل المضخة' : 'Turn Off Pump')
                : (isAr ? 'تشغيل المضخة الكهربائية' : 'Turn On Pump')}
            </button>
          )}

          {/* Step 5: Volumetric Valve control */}
          {currentStep === 5 && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--accent-blue)' }}>
                {isAr ? 'انقر على صمام التصريف المائي بالأسفل لفتحه:' : 'Click the volumetric drain valve below to open:'}
              </span>
              <button
                className="btn-secondary"
                onClick={onOkClick}
                style={{
                  background: state.isVolumetricValveOpen ? 'rgba(245, 130, 32, 0.12)' : 'transparent',
                  borderColor: state.isVolumetricValveOpen ? 'var(--accent-blue)' : 'rgba(255,255,255,0.1)'
                }}
              >
                {state.isVolumetricValveOpen 
                  ? (isAr ? 'الصمام مفتوح (انقر OK للاستمرار)' : 'Valve Open (Click OK to continue)')
                  : (isAr ? 'محاكاة فتح الصمام الحجمي' : 'Simulate Opening Volumetric Valve')}
              </button>
            </div>
          )}

          {/* Step 6, 8: Valve adjust */}
          {(currentStep === 6 || currentStep === 8) && (
            <div className="glass-card valve-slider-container">
              <div className="slider-label">
                <span>{isAr ? 'صمام التحكم في التدفق (n):' : 'Flow Control Valve (n):'}</span>
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
              <div style={{ fontSize: '11px', color: '#8fa7ad', display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span>{isAr ? 'مغلق (0)' : 'Closed (0)'}</span>
                <span>Q ≈ {correctedFlow.toFixed(1)} L/min</span>
                <span>{isAr ? 'مفتوح (1.0)' : 'Fully Open (1.0)'}</span>
              </div>
            </div>
          )}

          {/* Step 7, 9: Balance weights control */}
          {(currentStep === 7 || currentStep === 9) && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span>{isAr ? 'الوزن المضاف للموازنة:' : 'Added Balancing Weights:'}</span>
                <span style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>{totalLoadedWeight} g</span>
              </div>

              <div className="weight-pan-grid">
                {[50, 100, 200, 500].map((w) => (
                  <button key={w} className="weight-add-btn" onClick={() => onAddWeight(w)}>
                    +{w}g
                  </button>
                ))}
              </div>

              <button className="btn-secondary" onClick={onClearWeights} style={{ color: 'var(--danger-red)' }}>
                {isAr ? 'إزالة كافة الأوزان' : 'Clear All Weights'}
              </button>

              {/* Status pointer balanced indicators */}
              {state.recordedRows[currentStep === 7 ? 1 : 2] && (
                <div className={`indicator-card ${state.recordedRows[currentStep === 7 ? 1 : 2].balanced ? 'indicator-balanced' : 'indicator-unbalanced'}`}>
                  <Scale size={16} />
                  <span>
                    {state.recordedRows[currentStep === 7 ? 1 : 2].balanced
                      ? (isAr ? 'المؤشر متوازن تماماً!' : 'Pointer balanced!')
                      : (isAr ? `غير متوازن (الهدف التقريبي: ${state.recordedRows[currentStep === 7 ? 1 : 2].idealMass.toFixed(0)} غ)` : `Unbalanced (Target: ~${state.recordedRows[currentStep === 7 ? 1 : 2].idealMass.toFixed(0)}g)`)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Step 10: Open Monitor button */}
          {currentStep === 10 && (
            <button className="btn-primary" onClick={onToggleMonitor} style={{ background: 'var(--success-green)' }}>
              <Monitor size={16} />
              {isAr ? 'فتح شاشة البيانات (Monitor)' : 'Open Data Monitor'}
            </button>
          )}
        </div>

        {/* Global info footer */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '16px', marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#8fa7ad', marginBottom: '8px' }}>
            <span>{isAr ? 'حالة غطاء الأسطوانة:' : 'Cylinder Plate Cover:'}</span>
            <span style={{ color: isCoverOpen ? 'var(--accent-gold)' : 'var(--success-green)', fontWeight: 600 }}>
              {isCoverOpen
                ? (isAr ? 'مفتوح (أزل الغطاء)' : 'Open (Unscrewed)')
                : (isAr ? 'مغلق ومحكم' : 'Closed (Screwed)')}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#8fa7ad', marginBottom: '12px' }}>
            <span>{isAr ? 'القراءات المسجلة في الجدول:' : 'Recorded Data Rows:'}</span>
            <span style={{ color: recordedRows.length >= 3 ? 'var(--success-green)' : '#fff', fontWeight: 600 }}>
              {recordedRows.length} / 4
            </span>
          </div>

          <button className="btn-secondary" onClick={onReset} style={{ width: '100%' }}>
            <RefreshCw size={14} />
            {isAr ? 'إعادة تشغيل المعمل' : 'Reset Simulator'}
          </button>
        </div>
      </div>

      {/* Embedded video player modal overlay */}
      {showVideo && (
        <div className="monitor-fullscreen" style={{ zIndex: 1000, background: 'rgba(20, 21, 23, 0.98)', backdropFilter: 'blur(20px)', padding: '24px' }}>
          <div className="monitor-header" style={{ marginBottom: '16px', paddingBottom: '16px' }}>
            <div className="monitor-title-group">
              <h1>{isAr ? 'فيديو توضيحي للتجربة' : 'Experiment Walkthrough Video'}</h1>
              <p>{isAr ? 'مشاهدة كيفية عمل جهاز قياس قوة نفث الماء والخطوات التفصيلية' : 'Watch how the Measurement of Jet Forces apparatus operates step-by-step'}</p>
            </div>
            <button className="btn-secondary" onClick={() => setShowVideo(false)}>
              {isAr ? 'إغلاق الفيديو' : 'Close Video'}
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#000', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', position: 'relative' }}>
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
