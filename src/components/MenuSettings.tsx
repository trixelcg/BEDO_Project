import React from 'react';
import type { SceneConfig } from '../types/index';
import { Sun, Move, Palette, Save, Camera } from 'lucide-react';

interface MenuSettingsProps {
  config: SceneConfig;
  setConfig: React.Dispatch<React.SetStateAction<SceneConfig>>;
  onSaveConfig: () => void;
  onSaveCurrentCamera?: () => void;
}

const SliderRow = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}) => {
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px', fontWeight: 500, color: '#e9ecef' }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'monospace', color: 'var(--accent-gold)' }}>{safeValue.toFixed(step >= 1 ? 0 : 2)}</span>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--accent-blue)', cursor: 'pointer', height: '4px' }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) onChange(val);
          }}
          style={{
            width: '54px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '4px',
            color: 'white',
            padding: '2px 4px',
            fontSize: '11px',
            fontFamily: 'monospace',
            textAlign: 'center',
          }}
        />
      </div>
    </div>
  );
};

export const MenuSettings = ({ 
  config, 
  setConfig, 
  onSaveConfig, 
  onSaveCurrentCamera 
}: MenuSettingsProps) => {
  const updateConfig = (key: keyof SceneConfig, val: any) => {
    setConfig((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const updateCharacterTransform = (type: 'position' | 'rotation' | 'scale', index: number, value: number) => {
    setConfig((prev) => {
      const arr = [...prev[`character${type.charAt(0).toUpperCase() + type.slice(1)}` as 'characterPosition' | 'characterRotation' | 'characterScale']] as [number, number, number];
      arr[index] = value;
      return {
        ...prev,
        [`character${type.charAt(0).toUpperCase() + type.slice(1)}`]: arr,
      };
    });
  };

  return (
    <div className="menu-content-wrapper" style={{ paddingRight: '4px' }}>
      {/* Save baseline config back to disk */}
      <div className="settings-section-card" style={{ border: '1px solid var(--accent-blue)', background: 'rgba(0, 229, 255, 0.03)', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px' }}>
          <p style={{ margin: 0, fontSize: '10px', color: '#adb5bd', lineHeight: 1.4 }}>
            Capture the current viewport zoom/pan angles, and freeze all scene positions, lighting, and configurations on disk.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              onClick={onSaveCurrentCamera}
              style={{
                background: 'rgba(245, 194, 66, 0.1)',
                border: '1px solid var(--accent-gold)',
                borderRadius: '8px',
                color: 'var(--accent-gold)',
                padding: '10px 4px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <Camera size={13} style={{ color: 'var(--accent-gold)' }} />
              <span>Capture Camera</span>
            </button>
            <button
              onClick={onSaveConfig}
              style={{
                background: 'linear-gradient(to right, var(--accent-blue), #00cca3)',
                border: 'none',
                borderRadius: '8px',
                color: '#010d0f',
                padding: '10px 4px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <Save size={13} style={{ color: '#010d0f' }} />
              <span>Save Config</span>
            </button>
          </div>
        </div>
      </div>

      {/* Lighting Section */}
      <div className="settings-section-card" style={{ marginBottom: '16px' }}>
        <div className="section-title">
          <Sun size={14} style={{ color: 'var(--accent-gold)' }} />
          <span style={{ marginLeft: '6px' }}>Lighting & Camera Environment</span>
        </div>
        <div style={{ padding: '8px 4px' }}>
          <SliderRow
            label="Exposure (Tone Mapping)"
            value={config.exposure}
            min={0.1}
            max={3.0}
            step={0.05}
            onChange={(v) => updateConfig('exposure', v)}
          />
          <SliderRow
            label="Ambient Intensity"
            value={config.selfIllumination}
            min={0.0}
            max={5.0}
            step={0.1}
            onChange={(v) => updateConfig('selfIllumination', v)}
          />
          <SliderRow
            label="HDR Environment Intensity"
            value={config.hdrLight}
            min={0.0}
            max={5.0}
            step={0.1}
            onChange={(v) => updateConfig('hdrLight', v)}
          />
          <SliderRow
            label="HDR Rotation (Y-Axis)"
            value={config.hdrRotation}
            min={0}
            max={360}
            step={1}
            onChange={(v) => updateConfig('hdrRotation', v)}
          />
          <SliderRow
            label="Environment Reflections"
            value={config.reflection}
            min={0.0}
            max={5.0}
            step={0.1}
            onChange={(v) => updateConfig('reflection', v)}
          />
          <SliderRow
            label="Contrast"
            value={config.contrast}
            min={0.5}
            max={2.0}
            step={0.05}
            onChange={(v) => updateConfig('contrast', v)}
          />
        </div>
      </div>

      {/* Colors Section */}
      <div className="settings-section-card" style={{ marginBottom: '16px' }}>
        <div className="section-title">
          <Palette size={14} style={{ color: 'var(--accent-gold)' }} />
          <span style={{ marginLeft: '6px' }}>Colors & Backgrounds</span>
        </div>
        <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#e9ecef', fontWeight: 500 }}>Ambient Base Color</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="color"
                value={config.ambientColor}
                onChange={(e) => updateConfig('ambientColor', e.target.value)}
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  width: '28px',
                  height: '24px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                }}
              />
              <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--accent-gold)' }}>
                {config.ambientColor.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Apparatus Transforms Section */}
      <div className="settings-section-card">
        <div className="section-title">
          <Move size={14} style={{ color: 'var(--accent-gold)' }} />
          <span style={{ marginLeft: '6px' }}>Apparatus Transformations</span>
        </div>
        <div style={{ padding: '8px 4px' }}>
          <h5 style={{ margin: '0 0 10px 0', fontSize: '10px', textTransform: 'uppercase', color: 'var(--accent-blue)', letterSpacing: '0.5px' }}>Position (X, Y, Z)</h5>
          <SliderRow
            label="X (Left / Right)"
            value={config.characterPosition[0]}
            min={-10}
            max={10}
            step={0.05}
            onChange={(v) => updateCharacterTransform('position', 0, v)}
          />
          <SliderRow
            label="Y (Elevation)"
            value={config.characterPosition[1]}
            min={-5}
            max={5}
            step={0.05}
            onChange={(v) => updateCharacterTransform('position', 1, v)}
          />
          <SliderRow
            label="Z (Forward / Backward)"
            value={config.characterPosition[2]}
            min={-10}
            max={10}
            step={0.05}
            onChange={(v) => updateCharacterTransform('position', 2, v)}
          />

          <h5 style={{ margin: '15px 0 10px 0', fontSize: '10px', textTransform: 'uppercase', color: 'var(--accent-blue)', letterSpacing: '0.5px' }}>Rotation (Pitch, Yaw, Roll)</h5>
          <SliderRow
            label="Pitch (X-Axis)"
            value={config.characterRotation[0]}
            min={-180}
            max={180}
            step={1}
            onChange={(v) => updateCharacterTransform('rotation', 0, v)}
          />
          <SliderRow
            label="Yaw (Y-Axis)"
            value={config.characterRotation[1]}
            min={-180}
            max={180}
            step={1}
            onChange={(v) => updateCharacterTransform('rotation', 1, v)}
          />
          <SliderRow
            label="Roll (Z-Axis)"
            value={config.characterRotation[2]}
            min={-180}
            max={180}
            step={1}
            onChange={(v) => updateCharacterTransform('rotation', 2, v)}
          />

          <h5 style={{ margin: '15px 0 10px 0', fontSize: '10px', textTransform: 'uppercase', color: 'var(--accent-blue)', letterSpacing: '0.5px' }}>Scale (Size)</h5>
          <SliderRow
            label="Overall Uniform Scale"
            value={config.characterScale[0]}
            min={0.1}
            max={5.0}
            step={0.05}
            onChange={(v) => {
              updateCharacterTransform('scale', 0, v);
              updateCharacterTransform('scale', 1, v);
              updateCharacterTransform('scale', 2, v);
            }}
          />
        </div>
      </div>
    </div>
  );
};
