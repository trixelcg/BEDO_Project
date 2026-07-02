import React from 'react';
import type { RecordRow, Language } from '../types/index';
import { X, RefreshCw, BarChart2 } from 'lucide-react';

interface SoftwareMonitorProps {
  language: Language;
  deflectorName: string;
  recordedRows: RecordRow[];
  onClose: () => void;
  onReset: () => void;
}

export const SoftwareMonitor: React.FC<SoftwareMonitorProps> = ({
  language,
  deflectorName,
  recordedRows,
  onClose,
  onReset
}) => {
  const isAr = language === 'ar';

  // Find max force values to scale SVG chart dynamically
  const maxFlow = 50; // max expected Q L/min
  const maxForce = 1.5; // max expected Force in Newtons

  // Map recorded rows to chart coordinates (padding inside a 400x250 SVG box)
  const paddingX = 40;
  const paddingY = 30;
  const chartW = 340;
  const chartH = 190;

  const getSvgCoords = (flow: number, force: number) => {
    const x = paddingX + (flow / maxFlow) * chartW;
    // Y is inverted in SVG coordinate space
    const y = paddingY + chartH - (force / maxForce) * chartH;
    return { x, y };
  };

  // Generate SVG paths for Theoretical and Measured curves
  let fthPoints = 'M';
  let fexpPoints = 'M';
  const fexpMarkers: { x: number; y: number; val: number }[] = [];
  const fthMarkers: { x: number; y: number; val: number }[] = [];

  recordedRows.forEach((row, idx) => {
    const fthVal = row.fth;
    // Measured force: weights in Newton (totalWeightValue * 9.81)
    const fexpVal = row.weightsN;
    const flowVal = row.flowRateQLMin;

    const coordsTh = getSvgCoords(flowVal, fthVal);
    const coordsExp = getSvgCoords(flowVal, fexpVal);

    if (idx === 0) {
      fthPoints += ` ${coordsTh.x},${coordsTh.y}`;
      fexpPoints += ` ${coordsExp.x},${coordsExp.y}`;
    } else {
      fthPoints += ` L ${coordsTh.x},${coordsTh.y}`;
      fexpPoints += ` L ${coordsExp.x},${coordsExp.y}`;
    }

    fthMarkers.push({ x: coordsTh.x, y: coordsTh.y, val: fthVal });
    // Only show experimental points if weights were actually added/balanced
    if (row.actualWeightMass > 0 || idx === 0) {
      fexpMarkers.push({ x: coordsExp.x, y: coordsExp.y, val: fexpVal });
    }
  });

  return (
    <div className={`monitor-fullscreen interactive ${isAr ? 'rtl' : ''}`}>
      <div className="monitor-header">
        <div className="monitor-title-group">
          <h1>
            {isAr ? 'شاشة مراقبة البيانات الأكاديمية (Software Monitor)' : 'Software Data Monitor & Analyzer'}
          </h1>
          <p>
            {isAr
              ? `نوع العاكس النشط: ${deflectorName}`
              : `Active Deflector Type: ${deflectorName}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={onReset}>
            <RefreshCw size={16} />
            {isAr ? 'إعادة ضبط التجربة' : 'Reset Experiment'}
          </button>
          <button className="btn-primary" onClick={onClose} style={{ background: '#ff3d71', color: '#fff' }}>
            <X size={16} />
            {isAr ? 'إغلاق الشاشة' : 'Close Monitor'}
          </button>
        </div>
      </div>

      <div className="monitor-content">
        {/* Left Side: Parameters Data Table */}
        <div className="glass-card" style={{ padding: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <h3 className="section-title" style={{ color: 'var(--accent-blue)', borderBottomColor: 'rgba(0, 229, 255, 0.15)' }}>
            {isAr ? 'جدول القراءات والنتائج الرياضية' : 'Recorded Readings & Computational Parameters'}
          </h3>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{isAr ? 'رقم القراءة' : 'Run / Row'}</th>
                  <th>{isAr ? 'معدل التدفق الكلي (L/min)' : 'Total Flow Q_T'}</th>
                  <th>{isAr ? 'فتحة الصمام n (0-1)' : 'Valve Open n'}</th>
                  <th>{isAr ? 'معدل التدفق Q (L/min)' : 'Flow Q (L/min)'}</th>
                  <th>{isAr ? 'معدل التدفق Q (m³/s)' : 'Flow Q (m³/s)'}</th>
                  <th>{isAr ? 'سرعة الفوهة v₀ (m/s)' : 'Nozzle Vel v₀'}</th>
                  <th>{isAr ? 'سرعة التصادم v (m/s)' : 'Impact Vel v'}</th>
                  <th>{isAr ? 'الكتلة المتوازنة (g)' : 'Balanced Mass (g)'}</th>
                  <th>{isAr ? 'انضغاط النابض (mm)' : 'Spring Defl. (mm)'}</th>
                  <th className="highlight-cell">{isAr ? 'القوة النظرية F_th (N)' : 'Theo Force F_th (N)'}</th>
                  <th className="highlight-cell">{isAr ? 'القوة المقاسة F_exp (N)' : 'Meas Force F_exp (N)'}</th>
                </tr>
              </thead>
              <tbody>
                {recordedRows.map((row, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{row.totalFlowValue.toFixed(1)}</td>
                    <td>{row.valveOpen.toFixed(2)}</td>
                    <td>{row.flowRateQLMin.toFixed(2)}</td>
                    <td>{row.flowRateQM3.toExponential(4)}</td>
                    <td>{row.theoreticalVo.toFixed(3)}</td>
                    <td>{row.theoreticalV.toFixed(3)}</td>
                    <td>{row.actualWeightMass} g</td>
                    <td>{row.springhW.toFixed(2)}</td>
                    <td className="highlight-cell" style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                      {row.fth.toFixed(4)}
                    </td>
                    <td className="highlight-cell" style={{ color: 'var(--accent-gold)', fontWeight: 600 }}>
                      {row.weightsN.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '20px', fontSize: '11px', color: '#8fa7ad', lineHeight: '1.6' }}>
            <p style={{ margin: '0 0 4px 0' }}>
              <strong>{isAr ? 'ملاحظات المعايرة:' : 'Mathematical Guide:'}</strong>
            </p>
            {isAr ? (
              <ul>
                <li>تحسب سرعة التصادم لتشمل تباطؤ الجاذبية على ارتفاع 35 ملم من الفوهة: v = √(v₀² - 2·g·s)</li>
                <li>يتم قياس القوة التجريبية F_exp بضرب كتلة الموازنة الكلية في تسارع الجاذبية (9.81 م/ث²)</li>
                <li>تعتمد القوة النظرية F_th على هندسة العاكس المختارة (مسطح، مخروطي، مقعر نصف كروي)</li>
              </ul>
            ) : (
              <ul>
                <li>Impact velocity accounts for gravitational deceleration across the 0.035m travel height: v = &radic;(v₀&sup2; - 2&middot;g&middot;s)</li>
                <li>{"Measured force F_exp represents the added weights under balancing conditions (F_exp = m_weights · 9.81)"}</li>
                <li>{"Theoretical force F_th incorporates the momentum transfer deflection factor (Flat: 1.0, Hemispherical: 2.0, 120° Cone: 0.5)"}</li>
              </ul>
            )}
          </div>
        </div>

        {/* Right Side: Visual SVG Graph */}
        <div className="plot-container">
          <div className="plot-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart2 size={18} style={{ color: 'var(--accent-blue)' }} />
            {isAr ? 'منحنى القوة المقاسة مقابل القوة النظرية' : 'Force vs Flow Rate Characteristic Curve'}
          </div>

          <div className="plot-canvas">
            <svg viewBox="0 0 400 250" style={{ width: '100%', height: '100%' }}>
              {/* Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((ratio) => {
                const y = paddingY + chartH * ratio;
                const x = paddingX + chartW * ratio;
                return (
                  <React.Fragment key={ratio}>
                    {/* Horizontal grid line */}
                    <line x1={paddingX} y1={y} x2={paddingX + chartW} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
                    {/* Vertical grid line */}
                    <line x1={x} y1={paddingY} x2={x} y2={paddingY + chartH} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
                    {/* Y Axis Label */}
                    <text
                      x={paddingX - 8}
                      y={y + 4}
                      fill="#5c7a82"
                      fontSize={9}
                      textAnchor="end"
                    >
                      {((1 - ratio) * maxForce).toFixed(2)} N
                    </text>
                    {/* X Axis Label */}
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

              {/* Axis lines */}
              <line x1={paddingX} y1={paddingY} x2={paddingX} y2={paddingY + chartH} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />
              <line x1={paddingX} y1={paddingY + chartH} x2={paddingX + chartW} y2={paddingY + chartH} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />

              {/* Graph Labels */}
              <text x={paddingX + chartW / 2} y={paddingY + chartH + 32} fill="#8fa7ad" fontSize={10} textAnchor="middle" fontWeight={500}>
                {isAr ? 'معدل التدفق Q (L/min)' : 'Flow Rate Q (L/min)'}
              </text>
              <text
                x={12}
                y={paddingY + chartH / 2}
                fill="#8fa7ad"
                fontSize={10}
                textAnchor="middle"
                transform={`rotate(-90, 12, ${paddingY + chartH / 2})`}
                fontWeight={500}
              >
                {isAr ? 'قوة التصادم F (Newtons)' : 'Impact Force F (Newtons)'}
              </text>

              {/* Data Lines */}
              {recordedRows.length > 1 && (
                <>
                  {/* Theoretical Curve (Cyan) */}
                  <path d={fthPoints} fill="none" stroke="var(--accent-blue)" strokeWidth={2} strokeDasharray="4 3" />
                  {/* Measured Curve (Gold) */}
                  <path d={fexpPoints} fill="none" stroke="var(--accent-gold)" strokeWidth={2.5} />
                </>
              )}

              {/* Theoretical Markers */}
              {fthMarkers.map((pt, i) => (
                <circle key={`th-${i}`} cx={pt.x} cy={pt.y} r={3} fill="#030d10" stroke="var(--accent-blue)" strokeWidth={1.5} />
              ))}

              {/* Experimental Markers */}
              {fexpMarkers.map((pt, i) => (
                <circle key={`exp-${i}`} cx={pt.x} cy={pt.y} r={4} fill="var(--accent-gold)" />
              ))}
            </svg>
          </div>

          {/* Legend */}
          <div className="plot-legend">
            <div className="legend-item">
              <div className="legend-line" style={{ background: 'var(--accent-blue)', height: '2px', borderTop: '2px dashed var(--accent-blue)' }} />
              <span style={{ color: '#e0f2f5' }}>{isAr ? 'القوة النظرية F_th' : 'Theoretical Force F_th'}</span>
            </div>
            <div className="legend-item">
              <div className="legend-line" style={{ background: 'var(--accent-gold)' }} />
              <span style={{ color: '#e0f2f5' }}>{isAr ? 'القوة التجريبية F_exp' : 'Measured Force F_exp'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
