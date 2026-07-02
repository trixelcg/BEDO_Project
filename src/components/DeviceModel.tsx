import React, { useRef, useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimulationState } from '../types/index';

interface DeviceModelProps {
  state: SimulationState;
  onCoverClick: () => void;
  onDeflectorClick: () => void;
  onPowerClick: () => void;
  onValveClick: () => void;
  onWeightPanClick: () => void;
}

export const DeviceModel: React.FC<DeviceModelProps> = ({
  state,
  onCoverClick,
  onDeflectorClick,
  onPowerClick,
  onValveClick,
  onWeightPanClick
}) => {
  // Load GLB model from public folder
  const { scene, nodes } = useGLTF('/Bedo_model_optimized.glb') as any;

  // Refs for key animatable components
  const coverRef = useRef<THREE.Object3D>(null);
  const pointerRef = useRef<THREE.Object3D>(null);
  const liquidRef = useRef<THREE.Mesh>(null);
  const valveRef = useRef<THREE.Object3D>(null);
  const switchRef = useRef<THREE.Object3D>(null);
  const deflectorRef = useRef<THREE.Object3D>(null);
  const apparatusGroupRef = useRef<THREE.Group>(null);

  // Initialize nodes and custom material properties on mount

  // Initialize nodes and custom material properties on mount
  useEffect(() => {
    if (scene) {
      scene.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          // Apply glass transparency to the outer shield cylinder
          if (child.name.toLowerCase().includes('cylinder001') || child.name.toLowerCase().includes('cylinder005')) {
            child.material = new THREE.MeshPhysicalMaterial({
              color: '#d4f1f5',
              transparent: true,
              opacity: 0.25,
              roughness: 0.1,
              metalness: 0.1,
              transmission: 0.9,
              ior: 1.5,
              thickness: 1.0,
              depthWrite: false,
            });
          }

          // Apply water shader look to LIQUID001
          if (child.name === 'LIQUID001') {
            child.material = new THREE.MeshStandardMaterial({
              color: '#00e5ff',
              transparent: true,
              opacity: 0.7,
              roughness: 0.1,
              metalness: 0.1,
              emissive: '#00838f',
              emissiveIntensity: 0.3
            });
          }

          // Hide static weights inside the model initially to avoid clutter
          if (child.name.includes('Weight_')) {
            child.visible = false;
          }
        }
      });
    }
  }, [scene]);

  // Map references once nodes are loaded
  useEffect(() => {
    if (scene) {
      coverRef.current = scene.getObjectByName('Cylinder006'); // typical upper plate lid
      pointerRef.current = scene.getObjectByName('Pointer'); // balancing pointer
      liquidRef.current = scene.getObjectByName('LIQUID001'); // water jet cylinder
      valveRef.current = scene.getObjectByName('Cold_Tab_001_Baked'); // valve knob
      switchRef.current = scene.getObjectByName('c pump_066'); // pump switch
      deflectorRef.current = scene.getObjectByName('Cone001'); // active deflector holder
    }
  }, [scene]);

  // Dynamic weights geometries cloned from nodes
  const weightGeometry50 = nodes['Weight_50 gm']?.geometry;
  const weightGeometry100 = nodes['Weight_100 gm']?.geometry;
  const weightGeometry200 = nodes['Weight_200 gm']?.geometry;
  const weightGeometry500 = nodes['Weight_500 gm']?.geometry;
  const weightMat = nodes['Weight_50 gm']?.material || new THREE.MeshStandardMaterial({ color: '#78909c', roughness: 0.5 });

  // Physics animation tick
  useFrame((_threeState, delta) => {
    // 1. Tank Cover / Upper plate animation (Step 0 & 2)
    if (coverRef.current) {
      // If cover is open, slide it up and rotate slightly. Otherwise, screw it down.
      const targetY = state.isCoverOpen ? 0.35 : 0.0;
      const targetRotY = state.isCoverOpen ? Math.PI * 0.5 : 0.0;
      coverRef.current.position.y = THREE.MathUtils.lerp(coverRef.current.position.y, targetY, delta * 8);
      coverRef.current.rotation.y = THREE.MathUtils.lerp(coverRef.current.rotation.y, targetRotY, delta * 8);
    }

    // 2. Valve knob rotation (Step 4 & 6)
    if (valveRef.current) {
      const targetRotZ = state.valveOpening * Math.PI * 3.0; // spin as opened
      valveRef.current.rotation.z = THREE.MathUtils.lerp(valveRef.current.rotation.z, targetRotZ, delta * 5);
    }

    // 3. Power switch animation (Step 3)
    if (switchRef.current) {
      const targetRotX = state.isPowerOn ? -0.4 : 0.4;
      switchRef.current.rotation.x = THREE.MathUtils.lerp(switchRef.current.rotation.x, targetRotX, delta * 12);
    }

    // 4. Calculate Net Force, Spring deflection, Pointer movement
    // Flow calculations
    const flowLMin = 120 * (-4.9138 * Math.pow(state.valveOpening, 4) + 8.8783 * Math.pow(state.valveOpening, 3) - 3.7629 * Math.pow(state.valveOpening, 2) + 0.7265 * state.valveOpening);
    const flowRateQLMin = Math.max(0, flowLMin);
    const flowRateQM3 = flowRateQLMin / 60000;
    const theoreticalVo = flowRateQM3 / 0.0000785;
    
    // Impact Velocity squared: v^2 = v₀^2 - 2·g·s
    let v2 = Math.pow(theoreticalVo, 2) - 2 * 9.81 * Math.sqrt(0.035);
    v2 = Math.max(0, v2);

    // Deflector force multiplier
    let factor = 1.0;
    if (state.selectedDeflectorId === 5) factor = 2.0; // cup
    if (state.selectedDeflectorId === 2) factor = 0.5; // cone

    // Jet force in Newtons
    const fth = state.isPowerOn ? (factor * 1000 * 0.0000785 * v2) : 0;

    // Weight force in Newtons
    const loadedMassG = state.loadedWeights.reduce((a, b) => a + b, 0);
    const weightForceN = (loadedMassG * 9.81) / 1000;

    // Net upward force
    const netForce = fth - weightForceN;

    // Spring deflection (200 N/m stiffness)
    // d = F / k (m) -> d_mm = F / 200 * 1000 = F * 5 (mm)
    const displacementMm = netForce * 5;
    
    // Clamp displacement to mechanical limits (-12mm to +15mm)
    const clampedDisplacement = THREE.MathUtils.clamp(displacementMm, -12, 15);

    // Update pointer position (Scale 1mm to 0.015 units in R3F space)
    if (pointerRef.current) {
      // Lift rod and pointer Y pos
      const targetPointerY = clampedDisplacement * 0.015;
      pointerRef.current.position.y = THREE.MathUtils.lerp(pointerRef.current.position.y, targetPointerY, delta * 10);
    }

    // 5. Water Jet animation (LIQUID001)
    if (liquidRef.current) {
      if (state.isPowerOn && state.valveOpening > 0.05) {
        liquidRef.current.visible = true;
        // Scale jet Y based on flow rate
        const targetScaleY = Math.min(2.5, 0.2 + state.valveOpening * 2.3);
        liquidRef.current.scale.y = THREE.MathUtils.lerp(liquidRef.current.scale.y, targetScaleY, delta * 10);
        // Slightly jitter opacity to simulate water turbulence
        const mat = liquidRef.current.material as THREE.MeshStandardMaterial;
        mat.opacity = 0.55 + Math.sin(Date.now() * 0.05) * 0.1;
      } else {
        liquidRef.current.visible = false;
        liquidRef.current.scale.y = 0.01;
      }
    }
  });

  // Highlight helper
  const handlePointerOver = (e: any) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = () => {
    document.body.style.cursor = 'default';
  };

  return (
    <group ref={apparatusGroupRef} position={[0, -1.8, 0]} scale={[1.8, 1.8, 1.8]}>
      {/* 3D Model primitive */}
      <primitive object={scene} />

      {/* Dynamic weights rendering stacked on pointer pan tray */}
      {pointerRef.current && (
        <group
          position={[
            pointerRef.current.position.x, 
            pointerRef.current.position.y + 1.62, // Stack on top of pan
            pointerRef.current.position.z
          ]}
        >
          {state.loadedWeights.map((w, idx) => {
            let geom = weightGeometry50;
            if (w === 100) geom = weightGeometry100;
            if (w === 200) geom = weightGeometry200;
            if (w === 500) geom = weightGeometry500;

            const yPos = idx * 0.04; // Stack weights vertically

            return (
              <mesh
                key={idx}
                geometry={geom}
                material={weightMat}
                position={[0, yPos, 0]}
                scale={[0.65, 0.65, 0.65]}
                castShadow
                receiveShadow
              />
            );
          })}
        </group>
      )}

      {/* Click and Hover Invisible Intersect Handlers for the 3D apparatus */}
      {/* 1. Tank Cover plate click area */}
      <mesh
        position={[0, 1.5, 0]}
        visible={false}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={(e) => { e.stopPropagation(); onCoverClick(); }}
      >
        <cylinderGeometry args={[0.3, 0.3, 0.08, 16]} />
      </mesh>

      {/* 2. Deflector / Central Rod area */}
      <mesh
        position={[0, 0.9, 0]}
        visible={false}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={(e) => { e.stopPropagation(); onDeflectorClick(); }}
      >
        <cylinderGeometry args={[0.2, 0.2, 0.4, 16]} />
      </mesh>

      {/* 3. Valve knob click area */}
      <mesh
        position={[-0.4, 0.15, 0.45]}
        rotation={[Math.PI * 0.5, 0, 0]}
        visible={false}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={(e) => { e.stopPropagation(); onValveClick(); }}
      >
        <cylinderGeometry args={[0.08, 0.08, 0.06, 12]} />
      </mesh>

      {/* 4. Power switch click area */}
      <mesh
        position={[0.3, 0.2, 0.5]}
        visible={false}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={(e) => { e.stopPropagation(); onPowerClick(); }}
      >
        <boxGeometry args={[0.06, 0.08, 0.08]} />
      </mesh>

      {/* 5. Weight Pan (Weights tray) click area */}
      <mesh
        position={[0, 1.62, 0]}
        visible={false}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={(e) => { e.stopPropagation(); onWeightPanClick(); }}
      >
        <cylinderGeometry args={[0.16, 0.16, 0.03, 16]} />
      </mesh>
    </group>
  );
};
