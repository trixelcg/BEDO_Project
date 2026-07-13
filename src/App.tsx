import { useState, useEffect } from 'react';
import { Scene3D } from './components/Scene3D';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import type { SimulationState, SceneConfig } from './types/index';
import { MenuSettings } from './components/MenuSettings';
import { Sliders, X } from 'lucide-react';
import { DEFAULT_DEFLECTOR_ID, getDeflector } from './lib/apparatus';
import {
  FIRST_READING_VALVE,
  ROW_VALVE_SETTINGS,
  SECOND_READING_VALVE,
  VALVE_SNAP_MARGIN,
  computeRow,
} from './lib/physics';
import './index.css';

const initialState = (language: SimulationState['language'] = 'en'): SimulationState => ({
  currentStep: 1,
  language,
  selectedDeflectorId: DEFAULT_DEFLECTOR_ID,
  isCoverOpen: false,
  isPowerOn: false,
  valveOpening: 0.0,
  loadedWeights: [],
  pointerOffset: 0.0,
  isVolumetricValveOpen: false,
  recordedRows: [],
  currentRecordIndex: 0,
  showMonitor: false,
  warningMessage: null,
});

/** Steps where the student is loading weights, and the table row each one fills in. */
const BALANCE_ROW: Record<number, number> = { 7: 1, 9: 2 };

export default function App() {
  const [state, setState] = useState<SimulationState>(() => initialState());

  const [sceneConfig, setSceneConfig] = useState<SceneConfig>({
    exposure: 1.0,
    selfIllumination: 0.15,
    hdrLight: 1.0,
    hdrRotation: 0,
    reflection: 1.0,
    contrast: 1.0,
    ambientColor: '#d1f2f7',
    characterPosition: [0, -1.8, 0],
    characterRotation: [0, 0, 0],
    characterScale: [1.8, 1.8, 1.8],
    glassSpecular: 1.0,
    glassRoughness: 0.02,
    glassIor: 1.52,
  });

  const [showSettings, setShowSettings] = useState<boolean>(false);

  useEffect(() => {
    fetch('/config.json')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('No config');
      })
      .then((data) => {
        if (data?.sceneConfig) setSceneConfig(data.sceneConfig);
      })
      .catch(() => {
        console.log('Using default client-side scene configuration.');
      });
  }, []);

  const handleSaveConfig = async () => {
    const fullConfig = {
      sceneConfig,
      ttsConfig: { apiKey: '' },
      aiConfig: { apiKey: '' },
      characterUrl: '/Bedo_baked_v2.glb',
      locationUrl: '',
      hdrUrl: '/rosendal_plains_2_4k.webp',
      visemeMap: {},
    };

    try {
      const res = await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullConfig),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert('Configurations saved successfully to disk and GCS!');
      } else {
        alert(`Failed to save configuration: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Save error: ${err.message}`);
    }
  };

  // Keep the results table in step with the apparatus. The row the student is
  // currently balancing shows the live weights; rows already taken keep theirs.
  useEffect(() => {
    setState((prev) => {
      const activeRow = BALANCE_ROW[prev.currentStep];

      const recordedRows = ROW_VALVE_SETTINGS.map((n, idx) => {
        const weights =
          idx === activeRow
            ? prev.loadedWeights
            : idx < prev.currentRecordIndex
              ? (prev.recordedRows[idx]?.loadedWeights ?? [])
              : [];

        return computeRow(idx, n, prev.selectedDeflectorId, weights);
      });

      return { ...prev, recordedRows };
    });
  }, [state.selectedDeflectorId, state.loadedWeights, state.currentStep, state.currentRecordIndex]);

  const triggerWarning = (en: string, ar: string) =>
    setState((prev) => ({ ...prev, warningMessage: { en, ar } }));

  const clearWarning = () => setState((prev) => ({ ...prev, warningMessage: null }));

  // Steps 1 and 3 — unscrew and re-seat the tank cover.
  const handleCoverClick = () => {
    clearWarning();

    if (state.isPowerOn) {
      triggerWarning(
        'Error: You cannot open the tank cover while pump power is active!',
        'خطأ: لا يمكن فتح غطاء الخزان أثناء تشغيل مضخة المياه!'
      );
      return;
    }

    if (!state.isCoverOpen && state.loadedWeights.length > 0) {
      triggerWarning(
        'Error: Remove all weights from the tray before opening the tank!',
        'خطأ: يرجى إزالة جميع الأوزان من الصينية قبل فتح الخزان!'
      );
      return;
    }

    setState((prev) => {
      const isCoverOpen = !prev.isCoverOpen;
      let currentStep = prev.currentStep;
      if (prev.currentStep === 1 && isCoverOpen) currentStep = 2;
      else if (prev.currentStep === 3 && !isCoverOpen) currentStep = 4;
      return { ...prev, isCoverOpen, currentStep };
    });
  };

  // Step 2 — pick a deflector off the tray.
  const handleSelectDeflector = (id: number) => {
    clearWarning();
    if (state.currentStep !== 2) return;
    setState((prev) => ({ ...prev, selectedDeflectorId: id }));
  };

  // Step 4 — pump power.
  const handleTogglePower = () => {
    clearWarning();

    if (!state.isPowerOn && state.isCoverOpen) {
      triggerWarning(
        'Error: You cannot turn on power while the tank cover is open!',
        'خطأ: لا يمكن تشغيل الطاقة أثناء فتح غطاء الخزان الأسطواني!'
      );
      return;
    }

    setState((prev) => {
      const isPowerOn = !prev.isPowerOn;
      return {
        ...prev,
        isPowerOn,
        currentStep: prev.currentStep === 4 && isPowerOn ? 5 : prev.currentStep,
        valveOpening: isPowerOn ? prev.valveOpening : 0.0,
      };
    });
  };

  // Step 5 — volumetric control valve.
  const handleToggleVolumetricValve = () => {
    clearWarning();
    if (state.currentStep !== 5) return;
    setState((prev) => ({ ...prev, isVolumetricValveOpen: !prev.isVolumetricValveOpen }));
  };

  // Steps 6 and 8 — flow control valve.
  const handleSetValve = (val: number) => {
    clearWarning();

    if (!state.isPowerOn && val > 0) {
      triggerWarning(
        'Error: Cannot flow water. Turn on the power switch first!',
        'خطأ: لا يمكن تدفق المياه. يرجى تشغيل مفتاح الطاقة أولاً!'
      );
      return;
    }

    setState((prev) => {
      let valveOpening = val;
      if (prev.currentStep === 6 && val >= FIRST_READING_VALVE - VALVE_SNAP_MARGIN) {
        valveOpening = FIRST_READING_VALVE;
      } else if (prev.currentStep === 8 && val >= SECOND_READING_VALVE - VALVE_SNAP_MARGIN) {
        valveOpening = SECOND_READING_VALVE;
      }
      return { ...prev, valveOpening };
    });
  };

  const handleFlowValveClick = () =>
    handleSetValve(state.currentStep === 8 ? SECOND_READING_VALVE : FIRST_READING_VALVE);

  // Steps 7 and 9 — balance the pointer with weights.
  const handleAddWeight = (weight: number) => {
    clearWarning();

    if (BALANCE_ROW[state.currentStep] === undefined) return;

    if (state.isCoverOpen) {
      triggerWarning(
        'Error: Cannot load weights on tray while tank cover is open!',
        'خطأ: لا يمكن وضع الأوزان على الصينية وغطاء الخزان مفتوح!'
      );
      return;
    }

    setState((prev) => ({ ...prev, loadedWeights: [...prev.loadedWeights, weight] }));
  };

  const handleClearWeights = () => {
    clearWarning();
    setState((prev) => ({ ...prev, loadedWeights: [] }));
  };

  const handleStepOkClick = () => {
    clearWarning();

    setState((prev) => {
      const next: SimulationState = { ...prev };

      switch (prev.currentStep) {
        case 2:
          next.currentStep = 3;
          break;
        case 5:
          next.isVolumetricValveOpen = true;
          next.currentStep = 6;
          break;
        case 6:
          next.valveOpening = FIRST_READING_VALVE;
          next.currentStep = 7;
          next.currentRecordIndex = 1;
          break;
        case 7:
          next.currentStep = 8;
          next.currentRecordIndex = 2;
          next.loadedWeights = [];
          break;
        case 8:
          next.valveOpening = SECOND_READING_VALVE;
          next.currentStep = 9;
          break;
        case 9:
          next.currentStep = 10;
          next.currentRecordIndex = 3;
          next.loadedWeights = [];
          break;
        case 10:
          next.showMonitor = true;
          break;
      }

      return next;
    });
  };

  const handleToggleMonitor = () => {
    clearWarning();
    setState((prev) => ({ ...prev, showMonitor: !prev.showMonitor }));
  };

  const handleReset = () => {
    clearWarning();
    setState(initialState(state.language));
  };

  const deflector = getDeflector(state.selectedDeflectorId);
  const deflectorName = state.language === 'ar' ? deflector.nameAr : deflector.nameEn;

  return (
    <div className="app-container">
      <Scene3D
        state={state}
        sceneConfig={sceneConfig}
        onCoverClick={handleCoverClick}
        onSelectDeflector={handleSelectDeflector}
        onPowerClick={handleTogglePower}
        onFlowValveClick={handleFlowValveClick}
        onVolumetricValveClick={handleToggleVolumetricValve}
        onAddWeight={handleAddWeight}
      />

      <button
        className="floating-settings-toggle"
        onClick={() => setShowSettings(!showSettings)}
        title={state.language === 'ar' ? 'إعدادات المشهد' : 'Scene Settings'}
      >
        <Sliders size={15} />
        <span>{state.language === 'ar' ? 'إعدادات المشهد' : 'Scene Settings'}</span>
      </button>

      {showSettings && (
        <div className="settings-panel-sidebar">
          <div className="settings-panel-header">
            <h3>{state.language === 'ar' ? 'إعدادات المشهد والظلال' : 'Scene Settings'}</h3>
            <button onClick={() => setShowSettings(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="settings-panel-body">
            <MenuSettings
              config={sceneConfig}
              setConfig={setSceneConfig}
              onSaveConfig={handleSaveConfig}
              onSaveCurrentCamera={() => {
                alert('Camera angles captured. Save config to write permanently.');
              }}
            />
          </div>
        </div>
      )}

      <UIOverlay
        state={state}
        onSelectLanguage={(lang) => setState((prev) => ({ ...prev, language: lang }))}
        onSelectDeflector={handleSelectDeflector}
        onSetValve={handleSetValve}
        onAddWeight={handleAddWeight}
        onClearWeights={handleClearWeights}
        onTogglePower={handleTogglePower}
        onToggleVolumetricValve={handleToggleVolumetricValve}
        onToggleMonitor={handleToggleMonitor}
        onReset={handleReset}
        clearWarning={clearWarning}
        onOkClick={handleStepOkClick}
      />

      {state.showMonitor && (
        <SoftwareMonitor
          language={state.language}
          deflectorName={deflectorName}
          recordedRows={state.recordedRows}
          onClose={handleToggleMonitor}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
