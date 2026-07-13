import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { DeviceModel } from './DeviceModel';
import type { SimulationState, SceneConfig } from '../types/index';
import { STEP_FOCUS, type Anchors } from '../lib/apparatus';

interface Scene3DProps {
  state: SimulationState;
  sceneConfig: SceneConfig;
  onCoverClick: () => void;
  onSelectDeflector: (id: number) => void;
  onPowerClick: () => void;
  onFlowValveClick: () => void;
  onVolumetricValveClick: () => void;
  onAddWeight: (grams: number) => void;
}

const LabEnvironment: React.FC<{ config: SceneConfig }> = ({ config }) => {
  const { scene } = useThree();
  const texture = useTexture('/rosendal_plains_2_4k.webp');

  useEffect(() => {
    if (!texture) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.rotation = (config.hdrRotation * Math.PI) / 180;

    scene.background = texture;
    scene.environment = texture;
    scene.environmentIntensity = config.hdrLight;
    scene.backgroundIntensity = config.hdrLight;

    return () => {
      scene.background = null;
      scene.environment = null;
    };
  }, [texture, scene, config.hdrLight, config.hdrRotation]);

  return null;
};

const RendererController: React.FC<{ config: SceneConfig }> = ({ config }) => {
  const { gl } = useThree();
  useEffect(() => {
    if (gl) gl.toneMappingExposure = config.exposure;
  }, [gl, config.exposure]);
  return null;
};

const ModelLoadingPlaceholder: React.FC = () => (
  <mesh position={[0, 0.2, 0]}>
    <boxGeometry args={[0.5, 0.5, 0.5]} />
    <meshStandardMaterial color="#f58220" wireframe />
  </mesh>
);

const FLIGHT_SECONDS = 1.25;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * Flies the camera to whichever part the current step is about, the way the reference
 * simulator reframes the apparatus between steps. Hands control straight back to
 * OrbitControls afterwards, and aborts the flight if the student grabs the view.
 */
const CameraRig: React.FC<{
  step: number;
  showMonitor: boolean;
  anchors: Anchors;
  groupRef: React.RefObject<THREE.Group | null>;
}> = ({ step, showMonitor, anchors, groupRef }) => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as any;

  const progress = useRef(1);
  const pending = useRef(false);
  const from = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  const to = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  // Queue a flight whenever the step changes and its anchor is known.
  useEffect(() => {
    if (showMonitor) return;
    const focus = STEP_FOCUS[step];
    if (!focus || !anchors[focus.anchor]) return;
    pending.current = true;
  }, [step, showMonitor, anchors]);

  // A drag or scroll means the student wants to look somewhere else — stop fighting them.
  useEffect(() => {
    if (!controls) return;
    const abort = () => {
      pending.current = false;
      progress.current = 1;
    };
    controls.addEventListener('start', abort);
    return () => controls.removeEventListener('start', abort);
  }, [controls]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!controls || !group) return;

    if (pending.current) {
      const focus = STEP_FOCUS[step];
      const anchor = focus && anchors[focus.anchor];
      if (!focus || !anchor) return;

      from.pos.copy(camera.position);
      from.target.copy(controls.target);

      // Anchor and offset are both in model space, so convert after adding.
      to.target.copy(group.localToWorld(scratch.set(anchor[0], anchor[1], anchor[2])));
      to.pos.copy(
        group.localToWorld(
          scratch.set(
            anchor[0] + focus.offset[0],
            anchor[1] + focus.offset[1],
            anchor[2] + focus.offset[2]
          )
        )
      );

      progress.current = 0;
      pending.current = false;
    }

    if (progress.current >= 1) return;

    progress.current = Math.min(1, progress.current + delta / FLIGHT_SECONDS);
    const k = easeInOut(progress.current);
    camera.position.lerpVectors(from.pos, to.pos, k);
    controls.target.lerpVectors(from.target, to.target, k);
    controls.update();
  });

  return null;
};

export const Scene3D: React.FC<Scene3DProps> = ({
  state,
  sceneConfig,
  onCoverClick,
  onSelectDeflector,
  onPowerClick,
  onFlowValveClick,
  onVolumetricValveClick,
  onAddWeight,
}) => {
  const apparatusRef = useRef<THREE.Group>(null);
  const [anchors, setAnchors] = useState<Anchors>({});
  const handleAnchors = useCallback((next: Anchors) => setAnchors(next), []);

  return (
    <div className="canvas-container">
      <Canvas
        shadows="percentage"
        camera={{ position: [0, 1.2, 3.8], fov: 42 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <RendererController config={sceneConfig} />

        <Suspense fallback={null}>
          <LabEnvironment config={sceneConfig} />
        </Suspense>

        <ambientLight
          intensity={sceneConfig.selfIllumination * (2.0 - sceneConfig.contrast)}
          color={sceneConfig.ambientColor}
        />

        <directionalLight
          position={[5, 8, 5]}
          intensity={0.8 * sceneConfig.contrast}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0001}
          shadow-camera-left={-2}
          shadow-camera-right={2}
          shadow-camera-top={2}
          shadow-camera-bottom={-2}
        />
        <directionalLight
          position={[-5, 5, -5]}
          intensity={0.3 * (2.0 - sceneConfig.contrast)}
          color="#f58220"
        />
        <directionalLight position={[0, 6, -6]} intensity={0.4 * sceneConfig.contrast} color="#ff9100" />

        <ContactShadows position={[0, -1.81, 0]} opacity={0.65} scale={6} blur={2.4} far={3} />

        <Suspense fallback={<ModelLoadingPlaceholder />}>
          <DeviceModel
            state={state}
            groupRef={apparatusRef}
            anchors={anchors}
            onAnchors={handleAnchors}
            onCoverClick={onCoverClick}
            onSelectDeflector={onSelectDeflector}
            onPowerClick={onPowerClick}
            onFlowValveClick={onFlowValveClick}
            onVolumetricValveClick={onVolumetricValveClick}
            onAddWeight={onAddWeight}
            position={sceneConfig.characterPosition}
            rotation={[
              (sceneConfig.characterRotation[0] * Math.PI) / 180,
              (sceneConfig.characterRotation[1] * Math.PI) / 180,
              (sceneConfig.characterRotation[2] * Math.PI) / 180,
            ]}
            scale={sceneConfig.characterScale}
            reflection={sceneConfig.reflection}
            glassSpecular={sceneConfig.glassSpecular}
            glassRoughness={sceneConfig.glassRoughness}
            glassIor={sceneConfig.glassIor}
          />
        </Suspense>

        <CameraRig
          step={state.currentStep}
          showMonitor={state.showMonitor}
          anchors={anchors}
          groupRef={apparatusRef}
        />

        {/* makeDefault publishes the controls so CameraRig can drive them. */}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2 + 0.25}
          minDistance={0.6}
          maxDistance={8}
          target={[0, 0.15, 0]}
        />
      </Canvas>
    </div>
  );
};
