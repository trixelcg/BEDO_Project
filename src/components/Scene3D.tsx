import React, { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { DeviceModel } from './DeviceModel';
import type { SimulationState } from '../types/index';

interface Scene3DProps {
  state: SimulationState;
  onCoverClick: () => void;
  onDeflectorClick: () => void;
  onPowerClick: () => void;
  onValveClick: () => void;
  onWeightPanClick: () => void;
}

// Subcomponent to natively load and apply WebP Equirectangular Environment map
const LabEnvironment: React.FC = () => {
  const { scene } = useThree();
  const texture = useTexture('/rosendal_plains_2_4k.webp');

  useEffect(() => {
    if (texture) {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
      scene.environment = texture;
    }
    return () => {
      scene.background = null;
      scene.environment = null;
    };
  }, [texture, scene]);

  return null;
};

// Simple loading placeholder inside the 3D Canvas
const ModelLoadingPlaceholder: React.FC = () => {
  return (
    <mesh position={[0, 0.2, 0]}>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#00e5ff" wireframe />
    </mesh>
  );
};

export const Scene3D: React.FC<Scene3DProps> = ({
  state,
  onCoverClick,
  onDeflectorClick,
  onPowerClick,
  onValveClick,
  onWeightPanClick
}) => {
  return (
    <div className="canvas-container">
      <Canvas
        shadows="percentage"
        camera={{ position: [0, 1.2, 3.8], fov: 42 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        {/* Load Rosendal Plains environmental HDR map natively */}
        <Suspense fallback={null}>
          <LabEnvironment />
        </Suspense>

        {/* Ambient fill light */}
        <ambientLight intensity={0.15} color="#d1f2f7" />

        {/* Studio Three-Point Lighting Rig */}
        {/* 1. Key Light (Main illuminating light casting soft shadows) */}
        <directionalLight
          position={[5, 8, 5]}
          intensity={0.8}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0001}
          shadow-camera-left={-2}
          shadow-camera-right={2}
          shadow-camera-top={2}
          shadow-camera-bottom={-2}
        />

        {/* 2. Fill Light (Soften harsh shadows from key light) */}
        <directionalLight position={[-5, 5, -5]} intensity={0.3} color="#00e5ff" />

        {/* 3. Rim Light (Back illumination to pop object outlines) */}
        <directionalLight position={[0, 6, -6]} intensity={0.4} color="#ffc107" />

        {/* Soft grounding contact shadows under the laboratory bench */}
        <ContactShadows
          position={[0, -1.81, 0]}
          opacity={0.65}
          scale={6}
          blur={2.4}
          far={3}
        />

        {/* Lazy load the 3D apparatus */}
        <Suspense fallback={<ModelLoadingPlaceholder />}>
          <DeviceModel
            state={state}
            onCoverClick={onCoverClick}
            onDeflectorClick={onDeflectorClick}
            onPowerClick={onPowerClick}
            onValveClick={onValveClick}
            onWeightPanClick={onWeightPanClick}
          />
        </Suspense>

        {/* Interactive Camera controls with zoom/pan constraints */}
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2 + 0.05} // don't go below table ground
          minDistance={1.8}                  // zoom limits
          maxDistance={7.5}
          target={[0, 0.15, 0]}               // center camera focus on apparatus
        />
      </Canvas>
    </div>
  );
};
