import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import {
  measureHolderAnchor,
  recentreOffset,
  stackSeats,
  type HolderAnchor,
} from '../lib/holderAnchor';
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
  addedWeightIndex,
  createTransferSet,
  removedWeightIndex,
  type TransferKind,
} from '../interaction/transfer';
import { arcHeightOver, arcLift, type Obstacle } from '../lib/transferPath';
import {
  JET_ASSET,
  STARTUP_VALVE_OPENING,
  jetScale,
  plumeScale,
} from '../lib/waterJet';
import { directionOf } from '../interaction/transfer';
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
   * How high this flight arcs over the tank, in apparatus-local units (`docs/40 §9`).
   *
   * Zero for a straight move. A disc is added and taken off while the tank cover is shut
   * and the pan is above it, so the direct line between the bench and the pan goes through
   * the glass; this carries it over instead. Measured from the tank, not chosen.
   */
  arc: number;
  /** The disc's own radius, so the arc clears the tank with all of it and not just its centre. */
  radius: number;
  /**
   * The stack seat this disc is flying *into*, while it is still on its way.
   *
   * The runtime commits the disc the moment the click is accepted, so it is already in the
   * stack and would be drawn sitting on the pan. This is what tells the renderer to leave
   * that seat empty until the disc actually lands (`docs/40 §10`).
   */
  seatIndex?: number;
  /**
   * Where the clone's centre sits when the wrapper is at the origin.
   *
   * Subtracted from the point under the cursor, so the part is carried by the place the
   * learner grabbed rather than by the GLB's distant shared origin.
   */
  restCentre: THREE.Vector3;
}

/**
 * What the learner may do to the weights right now, given what is mid-flight.
 *
 * Adding again while discs are arriving is fine and stays fine: the runtime committed each
 * one on its click, so every disc already owns a distinct seat and two arrivals can never
 * claim the same slot. Balancing a reading means three or four discs in quick succession
 * and making the learner wait two seconds between each would be its own defect.
 *
 * Taking one *off* while anything is in flight is the case that cannot be allowed: removal
 * renumbers the stack under a disc that is still travelling to a seat identified by number.
 * So a removal waits for the pan to be settled, and while a removal is travelling nothing
 * else may touch the weights at all.
 */
export interface WeightAvailability {
  readonly canAdd: boolean;
  readonly canRemove: boolean;
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
  /**
   * Which weight interactions are physically available while discs are in flight.
   *
   * Presentation policy, reported upwards so the 2D panel obeys the same rule the tank
   * does (`BEDO-021b §14`, §15, §19). It is *not* a lesson refusal and never reaches the
   * gate: nothing is being disallowed, it simply has not finished happening yet.
   */
  onWeightAvailability: (availability: WeightAvailability) => void;
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
  onWeightAvailability,
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
  /**
   * The weight pan, measured from the rod's own geometry (BEDO-016).
   *
   * The single physical truth behind every loaded disc: what is drawn, what the pointer
   * hits, and where a removal flight starts. Apparatus-local, like every other measured
   * point here, and captured at rest — the live lift the pan rides on is added by the
   * frame loop, not baked in (see `weightStackRef`).
   */
  const [holderAnchor, setHolderAnchor] = useState<HolderAnchor | null>(null);
  /**
   * What a disc has to be carried over on its way to or from the pan (BEDO-021b).
   *
   * The tank's footprint at the shut cover's height, apparatus-local and measured at rest.
   * Weights are only ever added with the cover shut, so this is the envelope that matters.
   */
  const [transferObstacle, setTransferObstacle] = useState<Obstacle | null>(null);
  /** Groups that let a part spin about its own centre — see makePivot. */
  const pivots = useRef<Record<string, THREE.Group>>({});
  /** 0 = pointer parked over the rod, 1 = swung 90° clear of the plate. */
  const pointerSwingRef = useRef(0);
  /** Spring rest height (model units) and, if the GLB ever ships one, its morph target. */
  const springInfoRef = useRef<{
    restH: number;
    morph: { mesh: THREE.Mesh; index: number } | null;
  } | null>(null);

  /**
   * The water leaving the nozzle — BEDO's "water shape before impact" (sl. 18).
   *
   * Sized from `NOZZLE_AREA_M2`, never from the scene. See `src/lib/waterJet.ts`.
   */
  const jetGroupRef = useRef<THREE.Group>(null);
  /** The water leaving the deflector — BEDO's "water shape after impact". */
  const plumeGroupRef = useRef<THREE.Group>(null);
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
   * Weight discs in flight, split by which way they are going.
   *
   * An arrival carries the seat it is heading for; a departure has already left the stack
   * and has none. That is the whole distinction the availability rule needs.
   */
  const weightsInFlight = useMemo(() => {
    const weights = ghosts.filter((g) => g.grams !== undefined);
    return {
      arriving: weights.some((g) => g.seatIndex !== undefined),
      departing: weights.some((g) => g.seatIndex === undefined),
    };
  }, [ghosts]);

  const weightAvailability = useMemo<WeightAvailability>(
    () => ({
      canAdd: !weightsInFlight.departing,
      canRemove: !weightsInFlight.arriving && !weightsInFlight.departing,
    }),
    [weightsInFlight]
  );

  useEffect(() => {
    onWeightAvailability(weightAvailability);
  }, [onWeightAvailability, weightAvailability]);

  /**
   * Stack seats whose disc has not arrived yet (BEDO-021b §17).
   *
   * The runtime commits a disc on the click, so it joins the stack two seconds before the
   * learner sees it get there. Without this the disc would be drawn on its seat *and*
   * flying towards it — the duplicate `BEDO-021 §10` keeps off the rod during an install.
   */
  const inFlightSeats = useMemo(
    () => new Set(ghosts.map((g) => g.seatIndex).filter((i): i is number => i !== undefined)),
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

    // The weight pan, from the rod's own vertices (BEDO-016).
    //
    // This used to be the rod's *crown* — the top of its bounding box — which is the tip
    // of the thin retaining post, 57 mm of model above the plate the discs actually rest
    // on. The pan is the widest thing on the rod, so `measureHolderAnchor` finds the plate
    // itself and returns its top face. `docs/39 §5` has the measured profile.
    const rod = pick(MESH.rod);
    let anchor = rod ? measureHolderAnchor(rod, group) : null;
    if (rod && anchor) {
      // The anchor has to describe the pan **at rest**, because the frame loop adds the
      // live `holderLift` to the stack on top of it. This measurement is taken on mount,
      // before a frame has run, so there is nothing to strip — but stripping it anyway
      // means a future dependency change cannot quietly bake a lifted rod into the anchor
      // and count the same lift twice. `raiseDeflectorGhost` guards its seat the same way.
      const lifted = rod.position.y - baseY(rod, MESH.rod);
      if (lifted !== 0) {
        const [x, y, z] = anchor.surface;
        anchor = { ...anchor, surface: [x, y - lifted, z] };
      }
    }
    setHolderAnchor(anchor);
    // The camera's idea of "the pan" is the same point the discs sit on. No step frames
    // this anchor today, so nothing moves; when one does, it will frame the real plate.
    if (anchor) nextAnchors.pan = [...anchor.surface];

    // What a flying disc has to clear (BEDO-021b §24). The tank gives the footprint — it
    // is the wider of the two — and the shut cover gives the height, so a disc carried
    // between the bench and the pan goes over the lid rather than through the glass.
    const localAabb = (names: string[]) => {
      if (!localBox(names)) return null;
      const lo = group.worldToLocal(tmp.box.min.clone());
      const hi = group.worldToLocal(tmp.box.max.clone());
      // worldToLocal does not preserve which corner is which under a mirrored transform.
      return { min: lo.clone().min(hi), max: lo.clone().max(hi) };
    };
    const tankAabb = localAabb([MESH.tank]);
    const coverAabb = localAabb([MESH.tankCover]);
    setTransferObstacle(
      tankAabb
        ? {
            minX: tankAabb.min.x,
            maxX: tankAabb.max.x,
            minZ: tankAabb.min.z,
            maxZ: tankAabb.max.z,
            topY: Math.max(tankAabb.max.y, coverAabb?.max.y ?? -Infinity),
          }
        : null
    );

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
  }, [scene, groupRef, onAnchors, tmp, modelScale, baseY]);

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
   * vertices — dropping that raw geometry into a mesh at a new position renders it at the
   * wrong place and the wrong size, which is why no weights were ever visible on the pan.
   * Cloning the object keeps its baked transform, and the clone is then *recentred* onto
   * its seat rather than nudged by a delta.
   *
   * ## One space (BEDO-016)
   *
   * Every number below is apparatus-local. The clone is measured DETACHED — a clone has no
   * ancestors, so its bounding box is exactly where it would draw itself if parented at
   * the origin — and `recentreOffset` is the single subtraction that undoes that, leaving
   * the slot group free to sit on the seat `stackSeats` computed from the pan. No axis
   * comes from a node's `position`, which is what used to throw the stack 1.22 m off the
   * holder (`docs/39 §4`).
   *
   * Each entry exposes its `seat` as well as its `recentre`, because the seat is the
   * disc's actual place in the world and everything else — the click proxy, the start of a
   * removal flight — is expressed against it instead of recomputing the geometry.
   */
  const stack = useMemo(() => {
    if (!scene || !holderAnchor) return [];

    // Measure first, place second: a seat depends on the thickness of every disc below it,
    // so the whole stack has to be known before any one of it can be positioned.
    const discs: {
      key: string;
      object: THREE.Object3D;
      /** Where the clone's bounds land when it is parented at the origin. */
      measured: THREE.Vector3;
      thickness: number;
      radius: number;
      index: number;
    }[] = [];

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
      const size = box.getSize(new THREE.Vector3());

      discs.push({
        key: `${idx}-${grams}`,
        object,
        measured: box.getCenter(new THREE.Vector3()),
        thickness: size.y,
        // The discs are circular, so either horizontal extent is the diameter.
        radius: Math.max(size.x, size.z) / 2,
        index: idx,
      });
    });

    const seats = stackSeats(
      holderAnchor,
      discs.map((d) => d.thickness)
    );

    return discs.map((disc, i) => ({
      ...disc,
      /** The disc's centre on the holder. The slot group is parked exactly here. */
      seat: seats[i].centre,
      /** Pulls the baked clone's centre onto its slot's origin. */
      recentre: recentreOffset(disc.measured),
    }));
  }, [scene, pick, holderAnchor, state.loadedWeightsG]);

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
  /**
   * The same list again, for the arrival observer.
   *
   * Two mirrors rather than one, because the two effects both consume the transition and
   * whichever ran second would see no change at all if they shared it.
   */
  const addedFromRef = useRef(state.loadedWeightsG);
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
   * How high this flight has to arc, from the measured tank (BEDO-021b §24).
   *
   * One place, so the disc going on and the disc coming off are carried over the same lid
   * by the same arithmetic. Only weights: a deflector is installed through the *open*
   * cover and goes straight to the rod, exactly as `BEDO-021` shipped it, so it is left
   * alone.
   */
  const arcBetween = useCallback(
    (kind: TransferKind, from: THREE.Vector3, to: THREE.Vector3, radius: number): number =>
      transferObstacle && directionOf(kind)
        ? arcHeightOver([from.x, from.y, from.z], [to.x, to.y, to.z], transferObstacle, radius)
        : 0,
    [transferObstacle]
  );

  /**
   * A flying disc, wrapped so that the wrapper's origin is the disc itself (BEDO-016).
   *
   * The same recentring the stack slots use, so a disc that lifts off the holder is held
   * by the point the learner is looking at rather than by the GLB's distant shared origin
   * — and so a flight's start, its end and the seat it came from are all one arithmetic.
   * The deflector ghosts express this differently, through `restCentre`; both say that a
   * carried part follows the pointer by its centre.
   */
  const weightGhostWrapper = useCallback(
    (entry: (typeof stack)[number]): THREE.Group => {
      const wrapper = new THREE.Group();
      const inner = new THREE.Group();
      inner.position.set(entry.recentre[0], entry.recentre[1], entry.recentre[2]);
      inner.add(cloneFor(entry.object));
      wrapper.add(inner);
      return wrapper;
    },
    [cloneFor]
  );

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
      // Sized from where the flight actually starts, which for a disc the learner dragged
      // is wherever they let go — so a disc already clear of the tank flies straight home.
      ghost.arc = arcBetween(kind, ghost.from, ghost.to, ghost.radius);
      transfers.start(id, kind);
      syncGhosts([...ghostsRef.current]);
    },
    [transfers, syncGhosts, arcBetween]
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
        // The cover is open while a deflector is installed, so it drops straight in.
        arc: 0,
        radius: 0,
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

      const wrapper = weightGhostWrapper(entry);
      const stackLift = weightStackRef.current?.position.y ?? 0;
      wrapper.position.set(entry.seat[0], entry.seat[1] + stackLift, entry.seat[2]);

      const grams = state.loadedWeightsG[index];
      const ghost: Ghost = {
        id: `weight:${index}`,
        wrapper,
        grams,
        from: wrapper.position.clone(),
        // Home is the tray slot this disc was cloned from, which is precisely where its
        // baked geometry already sits — `entry.measured` (`docs/39 §8`).
        to: entry.measured.clone(),
        followsPointer: true,
        liftsWithCover: false,
        // Sized again by `startFlight` once it is known where the disc was let go.
        arc: 0,
        radius: entry.radius,
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
    [
      groupRef,
      weightGhostWrapper,
      syncGhosts,
      state.loadedWeightsG,
      camera,
      dragTmp,
      dragPlane,
    ]
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
    /** The same point, but in world units — what a coordinate assertion actually needs. */
    const world = (local: THREE.Vector3 | readonly [number, number, number] | null) => {
      const group = groupRef.current;
      if (!group || !local) return null;
      const v = Array.isArray(local)
        ? new THREE.Vector3(local[0], local[1], local[2])
        : (local as THREE.Vector3).clone();
      const w = group.localToWorld(v);
      return [w.x, w.y, w.z] as [number, number, number];
    };
    const globals = window as unknown as Record<string, any>;
    globals.__bedoTest = {
      ...globals.__bedoTest,
      /**
       * Dev-only: where the weights are, so a browser test can assert BEDO-021b's two
       * transfers land on the anchors `BEDO-016` measured rather than merely on something.
       *
       * Reports world coordinates, and reports each flight's **destination** as well as its
       * current position — which is the assertion that matters: `§33` asks that a disc
       * flying to the holder is aimed at the stack seat and a disc flying home is aimed at
       * its own tray slot, with no third formula anywhere.
       */
      weightProbe: {
        /** Every loaded disc's seat, and whether it has actually arrived on it. */
        seats: () =>
          stack.map(({ index, seat }) => ({
            index,
            landed: !inFlightSeats.has(index),
            world: world(seat),
          })),
        /** Where a denomination rests on the tray — the anchor a removal flies home to. */
        tray: (mesh: string) => world(localCentreOf(mesh)),
        /** Discs currently in the air: where each one is, and where it is going. */
        flying: () =>
          ghostsRef.current
            .filter((g) => g.grams !== undefined)
            .map((g) => ({
              grams: g.grams,
              toHolder: g.seatIndex !== undefined,
              at: world(g.wrapper.position),
              to: world(g.to),
            })),
      },
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
        // `ghost.to` is the tray slot the disc was cloned from, worked out when it was
        // raised. It used to be the origin, which happened to land the disc back on the
        // tray only because the wrapper carried the clone's whole baked offset.
        startFlight(ghost.id, 'weight-removal', ghost.to, false);
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
   * A disc going *on* to the holder — the other half of BEDO's weight transfer.
   *
   * `Jetforce_Storyboard.pptx` sl. 15, once per denomination: *"When the user clicks on the
   * weight, the weight moves to the tank holder."*; sl. 16 gives the duration, *"in 2
   * seconds"*; and the state machine repeats it as the event on every `Click on the weight`
   * transition (sl. 29, 30, 32). `BEDO-021` built the return leg and left this one out, so
   * a disc simply appeared on the pan. This is the move it should always have made.
   *
   * Watched as a state transition rather than triggered by a handler, exactly as removal
   * is: the tray disc, the panel's `+50g` button and a keyboard activation of that button
   * all change the same runtime state, so all three produce this one transfer and none of
   * them knows an animation exists (`BEDO-021 §22`).
   *
   * The runtime has already committed the disc by the time this runs — the click is what
   * changes the state, and the two seconds are what the learner watches (`docs/40 §4`). So
   * the disc is in `stack` and would be drawn sitting on its seat; `seatIndex` is what
   * keeps that seat empty until it lands.
   *
   * A **layout** effect, so the ghost exists and the seat is emptied in the same commit the
   * runtime's change arrives in. As a passive effect this would run after the browser had
   * already painted one frame of the disc sitting on the pan — the duplicate `§17` forbids,
   * and a very visible one at the frame rates a 26 MB model reaches on a software renderer.
   */
  useLayoutEffect(() => {
    const previous = addedFromRef.current;
    addedFromRef.current = state.loadedWeightsG;

    const index = addedWeightIndex(previous, state.loadedWeightsG);
    if (index === null) return;

    const entry = stack[index];
    const group = groupRef.current;
    if (!entry || !group) return;

    const id = `weight:${index}`;
    if (transfers.has(id) || ghostsRef.current.some((g) => g.id === id)) return;

    const wrapper = weightGhostWrapper(entry);
    // Straight out of the tray slot the disc is cloned from, so it leaves exactly where the
    // learner saw it, and on to the seat BEDO-016 measured. Two anchors, no third opinion.
    const from = entry.measured.clone();
    const to = new THREE.Vector3(entry.seat[0], entry.seat[1], entry.seat[2]);
    wrapper.position.copy(from);

    const ghost: Ghost = {
      id,
      wrapper,
      grams: state.loadedWeightsG[index],
      from,
      to,
      followsPointer: false,
      // The pan rides the cover and the spring, so the destination has to ride with it —
      // added per frame rather than baked in, the way an install already does.
      liftsWithCover: true,
      arc: arcBetween('weight-install', from, to, entry.radius),
      radius: entry.radius,
      seatIndex: index,
      restCentre: new THREE.Vector3(),
    };
    ghostsRef.current = [...ghostsRef.current, ghost];
    setGhosts(ghostsRef.current);
    transfers.start(id, 'weight-install');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loadedWeightsG]);

  /**
   * A disc whose seat stopped existing while it was still flying to it.
   *
   * A reading step ends with `REMOVE_ALL_WEIGHTS` — the lesson tidying the pan between
   * readings — and that can land in the middle of an arrival. The disc would otherwise
   * finish its two seconds and settle onto a pan that has just been emptied.
   *
   * So the flight is abandoned and the disc is put back under the rule that normally
   * governs it, which for a disc that is no longer loaded means back on the tray, at once.
   * `revealAfterFlight` is the same reconciliation a reset uses; nothing here decides where
   * anything goes (`BEDO-021b §15`, §16).
   *
   * A layout effect, and declared between the two observers on purpose: an arrival whose
   * seat has just been taken away is cancelled before anything else looks at the stack, and
   * before the browser paints a frame of a disc still travelling towards a pan that has
   * been emptied.
   */
  useLayoutEffect(() => {
    const stale = ghostsRef.current.filter(
      (g) => g.seatIndex !== undefined && g.seatIndex >= state.loadedWeightsG.length
    );
    if (!stale.length) return;
    for (const ghost of stale) {
      transfers.cancel(ghost.id);
      revealAfterFlight(ghost);
    }
    syncGhosts(ghostsRef.current.filter((g) => !stale.includes(g)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loadedWeightsG]);

  /**
   * The 2D panel's removals, animated the same way.
   *
   * `BEDO-021 §22`: the scene watches the state transition rather than being told by
   * whichever control caused it, so the panel button and the disc in the tank produce the
   * same two-second move without either surface knowing about the animation. The 3D path
   * has already raised its own ghost under this id by the time this runs, so it is left
   * alone.
   *
   * A layout effect for the same reason the arrival is: the disc leaves `loadedWeightsG` at
   * once, and the ghost that carries it has to be on screen in that same commit or the pan
   * is briefly, visibly empty while the disc has not started moving yet.
   */
  useLayoutEffect(() => {
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

    const wrapper = weightGhostWrapper(entry);
    const stackLift = weightStackRef.current?.position.y ?? 0;
    wrapper.position.set(entry.seat[0], entry.seat[1] + stackLift, entry.seat[2]);

    const ghost: Ghost = {
      id,
      wrapper,
      grams: previous[index],
      // Off the seat it was on, back to the tray slot it came from — the same two points
      // the 3D path uses, so the panel button and the disc in the tank fly identically.
      from: wrapper.position.clone(),
      to: entry.measured.clone(),
      followsPointer: false,
      liftsWithCover: false,
      arc: arcBetween('weight-removal', wrapper.position, entry.measured, entry.radius),
      radius: entry.radius,
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
    // The mass actually **on the holder**, which during a transfer is not the whole of what
    // the runtime is carrying: a disc still in the air is not yet pressing on anything.
    //
    // Storyboard sl. 19, on the deflector spring: *"According to the equation of X = hF −
    // hw, the deflector spring moves downward when the weights are **placed on the holder**
    // and moves upward when the weights are **removed from it**."* Placed on, not clicked.
    // So the spring waits for the disc to land, and rises the moment one is lifted off.
    //
    // Presentation only, and deliberately so: `loadedWeightsG` is untouched, so the
    // measured force, the balance window, the readings and the CSV are exactly what they
    // were. This is where the disc is, not what it weighs (`docs/40 §6`).
    const seatedMassG = state.loadedWeightsG.reduce(
      (total, massG, index) => (inFlightSeats.has(index) ? total : total + massG),
      0
    );
    const weightForceN = (seatedMassG * 9.81) / 1000;

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

    // How far the rod — and so the weight pan on top of it — is off its resting height
    // this frame: the plate carries the rod up when it is unscrewed, and the spring moves
    // it again under load.
    //
    // Named once and shared (`docs/39 §8`). The loaded discs are drawn in the apparatus's
    // own space from an anchor measured at rest, so what keeps them on the pan is that
    // they ride *this* number and not a second one that happens to match today. Parenting
    // the stack under the rod would say the same thing, but the rod is a GLB node in a
    // baked model whose origin is nowhere near its geometry; a shared lift on a sibling
    // group is the same arithmetic without re-parenting the asset.
    const holderLift = coverOffsetRef.current + deflection;

    // Central rod and pointer pin move with cover offset and deflection
    const rodObj = pick(MESH.rod);
    if (rodObj) {
      rodObj.position.y = baseY(rodObj, MESH.rod) + holderLift;
    }
    const pinObj = pick(MESH.pointerPin);
    if (pinObj) {
      pinObj.position.y = baseY(pinObj, MESH.pointerPin) + holderLift;
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
        baseY(activeDef, deflector.installed) + holderLift,
        10
      );
    }

    // --- Water ------------------------------------------------------------------
    //
    // Two shapes, because BEDO specifies two (`Jetforce_Storyboard.pptx` sl. 18): the
    // column leaving the nozzle, and the spray leaving the deflector. They had been one
    // object, sized at 95% of the *tank's* diameter — seventeen times the nozzle's bore.
    // See `src/lib/waterJet.ts` and `docs/41`.
    const group = groupRef.current;
    const flowing = state.isPowerOn && state.valveOpening > 0.05 && !state.isCoverOpen;
    const jetFit = waterFit[JET_ASSET];

    if (flowing && group && activeDef && nozzleLip && jetFit && jetGroupRef.current) {
      // Where the water starts and where it lands, both measured: the nozzle's own lip
      // (`setNozzleLip`, the top of the nozzle mesh) and the deflector's underside.
      tmp.box.setFromObject(activeDef);
      tmp.box.getSize(tmp.size);
      tmp.box.getCenter(tmp.defPos);
      tmp.defPos.setY(tmp.box.min.y);
      group.worldToLocal(tmp.defPos);
      const deflectorDiameter = Math.max(tmp.size.x, tmp.size.z) / modelScale;

      tmp.nozzlePos.set(nozzleLip[0], nozzleLip[1], nozzleLip[2]);
      const gap = Math.max(tmp.defPos.y - tmp.nozzlePos.y, 1e-4);

      // The jet climbs out of the nozzle as the valve opens, and reaches the deflector at
      // the same setpoint the plume starts at. Implementation behaviour: no BEDO source
      // describes the startup, only that the water "forms" when the valve is opened.
      const reach = Math.min(1, state.valveOpening / STARTUP_VALVE_OPENING);
      const jet = jetScale(jetFit.width, jetFit.height, gap * reach);

      // On the nozzle axis, not the tank's: X and Z come from the lip, and only Y spans
      // the gap. A jet that started anywhere else would be a magic offset.
      jetGroupRef.current.visible = true;
      jetGroupRef.current.position.set(
        tmp.nozzlePos.x,
        tmp.nozzlePos.y + (gap * reach) / 2,
        tmp.nozzlePos.z
      );
      jetGroupRef.current.scale.set(jet.crossFlow, jet.alongFlow, jet.crossFlow);

      // The plume forms once the jet actually arrives.
      const impacting = state.valveOpening > STARTUP_VALVE_OPENING;
      const plumeFit = waterFit[deflector.water];
      if (impacting && plumeFit && plumeGroupRef.current) {
        const spread = plumeScale(deflectorDiameter, plumeFit.width);
        plumeGroupRef.current.visible = true;
        plumeGroupRef.current.position.set(tmp.defPos.x, tmp.defPos.y, tmp.defPos.z);
        plumeGroupRef.current.scale.setScalar(spread);
      } else if (plumeGroupRef.current) {
        plumeGroupRef.current.visible = false;
      }

      // Ripple faster the harder the jet runs.
      waterTime.current.value = t * (0.6 + state.valveOpening * 1.6);

      (Object.keys(WATER_SHAPES) as WaterShapeKey[]).forEach((key) => {
        const gltf = (water as any)[key];
        if (gltf?.scene) gltf.scene.visible = key === JET_ASSET || key === deflector.water;
      });
    } else {
      if (jetGroupRef.current) jetGroupRef.current.visible = false;
      if (plumeGroupRef.current) plumeGroupRef.current.visible = false;
    }

    // --- Loaded weights ride the pan --------------------------------------------
    // The very same lift the rod above is given, so the stack cannot drift off the plate
    // when the cover is unscrewed or the spring moves under load.
    if (weightStackRef.current) {
      weightStackRef.current.position.set(0, holderLift, 0);
    }

    // A tray disc is out of sight while it is on the holder, and stays out of sight for
    // the two seconds it spends flying either way — otherwise it would be in two places at
    // once for the whole of the trip.
    //
    // Read from `ghostsRef` rather than from the memo the hit test uses, because they are
    // not on the same clock: `loadedWeightsG` drops the moment a removal is accepted, while
    // the ghost that is carrying the disc away only reaches React state on the next render.
    // For one frame the memo would say "not loaded, not carried" and put the tray disc back
    // under a disc that is still on the pan (`BEDO-021b §17`).
    WEIGHTS.forEach((w) => {
      if (!w.mesh) return;
      const meshObj = pick(w.mesh);
      if (!meshObj) return;
      const carried = ghostsRef.current.some((g) => g.grams === w.grams);
      meshObj.visible = !carried && !state.loadedWeightsG.includes(w.grams);
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
          ghost.wrapper.position.y += holderLift * progress;
        }
        // Over the shut tank rather than through it. Zero at both ends, so the disc still
        // leaves its tray slot and lands on its seat at exactly the measured anchors.
        ghost.wrapper.position.y += arcLift(ghost.arc, progress);
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
        {stack.map(({ key, object, seat, recentre, index, thickness, radius }) => (
          // The slot's origin *is* the disc's seat on the pan, so the disc and the target
          // the pointer hits cannot drift apart: one is recentred onto this origin, the
          // other simply sits at it (`docs/39 §7`).
          <group key={key} position={seat} visible={!inFlightSeats.has(index)}>
            <group position={recentre}>
              <primitive object={object} />
            </group>
            {/*
              "Click on the weight on holder — the weight removed from the tank holder in
              2 sec" (Jetforce_Storyboard.pptx sl. 32, state D). An invisible proxy exactly
              like every other hotspot; the disc's own transform, geometry, scale and
              materials are untouched, and nothing is added to the scene while the pan is
              empty.

              A disc, not a sphere. The proxy used to be a sphere whose radius was clamped
              between two hand-picked numbers to stop stacked discs swallowing one another
              — and it sat at the slot's origin while the disc itself was drawn 1.9 m away,
              so the clickable weight and the visible weight were never in the same place
              (`docs/39 §13`). Given the disc's own measured radius and thickness there is
              nothing to tune: the target is the disc's real footprint, it can never reach
              into a neighbour, and it is far easier to hit than the old 6 mm ball.

              The storyboard's gesture is a click, so a click is what this is: a press and
              release under the movement threshold resolves to `activate`. Pulling the disc
              off works too and means exactly the same thing — one intent, two ways to
              express it, and no second policy anywhere (`docs/38 §5`).
            */}
            {/*
              Gone from the tree entirely while the disc is still on its way, rather than
              merely hidden: three.js raycasts invisible objects like any other, so a
              hidden proxy is precisely the invisible-but-clickable target `BUG-19` was.
              An empty seat is not something a learner can take a weight off (§18).
            */}
            {!inFlightSeats.has(index) && (
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
                <cylinderGeometry args={[radius, radius, thickness, 24, 1]} />
                <meshBasicMaterial visible={false} />
              </mesh>
            )}
          </group>
        ))}
      </group>

      {/*
        BEDO's two water objects, drawn separately because the storyboard specifies them
        separately (sl. 18): the column leaving the nozzle, and the spray leaving the
        deflector. They were one group sized at 95% of the tank's diameter — see
        `src/lib/waterJet.ts`.

        Each shape is stood upright if it was authored lying down, then re-centred on its
        own origin, so the group that holds it can simply be parked where the water starts.
      */}
      {(() => {
        const shape = (key: WaterShapeKey) => {
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
        };
        const plumes = (Object.keys(WATER_SHAPES) as WaterShapeKey[]).filter(
          (k) => k !== JET_ASSET
        );
        return (
          <>
            {/* Before impact — parked on the nozzle lip, scaled to the bore. */}
            <group ref={jetGroupRef} visible={false}>
              {shape(JET_ASSET)}
            </group>
            {/* After impact — parked on the deflector, scaled from the deflector. */}
            <group ref={plumeGroupRef} visible={false}>
              {plumes.map(shape)}
            </group>
          </>
        );
      })()}

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
