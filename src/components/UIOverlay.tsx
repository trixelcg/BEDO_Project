import React, { useState } from 'react';
import type { Language, StepDefinition, SimulationState } from '../types/index';
import { Layers, Power, Scale, Play, RefreshCw, AlertTriangle, Monitor } from 'lucide-react';

const STEPS: StepDefinition[] = [
  {
    id: 0,
    nameEn: "Step 0: Unscrew Upper Plate",
    nameAr: "الخطوة 0: فك اللوحة العلوية",
    descEn: "Press the upper plate of the cylinder tank in the 3D scene to unscrew and open it.",
    descAr: "اضغط على اللوحة العلوية لأسطوانة الخزان في المشهد ثلاثي الأبعاد لفكها وفتح الغطاء."
  },
  {
    id: 1,
    nameEn: "Step 1: Install Deflector",
    nameAr: "الخطوة 1: تثبيت العاكس",
    descEn: "Select a deflector shape to mount on the central rod (Flat Plate, Cup, or 120° Cone). You can use the buttons below or click the rod.",
    descAr: "اختر شكل العاكس المراد تثبيته على القضيب المركزي (لوح مسطح، كوب، أو مخروط 120 درجة). يمكنك استخدام الأزرار أدناه أو النقر فوق القضيب."
  },
  {
    id: 2,
    nameEn: "Step 2: Screw Tank Cover",
    nameAr: "الخطوة 2: إغلاق غطاء الخزان",
    descEn: "Press the tank plate cover again in the 3D scene to screw and mount it back securely to the cylinder tank.",
    descAr: "اضغط على غطاء اللوحة مرة أخرى في المشهد ثلاثي الأبعاد لربطه وتثبيته بإحكام على الخزان الأسطواني."
  },
  {
    id: 3,
    nameEn: "Step 3: Power Switch",
    nameAr: "الخطوة 3: تشغيل الطاقة",
    descEn: "Click the main power switch on the console to turn on the water pump.",
    descAr: "انقر على مفتاح التشغيل الرئيسي في وحدة التحكم لتشغيل مضخة المياه."
  },
  {
    id: 4,
    nameEn: "Step 4: Adjust Volumetric Valve",
    nameAr: "الخطوة 4: صمام التدفق الحجمي",
    descEn: "Slightly open the flow control valve to control the flow rate. Open it to 20% (n = 0.2) using the slider below or clicking the valve.",
    descAr: "افتح صمام التحكم في التدفق قليلاً للتحكم في معدل التدفق. افتحه بنسبة 20% (n = 0.2) باستخدام المنزلق أدناه أو النقر على الصمام."
  },
  {
    id: 5,
    nameEn: "Step 5: Load Weights & Balance (Row 1)",
    nameAr: "الخطوة 5: إضافة أوزان وموازنة المؤشر",
    descEn: "Notice the jet pushing the deflector upward. Load weights (50g, 100g) on the top tray to push it back down until the pointer aligns to the zero mark (balanced). Click 'Record Data' once balanced.",
    descAr: "لاحظ أن نفاث الماء يدفع العاكس لأعلى. أضف أوزاناً (50 غ، 100 غ) على الصينية العلوية لدفعها لأسفل حتى يتطابق المؤشر مع علامة الصفر (متوازن). اضغط على 'تسجيل القراءة' عند الموازنة."
  },
  {
    id: 6,
    nameEn: "Step 6: Increase Flow Rate",
    nameAr: "الخطوة 6: زيادة تدفق المياه",
    descEn: "Increase the opening of the flow control valve to 40% (n = 0.4) to increase the jet velocity and lift force.",
    descAr: "زد فتحة صمام التحكم في التدفق إلى 40% (n = 0.4) لزيادة سرعة التدفق وقوة الدفع."
  },
  {
    id: 7,
    nameEn: "Step 7: Balance (Row 2)",
    nameAr: "الخطوة 7: موازنة المؤشر مرة أخرى",
    descEn: "Add more weights on the pan to balance the pointer tip at zero again (target ideal mass). Click 'Record Data' once balanced.",
    descAr: "أضف المزيد من الأوزان على الصينية لموازنة طرف المؤشر عند الصفر مرة أخرى (الكتلة المثالية المستهدفة). اضغط على 'تسجيل القراءة' عند الموازنة."
  },
  {
    id: 8,
    nameEn: "Step 8: View Software Monitor",
    nameAr: "الخطوة 8: عرض شاشة المراقبة",
    descEn: "The lab measurements are complete! Click the 'Open Monitor' button below to review your computational charts and table values.",
    descAr: "تم الانتهاء من قراءات التجربة! اضغط على زر 'فتح الشاشة' أدناه لمراجعة الرسومات البيانية وجدول النتائج الرياضية للتجربة."
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
  onRecordRow: () => void;
  onToggleMonitor: () => void;
  onReset: () => void;
  clearWarning: () => void;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  state,
  onSelectLanguage,
  onSelectDeflector,
  onSetValve,
  onAddWeight,
  onClearWeights,
  onTogglePower,
  onRecordRow,
  onToggleMonitor,
  onReset,
  clearWarning
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
            <button className="lang-btn" style={{ background: 'rgba(255,193,7,0.12)', borderColor: 'rgba(255,193,7,0.4)', color: '#ffc107', fontSize: '10px', padding: '4px 8px' }} onClick={() => setShowVideo(true)}>
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
        </div>

        {/* Step-specific controls */}
        <div className="menu-content-wrapper" style={{ flex: 1 }}>
          {/* Step 1: Deflector selection */}
          {currentStep === 1 && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-blue)' }}>
                {isAr ? 'اختر العاكس المائي:' : 'Select Deflector:'}
              </span>
              {deflectors.map((def) => (
                <button
                  key={def.id}
                  className={`btn-secondary ${selectedDeflectorId === def.id ? 'active' : ''}`}
                  onClick={() => onSelectDeflector(def.id)}
                  style={{
                    justifyContent: 'flex-start',
                    borderColor: selectedDeflectorId === def.id ? 'var(--accent-blue)' : 'rgba(255,255,255,0.08)',
                    background: selectedDeflectorId === def.id ? 'rgba(0, 229, 255, 0.08)' : 'transparent',
                    color: selectedDeflectorId === def.id ? 'var(--accent-blue)' : '#fff'
                  }}
                >
                  {isAr ? def.nameAr : def.nameEn}
                </button>
              ))}
            </div>
          )}

          {/* Step 3: Power Switch control */}
          {currentStep === 3 && (
            <button
              className={`btn-primary interactive`}
              onClick={onTogglePower}
              style={{
                background: isPowerOn ? 'var(--danger-red)' : 'var(--accent-blue)',
                color: isPowerOn ? '#fff' : '#030d10'
              }}
            >
              <Power size={16} />
              {isPowerOn
                ? (isAr ? 'إيقاف تشغيل المضخة' : 'Turn Off Pump')
                : (isAr ? 'تشغيل المضخة الكهربائية' : 'Turn On Pump')}
            </button>
          )}

          {/* Step 4, 6, 5, 7: Valve adjust */}
          {(currentStep >= 4 && currentStep <= 7) && (
            <div className="glass-card valve-slider-container">
              <div className="slider-label">
                <span>{isAr ? 'مستوى صمام التدفق (n):' : 'Volumetric Valve (n):'}</span>
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

          {/* Step 5, 7: Balance weights control */}
          {(currentStep === 5 || currentStep === 7) && (
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
              {state.recordedRows[currentStep === 5 ? 1 : 2] && (
                <div className={`indicator-card ${state.recordedRows[currentStep === 5 ? 1 : 2].balanced ? 'indicator-balanced' : 'indicator-unbalanced'}`}>
                  <Scale size={16} />
                  <span>
                    {state.recordedRows[currentStep === 5 ? 1 : 2].balanced
                      ? (isAr ? 'المؤشر متوازن تماماً!' : 'Pointer balanced!')
                      : (isAr ? `غير متوازن (الهدف التقريبي: ${state.recordedRows[currentStep === 5 ? 1 : 2].idealMass.toFixed(0)} غ)` : `Unbalanced (Target: ~${state.recordedRows[currentStep === 5 ? 1 : 2].idealMass.toFixed(0)}g)`)}
                  </span>
                </div>
              )}

              <button
                className="btn-primary"
                onClick={onRecordRow}
                disabled={state.recordedRows[currentStep === 5 ? 1 : 2] ? !state.recordedRows[currentStep === 5 ? 1 : 2].balanced : true}
              >
                <Play size={16} />
                {isAr ? 'تسجيل قراءة الجدول' : 'Record Data Row'}
              </button>
            </div>
          )}

          {/* Step 8: Open Monitor button */}
          {currentStep === 8 && (
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
        <div className="monitor-fullscreen" style={{ zIndex: 1000, background: 'rgba(2, 9, 11, 0.96)', backdropFilter: 'blur(20px)', padding: '24px' }}>
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
