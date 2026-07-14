import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimulationState } from '../types/index';
import {
  ANCHOR_VIEW,
  COVER_LIFT,
  DEFAULT_ARROW_OFFSET,
  DEFLECTORS,
  MESH,
  SCREW_LIFT,
  WATER_SHAPES,
  WEIGHTS,
  getDeflector,
  gltfName,
  type AnchorKey,
  type Anchors,
  type WaterShapeKey,
} from '../lib/apparatus';
import {
  FIRST_READING_VALVE,
  SECOND_READING_VALVE,
  SPRING_RATE_N_PER_M,
  VALVE_SNAP_MARGIN,
  jetState,
} from '../lib/physics';

type Action =
  | { kind: 'cover' }
  | { kind: 'deflector'; id: number }
  | { kind: 'weight'; grams: number }
  | { kind: 'power' }
  | { kind: 'flowValve' }
  | { kind: 'volumetricValve' };

/** An invisible sphere placed and sized from a real mesh, so clicks land on the part. */
interface Hotspot {
  key: string;
  position: [number, number, number];
  radius: number;
  action: Action;
}

interface DeviceModelProps {
  state: SimulationState;
  /** Part the current guided step is about — null in free mode. */
  focusTarget: AnchorKey | null;
  groupRef: React.RefObject<THREE.Group | null>;
  anchors: Anchors;
  onAnchors: (anchors: Anchors) => void;
  onCoverClick: () => void;
  onSelectDeflector: (id: number) => void;
  onPowerClick: () => void;
  onFlowValveClick: () => void;
  onVolumetricValveClick: () => void;
  onAddWeight: (grams: number) => void;
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
  focusTarget,
  groupRef,
  anchors,
  onAnchors,
  onCoverClick,
  onSelectDeflector,
  onPowerClick,
  onFlowValveClick,
  onVolumetricValveClick,
  onAddWeight,
  position,
  rotation,
  scale,
  reflection,
  glassSpecular,
  glassRoughness,
  glassIor,
}) => {
  const { scene } = useGLTF('/Bedo_baked_v2.glb') as any;

  const water = {
    low: useGLTF(WATER_SHAPES.low.url) as any,
    flat: useGLTF(WATER_SHAPES.flat.url) as any,
    hemi: useGLTF(WATER_SHAPES.hemi.url) as any,
    cone: useGLTF(WATER_SHAPES.cone.url) as any,
    oblique: useGLTF(WATER_SHAPES.oblique.url) as any,
  };

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  /** Meshes currently carrying a highlight material, so they can be put back. */
  const highlighted = useRef<Set<string>>(new Set());
  /** Nozzle exit, in the apparatus's local space. */
  const [nozzleLip, setNozzleLip] = useState<[number, number, number] | null>(null);

  const waterGroupRef = useRef<THREE.Group>(null);
  const arrowGroupRef = useRef<THREE.Group>(null);
  const weightStackRef = useRef<THREE.Group>(null);

  // Unscrew sequence
  const animActiveRef = useRef(false);
  const animTimeRef = useRef(0);
  const coverOffsetRef = useRef(0);
  const screwOffsetRef = useRef(0);

  /** Resting Y of each animated part, captured the first time it is touched. */
  const restY = useRef<Record<string, number>>({});
  const baseY = useCallback((obj: THREE.Object3D, key: string) => {
    if (restY.current[key] === undefined) restY.current[key] = obj.position.y;
    return restY.current[key];
  }, []);

  const tmp = useMemo(
    () => ({
      nozzlePos: new THREE.Vector3(),
      defPos: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      groupQuat: new THREE.Quaternion(),
      down: new THREE.Vector3(),
      box: new THREE.Box3(),
      center: new THREE.Vector3(),
      size: new THREE.Vector3(),
    }),
    []
  );

  const modelScale = scale[0] || 1;

  /** Look a mesh up by its authored GLB name, through three's name sanitiser. */
  const pick = useCallback(
    (authored: string): THREE.Object3D | undefined =>
      scene?.getObjectByName(gltfName(authored)) ?? scene?.getObjectByName(authored),
    [scene]
  );

  // Materials, shadows, glass. LIQUID001 and the mounted deflectors start hidden;
  // everything else is forced visible, since several parts ship hidden in the GLB.
  useEffect(() => {
    if (!scene) return;
    // child.name is already sanitised by the loader, so compare against sanitised names.
    const mounted = new Set(DEFLECTORS.map((d) => gltfName(d.installed)));
    const coverName = gltfName(MESH.tankCover);
    const liquidName = gltfName(MESH.liquid);

    scene.traverse((child: any) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) child.material.envMapIntensity = reflection;

      if (child.name === coverName) {
        child.material = new THREE.MeshPhysicalMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 1.0,
          roughness: glassRoughness,
          metalness: 0.0,
          transmission: 0.98,
          ior: glassIor,
          thickness: 1.5,
          clearcoat: 1.0,
          clearcoatRoughness: glassRoughness * 0.5,
          specularIntensity: glassSpecular,
          depthWrite: false,
        });
        child.material.envMapIntensity = reflection;
      }

      child.visible = child.name !== liquidName && !mounted.has(child.name);
    });
  }, [scene, reflection, glassSpecular, glassRoughness, glassIor]);

  const waterMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2f7fdd',
        transparent: true,
        opacity: 0.85,
        roughness: 0.15,
        metalness: 0.0,
      }),
    []
  );

  useEffect(() => {
    [water.low, water.flat, water.hemi, water.cone, water.oblique].forEach((gltf: any) => {
      gltf?.scene?.traverse((child: any) => {
        if (child.isMesh) {
          child.material = waterMaterial;
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });
    });
  }, [water.low, water.flat, water.hemi, water.cone, water.oblique, waterMaterial]);

  /**
   * Each jet shape's own offset and height, measured off a detached clone.
   *
   * The files don't sit at their origin — Water90_Flat is parked at y = +117.9 — and
   * two of them are rotated a quarter turn, so their listed heights were wrong. Both
   * facts have to be cancelled out or the jet renders far above the tank at the wrong
   * length. Cloning keeps the measurement free of whatever parent it gets mounted under.
   */
  const waterFit = useMemo(() => {
    const fit = {} as Record<
      WaterShapeKey,
      { center: THREE.Vector3; height: number; width: number }
    >;
    (Object.keys(WATER_SHAPES) as WaterShapeKey[]).forEach((key) => {
      const source = (water as any)[key]?.scene;
      if (!source) return;
      const probe = source.clone(true);
      probe.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(probe);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      fit[key] = {
        center: box.getCenter(new THREE.Vector3()),
        height: Math.max(size.y, 1e-6),
        width: Math.max(size.x, size.z, 1e-6),
      };
    });
    return fit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [water.low, water.flat, water.hemi, water.cone, water.oblique]);

  // The chosen deflector leaves the tray and appears mounted on the rod.
  useEffect(() => {
    if (!scene) return;
    DEFLECTORS.forEach((d) => {
      const shelf = pick(d.shelf);
      const installed = pick(d.installed);
      const chosen = state.currentStep >= 2 && state.selectedDeflectorId === d.id;
      if (shelf) shelf.visible = !chosen;
      if (installed) installed.visible = chosen;
    });
  }, [scene, state.currentStep, state.selectedDeflectorId]);

  /**
   * Read every interactive part's real position and size back off the GLB.
   *
   * These were hand-typed before, and they were wrong: the pump-switch hitbox sat at
   * (0.3, 0.2, 0.5) while the switch is really at (-0.35, 0.96, -0.42). The hotspots
   * floated in mid-air, so clicking a control did nothing. Deriving them from the
   * bounding boxes keeps hotspots, guide arrow and camera correct even if the model
   * is re-exported.
   */
  useEffect(() => {
    const group = groupRef.current;
    if (!scene || !group) return;
    group.updateWorldMatrix(true, true);

    const localBox = (names: string[]) => {
      tmp.box.makeEmpty();
      let found = false;
      names.forEach((n) => {
        const obj = pick(n);
        if (!obj) return;
        tmp.box.expandByObject(obj);
        found = true;
      });
      return found && !tmp.box.isEmpty();
    };

    const localCenter = (names: string[]): [number, number, number] | null => {
      if (!localBox(names)) return null;
      tmp.box.getCenter(tmp.center);
      const local = group.worldToLocal(tmp.center.clone());
      return [local.x, local.y, local.z];
    };

    const trayDeflectors = DEFLECTORS.map((d) => d.shelf);
    const trayWeights = WEIGHTS.filter((w) => w.mesh).map((w) => w.mesh!);

    const nextAnchors: Anchors = {};
    const assign = (key: AnchorKey, names: string[]) => {
      const c = localCenter(names);
      if (c) nextAnchors[key] = c;
    };

    assign('cover', [MESH.tankCover]);
    assign('tray', trayDeflectors);
    assign('pointer', [MESH.pointer]);
    // Frame the weights and the pointer together: the student loads one while
    // watching the other, which is how the reference video frames these steps.
    assign('weights', [...trayWeights, MESH.pointer]);
    assign('power', [MESH.powerSwitch]);
    assign('flowValve', [MESH.flowValve]);
    assign('volumetricValve', [MESH.volumetricValve]);
    assign('overview', [MESH.tankCover, MESH.flowValve, MESH.powerSwitch, ...trayDeflectors]);

    // The weight pan sits on top of the rod, so take the rod's crown rather than its
    // centre.
    if (localBox([MESH.rod])) {
      tmp.box.getCenter(tmp.center);
      const crown = group.worldToLocal(
        new THREE.Vector3(tmp.center.x, tmp.box.max.y, tmp.center.z)
      );
      nextAnchors.pan = [crown.x, crown.y, crown.z];
    }

    onAnchors(nextAnchors);

    // The jet leaves the nozzle's lip, not its centre.
    if (localBox([MESH.nozzle])) {
      tmp.box.getCenter(tmp.center);
      const lip = group.worldToLocal(new THREE.Vector3(tmp.center.x, tmp.box.max.y, tmp.center.z));
      setNozzleLip([lip.x, lip.y, lip.z]);
    }

    const spot = (name: string, action: Action, minRadius: number): Hotspot | null => {
      if (!localBox([name])) return null;
      tmp.box.getCenter(tmp.center);
      tmp.box.getSize(tmp.size);
      const local = group.worldToLocal(tmp.center.clone());
      const worldRadius = Math.max(tmp.size.x, tmp.size.y, tmp.size.z) * 0.6;
      const radius = THREE.MathUtils.clamp(worldRadius / modelScale, minRadius, 0.18);
      return { key: name, position: [local.x, local.y, local.z], radius, action };
    };

    const list = [
      spot(MESH.tankCover, { kind: 'cover' }, 0.08),
      spot(MESH.powerSwitch, { kind: 'power' }, 0.04),
      spot(MESH.flowValve, { kind: 'flowValve' }, 0.045),
      spot(MESH.volumetricValve, { kind: 'volumetricValve' }, 0.045),
      ...DEFLECTORS.map((d) => spot(d.shelf, { kind: 'deflector', id: d.id }, 0.022)),
      ...WEIGHTS.filter((w) => w.mesh).map((w) =>
        spot(w.mesh!, { kind: 'weight', grams: w.grams }, 0.022)
      ),
    ];

    setHotspots(list.filter((h): h is Hotspot => h !== null));
  }, [scene, groupRef, onAnchors, tmp, modelScale]);

  /**
   * Parts the student is invited to touch right now.
   *
   * In free mode that is everything — the state machine lets any control be clicked at
   * any time, and the guards decide. In guided mode it is only what the step asks for,
   * which is what the pulsing highlight and the pointer cursor key off.
   */
  const liveKeys = useMemo<Set<string>>(() => {
    if (state.showMonitor) return new Set();

    const trayDeflectors = DEFLECTORS.map((d) => d.shelf);
    const trayWeights = WEIGHTS.filter((w) => w.mesh).map((w) => w.mesh!);

    if (state.mode === 'free') {
      return new Set([
        MESH.tankCover,
        MESH.powerSwitch,
        MESH.flowValve,
        MESH.volumetricValve,
        ...trayDeflectors,
        ...trayWeights,
      ]);
    }

    const s = state.currentStep;
    if (s === 1 || s === 3) return new Set([MESH.tankCover]);
    if (s === 2) return new Set(trayDeflectors);
    if (s === 4) return new Set([MESH.powerSwitch]);
    if (s === 5) return new Set([MESH.volumetricValve]);
    if (s === 6 || s === 8) return new Set([MESH.flowValve]);
    if (s === 7 || s === 9) return new Set(trayWeights);
    return new Set();
  }, [state.mode, state.currentStep, state.showMonitor]);

  /** Where the guide arrow floats — null in free mode, or once the step is satisfied. */
  const arrowPos = useMemo<[number, number, number] | null>(() => {
    if (state.showMonitor || state.mode !== 'guided' || !focusTarget) return null;
    const step = state.currentStep;

    const done =
      (step === 1 && state.isCoverOpen) ||
      (step === 3 && !state.isCoverOpen) ||
      (step === 4 && state.isPowerOn) ||
      (step === 5 && state.isVolumetricValveOpen) ||
      (step === 6 && state.valveOpening >= FIRST_READING_VALVE - VALVE_SNAP_MARGIN) ||
      (step === 8 && state.valveOpening >= SECOND_READING_VALVE - VALVE_SNAP_MARGIN) ||
      (step === 7 && !!state.recordedRows[1]?.balanced) ||
      (step === 9 && !!state.recordedRows[2]?.balanced) ||
      step >= 10;

    const anchor = anchors[focusTarget];
    if (done || !anchor) return null;

    const off = ANCHOR_VIEW[focusTarget]?.arrowOffset ?? DEFAULT_ARROW_OFFSET;
    return [anchor[0] + off[0], anchor[1] + off[1], anchor[2] + off[2]];
  }, [state, anchors, focusTarget]);

  const handleHotspot = (action: Action) => {
    switch (action.kind) {
      case 'cover': {
        if (state.isCoverOpen) {
          onCoverClick();
          animActiveRef.current = false;
          return;
        }
        // Let App raise its safety warning rather than playing an unscrew that
        // would be rejected the moment it finishes.
        if (state.isPowerOn || state.loadedWeights.length > 0) {
          onCoverClick();
          return;
        }
        if (!animActiveRef.current) {
          animActiveRef.current = true;
          animTimeRef.current = 0;
        }
        return;
      }
      case 'deflector':
        return onSelectDeflector(action.id);
      case 'weight':
        return onAddWeight(action.grams);
      case 'power':
        return onPowerClick();
      case 'flowValve':
        return onFlowValveClick();
      case 'volumetricValve':
        return onVolumetricValveClick();
    }
  };

  /** Local position of each interactive part, keyed by mesh name. */
  const partPos = useMemo(
    () => Object.fromEntries(hotspots.map((h) => [h.key, h.position])),
    [hotspots]
  );

  /**
   * Weights the student has loaded, as clones of the real tray objects.
   *
   * The GLB is baked, so a weight's geometry carries the tray's coordinates in its
   * vertices — dropping that raw geometry into a mesh at a new position (what this
   * did before) renders it at the wrong place and the wrong size, which is why no
   * weights were ever visible on the pan. Cloning the object keeps its baked
   * transform, and we shift it by the pan-minus-tray delta.
   */
  const stack = useMemo(() => {
    if (!scene) return [];
    return state.loadedWeights
      .map((grams, idx) => {
        const def = WEIGHTS.find((w) => w.grams === grams);
        const meshName = def?.mesh ?? 'Weight_Custom';
        const proto = pick(meshName);
        if (!proto) return null;

        const object = proto.clone(true);
        object.traverse((child: any) => {
          if (child.isMesh) {
            child.visible = true;
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        return { key: `${idx}-${grams}`, object, meshName, idx };
      })
      .filter((w): w is { key: string; object: THREE.Object3D; meshName: string; idx: number } => w !== null);
  }, [scene, state.loadedWeights]);

  /**
   * Glow a clickable part, the way the reference simulator does (it uses HighlightPlus).
   *
   * The GLB's materials are shared across meshes — a single baked atlas — so tinting one
   * in place would light up unrelated parts too. Swap in a per-object clone the first
   * time it lights up, and put the original back when it stops.
   */
  const setGlow = useCallback(
    (name: string, intensity: number) => {
      const obj = pick(name);
      obj?.traverse((child: any) => {
        if (!child.isMesh || !child.material) return;
        if (!child.userData.__baseMat) {
          child.userData.__baseMat = child.material;
          child.material = child.material.clone();
        }
        const mat = child.material;
        if (mat.emissive) {
          mat.emissive.set('#1e7fd6');
          mat.emissiveIntensity = intensity;
        }
      });
    },
    [pick]
  );

  const clearGlow = useCallback(
    (name: string) => {
      const obj = pick(name);
      obj?.traverse((child: any) => {
        if (!child.isMesh || !child.userData.__baseMat) return;
        child.material?.dispose?.();
        child.material = child.userData.__baseMat;
        delete child.userData.__baseMat;
      });
    },
    [pick]
  );

  useFrame((three, rawDelta) => {
    if (!scene) return;
    const t = three.clock.getElapsedTime();

    // Frame-rate-independent easing.
    //
    // Everything here used to ease with lerp(current, target, delta * rate). The moment
    // a frame took longer than 1/rate seconds that factor went above 1, so the lerp
    // extrapolated past its target and the value ran away — each frame overshooting
    // further than the last. Loading a 27 MB model, or simply a weak GPU, is enough to
    // trigger it, and the scene detonates: the deflector's Y reached 2.7e20 and the
    // water's scale 6.8e18, which is why no jet was ever visible. damp() folds the
    // delta into an exponential, so the blend factor can never leave [0, 1).
    const delta = Math.min(rawDelta, 0.1);
    const damp = (current: number, target: number, rate: number) =>
      THREE.MathUtils.damp(current, target, rate, delta);

    // --- Highlights -------------------------------------------------------------
    // The part under the cursor glows steadily; in guided mode the part the step is
    // asking for pulses, so it is obvious where to click next.
    const wanted = new Set<string>();
    if (!state.showMonitor) {
      if (hoveredKey) wanted.add(hoveredKey);
      if (state.mode === 'guided' && focusTarget) liveKeys.forEach((k) => wanted.add(k));
    }

    highlighted.current.forEach((key) => {
      if (!wanted.has(key)) {
        clearGlow(key);
        highlighted.current.delete(key);
      }
    });

    const pulse = Math.sin(t * 6.0) * 0.28 + 0.55;
    wanted.forEach((key) => {
      highlighted.current.add(key);
      setGlow(key, key === hoveredKey ? 1.25 : pulse);
    });

    // --- Unscrew / re-seat sequence -------------------------------------------
    // The sequence timer runs on real time, not the clamped delta: clamping is there to
    // keep the easing stable, and feeding it to a stopwatch would stretch the animation
    // out on any machine rendering below 10 fps.
    if (animActiveRef.current) {
      animTimeRef.current += rawDelta;
      const a = animTimeRef.current;
      if (a > 0.05) {
        screwOffsetRef.current = damp(screwOffsetRef.current, SCREW_LIFT, 4);
      }
      if (a > 0.8) {
        coverOffsetRef.current = damp(coverOffsetRef.current, COVER_LIFT, 4);
      }
      if (a > 2.2 && !state.isCoverOpen) {
        animActiveRef.current = false;
        onCoverClick();
      }
    } else if (state.isCoverOpen) {
      screwOffsetRef.current = SCREW_LIFT;
      coverOffsetRef.current = COVER_LIFT;
    } else {
      screwOffsetRef.current = damp(screwOffsetRef.current, 0, 6);
      coverOffsetRef.current = damp(coverOffsetRef.current, 0, 6);
    }

    // --- Valves, switch, lamp --------------------------------------------------
    const flowValve = pick(MESH.flowValve);
    if (flowValve) {
      const target = state.valveOpening * Math.PI * 3.0;
      flowValve.rotation.z = damp(flowValve.rotation.z, target, 5);
    }

    const volValve = pick(MESH.volumetricValve);
    if (volValve) {
      const target = state.isVolumetricValveOpen ? -Math.PI * 0.5 : 0;
      volValve.rotation.z = damp(volValve.rotation.z, target, 5);
    }

    const powerSwitch = pick(MESH.powerSwitch);
    if (powerSwitch) {
      const target = state.isPowerOn ? -0.35 : 0.35;
      powerSwitch.rotation.x = damp(powerSwitch.rotation.x, target, 12);
    }

    const lampMat = (pick(MESH.powerLight) as THREE.Mesh | undefined)
      ?.material as any;
    if (lampMat?.emissive) {
      lampMat.emissive.set(state.isPowerOn ? '#26ff7a' : '#000000');
      lampMat.emissiveIntensity = state.isPowerOn ? 1.6 : 0;
    }

    // --- Jet force, spring deflection, pointer ---------------------------------
    const { fth } = jetState(state.valveOpening, state.selectedDeflectorId);
    const jetForceN = state.isPowerOn && !state.isCoverOpen ? fth : 0;
    const loadedMassG = state.loadedWeights.reduce((a, b) => a + b, 0);
    const weightForceN = (loadedMassG * 9.81) / 1000;

    // Net force on a 200 N/m spring, in metres, clamped to the pointer's travel.
    const netForce = jetForceN - weightForceN;
    const deflection = THREE.MathUtils.clamp(netForce / SPRING_RATE_N_PER_M, -0.06, 0.075);

    const pointer = pick(MESH.pointer);
    if (pointer) {
      pointer.position.y = damp(
        pointer.position.y,
        baseY(pointer, MESH.pointer) + coverOffsetRef.current + deflection,
        10
      );
    }

    // --- Cover assembly rises as one ------------------------------------------
    const lift = (name: string, offset: number) => {
      const obj = pick(name);
      if (obj) obj.position.y = baseY(obj, name) + offset;
    };
    lift(MESH.tankCover, coverOffsetRef.current);
    lift(MESH.screws, screwOffsetRef.current);
    lift(MESH.spring, coverOffsetRef.current);
    lift(MESH.rod, coverOffsetRef.current);

    const deflector = getDeflector(state.selectedDeflectorId);
    const activeDef = pick(deflector.installed);
    if (activeDef) {
      activeDef.position.y = damp(
        activeDef.position.y,
        baseY(activeDef, deflector.installed) + coverOffsetRef.current + deflection,
        10
      );
    }

    // --- Water jet --------------------------------------------------------------
    // Two things had to be true here and neither was.
    //
    // The jet group is a child of the apparatus, so it must be placed in the group's
    // local space; the old code copied world positions straight in, so the group's own
    // transform applied a second time and threw the jet clear of the tank.
    //
    // And because the GLB is baked, every node shares the same origin — asking the
    // nozzle and the deflector for getWorldPosition() returned the *same* point, so
    // the gap between them measured zero and the jet was scaled to nothing. The real
    // positions only live in the geometry, so measure the bounding boxes instead.
    const group = groupRef.current;
    const flowing = state.isPowerOn && state.valveOpening > 0.05 && !state.isCoverOpen;

    if (flowing && group && activeDef && nozzleLip && waterGroupRef.current) {
      tmp.box.setFromObject(activeDef);
      tmp.box.getCenter(tmp.defPos);
      tmp.box.getSize(tmp.size);
      tmp.defPos.setY(tmp.box.min.y); // the face the jet strikes
      group.worldToLocal(tmp.defPos);

      tmp.nozzlePos.set(nozzleLip[0], nozzleLip[1], nozzleLip[2]);

      const gap = tmp.defPos.y - tmp.nozzlePos.y;
      /** Deflector diameter, back in the apparatus's local units. */
      const plateWidth = Math.max(tmp.size.x, tmp.size.z) / modelScale;

      // Below a trickle the jet has no shape; above it the plume takes the form of
      // whichever deflector is mounted.
      const shape: WaterShapeKey = state.valveOpening > 0.22 ? deflector.water : 'low';
      const fit = waterFit[shape];

      if (gap > 0.001 && fit) {
        waterGroupRef.current.visible = true;

        tmp.mid.addVectors(tmp.nozzlePos, tmp.defPos).multiplyScalar(0.5);

        // Height spans the nozzle/deflector gap; width is driven by the plate the jet
        // spreads across. Scaling uniformly instead (height and width from the same
        // factor) blew the plume out to nearly three times the tank's diameter.
        let scaleY = gap / fit.height;
        let scaleXZ = plateWidth / fit.width;

        if (shape === 'low') {
          // A startup trickle: short, and barely wider than the nozzle.
          const startup = Math.min(1, state.valveOpening * 4.5);
          scaleY = (gap * startup) / fit.height;
          scaleXZ *= 0.3;
          tmp.mid.y -= gap * (1 - startup) * 0.5; // keep the rising jet on the nozzle
        }

        waterGroupRef.current.position.copy(tmp.mid);
        waterGroupRef.current.scale.set(scaleXZ, scaleY, scaleXZ);

        (Object.keys(WATER_SHAPES) as WaterShapeKey[]).forEach((key) => {
          const gltf = (water as any)[key];
          if (gltf?.scene) gltf.scene.visible = key === shape;
        });
      } else {
        waterGroupRef.current.visible = false;
      }
    } else if (waterGroupRef.current) {
      waterGroupRef.current.visible = false;
    }

    // --- Loaded weights ride the pan --------------------------------------------
    // Each weight is already offset onto the pan; this only follows the pan's travel.
    if (weightStackRef.current) {
      weightStackRef.current.position.set(0, coverOffsetRef.current + deflection, 0);
    }

    // --- Guide arrow bob ---------------------------------------------------------
    if (arrowGroupRef.current && arrowPos) {
      arrowGroupRef.current.position.set(
        arrowPos[0],
        arrowPos[1] + Math.sin(t * 5.0) * 0.02,
        arrowPos[2]
      );
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <primitive object={scene} />

      <group ref={weightStackRef}>
        {stack.map(({ key, object, meshName, idx }) => {
          const from = partPos[meshName];
          const pan = anchors.pan;
          if (!from || !pan) return null;
          return (
            <group
              key={key}
              position={[
                pan[0] - from[0],
                pan[1] - from[1] + 0.006 + idx * 0.008,
                pan[2] - from[2],
              ]}
            >
              <primitive object={object} />
            </group>
          );
        })}
      </group>

      {/* Each shape is re-centred on its own origin so the outer group can simply be
          parked at the midpoint of the nozzle/deflector gap. */}
      <group ref={waterGroupRef} visible={false}>
        {(Object.keys(WATER_SHAPES) as WaterShapeKey[]).map((key) => {
          const fit = waterFit[key];
          const source = (water as any)[key]?.scene;
          if (!source) return null;
          return (
            <group
              key={key}
              position={fit ? [-fit.center.x, -fit.center.y, -fit.center.z] : [0, 0, 0]}
            >
              <primitive object={source} />
            </group>
          );
        })}
      </group>

      {arrowPos && (
        <group ref={arrowGroupRef} position={arrowPos}>
          <mesh position={[0, 0.055, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.07, 12]} />
            <meshStandardMaterial
              color="#f58220"
              emissive="#ff9100"
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0.008, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.017, 0.034, 14]} />
            <meshStandardMaterial
              color="#f58220"
              emissive="#ff9100"
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      {hotspots.map((h) => (
        <mesh
          key={h.key}
          position={h.position}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (liveKeys.has(h.key)) {
              document.body.style.cursor = 'pointer';
              setHoveredKey(h.key);
            }
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'default';
            setHoveredKey((k) => (k === h.key ? null : k));
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleHotspot(h.action);
          }}
        >
          <sphereGeometry args={[h.radius, 12, 10]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ))}
    </group>
  );
};

useGLTF.preload('/Bedo_baked_v2.glb');
Object.values(WATER_SHAPES).forEach((s) => useGLTF.preload(s.url));
