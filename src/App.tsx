import { useState, useEffect } from 'react';
import { Scene3D } from './components/Scene3D';
import { UIOverlay } from './components/UIOverlay';
import { SoftwareMonitor } from './components/SoftwareMonitor';
import type { RecordRow, SimulationState, SceneConfig } from './types/index';
import { MenuSettings } from './components/MenuSettings';
import { Sliders, X } from 'lucide-react';
import './index.css';

const DEFAULT_ROWS = [0.0, 0.2, 0.4, 0.6];

export default function App() {
  // Application State
  const [state, setState] = useState<SimulationState>({
    currentStep: 1,
    language: 'en',
    selectedDeflectorId: 0, // 0 = Flat, 5 = Cup, 2 = Cone
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

  // Load initial configurations from config.json if available
  useEffect(() => {
    fetch('/config.json')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('No config');
      })
      .then((data) => {
        if (data && data.sceneConfig) {
          setSceneConfig(data.sceneConfig);
        }
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
      visemeMap: {}
    };

    try {
      const res = await fetch('/api/save-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

  // Calculate parameters for a given row index dynamically to ensure state sync
  const calculateRowData = (idx: number, n: number, deflectorId: number, weights: number[]): RecordRow => {
    const totalFlowValue = 120;
    // Flow Rate Q (L/min)
    const flowRateQLMin = totalFlowValue * (-4.9138 * Math.pow(n, 4) + 8.8783 * Math.pow(n, 3) - 3.7629 * Math.pow(n, 2) + 0.7265 * n);
    const correctedFlow = Math.max(0, flowRateQLMin);
    const flowRateQM3 = correctedFlow / 60000;
    const theoreticalVo = flowRateQM3 / 0.0000785;

    // Impact velocity v = sqrt(v0^2 - 2 * g * s)
    // using s = 0.035m travel height
    let v2 = Math.pow(theoreticalVo, 2) - 2 * 9.81 * Math.sqrt(0.035);
    v2 = Math.max(0, v2);
    const theoreticalV = Math.sqrt(v2);

    let factor = 1.0;
    if (deflectorId === 5) factor = 2.0; // cup
    if (deflectorId === 2) factor = 0.5; // cone
    if (deflectorId === 4) factor = 0.293; // oblique 45°

    // Theoretical force F_th (N)
    const fth = factor * 1000 * 0.0000785 * v2;
    const massValue = (fth / 9.81) * 1000;

    // Standardized target ideal mass rounded
    const idealMass = Math.round(massValue / 10) * 10;

    // Total actual weights loaded on tray
    const actualWeightMass = weights.reduce((a, b) => a + b, 0);
    const weightsN = (actualWeightMass * 9.81) / 1000;
    const springhW = (weightsN / 200) * 1000;

    // Balance tolerance (+/- 30g)
    const balanced = Math.abs(actualWeightMass - idealMass) <= 30;

    return {
      index: idx,
      totalFlowValue,
      valveOpen: n,
      flowRateQLMin: correctedFlow,
      flowRateQM3,
      theoreticalVo,
      theoreticalV,
      weightsN,
      springhW,
      fth,
      mass: massValue,
      idealMass,
      actualWeightMass,
      balanced,
      loadedWeights: weights
    };
  };

  // Synchronize dynamic table rows on state changes
  useEffect(() => {
    const updatedRows = DEFAULT_ROWS.map((n, idx) => {
      // For rows that represent steps the user is actively working on, load active weights
      const isCurrentActiveRow =
        (state.currentStep === 7 && idx === 1) || (state.currentStep === 9 && idx === 2);
      
      const weightsForThisRow = isCurrentActiveRow
        ? state.loadedWeights
        : (idx < state.currentRecordIndex ? state.recordedRows[idx]?.loadedWeights || [] : []);

      return calculateRowData(idx, n, state.selectedDeflectorId, weightsForThisRow);
    });

    // Merge into state safely
    setState((prev) => ({
      ...prev,
      recordedRows: updatedRows,
    }));
  }, [state.selectedDeflectorId, state.loadedWeights, state.currentStep, state.currentRecordIndex]);

  // Global Warning Utility
  const triggerWarning = (en: string, ar: string) => {
    setState((prev) => ({
      ...prev,
      warningMessage: { en, ar },
    }));
  };

  const clearWarning = () => {
    setState((prev) => ({
      ...prev,
      warningMessage: null,
    }));
  };

  // 1. Click Tank Cover / Upper Plate (Steps 1, 3)
  const handleCoverClick = () => {
    clearWarning();
    
    // Safety check: Cannot open cover while pump power is on
    if (state.isPowerOn) {
      triggerWarning(
        "Error: You cannot open the tank cover while pump power is active!",
        "خطأ: لا يمكن فتح غطاء الخزان أثناء تشغيل مضخة المياه!"
      );
      return;
    }

    // Safety check: Cannot open cover if weights are still loaded on tray
    if (!state.isCoverOpen && state.loadedWeights.length > 0) {
      triggerWarning(
        "Error: Remove all weights from the tray before opening the tank!",
        "خطأ: يرجى إزالة جميع الأوزان من الصينية قبل فتح الخزان!"
      );
      return;
    }

    const nextCoverState = !state.isCoverOpen;

    setState((prev) => {
      let nextStep = prev.currentStep;
      if (prev.currentStep === 1 && nextCoverState === true) {
        nextStep = 2; // Advance to select deflector
      } else if (prev.currentStep === 3 && nextCoverState === false) {
        nextStep = 4; // Advance to turn on power
      }

      return {
        ...prev,
        isCoverOpen: nextCoverState,
        currentStep: nextStep,
      };
    });
  };

  // 2. Select Deflector Shape (Step 2)
  const handleSelectDeflector = (id: number) => {
    clearWarning();
    if (state.currentStep !== 2) return;

    setState((prev) => ({
      ...prev,
      selectedDeflectorId: id,
    }));
  };

  const handleDeflectorClick = () => {
    clearWarning();
    if (state.currentStep === 2) {
      // Default to Flat plate if clicked in 3D
      handleSelectDeflector(0);
    }
  };

  // 3. Toggle Power Switch (Step 4)
  const handleTogglePower = () => {
    clearWarning();

    // Safety check: Cannot turn power on while cover is open
    if (!state.isPowerOn && state.isCoverOpen) {
      triggerWarning(
        "Error: You cannot turn on power while the tank cover is open!",
        "خطأ: لا يمكن تشغيل الطاقة أثناء فتح غطاء الخزان الأسطواني!"
      );
      return;
    }

    const nextPowerState = !state.isPowerOn;

    setState((prev) => {
      let nextStep = prev.currentStep;
      if (prev.currentStep === 4 && nextPowerState === true) {
        nextStep = 5; // Advance to Volumetric Valve
      }

      return {
        ...prev,
        isPowerOn: nextPowerState,
        currentStep: nextStep,
        // If turning off, shut off flow rate
        valveOpening: nextPowerState ? prev.valveOpening : 0.0,
      };
    });
  };

  // 3b. Toggle Volumetric Valve (Step 5)
  const handleToggleVolumetricValve = () => {
    clearWarning();
    if (state.currentStep !== 5) return;
    setState((prev) => ({
      ...prev,
      isVolumetricValveOpen: !prev.isVolumetricValveOpen,
    }));
  };

  // 4. Slide Valve knob (Steps 6, 8)
  const handleSetValve = (val: number) => {
    clearWarning();
    
    // Safety check: valve cannot be opened if power is off
    if (!state.isPowerOn && val > 0) {
      triggerWarning(
        "Error: Cannot flow water. Turn on the power switch first!",
        "خطأ: لا يمكن تدفق المياه. يرجى تشغيل مفتاح الطاقة أولاً!"
      );
      return;
    }

    setState((prev) => {
      let nextStep = prev.currentStep;
      let targetRecordIdx = prev.currentRecordIndex;

      if (prev.currentStep === 6 && val >= 0.18) {
        val = 0.20; // Snap to target 0.2
      } else if (prev.currentStep === 8 && val >= 0.38) {
        val = 0.40; // Snap to target 0.4
      }

      return {
        ...prev,
        valveOpening: val,
        currentStep: nextStep,
        currentRecordIndex: targetRecordIdx,
      };
    });
  };

  // 5. Add / Clear weights (Steps 7, 9)
  const handleAddWeight = (weight: number) => {
    clearWarning();

    // Safety check: Cannot add weights if cover is open
    if (state.isCoverOpen) {
      triggerWarning(
        "Error: Cannot load weights on tray while tank cover is open!",
        "خطأ: لا يمكن وضع الأوزان على الصينية وغطاء الخزان مفتوح!"
      );
      return;
    }

    setState((prev) => ({
      ...prev,
      loadedWeights: [...prev.loadedWeights, weight],
    }));
  };

  const handleClearWeights = () => {
    clearWarning();
    setState((prev) => ({
      ...prev,
      loadedWeights: [],
    }));
  };

  // OK Button Confirm Handler to advance steps
  const handleStepOkClick = () => {
    clearWarning();
    setState((prev) => {
      let nextStep = prev.currentStep;
      let nextRecordIdx = prev.currentRecordIndex;

      if (prev.currentStep === 2) {
        nextStep = 3; // Go to screw cover back on
      } else if (prev.currentStep === 5) {
        if (!prev.isVolumetricValveOpen) {
          // Auto-open if user clicks OK without clicking valve first
          prev.isVolumetricValveOpen = true;
        }
        nextStep = 6; // Go to adjust flow control valve
      } else if (prev.currentStep === 6) {
        if (prev.valveOpening < 0.18) {
          // Ensure valve is opened
          prev.valveOpening = 0.20;
        }
        nextStep = 7; // Go to balance weights
        nextRecordIdx = 1;
      } else if (prev.currentStep === 7) {
        // Record data row 1 and advance to increase flow rate
        nextStep = 8;
        nextRecordIdx = 2;
      } else if (prev.currentStep === 8) {
        if (prev.valveOpening < 0.38) {
          prev.valveOpening = 0.40;
        }
        nextStep = 9; // Go to balance weights (2nd run)
      } else if (prev.currentStep === 9) {
        // Record data row 2 and advance to switch to monitor
        nextStep = 10;
        nextRecordIdx = 3;
      } else if (prev.currentStep === 10) {
        return {
          ...prev,
          showMonitor: true
        };
      }

      return {
        ...prev,
        currentStep: nextStep,
        currentRecordIndex: nextRecordIdx,
        loadedWeights: (prev.currentStep === 7 || prev.currentStep === 9) ? [] : prev.loadedWeights, // clear loaded weights for next row
      };
    });
  };

  // 6. View Monitor overlay
  const handleToggleMonitor = () => {
    clearWarning();
    setState((prev) => ({
      ...prev,
      showMonitor: !prev.showMonitor,
    }));
  };

  // Reset simulator
  const handleReset = () => {
    clearWarning();
    setState({
      currentStep: 1,
      language: state.language, // preserve language choice
      selectedDeflectorId: 0,
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
  };

  // Maps deflector name for localized screen titles
  const getDeflectorName = () => {
    if (state.selectedDeflectorId === 5) {
      return state.language === 'ar' ? 'كوب مقعر نصف كروي' : 'Hemispherical Cup';
    }
    if (state.selectedDeflectorId === 2) {
      return state.language === 'ar' ? 'عاكس مخروطي 120 درجة' : '120° Cone';
    }
    if (state.selectedDeflectorId === 4) {
      return state.language === 'ar' ? 'لوح مائل 45 درجة' : 'Oblique Plate (45°)';
    }
    return state.language === 'ar' ? 'لوحة مسطحة 90 درجة' : 'Flat Plate (90°)';
  };

  return (
    <div className="app-container">
      {/* 3D Lab Scene Canvas */}
      <Scene3D
        state={state}
        sceneConfig={sceneConfig}
        onCoverClick={handleCoverClick}
        onDeflectorClick={handleDeflectorClick}
        onPowerClick={handleTogglePower}
        onValveClick={() => handleSetValve(state.currentStep === 6 ? 0.20 : 0.40)}
        onVolumetricValveClick={handleToggleVolumetricValve}
        onWeightPanClick={() => handleAddWeight(50)}
      />

      {/* Floating Gear / Sliders Toggles for Scene settings */}
      <button
        className="floating-settings-toggle"
        onClick={() => setShowSettings(!showSettings)}
        title={state.language === 'ar' ? 'إعدادات المشهد' : 'Scene Settings'}
      >
        <Sliders size={15} />
        <span>{state.language === 'ar' ? 'إعدادات المشهد' : 'Scene Settings'}</span>
      </button>

      {/* Sliding Settings Sidebar Panel */}
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

      {/* HTML HUD and Steps overlays */}
      <UIOverlay
        state={state}
        onSelectLanguage={(lang) => setState((prev) => ({ ...prev, language: lang }))}
        onSelectDeflector={handleSelectDeflector}
        onSetValve={handleSetValve}
        onAddWeight={handleAddWeight}
        onClearWeights={handleClearWeights}
        onTogglePower={handleTogglePower}
        onToggleMonitor={handleToggleMonitor}
        onReset={handleReset}
        clearWarning={clearWarning}
        onOkClick={handleStepOkClick}
      />

      {/* Fullscreen data analyzer overlay */}
      {state.showMonitor && (
        <SoftwareMonitor
          language={state.language}
          deflectorName={getDeflectorName()}
          recordedRows={state.recordedRows}
          onClose={handleToggleMonitor}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
