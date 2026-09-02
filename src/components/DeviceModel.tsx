import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Html, useGLTF } from '@react-three/drei';
import { extendWithKTX2, setKTX2Renderer } from '../lib/ktx2';

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
  FRONT,
  SCREW_LIFT,
  SPRING_REST_HEIGHT_MODEL_UNITS,
  mmToModelUnits,
  powerSwitchTurn,
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
import { NOZZLE_AREA_M2, jetState } from '../domain/physics';
import { attachBoardReadout, type BoardValues } from './boardReadout';
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
  durationOf,
  removedWeightIndex,
  type TransferKind,
} from '../interaction/transfer';
import { arcHeightOver, arcLift, type Obstacle } from '../lib/transferPath';
import {
  JET_ASSET,
  WATER_MODEL_SCALE,
  waterShapeForFlow,
} from '../lib/waterJet';
import {
  RIPPLE_AMPLITUDE,
  RIPPLE_TILES,
  WATER_AMPLITUDE_ATTRIBUTE,
  WATER_FLOW_SENSE,
  WATER_UV_ATTRIBUTE,
  buildWaterUv,
  packPositions,
} from '../lib/waterUv';
import {
  applyFamily,
  applyGlass,
  classifyMaterial,
  neutraliseConductorTint,
} from '../lib/materialFamilies';
import { spindleAxis, spindleCentre } from '../lib/powerSwitch';
import {
  applyCacheFrame,
  createCacheClock,
  prepareCacheMesh,
} from '../lib/waterCache';
import {
  advanceLevel,
  createTankWaterGeometry,
  measureTankInterior,
  targetLevel,
  type TankInterior,
} from '../lib/tankWater';
import { directionOf } from '../interaction/transfer';
import { useObjectDrag } from './useObjectDrag';
import { assetUrl } from '../lib/assetUrl';

type Action =
  | { kind: 'cover' }
  | { kind: 'deflector'; id: number }
  | { kind: 'weight'; grams: number }
  | { kind: 'power' }
  | { kind: 'flowValve' }
  | { kind: 'volumetricValve' }
  /**
   * The nozzle answers a question rather than taking an instruction.
   *
   * There is one nozzle and nothing to choose about it, so it is deliberately absent from
   * `actionableKeys` and `handleHotspot` does nothing with it: the proxy exists only so
   * the part can name itself and its bore on hover (`docs/48 §BEDO-UX-09`).
   */
  | { kind: 'nozzle' };

/** Lever valves and the rotary switch travel 90°, not multiple revolutions. */
const QUARTER_TURN = Math.PI / 2;

/** The printed wall chart the live values are drawn onto. */
const BOARD_MESH = 'Pitot';

/** Dev switch: draw a labelled grid on the board instead of values, to place the fields. */
const BOARD_CALIBRATE = false;

/** No fitted hit proxy is thinner than this, so a 3 mm disc is still clickable. */
const MIN_HOTSPOT_HALF = 0.01;

/** An invisible proxy placed and sized from a real mesh, so clicks land on the part. */
interface Hotspot {
  key: string;
  position: [number, number, number];
  radius: number;
  /**
   * Measured half-extents, for parts a sphere cannot stand in for.
   *
   * A sphere is sized from the part's *largest* dimension, so around a thin disc it is a
   * ball roughly as wide as the disc is across — and the tray's five discs are a row that
   * recedes almost straight away from the camera (their centres differ by 0.0847 local in
   * x but only ~11 px on screen). The spheres never overlap each other, but the *view ray*
   * aimed at a far disc passes well inside the nearer discs' spheres, and the raycaster
   * returns the nearest hit. Measured: 50 g, 100 g and 200 g were unreachable and 500 g
   * answered for the whole stack (`docs/48 §BEDO-UX-09`).
   *
   * A box hugging the disc is thin along the axis that separates them, so it cannot stand
   * in front of its neighbours — the same reason `DropRegion` is measured boxes and not
   * spheres.
   */
  half?: [number, number, number];
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
/**
 * The head of the apparatus, as bounds rather than a point.
 *
 * A point is enough to aim at; fitting a group of parts into a viewport needs its size
 * too. In model space, so the camera rig can convert it with the apparatus group's own
 * matrix rather than assuming a scale.
 */
export interface InstallFraming {
  center: [number, number, number];
  radius: number;
}

/**
 * One deflector transfer, as the camera needs to see it.
 *
 * Plain numbers in apparatus/model space — no three.js objects cross this boundary, so the
 * camera cannot reach into the scene graph and nothing here can be mutated from outside.
 * `from` and `to` are absolute positions, not the displacements the ghost stores
 * internally, and `to` carries the live cover lift because that is where the disc actually
 * lands while the plate is up.
 */
export interface DeflectorFlight {
  from: [number, number, number];
  to: [number, number, number];
  /** How long the move takes. BEDO's two seconds. */
  seconds: number;
}

export interface WeightAvailability {
  readonly canAdd: boolean;
  readonly canRemove: boolean;
}

interface DeviceModelProps {
  state: SimulationView;
  /** Only the hover labels need it; nothing about the framing or the physics does. */
  isArabic: boolean;
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
  /**
   * The bounds the camera should settle on once a deflector is installed, in model space.
   * Null while the model has not been measured. See `src/lib/cameraFraming.ts`.
   */
  onInstallFraming: (framing: InstallFraming | null) => void;
  /**
   * Fired the instant a tray-to-rod deflector transfer begins, from whichever surface
   * started it. The camera travels with the disc rather than waiting for it (`docs/44 §D3`).
   */
  onDeflectorInstallStart: (flight: DeflectorFlight) => void;
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

/**
 * The single colour for learner-facing guidance.
 *
 * The reference experience marks the part a step is about in yellow. The glow used a blue
 * `#1e7fd6`, which on the red flow-valve handle composited to magenta and did not read as
 * "look here" at all; the guide arrow was already amber. One token now drives both, so a
 * cue cannot drift from the other by editing one site.
 *
 * Presentation only — nothing about which target is chosen changes.
 */
const GUIDANCE_HIGHLIGHT = '#ffc233';

export const DeviceModel: React.FC<DeviceModelProps> = ({
  state,
  isArabic,
  lesson,
  focusTarget,
  groupRef,
  anchors,
  onAnchors,
  onCoverClick,
  onSelectDeflector,
  onInstallFraming,
  onDeflectorInstallStart,
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
  // PERF-04 candidate: `?glb=v3` selects the KHR_texture_basisu build. The KTX2 loader is
  // attached only here — the eight WaterShapes GLBs carry no textures.
  const { scene } = useGLTF(assetUrl('Bedo_baked_v2.glb'), true, true, extendWithKTX2) as any;
  /** Declared here because the material pass below needs the GPU's anisotropy limit. */
  const gl = useThree((three) => three.gl);
  setKTX2Renderer(gl);

  // One simulated plume per deflector, plus the startup trickle.
  const water = {
    low: useGLTF(assetUrl(WATER_SHAPES.low.url)) as any,
    d30: useGLTF(assetUrl(WATER_SHAPES.d30.url)) as any,
    d45: useGLTF(assetUrl(WATER_SHAPES.d45.url)) as any,
    d60: useGLTF(assetUrl(WATER_SHAPES.d60.url)) as any,
    d90: useGLTF(assetUrl(WATER_SHAPES.d90.url)) as any,
    d120: useGLTF(assetUrl(WATER_SHAPES.d120.url)) as any,
    d135: useGLTF(assetUrl(WATER_SHAPES.d135.url)) as any,
    d180: useGLTF(assetUrl(WATER_SHAPES.d180.url)) as any,
  };
  const waterGltfs = Object.values(water);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  /**
   * Which part is naming itself right now.
   *
   * Deliberately not `hoveredKey`: that one drives the glow and so must stay restricted to
   * parts the gate would accept, or a refused control would light up as if it were live
   * (`BEDO-020 §24`). A label makes no such promise — the nozzle is never actionable and
   * still has to be able to say what it is.
   */
  const [labelledKey, setLabelledKey] = useState<string | null>(null);

  /**
   * The board is *covering* the apparatus, not merely open.
   *
   * These suppressions were written when the software board was a fullscreen overlay:
   * with the rig invisible, highlighting a part or pointing an arrow at it was pointless.
   * A docked board leaves the apparatus on screen and in use — the learner is meant to
   * click the very discs this gate was hiding — so the affordances follow whether the
   * scene is actually covered, not whether the board exists. `BEDO-UX-12C`.
   *
   * Hit-testing is untouched: a hotspot's geometry and its click path never consulted
   * this, which is why clicks already worked while docked; what was missing was the
   * cursor, the glow and the guide arrow.
   */
  const sceneHidden = state.showMonitor && state.monitorExpanded;
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  /** Meshes currently carrying a highlight material, so they can be put back. */
  const highlighted = useRef<Set<string>>(new Set());
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
  /**
   * One clock per water object, because BEDO specifies the two shapes separately and they
   * start at different moments: the column forms when the water starts flowing, the spray
   * forms when that column reaches the deflector. See `src/lib/waterCache.ts`.
   */
  const jetClock = useRef(createCacheClock());
  const plumeClock = useRef(createCacheClock());
  /** The measured tank interior the procedural tank water is built in. */
  const [tankInterior, setTankInterior] = useState<TankInterior | null>(null);

  // Held in refs so the shader keeps one uniform object for its lifetime: the interior is
  // measured after the model loads, which is later than the material is created.
  const tankHeightUniform = useRef({ value: 1 });
  const tankRadiusUniform = useRef({ value: 1 });
  // How full the tank is, and how hard water is arriving. Both are *read* from the fill
  // simulation, never written to it — the level is the same number that already drives the
  // mesh scale, and the inflow the same one that already picks the target level. The
  // surface optics need them to know real depth from fractional depth, and calm from
  // agitated. See the free-surface block in `tankWaterMaterial`.
  const tankLevelUniform = useRef({ value: 0 });
  const tankInflowUniform = useRef({ value: 0 });

  /**
   * World height of the tank's free surface, for the *jet* material to read.
   *
   * The tank body and the authored plume are two separate meshes that occupy the same
   * glass, and each was drawing its own free surface: once the tank filled past the plume's
   * crown the frame showed the tank's waterline near the cover **and** the plume's own foam
   * band a third of the way down, with clear water between them — two stacked surfaces in
   * one vessel (BEDO-WATER-07 defect B, measured in `water-surfaces.spec.ts`).
   *
   * A submerged body has no free surface: the foam, the crest glint and the surface-opacity
   * lift all belong to water meeting air, and below the waterline there is no air to meet.
   * So the jet shader fades those cues out under this height and the plume becomes part of
   * the one volume instead of a second one inside it.
   *
   * Presentation only, and strictly downstream: it is the level the tank mesh was *just*
   * given this frame, converted to world units. Nothing reads it back, no equation sees it,
   * and the plume's geometry, scale, morph playback and visibility are untouched.
   *
   * Parked below the rig when the tank is empty, so nothing is ever considered submerged.
   */
  const waterlineUniform = useRef({ value: -1e9 });
  const tankWaterRef = useRef<THREE.Mesh>(null);
  /** How full the tank is, 0..1 of its interior height. Presentation only. */
  const tankLevel = useRef(0);
  /**
   * The power switch's spindle, in the space its pivot lives in, derived from the asset
   * once at install. Null until then. See `src/lib/powerSwitch.ts`.
   */
  const powerSpindle = useRef<THREE.Vector3 | null>(null);
  /** Dev-only: the last deflector flight handed to the camera, for the camera probe. */
  const lastFlightRef = useRef<DeflectorFlight | null>(null);
  /** Dev-only: the bounds the install framing was derived from, for the camera probe. */
  const headFramingRef = useRef<{ min: THREE.Vector3; max: THREE.Vector3 } | null>(null);
  /** The single animated scalar the knob's whole orientation is rebuilt from. */
  const powerTurn = useRef(0);
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
      // Where the tank's free surface has got to, in world units, for the jet material.
      tankSurfacePos: new THREE.Vector3(),
      tankSurfaceScale: new THREE.Vector3(),
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

  // Materials, shadows, visibility.
  //
  // This used to force `castShadow` and `receiveShadow` on every one of the 209 meshes and
  // stamp one `envMapIntensity` over all 89 materials, then replace the tank cover outright
  // with near-invisible glass. All three are gone: shadows are now selective, materials get
  // the response their family actually has (`src/lib/materialFamilies.ts`), and the cover
  // keeps its authored look.
  //
  // LIQUID001 and the mounted deflectors start hidden; everything else is forced visible,
  // since several parts ship hidden in the GLB.
  useEffect(() => {
    if (!scene) return;
    // Capped at 8: the jump from 1 is what matters, and the last doublings cost bandwidth
    // for a difference nobody sees at training distances.
    const maxAnisotropy = Math.min(8, gl?.capabilities?.getMaxAnisotropy?.() ?? 1);
    // child.name is already sanitised by the loader, so compare against sanitised names.
    const mounted = new Set(DEFLECTORS.map((d) => gltfName(d.installed)));
    const liquidName = gltfName(MESH.liquid);

    // Only things that move, or that the learner brings close to the camera, are worth a
    // real-time shadow. Everything else is a static room surface whose lighting is already
    // baked into its albedo — a dynamic shadow there is cost with nothing to show for it.
    const casters = new Set<string>([
      gltfName(MESH.tankCover),
      gltfName(MESH.rod),
      gltfName(MESH.screws),
      gltfName(MESH.pointer),
      gltfName(MESH.spring),
      ...DEFLECTORS.map((d) => gltfName(d.installed)),
      ...DEFLECTORS.map((d) => gltfName(d.shelf)),
      ...WEIGHTS.filter((w) => w.mesh).map((w) => gltfName(w.mesh!)),
    ]);

    // The room casts too, and that is the whole mechanism behind the window light.
    //
    // The sun sits outside the building. Without the shell in the caster set it simply passes
    // through the walls and lights every surface equally, which is what the scene looked like
    // before: no beam, no mullion bars, no protected shade. With the shell casting, the wall
    // occludes the sun everywhere except the aperture and the architecture shapes the light by
    // itself — nothing has to be painted in.
    //
    // Still selective, not a blanket pass. These are the surfaces that bound the room or sit
    // in the window's path; the other ~170 meshes are small parts inside the apparatus whose
    // self-shadowing the key light already handles.
    const roomShadow = (name: string) =>
      /^(Walls_1st_Level|WALLS_INTERNAL_PARTITIONING|window_frame_|ALuminum_Frame|Floor_1st_Floor|Skirting_1st_Floor|White_Board_|Desks)/.test(
        name
      );
    // The floor is the surface the beam actually lands on, so it receives and never casts —
    // a ground plane casting into its own shadow map only costs texels and acne.
    const floorName = 'Plane001_Baked';

    scene.traverse((child: any) => {
      if (!child.isMesh) return;

      child.castShadow = casters.has(child.name) || roomShadow(child.name);
      child.receiveShadow =
        casters.has(child.name) ||
        child.name === gltfName(MESH.tank) ||
        child.name === floorName ||
        roomShadow(child.name);

      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        if (!material) continue;

        // Anisotropic filtering, where it actually buys something: colour maps seen at
        // grazing angles — the floor, the bench top, the panel labels — go to mush with the
        // isotropic default, and every texture in this model was sitting at 1 despite the
        // GPU offering 16. Data maps are left alone: normals and roughness are sampled for
        // their values, not their legibility, and filtering them wider only blurs the
        // surface response.
        const colourMap = (material as THREE.MeshStandardMaterial).map;
        if (colourMap && colourMap.anisotropy < maxAnisotropy) {
          colourMap.anisotropy = maxAnisotropy;
          colourMap.needsUpdate = true;
        }
        const family = classifyMaterial(material);
        if (family === 'glass') {
          applyGlass(material, {
            roughness: glassRoughness,
            ior: glassIor,
            envScale: reflection,
            specularIntensity: glassSpecular,
          });
        } else {
          applyFamily(material, family, reflection);
        }
        // A conductor's base colour is the colour of its reflection, so a map with a cast
        // in it tints every highlight the surface makes. See `neutraliseConductorTint`.
        if (family === 'exposedMetal') neutraliseConductorTint(material);
      }

      child.visible = child.name !== liquidName && !mounted.has(child.name);
    });
  }, [scene, gl, reflection, glassSpecular, glassRoughness, glassIor]);

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
   * How hard the water is being driven, 0..1, for the material to read.
   *
   * Presentation only, and read-only with respect to the simulation: it is the valve
   * opening the learner has already set, zeroed when nothing is flowing. Aeration, ripple
   * strength and impact roughness are all state-dependent per the brief, and a uniform is
   * how a shared material learns that without any per-frame React state.
   */
  const waterFlow = useRef({ value: 0 });

  /**
   * Tileable animated-water texture, generated at runtime — the project ships none.
   *
   * One RGBA map carries everything: RG is the surface normal of a fractal ripple field,
   * B its height. Built on a periodic lattice so it wraps seamlessly, because the shader
   * scrolls two copies of it forever.
   */
  const waterTex = useMemo(() => {
    const N = 256;
    // Seeded, not `Math.random`. Unseeded, the ripple field was rebuilt differently on every
    // page load, so no two sessions showed the same water and no two captures of the same
    // build could be compared — which is what made the visual harness unable to attribute a
    // difference to the build. The field's character is unchanged; only its reproducibility
    // is.
    let seedState = 0x9e3779b9;
    const random = () => {
      seedState = (seedState + 0x6d2b79f5) >>> 0;
      let t = seedState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const lattice = (period: number) => {
      const g = new Float32Array(period * period);
      for (let i = 0; i < g.length; i++) g[i] = random();
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
    // Data, not colour. The channels are a height/gradient field the shader does arithmetic
    // on, so they must reach it as authored — decoding them as sRGB would bend the ripple's
    // response. three.js already defaults a CanvasTexture to NoColorSpace; saying so makes
    // it survive a change of default and records the decision (`docs/43 §12`).
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }, []);

  const waterMaterial = useMemo(() => {
    // Water, and not a coloured mesh (BEDO-WATER-03).
    //
    // ## What the previous settings actually rendered
    //
    // Measured, not recalled: `scripts/render/water-review.mjs` photographs each state from
    // three azimuths. Every plume came back as a near-white milky solid filling the glass —
    // no visible surface motion, no highlight travel, no aeration, and no gradient across the
    // body. The two complaints in the brief are one defect seen twice.
    //
    // Three things produced it, and all three are fixed here.
    //
    //  1. **The body colour was a paint pass, not an optical one.** The fragment stage ended
    //     with `mix(lit, deep, 0.60 + depth * 0.34)`, so between 60 % and 83 % of the lit
    //     colour was replaced by one constant. Whatever the lighting did, the result was
    //     that constant plus a fifth of a highlight. That is the definition of a flat mesh.
    //
    //  2. **Its one gradient ran the wrong way.** `depth` came from `vRise`, which is
    //     distance *along* the flow axis. Every horizontal slice of the column therefore had
    //     one single value across its whole width: from the nozzle to the deflector the body
    //     shaded, and across its 170 mm diameter it did not shade at all. A round column with
    //     no cross-sectional gradient photographs exactly like a flat ribbon, which is why
    //     the shape reads as squashed in depth even though it is measurably round (see
    //     `tests/unit/water-shape.spec.ts`: X and Z agree to 0.08 % on all seven
    //     axisymmetric shapes, and every node in the transform chain is uniformly scaled).
    //
    //  3. **The ripple could not be seen.** The vertex displacement was 0.022 *object* units
    //     on bodies 17 to 28 units long — one tenth of one per cent — and it displaced along
    //     fixed x and z, which for five of the eight shapes is partly along the flow rather
    //     than across it.
    //
    // ## What replaces it
    //
    // Absorption instead of tinting. The lit colour is carried through Beer-Lambert
    // extinction over a path length taken from `abs(dot(N, V))` — the eye looks through the
    // most water where it faces the surface square on and through almost none at the
    // silhouette. That gives the body a gradient *across* itself, makes the rim thin and
    // bright and the core deep, and pins the colour to water's own absorption ratio however
    // bright the room gets: no amount of environment can turn it white, because white light
    // through 1.35 units of water is blue-grey by construction.
    //
    // #48628c stays, as §8 asks — it is the albedo the absorption acts on, and the settled
    // core still lands on the recording's rgb(83, 90, 111). What changes is that it is no
    // longer the answer on its own.
    const mat = new THREE.MeshPhysicalMaterial({
      // The approved base presentation, kept: rgb(72, 98, 140).
      color: new THREE.Color('#48628c'),
      transparent: true,
      // Lower than the 0.86 this held, because alpha is no longer one number for the whole
      // body: the shader drives it from the same path length the colour uses, so the core
      // ends up *more* opaque than 0.86 and the silhouette considerably less. A single high
      // value is what made the previous body read as a solid.
      opacity: 0.56,
      // Clean water is smooth, but not mirror-smooth here. These are splash meshes of 663
      // to 1,922 vertices with long thin triangles, and at 0.13 the interpolated normals
      // drew hard white striations along every one of them. 0.20 keeps the sheen and lets
      // the striations read as flow rather than as scratches; the impact region is
      // roughened further in the shader, which is where the aeration actually is.
      roughness: 0.20,
      metalness: 0.0,
      // No transmission, deliberately — unchanged, and for the reason recorded at BEDO-UX:
      // three's transmission resolve rendered the geometry behind the water as hard-edged
      // axis-aligned blocks inside the approved glass, and cost 79 draw calls and 31,428
      // triangles re-rendering every opaque object. The translucency is carried by the
      // absorption below, where it can be controlled. `ior` still sets the dielectric F0.
      ior: 1.33,
      // Raised, but no longer able to whiten the body: every specular term now lands
      // *before* absorption is applied to the diffuse path and is itself Fresnel-weighted,
      // so it brightens the rim and the crests and leaves the core alone. The earlier cuts
      // to 0.08 / 0.18 / 0.45 were the right answer to a stage that mixed toward white with
      // no absorption to hold the colour; that stage is gone.
      clearcoat: 0.26,
      clearcoatRoughness: 0.24,
      specularIntensity: 0.60,
      envMapIntensity: 0.70,
      // Nearly off. An emissive floor is unlit by definition, so it is a constant added to
      // every fragment — the one thing a body that already reads flat does not need.
      emissive: new THREE.Color('#0d2136'),
      emissiveIntensity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Two copies of one tileable ripple map drift across the surface at different scales and
    // speeds. Their gradients bend the shading normal, so highlights and the environment
    // reflection travel; their heights drive the glint and the aeration mask.
    //
    // Sampled on the water's own cylindrical coordinate (`src/lib/waterUv.ts`), not in world
    // space, so the pattern is welded to the water and wraps around the column.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = waterTime.current;
      shader.uniforms.uFlow = waterFlow.current;
      shader.uniforms.uWaterline = waterlineUniform.current;
      shader.uniforms.uWaterTex = { value: waterTex };

      const tiles = {
        a: `vec2(${RIPPLE_TILES.normal.around.toFixed(1)}, ${RIPPLE_TILES.normal.along.toFixed(1)})`,
        b: `vec2(${RIPPLE_TILES.highlight.around.toFixed(1)}, ${RIPPLE_TILES.highlight.along.toFixed(1)})`,
        c: `vec2(${RIPPLE_TILES.detail.around.toFixed(1)}, ${RIPPLE_TILES.detail.along.toFixed(1)})`,
      };

      shader.vertexShader =
        'uniform float uTime;\nuniform float uFlow;\n' +
        'attribute vec2 aWaterUv;\nattribute float aWaterAmp;\n' +
        'varying float vRise;\nvarying float vFlow;\nvarying vec2 vWaterUv;\n' +
        'varying vec3 vWPos;\nvarying vec3 vWNorm;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // Along the surface normal, and scaled by this shape's own cross-section, so one
           // amplitude reads the same on a 51 mm column and a 170 mm plume. objectNormal
           // is available here: beginnormal_vertex and morphnormal_vertex both run before
           // begin_vertex, so it is already the morph-adjusted normal.
           //
           // Two waves at coprime rates, so nothing repeats visibly. The angular term is
           // multiplied by whole turns of 2*PI, which is what keeps the wave continuous
           // across the seam where aWaterUv.x wraps from 1 back to 0.
           //
           // Both rates are kept low on purpose. These meshes carry 663 to 1,922 vertices;
           // a wave the ring of vertices around the rim cannot sample turns into a sawtooth
           // of facets rather than a ripple, which is exactly what one and two turns per
           // revolution avoid and what four did not.
           // Magnitude and direction ride in one attribute — see WATER_AMPLITUDE_ATTRIBUTE.
           float sense = sign(aWaterAmp);
           float rise = aWaterUv.y;
           float amp = abs(aWaterAmp) * ${RIPPLE_AMPLITUDE.toFixed(3)}
                     * (0.30 + 0.70 * rise) * (0.45 + 0.55 * uFlow);
           // A crest of sin(N*rise + phi) sits where N*rise + phi is constant, so it travels
           // toward increasing rise only while phi decreases: the phase has to carry -sense,
           // or the vertex wave runs against the scroll below rather than with it. It did.
           float wave = sin(rise * 6.0 + aWaterUv.x * 6.283 - sense * uTime * 2.1)
                      + 0.55 * sin(rise * 11.0 - aWaterUv.x * 12.566 - sense * uTime * 3.3);
           transformed += objectNormal * (wave * amp);
           vRise = rise;
           vFlow = sense;
           vWaterUv = aWaterUv;`
        )
        // The world position the optics need has to be read *after* the morph cache has
        // moved the vertex, or the view vector would describe the settled pose throughout
        // the 1.15 s the water is still growing. `<begin_vertex>` runs before
        // `<morphtarget_vertex>`, so it cannot be computed alongside the ripple above.
        .replace(
          '#include <morphtarget_vertex>',
          `#include <morphtarget_vertex>
           vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vWNorm = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader =
        'uniform float uTime;\nuniform float uFlow;\nuniform float uWaterline;\n' +
        'uniform sampler2D uWaterTex;\n' +
        'varying float vRise;\nvarying float vFlow;\nvarying vec2 vWaterUv;\n' +
        'varying vec3 vWPos;\nvarying vec3 vWNorm;\n' +
        shader.fragmentShader
          // Clean water is smooth; aerated water is not. Roughening the last fifth of the
          // flow axis is what makes the impact region scatter rather than mirror, and it is
          // the same region the foam mask below whitens — one physical story, told twice.
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             roughnessFactor = mix(roughnessFactor, 0.55,
               smoothstep(0.74, 1.0, vRise) * clamp(uFlow * 1.6, 0.0, 1.0));`
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
             {
               // Two ripple layers on the water's own surface. x wraps around the body, y
               // runs along the flow, and both vary — which is the correction the world-space
               // projection this replaces could not make: across a narrow cross-section xz
               // barely changes, so its lookup collapsed to a function of height and drew
               // stripes (docs/43).
               // The v offset carries the shape's own flow sense: a sample coordinate of
               // v*N - r*t puts a fixed feature at v = (c + r*t)/N, so it climbs toward the
               // deflector — right for the column, backwards for every plume running off one.
               vec2 uvA = vWaterUv * ${tiles.a} + vec2(uTime * 0.10, -vFlow * uTime * 0.55);
               vec2 uvB = vWaterUv * ${tiles.b} + vec2(-uTime * 0.07, -vFlow * uTime * 0.85);
               vec2 uvC = vWaterUv * ${tiles.c} + vec2(uTime * 0.16, -vFlow * uTime * 1.25);
               vec2 grad = (texture2D(uWaterTex, uvA).rg - 0.5) * 0.55
                         + (texture2D(uWaterTex, uvB).rg - 0.5) * 0.65
                         + (texture2D(uWaterTex, uvC).rg - 0.5) * 0.45;
               // A tangent frame built from the surface itself, so the perturbation is
               // across the surface whichever way the shape is oriented. The world-space
               // (x, ., z) vector this replaces assumed a roughly horizontal surface and
               // therefore did almost nothing on a vertical column.
               vec3 nW = normalize(vWNorm);
               vec3 tW = normalize(cross(nW, abs(nW.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
               vec3 bW = cross(nW, tW);
               vec3 bump = (viewMatrix * vec4(tW * grad.x + bW * grad.y, 0.0)).xyz;
               // Stronger where the flow is stronger, so a barely-open valve gives a calm
               // surface and a full one gives a broken one.
               //
               // Kept modest for a measured reason. A shading normal scattered far off the
               // surface's own catches the room environment from every direction at once,
               // and on a body this smooth that averages to a milky white haze rather than
               // to ripple: at 0.40 with three full-strength gradient layers the plume came
               // back as cloud. The three layers give the *pattern*; this decides how much
               // of it the lighting is allowed to believe.
               normal = normalize(normal + bump * (0.26 + 0.34 * clamp(uFlow * 1.6, 0.0, 1.0)));
             }`
          )
          .replace(
            '#include <opaque_fragment>',
            `#include <opaque_fragment>
             {
               vec3 V = normalize(cameraPosition - vWPos);
               vec3 N = normalize(vWNorm);
               float cosView = clamp(abs(dot(N, V)), 0.0, 1.0);
               float flow = clamp(uFlow * 1.6, 0.0, 1.0);

               // How far under the tank's free surface this fragment sits, 0..1.
               //
               // The band is deliberately wide — about 90 mm of world height, a fifth of the
               // tank's interior. A narrow one is worse than none: at +/-4 mm the cues
               // switched off across six pixels and measured as a single 27.8-level step
               // down the column, trading the old soft double band (8.8 and 7.3 levels) for
               // one hard line. Surface agitation dies away with depth rather than stopping,
               // so fading it over a real depth is both the softer and the truer answer.
               //
               // uWaterline is parked far below the rig while the tank is empty, so this is
               // 0 for the whole plume until the tank actually holds water.
               float submerged = smoothstep(uWaterline + 0.045, uWaterline - 0.045, vWPos.y);

               vec2 hUvA = vWaterUv * ${tiles.a} + vec2(uTime * 0.13, -vFlow * uTime * 0.70);
               vec2 hUvB = vWaterUv * ${tiles.b} + vec2(-uTime * 0.09, -vFlow * uTime * 0.95);
               vec2 hUvC = vWaterUv * ${tiles.c} + vec2(uTime * 0.18, -vFlow * uTime * 1.30);
               float hTop = texture2D(uWaterTex, hUvA).b;
               float hSide = texture2D(uWaterTex, hUvB).b;
               float hFine = texture2D(uWaterTex, hUvC).b;
               float crest = hTop * 0.38 + hSide * 0.32 + hFine * 0.30;

               // 1. How much water the eye is looking through.
               //
               // For a closed body the path is longest where the surface faces the camera
               // and vanishes at the silhouette, so this varies **across** the shape — the
               // axis the term it replaces had nothing on. A little more of it further from
               // the nozzle, where the flow has thickened.
               float thick = pow(cosView, 0.75);
               float along = 1.0 - exp(-vRise * 0.9);
               // The 0.16 floor is not a fudge: a fragment at the silhouette is still
               // looking through *some* water, and without it the thin upper surfaces
               // absorbed nothing at all and composited as a colourless film over whatever
               // was behind them. Measured across the six states, the top band came back at
               // luminance 137 and saturation 0.11 — milk — while the body it belonged to
               // sat at 93 and 0.27.
               // Surface relief changes how much water the eye looks through, so the crest
               // field belongs in the path length and not only in the highlight. This is the
               // one motion term that acts on a surface facing the camera square on, where
               // Fresnel is 0.02 and every specular cue is nearly switched off.
               float relief = (crest - 0.5) * 2.0;
               float path = clamp((0.16 + 0.84 * thick) * (0.60 + 0.40 * along), 0.0, 1.0)
                          * 1.55 * (1.0 + 0.20 * relief * flow);

               // 2. Beer-Lambert, at water's own ratio: red is absorbed roughly four times
               // faster than blue, which is the whole reason deep water is blue and a
               // glassful is not. This is what holds the colour: white light through this
               // much water arrives blue-grey whatever the room does, so the body can carry
               // a real specular response without going white the way it did before.
               vec3 absorb = exp(-vec3(2.95, 1.50, 0.74) * path);
               vec3 scattered = vec3(0.016, 0.042, 0.070);
               gl_FragColor.rgb = gl_FragColor.rgb * absorb + scattered * (1.0 - absorb);

               // 3. Fresnel. Water reflects 2 % face-on and everything at grazing — the
               // reason a glass of water is transparent looking down and a mirror looking
               // along. Schlick, honest at F0 and scaled back at the top end, because a
               // full-strength edge on a 170 mm plume reads as a chrome shell.
               float fres = 0.02 + 0.98 * pow(1.0 - cosView, 5.0);
               float edge = fres * 0.42;

               // 4. Contact darkening. Where the water meets glass or steel the light that
               // would have bounced back out is trapped between the two surfaces, and the
               // reference shows a distinctly darker seam at the nozzle collar and again
               // where the flow spreads across the deflector face. Both ends, none of the
               // middle.
               float contact = smoothstep(0.12, 0.0, vRise) + smoothstep(0.88, 1.0, vRise);
               gl_FragColor.rgb *= 1.0 - clamp(contact, 0.0, 1.0) * 0.20;

               // 5. Specular, added rather than mixed.
               //
               // A mix pulls the body *toward* the highlight colour and therefore washes it
               // out; adding leaves the absorbed body underneath intact and puts light on
               // top of it, which is what a wet surface actually does. Weighted by Fresnel
               // so crests light up at grazing angles and stay quiet face-on — the cue that
               // reads as "wet" rather than "pale".
               // The Fresnel weight is what makes a highlight read as wet, but at a floor of
               // 0.20 it also switched the crests off wherever the surface faced the camera —
               // which is most of a cone. Measured with the geometry frozen, the conical plume
               // changed by 0.67 levels per 0.2 s against the flat plate's 2.65, and the low-
               // poly mesh's own static striations dominated what was left. The floor is
               // raised and the grazing end left exactly where it was.
               float glint = smoothstep(0.66, 0.97, crest) * (0.45 + 0.55 * fres);
               // A crest catches the room because it is a water/air boundary; submerged it
               // is a water/water one, where the index step — and so the whole reflection —
               // is gone. The rim term goes the same way for the same reason. Both are only
               // damped, not cut: a little is kept so the plume still reads as a body inside
               // the water rather than dissolving into it.
               float airside = 1.0 - 0.60 * submerged;
               gl_FragColor.rgb += vec3(0.62, 0.74, 0.92)
                                 * (glint * 0.22 + edge * 0.18) * airside;

               // 6. Aeration.
               //
               // Air entrained by the flow, so it belongs only where the flow does work:
               // the impact face at the top, the spreading foot at the bottom, and the
               // thin torn edges of the sheet in between. Gated on the crest field so it
               // moves with the surface rather than sitting on the geometry, and on the
               // valve so a trickle does not foam.
               float impact = smoothstep(0.86, 1.00, vRise);
               float foot = smoothstep(0.14, 0.01, vRise);
               float torn = smoothstep(0.55, 1.0, 1.0 - cosView);
               float churn = smoothstep(0.42, 0.92, crest);
               // Almost entirely gated on the crest field, so the aeration is a moving
               // texture on those regions rather than a band of paint across them. An
               // earlier, flatter version (0.30 + 0.85 * churn over the top 30 %) whitened
               // the upper fifth of every plume wholesale.
               float foam = clamp((impact * 0.95 + foot * 0.55) * (0.08 + 1.05 * churn)
                                  + torn * churn * 0.16, 0.0, 1.0) * flow;
               // Aeration is air carried *into* water at a free surface. Below the tank's
               // waterline the plume is inside the body rather than falling through air, so
               // the entrained white goes with the surface it belonged to. Without this the
               // plume kept a bright foam band a third of the way down a full tank, which is
               // the second "waterline" the frame was reading (BEDO-WATER-07 defect B).
               foam *= 1.0 - submerged;
               gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.78, 0.85, 0.93), foam * 0.45);

               // 7. Opacity, from the same path length as the colour.
               //
               // Thin at the silhouette so the glass and the rod behind read through it,
               // thick through the core so the body has substance, and firmer again where
               // it is aerated — foam is the one part of water you cannot see through.
               // The silhouette lift is what keeps the plume readable against the dark tank
               // *through air*. Submerged, that same lift draws its outline as a distinct
               // second body inside the fill, so it is damped along with the rest — the
               // plume then shows through the tank water at its own depth rather than
               // sitting on top of it as a separate sheet.
               gl_FragColor.a = clamp(
                 gl_FragColor.a * (0.40 + 0.85 * thick)
                   + (edge * 0.22 + foam * 0.30) * airside,
                 0.06,
                 0.97
               );

               // Finally, thin the whole body where it is submerged.
               //
               // Damping only the surface cues left the plume's crown standing as a 27.8-
               // level density step inside the fill — the foam had been masking an edge
               // rather than being it. Two bodies of water in contact have no such step, so
               // the submerged part composites lighter and the tank volume carries the
               // colour there. What survives is a soft change in shade where faster, more
               // aerated water sits inside the standing water, which is what the reference
               // shows; what goes is the hard rim that read as a second surface.
               gl_FragColor.a *= 1.0 - 0.70 * submerged;
             }`
          );
    };
    return mat;
  }, [waterTex]);

  useEffect(() => {
    (Object.values(water) as any[]).forEach((gltf) => {
      // Which way this shape's water runs along its own surface coordinate.
      //
      // All eight caches are fed from the top and grow downward — measured frame by frame in
      // `waterShapeForFlow`'s table: each emerges as a ~10 mm nub at the nozzle, climbs for
      // about a tenth of a second, and then spends the remaining second falling, its floor
      // descending toward the tank while its top stays pinned. `Water_low` was assigned
      // `toward` at BEDO-WATER-04 on the assumption that it was a jet climbing to the plate;
      // the cache says otherwise — its top stops at the nozzle mouth and never reaches the
      // deflector — so it runs `away` like the rest. The sign mechanism stays because it is
      // a property of each cache, not a constant: a re-authored column that did climb to the
      // plate would need `toward`.
      const sense = WATER_FLOW_SENSE.away;
      gltf?.scene?.traverse((child: any) => {
        if (!child.isMesh) return;
        child.material = waterMaterial;
        child.castShadow = false;
        child.receiveShadow = false;

        // Give the mesh the surface coordinate its shader needs, computed from its own
        // vertices. Once, at load — the geometry never changes, only the group it hangs
        // under does, so there is nothing to recompute per frame. See `src/lib/waterUv.ts`
        // for why the authored TEXCOORD channels cannot serve.
        const geometry = child.geometry as THREE.BufferGeometry;
        if (geometry && !geometry.getAttribute(WATER_UV_ATTRIBUTE)) {
          const position = geometry.getAttribute('position');
          if (position) {
            // Through the accessors, never through `.array`: these assets are meshopt-packed
            // and their positions are interleaved four components to a vertex, so the raw
            // buffer is not a list of xyz triples. See `packPositions`.
            const { uv, crossRadius } = buildWaterUv(packPositions(position));
            geometry.setAttribute(WATER_UV_ATTRIBUTE, new THREE.BufferAttribute(uv, 2));
            // The shape's own size in the magnitude and its flow direction in the sign, so
            // one shared material can ripple all eight by the same visible amount and still
            // run each of them the right way — see `WATER_AMPLITUDE_ATTRIBUTE`.
            geometry.setAttribute(
              WATER_AMPLITUDE_ATTRIBUTE,
              new THREE.BufferAttribute(
                new Float32Array(position.count).fill(crossRadius * sense),
                1
              )
            );
          }
        }

        // Which morph target carries which authored frame, read from the asset's own
        // names. Once, at load — see `src/lib/waterCache.ts`.
        prepareCacheMesh(child as THREE.Mesh);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...waterGltfs, waterMaterial]);

  /** Built once from the measured interior; rebuilt only if the model is re-exported. */
  const tankWaterGeometry = useMemo(
    () => (tankInterior ? createTankWaterGeometry(tankInterior) : null),
    [tankInterior]
  );

  /**
   * The tank body's own material.
   *
   * Flatter and more transmissive than the jet: in the reference you read the rod, the
   * nozzle and the deflector straight through it, and its free surface catches light
   * rather than reflecting the room. Depth-write is off so the apparatus inside stays
   * visible from every angle rather than being clipped away.
   */
  const tankWaterMaterial = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      // Darker and more saturated than it looks like it should be, because ACES lifts it.
      // The recording's water reads rgb(103,110,130) just under the surface; a body colour
      // authored at that value renders far brighter than it, since the tone curve's shoulder
      // sits under mid-darks. This is the colour that *arrives* at the reference's value.
      color: new THREE.Color('#38536e'),
      transparent: true,
      // Solved, not guessed. The recording's water just under the surface composites to
      // luminance 109.7 over a background this scene renders at about 155; that needs the
      // body to carry roughly 0.7 of the pixel. At 0.42 the room behind the tank supplied
      // most of it, which is why the volume measured almost achromatic (saturation 0.04
      // against the reference's 0.20) however dark the body colour was made.
      opacity: 0.66,
      roughness: 0.18,
      metalness: 0,
      // No transmission — see the jet material for the measurement. The tank is where the
      // block artifact was worst, because it is the largest area of water with high-contrast
      // apparatus directly behind it.
      ior: 1.33,
      // Was 0.5, which laid a broad achromatic sheet over the whole body and was the main
      // reason the volume read pale and desaturated near the surface — the same mechanism
      // that whitens the splash. The free surface now carries its own explicit reflection,
      // so the body does not need a clearcoat to look wet.
      clearcoat: 0.12,
      clearcoatRoughness: 0.25,
        // As with the jet: authored at 0.5 while the factor was inert, so the validated look
        // is the one at 1.0. See the note on the jet material.
        envMapIntensity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // The same optics as the jet, expressed in the tank's own geometry.
    //
    // A standing body of water reads differently from a falling one, and the two cues that
    // carry it are both spatial: it gets darker with depth, and it darkens where it meets
    // the glass. Neither is available to a uniform translucent cylinder, which is why the
    // filled tank looked like a coloured sleeve rather than a volume.
    //
    // This changes appearance only. The level, the fill and drain rates, the threshold that
    // starts it filling and the geometry itself are all untouched — see `lib/tankWater.ts`,
    // whose numbers are measured off the recording and asserted in tests.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTankHeight = tankHeightUniform.current;
      shader.uniforms.uTankRadius = tankRadiusUniform.current;
      shader.uniforms.uTankLevel = tankLevelUniform.current;
      shader.uniforms.uInflow = tankInflowUniform.current;
      // The jet's clock, not a second one. It is already `t * (0.6 + valveOpening * 1.6)`,
      // so the standing water and the falling water stay in step, and the whole system
      // stays reproducible under the capture harness's virtual clock.
      shader.uniforms.uTime = waterTime.current;
      shader.uniforms.uWaterTex = { value: waterTex };

      shader.vertexShader =
        'varying vec3 vLocal;\nvarying vec3 vTankWPos;\nvarying vec3 vTankWNorm;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // Object space, before the per-frame y scale that raises the level — so "how far
           // below the surface" does not change meaning as the tank fills.
           vLocal = position;
           vTankWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vTankWNorm = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader =
        'uniform float uTankHeight;\nuniform float uTankRadius;\n' +
        'uniform float uTankLevel;\nuniform float uInflow;\nuniform float uTime;\n' +
        'uniform sampler2D uWaterTex;\n' +
        'varying vec3 vLocal;\nvarying vec3 vTankWPos;\nvarying vec3 vTankWNorm;\n' +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
           {
             vec3 V = normalize(cameraPosition - vTankWPos);
             vec3 N = normalize(vTankWNorm);

             // The cylinder's top cap *is* the free surface. Its object normal is the only
             // one pointing up, which separates it from the wall and the floor without
             // needing to know the geometry's group order. Back faces keep the object
             // normal here, so the surface is still the surface seen from underneath.
             float isSurface = smoothstep(0.80, 0.98, N.y);

             // --- Depth (Beer-Lambert) ------------------------------------------------
             // Real depth, not fractional depth. \`vLocal.y\` spans the full interior
             // height and the mesh is scaled by the level, so a fragment sits
             // (uTankHeight - y) * level below the surface. The previous form used the
             // fraction alone, which made a tank at a tenth full exactly as dark at its
             // floor as a full one.
             //
             // Calibrated against the recording, which over the filled column runs
             // luminance 109.7 -> 76.0 and saturation 0.204 -> 0.331: light both fades and
             // *saturates* along the path. The old constants moved luminance a third of
             // that and moved saturation the wrong way, because at a flat 0.42 alpha the
             // bright room behind the tank washed the tint back out. Transmittance drives
             // opacity as well as colour here, which is what stops that happening.
             float depthWorld = max(uTankHeight - vLocal.y, 0.0) * uTankLevel;
             float transmit = exp(-depthWorld * 5.4);
             // Beer-Lambert proper, per channel, rather than a fade toward one "deep"
             // colour. Water absorbs red fastest and blue slowest, and that difference —
             // not a darker tint — is what makes a deep column read blue while a shallow
             // one reads nearly clear. The coefficients are in inverse world units over
             // this tank's 0.317-unit interior.
             //
             // It *replaces* the shaded body rather than tinting it. Measured directly:
             // with alpha forced to 1.0 the lit body still rendered at luminance 135 near
             // the surface, about 2.5x its own albedo, because a smooth dielectric under a
             // 2.4-intensity sun and a room probe is mostly specular. Tinting toward a dark
             // colour barely moved it — the reference's water is transmitted light, so
             // transmitted light is what has to drive it. A fifth of the shaded result is
             // kept so the wall highlights and the grazing rim still live.
             //
             // \`shallow\` is linear and pre-tone-map: ACES at exposure 1.3 lifts mid-darks
             // hard, so the value that *arrives* at the recording's near-surface water is
             // well below the one it looks like it should be.
             // The path is not just the depth. A fragment on the near wall has the whole
             // width of the column behind it, and light reaching the eye crosses that too.
             // Entering along -V from a point on the wall, the ray leaves the cylinder
             // after -2*(p . v) — up to the full 0.169-unit diameter at the axis, nothing
             // at the silhouette. This is why the recording's water is already blue just
             // under the surface, and darker through the middle than near the glass, and
             // omitting it left the shallow water reading as almost clear.
             vec2 travel = normalize(-V.xz + vec2(1e-6, 0.0));
             float chord = clamp(-2.0 * dot(vLocal.xz, travel), 0.0, 2.0 * uTankRadius);

             vec3 shallow = vec3(0.070, 0.092, 0.130);
             vec3 absorb = exp(-(depthWorld + chord) * vec3(5.5, 3.4, 2.0));
             gl_FragColor.rgb = mix(shallow * absorb, gl_FragColor.rgb, 0.18);
             gl_FragColor.a = clamp(mix(0.92, gl_FragColor.a, transmit), 0.0, 0.93);

             // --- Contact darkening ---------------------------------------------------
             // Light entering the meniscus is trapped between water and glass instead of
             // leaving. The recording shows this clearly: the base of the column reads
             // 40.7 luminance below the water just under the surface, and the floor of the
             // tank is the darkest part of the whole vessel.
             float radial = length(vLocal.xz) / max(uTankRadius, 1e-5);
             float wall = smoothstep(0.86, 1.0, radial) * (1.0 - isSurface);
             float floorContact = smoothstep(0.10, 0.0, vLocal.y / max(uTankHeight, 1e-5));
             gl_FragColor.rgb *= 1.0 - clamp(wall * 0.22 + floorContact * 0.30, 0.0, 0.45);

             // --- Free surface --------------------------------------------------------
             // The strongest cue the reference has and the one production was missing
             // outright: walking down through the waterline, the recording falls to a
             // trough and then rebounds +46 luminance into a textured bright band, while
             // production stepped down 30 and stayed dead flat for 55 rows.
             //
             // The band is a reflection of the room, so it is built as one: ripple the
             // surface normal, then take Fresnel against the rippled normal. A flat sheet
             // at these viewing angles returns about 5%, far too little; a rippled one
             // swings roughly 2.4% to 12% across the wave, and that *variation* is what
             // reads as water rather than as a painted line.
             //
             // Both wave trains and the ring term run off the jet's clock, so ripple
             // speed already follows the valve, and amplitude follows inflow — existing
             // simulation state in both cases, never a free-running decoration.
             if (isSurface > 0.001) {
               vec2 sp = vLocal.xz / max(uTankRadius, 1e-5);
               float agitation = 0.28 + 0.72 * clamp(uInflow, 0.0, 1.0);

               // The jet's own ripple map, scrolled twice, rather than a sum of sines.
               // Three sine trains at fixed frequencies in this space beat against each
               // other into a regular dot lattice, which was plainly visible across the
               // surface once the tank drained far enough to be seen from above — a tiled
               // normal map in all but name. The texture is tileable and aperiodic at
               // these scales, and reusing it keeps the standing water and the falling
               // water made of the same material.
               vec2 uvA = sp * 2.6 + vec2(uTime * 0.045, -uTime * 0.030);
               vec2 uvB = sp * 1.7 + vec2(-uTime * 0.028, uTime * 0.052);
               vec2 grad = (texture2D(uWaterTex, uvA).rg - 0.5)
                         + (texture2D(uWaterTex, uvB).rg - 0.5) * 0.8;
               vec3 Nr = normalize(N + vec3(grad.x, 0.0, grad.y) * 0.46 * agitation);
               float cosR = clamp(dot(Nr, V), 0.0, 1.0);
               float F = 0.02 + 0.98 * pow(1.0 - cosR, 5.0);

               // The probe holds the room's albedo rather than its radiance — the same
               // shortfall Stage B.1 compensates elsewhere — so the reflection needs a
               // gain to reach the reference's rebound. 5.2 is where the band matches;
               // see docs/48_WATER_RESPONSE.md.
               vec3 sky = vec3(0.86, 0.90, 0.96);
               // The reflection is bright, but it must not also make the water opaque.
               // Seen along the surface — the drained tank is viewed from about 14 degrees
               // above it — Fresnel alone reaches 0.27, so the mix saturates its ceiling
               // across the whole cap at once and the alpha it used to add on top turned
               // that into a white lid you could not see into. The colour still saturates
               // there, which is correct (water at grazing incidence is a bright sheet),
               // but a deeper ripple keeps variation inside it, and the opacity gain is
               // now small enough that the body stays visible through the surface.
               float spec = isSurface * F * 5.2;
               gl_FragColor.rgb = mix(gl_FragColor.rgb, sky, clamp(spec, 0.0, 0.40));
               gl_FragColor.a = clamp(gl_FragColor.a + clamp(spec, 0.0, 0.22), 0.0, 0.96);

               // Where the surface meets the glass it climbs the wall slightly and catches
               // a thin bright line. Small, but it is what makes the level readable at a
               // glance rather than merely present.
               float meniscus = smoothstep(0.90, 1.0, radial) * isSurface;
               gl_FragColor.rgb = mix(gl_FragColor.rgb, sky, meniscus * 0.30);
               gl_FragColor.a = clamp(gl_FragColor.a + meniscus * 0.22, 0.0, 0.96);
             }
           }`
        );
    };
    return mat;
  }, [tankHeightUniform, tankRadiusUniform, tankLevelUniform, tankInflowUniform, waterTime, waterTex]);


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

    // The power switch gets its hinge from its own geometry, not from a world-aligned box.
    // Its panel is an angled console, so the spindle is 29.45 degrees off every world axis;
    // `Box3.setFromObject` measures the world AABB and its thinnest side misses the face
    // normal by that tilt. Turning the knob about world X tips it 40.69 degrees out of the
    // panel — the defect the deployed build shows. See `src/lib/powerSwitch.ts`.
    const knob = pick(MESH.powerSwitch);
    if (knob) {
      powerSpindle.current = spindleAxis(knob, new THREE.Vector3(...FRONT));
      install(MESH.powerSwitch, spindleCentre(knob));
    }

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
    // The printed board, for the Board view. Measured like every other anchor rather than
    // written down, so a re-export moves the camera with it.
    assign('board', [BOARD_MESH]);

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
    // The tank's own interior, for the procedural water body. Measured off the glass for
    // the bore and off the parts that actually close it for the levels, so a re-exported
    // model changes the water with it rather than needing a constant edited. The glass
    // alone is not enough — it is sunk into the base and hidden under the cover, which is
    // what put the water 23 mm below the floor (BEDO-WATER-01, see `measureTankInterior`).
    const tankMesh = pick(MESH.tank);
    setTankInterior(
      tankMesh
        ? measureTankInterior(tankMesh, (v) => group.worldToLocal(v), {
            floor: pick(MESH.nozzle),
            ceiling: pick(MESH.tankCover),
          })
        : null
    );

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

    // What the camera has to show once a deflector is installed: the disc, the rod it
    // seats on, and the top plate the learner reaches for next (`docs/44 §D5`). Reported
    // as bounds rather than a point, because the destination view is fitted to them rather
    // than authored as an offset — see `src/lib/cameraFraming.ts`.
    //
    // Every deflector's installed mesh is included, not just the selected one, so the
    // framing does not jump between experiments; they all seat in the same place, so the
    // union is barely larger than any one of them.
    const headAabb = localAabb([
      MESH.rod,
      MESH.tankCover,
      ...DEFLECTORS.map((d) => d.installed),
    ]);
    if (headAabb) {
      headFramingRef.current = headAabb;
      // The plate is necessarily up during an install — the tank has to be open — so the
      // framing has to reach where it actually is, not where it rests.
      const max = headAabb.max.clone().setY(headAabb.max.y + COVER_LIFT);
      const centre = headAabb.min.clone().add(max).multiplyScalar(0.5);
      onInstallFraming({
        center: [centre.x, centre.y, centre.z],
        radius: max.distanceTo(headAabb.min) / 2,
      });
    } else {
      onInstallFraming(null);
    }

    onAnchors(nextAnchors);


    const spot = (
      name: string,
      action: Action,
      minRadius: number,
      /** Hug the part instead of ballooning to its longest side — see `Hotspot.half`. */
      fitted = false
    ): Hotspot | null => {
      if (!localBox([name])) return null;
      tmp.box.getCenter(tmp.center);
      tmp.box.getSize(tmp.size);
      const local = group.worldToLocal(tmp.center.clone());
      const worldRadius = Math.max(tmp.size.x, tmp.size.y, tmp.size.z) * 0.6;
      const radius = THREE.MathUtils.clamp(worldRadius / modelScale, minRadius, 0.18);
      if (!fitted) return { key: name, position: [local.x, local.y, local.z], radius, action };
      // Half-extents in the group's own units, floored so a disc only 3 mm thick is still
      // worth aiming at. The floor is well under the 0.0847 that separates two discs, so a
      // fitted proxy stays clear of its neighbours in every axis.
      const half = ([tmp.size.x, tmp.size.y, tmp.size.z] as const).map((v) =>
        Math.max(v / modelScale / 2, MIN_HOTSPOT_HALF)
      ) as [number, number, number];
      return { key: name, position: [local.x, local.y, local.z], radius, half, action };
    };

    const list = [
      spot(MESH.tankCover, { kind: 'cover' }, 0.08),
      spot(MESH.powerSwitch, { kind: 'power' }, 0.04),
      spot(MESH.flowValve, { kind: 'flowValve' }, 0.045),
      spot(MESH.volumetricValve, { kind: 'volumetricValve' }, 0.045),
      ...DEFLECTORS.map((d) => spot(d.shelf, { kind: 'deflector', id: d.id }, 0.022)),
      // Fitted, not spherical: the tray row recedes from the camera, so a ball around one
      // disc sits in front of the discs behind it. See `Hotspot.half`.
      ...WEIGHTS.filter((w) => w.mesh).map((w) =>
        spot(w.mesh!, { kind: 'weight', grams: w.grams }, 0.022, true)
      ),
      // Fitted for the same reason the discs are: it sits inside the tank among parts the
      // learner does aim at, so it must not stand in front of them.
      spot(MESH.nozzle, { kind: 'nozzle' }, 0.02, true),
    ];

    setHotspots(list.filter((h): h is Hotspot => h !== null));
  }, [scene, groupRef, onAnchors, onInstallFraming, tmp, modelScale, baseY]);

  /**
   * Parts the student is invited to touch right now.
   *
   * In free mode that is everything — the state machine lets any control be clicked at
   * any time, and the guards decide. In guided mode it is only what the step asks for,
   * which is what the pulsing highlight and the pointer cursor key off.
   */
  const liveKeys = useMemo<Set<string>>(() => {
    if (sceneHidden) return new Set();

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
  }, [lesson.isGuided, lesson.highlight, sceneHidden]);

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
  /**
   * What a part says when the pointer rests on it.
   *
   * Both labels are derived: the mass comes from `WEIGHTS`, and the bore is computed back
   * out of `NOZZLE_AREA_M2` — the same constant the momentum equations use — so the label
   * cannot drift away from the physics it is describing. Nothing here is a second source
   * of truth for either number.
   */
  const labelFor = useCallback(
    (action: Action): string | null => {
      // `غ` in Arabic, matching the app's own localised mass strings — the removal control
      // says `إزالة ${g} غ` and the balance indicator `الهدف ≈ ${n} غ`. The bare `g`
      // elsewhere is in readouts that are not translated at all.
      if (action.kind === 'weight') return isArabic ? `${action.grams} غ` : `${action.grams} g`;
      if (action.kind === 'nozzle') {
        const boreMm = 2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI) * 1000;
        return isArabic
          ? `الفوهة — قطر ${boreMm.toFixed(0)} مم`
          : `Nozzle — ${boreMm.toFixed(0)} mm bore`;
      }
      return null;
    },
    [isArabic]
  );

  const actionableKeys = useMemo<Set<string>>(() => {
    if (sceneHidden) return new Set();
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
  }, [lesson.available, lesson.selectableDeflectorIds, sceneHidden]);

  /** Whether the gate would accept a weight interaction — drives the discs' cursor. */
  const weightsAreActionable = !sceneHidden && lesson.available.includes('weights');

  /**
   * Where the guide arrow floats — null in free mode, or once the step is satisfied.
   *
   * "Satisfied" is the lesson runner's answer now. This component used to decide it here
   * with its own list of step numbers, while `UIOverlay` decided it separately for the OK
   * button, and the two genuinely disagreed (`CQ-06 #5`). Both read one evaluator now,
   * and each still produces exactly the behaviour it did before.
   */
  const arrowPos = useMemo<[number, number, number] | null>(() => {
    if (sceneHidden || !lesson.isGuided || !focusTarget) return null;
    if (lesson.isSatisfied) return null;

    const anchor = anchors[focusTarget];
    if (!anchor) return null;

    const off = ANCHOR_VIEW[focusTarget]?.arrowOffset ?? DEFAULT_ARROW_OFFSET;
    return [anchor[0] + off[0], anchor[1] + off[1], anchor[2] + off[2]];
  }, [sceneHidden, lesson.isGuided, lesson.isSatisfied, anchors, focusTarget]);

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
      // Labelled, never actuated. See the `nozzle` arm of `Action`.
      case 'nozzle':
        return;
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
  /**
   * The printed board, made live.
   *
   * Attached once, to the board object itself, so the values ride its transform. Fed from
   * the same `state.live` and `state.recordedRows` the software monitor reads — this
   * formats, it derives nothing.
   */
  const boardReadout = useRef<ReturnType<typeof attachBoardReadout>>(null);
  useEffect(() => {
    if (!scene) return;
    boardReadout.current = attachBoardReadout(pick(BOARD_MESH));
    return () => {
      boardReadout.current?.dispose();
      boardReadout.current = null;
    };
  }, [scene, pick]);

  useEffect(() => {
    const installed = getDeflector(state.selectedDeflectorId);
    const values: BoardValues = {
      deflectorAngle: installed.id,
      deflectorName: isArabic ? installed.nameAr : installed.nameEn,
      momentumFactor: installed.momentumFactor,
      nozzleMm: 2 * Math.sqrt(NOZZLE_AREA_M2 / Math.PI) * 1000,
      nozzleAreaM2: NOZZLE_AREA_M2,
      valvePct: state.live.valveOpening * 100,
      flowLMin: state.live.flowRateLMin,
      flowM3S: state.live.flowRateM3S,
      nozzleVelocity: state.live.nozzleVelocityMS,
      impactVelocity: state.live.impactVelocityMS,
      theoreticalForceN: state.live.theoreticalForceN,
      loadedMassG: state.live.loadedMassG,
      measuredForceN: state.live.measuredForceN,
      // Rows 1 and 2 of the printed table are the two student readings; the results
      // array's index 0 is the zero-flow baseline the procedure does not record.
      rows: state.recordedRows.slice(1, 3).map((r) => ({
        // The reading exists once the learner has balanced it — the same test the software
        // board's own row filter uses.
        recorded: r.loadedMassG > 0,
        flowLMin: r.flowRateLMin,
        flowM3S: r.flowRateM3S,
        nozzleVelocity: r.nozzleVelocityMS,
        impactVelocity: r.impactVelocityMS,
        theoreticalForceN: r.theoreticalForceN,
        measuredForceN: state.isCalculated ? r.measuredForceN : null,
      })),
    };
    boardReadout.current?.update(values, { calibrate: BOARD_CALIBRATE });
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__bedoBoard = {
        deflector: `${values.deflectorAngle}° k=${values.momentumFactor.toFixed(3)}`,
        nozzleMm: values.nozzleMm.toFixed(0),
        Q: values.flowLMin.toFixed(3),
        V0: values.nozzleVelocity.toFixed(3),
        V: values.impactVelocity.toFixed(3),
        Fth: values.theoreticalForceN.toFixed(4),
        totalWeightG: values.loadedMassG,
        mg: values.measuredForceN.toFixed(3),
        rows: values.rows.map((r) => (r.recorded ? `${r.flowLMin.toFixed(3)}|Fac=${r.measuredForceN?.toFixed(4) ?? '—'}` : 'blank')),
      };
    }
  }, [state.live, state.recordedRows, state.selectedDeflectorId, state.isCalculated, isArabic]);

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
      // Both surfaces that can install a deflector — the drag and the 2D panel's state
      // change — funnel through here, so this is the one place the camera has to be told.
      //
      // The ghost stores its endpoints as displacements from `restCentre`; the camera is
      // given absolute model-space points, and the destination includes the live cover
      // lift the frame loop adds each tick (`liftsWithCover`).
      if (kind === 'deflector-install') {
        const base = ghost.restCentre;
        lastFlightRef.current = {
          from: [base.x + ghost.from.x, base.y + ghost.from.y, base.z + ghost.from.z],
          to: [
            base.x + ghost.to.x,
            base.y + ghost.to.y + coverOffsetRef.current,
            base.z + ghost.to.z,
          ],
          seconds: durationOf(kind),
        };
        onDeflectorInstallStart({
          from: [base.x + ghost.from.x, base.y + ghost.from.y, base.z + ghost.from.z],
          to: [
            base.x + ghost.to.x,
            base.y + ghost.to.y + coverOffsetRef.current,
            base.z + ghost.to.z,
          ],
          seconds: durationOf(kind),
        });
      }
    },
    [transfers, syncGhosts, arcBetween, onDeflectorInstallStart]
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
      /**
       * What the physical board is currently showing.
       *
       * Dev-only, like the rest of this adapter. The board is a texture, so the browser
       * suite cannot read a value off it the way it reads the DOM — this reports the same
       * numbers that were drawn, which is what makes "the board is live" assertable.
       */
      boardValues: () => (window as unknown as Record<string, unknown>).__bedoBoard ?? null,
      /** Board repaints so far, and what the renderer is doing — for the perf audit. */
      perf: () => ({
        repaints: (window as unknown as Record<string, number>).__bedoBoardRepaints ?? 0,
        calls: gl?.info.render.calls ?? 0,
        triangles: gl?.info.render.triangles ?? 0,
        programs: gl?.info.programs?.length ?? 0,
        textures: gl?.info.memory.textures ?? 0,
        geometries: gl?.info.memory.geometries ?? 0,
      }),
      cameraNow: () => ({
        pos: camera.position.toArray().map((n) => +n.toFixed(3)),
        anchors: Object.keys(anchors),
      }),
      boardAnchor: () => {
        const o = pick(BOARD_MESH) as THREE.Mesh | undefined;
        const g = groupRef.current;
        if (!o || !g) return null;
        o.updateWorldMatrix(true, true);
        const a = o.geometry.attributes.position;
        const w = (i: number) =>
          o.localToWorld(new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)));
        const p0 = w(0), p1 = w(1), p3 = w(3);
        const normal = new THREE.Vector3()
          .crossVectors(p1.clone().sub(p0), p3.clone().sub(p0))
          .normalize();
        const centre = localCentreOf(BOARD_MESH);
        const localNormal = g
          .worldToLocal(p0.clone().add(normal))
          .sub(g.worldToLocal(p0.clone()))
          .normalize();
        return {
          localCentre: centre?.toArray(),
          localNormal: localNormal.toArray(),
          worldNormal: normal.toArray(),
          groupScale: g.scale.toArray(),
        };
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

      /**
       * Dev-only: where the parts the install step hands over to actually are on screen.
       *
       * `docs/44 §D10` asks that the camera follow be validated from **projected
       * visibility**, not from camera coordinates — a camera can be at a perfectly
       * plausible position and still have the rod behind the instructional panel or off
       * the canvas entirely, which is exactly the defect being fixed. So this reports
       * screen points for the three things Step 3 needs, and the region the 2D panel
       * leaves free to judge them against.
       */
      cameraProbe: {
        /**
         * The moving disc, while one is in the air.
         *
         * `wrapper.position` is a **displacement from `restCentre`**, not a position:
         * `onCarry` writes `point.sub(ghost.restCentre)`, and the flight lerps between
         * `from` and `to` in that same space (`to` is `installedCentre.sub(shelfCentre)`),
         * with the cover lift and the arc added on top of it. The disc's apparatus-local
         * position is therefore `restCentre + wrapper.position`, and the wrapper renders
         * correctly because the clone inside it still carries the shelf mesh's own offset.
         *
         * Projecting `wrapper.position` alone reports the apparatus **origin** at the start
         * of a flight — metres from the tray. `weightProbe` gets away with exactly that
         * expression only because weight ghosts are built with `restCentre` at zero.
         */
        flyingDeflector: () => {
          const ghost = ghostsRef.current.find((g) => g.deflectorId !== undefined);
          return ghost ? project(ghost.restCentre.clone().add(ghost.wrapper.position)) : null;
        },
        head: () => ({
          rod: project(localCentreOf(MESH.rod)),
          // No lift is added here. `localCentreOf` measures the object *as it currently
          // stands* (`Box3.setFromObject`), and the frame loop has already put the plate at
          // its lifted height — `lift(MESH.tankCover, coverOffsetRef.current)` writes
          // `position.y` directly. Adding `coverOffsetRef.current` on top counted the lift
          // twice and reported the plate a whole `COVER_LIFT` above where it is.
          cover: project(localCentreOf(MESH.tankCover)),
          deflector: project(localCentreOf(getDeflector(state.selectedDeflectorId).installed)),
        }),
        /** The canvas, and the part of it no panel covers. */
        region: () => {
          const canvas = gl?.domElement;
          if (!canvas) return null;
          const rect = canvas.getBoundingClientRect();
          const panels = Array.from(document.querySelectorAll('.sidebar-panel')).map((el) =>
            el.getBoundingClientRect()
          );
          return {
            canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            panels: panels.map((p) => ({
              left: p.left,
              top: p.top,
              width: p.width,
              height: p.height,
            })),
          };
        },
        /** Dev-only: the flight most recently reported to the camera. */
        lastFlight: () => lastFlightRef.current,
        /** Where the camera stands, for measuring that it moved at all. */
        camera: () =>
          [camera.position.x, camera.position.y, camera.position.z] as [number, number, number],
        /**
         * Dev-only diagnostics for the destination framing: where the head bounds are, and
         * where the camera is actually pointing. A framing bug and an aiming bug produce
         * the same symptom — a part off screen — and only these two together tell them
         * apart.
         */
        framing: () => {
          const b = headFramingRef.current;
          if (!b) return null;
          const lifted = b.max.clone().setY(b.max.y + COVER_LIFT);
          const centre = b.min.clone().add(lifted).multiplyScalar(0.5);
          return {
            centre: project(centre.clone()),
            radius: lifted.distanceTo(b.min) / 2,
            // The lifted plate, from the same bounds the framing used.
            plateTop: project(new THREE.Vector3(centre.x, lifted.y, centre.z)),
          };
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
      if (sceneHidden) return false;
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
          mat.emissive.set(GUIDANCE_HIGHLIGHT);
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

    // The switch is a rotary knob, and it turns about the axis it faces along.
    //
    // It used to turn about **Z**, which is the operator's left-to-right axis: that tipped
    // the knob out of the panel instead of spinning it, so ON rendered the disc as a flat
    // ellipse lying down. The knob's own geometry settles the axis — its bounding box is
    // 29.8 x 43.8 x 45.0 mm, thinnest across **X**, so X is the face normal, and the
    // operator stands at -X looking along +X (`apparatusView.FRONT`). A disc spins about
    // its face normal.
    //
    // Direction is BEDO's: storyboard sl. 29, state A, *"The red power switch is off.
    // (Rotate it smoothly 90 degrees **clockwise** to turn it on.)"* Sl. 30 says
    // "anticlockwise to turn it on" of a switch that is *already on*, which is not a
    // transition that exists — it is the same sentence copied and half-edited, and the two
    // slides agree once it is read as "to turn it off". See `docs/42 §2`.
    //
    // Clockwise, for an eye at -X looking along +X, is a **positive** turn about X: the
    // right-hand rule carries +Y to +Z, and for that observer +Y is up and +Z is right, so
    // up-to-right — clockwise.
    const powerPivot = pivots.current[MESH.powerSwitch];
    if (powerPivot && powerSpindle.current) {
      // One scalar is animated, and the whole orientation is rebuilt from it every frame.
      // Easing a Euler component instead would compound orientation drift and, on a
      // spindle that lies along no world axis, could not describe the arc at all.
      powerTurn.current = damp(powerTurn.current, powerSwitchTurn(state.isPowerOn), 12);
      powerPivot.quaternion.setFromAxisAngle(powerSpindle.current, powerTurn.current);
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

    if (flowing && group && activeDef && jetGroupRef.current) {
      // Nothing is fitted, placed or sized here any more: the caches are already in the
      // apparatus's own coordinate system, a hundred times over. `WATER_MODEL_SCALE` is the
      // whole transform — see `src/lib/waterJet.ts` for how that was measured.
      //
      // The groups carry that scale from the JSX below and never move, so the only thing
      // left to decide each frame is which shape is visible and where its cache has got to.
      // The storyboard defines two mutually exclusive water states, and which one is showing
      // is decided by how much water is arriving — see `waterShapeForFlow` for the caches'
      // own evidence that `Water_low` is the low-flow body and for why the impact velocity
      // it used to read could never select it. Every after-impact cache already contains its
      // own nozzle column, impact and spread, so keeping Water_low underneath it would
      // double the stream.
      //
      // `state.live.flowRateLMin` is the domain's own figure for the current valve setting,
      // over the pump capacity the student may have customised — the same fraction the tank
      // fill below is driven by, so the two states can never disagree about which one this is.
      const inflowFraction =
        state.live.flowRateLMin / Math.max(state.params.pumpFlowLMin, 1e-9);
      const activeWater = waterShapeForFlow(inflowFraction, deflector.water);
      const impacting = activeWater !== JET_ASSET;
      jetGroupRef.current.visible = !impacting;
      if (plumeGroupRef.current) plumeGroupRef.current.visible = impacting;

      // Ripple with the flow, but gently — see the material for the amplitude.
      waterTime.current.value = t * (0.6 + state.valveOpening * 1.6);
      waterFlow.current.value = state.valveOpening;

      (Object.keys(WATER_SHAPES) as WaterShapeKey[]).forEach((key) => {
        const gltf = (water as any)[key];
        if (gltf?.scene) gltf.scene.visible = key === activeWater;
      });

      // --- Authored geometry playback -----------------------------------------
      //
      // The two shapes each run their own one-shot cache: 81 frames at 24 fps, played
      // once and held at the settled pose. Valve movement deliberately does **not**
      // restart them — only the flow starting does — so nudging the setpoint cannot make
      // the water re-emerge from nothing. See `src/lib/waterCache.ts` and `docs/44 §F3`.
      const jetSource = (water as any)[JET_ASSET]?.scene;
      if (jetSource) {
        applyCacheFrame(jetSource, jetClock.current.advance(!impacting, delta));
      }

      const plumeSource = (water as any)[deflector.water]?.scene;
      if (plumeSource) {
        applyCacheFrame(plumeSource, plumeClock.current.advance(impacting, delta));
      }
    } else {
      if (jetGroupRef.current) jetGroupRef.current.visible = false;
      if (plumeGroupRef.current) plumeGroupRef.current.visible = false;
      // Parked, not reversed. No authored shutdown cache exists, so the next start plays
      // the emergence again from frame 0 rather than inventing a drain (`docs/44 §F2`).
      jetClock.current.advance(false, delta);
      plumeClock.current.advance(false, delta);
      waterFlow.current.value = 0;
    }

    // --- The tank fills once more arrives than the drain can carry -------------
    //
    // The second water state the reference shows (t = 74 s, full to just under the cover).
    // Driven by how much water is arriving, which is what the recording actually shows
    // changing — the student turns the *flow* valve, never the volumetric one, and the tank
    // is empty through ten seconds at the lower setpoint. See `src/lib/tankWater.ts`.
    const tankWater = tankWaterRef.current;
    if (tankWater && tankInterior) {
      // The same fraction the shape selection above reads, so the column/plume switch and
      // the tank's fill can never straddle `DRAIN_CAPACITY_FRACTION` differently. Recomputed
      // rather than hoisted because the water block above is skipped when nothing flows.
      const inflow = flowing
        ? state.live.flowRateLMin / Math.max(state.params.pumpFlowLMin, 1e-9)
        : 0;
      tankLevel.current = advanceLevel(
        tankLevel.current,
        targetLevel(inflow, state.isVolumetricValveOpen),
        delta
      );
      const height = Math.max(tankInterior.ceilingY - tankInterior.floorY, 1e-6);
      tankWater.visible = tankLevel.current > 0.002;
      tankWater.scale.set(1, Math.max(tankLevel.current, 1e-4), 1);
      tankWater.position.set(tankInterior.axis.x, tankInterior.floorY, tankInterior.axis.y);
      // The optics need the interior's own dimensions to know what "deep" and "against the
      // glass" mean. Measured, not assumed — see `measureTankInterior`.
      tankHeightUniform.current.value = height;
      tankRadiusUniform.current.value = tankInterior.radius;
      // Appearance only, and read-only with respect to the fill: these are the level that
      // was just applied to the mesh scale and the inflow that was just used to pick the
      // target. Nothing downstream of them writes back.
      tankLevelUniform.current.value = Math.max(tankLevel.current, 1e-4);
      tankInflowUniform.current.value = inflow;

      // Hand the jet material the waterline it has to defer to, in the world units its own
      // shader works in. The mesh was just positioned and scaled above, so this reads that
      // surface rather than predicting it.
      //
      // The geometry is the full interior height with its origin at the base, so the
      // surface is `height` up the mesh's own y axis. `getWorldScale` already carries the
      // level — it is the mesh's `scale.y` — so the level must not be applied twice here.
      //
      // Parked far below the rig while the tank is empty, so an empty tank can never make
      // the plume look submerged.
      tankWater.getWorldPosition(tmp.tankSurfacePos);
      tankWater.getWorldScale(tmp.tankSurfaceScale);
      waterlineUniform.current.value = tankWater.visible
        ? tmp.tankSurfacePos.y + height * tmp.tankSurfaceScale.y
        : -1e9;
    } else {
      // No tank body this frame — measured interior missing, or the mesh not mounted yet.
      // Nothing is submerged, so the plume keeps its full free-surface treatment.
      waterlineUniform.current.value = -1e9;
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

        Neither shape is fitted, rotated or re-centred. BEDO authored all eight caches in
        the apparatus's own coordinate system, in centimetres — every one of them centres on
        x = 1.01, z = -22.93, which is the nozzle axis at (0.0101, -0.2293) times a hundred.
        So the entire transform is `WATER_MODEL_SCALE`, and the authored position is already
        the right position. See `src/lib/waterJet.ts`.
      */}
      {(() => {
        const shape = (key: WaterShapeKey) => {
          const source = (water as any)[key]?.scene;
          if (!source) return null;
          return <primitive key={key} object={source} />;
        };
        const plumes = (Object.keys(WATER_SHAPES) as WaterShapeKey[]).filter(
          (k) => k !== JET_ASSET
        );
        return (
          <>
            {/* Before impact — the authored column, at its authored place and size. */}
            <group ref={jetGroupRef} visible={false} scale={WATER_MODEL_SCALE}>
              {shape(JET_ASSET)}
            </group>
            {/* After impact — the authored spray, likewise. */}
            <group ref={plumeGroupRef} visible={false} scale={WATER_MODEL_SCALE}>
              {plumes.map(shape)}
            </group>
            {/*
              The water that collects in the measuring tank. Procedural because no shipped
              asset can draw it — `LIQUID001` is a four-vertex quad 480 mm below the tank.
              Presentation only; the drain valve drives it. See `src/lib/tankWater.ts`.
            */}
            {tankWaterGeometry && (
              <mesh
                ref={tankWaterRef}
                geometry={tankWaterGeometry}
                material={tankWaterMaterial}
                visible={false}
                renderOrder={-1}
              />
            )}
          </>
        );
      })()}

      {arrowPos && (
        <group ref={arrowGroupRef} position={arrowPos}>
          <mesh position={[0, 0.055, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.07, 12]} />
            <meshStandardMaterial
              color="#f58220"
              emissive={GUIDANCE_HIGHLIGHT}
              emissiveIntensity={1.4}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0.008, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.017, 0.034, 14]} />
            <meshStandardMaterial
              color="#f58220"
              emissive={GUIDANCE_HIGHLIGHT}
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
        // A proxy that only names its part must not become an obstacle in front of one
        // that does something. It takes no click and stops no event, so a press aimed at
        // whatever sits behind it still gets there.
        const labelOnly = h.action.kind === 'nozzle';

        return (
          <mesh
            key={h.key}
            ref={h.key === MESH.tankCover ? coverHotspotRef : undefined}
            position={h.position}
            {...(source ? drag.handlersFor(source) : {})}
            onPointerOver={(e) => {
              if (!labelOnly) e.stopPropagation();
              // Actionability, not focus: a hotspot the gate would refuse must not offer
              // the same pointer as one it would accept (BEDO-020 §24).
              if (actionableKeys.has(h.key)) {
                document.body.style.cursor = draggable ? 'grab' : 'pointer';
                setHoveredKey(h.key);
              }
              // Naming a part is not the same promise as offering it — see `labelledKey`.
              if (labelFor(h.action)) setLabelledKey(h.key);
            }}
            onPointerOut={() => {
              if (!drag.current()) document.body.style.cursor = 'default';
              setHoveredKey((k) => (k === h.key ? null : k));
              setLabelledKey((k) => (k === h.key ? null : k));
            }}
            {...(draggable || labelOnly
              ? {}
              : {
                  onClick: (e: { stopPropagation: () => void }) => {
                    e.stopPropagation();
                    handleHotspot(h.action);
                  },
                })}
          >
            {h.half ? (
              <boxGeometry args={[h.half[0] * 2, h.half[1] * 2, h.half[2] * 2]} />
            ) : (
              <sphereGeometry args={[h.radius, 12, 10]} />
            )}
            <meshBasicMaterial visible={false} />
            {labelledKey === h.key && (
              // `pointer-events: none` is what keeps this a label and not an obstacle: the
              // chip is drawn over the part it names, and a drag or a click has to reach
              // the proxy underneath it. Without it the tooltip would swallow its own
              // trigger and flicker as the pointer entered it.
              <Html
                center
                position={[0, (h.half?.[1] ?? h.radius) + 0.035, 0]}
                zIndexRange={[40, 0]}
                style={{ pointerEvents: 'none' }}
              >
                <div className="scene-tooltip" dir={isArabic ? 'rtl' : 'ltr'}>
                  {labelFor(h.action)}
                </div>
              </Html>
            )}
          </mesh>
        );
      })}
    </group>
  );
};

useGLTF.preload(assetUrl('Bedo_baked_v2.glb'), true, true, extendWithKTX2);
// Preload through `assetUrl` as well. Preloading the authored path while the component
// loads the content-addressed one gives the two different cache keys, so every plume
// was fetched twice in production — 8 redundant GLB requests per page load.
Object.values(WATER_SHAPES).forEach((s) => useGLTF.preload(assetUrl(s.url)));
