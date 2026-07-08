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
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  reflection: number;
  glassSpecular: number;
  glassRoughness: number;
  glassIor: number;
}

export const DeviceModel: React.FC<DeviceModelProps> = ({
  state,
  onCoverClick,
  onDeflectorClick,
  onPowerClick,
  onValveClick,
  onWeightPanClick,
  position,
  rotation,
  scale,
  reflection,
  glassSpecular,
  glassRoughness,
  glassIor
}) => {
  // Load GLB model from public folder
  const { scene, nodes } = useGLTF('/Bedo_baked_integration.glb') as any;

  // Load water shapes
  const waterLow = useGLTF('/WaterShapes/Water_low.glb') as any;
  const water90 = useGLTF('/WaterShapes/Water90_Flat.glb') as any;
  const water180 = useGLTF('/WaterShapes/Water180_HemiSphere.glb') as any;
  const water60 = useGLTF('/WaterShapes/Water60_Cone.glb') as any;
  const water45 = useGLTF('/WaterShapes/Water45_Oblique.glb') as any;

  // State for Cylinder005 hover highlight
  const [isCylinderHovered, setIsCylinderHovered] = React.useState(false);

  // Refs for key animatable components
  const coverRef = useRef<THREE.Object3D>(null);
  const pointerRef = useRef<THREE.Object3D>(null);
  const liquidRef = useRef<THREE.Mesh>(null);
  const valveRef = useRef<THREE.Object3D>(null);
  const switchRef = useRef<THREE.Object3D>(null);
  const deflectorRef = useRef<THREE.Object3D>(null);
  const apparatusGroupRef = useRef<THREE.Group>(null);
  const waterGroupRef = useRef<THREE.Group>(null);

  // Cylinder005 Hover reference and anim state refs
  const cylinder005Ref = useRef<THREE.Mesh>(null);
  const animTimeRef = useRef<number>(0);
  const animActiveRef = useRef<boolean>(false);
  const offset006Ref = useRef(0);
  const offset010Ref = useRef(0);
  const offsetSphereRef = useRef(0);
  const originalPos010 = useRef<number | null>(null);
  const originalPosSphere = useRef<number | null>(null);

  // Temporary vectors/quaternions for coordinate mapping in useFrame (avoid frame allocation)
  const tempNozzlePos = useRef(new THREE.Vector3()).current;
  const tempDefPos = useRef(new THREE.Vector3()).current;
  const tempMidpoint = useRef(new THREE.Vector3()).current;
  const tempQuaternion = useRef(new THREE.Quaternion()).current;
  const tempScale = useRef(new THREE.Vector3()).current;

  // Initialize nodes, shadow configs, glass effects, and reflection intensities
  useEffect(() => {
    if (scene) {
      scene.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          // Apply reflection config to model materials
          if (child.material) {
            child.material.envMapIntensity = reflection;
          }

          // Apply glass transparency to the outer shield cylinder with dynamic slider adjustments
          if (
            child.name.toLowerCase().includes('cylinder001') || 
            child.name.toLowerCase().includes('cylinder005') ||
            child.name.toLowerCase().includes('upper_plate')
          ) {
            child.material = new THREE.MeshPhysicalMaterial({
              color: '#ffffff',
              transparent: true,
              opacity: 1.0, // High opacity keeps reflection highlights bright
              roughness: glassRoughness, // User-adjustable roughness
              metalness: 0.0,
              transmission: 0.98, // Transmit light through
              ior: glassIor, // User-adjustable Index of Refraction
              thickness: 1.5,
              clearcoat: 1.0, // Highly polished outer layer
              clearcoatRoughness: glassRoughness * 0.5,
              specularIntensity: glassSpecular, // User-adjustable specular level
              depthWrite: false,
            });
            child.material.envMapIntensity = reflection;
          }

          // Apply water shader look to LIQUID001 (keep hidden since we use realistic meshes now)
          if (child.name === 'LIQUID001') {
            child.visible = false;
          }

          // Hide static weights inside the model initially to avoid clutter
          if (child.name.includes('Weight_')) {
            child.visible = false;
          }
        }
      });
    }
  }, [scene, reflection, glassSpecular, glassRoughness, glassIor]);

  // Apply solid blue water look to the loaded water shapes so they are clearly visible
  const waterMaterial = React.useMemo(() => new THREE.MeshStandardMaterial({
    color: '#0066ff', // Bright solid blue
    transparent: false,
    opacity: 1.0,
    roughness: 0.3,
    metalness: 0.1,
  }), []);

  useEffect(() => {
    [waterLow, water90, water180, water60, water45].forEach((gltf) => {
      if (gltf && gltf.scene) {
        gltf.scene.traverse((child: any) => {
          if (child.isMesh) {
            child.material = waterMaterial;
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      }
    });
  }, [waterLow, water90, water180, water60, water45, waterMaterial]);

  // Cylinder005 mouse hover highlight material controller
  useEffect(() => {
    if (cylinder005Ref.current && cylinder005Ref.current.material) {
      const mat = cylinder005Ref.current.material as any;
      if (isCylinderHovered) {
        mat.color.set('#00a2ff');
        mat.emissive = new THREE.Color('#002266');
        mat.emissiveIntensity = 0.6;
      } else {
        mat.color.set('#ffffff');
        mat.emissive = new THREE.Color('#000000');
        mat.emissiveIntensity = 0;
      }
    }
  }, [isCylinderHovered]);

  // Control visibility of individual deflector meshes inside model based on state
  useEffect(() => {
    if (scene) {
      const deflectorNames = [
        'Deflector 90', 'Deflector 180', 'Deflector 120', 'Deflector 45',
        'Deflector 130', 'Deflector Cone 30', 'Deflector Cone 60'
      ];
      
      deflectorNames.forEach((name) => {
        const obj = scene.getObjectByName(name);
        if (obj) {
          obj.visible = false;
          obj.position.y = 0; // Reset displacement on switch
        }
      });

      // Show active selection
      let activeName = '';
      if (state.selectedDeflectorId === 0) activeName = 'Deflector 90';
      if (state.selectedDeflectorId === 5) activeName = 'Deflector 180';
      if (state.selectedDeflectorId === 2) activeName = 'Deflector 120';
      if (state.selectedDeflectorId === 4) activeName = 'Deflector 45';

      if (activeName) {
        const activeObj = scene.getObjectByName(activeName);
        if (activeObj) activeObj.visible = true;
      }
    }
  }, [scene, state.selectedDeflectorId]);

  // Map references once nodes are loaded
  useEffect(() => {
    if (scene) {
      coverRef.current = scene.getObjectByName('Cylinder006'); // typical upper plate lid
      pointerRef.current = scene.getObjectByName('Pointer'); // balancing pointer
      liquidRef.current = scene.getObjectByName('LIQUID001'); // water jet cylinder
      valveRef.current = scene.getObjectByName('Valve') || scene.getObjectByName('Cold_Tab_001_Baked'); // valve knob
      switchRef.current = scene.getObjectByName('c pump_066'); // pump switch
      deflectorRef.current = scene.getObjectByName('Cone001'); // active deflector holder
      cylinder005Ref.current = (scene.getObjectByName('Cylinder005') || scene.getObjectByName('Upper_Plate')) as THREE.Mesh;
    }
  }, [scene]);

  // Dynamic weights geometries cloned from nodes
  const weightGeometry50 = nodes['Weight_50 gm']?.geometry;
  const weightGeometry100 = nodes['Weight_100 gm']?.geometry;
  const weightGeometry200 = nodes['Weight_200 gm']?.geometry;
  const weightGeometry500 = nodes['Weight_500 gm']?.geometry;
  const weightMat = nodes['Weight_50 gm']?.material || new THREE.MeshStandardMaterial({ color: '#78909c', roughness: 0.5 });

  // Physics animation tick
  useFrame((_threeState: any, delta: number) => {
    // 1. Tank Cover / Upper plate animation (Step 0 & 2)
    if (coverRef.current && !animActiveRef.current) {
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
    const flowLMin = 120 * (-4.9138 * Math.pow(state.valveOpening, 4) + 8.8783 * Math.pow(state.valveOpening, 3) - 3.7629 * Math.pow(state.valveOpening, 2) + 0.7265 * state.valveOpening);
    const flowRateQLMin = Math.max(0, flowLMin);
    const flowRateQM3 = flowRateQLMin / 60000;
    const theoreticalVo = flowRateQM3 / 0.0000785;
    
    let v2 = Math.pow(theoreticalVo, 2) - 2 * 9.81 * Math.sqrt(0.035);
    v2 = Math.max(0, v2);

    // Deflector force multiplier
    let factor = 1.0;
    if (state.selectedDeflectorId === 5) factor = 2.0; // cup
    if (state.selectedDeflectorId === 2) factor = 0.5; // cone
    if (state.selectedDeflectorId === 4) factor = 0.293; // oblique 45°

    // Jet force in Newtons
    const fth = state.isPowerOn ? (factor * 1000 * 0.0000785 * v2) : 0;

    // Weight force in Newtons
    const loadedMassG = state.loadedWeights.reduce((a, b) => a + b, 0);
    const weightForceN = (loadedMassG * 9.81) / 1000;

    // Net upward force
    const netForce = fth - weightForceN;

    // Spring deflection (200 N/m stiffness)
    const displacementMm = netForce * 5;
    const clampedDisplacement = THREE.MathUtils.clamp(displacementMm, -12, 15);

    // Update pointer position (Scale 1mm to 0.015 units in R3F space)
    const targetY = clampedDisplacement * 0.015;
    if (pointerRef.current) {
      pointerRef.current.position.y = THREE.MathUtils.lerp(pointerRef.current.position.y, targetY, delta * 10);
    }

    // Also move the active deflector mesh by the same displacement in real-time
    const activeDefName = 
      state.selectedDeflectorId === 0 ? 'Deflector 90' :
      state.selectedDeflectorId === 5 ? 'Deflector 180' :
      state.selectedDeflectorId === 2 ? 'Deflector 120' :
      state.selectedDeflectorId === 4 ? 'Deflector 45' : '';

    const activeDef = activeDefName ? scene.getObjectByName(activeDefName) : null;
    const nozzle = scene.getObjectByName('JET Force 2_214') || scene.getObjectByName('Cylinder001');

    if (activeDef && scene) {
      activeDef.position.y = THREE.MathUtils.lerp(activeDef.position.y, targetY, delta * 10);
    }

    // 5. Dynamic Water Shape world position mapping and scaling
    if (state.isPowerOn && state.valveOpening > 0.05 && activeDef && nozzle && waterGroupRef.current) {
      waterGroupRef.current.visible = true;

      // Read absolute world positions of target nozzle and active deflector plate
      nozzle.getWorldPosition(tempNozzlePos);
      activeDef.getWorldPosition(tempDefPos);

      // Compute exact midpoint to position the centered water shape mesh
      tempMidpoint.addVectors(tempNozzlePos, tempDefPos).multiplyScalar(0.5);
      waterGroupRef.current.position.copy(tempMidpoint);

      // Copy nozzle rotation to align the jet flow axis perpendicularly
      nozzle.getWorldQuaternion(tempQuaternion);
      waterGroupRef.current.quaternion.copy(tempQuaternion);

      // Copy nozzle scale to fit within the transparent tank shield
      nozzle.getWorldScale(tempScale);

      // Determine active water shape state and its pre-measured Blender height
      let activeWater = 'low';
      let activeMeshHeight = 5.0833; // Water_low height

      if (state.valveOpening > 0.22) {
        if (state.selectedDeflectorId === 0) {
          activeWater = '90';
          activeMeshHeight = 21.9943;
        } else if (state.selectedDeflectorId === 5) {
          activeWater = '180';
          activeMeshHeight = 23.4198;
        } else if (state.selectedDeflectorId === 2) {
          activeWater = '60';
          activeMeshHeight = 17.0207;
        } else if (state.selectedDeflectorId === 4) {
          activeWater = '45';
          activeMeshHeight = 26.1200;
        }
      }

      // Calculate distance between nozzle and deflector, and set Y scale
      const distance = tempNozzlePos.distanceTo(tempDefPos);
      let scaleY = distance / activeMeshHeight;

      // Adjust height scaling during initial low flow pump startup
      if (activeWater === 'low') {
        const startupFactor = Math.min(1.0, state.valveOpening * 4.5);
        scaleY = (distance * startupFactor) / activeMeshHeight;

        // Offset position downwards so the rising jet starts at the nozzle lip
        const offsetDist = (distance * (1.0 - startupFactor)) * 0.5;
        const downDir = new THREE.Vector3(0, -1, 0).applyQuaternion(tempQuaternion);
        waterGroupRef.current.position.addScaledVector(downDir, offsetDist);
      }

      // Apply dynamic scale
      waterGroupRef.current.scale.set(tempScale.x, scaleY, tempScale.z);

      // Toggle mesh sub-scene visibilities
      waterLow.scene.visible = (activeWater === 'low');
      water90.scene.visible = (activeWater === '90');
      water180.scene.visible = (activeWater === '180');
      water60.scene.visible = (activeWater === '60');
      water45.scene.visible = (activeWater === '45');
    } else {
      if (waterGroupRef.current) {
        waterGroupRef.current.visible = false;
      }
    }

    // 6. Cylinder005 click-triggered sequential animation loop
    if (animActiveRef.current) {
      animTimeRef.current += delta;
      
      // Stage 1: Cylinder006 moves up by 10cm (represented by 0.22 units in local scale)
      if (animTimeRef.current > 0.05) {
        offset006Ref.current = THREE.MathUtils.lerp(offset006Ref.current, 0.22, delta * 4);
      }
      // Stage 2: Cylinder010 moves up by 10cm after 0.8s
      if (animTimeRef.current > 0.8) {
        offset010Ref.current = THREE.MathUtils.lerp(offset010Ref.current, 0.22, delta * 4);
      }
      // Stage 3: Sphere010 moves up by 10cm after 1.5s
      if (animTimeRef.current > 1.5) {
        offsetSphereRef.current = THREE.MathUtils.lerp(offsetSphereRef.current, 0.22, delta * 4);
      }
    } else {
      // Return smoothly to normal resting position
      offset006Ref.current = THREE.MathUtils.lerp(offset006Ref.current, 0.0, delta * 5);
      offset010Ref.current = THREE.MathUtils.lerp(offset010Ref.current, 0.0, delta * 5);
      offsetSphereRef.current = THREE.MathUtils.lerp(offsetSphereRef.current, 0.0, delta * 5);
    }

    // Retrieve components to apply offsets
    const cylinder006 = scene.getObjectByName('Cylinder006');
    const cylinder010 = scene.getObjectByName('Cylinder010');
    const sphere010 = scene.getObjectByName('Sphere010');

    if (cylinder006) {
      const baseCoverY = state.isCoverOpen ? 0.35 : 0.0;
      cylinder006.position.y = baseCoverY + offset006Ref.current;
    }
    if (cylinder010) {
      if (originalPos010.current === null) {
        originalPos010.current = cylinder010.position.y;
      }
      cylinder010.position.y = (originalPos010.current ?? 0) + offset010Ref.current;
    }
    if (sphere010) {
      if (originalPosSphere.current === null) {
        originalPosSphere.current = sphere010.position.y;
      }
      sphere010.position.y = (originalPosSphere.current ?? 0) + offsetSphereRef.current;
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
    <group ref={apparatusGroupRef} position={position} rotation={rotation} scale={scale}>
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

      {/* Centered Water shapes container group (positioned and scaled relative to global world space in useFrame) */}
      <group ref={waterGroupRef} visible={false}>
        <primitive object={waterLow.scene} />
        <primitive object={water90.scene} />
        <primitive object={water180.scene} />
        <primitive object={water60.scene} />
        <primitive object={water45.scene} />
      </group>

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

      {/* 6. Cylinder005 click/hover intercept zone */}
      <mesh
        position={[0, 0.85, 0]}
        visible={false}
        onPointerOver={(e) => { e.stopPropagation(); handlePointerOver(e); setIsCylinderHovered(true); }}
        onPointerOut={() => { handlePointerOut(); setIsCylinderHovered(false); }}
        onClick={(e) => {
          e.stopPropagation();
          if (animActiveRef.current) {
            animActiveRef.current = false;
          } else {
            animActiveRef.current = true;
            animTimeRef.current = 0;
          }
        }}
      >
        <cylinderGeometry args={[0.28, 0.28, 0.9, 16]} />
      </mesh>
    </group>
  );
};

// Preload the water GLB shapes
useGLTF.preload('/WaterShapes/Water_low.glb');
useGLTF.preload('/WaterShapes/Water90_Flat.glb');
useGLTF.preload('/WaterShapes/Water180_HemiSphere.glb');
useGLTF.preload('/WaterShapes/Water60_Cone.glb');
useGLTF.preload('/WaterShapes/Water45_Oblique.glb');
