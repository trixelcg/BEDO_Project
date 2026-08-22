import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LessonView, SimulationView } from '../types/index';
import {
  DEFLECTORS,
  MESH,
  WATER_SHAPES,
  WEIGHTS,
  getDeflector,
  type AnchorKey,
  type WaterShapeKey,
} from '../domain/apparatus';
import { gltfName } from '../lib/gltfNames';
import {
  ANCHOR_VIEW,
  COVER_LIFT,
  DEFAULT_ARROW_OFFSET,
  SCREW_LIFT,
  SPRING_REST_HEIGHT_MODEL_UNITS,
  mmToModelUnits,
  springTravelLimitMm,
  type Anchors,
} from '../lib/apparatusView';
import { springDeflectionMm } from '../domain/spring';
import { jetState } from '../domain/physics';
import { markReady, markTransfer } from '../lib/readiness';
import {
  commits,
  type DragSession,
  type DragSource,
  type DropOutcome,
} from '../interaction/drag';
import {
  createTransferSet,
  removedWeightIndex,
  type TransferKind,
} from '../interaction/transfer';
import { useObjectDrag } from './useObjectDrag';

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

/**
 * Somewhere a dragged deflector may be let go, in the apparatus's own space.
 *
 * **Two regions, because BEDO names two.** The experiment sheets say *"install it in the
 * rod"* and the storyboard says *"the deflector moves to **the tank** to install it in the
 * rod"* (sl. 7, 8, 14, 31) — the tank is the place you carry it to, the rod is the seat it
 * ends in. Both are accepted, and that is not generosity for its own sake: while the plate
 * is unscrewed the rod rides up with it, out of frame at the very step that says to drag,
 * and the tank is what the learner can actually see and aim at (`docs/38 §5`).
 *
 * Measured **boxes**, not spheres and not mesh hits. A single triangle on a thin vertical
 * pin is not something anyone can be asked to hit with an object in hand; a sphere around
 * a tall glass column is either too small to contain it or wide enough to swallow the
 * bench beside it. Derived from the real bounds, so a re-exported part takes its region
 * with it (`BEDO-021 §10`).
 */
interface DropRegion {
  /** Apparatus-local bounds, already padded. */
  box: THREE.Box3;
  /** The rod rides up with the tank cover; the tank itself does not. */
  liftsWithCover: boolean;
  /** The part to light up while the pointer is over this region. */
  highlight: string;
}

/** How far past its own bounds a region reaches. Pure feel; nothing depends on it. */
const DROP_REGION_PADDING = 0.15;

/**
 * An object in the learner's hand or in flight.
 *
 * The **temporary presentation transform** `BEDO-021 §8` asks for. The GLB's own nodes are
 * never moved by a drag: the original is hidden, a clone rides the pointer, and the clone
 * is thrown away when the gesture resolves. So a cancelled drag has nothing to undo, and
 * `SimulationRuntime` never sees a pointer coordinate.
 */
interface Ghost {
  readonly id: string;
  readonly wrapper: THREE.Group;
  /** Deflector angle, when this is a deflector. Drives which tray mesh stays hidden. */
  readonly deflectorId?: number;
  /** Disc mass, when this is a weight. Drives which tray mesh stays hidden. */
  readonly grams?: number;
  /** Apparatus-local offset applied to the clone's baked transform. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** True while the pointer owns the position; false once a transfer does. */
  followsPointer: boolean;
  /** The destination rides up with the tank cover — only the rod does. */
  liftsWithCover: boolean;
  /**
   * Where the clone's centre sits when the wrapper is at the origin.
   *
   * Subtracted from the point under the cursor, so the part is carried by the place the
   * learner grabbed rather than by the GLB's distant shared origin.
   */
  restCentre: THREE.Vector3;
}

interface DeviceModelProps {
  state: SimulationView;
  lesson: LessonView;
  /** Part the current guided step is about — null in free mode. */
  focusTarget: AnchorKey | null;
  groupRef: React.RefObject<THREE.Group | null>;
  anchors: Anchors;
  onAnchors: (anchors: Anchors) => void;
  onCoverClick: () => void;
  /**
   * Puts `SELECT_DEFLECTOR` to the gate. **Returns whether it was accepted** — the scene
   * needs the answer to know whether the deflector seats on the rod or comes back to the
   * tray, and asking the gate is the only way it may find out (`BEDO-021 §6`, `§7`).
   */
  onSelectDeflector: (id: number) => boolean;
  onPowerClick: () => void;
  onFlowValveClick: () => void;
  onVolumetricValveClick: () => void;
  onAddWeight: (grams: number) => void;
  /** Puts `REMOVE_WEIGHT` to the gate. Returns whether it was accepted. */
  onRemoveWeight: (index: number) => boolean;
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
  lesson,
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
  onRemoveWeight,
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

  // --- Drag and physical transfer (BEDO-021) ----------------------------------------
  /** Objects in hand or in flight. Changes twice per gesture, never per frame. */
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  /** Elapsed time and easing for every flight. Presentation only — see interaction/transfer. */
  const transfers = useMemo(() => createTransferSet(), []);
  /** Where a dragged deflector may be let go, measured from the GLB. */
  const dropRegionsRef = useRef<DropRegion[]>([]);
  /** The plane the carried object slides on: through where it started, facing the camera. */
  const dragPlane = useMemo(() => new THREE.Plane(), []);
  const dragTmp = useMemo(
    () => ({
      ray: new THREE.Ray(),
      inverse: new THREE.Matrix4(),
      point: new THREE.Vector3(),
      centre: new THREE.Vector3(),
      box: new THREE.Box3(),
      region: new THREE.Box3(),
      size: new THREE.Vector3(),
    }),
    []
  );
  /** Spring deflection as of the last frame — the rod, and so the target, ride it. */
  const deflectionRef = useRef(0);
  /** The part to light up while the pointer is over a drop region, or null. */
  const dropHighlightRef = useRef<string | null>(null);

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

  // The apparatus model is loaded and in the scene graph. See src/lib/readiness.ts.
  useEffect(() => {
    if (scene) markReady('scene');
  }, [scene]);

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

  /** Deflectors currently being carried or flown. Their originals stay out of sight. */
  const ghostDeflectorIds = useMemo(
    () => new Set(ghosts.map((g) => g.deflectorId).filter((id): id is number => id !== undefined)),
    [ghosts]
  );
  /** Disc denominations currently in flight back to the tray. Same reason. */
  const ghostWeightGrams = useMemo(
    () => new Set(ghosts.map((g) => g.grams).filter((g): g is number => g !== undefined)),
    [ghosts]
  );

  /**
   * Tray discs that are not on the tray: on the holder, or on their way back to it.
   *
   * **One predicate, read by both the renderer and the hit test** — which is the whole of
   * `BUG-19`. The tray mesh was hidden the moment its denomination was loaded while its
   * click proxy carried on firing, so a learner could keep adding discs that visibly were
   * not there. That was a nuisance with a click and would be worse now: a drag has to
   * start from something the learner can actually see and pick up, and starting one on an
   * invisible object is not a gesture anybody can make sense of (`BEDO-021 §13`).
   */
  const hiddenTrayWeightGrams = useMemo(() => {
    const hidden = new Set<number>(state.loadedWeightsG);
    ghostWeightGrams.forEach((grams) => hidden.add(grams));
    return hidden;
  }, [state.loadedWeightsG, ghostWeightGrams]);

  // The chosen deflector leaves the tray and appears mounted on the rod.
  //
  // While a ghost carries one, *neither* copy is drawn: the shelf is empty because the
  // learner has it in hand, and the rod is empty because it has not arrived yet. That is
  // what keeps a duplicate off the destination during the two-second install (§10).
  useEffect(() => {
    if (!scene) return;
    DEFLECTORS.forEach((d) => {
      const shelf = pick(d.shelf);
      const installed = pick(d.installed);
      const inFlight = ghostDeflectorIds.has(d.id);
      const chosen = lesson.hasInstalledDeflector && state.selectedDeflectorId === d.id;
      if (shelf) shelf.visible = !chosen && !inFlight;
      if (installed) installed.visible = chosen && !inFlight;
    });
  }, [scene, pick, lesson.hasInstalledDeflector, state.selectedDeflectorId, ghostDeflectorIds]);

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

    // Where a dragged deflector may be let go: the tank you carry it to and the rod it
    // seats in, both measured, both padded, both in the apparatus's own space so the rod
    // can be lifted with the plate at test time. See `DropRegion`.
    const region = (name: string, liftsWithCover: boolean): DropRegion | null => {
      if (!localBox([name])) return null;
      const box = tmp.box.clone();
      box.min.copy(group.worldToLocal(box.min.clone()));
      box.max.copy(group.worldToLocal(box.max.clone()));
      // worldToLocal does not preserve which corner is which under a mirrored transform.
      const lo = box.min.clone().min(box.max);
      const hi = box.min.clone().max(box.max);
      box.set(lo, hi);
      box.getSize(tmp.size);
      box.expandByVector(tmp.size.multiplyScalar(DROP_REGION_PADDING));
      return { box, liftsWithCover, highlight: name };
    };
    dropRegionsRef.current = [region(MESH.tank, false), region(MESH.rod, true)].filter(
      (r): r is DropRegion => r !== null
    );

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

    if (!lesson.isGuided) {
      return new Set([
        MESH.tankCover,
        MESH.powerSwitch,
        MESH.flowValve,
        MESH.volumetricValve,
        ...trayDeflectors,
        ...trayWeights,
      ]);
    }

    // In guided mode it is whatever the current step invites the learner to touch. The
    // step definition says so; this no longer works it out from a step number.
    const parts: Record<string, string[]> = {
      cover: [MESH.tankCover],
      deflectors: trayDeflectors,
      power: [MESH.powerSwitch],
      volumetricValve: [MESH.volumetricValve],
      flowValve: [MESH.flowValve],
      weights: trayWeights,
    };
    return new Set(lesson.highlight.flatMap((key) => parts[key] ?? []));
  }, [lesson.isGuided, lesson.highlight, state.showMonitor]);

  /**
   * Parts the interaction gate will actually accept a click on.
   *
   * A different question from `liveKeys`, which is what the *step* is asking for and so
   * drives the pulse and the arrow. This is what is *permitted*, and the two differ by
   * exactly the always-available affordances: since `BEDO-019` the volumetric valve is
   * operable at every step while being asked for at none, and before `BEDO-020` the scene
   * had no way to say so — it drew the valve with a default cursor and dispatched anyway.
   *
   * The set comes from the gate (`lesson.available`); this component does not work out
   * legality, it is only told the answer.
   */
  const actionableKeys = useMemo<Set<string>>(() => {
    if (state.showMonitor) return new Set();
    const parts: Record<string, string[]> = {
      cover: [MESH.tankCover],
      deflectors: DEFLECTORS.map((d) => d.shelf),
      power: [MESH.powerSwitch],
      volumetricValve: [MESH.volumetricValve],
      flowValve: [MESH.flowValve],
      weights: WEIGHTS.filter((w) => w.mesh).map((w) => w.mesh!),
    };
    const keys = new Set(lesson.available.flatMap((key) => parts[key] ?? []));

    // The tray carries all seven deflectors whatever experiment is loaded, and the gate
    // accepts only the ones this experiment is run with. Taking the rest out here is what
    // stops a shelf the gate would refuse from offering a pointer cursor — the same
    // actionable-vs-asked-for split BEDO-020 drew, at value granularity. The ids come from
    // the gate via `lesson.selectableDeflectorIds`; this component decides nothing.
    for (const d of DEFLECTORS) {
      if (!lesson.selectableDeflectorIds.includes(d.id)) keys.delete(d.shelf);
    }
    return keys;
  }, [lesson.available, lesson.selectableDeflectorIds, state.showMonitor]);

  /** Whether the gate would accept a weight interaction — drives the discs' cursor. */
  const weightsAreActionable = !state.showMonitor && lesson.available.includes('weights');

  /**
   * Where the guide arrow floats — null in free mode, or once the step is satisfied.
   *
   * "Satisfied" is the lesson runner's answer now. This component used to decide it here
   * with its own list of step numbers, while `UIOverlay` decided it separately for the OK
   * button, and the two genuinely disagreed (`CQ-06 #5`). Both read one evaluator now,
   * and each still produces exactly the behaviour it did before.
   */
  const arrowPos = useMemo<[number, number, number] | null>(() => {
    if (state.showMonitor || !lesson.isGuided || !focusTarget) return null;
    if (lesson.isSatisfied) return null;

    const anchor = anchors[focusTarget];
    if (!anchor) return null;

    const off = ANCHOR_VIEW[focusTarget]?.arrowOffset ?? DEFAULT_ARROW_OFFSET;
    return [anchor[0] + off[0], anchor[1] + off[1], anchor[2] + off[2]];
  }, [state.showMonitor, lesson.isGuided, lesson.isSatisfied, anchors, focusTarget]);

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
        if (state.isPowerOn || state.loadedWeightsG.length > 0) {
          onCoverClick();
          return;
        }
        // The plate lifts here and the app is told when the animation ends, so a click
        // the gate will refuse must not start it — otherwise the cover rises for a second
        // and drops back, which is the "moves then snaps back" failure BEDO-020 §12 names.
        // The click is still forwarded, so the learner gets the lesson's notice; only the
        // animation is withheld. This is not the component deciding legality — the gate
        // decided, and handed the answer down as `lesson.available`.
        if (!actionableKeys.has(MESH.tankCover)) {
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
        // Handled by the drag layer, which owns both gestures the sources describe: the
        // sheets' drag and the storyboard's click. The proxy still exists here because
        // that is where its position, radius and highlight key come from.
        return;
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
    const entries: {
      key: string;
      object: THREE.Object3D;
      offset: [number, number, number];
      /** Position in the stack — the identity `REMOVE_WEIGHT` uses. */
      index: number;
      hitRadius: number;
    }[] = [];

    // Each disc seats on top of the one before it, using its measured thickness — the
    // denominations are different heights, so a fixed increment either embeds them in
    // each other or floats them apart.
    //
    // The clone is measured DETACHED: a clone loses its ancestors' transforms, and in
    // this baked GLB those carry real offsets, so the in-scene position of the original
    // says nothing about where the clone will land once mounted under our own group.
    let cum = 0.001; // clear the pan's top face
    state.loadedWeightsG.forEach((grams, idx) => {
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
        index: idx,
        // Sized to the disc, and never taller than the disc is thick, so the proxies of
        // stacked discs do not swallow each other.
        hitRadius: Math.max(Math.min(h * 0.5, 0.02), 0.006),
      });
      cum += h;
    });
    return entries;
  }, [scene, pick, anchors.pan, state.loadedWeightsG]);

  // ==================================================================================
  // Drag and physical transfer (BEDO-021)
  // ==================================================================================
  //
  // The learner's half of step 2 — *"Drag the 90° flat deflector to install it in the
  // rod"* — and of the storyboard's state-D transition, *"Click on the weight on holder:
  // the weight removed from the tank holder in 2 sec"*.
  //
  // Everything below is presentation. The gesture becomes a semantic interaction in
  // `src/interaction/drag.ts`, the interaction is decided by the gate in `App`, and only
  // an accepted one is animated. Nothing here consults a lesson step, an experiment or a
  // safety rule; a refusal is simply a `false` coming back from the handler, and the
  // object goes home.

  const camera = useThree((three) => three.camera);
  /** The authority on what is in flight; `ghosts` mirrors it so React can draw them. */
  const ghostsRef = useRef<Ghost[]>([]);
  /** The stack as it was before the last change — where a removed disc flew from. */
  const previousStackRef = useRef(stack);
  const loadedWeightsRef = useRef(state.loadedWeightsG);
  const selectedDeflectorRef = useRef(state.selectedDeflectorId);
  /** Set when the scene itself started a removal flight, so the observer below stands down. */
  const sceneHandledRemovalRef = useRef(false);

  const syncGhosts = useCallback((next: Ghost[]) => {
    ghostsRef.current = next;
    setGhosts(next);
  }, []);

  /** Apparatus-local centre of a part's bounds. */
  const localCentreOf = useCallback(
    (name: string): THREE.Vector3 | null => {
      const group = groupRef.current;
      const object = pick(name);
      if (!group || !object) return null;
      object.updateWorldMatrix(true, true);
      dragTmp.box.setFromObject(object);
      if (dragTmp.box.isEmpty()) return null;
      dragTmp.box.getCenter(dragTmp.point);
      return group.worldToLocal(dragTmp.point.clone());
    },
    [groupRef, pick, dragTmp]
  );

  /** A drawable copy. The GLB's own node is never moved by a gesture — see `Ghost`. */
  const cloneFor = useCallback((source: THREE.Object3D): THREE.Object3D => {
    const clone = source.clone(true);
    clone.visible = true;
    clone.traverse((child: any) => {
      if (!child.isMesh) return;
      child.visible = true;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return clone;
  }, []);

  /**
   * Puts a part back under the rule that normally governs it.
   *
   * Run the instant a flight ends, in the same frame, so there is never a gap in which
   * neither the ghost nor the real mesh is on screen.
   */
  const revealAfterFlight = useCallback(
    (ghost: Ghost) => {
      ghost.wrapper.visible = false;
      if (ghost.deflectorId !== undefined) {
        const deflector = getDeflector(ghost.deflectorId);
        const chosen =
          lesson.hasInstalledDeflector && state.selectedDeflectorId === ghost.deflectorId;
        const shelf = pick(deflector.shelf);
        if (shelf) shelf.visible = !chosen;
        const installed = pick(deflector.installed);
        if (installed) installed.visible = chosen;
      } else if (ghost.grams !== undefined) {
        const definition = WEIGHTS.find((w) => w.grams === ghost.grams);
        const tray = definition?.mesh ? pick(definition.mesh) : undefined;
        if (tray) tray.visible = !loadedWeightsRef.current.includes(ghost.grams);
      }
    },
    [pick, lesson.hasInstalledDeflector, state.selectedDeflectorId]
  );

  /** Hands a ghost over from the pointer to a timed flight. */
  const startFlight = useCallback(
    (id: string, kind: TransferKind, to: THREE.Vector3, liftsWithCover: boolean) => {
      const ghost = ghostsRef.current.find((g) => g.id === id);
      if (!ghost) return;
      ghost.from = ghost.wrapper.position.clone();
      ghost.to = to.clone();
      ghost.followsPointer = false;
      ghost.liftsWithCover = liftsWithCover;
      transfers.start(id, kind);
      syncGhosts([...ghostsRef.current]);
    },
    [transfers, syncGhosts]
  );

  /**
   * Raises a ghost and works out where its destination is.
   *
   * The install destination is the **installed mesh's own resting transform**, read off
   * the GLB rather than written down here, so the deflector lands exactly where the
   * already-shipped installed state puts it (`§10`). Its live lift is added per frame
   * instead of being baked in, because the rod rides up with the tank cover and the
   * destination has to ride with it.
   */
  const raiseDeflectorGhost = useCallback(
    (deflectorId: number): Ghost | null => {
      const group = groupRef.current;
      const deflector = getDeflector(deflectorId);
      const shelf = pick(deflector.shelf);
      const shelfCentre = localCentreOf(deflector.shelf);
      if (!group || !shelf || !shelfCentre) return null;

      const installedObject = pick(deflector.installed);
      const installedCentre = localCentreOf(deflector.installed);
      let seat = new THREE.Vector3();
      if (installedObject && installedCentre) {
        // Strip whatever lift the frame loop has already applied, so the offset below is
        // tray-to-rod at rest and the live lift is not counted twice.
        const lifted =
          installedObject.position.y - baseY(installedObject, deflector.installed);
        seat = installedCentre.clone().setY(installedCentre.y - lifted).sub(shelfCentre);
      }

      const wrapper = new THREE.Group();
      wrapper.add(cloneFor(shelf));
      wrapper.position.set(0, 0, 0);

      const ghost: Ghost = {
        id: `deflector:${deflectorId}`,
        wrapper,
        deflectorId,
        from: new THREE.Vector3(),
        to: seat,
        followsPointer: true,
        liftsWithCover: true,
        restCentre: shelfCentre,
      };
      syncGhosts([...ghostsRef.current, ghost]);

      // Slide the carried object on a plane through where it started, square to the
      // camera, so it tracks under the cursor at a constant depth however the learner has
      // orbited the bench.
      camera.getWorldDirection(dragTmp.point);
      dragPlane.setFromNormalAndCoplanarPoint(
        dragTmp.point.clone().negate(),
        group.localToWorld(shelfCentre.clone())
      );
      return ghost;
    },
    [groupRef, pick, localCentreOf, cloneFor, baseY, syncGhosts, camera, dragTmp, dragPlane]
  );

  /** The same, for a disc already on the holder. Its home is the tray slot it came from. */
  const raiseWeightGhost = useCallback(
    (index: number, entries: typeof stack): Ghost | null => {
      const group = groupRef.current;
      const entry = entries[index];
      if (!group || !entry) return null;

      const wrapper = new THREE.Group();
      wrapper.add(cloneFor(entry.object));
      const stackLift = weightStackRef.current?.position.y ?? 0;
      wrapper.position.set(entry.offset[0], entry.offset[1] + stackLift, entry.offset[2]);

      // Where the clone sits when its wrapper is at the origin: its baked tray transform.
      entry.object.updateWorldMatrix(true, true);
      const grams = state.loadedWeightsG[index];
      const ghost: Ghost = {
        id: `weight:${index}`,
        wrapper,
        grams,
        from: wrapper.position.clone(),
        to: new THREE.Vector3(),
        followsPointer: true,
        liftsWithCover: false,
        restCentre: new THREE.Vector3(),
      };
      syncGhosts([...ghostsRef.current, ghost]);

      dragTmp.point.copy(wrapper.position);
      camera.getWorldDirection(dragTmp.centre);
      dragPlane.setFromNormalAndCoplanarPoint(
        dragTmp.centre.clone().negate(),
        group.localToWorld(dragTmp.point.clone())
      );
      return ghost;
    },
    [groupRef, cloneFor, syncGhosts, state.loadedWeightsG, camera, dragTmp, dragPlane]
  );

  /**
   * Which drop region the pointer is over, if any.
   *
   * A ray-versus-box test in the apparatus's own space, which is where the measured
   * regions live, and where the plate's lift is a plain addition on Y. Returns the part to
   * light up, so the feedback names whichever of the two the learner is actually aiming at.
   */
  const dropRegionUnder = useCallback(
    (ray: THREE.Ray): DropRegion | null => {
      const group = groupRef.current;
      if (!group || dropRegionsRef.current.length === 0) return null;
      group.updateWorldMatrix(true, false);
      dragTmp.inverse.copy(group.matrixWorld).invert();
      dragTmp.ray.copy(ray).applyMatrix4(dragTmp.inverse);
      const lift = coverOffsetRef.current + deflectionRef.current;
      for (const region of dropRegionsRef.current) {
        dragTmp.region.copy(region.box);
        if (region.liftsWithCover) dragTmp.region.translate(dragTmp.point.set(0, lift, 0));
        if (dragTmp.ray.intersectsBox(dragTmp.region)) return region;
      }
      return null;
    },
    [groupRef, dragTmp]
  );

  /**
   * Dev-only: where a draggable part and its target are on screen (`BEDO-021 §31`, §33).
   *
   * The browser suite performs a **real** pointer drag, and a real drag needs two screen
   * points. Hard-coding them would be guessing at a 3D view that reframes itself between
   * steps — the same problem `BEDO-002` solved for the tank cover — so the application
   * projects its own geometry and the test drives the mouse between the answers. What is
   * exercised is then the genuine article: capture, threshold, the drop test, the gate.
   *
   * `import.meta.env.DEV` is compiled to `false` by `vite build`, so this is dead code the
   * bundler drops; `tests/unit/bundle.spec.ts` asserts `__bedoTest` is absent from `dist/`.
   */
  const gl = useThree((three) => three.gl);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const project = (local: THREE.Vector3 | null) => {
      const group = groupRef.current;
      const canvas = gl?.domElement;
      if (!group || !canvas || !local) return null;
      const world = group.localToWorld(local.clone()).project(camera);
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + ((world.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - world.y) / 2) * rect.height,
      };
    };
    const globals = window as unknown as Record<string, any>;
    globals.__bedoTest = {
      ...globals.__bedoTest,
      dragProbe: {
        deflectorPoint: (id: number) => project(localCentreOf(getDeflector(id).shelf)),
        /** Any authored mesh, by GLB name — used to reason about what a step actually frames. */
        meshPoint: (name: string) => project(localCentreOf(name)),
        /**
         * Where to aim a drag: the centre of the first drop region the camera can
         * actually see, so a browser test aims where a learner would rather than at a
         * part that is out of frame (the rod is, at the very step that says to drag).
         */
        dropPoint: () => {
          const canvas = gl?.domElement;
          if (!canvas) return null;
          const rect = canvas.getBoundingClientRect();
          const lift = coverOffsetRef.current + deflectionRef.current;
          let fallback: { x: number; y: number } | null = null;
          for (const region of dropRegionsRef.current) {
            const centre = region.box.getCenter(new THREE.Vector3());
            if (region.liftsWithCover) centre.y += lift;
            const point = project(centre);
            if (!point) continue;
            fallback ??= point;
            if (
              point.x >= rect.left &&
              point.y >= rect.top &&
              point.x <= rect.left + rect.width &&
              point.y <= rect.top + rect.height
            ) {
              return point;
            }
          }
          return fallback;
        },
      },
    };
  });

  const drag = useObjectDrag({
    // Deliberately permissive. Whether an interaction is *allowed* is the gate's question
    // and asking it here would be a second copy of the policy — the very shape of BUG-04
    // and BUG-05. A wrong-experiment deflector must be pickable precisely so that the gate
    // can refuse it and the learner can see why (`§7`).
    canDrag: (source) => {
      if (state.showMonitor) return false;
      if (source.kind === 'weight') return source.index < state.loadedWeightsG.length;
      const shelf = pick(getDeflector(source.deflectorId).shelf);
      return shelf?.visible === true;
    },

    isOverTarget: (source, ray) => {
      if (source.kind !== 'deflector') return false;
      const region = dropRegionUnder(ray);
      // Remembered so the frame loop can light the part the learner is aiming at — the
      // tank while the plate is up and the rod is out of frame, the rod once it is back.
      dropHighlightRef.current = region?.highlight ?? null;
      return region !== null;
    },

    onGrab: (source) => {
      if (source.kind === 'deflector') raiseDeflectorGhost(source.deflectorId);
      else raiseWeightGhost(source.index, stack);
    },

    onCarry: (_session: DragSession, ray) => {
      const group = groupRef.current;
      const ghost = ghostsRef.current.find((g) => g.followsPointer);
      if (!group || !ghost) return;
      if (!ray.intersectPlane(dragPlane, dragTmp.point)) return;
      group.worldToLocal(dragTmp.point);
      ghost.wrapper.position.copy(dragTmp.point).sub(ghost.restCentre);
    },

    onRelease: (session: DragSession, outcome: DropOutcome) => {
      dropHighlightRef.current = null;
      const ghost = ghostsRef.current.find((g) => g.followsPointer);
      if (!ghost) return;

      if (session.source.kind === 'deflector') {
        // `commit` (a drag onto the rod) and `activate` (a plain click, which is what
        // BEDO's own storyboard describes) are the same request. Only the gate decides.
        const accepted = commits(outcome) && onSelectDeflector(session.source.deflectorId);
        if (accepted) startFlight(ghost.id, 'deflector-install', ghost.to, true);
        else startFlight(ghost.id, 'return-to-source', new THREE.Vector3(), false);
        return;
      }

      const accepted = commits(outcome) && onRemoveWeight(session.source.index);
      if (accepted) {
        // The ghost the learner was holding becomes the flight, so the disc carries on
        // from where it was let go instead of snapping back to the pan first. The state
        // observer below must therefore not raise a second one for the same removal, and
        // it cannot tell by id: with two discs of the same mass the position it reads back
        // out of the state need not be the position that was asked for. So it is told.
        sceneHandledRemovalRef.current = true;
        startFlight(ghost.id, 'weight-removal', new THREE.Vector3(), false);
      } else {
        startFlight(ghost.id, 'return-to-source', ghost.from, false);
      }
    },
  });

  /**
   * The 2D panel's deflector selections, animated the same way.
   *
   * The scene watches `selectedDeflectorId` change rather than being told by whichever
   * control caused it (`BEDO-021 §22`), so the panel's list produces BEDO's two-second
   * install exactly as the tray does. The 3D path has already started this flight by the
   * time the effect runs — starting one that is already in the air is a no-op — so the two
   * cannot double up.
   *
   * Selection needs *both* triggers where removal needs only this one: a removal always
   * changes state, but installing the disc the rig already carries — which is the whole of
   * Exp. 1 step 2, since the flat deflector is what the sheet loads with — changes nothing,
   * so there is no transition here to see.
   *
   * A reset or an experiment switch also changes the selected deflector, and neither is a
   * learner installing anything. Both take the lesson back before the step that says a
   * deflector is on the rod, so requiring `hasInstalledDeflector` excludes them.
   */
  useEffect(() => {
    const previous = selectedDeflectorRef.current;
    selectedDeflectorRef.current = state.selectedDeflectorId;
    // `hasInstalledDeflector` is the scene's "is the rod carrying one" — false while the
    // learner is still standing on the install step and false again after a reset — so it
    // is also what tells a learner's swap apart from a restart, which changes the selected
    // deflector too and must not fly anything.
    if (previous === state.selectedDeflectorId || !lesson.hasInstalledDeflector) return;

    const id = `deflector:${state.selectedDeflectorId}`;
    if (transfers.has(id) || ghostsRef.current.some((g) => g.id === id)) return;

    const ghost = raiseDeflectorGhost(state.selectedDeflectorId);
    if (!ghost) return;
    startFlight(id, 'deflector-install', ghost.to, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedDeflectorId, lesson.hasInstalledDeflector]);

  /**
   * The 2D panel's removals, animated the same way.
   *
   * `BEDO-021 §22`: the scene watches the state transition rather than being told by
   * whichever control caused it, so the panel button and the disc in the tank produce the
   * same two-second move without either surface knowing about the animation. The 3D path
   * has already raised its own ghost under this id by the time this runs, so it is left
   * alone.
   */
  useEffect(() => {
    const previous = loadedWeightsRef.current;
    loadedWeightsRef.current = state.loadedWeightsG;
    const entries = previousStackRef.current;
    previousStackRef.current = stack;

    const index = removedWeightIndex(previous, state.loadedWeightsG);
    if (index === null) return;

    // The disc in the tank was dragged or clicked, and is already flying.
    if (sceneHandledRemovalRef.current) {
      sceneHandledRemovalRef.current = false;
      return;
    }

    const id = `weight:${index}`;
    if (transfers.has(id) || ghostsRef.current.some((g) => g.id === id)) return;

    const entry = entries[index];
    const group = groupRef.current;
    if (!entry || !group) return;

    const wrapper = new THREE.Group();
    wrapper.add(cloneFor(entry.object));
    const stackLift = weightStackRef.current?.position.y ?? 0;
    wrapper.position.set(entry.offset[0], entry.offset[1] + stackLift, entry.offset[2]);

    const ghost: Ghost = {
      id,
      wrapper,
      grams: previous[index],
      from: wrapper.position.clone(),
      to: new THREE.Vector3(),
      followsPointer: false,
      liftsWithCover: false,
      restCentre: new THREE.Vector3(),
    };
    ghostsRef.current = [...ghostsRef.current, ghost];
    setGhosts(ghostsRef.current);
    transfers.start(id, 'weight-removal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loadedWeightsG]);

  /**
   * Everything a gesture or a flight is holding, let go of.
   *
   * A reset, an experiment switch or a mode change must not leave a deflector floating
   * between the tray and the rod, or the camera locked because a drag never ended
   * (`§23`). The originals are restored under their normal rules, so the scene lands in
   * exactly the state it would have been in had nothing been dragged at all.
   */
  useEffect(() => {
    drag.cancel();
    for (const ghost of ghostsRef.current) {
      transfers.cancel(ghost.id);
      revealAfterFlight(ghost);
    }
    if (ghostsRef.current.length) syncGhosts([]);
    // `runId` is the restart signal, bumped by Reset and by loading another sheet. The
    // alternative — noticing that the step went back to the first one — would mean this
    // component following a step number, and a step boundary is not a restart: cancelling
    // on every one would abort a transfer the learner is still watching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.runId, state.experimentId, lesson.isGuided, state.showMonitor]);

  // Inert instrumentation, so a browser test can wait on the transfer instead of sleeping
  // through it. See src/lib/readiness.ts.
  useEffect(() => {
    markTransfer(ghosts.length > 0);
  }, [ghosts.length]);

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
      if (lesson.isGuided && focusTarget) liveKeys.forEach((k) => wanted.add(k));
      // Drop-target feedback, through the highlight the rest of the scene already uses
      // rather than a new overlay (`BEDO-021 §32`). Whichever region the pointer is over
      // is the part that lights, so it is always one the learner can see. A wrong target
      // simply never lights.
      if (dropHighlightRef.current) wanted.add(dropHighlightRef.current);
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
    const { theoreticalForceN } = jetState(state.valveOpening, state.selectedDeflectorId);
    const jetForceN = state.isPowerOn && !state.isCoverOpen ? theoreticalForceN : 0;
    const loadedMassG = state.loadedWeightsG.reduce((a, b) => a + b, 0);
    const weightForceN = (loadedMassG * 9.81) / 1000;

    // X = h_F - h_w, floored at rest and capped by the geometry above the spring.
    // The equation and the floor are BEDO's (storyboard sl. 8/19, see domain/spring.ts);
    // the travel limit is measured from this model, which is the scene's half of it.
    const restH = springInfoRef.current
      ? springInfoRef.current.restH
      : SPRING_REST_HEIGHT_MODEL_UNITS;
    const deflection = mmToModelUnits(
      springDeflectionMm(jetForceN, weightForceN, springTravelLimitMm(restH))
    );
    // The rod rides this, and so does the drop region measured from it.
    deflectionRef.current = deflection;

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

    // A tray disc is out of sight while it is on the holder, and stays out of sight for
    // the two seconds it spends flying back — otherwise it would be in two places at once
    // for the whole of the return.
    WEIGHTS.forEach((w) => {
      if (w.mesh) {
        const meshObj = pick(w.mesh);
        if (meshObj) {
          meshObj.visible = !hiddenTrayWeightGrams.has(w.grams);
        }
      }
    });

    // --- Ghosts: carried objects and physical transfers ---------------------------
    //
    // The stopwatch runs on real time, like the unscrew sequence: BEDO's two seconds are
    // two seconds, not two seconds' worth of clamped frames.
    if (ghosts.length) {
      const settled = transfers.advance(rawDelta);
      for (const ghost of ghosts) {
        if (ghost.followsPointer) continue;
        const progress = transfers.progressOf(ghost.id);
        if (progress === null) continue;
        ghost.wrapper.position.lerpVectors(ghost.from, ghost.to, progress);
        if (ghost.liftsWithCover) {
          ghost.wrapper.position.y += (coverOffsetRef.current + deflection) * progress;
        }
      }
      if (settled.length) {
        // Hide the ghost and reveal the real part in the *same* frame, so the swap at the
        // end of an install is never a blink (`§10`).
        for (const id of settled) {
          const ghost = ghosts.find((g) => g.id === id);
          if (ghost) revealAfterFlight(ghost);
        }
        const remaining = ghostsRef.current.filter((g) => !settled.includes(g.id));
        ghostsRef.current = remaining;
        setGhosts(remaining);
      }
    }

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
        {stack.map(({ key, object, offset, index, hitRadius }) => (
          <group key={key} position={offset}>
            <primitive object={object} />
            {/*
              "Click on the weight on holder — the weight removed from the tank holder in
              2 sec" (Jetforce_Storyboard.pptx sl. 32, state D). An invisible proxy exactly
              like every other hotspot; the disc's own transform, geometry, scale and
              materials are untouched, and nothing is added to the scene while the pan is
              empty.

              The storyboard's gesture is a click, so a click is what this is: a press and
              release under the movement threshold resolves to `activate`. Pulling the disc
              off works too and means exactly the same thing — one intent, two ways to
              express it, and no second policy anywhere (`docs/38 §5`).
            */}
            <mesh
              {...drag.handlersFor({ kind: 'weight', index })}
              onPointerOver={(e) => {
                e.stopPropagation();
                if (weightsAreActionable) document.body.style.cursor = 'grab';
              }}
              onPointerOut={() => {
                if (!drag.current()) document.body.style.cursor = 'default';
              }}
            >
              <sphereGeometry args={[hitRadius, 10, 8]} />
              <meshBasicMaterial visible={false} />
            </mesh>
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

      {/*
        Objects in the learner's hand, or in flight.

        Outside `weightStackRef` on purpose: the stack is rebuilt the moment the runtime's
        loaded-weight list changes, and a disc on its way back to the tray has to outlive
        exactly that change. Nothing is mounted here while the scene is at rest, so the
        idle draw-call count is the one BEDO-002 measured.
      */}
      {ghosts.map((ghost) => (
        <primitive key={ghost.id} object={ghost.wrapper} />
      ))}

      {hotspots.map((h) => {
        // A tray disc that is not on the tray has no hit proxy either. See
        // `hiddenTrayWeightGrams` — this is BUG-19's other half.
        if (h.action.kind === 'weight' && hiddenTrayWeightGrams.has(h.action.grams)) return null;

        // Deflectors are dragged; everything else is pressed. Note the click path is not
        // lost — a press and release without movement resolves to `activate`, which puts
        // the identical interaction to the gate (`docs/38 §5`).
        const source: DragSource | null =
          h.action.kind === 'deflector' ? { kind: 'deflector', deflectorId: h.action.id } : null;
        const draggable = source !== null;

        return (
          <mesh
            key={h.key}
            ref={h.key === MESH.tankCover ? coverHotspotRef : undefined}
            position={h.position}
            {...(source ? drag.handlersFor(source) : {})}
            onPointerOver={(e) => {
              e.stopPropagation();
              // Actionability, not focus: a hotspot the gate would refuse must not offer
              // the same pointer as one it would accept (BEDO-020 §24).
              if (actionableKeys.has(h.key)) {
                document.body.style.cursor = draggable ? 'grab' : 'pointer';
                setHoveredKey(h.key);
              }
            }}
            onPointerOut={() => {
              if (!drag.current()) document.body.style.cursor = 'default';
              setHoveredKey((k) => (k === h.key ? null : k));
            }}
            {...(draggable
              ? {}
              : {
                  onClick: (e: { stopPropagation: () => void }) => {
                    e.stopPropagation();
                    handleHotspot(h.action);
                  },
                })}
          >
            <sphereGeometry args={[h.radius, 12, 10]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        );
      })}
    </group>
  );
};

useGLTF.preload('/Bedo_baked_v2.glb');
Object.values(WATER_SHAPES).forEach((s) => useGLTF.preload(s.url));
