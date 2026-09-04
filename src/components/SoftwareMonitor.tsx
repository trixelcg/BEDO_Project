import React, { useEffect, useMemo } from 'react';
import type { SimulationView } from '../types/index';
import type { ExperimentDef } from '../domain/experiments';
import {
  X,
  RefreshCw,
  BarChart2,
  Calculator,
  Camera,
  Download,
  CheckCircle2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { GRAVITY_MS2, NOZZLE_AREA_M2, jetState } from '../domain/physics';
import { getDeflector } from '../domain/apparatus';
import { DeflectorBoard } from './DeflectorBoard';
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
  /** Docked beside the apparatus, or expanded over it. */
  onToggleExpand: () => void;
}

export const SoftwareMonitor: React.FC<SoftwareMonitorProps> = ({
  state,
  experiment,
  deflectorName,
  onCalculate,
  onAnswerQuiz,
  onClose,
  onReset,
  onToggleExpand,
}) => {
  const isAr = state.language === 'ar';
  const { recordedRows, isCalculated, quizAnswer, live } = state;


  /*
    The tray, not the table.

    This used to sum `loadedMassG` across `recordedRows`, which answers a different
    question and got both cases wrong: in free mode no row is being balanced, so a fully
    loaded tray reported 0 g; and once both readings were committed it reported their sum
    rather than what is on the pan. `state.live` follows the pan itself.
  */
  const totalWeightG = live.loadedMassG;
  const totalWeightN = live.measuredForceN;

  /** 10 mm, from the same constant the momentum equations and the nozzle tooltip use. */
  const nozzleDiameterMm = 2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI) * 1000;
  const installed = getDeflector(state.selectedDeflectorId);

  // Scale the axes to the data rather than pinning them, which used to clip every reading.
  const niceCeil = (v: number) => {
    const step = 10 ** Math.floor(Math.log10(Math.max(v, 1e-6)));
    return Math.ceil(v / step) * step;
  };
  /*
    The theoretical curve, computed rather than joined up between readings.

    The chart used to be a polyline through the four pre-generated table rows, so with the
    table now holding only what the student recorded it would be a single dot — or, before
    a first reading, nothing at all. `F_th(Q)` is a known function of the valve opening, so
    it is sampled directly: 40 points from shut to fully open, at the deflector and pump
    delivery in force right now.
  */
  const CURVE_SAMPLES = 40;
  const curve = useMemo(
    () =>
      Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
        const opening = i / CURVE_SAMPLES;
        const jet = jetState(opening, state.selectedDeflectorId, state.params.pumpFlowLMin);
        return { flowRateLMin: jet.flowRateLMin, forceN: jet.theoreticalForceN };
      }),
    [state.selectedDeflectorId, state.params.pumpFlowLMin]
  );

  const maxFlow = niceCeil(Math.max(10, ...curve.map((p) => p.flowRateLMin)) * 1.05);
  const maxForce = niceCeil(
    Math.max(
      0.5,
      ...curve.map((p) => p.forceN),
      ...recordedRows.map((r) => Math.max(r.theoreticalForceN, r.measuredForceN))
    ) * 1.1
  );

  const paddingX = 40;
  const paddingY = 30;
  const chartW = 340;
  const chartH = 190;

  const coords = (flow: number, force: number) => ({
    x: paddingX + (flow / maxFlow) * chartW,
    y: paddingY + chartH - (force / maxForce) * chartH,
  });

  const path = (points: { flowRateLMin: number; forceN: number }[]) =>
    points
      .map((p, i) => {
        const c = coords(p.flowRateLMin, p.forceN);
        return `${i === 0 ? 'M' : 'L'} ${c.x},${c.y}`;
      })
      .join(' ');

  /** The recorded readings as measured points, in the order they were taken. */
  const measured = recordedRows.map((r) => ({
    flowRateLMin: r.flowRateLMin,
    forceN: r.measuredForceN,
  }));

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

  /**
   * Escape steps back one level rather than trapping the learner.
   *
   * Expanded returns to the dock — which is where the apparatus is usable — and from the
   * dock it closes the board. Nothing else in the app claims Escape while the monitor is
   * up, and the handler is removed with the panel.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (state.monitorExpanded) onToggleExpand();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.monitorExpanded, onToggleExpand, onClose]);

  const question = experiment.quiz[0];
  const answered = quizAnswer !== null;
  const correct = answered && quizAnswer === question.answer;

  return (
    <div
      /*
        Docked by default. The board used to be a 100vw x 100vh opaque overlay, so opening
        it hid the apparatus — a learner could not watch a value move while turning the
        valve, which is the whole point of a live monitor. Docked, it takes a column beside
        the rig; `.app-container.has-docked-monitor` gives that column its width and the
        canvas and the guided HUD shrink into what is left, so nothing is covered.
      */
      className={`${state.monitorExpanded ? 'monitor-fullscreen' : 'monitor-docked'} interactive ${
        isAr ? 'rtl' : ''
      }`}
      role="region"
      aria-label={isAr ? 'شاشة برنامج المراقبة' : 'Software Data Monitor'}
    >
      <div className="monitor-header">
        <div className="monitor-title-group">
          <h1>{isAr ? 'شاشة برنامج المراقبة' : 'Software Data Monitor'}</h1>
          <p>
            {isAr ? experiment.nameAr : experiment.nameEn} — {deflectorName}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={onToggleExpand}
            aria-expanded={state.monitorExpanded}
            aria-label={
              state.monitorExpanded
                ? isAr
                  ? 'تصغير شاشة المراقبة'
                  : 'Collapse the monitor'
                : isAr
                  ? 'تكبير شاشة المراقبة'
                  : 'Expand the monitor'
            }
          >
            {state.monitorExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {state.monitorExpanded ? (isAr ? 'تصغير' : 'Collapse') : isAr ? 'تكبير' : 'Expand'}
          </button>
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
          /*
            No overflow clip on the card.

            It used to be `overflow: hidden`, to stop a wide results table stretching the
            column. Once the live panel was added above it that clipped the table out of
            the card entirely. `overflow-x: hidden` is not a fix either: when one axis is
            not `visible` the other computes to `auto`, so the card still scrolled
            internally and still cut the table off below the header. Containing the wide
            table is `.data-table-container`'s own job, and `.monitor-content` already
            scrolls, so the card is simply allowed to be as tall as its contents.
          */
          style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}
        >
          <h3
            className="section-title"
            style={{ color: 'var(--accent-blue)', borderBottomColor: 'rgba(0, 229, 255, 0.15)' }}
          >
            {isAr ? 'جدول القراءات' : 'Recorded Readings'}
          </h3>

          {/*
            Live measurements.

            The results table below is computed at the four fixed openings the procedure
            records at, so it can never show what the learner is holding. This panel is
            that missing half: the deflector on the rod, the nozzle it leaves, and the
            flow, velocities and force at the current valve setting. Every value is read
            from `state.live` — one `jetState` call in the selector layer — so nothing here
            re-derives physics, and the board cannot disagree with the calculation.
          */}
          <div className="mon-live">
            <div className="mon-live-head">
              <span>{isAr ? 'القياسات الحية' : 'Live measurements'}</span>
              <span className="mon-live-badge">{isAr ? 'مباشر' : 'LIVE'}</span>
            </div>

            <div className="mon-live-grid">
              <div className="mon-cell mon-cell-wide">
                <span className="mon-lbl">{isAr ? 'العاكس المركّب' : 'Installed deflector'}</span>
                <span className="mon-val" style={NUMERIC_READOUT}>
                  {installed.id}° · {isAr ? installed.nameAr : installed.nameEn}
                </span>
                <span className="mon-sub" style={NUMERIC_READOUT}>
                  k = {installed.momentumFactor.toFixed(3)}
                </span>
              </div>

              <div className="mon-cell">
                <span className="mon-lbl">{isAr ? 'قطر الفوهة' : 'Nozzle diameter'}</span>
                <span className="mon-val" style={NUMERIC_READOUT}>
                  {nozzleDiameterMm.toFixed(0)} mm
                </span>
                <span className="mon-sub" style={NUMERIC_READOUT}>
                  A = {NOZZLE_AREA_M2.toExponential(3)} m²
                </span>
              </div>

              <div className="mon-cell">
                <span className="mon-lbl">{isAr ? 'فتحة الصمام' : 'Valve opening'}</span>
                <span className="mon-val" style={NUMERIC_READOUT}>
                  {(live.valveOpening * 100).toFixed(0)} %
                </span>
              </div>

              <div className="mon-cell">
                <span className="mon-lbl">Q</span>
                <span className="mon-val" style={NUMERIC_READOUT}>
                  {live.flowRateLMin.toFixed(3)} L/min
                </span>
                <span className="mon-sub" style={NUMERIC_READOUT}>
                  {live.flowRateM3S.toExponential(3)} m³/s
                </span>
              </div>

              <div className="mon-cell">
                <span className="mon-lbl">V_nozzle {isAr ? '(عند الفوهة)' : '(at the nozzle)'}</span>
                <span className="mon-val" style={NUMERIC_READOUT}>
                  {live.nozzleVelocityMS.toFixed(3)} m/s
                </span>
              </div>

              <div className="mon-cell">
                <span className="mon-lbl">V_impact {isAr ? '(عند الاصطدام)' : '(at the vane)'}</span>
                <span className="mon-val" style={NUMERIC_READOUT}>
                  {live.impactVelocityMS.toFixed(3)} m/s
                </span>
              </div>

              <div className="mon-cell mon-cell-accent">
                <span className="mon-lbl">F_th {isAr ? '(النظرية)' : '(theoretical)'}</span>
                <span className="mon-val" style={NUMERIC_READOUT}>
                  {live.theoreticalForceN.toFixed(4)} N
                </span>
              </div>
            </div>
          </div>

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
                  <th>V_nozzle (m/s)</th>
                  <th>V_impact (m/s)</th>
                  <th>{isAr ? 'الكتلة (g)' : 'Mass (g)'}</th>
                  <th className="highlight-cell">F_th (N)</th>
                  <th className="highlight-cell">F_ac (N)</th>
                </tr>
              </thead>
              <tbody>
                {recordedRows.length === 0 && (
                  <tr>
                    {/*
                      An empty table, said plainly.

                      It used to be pre-populated from the four fixed valve settings, so a
                      student who had recorded nothing still saw a zero row and a
                      43.457 L/min row that nobody had taken. Nothing is printed here until
                      a reading is recorded.
                    */}
                    <td colSpan={8} className="data-table-empty">
                      {isAr
                        ? 'لا توجد قراءات بعد — وازن المؤشر ثم اضغط "تسجيل القراءة".'
                        : 'No readings yet — balance the pointer, then press Record reading.'}
                    </td>
                  </tr>
                )}
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

              {/* F_th(Q), sampled across the valve's whole range. Always drawn. */}
              <path
                d={path(curve)}
                fill="none"
                stroke="var(--accent-blue)"
                strokeWidth={2}
                strokeDasharray="4 3"
                data-testid="chart-theoretical"
              />
              {/* The recorded readings, as markers on that curve. */}
              {measured.length > 1 && isCalculated && (
                <path
                  d={path(measured)}
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
                measured.map((p, i) => {
                  const c = coords(p.flowRateLMin, p.forceN);
                  return (
                    <circle
                      key={`ac-${i}`}
                      cx={c.x}
                      cy={c.y}
                      r={4}
                      fill="var(--accent-gold)"
                      data-testid="chart-measured-point"
                    />
                  );
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

          {/*
            The reference board's deflector area: the seven deflectors with the installed
            one marked, and the four family diagrams. Informational — selection stays where
            it already is, so there is no second deflector state.
          */}
          <DeflectorBoard installedDeflectorId={state.selectedDeflectorId} language={state.language} />
      </div>
    </div>
  );
};
