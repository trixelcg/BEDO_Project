import React, { useMemo } from 'react';
import type { SimulationView } from '../types/index';
import type { ExperimentDef } from '../domain/experiments';
import { X, RefreshCw, BarChart2, Calculator, Camera, Download, CheckCircle2 } from 'lucide-react';
import { GRAVITY_MS2 } from '../domain/physics';
import { csvFilename, toCsv } from '../lib/exportSchema';

/**
 * How a numeric readout is rendered.
 *
 * `dir="ltr"` with `unicode-bidi: isolate` is the part that matters. These readouts mix
 * Arabic labels with a left-to-right technical expression, and in an RTL document the
 * bidi algorithm reorders the neutral characters inside it: "0 g × g = 0.000 N" was being
 * displayed as "g × g = 0.000 N 0", which separates the value from its unit and reads as
 * nonsense. Isolating the run keeps the expression internally left-to-right while the row
 * as a whole still mirrors with the rest of the interface.
 */
const NUMERIC_READOUT: React.CSSProperties = {
  fontWeight: 700,
  direction: 'ltr',
  unicodeBidi: 'isolate',
};

interface SoftwareMonitorProps {
  state: SimulationView;
  experiment: ExperimentDef;
  deflectorName: string;
  onCalculate: () => void;
  onAnswerQuiz: (choice: number) => void;
  onClose: () => void;
  onReset: () => void;
}

export const SoftwareMonitor: React.FC<SoftwareMonitorProps> = ({
  state,
  experiment,
  deflectorName,
  onCalculate,
  onAnswerQuiz,
  onClose,
  onReset,
}) => {
  const isAr = state.language === 'ar';
  const { recordedRows, isCalculated, quizAnswer } = state;

  // Only the rows the student actually balanced are readings.
  const rows = useMemo(
    () => recordedRows.filter((r, i) => i > 0 && (r.loadedMassG > 0 || r.valveOpening > 0)),
    [recordedRows]
  );

  const totalWeightG = recordedRows.reduce((sum, r) => sum + r.loadedMassG, 0);
  const totalWeightN = (totalWeightG * GRAVITY_MS2) / 1000;

  // Scale the axes to the data rather than pinning them, which used to clip every reading.
  const niceCeil = (v: number) => {
    const step = 10 ** Math.floor(Math.log10(Math.max(v, 1e-6)));
    return Math.ceil(v / step) * step;
  };
  const maxFlow = niceCeil(Math.max(10, ...recordedRows.map((r) => r.flowRateLMin)) * 1.1);
  const maxForce = niceCeil(
    Math.max(0.5, ...recordedRows.map((r) => Math.max(r.theoreticalForceN, r.measuredForceN))) * 1.15
  );

  const paddingX = 40;
  const paddingY = 30;
  const chartW = 340;
  const chartH = 190;

  const coords = (flow: number, force: number) => ({
    x: paddingX + (flow / maxFlow) * chartW,
    y: paddingY + chartH - (force / maxForce) * chartH,
  });

  const path = (
    source: typeof recordedRows,
    pick: (r: (typeof recordedRows)[number]) => number
  ) =>
    source
      .map((r, i) => {
        const c = coords(r.flowRateLMin, pick(r));
        return `${i === 0 ? 'M' : 'L'} ${c.x},${c.y}`;
      })
      .join(' ');

  // F_ac only exists where the student actually balanced the pointer — drawing the
  // untouched rows as zeroes would drag the measured curve back down to the axis.
  const measured = recordedRows.filter((r, i) => i === 0 || r.loadedMassG > 0);

  /**
   * Step 11 — the readings the student captured, as CSV.
   *
   * The schema lives in `src/lib/exportSchema.ts`, deliberately apart from the domain:
   * the column headers are an interface someone downstream may depend on, and they must
   * not drift every time a field is renamed in here.
   */
  const handleExportData = () => {
    const csv = toCsv(recordedRows, {
      title: `${experiment.nameEn} — ${deflectorName}`,
      isCalculated,
    });

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename(experiment.id);
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Grab the WebGL canvas — Scene3D keeps preserveDrawingBuffer on, so this works. */
  const handleSaveScreen = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `jet-forces-${experiment.id}.png`;
    a.click();
  };

  const question = experiment.quiz[0];
  const answered = quizAnswer !== null;
  const correct = answered && quizAnswer === question.answer;

  return (
    <div className={`monitor-fullscreen interactive ${isAr ? 'rtl' : ''}`}>
      <div className="monitor-header">
        <div className="monitor-title-group">
          <h1>{isAr ? 'شاشة برنامج المراقبة' : 'Software Data Monitor'}</h1>
          <p>
            {isAr ? experiment.nameAr : experiment.nameEn} — {deflectorName}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleSaveScreen}>
            <Camera size={15} />
            {isAr ? 'حفظ الشاشة' : 'Save Screen'}
          </button>
          {/* Storyboard sl. 24 says Export is "active after filling out the table". That
              is deliberately NOT implemented as a disabled state here: this table is
              pre-populated from the fixed ROW_VALVE_SETTINGS, so a genuinely empty table
              never occurs and the guard would be unreachable code that merely looks like
              compliance. Which state counts as "filled" (any reading vs. after Calculate)
              is not decidable from the storyboard — see the monitor gap table. */}
          <button className="btn-secondary" onClick={handleExportData}>
            <Download size={15} />
            {isAr ? 'تصدير البيانات' : 'Export Data'}
          </button>
          <button className="btn-secondary" onClick={onReset}>
            <RefreshCw size={15} />
            {isAr ? 'إعادة الضبط' : 'Reset'}
          </button>
          <button
            className="btn-primary"
            onClick={onClose}
            style={{ background: '#ff3d71', color: '#fff' }}
          >
            <X size={15} />
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>

      <div className="monitor-content">
        {/* Readings */}
        <div
          className="glass-card"
          style={{ padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          <h3
            className="section-title"
            style={{ color: 'var(--accent-blue)', borderBottomColor: 'rgba(0, 229, 255, 0.15)' }}
          >
            {isAr ? 'جدول القراءات' : 'Recorded Readings'}
          </h3>

          {/* Gravity readout. Storyboard sl. 23 lists it as its own display beside the
              total weight, with the unit symbol in a fixed position. The value is the same
              constant the force equations use, read from the physics module rather than
              retyped here, so the monitor can never disagree with the calculation. */}
          <div
            className="indicator-card"
            style={{ marginBottom: '8px', justifyContent: 'space-between' }}
          >
            <span>{isAr ? 'تسارع الجاذبية' : 'Gravity'}</span>
            <span style={NUMERIC_READOUT}>
              {GRAVITY_MS2.toFixed(2)} m/s²
            </span>
          </div>

          {/* Total weight × g, as printed on the BEDO board. */}
          <div
            className="indicator-card"
            style={{ marginBottom: '12px', justifyContent: 'space-between' }}
          >
            <span>{isAr ? 'الوزن الكلي' : 'Total Weight'}</span>
            <span style={{ ...NUMERIC_READOUT, color: 'var(--accent-gold)' }}>
              {totalWeightG} g × g = {totalWeightN.toFixed(3)} N
            </span>
          </div>

          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{isAr ? 'القراءة' : 'Row'}</th>
                  <th>Q (L/min)</th>
                  <th>Q (m³/s)</th>
                  <th>V₀ (m/s)</th>
                  <th>V (m/s)</th>
                  <th>{isAr ? 'الكتلة (g)' : 'Mass (g)'}</th>
                  <th className="highlight-cell">F_th (N)</th>
                  <th className="highlight-cell">F_ac (N)</th>
                </tr>
              </thead>
              <tbody>
                {recordedRows.map((row, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{row.flowRateLMin.toFixed(3)}</td>
                    <td>{row.flowRateM3S.toExponential(3)}</td>
                    <td>{row.nozzleVelocityMS.toFixed(3)}</td>
                    <td>{row.impactVelocityMS.toFixed(3)}</td>
                    <td>{row.loadedMassG}</td>
                    <td
                      className="highlight-cell"
                      style={{ color: 'var(--accent-blue)', fontWeight: 600 }}
                    >
                      {row.theoreticalForceN.toFixed(4)}
                    </td>
                    <td
                      className="highlight-cell"
                      style={{ color: 'var(--accent-gold)', fontWeight: 600 }}
                    >
                      {isCalculated ? row.measuredForceN.toFixed(4) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Step 11: F_ac is only recorded once Calculate is pressed. */}
          <button
            className="btn-primary"
            onClick={onCalculate}
            disabled={isCalculated}
            style={{
              marginTop: '14px',
              background: isCalculated ? 'var(--success-green)' : '#f58220',
              color: '#fff',
              fontWeight: 700,
              opacity: isCalculated ? 0.75 : 1,
            }}
          >
            <Calculator size={16} />
            {isCalculated
              ? isAr
                ? 'تم تسجيل القوة الفعلية'
                : 'F_ac recorded'
              : isAr
                ? 'احسب (Calculate)'
                : 'Calculate'}
          </button>

          <div style={{ marginTop: '14px', fontSize: '11px', color: '#8fa7ad', lineHeight: 1.6 }}>
            <strong>{isAr ? 'قانون التجربة:' : 'Force law:'}</strong>{' '}
            {isAr ? experiment.lawAr : experiment.lawEn}
            <br />
            {isAr ? experiment.objectiveAr : experiment.objectiveEn}
          </div>
        </div>

        {/* Graph + quiz */}
        <div className="plot-container">
          <div className="plot-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart2 size={18} style={{ color: 'var(--accent-blue)' }} />
            {isAr ? 'القوة مقابل معدل التدفق' : 'Force vs Flow Rate'}
          </div>

          <div className="plot-canvas">
            <svg viewBox="0 0 400 250" style={{ width: '100%', height: '100%' }}>
              {[0, 0.25, 0.5, 0.75, 1.0].map((ratio) => {
                const y = paddingY + chartH * ratio;
                const x = paddingX + chartW * ratio;
                return (
                  <React.Fragment key={ratio}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={paddingX + chartW}
                      y2={y}
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <line
                      x1={x}
                      y1={paddingY}
                      x2={x}
                      y2={paddingY + chartH}
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <text x={paddingX - 8} y={y + 4} fill="#5c7a82" fontSize={9} textAnchor="end">
                      {((1 - ratio) * maxForce).toFixed(1)}
                    </text>
                    <text
                      x={x}
                      y={paddingY + chartH + 15}
                      fill="#5c7a82"
                      fontSize={9}
                      textAnchor="middle"
                    >
                      {Math.round(ratio * maxFlow)}
                    </text>
                  </React.Fragment>
                );
              })}

              <line
                x1={paddingX}
                y1={paddingY}
                x2={paddingX}
                y2={paddingY + chartH}
                stroke="rgba(255,255,255,0.2)"
              />
              <line
                x1={paddingX}
                y1={paddingY + chartH}
                x2={paddingX + chartW}
                y2={paddingY + chartH}
                stroke="rgba(255,255,255,0.2)"
              />

              <text
                x={paddingX + chartW / 2}
                y={paddingY + chartH + 32}
                fill="#8fa7ad"
                fontSize={10}
                textAnchor="middle"
              >
                Q (L/min)
              </text>

              <path
                d={path(recordedRows, (r) => r.theoreticalForceN)}
                fill="none"
                stroke="var(--accent-blue)"
                strokeWidth={2}
                strokeDasharray="4 3"
              />
              {isCalculated && (
                <path
                  d={path(measured, (r) => r.measuredForceN)}
                  fill="none"
                  stroke="var(--accent-gold)"
                  strokeWidth={2.5}
                />
              )}

              {recordedRows.map((r, i) => {
                const c = coords(r.flowRateLMin, r.theoreticalForceN);
                return (
                  <circle
                    key={`th-${i}`}
                    cx={c.x}
                    cy={c.y}
                    r={3}
                    fill="#030d10"
                    stroke="var(--accent-blue)"
                    strokeWidth={1.5}
                  />
                );
              })}
              {isCalculated &&
                rows.map((r, i) => {
                  const c = coords(r.flowRateLMin, r.measuredForceN);
                  return <circle key={`ac-${i}`} cx={c.x} cy={c.y} r={4} fill="var(--accent-gold)" />;
                })}
            </svg>
          </div>

          <div className="plot-legend">
            <div className="legend-item">
              <div
                className="legend-line"
                style={{ borderTop: '2px dashed var(--accent-blue)', height: 0 }}
              />
              <span style={{ color: '#e0f2f5' }}>F_th {isAr ? '(نظرية)' : '(theoretical)'}</span>
            </div>
            <div className="legend-item">
              <div className="legend-line" style={{ background: 'var(--accent-gold)' }} />
              <span style={{ color: '#e0f2f5' }}>F_ac {isAr ? '(فعلية)' : '(actual)'}</span>
            </div>
          </div>

          {/* Step 12 — the experiment's question. */}
          {isCalculated && (
            <div className="glass-card" style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#f58220', marginBottom: 8 }}>
                {isAr ? 'سؤال التقييم' : 'Assessment question'}
              </div>
              <p style={{ fontSize: '12px', margin: '0 0 10px 0', color: '#e0f2f5' }}>
                {isAr ? question.promptAr : question.promptEn}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(isAr ? question.optionsAr : question.optionsEn).map((opt, i) => {
                  const chosen = quizAnswer === i;
                  const isRight = i === question.answer;
                  const showResult = answered && (chosen || isRight);
                  return (
                    <button
                      key={i}
                      className="btn-secondary"
                      onClick={() => !answered && onAnswerQuiz(i)}
                      disabled={answered}
                      style={{
                        justifyContent: 'flex-start',
                        fontSize: '12px',
                        borderColor: showResult
                          ? isRight
                            ? 'var(--success-green)'
                            : 'var(--danger-red)'
                          : 'rgba(255,255,255,0.1)',
                        color: showResult
                          ? isRight
                            ? 'var(--success-green)'
                            : 'var(--danger-red)'
                          : '#fff',
                      }}
                    >
                      {showResult && isRight && <CheckCircle2 size={14} />}
                      {opt}
                    </button>
                  );
                })}
              </div>

              {answered && (
                <p
                  style={{
                    fontSize: '11px',
                    marginTop: 10,
                    color: correct ? 'var(--success-green)' : '#8fa7ad',
                  }}
                >
                  {correct ? (isAr ? '✅ إجابة صحيحة. ' : '✅ Correct. ') : ''}
                  {isAr ? question.explainAr : question.explainEn}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
