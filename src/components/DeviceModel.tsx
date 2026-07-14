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

/** Lever valves and the rotary switch travel 90°, not multiple revolutions. */
const QUARTER_TURN = Math.PI / 2;

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

  // One simulated plume per deflector, plus the startup trickle.
  const water = {
    low: useGLTF(WATER_SHAPES.low.url) as any,
    d30: useGLTF(WATER_SHAPES.d30.url) as any,
    d45: useGLTF(WATER_SHAPES.d45.url) as any,
    d60: useGLTF(WATER_SHAPES.d60.url) as any,
    d90: useGLTF(WATER_SHAPES.d90.url) as any,
    d120: useGLTF(WATER_SHAPES.d120.url) as any,
    d135: useGLTF(WATER_SHAPES.d135.url) as any,
    d180: useGLTF(WATER_SHAPES.d180.url) as any,
  };
  const waterGltfs = Object.values(water);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  /** Meshes currently carrying a highlight material, so they can be put back. */
  const highlighted = useRef<Set<string>>(new Set());
  /** Nozzle exit, in the apparatus's local space. */
  const [nozzleLip, setNozzleLip] = useState<[number, number, number] | null>(null);
  /** The glass tank the water fills, in the apparatus's local space. */
  const [tankBounds, setTankBounds] = useState<{
    cx: number;
    cz: number;
    baseY: number;
    width: number;
    height: number;
  } | null>(null);
  /** Groups that let a part spin about its own centre — see makePivot. */
  const pivots = useRef<Record<string, THREE.Group>>({});
  /** 0 = pointer parked over the rod, 1 = swung 90° clear of the plate. */
  const pointerSwingRef = useRef(0);
  /** Spring rest height (model units) and, if the GLB ever ships one, its morph target. */
  const springInfoRef = useRef<{
    restH: number;
    morph: { mesh: THREE.Mesh; index: number } | null;
  } | null>(null);

  const waterGroupRef = useRef<THREE.Group>(null);
  const arrowGroupRef = useRef<THREE.Group>(null);
  const weightStackRef = useRef<THREE.Group>(null);
  /** The cover's click target has to ride up with the plate — see below. */
  const coverHotspotRef = useRef<THREE.Mesh>(null);

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

  /**
   * Water, rather than blue plastic.
   *
   * Physically-based glass with water's index of refraction, so the jet actually refracts
   * the tank and deflector behind it and picks up the environment along its edges. The
   * vertex ripple keeps the stream alive — the plumes are static baked meshes, and without
   * it a jet at full flow reads as a solid frozen sculpture. The ripple fades out at the
   * nozzle so the column stays welded to it, and grows toward the impact where the water
   * actually breaks up.
   */
  const waterTime = useRef({ value: 0 });

  /**
   * Tileable animated-water texture, generated at runtime — the project ships none.
   *
   * One RGBA map carries everything: RG is the surface normal of a fractal ripple field,
   * B its height. Built on a periodic lattice so it wraps seamlessly, because the shader
   * scrolls two copies of it forever.
   */
  const waterTex = useMemo(() => {
    const N = 256;
    const lattice = (period: number) => {
      const g = new Float32Array(period * period);
      for (let i = 0; i < g.length; i++) g[i] = Math.random();
      return (u: number, v: number) => {
        const x = u * period;
        const y = v * period;
        const xi = Math.floor(x) % period;
        const yi = Math.floor(y) % period;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);
        const sx = xf * xf * (3 - 2 * xf);
        const sy = yf * yf * (3 - 2 * yf);
        const a = g[yi * period + xi];
        const b = g[yi * period + ((xi + 1) % period)];
        const c = g[((yi + 1) % period) * period + xi];
        const d = g[((yi + 1) % period) * period + ((xi + 1) % period)];
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      };
    };
    const o1 = lattice(6);
    const o2 = lattice(13);
    const o3 = lattice(27);

    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const v = y / N;
        h[y * N + x] = o1(u, v) * 0.5 + o2(u, v) * 0.32 + o3(u, v) * 0.18;
      }
    }

    const img = new Uint8ClampedArray(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
        const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
        img[i * 4] = 128 + dx * 760;
        img[i * 4 + 1] = 128 + dy * 760;
        img[i * 4 + 2] = h[i] * 255;
        img[i * 4 + 3] = 255;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    canvas.getContext('2d')!.putImageData(new ImageData(img, N, N), 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }, []);

  const waterMaterial = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#4fb2f5'),
      transparent: true,
      opacity: 0.8,
      roughness: 0.08,
      metalness: 0.0,
      // Held deliberately low. The jet lives inside a dark tank, so a high transmission
      // just shows that darkness through it and the water reads as smoked glass. A bright,
      // mostly-opaque body with a hard clearcoat matches the reference, which shows a
      // luminous blue column.
      transmission: 0.3,
      thickness: 0.35,
      ior: 1.33, // water
      attenuationColor: new THREE.Color('#2f8fdd'),
      attenuationDistance: 0.6,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      specularIntensity: 1.0,
      envMapIntensity: 1.6,
      // A touch of self-illumination so the stream stays legible against the dark tank.
      emissive: new THREE.Color('#0d4a86'),
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // The classic dual-scroll water: two copies of one tileable ripple map drift over the
    // surface at different scales and directions — one across the surface plane, one down
    // the column so the pattern climbs with the flow. Their normals bend the lighting, so
    // the glints and the environment reflection shimmer; their heights drive soft caustic
    // sparkle and a little foam where crests coincide near the churning top.
    //
    // Sampling is planar in world space, not by UV — these baked simulation meshes carry
    // no usable UVs.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = waterTime.current;
      shader.uniforms.uWaterTex = { value: waterTex };

      shader.vertexShader =
        'uniform float uTime;\nvarying float vRise;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // The meshes are authored ~20 units tall and centred, so normalise height to
           // 0..1 from the bottom and let a gentle ripple build toward the surface.
           float rise = clamp(position.y * 0.05 + 0.5, 0.0, 1.0);
           float amp = 0.16 * rise;
           transformed.x += sin(position.y * 0.9 + uTime * 5.0) * amp;
           transformed.z += cos(position.y * 0.7 + uTime * 3.9) * amp;
           vRise = rise;
           vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vWNorm = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader =
        'uniform float uTime;\nuniform sampler2D uWaterTex;\n' +
        'varying float vRise;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n' +
        shader.fragmentShader
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
             {
               // Rapidly scrolling ripple layers along the flow direction (V-axis)
               vec2 uvTop = vWPos.xz * 6.0 + vec2(uTime * 1.2, uTime * 0.9);
               vec2 uvSide = vec2(vWPos.x + vWPos.z, vWPos.y * 2.0) * 4.5
                           - vec2(0.0, uTime * 7.5);
               vec2 grad = (texture2D(uWaterTex, uvTop).rg - 0.5) * 1.8
                         + (texture2D(uWaterTex, uvSide).rg - 0.5) * 2.2;
               vec3 bump = (viewMatrix * vec4(grad.x, 0.0, grad.y, 0.0)).xyz;
               normal = normalize(normal + bump * 1.5);
             }`
          )
          .replace(
            '#include <opaque_fragment>',
            `#include <opaque_fragment>
             {
               vec3 V = normalize(cameraPosition - vWPos);
               vec3 N = normalize(vWNorm);

               float hTop = texture2D(uWaterTex,
                 vWPos.xz * 5.0 + vec2(uTime * 1.5, -uTime * 1.0)).b;
               float hSide = texture2D(uWaterTex,
                 vec2(vWPos.x - vWPos.z, vWPos.y * 2.5) * 5.0 - vec2(0.0, uTime * 8.5)).b;

               // Fast-moving specular glints reflecting off turbulent wave crests
               float glint = smoothstep(0.55, 0.90, hTop * 0.5 + hSide * 0.5) * 0.65;

               // Enhanced rim reflection highlight
               float rim = pow(1.0 - abs(dot(N, V)), 2.5) * 0.55;

               // Flowing foam streaks matching the high-velocity jet stream
               float foam = smoothstep(0.40, 0.80, hSide) * 0.6;

               float lum = clamp(glint + rim + foam, 0.0, 0.95);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.96, 0.98, 1.0), lum);
               gl_FragColor.a = mix(gl_FragColor.a, 0.92, lum);
             }`
          );
    };
    return mat;
  }, [waterTex]);

  useEffect(() => {
    waterGltfs.forEach((gltf: any) => {
      gltf?.scene?.traverse((child: any) => {
        if (child.isMesh) {
          child.material = waterMaterial;
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...waterGltfs, waterMaterial]);

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
      { center: THREE.Vector3; height: number; width: number; upright: boolean }
    >;

    const measure = (source: THREE.Object3D, upright: boolean) => {
      const holder = new THREE.Group();
      const inner = new THREE.Group();
      // A quarter turn about X maps the mesh's Z axis onto Y, standing the jet up.
      if (upright) inner.rotation.x = -Math.PI / 2;
      inner.add(source.clone(true));
      holder.add(inner);
      holder.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(holder);
      if (box.isEmpty()) return null;
      return { box, size: box.getSize(new THREE.Vector3()) };
    };

    (Object.keys(WATER_SHAPES) as WaterShapeKey[]).forEach((key) => {
      const source = (water as any)[key]?.scene;
      if (!source) return;

      const asIs = measure(source, false);
      if (!asIs) return;

      // A jet is long along the flow. If the mesh is longer across Z than up Y it was
      // authored lying down (Water30/120/135 all are), so stand it up and measure again.
      const upright = asIs.size.z > asIs.size.y * 1.15;
      const final = upright ? measure(source, true) : asIs;
      if (!final) return;

      fit[key] = {
        center: final.box.getCenter(new THREE.Vector3()),
        height: Math.max(final.size.y, 1e-6),
        width: Math.max(final.size.x, final.size.z, 1e-6),
        upright,
      };
    });
    return fit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...waterGltfs]);

  /**
   * Let the valves and the switch turn on the spot.
   *
   * The GLB is baked, so every node's origin sits at the same far-away point
   * (0, 1.239, -1.232) while the geometry lives more than a metre away in its vertices.
   * Setting `valve.rotation.z` therefore swung the whole mesh around that distant origin
   * in a huge arc instead of spinning it in place — which is exactly why the flow valve
   * looked broken and appeared to turn about the wrong axis.
   *
   * Slot a group at each part's real centre and rotate that instead. Offsetting the mesh
   * by the same amount leaves it exactly where it was.
   */
  useEffect(() => {
    if (!scene) return;

    /** worldPoint overrides where the hinge sits; default is the part's own centre. */
    const install = (authored: string, worldPoint?: THREE.Vector3) => {
      const obj = pick(authored);
      if (!obj || pivots.current[authored]) return;
      const parent = obj.parent;
      if (!parent) return;

      parent.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;

      const centre = parent.worldToLocal(
        (worldPoint ?? box.getCenter(new THREE.Vector3())).clone()
      );

      const pivot = new THREE.Group();
      pivot.name = `${authored}__pivot`;
      pivot.position.copy(centre);
      parent.add(pivot);

      obj.position.sub(centre); // keeps the geometry exactly where it already was
      pivot.add(obj);

      pivots.current[authored] = pivot;
    };

    install(MESH.flowValve);
    install(MESH.volumetricValve);
    install(MESH.powerSwitch);

    // The pointer is an arm clamped to the thin vertical pin (JET Force 2_212), so it
    // swings about THAT pin's axis and turns in place. The first cut hinged it on the
    // main deflector rod, which made the whole arm orbit sideways instead.
    const pin = pick(MESH.pointerPin);
    const pointer = pick(MESH.pointer);
    if (pin && pointer) {
      const pinBox = new THREE.Box3().setFromObject(pin);
      const ptrBox = new THREE.Box3().setFromObject(pointer);
      if (!pinBox.isEmpty() && !ptrBox.isEmpty()) {
        const pinC = pinBox.getCenter(new THREE.Vector3());
        const ptrC = ptrBox.getCenter(new THREE.Vector3());
        install(MESH.pointer, new THREE.Vector3(pinC.x, ptrC.y, pinC.z));
      }
    }

    // The spring compresses against its seat, so it scales about its bottom end. If a
    // future GLB export carries a real morph target on it, that is used instead.
    const springObj = pick(MESH.spring);
    if (springObj) {
      const sBox = new THREE.Box3().setFromObject(springObj);
      if (!sBox.isEmpty()) {
        const sC = sBox.getCenter(new THREE.Vector3());
        const sSize = sBox.getSize(new THREE.Vector3());
        install(MESH.spring, new THREE.Vector3(sC.x, sBox.min.y, sC.z));

        let morph: { mesh: THREE.Mesh; index: number } | null = null;
        springObj.traverse((child: any) => {
          if (!morph && child.isMesh && child.morphTargetInfluences?.length) {
            morph = { mesh: child, index: 0 };
          }
        });
        springInfoRef.current = { restH: sSize.y / modelScale, morph };
      }
    }
  }, [scene, pick, modelScale]);

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

    // The tank the water fills.
    if (localBox([MESH.tank])) {
      tmp.box.getCenter(tmp.center);
      tmp.box.getSize(tmp.size);
      const floor = group.worldToLocal(
        new THREE.Vector3(tmp.center.x, tmp.box.min.y, tmp.center.z)
      );
      setTankBounds({
        cx: floor.x,
        cz: floor.z,
        baseY: floor.y,
        width: Math.max(tmp.size.x, tmp.size.z) / modelScale,
        height: tmp.size.y / modelScale,
      });
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
    if (!scene || !anchors.pan) return [];
    const pan = anchors.pan;
    const entries: { key: string; object: THREE.Object3D; offset: [number, number, number] }[] =
      [];

    // Each disc seats on top of the one before it, using its measured thickness — the
    // denominations are different heights, so a fixed increment either embeds them in
    // each other or floats them apart.
    //
    // The clone is measured DETACHED: a clone loses its ancestors' transforms, and in
    // this baked GLB those carry real offsets, so the in-scene position of the original
    // says nothing about where the clone will land once mounted under our own group.
    let cum = 0.001; // clear the pan's top face
    state.loadedWeights.forEach((grams, idx) => {
      const def = WEIGHTS.find((w) => w.grams === grams);
      const proto = pick(def?.mesh ?? 'Weight_Custom');
      if (!proto) return;

      const object = proto.clone(true);
      object.traverse((child: any) => {
        if (child.isMesh) {
          child.visible = true;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const centre = box.getCenter(new THREE.Vector3());
      const h = Math.max(box.getSize(new THREE.Vector3()).y, 0.002);

      entries.push({
        key: `${idx}-${grams}`,
        object,
        offset: [pan[0] - proto.position.x, pan[1] + cum + h / 2 - centre.y, pan[2] - proto.position.z],
      });
      cum += h;
    });
    return entries;
  }, [scene, pick, anchors.pan, state.loadedWeights]);

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

    // Enough to read as "click me", not enough to repaint the part blue.
    const pulse = Math.sin(t * 5.0) * 0.12 + 0.26;
    wanted.forEach((key) => {
      highlighted.current.add(key);
      setGlow(key, key === hoveredKey ? 0.7 : pulse);
    });

    // --- Unscrew / re-seat sequence -------------------------------------------
    // The sequence timer runs on real time, not the clamped delta: clamping is there to
    // keep the easing stable, and feeding it to a stopwatch would stretch the animation
    // out on any machine rendering below 10 fps.
    if (animActiveRef.current) {
      animTimeRef.current += rawDelta;
      const a = animTimeRef.current;
      // The pointer arm swings 90° clear of the plate FIRST — it sits over the plate, so
      // the plate cannot lift through it — then the screws come out, then the plate rises.
      if (a > 0.05) {
        pointerSwingRef.current = damp(pointerSwingRef.current, 1, 6);
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
      pointerSwingRef.current = 1;
    } else {
      screwOffsetRef.current = damp(screwOffsetRef.current, 0, 6);
      coverOffsetRef.current = damp(coverOffsetRef.current, 0, 6);
      // Closing runs in reverse: the pointer only swings back over the plate once the
      // plate has finished seating.
      if (coverOffsetRef.current < 0.02) {
        pointerSwingRef.current = damp(pointerSwingRef.current, 0, 6);
      }
    }

    // --- Valves, switch, lamp --------------------------------------------------
    // These turn their pivot, not the mesh: rotating the mesh spins it around the GLB's
    // shared, far-off node origin instead of its own centre. They are lever valves, so
    // they travel a quarter turn — the old code spun the flow valve through three full
    // revolutions (valveOpening * PI * 3).
    const flowPivot = pivots.current[MESH.flowValve];
    if (flowPivot) {
      flowPivot.rotation.z = damp(flowPivot.rotation.z, state.valveOpening * -QUARTER_TURN, 6);
    }

    // The volumetric lever lies along Z, so it swings about X — the flow lever lies along
    // Y and swings about Z. Each turns in the plane its blade occupies.
    const volPivot = pivots.current[MESH.volumetricValve];
    if (volPivot) {
      const target = state.isVolumetricValveOpen ? QUARTER_TURN : 0;
      volPivot.rotation.x = damp(volPivot.rotation.x, target, 6);
    }

    // The switch is a rotary knob on the panel, rotating about its local Z axis.
    const powerPivot = pivots.current[MESH.powerSwitch];
    if (powerPivot) {
      const target = state.isPowerOn ? -QUARTER_TURN : 0;
      powerPivot.rotation.x = 0;
      powerPivot.rotation.z = damp(powerPivot.rotation.z, target, 12);
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

    // Net force on a 200 N/m spring, in metres
    const netForce = jetForceN - weightForceN;

    const restH = springInfoRef.current ? springInfoRef.current.restH : 0.065;
    const minDeflection = -0.45 * restH;
    const maxDeflection = 0.45 * restH;
    const deflection = THREE.MathUtils.clamp(netForce / SPRING_RATE_N_PER_M, minDeflection, maxDeflection);

    // The pointer rides the moving assembly and swings about the rod axis it is clamped
    // to. Rotating the mesh itself would orbit the GLB's distant shared origin, so the
    // swing goes through its pivot (planted on the rod axis at install time).
    const pointerPivot = pivots.current[MESH.pointer];
    if (pointerPivot) {
      // The pointer height is driven only by spring deflection, staying in place when the cover lifts.
      pointerPivot.position.y = damp(
        pointerPivot.position.y,
        baseY(pointerPivot, 'pivot:pointer') + deflection,
        10
      );
      // Swings 90 degrees to the right when open
      pointerPivot.rotation.y = pointerSwingRef.current * QUARTER_TURN;
    }

    // --- Cover assembly rises as one ------------------------------------------
    const lift = (name: string, offset: number) => {
      const obj = pick(name);
      if (obj) obj.position.y = baseY(obj, name) + offset;
    };
    lift(MESH.tankCover, coverOffsetRef.current);
    lift(MESH.screws, screwOffsetRef.current);

    // Central rod and pointer pin move with cover offset and deflection
    const rodObj = pick(MESH.rod);
    if (rodObj) {
      rodObj.position.y = baseY(rodObj, MESH.rod) + coverOffsetRef.current + deflection;
    }
    const pinObj = pick(MESH.pointerPin);
    if (pinObj) {
      pinObj.position.y = baseY(pinObj, MESH.pointerPin) + coverOffsetRef.current + deflection;
    }

    // The spring rises with the cover offset
    const springPivot = pivots.current[MESH.spring];
    const springInfo = springInfoRef.current;
    if (springPivot && springInfo) {
      springPivot.position.y = baseY(springPivot, 'pivot:spring') + coverOffsetRef.current;
      const stretch = 1 + deflection / springInfo.restH;
      if (springInfo.morph) {
        const inf = springInfo.morph.mesh.morphTargetInfluences;
        if (inf) inf[springInfo.morph.index] = THREE.MathUtils.clamp(1 - stretch, 0, 1);
      } else {
        springPivot.scale.y = damp(springPivot.scale.y, stretch, 10);
      }
    }

    const deflector = getDeflector(state.selectedDeflectorId);
    const activeDef = pick(deflector.installed);
    if (activeDef) {
      // The deflector moves with cover offset and spring deflection
      activeDef.position.y = damp(
        activeDef.position.y,
        baseY(activeDef, deflector.installed) + coverOffsetRef.current + deflection,
        10
      );
    }

    // --- Water ------------------------------------------------------------------
    const group = groupRef.current;
    const flowing = state.isPowerOn && state.valveOpening > 0.05 && !state.isCoverOpen;

    if (flowing && group && activeDef && nozzleLip && tankBounds && waterGroupRef.current) {
      const shape: WaterShapeKey = state.valveOpening > 0.22 ? deflector.water : 'low';
      const fit = waterFit[shape];

      if (fit) {
        waterGroupRef.current.visible = true;

        // The impact point — the deflector's underside — anchors the startup stream.
        tmp.box.setFromObject(activeDef);
        tmp.box.getCenter(tmp.defPos);
        tmp.defPos.setY(tmp.box.min.y);
        group.worldToLocal(tmp.defPos);

        if (shape === 'low') {
          // A stream from the nozzle lip up to the plate it strikes.
          tmp.nozzlePos.set(nozzleLip[0], nozzleLip[1], nozzleLip[2]);

          const gap = Math.max(tmp.defPos.y - tmp.nozzlePos.y, 1e-4);
          const startup = Math.min(1, state.valveOpening * 4.5);
          const scaleY = (gap * startup) / fit.height;
          const scaleXZ = (tankBounds.width * 0.10) / fit.width;

          tmp.mid.addVectors(tmp.nozzlePos, tmp.defPos).multiplyScalar(0.5);
          tmp.mid.y -= gap * (1 - startup) * 0.5; // keep the rising stream on the nozzle
          waterGroupRef.current.position.copy(tmp.mid);
          waterGroupRef.current.scale.set(scaleXZ, scaleY, scaleXZ);
        } else {
          // Dynamic spray shape stretching from nozzle to deflector, with thickness responsive to flow rate
          tmp.nozzlePos.set(nozzleLip[0], nozzleLip[1], nozzleLip[2]);
          const gap = Math.max(tmp.defPos.y - tmp.nozzlePos.y, 1e-4);

          const scaleY = gap / fit.height;
          const flowIntensity = 0.7 + 0.3 * Math.min(1, (state.valveOpening - 0.22) / 0.48);
          const scaleXZ = ((tankBounds.width * 0.95) / fit.width) * flowIntensity;

          tmp.mid.addVectors(tmp.nozzlePos, tmp.defPos).multiplyScalar(0.5);
          waterGroupRef.current.position.copy(tmp.mid);
          waterGroupRef.current.scale.set(scaleXZ, scaleY, scaleXZ);
        }

        // Ripple faster the harder the jet runs.
        waterTime.current.value = t * (0.6 + state.valveOpening * 1.6);

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
    if (weightStackRef.current) {
      weightStackRef.current.position.set(0, coverOffsetRef.current + deflection, 0);
    }

    // Update original table weights visibility based on loaded state
    WEIGHTS.forEach((w) => {
      if (w.mesh) {
        const meshObj = pick(w.mesh);
        if (meshObj) {
          meshObj.visible = !state.loadedWeights.includes(w.grams);
        }
      }
    });

    // --- Cover's click target rides with the plate --------------------------------
    // It used to sit at the plate's resting height for good, so once the plate lifted you
    // had to click the empty air it came from to put it back, rather than the plate itself.
    const coverSpot = hotspots.find((h) => h.key === MESH.tankCover);
    if (coverHotspotRef.current && coverSpot) {
      coverHotspotRef.current.position.y = coverSpot.position[1] + coverOffsetRef.current;
    }

    // --- Guide arrow bob ---------------------------------------------------------
    if (arrowGroupRef.current && arrowPos) {
      // Step 3 points at the plate, which by then is up in the air.
      const lift = focusTarget === 'cover' ? coverOffsetRef.current : 0;
      arrowGroupRef.current.position.set(
        arrowPos[0],
        arrowPos[1] + lift + Math.sin(t * 5.0) * 0.02,
        arrowPos[2]
      );
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <primitive object={scene} />

      <group ref={weightStackRef}>
        {stack.map(({ key, object, offset }) => (
          <group key={key} position={offset}>
            <primitive object={object} />
          </group>
        ))}
      </group>

      {/* Each plume is stood upright, then re-centred on its own origin, so the outer group
          can simply be parked at the midpoint of the nozzle/deflector gap. */}
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
              <group rotation={fit?.upright ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
                <primitive object={source} />
              </group>
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
          ref={h.key === MESH.tankCover ? coverHotspotRef : undefined}
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
