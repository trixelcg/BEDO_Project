import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useGLTF } from '@react-three/drei';
import { extendWithKTX2, setKTX2Renderer } from '../lib/ktx2';

import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { LessonView, SimulationView } from '../types/index';
import {
  DEFLECTORS,
  MESH,
  WEIGHTS,
  getDeflector,
  type AnchorKey,
  MISMATERIALLED_HOSE,
  SUPPLY_HOSE,
} from '../domain/apparatus';
import { gltfName } from '../lib/gltfNames';
import { adaptApparatusScene, createPreviousTankGlass } from '../lib/modelAdapter';
import {
  CUSTOM_WEIGHT_MESH,
  applyWeightFamily,
  createWeightFaceTexture,
  type WeightFamily,
} from '../lib/weightFamily';
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
import {
  NOZZLE_MOUTH_MESH,
  carrierStop,
  settleToward,
  springCompressionLimitMm,
  type CarrierStop,
} from '../lib/carrierTravel';
import { GRAVITY_MS2, NOZZLE_AREA_M2 } from '../domain/physics';
import { gramsToNewtons } from '../domain/units';
import { anchorIdOf, describeComponent, type ComponentRef } from '../domain/componentInfo';
import { publishAnchorPoint, type Inspection } from '../lib/componentAnchor';
import { attachBoardReadout, type BoardValues } from './boardReadout';
import { markReady, markTransfer } from '../lib/readiness';
import {
  commits,
  type DragSession,
  type DragSource,
  type DropOutcome,
} from '../interaction/drag';
import {
  DEFLECTOR_REMOVAL_SECONDS,
  STACK_CLEAR_STAGGER_SECONDS,
  addedWeightIndex,
  createTransferSet,
  durationOf,
  removedWeightIndex,
  type TransferKind,
} from '../interaction/transfer';
import { type Obstacle } from '../lib/transferPath';
import {
  HANDLING_CLEARANCE,
  liftShare,
  planHandling,
  sampleHandling,
  travelHeightOver,
  type HandlingPlan,
  type HandlingSample,
  type Point3,
} from '../lib/handlingPath';
import { fitRigid, type Vec3 } from '../lib/rigidFit';
import { NOZZLE_DIAMETER_M } from '../lib/waterJet';
import {
  FILM_OFFSET_M,
  POOL_DEPTH_M,
  buildJetPaths,
  measureCeiling,
  measureWettedSurface,
  type JetGeometry,
  type JetPath,
  type WettedSurface,
} from '../lib/jetFlow';
import {
  CONDUIT_REFERENCE_SPEED,
  CONDUIT_WALLS,
  conduitPatternSpeed,
  createWaterMaterial,
  createWaterUniforms,
  measureConduit,
} from '../lib/waterMaterial';
import {
  createJetFlowGeometry,
  createJetFlowMaterial,
  createJetSheetMaterial,
  createJetFlowUniforms,
  createPoolMesh,
  createPoolUniforms,
  writeJetPath,
} from '../lib/jetFlowMesh';
import { applyGlass } from '../lib/materialFamilies';
import { applyWallStripe, isWallPaint } from '../lib/wallStripe';
import {
  PILOT_LAMP_ON_INTENSITY,
  pilotLampIntensity,
  preparePilotLamp,
  setPilotLampLevel,
} from '../lib/pilotLamp';
import { attachOutline, createOutlineLayer, type OutlineHandle } from '../lib/selectionOutline';
import {
  currentCursorTooltip,
  currentCursorTooltipLines,
  hideCursorTooltip,
  showCursorTooltip,
  trackCursorTooltip,
} from '../lib/cursorTooltip';
import { spindleAxis, spindleCentre } from '../lib/powerSwitch';
import {
  advanceLevel,
  measureTankInterior,
  targetLevel,
  type TankInterior,
} from '../lib/tankWater';
import {
  advanceTankVolume,
  applyColumn,
  createBasinWater,
  heightForV,
  litreToV,
  measureBasin,
  setBasinLevel,
  type BasinInterior,
} from '../lib/measuringTank';
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
  | { kind: 'nozzle' }
  /**
   * Parts that are only looked at (F17): they name themselves on hover and open their
   * component card on a deliberate click, and pressing them does nothing to the rig.
   */
  | { kind: 'part'; component: InfoPart };

/** The informational parts with a hit proxy of their own (F17). */
type InfoPart = 'pointer' | 'spring' | 'weightCarrier' | 'flowmeter' | 'installedDeflector';

/**
 * The bench's measuring-tank scale (F17): the two graduated plates beside its sight tube,
 * next to the volumetric valve. There is no separate flowmeter in the model (F18), and this
 * is the part the QA's "flowmeter view" shows.
 */
const FLOWMETER_MESHES = ['Rectangle002', 'Rectangle003'];
/** The bench's measuring tank: the deep basin in the bench top (`lib/measuringTank.ts`). */
const MEASURING_TANK_MESH = 'Bing Sink';
/** The weight pan on top of the rod (`modelAdapter`: `deflector_rod` = rod + pan). */
const CARRIER_MESH = 'JET Force 2_209';
/** Hover/outline key for the deflector on the rod — whichever one is fitted. */
const INSTALLED_KEY = 'part:installed-deflector';

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
  /**
   * Parts that ride the rod or the spring move with them every frame, and their proxy
   * with them (F17): `holder` = the rod's lift (cover plus deflection), `cover` = the
   * cover's lift alone.
   */
  follows?: 'holder' | 'cover';
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
 * How a hand moves the parts (F03). Model units are metres.
 *
 * A disc is lifted this far out of its tray slot before it is carried, and lowered this far
 * into it at the end; a deflector likewise off and onto the tray.
 */
const TRAY_LIFT = 0.02;
const DEFLECTOR_TRAY_LIFT = 0.025;
/**
 * A deflector is lined up this far **below** the end of the rod and then threaded up onto
 * it — and unthreaded down the same distance before it is carried away.
 */
const DEFLECTOR_ROD_APPROACH = 0.06;
/**
 * A disc on the pan comes down the post from at least this far above its seat, even when the
 * stack is already taller than the post, so the last move is always a visible set-down.
 */
const MIN_DISC_APPROACH = 0.012;
/** A hand-returned part is set back down from this height. */
const RETURN_APPROACH = 0.015;
/**
 * How far above the higher end of its route a disc is carried — the top of the arc QA drew:
 * straight up out of the tray to above the post, over, and straight down (F03).
 */
const DISC_TRAVEL_RISE = 0.05;
/** Apparatus-local up — the rod and post axis. */
const UP = new THREE.Vector3(0, 1, 0);

/**
 * How a deflector's tray copy relates to its fitted copy (F03).
 *
 * `fittedPivot` is the fitted deflector's centre at rest, which lies on the rod and nozzle
 * axis (measured: within 0.1 mm for all seven). `shelfPivot` is the **same material point**
 * on the tray copy. A flying deflector is hung from that point, so it can be turned into its
 * fitted orientation, and spun while it threads onto the rod, without ever leaving the axis.
 */
interface DeflectorPose {
  readonly rotation: THREE.Quaternion;
  readonly shelfPivot: THREE.Vector3;
  readonly fittedPivot: THREE.Vector3;
  readonly halfHeight: number;
  readonly radius: number;
}

const spinTmp = new THREE.Quaternion();

/**
 * A deflector's orientation at one moment of its flight.
 *
 * It leaves in the pose it rests in and arrives in the pose it is fitted in, turning over
 * during the carry — the 45° oblique deflector is stored on the tray turned over, and used
 * to swap orientation in a single frame on arrival. While it threads onto the rod it makes
 * one turn about the rod axis, ending exactly in the fitted pose; coming off, the reverse.
 */
function orientInFlight(
  target: THREE.Quaternion,
  turn: NonNullable<Ghost['turn']>,
  sample: HandlingSample
): void {
  if (sample.phase === 'depart') target.copy(turn.from);
  else if (sample.phase === 'approach') target.copy(turn.to);
  else target.slerpQuaternions(turn.from, turn.to, sample.phaseProgress);

  let angle = 0;
  if (turn.spin === 'approach' && sample.phase === 'approach') {
    angle = (1 - sample.phaseProgress) * Math.PI * 2;
  } else if (turn.spin === 'depart' && sample.phase === 'depart') {
    angle = -sample.phaseProgress * Math.PI * 2;
  }
  if (angle !== 0) target.premultiply(spinTmp.setFromAxisAngle(UP, angle));
}

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
  /**
   * Where the flight starts and where it is going, in apparatus-local space — the point the
   * wrapper's origin is at. For a disc that origin is the disc's centre; for a deflector it
   * is its point on the rod axis (see `DeflectorPose`). `to` is the destination **at rest**:
   * the holder's live lift is added while the part rides it.
   */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /**
   * The planned route (F03): lifted clear, carried, and lined up on the destination's axis
   * before the last move. Absent only while the pointer owns the position.
   */
  plan?: HandlingPlan;
  /** How much of the holder's live lift applies at the start and at the end of `plan`. */
  liftAt?: readonly [number, number];
  /** The holder lift already built into `plan`; only a change since then is added per frame. */
  liftAtPlan?: number;
  /**
   * Orientation over the flight: the pose it leaves in, the pose it arrives in, and whether
   * it turns one full revolution about the rod axis while threading on (`approach`) or off
   * (`depart`). Deflectors only; a disc never turns.
   */
  turn?: {
    readonly from: THREE.Quaternion;
    readonly to: THREE.Quaternion;
    readonly spin: 'approach' | 'depart' | null;
  };
  /**
   * For a disc lifted off the pan by hand: the stack position it came from. That seat is
   * drawn empty while the disc is in the learner's hand, so it is never in two places.
   */
  sourceIndex?: number;
  /** A hand-held pan disc may only move sideways once it has been drawn up clear of the post. */
  clearedPost?: boolean;
  /** Where the pointer is asking a hand-held disc to be; the frame loop eases it there. */
  carryTarget?: THREE.Vector3;
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
  /**
   * The mass the custom-weight control is set to: what the custom weight — the model's own
   * plain disc by the tank — adds when it is picked up (F04, `lib/weightFamily.ts`).
   */
  customWeightG: number;
  /**
   * The part whose component card (or focus tooltip) is open, if any. The scene projects
   * its anchor each frame so the card can sit beside it (F17, `lib/componentAnchor.ts`).
   */
  inspection?: Inspection | null;
  /** A deliberate click asked for a part's card. Hover never calls this. */
  onInspectComponent?: (inspection: Inspection) => void;
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
/** Hover/outline key prefix for a disc on the pan, by its seat index. */
const STACK_KEY = 'stack:';

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
  customWeightG,
  inspection: inspectionProp,
  onInspectComponent,
}) => {
  const inspection: Inspection | null = inspectionProp ?? null;
  // PERF-04 candidate: `?glb=v3` selects the KHR_texture_basisu build. The KTX2 loader is
  // attached only here — the eight WaterShapes GLBs carry no textures.
  const { scene } = useGLTF(assetUrl('Bedo_baked_v2.glb'), true, true, extendWithKTX2) as any;
  // Before anything looks a part up: the re-authored export (BEDO-MODEL-02) is moved back
  // into the apparatus frame and its renamed and split parts are put back under their
  // contract names. Idempotent on the cached scene. See `src/lib/modelAdapter.ts`.
  useMemo(() => {
    if (!scene) return;
    const { missing } = adaptApparatusScene(scene);
    if (missing.length) console.error('[BEDO] apparatus model is missing parts:', missing);
  }, [scene]);
  /** Declared here because the material pass below needs the GPU's anisotropy limit. */
  const gl = useThree((three) => three.gl);
  setKTX2Renderer(gl);

  // Every disc on the tray, on the pan and in the air is one physical family: one steel,
  // one bore, sized from its mass (F04, `src/lib/weightFamily.ts`). Put on the model here,
  // before anything measures a disc — the anchors, the click targets, the stack and the
  // flights all read the tray nodes, so they follow without knowing the family exists.
  const weightFamily = useMemo<WeightFamily | null>(() => {
    if (!scene) return null;
    const anisotropy = Math.min(8, gl?.capabilities?.getMaxAnisotropy?.() ?? 1);
    return applyWeightFamily(scene, {
      customGrams: customWeightG,
      faceTexture: (grams) => createWeightFaceTexture(grams, anisotropy),
    });
    // The custom mass is followed by the effect below, not by re-applying the family.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gl]);
  /** Read by the frame loop, which must not close over a stale mass. */
  const customWeightRef = useRef(customWeightG);
  customWeightRef.current = customWeightG;
  /** Whether the custom control is on a mass the row already has a disc for. */
  const customIsFixed = WEIGHTS.some((w) => w.grams === customWeightG);
  // A layout effect, so the family hears of a new custom mass before the click targets are
  // measured. (The custom weight itself keeps its shape; see `weightFamily.ts`.)
  useLayoutEffect(() => {
    weightFamily?.setCustomGrams(customWeightG);
  }, [weightFamily, customWeightG]);


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
  /** Whether a plain click on the labelled part would open its card (F17). */
  const [labelClickOpens, setLabelClickOpens] = useState(false);
  /** Where the pointer entered the current part, so the label appears there at once. */
  const pointerAt = useRef<{ x: number; y: number } | null>(null);

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
  /** Parts currently outlined, by key, with the hull meshes that draw each outline. */
  const highlighted = useRef<Map<string, OutlineHandle>>(new Map());
  /** Where the outline hulls live. Outside the GLB, so nothing that measures it sees them. */
  const outlineLayer = useMemo(() => createOutlineLayer(), []);
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
   * The water, computed from state every frame (F08, `src/lib/jetFlow.ts`): the nozzle and
   * tank it runs through, and each deflector's wetted underside, all measured at load.
   */
  const jetGeometryRef = useRef<JetGeometry | null>(null);
  const jetAxisRef = useRef<{ x: number; z: number } | null>(null);
  const wettedRef = useRef<Map<number, WettedSurface>>(new Map());
  /** When the flow last started and stopped, in scene seconds, for the water front and tail. */
  const flowEdgesRef = useRef<{ running: boolean; startedAt: number; stoppedAt: number }>({
    running: false,
    startedAt: -1e6,
    stoppedAt: -1e6,
  });
  const jetFlowUniforms = useMemo(() => createJetFlowUniforms(), []);
  /** The path the water was last on, so water in the air can finish its fall. */
  const lastPathRef = useRef<JetPath[] | null>(null);
  const poolUniforms = useMemo(() => createPoolUniforms(), []);
  const [poolMesh, setPoolMesh] = useState<THREE.Mesh | null>(null);
  /**
   * The tank's measured interior.
   *
   * No longer used to build a body — nothing procedural is drawn in the tank any more
   * (BEDO-WATER-14). It survives because the fill still has to know where the floor and the
   * ceiling are in order to turn a level into a waterline height.
   */
  const [tankInterior, setTankInterior] = useState<TankInterior | null>(null);

  /** How full the tank is, 0..1 of its interior height. Presentation only. */
  const tankLevel = useRef(0);
  /**
   * The flowmeter column and the measuring tank's water — visual only (`lib/measuringTank`).
   * The volume is presentation state: it follows the volumetric valve and the flow, and
   * nothing reads it back.
   */
  const columnRef = useRef<{ setLevel: (y: number) => void; dispose: () => void } | null>(null);
  const litreHeightRef = useRef<((litres: number) => number) | null>(null);
  const basinRef = useRef<{ interior: BasinInterior; water: THREE.Mesh } | null>(null);
  const measuringTankL = useRef(0);
  const measuringTankRun = useRef(lesson.runId);
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
  const coverHotspotRef = useRef<THREE.Mesh | null>(null);
  /** Every mounted hit proxy by key, so the moving ones can follow their part (F17). */
  const proxyRefs = useRef(new Map<string, THREE.Mesh>());
  /** The inspected part, read by the frame loop without re-subscribing it (F17). */
  const inspectionRef = useRef<Inspection | null>(inspection);
  inspectionRef.current = inspection;
  const projectTmp = useRef(new THREE.Vector3());
  /** The renderer state of the last frame — for the dev-only `parts()` check below. */
  const lastThree = useRef<{ camera: THREE.Camera; gl: THREE.WebGLRenderer } | null>(null);

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
  /**
   * The carrier's downward stop for each fitted deflector, and for the bare rod, measured
   * at rest off the model (F05, `lib/carrierTravel.ts`). Keyed by deflector id; the bare
   * rod is key 0.
   */
  const carrierStopsRef = useRef<Map<number, CarrierStop>>(new Map());
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

    /**
     * `Line010` is the supply hose, and it has to read as one (BEDO-WATER-12).
     *
     * ## What it is
     *
     * The GLB gives `Galss_Material` to exactly two meshes: the tank cylinder
     * `JET Force 2_205`, which is the glass vessel, and this. Measured, it is a J-shaped
     * bent tube 239 x 620 x 311 mm centred 288 mm to the side of the tank axis and 408 mm
     * below its floor, with vertices sweeping a 42-190 mm radius about its own centre and
     * no UVs at all. It is a hose, not part of the vessel.
     *
     * ## Why the previous answer was wrong
     *
     * MODEL-01 handed it the opaque bench-pipe material to kill a ghost. That removed the
     * ghost and was wrong about the part: `Bedo_Mesu_J.mp4` at t = 74 s shows this hose
     * plainly, and it is a **translucent tube with a blue-grey water-filled interior** and
     * bright specular highlights running along both edges. It is the feed into the tank
     * base — it carries the water, and the reference lets you see the water in it.
     *
     * ## Why it ghosted, and what fixes that
     *
     * Not transparency itself. The authored material is a `MeshStandardMaterial` whose only
     * route to translucency is `baseColorFactor` alpha at 0.10, blended flat and
     * double-sided. That has no edge definition, so a 620 mm tube seen near edge-on
     * composites into a broad featureless smear rather than a tube.
     *
     * What makes a tube read as a tube is its rim, so this is built as water in glass and
     * not as a faint film: a Fresnel term that lights the walls where they turn away from
     * the eye, which is exactly where the reference shows its highlights, and enough body
     * opacity that the interior carries colour. The silhouette then draws itself.
     *
     * The water inside is driven by the authoritative flow — nothing moves at Q = 0 — and
     * shares the jet's clock and ripple texture, so the hose, the jet and the tank water
     * are visibly the same substance. No second mesh, no solver, no extra pass: the hose's
     * own geometry already has the exact curvature, radius and transform, so the water is
     * shaded inside it rather than modelled again.
     */

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
      gltfName(CUSTOM_WEIGHT_MESH),
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
    // `Plane001_Baked` in the previous export; this one has no ground plane outside the room,
    // and its floor is `Floor_1st_Floor` (the ceiling is `Floor_1st_Floor001`).
    const floorName = 'Floor_1st_Floor';

    // The wall stripe is corrected in the apparatus's own frame — see `wallStripe.ts`.
    const rigInverse = new THREE.Matrix4();
    if (groupRef.current) {
      groupRef.current.updateWorldMatrix(true, false);
      rigInverse.copy(groupRef.current.matrixWorld).invert();
    }

    scene.traverse((child: any) => {
      if (!child.isMesh) return;

      // Before anything reads the material: give the hose the bench's, not the glass's.

      // The tank keeps the blended glass production has always rendered, because the water
      // inside it is transparent and cannot be seen through transmissive glass. Swapped once;
      // `applyGlass` below then tunes it as before. See `createPreviousTankGlass`.
      if (child.name === gltfName(MESH.tank) && !child.userData.bedoTankGlass) {
        child.material = createPreviousTankGlass();
        child.userData.bedoTankGlass = true;
      }

      child.castShadow =
        casters.has(child.name) || (roomShadow(child.name) && child.name !== floorName);
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
        // The re-authored model (BEDO-MODEL-02) ships its own, descriptively named PBR
        // materials, so they are kept exactly as authored. The per-family corrections in
        // `materialFamilies.ts` were an audit of the *previous* export's impossible values
        // (`MergedBake_Baked` at metalness 1 and the like) and classify by those names;
        // run over this file they would repaint walls, room glass and fittings the author
        // has already set. The one surface the experience depends on is the tank: the jet
        // is read through it, so it keeps the tuned glass the scene config controls.
        // The walls' orange stripe: its edges are evaluated from height rather than from
        // the atlas texel, because the atlas rasterised them as a staircase.
        if (isWallPaint(material)) applyWallStripe(material, rigInverse);
        // The pilot lamp: a red lens that lights green when on. See `pilotLamp.ts`.
        if (child.name === gltfName(MESH.powerLight)) preparePilotLamp(material);
        if (child.name === gltfName(MESH.tank)) {
          applyGlass(material, {
            roughness: glassRoughness,
            ior: glassIor,
            envScale: reflection,
            specularIntensity: glassSpecular,
          });
        }
      }

      child.visible = child.name !== liquidName && !mounted.has(child.name);
    });
  }, [scene, gl, groupRef, reflection, glassSpecular, glassRoughness, glassIor]);

  /**
   * The water in the supply hose: the shared water material's uniforms, and where the water
   * is in the hose (`src/lib/waterMaterial.ts`). The clock runs at the water's speed through
   * the bore, so the hose fills from the pump end, carries its ripples and bubbles at that
   * speed, and empties from the pump end when the flow stops.
   */
  const hoseUniforms = useMemo(() => createWaterUniforms(), []);
  const hoseRef = useRef<{
    length: number;
    radius: number;
    speed: number;
    head: number;
    tail: number;
    running: boolean;
  } | null>(null);

  /**
   * The supply hose from the wall tap: a line under mains pressure, so it stands full of
   * still water, and the water in it runs whenever the pump draws — at Q / A through its
   * own bore, from the tap towards the bench.
   */
  const supplyUniforms = useMemo(() => {
    const u = createWaterUniforms();
    u.uFill.value = 1;
    return u;
  }, []);
  const supplyRef = useRef<{ length: number; radius: number } | null>(null);

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

  /** The jet, the films and the sheets: one swept surface, rewritten each frame (F08). */
  const jetFlowMesh = useMemo(() => {
    const mesh = new THREE.Mesh(
      createJetFlowGeometry(),
      createJetFlowMaterial(waterTex, jetFlowUniforms)
    );
    mesh.name = 'bedoWaterPath';
    mesh.visible = false;
    mesh.renderOrder = 3;
    // The same path again for the thin sheets and run-off, which are blended rather than
    // refracted (`waterMaterial.ts`). A child with the parent's geometry: it moves, fills
    // and hides with it.
    const sheets = new THREE.Mesh(mesh.geometry, createJetSheetMaterial(waterTex, jetFlowUniforms));
    sheets.name = 'bedoWaterSheets';
    sheets.renderOrder = 4;
    mesh.add(sheets);
    return mesh;
  }, [waterTex, jetFlowUniforms]);

  /**
   * Water travelling through the supply hose: the same water material as the jet, as a
   * conduit — a clear tube, always drawn, with water inside it where the water has got to
   * (BEDO-WATER-12, and the product-owner request of 2026-09-28).
   */
  const hoseMaterial = useMemo(
    () => createWaterMaterial(waterTex, hoseUniforms, 'conduit'),
    [waterTex, hoseUniforms]
  );
  /** The same water in the grey supply hose, seen through its smoked wall. */
  const supplyMaterial = useMemo(
    () => createWaterMaterial(waterTex, supplyUniforms, 'conduit', CONDUIT_WALLS.smoked),
    [waterTex, supplyUniforms]
  );

  /**
   * Put the water material on the hose, and give the hose the flow coordinates it needs:
   * the distance along the tube from the pump end, and the angle round it, measured off its
   * own vertices (`measureConduit`).
   *
   * Its own effect rather than part of the big material pass, because that pass runs before
   * this material exists.
   */
  useEffect(() => {
    if (!scene) return;
    const target = gltfName(MISMATERIALLED_HOSE);
    const group = groupRef.current;
    scene.traverse((child: any) => {
      if (!child.isMesh || child.name !== target) return;
      child.material = hoseMaterial;
      const conduit = measureConduit(child, (v) => (group ? group.worldToLocal(v) : v));
      if (conduit) {
        hoseRef.current = { ...conduit, speed: 0, head: 0, tail: -1, running: false };
      }
    });
  }, [scene, hoseMaterial]);

  /** The supply hose, the same way: its own material, its flow coordinates off its mesh. */
  useEffect(() => {
    if (!scene) return;
    const target = gltfName(SUPPLY_HOSE);
    const group = groupRef.current;
    scene.traverse((child: any) => {
      if (!child.isMesh || child.name !== target) return;
      child.material = supplyMaterial;
      supplyRef.current = measureConduit(child, (v) => (group ? group.worldToLocal(v) : v));
    });
  }, [scene, supplyMaterial]);


  /** Built once from the measured interior; rebuilt only if the model is re-exported. */


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

        // Where the carrier must stop on its way down (F05): short of the nozzle by the
        // minimum clearance, or at the spring's working compression, whichever comes first.
        // Measured at rest, per fitted deflector — the cones hang 4.4 mm lower than the rest.
        const mouth = pick(NOZZLE_MOUTH_MESH);
        const bottomOf = (name: string) => {
          const object = pick(name);
          if (!object) return null;
          const box = new THREE.Box3().setFromObject(object, true);
          return box.isEmpty() ? null : box.min.y / modelScale;
        };
        if (mouth) {
          const mouthY = new THREE.Box3().setFromObject(mouth, true).max.y / modelScale;
          const springRestMm = (sSize.y / modelScale) * 1000;
          const stops = new Map<number, CarrierStop>();
          // The bare rod: nothing hangs below its own end.
          const rodEnd = bottomOf('JET Force 2_210');
          if (rodEnd !== null) stops.set(0, carrierStop(rodEnd, mouthY, springRestMm));
          for (const d of DEFLECTORS) {
            const bottom = bottomOf(d.installed);
            if (bottom !== null) stops.set(d.id, carrierStop(bottom, mouthY, springRestMm));
          }
          carrierStopsRef.current = stops;
        }
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
      // A disc in the learner's hand is not yet leaving: letting go of it *is* the removal,
      // and counting it here refused that very removal when the pointer came up (F03).
      departing: weights.some((g) => g.seatIndex === undefined && !g.followsPointer),
      held: weights.some((g) => g.followsPointer),
    };
  }, [ghosts]);

  const weightAvailability = useMemo<WeightAvailability>(
    () => ({
      // Nothing goes on while the top disc is in hand: it would be seated above a gap.
      canAdd: !weightsInFlight.departing && !weightsInFlight.held,
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
   * Stack seats whose disc is in the learner's hand (F03). Drawn empty, so a disc pulled up
   * the post is not also still sitting on the pan beneath itself.
   */
  const heldSeats = useMemo(
    () =>
      new Set(ghosts.map((g) => g.sourceIndex).filter((i): i is number => i !== undefined)),
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
    // There is one custom disc, whatever mass it was made for: while any custom mass is
    // off the tray, so is it.
    if ([...hidden].some((grams) => !WEIGHTS.some((w) => w.grams === grams))) {
      hidden.add(customWeightG);
    }
    return hidden;
  }, [state.loadedWeightsG, ghostWeightGrams, customWeightG]);

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
      /** One part, or several measured as one (the flowmeter's two scale plates). */
      name: string | string[],
      action: Action,
      minRadius: number,
      /** Hug the part instead of ballooning to its longest side — see `Hotspot.half`. */
      fitted = false,
      key: string = Array.isArray(name) ? name[0] : name
    ): Hotspot | null => {
      if (!localBox(Array.isArray(name) ? name : [name])) return null;
      tmp.box.getCenter(tmp.center);
      tmp.box.getSize(tmp.size);
      const local = group.worldToLocal(tmp.center.clone());
      const worldRadius = Math.max(tmp.size.x, tmp.size.y, tmp.size.z) * 0.6;
      const radius = THREE.MathUtils.clamp(worldRadius / modelScale, minRadius, 0.18);
      if (!fitted) return { key, position: [local.x, local.y, local.z], radius, action };
      // Half-extents in the group's own units, floored so a disc only 3 mm thick is still
      // worth aiming at. The floor is well under the 0.0847 that separates two discs, so a
      // fitted proxy stays clear of its neighbours in every axis.
      const half = ([tmp.size.x, tmp.size.y, tmp.size.z] as const).map((v) =>
        Math.max(v / modelScale / 2, MIN_HOTSPOT_HALF)
      ) as [number, number, number];
      return { key, position: [local.x, local.y, local.z], radius, half, action };
    };
    const riding = (h: Hotspot | null, follows: 'holder' | 'cover'): Hotspot | null =>
      h ? { ...h, follows } : null;

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
      // The custom disc carries whatever mass the control is set to — unless that mass is
      // one the row already has, when the row's own disc is the one to pick up.
      ...(customIsFixed
        ? []
        : [spot(CUSTOM_WEIGHT_MESH, { kind: 'weight', grams: customWeightG }, 0.022, true)]),
      // Fitted for the same reason the discs are: it sits inside the tank among parts the
      // learner does aim at, so it must not stand in front of them.
      spot(MESH.nozzle, { kind: 'nozzle' }, 0.02, true),
      // F17: the parts that are only looked at. Fitted boxes, like the nozzle, so they do
      // not stand in front of anything; the moving ones ride what carries them.
      spot(MESH.pointer, { kind: 'part', component: 'pointer' }, 0.015, true),
      riding(spot(MESH.spring, { kind: 'part', component: 'spring' }, 0.015, true), 'cover'),
      riding(spot(CARRIER_MESH, { kind: 'part', component: 'weightCarrier' }, 0.015, true), 'holder'),
      spot(FLOWMETER_MESHES, { kind: 'part', component: 'flowmeter' }, 0.02, true),
      // Every deflector seats in the same place on the rod; the 90° one is measured for all.
      riding(
        spot(getDeflector(90).installed, { kind: 'part', component: 'installedDeflector' }, 0.015, true, INSTALLED_KEY),
        'holder'
      ),
    ];

    setHotspots(list.filter((h): h is Hotspot => h !== null));
  }, [scene, groupRef, onAnchors, onInstallFraming, tmp, modelScale, baseY, customWeightG, customIsFixed]);

  /**
   * The flowmeter's column and the measuring tank's water — visual only
   * (`lib/measuringTank.ts`).
   *
   * Measured once the model is placed: where each litre is on the scale (from the
   * graduation quad's own vertices and UVs), and the tank basin's floor and walls (by ray).
   * The frame loop then draws both at the picture's own volume.
   */
  useEffect(() => {
    const group = groupRef.current;
    if (!scene || !group) return;
    group.updateWorldMatrix(true, true);
    const rigInverse = group.matrixWorld.clone().invert();
    const toRig = (world: THREE.Vector3) => world.clone().applyMatrix4(rigInverse);

    const overlay = pick(FLOWMETER_MESHES[1]) as THREE.Mesh | undefined;
    const strip = pick(FLOWMETER_MESHES[0]) as THREE.Mesh | undefined;
    const liquid = pick(MESH.liquid) as THREE.Mesh | undefined;
    const heightOfV = overlay?.isMesh ? heightForV(overlay, toRig) : null;
    litreHeightRef.current = heightOfV ? (litres: number) => heightOfV(litreToV(litres)) : null;
    const fullMap = (liquid?.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
    columnRef.current = strip?.isMesh && fullMap ? applyColumn(strip, fullMap, rigInverse) : null;

    const sink = pick(MEASURING_TANK_MESH);
    const interior = sink ? measureBasin(sink, toRig) : null;
    if (interior) {
      const water = createBasinWater(interior, waterTex);
      group.add(water);
      basinRef.current = { interior, water };
    }
    return () => {
      columnRef.current?.dispose();
      columnRef.current = null;
      const basin = basinRef.current;
      if (basin) {
        basin.water.removeFromParent();
        basin.water.geometry.dispose();
        // The water and its absorption pass (a child sharing the geometry).
        basin.water.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
      }
      basinRef.current = null;
    };
  }, [scene, groupRef, pick, waterTex]);

  /**
   * What the water runs through, measured once the tank is (F08, `src/lib/jetFlow.ts`): the
   * nozzle mouth and tube, the tank's wall and floor, the underside of the cover, and each
   * deflector's wetted underside at rest. Then the pool on the floor it lands in.
   */
  useEffect(() => {
    const group = groupRef.current;
    const mouth = pick(NOZZLE_MOUTH_MESH);
    if (!scene || !group || !tankInterior || !mouth) return;
    group.updateWorldMatrix(true, true);
    const toLocal = (v: THREE.Vector3) => group.worldToLocal(v);
    const toWorld = (v: THREE.Vector3) => group.localToWorld(v);
    const box = new THREE.Box3().setFromObject(mouth, true);
    const lo = toLocal(box.min.clone());
    const hi = toLocal(box.max.clone());
    const min = lo.clone().min(hi);
    const max = lo.clone().max(hi);
    const axis = { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
    const tubeRadius = Math.max(max.x - min.x, max.z - min.z) / 2;
    // Above the deflectors' reach and clear of the rod: the lower plate of the cover.
    const ceiling = measureCeiling(
      scene,
      axis,
      max.y + 0.04,
      [0.03, 0.045, 0.06, 0.075].map((r) => Math.min(r, tankInterior.radius * 0.9)),
      toLocal,
      toWorld
    );
    const geometry: JetGeometry = {
      mouthY: max.y,
      boreRadius: NOZZLE_DIAMETER_M / 2,
      tubeRadius,
      wallRadius: tankInterior.radius,
      floorY: tankInterior.floorY,
      ceilingY: ceiling ?? tankInterior.ceilingY,
    };
    jetGeometryRef.current = geometry;
    jetAxisRef.current = axis;

    const surfaces = new Map<number, WettedSurface>();
    for (const d of DEFLECTORS) {
      const part = pick(d.installed);
      if (!part) continue;
      // Measured wherever the part stands now, and stored at its rest height. Read, never
      // recorded: `baseY` records a part's rest on first use, and that must stay the frame
      // loop's first use, not this measurement's.
      const rest = restY.current[d.installed];
      const restOffset = rest === undefined ? 0 : part.position.y - rest;
      const surface = measureWettedSurface(part, axis, toLocal, toWorld, restOffset);
      if (surface) surfaces.set(d.id, surface);
    }
    wettedRef.current = surfaces;

    const pool = createPoolMesh(
      tubeRadius + FILM_OFFSET_M,
      tankInterior.radius - FILM_OFFSET_M,
      axis,
      tankInterior.floorY + POOL_DEPTH_M,
      waterTex,
      poolUniforms
    );
    pool.visible = false;
    setPoolMesh(pool);
    return () => {
      pool.geometry.dispose();
      (pool.material as THREE.Material).dispose();
    };
  }, [scene, tankInterior, pick, waterTex, poolUniforms]);

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
   * Which part a proxy stands for, in the terms of the one component definition (F17,
   * `domain/componentInfo.ts`). Every surface that names a part — the hover tooltip, the
   * component card, the focus tooltip — goes through this and `describeComponent`, so the
   * names and the numbers in them (the nozzle's bore from `NOZZLE_AREA_M2`, a disc's own
   * mass, a deflector's angle) have one source.
   */
  const refOf = useCallback(
    (action: Action): ComponentRef => {
      switch (action.kind) {
        case 'cover':
          return { key: 'tankCover' };
        case 'deflector':
          return { key: 'deflector', variant: action.id };
        case 'weight':
          return { key: 'weight', variant: action.grams };
        case 'power':
          return { key: 'powerSwitch' };
        case 'flowValve':
          return { key: 'flowValve' };
        case 'volumetricValve':
          return { key: 'volumetricValve' };
        case 'nozzle':
          return { key: 'nozzle' };
        case 'part':
          return action.component === 'installedDeflector'
            ? { key: 'deflector', variant: state.selectedDeflectorId, installed: true }
            : { key: action.component };
      }
    },
    [state.selectedDeflectorId]
  );

  /** A disc on the carrier, by its seat: its own mass, never the pan total. */
  const stackRefOf = useCallback(
    (index: number): ComponentRef | null => {
      const grams = state.loadedWeightsG[index];
      return grams === undefined ? null : { key: 'weight', variant: grams, onCarrier: true };
    },
    [state.loadedWeightsG]
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
      // The disc for this mass, standing on its own tray place: a fixed denomination's tray
      // node, or — for any other mass — the custom weight (F04). Never another mass's disc.
      const def = WEIGHTS.find((w) => w.grams === grams);
      const proto = weightFamily?.discFor(grams) ?? pick(def?.mesh ?? CUSTOM_WEIGHT_MESH);
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
  }, [scene, pick, holderAnchor, state.loadedWeightsG, weightFamily]);

  /** The stack as the highlight callback sees it; a disc on the pan is a clone. */
  const stackRef = useRef(stack);
  stackRef.current = stack;

  // --- Hover label and stale-hover clearing (BEDO-UX-ENV) -------------------------
  //
  // The label text is resolved here from the same authoritative data as before: a tray
  // disc and a disc on the pan both name their own mass, never the pan total.
  //
  // F17: every part now names itself and says what it does, from `describeComponent`, and
  // the last line says how to open its card — a plain click where nothing operational is
  // behind the part, a right-click everywhere (`labelClickOpens`, set on hover).
  const hoverLabel = useMemo(() => {
    if (!labelledKey || sceneHidden) return null;
    let ref: ComponentRef | null = null;
    if (labelledKey.startsWith(STACK_KEY)) {
      ref = stackRefOf(Number(labelledKey.slice(STACK_KEY.length)));
    } else {
      const spot = hotspots.find((h) => h.key === labelledKey);
      ref = spot ? refOf(spot.action) : null;
    }
    if (!ref) return null;
    // The part's card is already open beside it: a second, smaller copy of the same words
    // under the pointer would only cover the card.
    if (inspection?.via === 'click' && inspection.anchorId === anchorIdOf(ref)) return null;
    const text = describeComponent(ref, isArabic ? 'ar' : 'en', { clickOpens: labelClickOpens });
    return { title: text.name, body: text.role, hint: text.hint };
  }, [labelledKey, sceneHidden, hotspots, refOf, stackRefOf, isArabic, labelClickOpens, inspection]);

  useEffect(() => {
    trackCursorTooltip();
  }, []);

  useEffect(() => {
    if (hoverLabel) showCursorTooltip(hoverLabel, isArabic ? 'rtl' : 'ltr', pointerAt.current ?? undefined);
    else hideCursorTooltip();
  }, [hoverLabel, isArabic]);

  useEffect(() => hideCursorTooltip, []);

  // A hovered part can vanish from under a still pointer — a disc flies off, a reset
  // rebuilds the stack, the board covers the scene — and three.js sends no pointer-out
  // for a proxy that is simply unmounted. Drop the hover whenever its target is gone.
  useEffect(() => {
    const present = (key: string | null) => {
      if (!key) return true;
      if (sceneHidden) return false;
      if (key.startsWith(STACK_KEY)) {
        const index = Number(key.slice(STACK_KEY.length));
        return index < state.loadedWeightsG.length && !inFlightSeats.has(index);
      }
      const spot = hotspots.find((h) => h.key === key);
      if (!spot) return false;
      return !(spot.action.kind === 'weight' && hiddenTrayWeightGrams.has(spot.action.grams));
    };
    if (!present(hoveredKey)) setHoveredKey(null);
    if (!present(labelledKey)) setLabelledKey(null);
  }, [hoveredKey, labelledKey, sceneHidden, state.loadedWeightsG.length, inFlightSeats, hotspots, hiddenTrayWeightGrams]);

  // Dev-only: what the cursor label says right now, for the browser checks.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const globals = window as unknown as Record<string, any>;
    globals.__bedoTest = {
      ...globals.__bedoTest,
      hover: () => ({
        hovered: hoveredKey,
        label: currentCursorTooltip(),
        lines: currentCursorTooltipLines(),
        outlined: Array.from(highlighted.current.keys()),
      }),
      // The renderer state and the apparatus group, for browser checks that look at the
      // scene from a chosen angle or probe what is behind a pixel.
      stage: () => ({ three: lastThree.current, group: groupRef.current }),
      // F17: every mounted part proxy, its anchor id and where it is on screen, so a
      // browser check can point at each one.
      parts: () => {
        const t = lastThree.current;
        if (!t) return [];
        const rect = t.gl.domElement.getBoundingClientRect();
        return hotspots
          .filter((h) => proxyRefs.current.has(h.key))
          .map((h) => {
            const v = proxyRefs.current.get(h.key)!.getWorldPosition(new THREE.Vector3()).project(t.camera);
            return {
              key: h.key,
              anchorId: anchorIdOf(refOf(h.action)),
              x: rect.left + ((v.x + 1) / 2) * rect.width,
              y: rect.top + ((1 - v.y) / 2) * rect.height,
              onScreen: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
            };
          });
      },
    };
  });

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
      // No chip is marked while the rod is bare (F09).
      deflectorFitted: state.live.deflectorFitted,
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
      // The board prints two rows: the lesson's two readings, or in free mode the first two
      // the learner recorded (F10), which are readings by construction.
      rows: (state.readingsSource === 'free' ? [0, 1] : [1, 2]).map((index) => {
        const r = state.recordedRows[index];
        // One definition of "recorded" (F15): the monitor's, the counter's and the CSV's.
        // It used to be "has mass on it", which printed the row being balanced — the live
        // tray — as a result.
        const recorded = r !== undefined && state.rowStatuses[index] === 'recorded';
        return {
          recorded,
          flowLMin: recorded ? r.flowRateLMin : 0,
          flowM3S: recorded ? r.flowRateM3S : 0,
          nozzleVelocity: recorded ? r.nozzleVelocityMS : 0,
          impactVelocity: recorded ? r.impactVelocityMS : 0,
          theoreticalForceN: recorded ? r.theoreticalForceN : 0,
          // Free readings carry their own F_ac (F10); guided rows get it at Calculate.
          measuredForceN:
            recorded && (state.isCalculated || state.readingsSource === 'free')
              ? r.measuredForceN
              : null,
        };
      }),
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
  }, [state.live, state.recordedRows, state.rowStatuses, state.readingsSource, state.selectedDeflectorId, state.isCalculated, isArabic]);

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
   * How each deflector's tray copy maps onto its fitted copy, measured once (F03).
   *
   * The GLB is baked, so both copies carry identity transforms and the relation between
   * them is only in their vertices. Where the two share a vertex order the exact rigid
   * transform is recovered (`lib/rigidFit.ts`); otherwise — the 30° and 60° deflectors are
   * separately modelled on the tray — they are taken to differ by a translation, which is
   * what their identical bounds say.
   *
   * Measured at rest: any lift the frame loop has put on the fitted mesh is stripped, as
   * `raiseDeflectorGhost` always did, so the live lift is never counted twice.
   */
  const deflectorPosesRef = useRef(new Map<number, DeflectorPose>());
  const deflectorPoseOf = useCallback(
    (deflectorId: number): DeflectorPose | null => {
      const cached = deflectorPosesRef.current.get(deflectorId);
      if (cached) return cached;
      const group = groupRef.current;
      const deflector = getDeflector(deflectorId);
      const shelf = pick(deflector.shelf);
      const fitted = pick(deflector.installed);
      if (!group || !shelf || !fitted) return null;

      group.updateWorldMatrix(true, false);
      const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
      const lifted = fitted.position.y - baseY(fitted, deflector.installed);
      const vertices = (object: THREE.Object3D, dropY: number): Vec3[] => {
        object.updateWorldMatrix(true, true);
        const out: Vec3[] = [];
        const local = new THREE.Matrix4();
        const v = new THREE.Vector3();
        object.traverse((node) => {
          const mesh = node as THREE.Mesh;
          const position = mesh.isMesh ? mesh.geometry?.getAttribute('position') : undefined;
          if (!position) return;
          local.multiplyMatrices(toGroup, mesh.matrixWorld);
          for (let i = 0; i < position.count; i++) {
            v.fromBufferAttribute(position, i).applyMatrix4(local);
            out.push([v.x, v.y - dropY, v.z]);
          }
        });
        return out;
      };
      const boundsOf = (points: Vec3[]) => {
        const box = new THREE.Box3();
        for (const p of points) box.expandByPoint(dragTmp.point.set(p[0], p[1], p[2]));
        return box;
      };

      const onShelf = vertices(shelf, 0);
      const onRod = vertices(fitted, lifted);
      if (onShelf.length === 0 || onRod.length === 0) return null;
      const rodBox = boundsOf(onRod);
      const fittedPivot = rodBox.getCenter(new THREE.Vector3());
      const size = rodBox.getSize(new THREE.Vector3());

      const rotation = new THREE.Quaternion();
      let shelfPivot: THREE.Vector3;
      const fit = fitRigid(onShelf, onRod);
      // Half a millimetre: a true duplicate fits to rounding error, anything else is not one.
      if (fit && fit.maxResidual < 0.0005) {
        rotation.set(...fit.rotation);
        // The fitted pivot, carried back through the inverse transform onto the tray copy.
        shelfPivot = fittedPivot
          .clone()
          .sub(new THREE.Vector3(...fit.toCentre))
          .applyQuaternion(rotation.clone().invert())
          .add(new THREE.Vector3(...fit.fromCentre));
      } else {
        shelfPivot = boundsOf(onShelf).getCenter(new THREE.Vector3());
      }

      const pose: DeflectorPose = {
        rotation,
        shelfPivot,
        fittedPivot,
        halfHeight: size.y / 2,
        radius: Math.max(size.x, size.z) / 2,
      };
      deflectorPosesRef.current.set(deflectorId, pose);
      return pose;
    },
    [groupRef, pick, baseY, dragTmp]
  );

  /**
   * A deflector clone hung from its pivot, so turning the wrapper turns the part about the
   * rod axis rather than about the GLB's distant shared origin.
   */
  const deflectorWrapper = useCallback(
    (deflectorId: number, pose: DeflectorPose): THREE.Group | null => {
      const shelf = pick(getDeflector(deflectorId).shelf);
      if (!shelf) return null;
      const wrapper = new THREE.Group();
      const inner = new THREE.Group();
      inner.position.copy(pose.shelfPivot).negate();
      inner.add(cloneFor(shelf));
      wrapper.add(inner);
      return wrapper;
    },
    [pick, cloneFor]
  );

  /** How far the pan and rod are off their resting height right now. */
  const liveHolderLift = useCallback(() => coverOffsetRef.current + deflectionRef.current, []);

  /**
   * The parts standing between the tray and the rod that a carried part must go over: the
   * pointer's post (`JET Force 2_212`, 63 mm in front of the rod axis and 1.45 m tall) and
   * the pointer arm clamped to it. Measured where they are *now*, because the arm swings
   * clear when the cover is opened. Measured in the browser, a deflector's old straight
   * route passed straight through both (F03).
   */
  const standingParts = useCallback((): Obstacle[] => {
    const group = groupRef.current;
    if (!group) return [];
    const out: Obstacle[] = [];
    for (const name of [MESH.pointerPin, MESH.pointer]) {
      const object = pick(name);
      if (!object) continue;
      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object, true);
      if (box.isEmpty()) continue;
      const a = group.worldToLocal(box.min.clone());
      const b = group.worldToLocal(box.max.clone());
      const lo = a.clone().min(b);
      const hi = a.clone().max(b);
      out.push({ minX: lo.x, maxX: hi.x, minZ: lo.z, maxZ: hi.z, topY: hi.y });
    }
    return out;
  }, [groupRef, pick]);

  /**
   * The column a carried disc must pass over to reach the post: the pan, the post, and the
   * discs already seated on it — `below` is how many. Apparatus-local, at the live lift.
   */
  const holderColumn = useCallback(
    (below: number, entries: typeof stack, lift: number): Obstacle | null => {
      if (!holderAnchor) return null;
      const [x, surfaceY, z] = holderAnchor.surface;
      const postTip = surfaceY + holderAnchor.postHeight;
      const under = entries[below - 1];
      const stackTop = under ? under.seat[1] + under.thickness / 2 : surfaceY;
      const r = holderAnchor.radius;
      return {
        minX: x - r,
        maxX: x + r,
        minZ: z - r,
        maxZ: z + r,
        topY: Math.max(postTip, stackTop) + lift,
      };
    },
    [holderAnchor]
  );

  /**
   * Where a disc for this seat has to be before it may come down the post: centred on the
   * axis with its underside clear of the post's tip. At rest; the caller adds the live lift.
   */
  const hoverOver = useCallback(
    (entry: (typeof stack)[number]): number => {
      const half = entry.thickness / 2;
      const postTip = holderAnchor
        ? holderAnchor.surface[1] + holderAnchor.postHeight
        : entry.seat[1];
      return Math.max(postTip + half + HANDLING_CLEARANCE, entry.seat[1] + MIN_DISC_APPROACH);
    },
    [holderAnchor]
  );

  /**
   * A flying disc, wrapped so that the wrapper's origin is the disc itself (BEDO-016).
   *
   * The same recentring the stack slots use, so a disc that lifts off the holder is held
   * by the point the learner is looking at rather than by the GLB's distant shared origin
   * — and so a flight's start, its end and the seat it came from are all one arithmetic.
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
        // Another flight may still be carrying this same deflector (a swap reversed while
        // it was under way); then it is that flight's to put down, not this one's.
        const stillCarried = ghostsRef.current.some(
          (g) => g !== ghost && g.deflectorId === ghost.deflectorId
        );
        const shelf = pick(deflector.shelf);
        if (shelf) shelf.visible = !chosen && !stillCarried;
        const installed = pick(deflector.installed);
        if (installed) installed.visible = chosen && !stillCarried;
      } else if (ghost.grams !== undefined) {
        const definition = WEIGHTS.find((w) => w.grams === ghost.grams);
        const tray = pick(definition?.mesh ?? CUSTOM_WEIGHT_MESH);
        const customOnFixedMass =
          !definition && WEIGHTS.some((w) => w.grams === customWeightRef.current);
        if (tray) tray.visible = !loadedWeightsRef.current.includes(ghost.grams) && !customOnFixedMass;
      }
    },
    [pick, lesson.hasInstalledDeflector, state.selectedDeflectorId]
  );

  /**
   * Plans a ghost's route and hands it from the pointer (or from rest) to a timed flight.
   *
   * Every flight is planned here, from where the part actually is right now, so a part the
   * learner let go of in mid-air and a part lifted from rest follow the same rules: whatever
   * it is going onto, it arrives lined up on that thing's axis (F03).
   */
  const startFlight = useCallback(
    (id: string, kind: TransferKind, to: THREE.Vector3, delay = 0) => {
      const ghost = ghostsRef.current.find((g) => g.id === id);
      if (!ghost) return;
      const lift = liveHolderLift();
      const at = ghost.wrapper.position.clone();
      ghost.from = at.clone();
      ghost.to = to.clone();
      ghost.followsPointer = false;
      ghost.liftAtPlan = lift;

      const point = (v: THREE.Vector3, dy = 0): Point3 => [v.x, v.y + dy, v.z];
      const resting = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b) < 0.001;
      const tank = transferObstacle;

      if (ghost.deflectorId !== undefined) {
        const pose = deflectorPoseOf(ghost.deflectorId);
        const radius = pose?.radius ?? 0;
        const halfHeight = pose?.halfHeight ?? 0;
        if (kind === 'deflector-install') {
          // Lifted off the tray, carried over the open tank, lined up under the rod, and
          // threaded up onto it.
          ghost.plan = planHandling({
            start: point(at),
            end: point(to, lift),
            depart: pose && resting(at, pose.shelfPivot) ? DEFLECTOR_TRAY_LIFT : 0,
            approach: -DEFLECTOR_ROD_APPROACH,
            // Carried level at the height of the point under the rod, then threaded up.
            travelHeight: to.y + lift - DEFLECTOR_ROD_APPROACH,
            obstacles: [tank, ...standingParts()],
            radius,
            halfHeight,
          });
          ghost.liftAt = [0, 1];
        } else if (kind === 'deflector-removal') {
          // Unthreaded down off the rod, carried back, and set down in its tray slot.
          ghost.plan = planHandling({
            start: point(at),
            end: point(to),
            depart: -DEFLECTOR_ROD_APPROACH,
            approach: DEFLECTOR_TRAY_LIFT,
            travelHeight: at.y - DEFLECTOR_ROD_APPROACH,
            obstacles: [tank, ...standingParts()],
            radius,
            halfHeight,
          });
          ghost.liftAt = [1, 0];
        } else {
          // Refused or dropped short: back to its tray slot, set down from just above it.
          ghost.plan = planHandling({
            start: point(at),
            end: point(to),
            depart: 0,
            approach: RETURN_APPROACH,
            obstacles: [tank, ...standingParts()],
            radius,
            halfHeight,
          });
          ghost.liftAt = [0, 0];
          ghost.turn = {
            from: ghost.wrapper.quaternion.clone(),
            to: new THREE.Quaternion(),
            spin: null,
          };
        }
      } else {
        const entry =
          ghost.sourceIndex !== undefined ? stackRef.current[ghost.sourceIndex] : undefined;
        const radius = ghost.radius;
        const halfHeight = entry ? entry.thickness / 2 : 0;
        if (kind === 'return-to-source' && entry) {
          // Back down the post onto the seat it was lifted from.
          const hover = hoverOver(entry) + lift;
          ghost.plan = planHandling({
            start: point(at),
            end: point(to, lift),
            depart: 0,
            approach: hover - (to.y + lift),
            travelHeight: travelHeightOver(at.y, hover, DISC_TRAVEL_RISE),
            obstacles: [
              tank,
              holderColumn(entry.index, stackRef.current, lift),
              ...standingParts(),
            ],
            radius,
            halfHeight,
          });
          ghost.liftAt = [0, 1];
        } else {
          // A disc taken off by hand: up the post if it is still on it, then home.
          const hover = entry ? hoverOver(entry) + lift : at.y;
          const onPost = !ghost.clearedPost && at.y < hover;
          ghost.plan = planHandling({
            start: point(at),
            end: point(to),
            depart: onPost ? hover - at.y : 0,
            approach: TRAY_LIFT,
            travelHeight: travelHeightOver(
              onPost ? hover : at.y,
              to.y + TRAY_LIFT,
              DISC_TRAVEL_RISE
            ),
            obstacles: [
              tank,
              entry ? holderColumn(entry.index, stackRef.current, lift) : null,
              ...standingParts(),
            ],
            radius,
            halfHeight,
          });
          ghost.liftAt = [onPost ? 1 : 0, 0];
        }
      }

      transfers.start(id, kind, delay);
      syncGhosts([...ghostsRef.current]);
      // Both surfaces that can install a deflector — the drag and the 2D panel's state
      // change — funnel through here, so this is the one place the camera has to be told.
      // Absolute apparatus-local points; the destination includes the live cover lift.
      if (kind === 'deflector-install') {
        const flight: DeflectorFlight = {
          from: [at.x, at.y, at.z],
          to: [to.x, to.y + coverOffsetRef.current, to.z],
          seconds: durationOf(kind) + delay,
        };
        lastFlightRef.current = flight;
        onDeflectorInstallStart(flight);
      }
    },
    [
      transfers,
      syncGhosts,
      transferObstacle,
      deflectorPoseOf,
      liveHolderLift,
      hoverOver,
      holderColumn,
      standingParts,
      onDeflectorInstallStart,
    ]
  );

  /**
   * Raises a deflector from the tray: a clone in its tray pose, hung from its pivot, that
   * the pointer or a flight can then move. Its destination is the fitted pose at rest.
   */
  const raiseDeflectorGhost = useCallback(
    (deflectorId: number): Ghost | null => {
      const group = groupRef.current;
      const pose = deflectorPoseOf(deflectorId);
      if (!group || !pose) return null;
      const wrapper = deflectorWrapper(deflectorId, pose);
      if (!wrapper) return null;
      wrapper.position.copy(pose.shelfPivot);

      const ghost: Ghost = {
        id: `deflector:${deflectorId}`,
        wrapper,
        deflectorId,
        from: pose.shelfPivot.clone(),
        to: pose.fittedPivot.clone(),
        followsPointer: true,
        liftsWithCover: true,
        arc: 0,
        radius: pose.radius,
        restCentre: new THREE.Vector3(),
        turn: { from: new THREE.Quaternion(), to: pose.rotation.clone(), spin: 'approach' },
      };
      syncGhosts([...ghostsRef.current, ghost]);

      // Slide the carried object on a plane through where it started, square to the
      // camera, so it tracks under the cursor at a constant depth however the learner has
      // orbited the bench.
      camera.getWorldDirection(dragTmp.point);
      dragPlane.setFromNormalAndCoplanarPoint(
        dragTmp.point.clone().negate(),
        group.localToWorld(pose.shelfPivot.clone())
      );
      return ghost;
    },
    [groupRef, deflectorPoseOf, deflectorWrapper, syncGhosts, camera, dragTmp, dragPlane]
  );

  /**
   * The deflector that is on the rod, taken off it (F03).
   *
   * Changing deflectors used to hide the fitted one and show it back on the tray in the same
   * frame, while the new one flew in. Now it comes off the way it went on — unthreaded down
   * the rod axis — and is carried back to its own tray slot before the new one is fitted.
   */
  const raiseFittedDeflectorGhost = useCallback(
    (deflectorId: number): Ghost | null => {
      const pose = deflectorPoseOf(deflectorId);
      if (!pose) return null;
      const wrapper = deflectorWrapper(deflectorId, pose);
      if (!wrapper) return null;
      wrapper.position.copy(pose.fittedPivot).setY(pose.fittedPivot.y + liveHolderLift());
      wrapper.quaternion.copy(pose.rotation);
      const ghost: Ghost = {
        id: `deflector-off:${deflectorId}`,
        wrapper,
        deflectorId,
        from: wrapper.position.clone(),
        to: pose.shelfPivot.clone(),
        followsPointer: false,
        liftsWithCover: true,
        arc: 0,
        radius: pose.radius,
        restCentre: new THREE.Vector3(),
        turn: { from: pose.rotation.clone(), to: new THREE.Quaternion(), spin: 'depart' },
      };
      syncGhosts([...ghostsRef.current, ghost]);
      return ghost;
    },
    [deflectorPoseOf, deflectorWrapper, liveHolderLift, syncGhosts]
  );

  /**
   * The same, for a disc already on the holder. Its home is the tray slot it came from.
   *
   * Only the top disc: the discs are threaded on a post, so the one on top is the only one a
   * hand can take off (F03). The seat it came from is drawn empty while it is held.
   */
  const raiseWeightGhost = useCallback(
    (index: number, entries: typeof stack): Ghost | null => {
      const group = groupRef.current;
      const entry = entries[index];
      if (!group || !entry) return null;

      const wrapper = weightGhostWrapper(entry);
      const lift = liveHolderLift();
      wrapper.position.set(entry.seat[0], entry.seat[1] + lift, entry.seat[2]);

      const grams = state.loadedWeightsG[index];
      const ghost: Ghost = {
        id: `weight:${index}`,
        wrapper,
        grams,
        // Where it was lifted from, at rest — where a refused removal puts it back.
        from: new THREE.Vector3(entry.seat[0], entry.seat[1], entry.seat[2]),
        // Home is the tray slot this disc was cloned from, which is precisely where its
        // baked geometry already sits — `entry.measured` (`docs/39 §8`).
        to: entry.measured.clone(),
        followsPointer: true,
        liftsWithCover: false,
        arc: 0,
        radius: entry.radius,
        restCentre: new THREE.Vector3(),
        sourceIndex: index,
        clearedPost: false,
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
      liveHolderLift,
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
    //
    // The one physical rule is the post's: the discs are threaded on it, so only the top one
    // can be taken off (F03). That is not a lesson policy — it is what the apparatus allows.
    canDrag: (source) => {
      if (sceneHidden) return false;
      if (source.kind === 'weight') return source.index === state.loadedWeightsG.length - 1;
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

      // A disc on the post can only be drawn straight up it until it is clear of the tip;
      // it cannot be pulled sideways through the post or the discs below it (F03).
      const entry =
        ghost.sourceIndex !== undefined ? stackRef.current[ghost.sourceIndex] : undefined;
      if (entry && !ghost.clearedPost) {
        const lift = liveHolderLift();
        const seatY = entry.seat[1] + lift;
        const hover = hoverOver(entry) + lift;
        const y = Math.max(seatY, dragTmp.point.y);
        ghost.wrapper.position.set(entry.seat[0], Math.min(y, hover), entry.seat[2]);
        if (y >= hover) {
          ghost.clearedPost = true;
          ghost.carryTarget = ghost.wrapper.position.clone();
        }
        return;
      }
      if (entry) {
        // Clear of the post: free to go anywhere, but it eases over to the pointer rather
        // than jumping to it — the pointer may be well off to one side by now.
        (ghost.carryTarget ??= new THREE.Vector3()).copy(dragTmp.point);
        return;
      }
      ghost.wrapper.position.copy(dragTmp.point).sub(ghost.restCentre);
    },

    onRelease: (session: DragSession, outcome: DropOutcome) => {
      dropHighlightRef.current = null;
      const ghost = ghostsRef.current.find((g) => g.followsPointer);
      if (!ghost) return;

      if (session.source.kind === 'deflector') {
        // `commit` (a drag onto the rod) and `activate` (a plain click, which is what
        // BEDO's own storyboard describes) are the same request. Only the gate decides.
        const deflectorId = session.source.deflectorId;
        const swapping =
          lesson.hasInstalledDeflector && state.selectedDeflectorId !== deflectorId;
        const accepted = commits(outcome) && onSelectDeflector(deflectorId);
        if (accepted) {
          // Another deflector is on the rod: it comes off first, and this one is held
          // until it has (see the selection observer below).
          startFlight(ghost.id, 'deflector-install', ghost.to, swapping ? DEFLECTOR_REMOVAL_SECONDS : 0);
        } else {
          const pose = deflectorPoseOf(deflectorId);
          startFlight(ghost.id, 'return-to-source', pose ? pose.shelfPivot : ghost.from);
        }
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
        // raised.
        startFlight(ghost.id, 'weight-removal', ghost.to);
      } else {
        // Refused, or let go short: back down the post onto the seat it came from.
        startFlight(ghost.id, 'return-to-source', ghost.from);
      }
    },
  });

  /** Whether the rod was carrying a deflector as of the previous selection. */
  const hadFittedRef = useRef(lesson.hasInstalledDeflector);

  /**
   * The 2D panel's deflector selections, animated the same way — and every swap (F03).
   *
   * The scene watches `selectedDeflectorId` change rather than being told by whichever
   * control caused it (`BEDO-021 §22`), so the panel's list produces BEDO's two-second
   * install exactly as the tray does. The 3D path has already raised this flight by the
   * time this runs, so it is left alone.
   *
   * A swap is two moves, in order. The deflector that was on the rod is unthreaded down
   * the rod axis and carried back to its own tray slot; only then is the new one threaded
   * on. It used to be hidden from the rod and shown back on the tray in the same frame
   * while the new one flew in.
   *
   * A reset or an experiment switch also changes the selected deflector, and neither is a
   * learner installing anything. Both take the lesson back before the step that says a
   * deflector is on the rod, so requiring `hasInstalledDeflector` excludes them.
   *
   * A layout effect, so the part coming off is in the air in the same commit that stops
   * drawing it on the rod.
   */
  useLayoutEffect(() => {
    const previous = selectedDeflectorRef.current;
    selectedDeflectorRef.current = state.selectedDeflectorId;
    const hadFitted = hadFittedRef.current;
    hadFittedRef.current = lesson.hasInstalledDeflector;
    if (previous === state.selectedDeflectorId || !lesson.hasInstalledDeflector) return;

    const next = state.selectedDeflectorId;
    const nextId = `deflector:${next}`;
    let delay = 0;

    // The deflector the learner is moving away from.
    const onItsWay = ghostsRef.current.find((g) => g.id === `deflector:${previous}`);
    if (onItsWay) {
      // It never reached the rod: it goes back to the tray from wherever it is.
      const pose = deflectorPoseOf(previous);
      transfers.cancel(onItsWay.id);
      startFlight(onItsWay.id, 'return-to-source', pose ? pose.shelfPivot : onItsWay.from);
    } else if (hadFitted && !ghostsRef.current.some((g) => g.deflectorId === previous)) {
      const off = raiseFittedDeflectorGhost(previous);
      if (off) {
        startFlight(off.id, 'deflector-removal', off.to);
        delay = DEFLECTOR_REMOVAL_SECONDS;
      }
    }

    // The 3D path raised this one itself, with its own wait.
    if (ghostsRef.current.some((g) => g.id === nextId)) return;

    // The one being fitted may itself be on its way back to the tray (a swap reversed
    // mid-flight). It turns round where it is rather than appearing on the tray.
    const returning = ghostsRef.current.find((g) => g.id === `deflector-off:${next}`);
    if (returning) {
      transfers.cancel(returning.id);
      returning.wrapper.visible = false;
      ghostsRef.current = ghostsRef.current.filter((g) => g !== returning);
    }
    const ghost = raiseDeflectorGhost(next);
    if (!ghost) return;
    if (returning) {
      ghost.wrapper.position.copy(returning.wrapper.position);
      ghost.wrapper.quaternion.copy(returning.wrapper.quaternion);
      ghost.turn = {
        from: returning.wrapper.quaternion.clone(),
        to: ghost.turn!.to,
        spin: 'approach',
      };
    }
    startFlight(nextId, 'deflector-install', ghost.to, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedDeflectorId, lesson.hasInstalledDeflector]);

  /**
   * A disc going *on* to the holder — the other half of BEDO's weight transfer.
   *
   * `Jetforce_Storyboard.pptx` sl. 15, once per denomination: *"When the user clicks on the
   * weight, the weight moves to the tank holder."*; sl. 16 gives the duration, *"in 2
   * seconds"*; and the state machine repeats it as the event on every `Click on the weight`
   * transition (sl. 29, 30, 32).
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
   * The route (F03): lifted out of its tray slot, carried over the shut tank and over the
   * pan, and then set straight down the post onto its seat. Discs added in quick succession
   * may be in the air together, but each one only reaches the top of the post once the one
   * before it has landed, so two can never be on the post at once.
   *
   * A **layout** effect, so the ghost exists and the seat is emptied in the same commit the
   * runtime's change arrives in.
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

    const lift = liveHolderLift();
    const hover = hoverOver(entry) + lift;
    const plan = planHandling({
      start: [from.x, from.y, from.z],
      end: [to.x, to.y + lift, to.z],
      depart: TRAY_LIFT,
      approach: hover - (to.y + lift),
      // Straight up out of the tray to above the post, over, and straight down (F03).
      travelHeight: travelHeightOver(from.y + TRAY_LIFT, hover, DISC_TRAVEL_RISE),
      obstacles: [transferObstacle, holderColumn(index, stack, lift), ...standingParts()],
      radius: entry.radius,
      halfHeight: entry.thickness / 2,
    });

    // Wait, if need be, so this disc reaches the top of the post only after every disc
    // already on its way there has landed.
    const duration = durationOf('weight-install');
    const reachesPost = (plan.phases[0] + plan.phases[1]) * duration;
    const busyFor = ghostsRef.current.reduce(
      (latest, g) =>
        g.seatIndex !== undefined ? Math.max(latest, transfers.remainingOf(g.id) ?? 0) : latest,
      0
    );
    const delay = Math.max(0, busyFor - reachesPost + 0.05);

    const ghost: Ghost = {
      id,
      wrapper,
      grams: state.loadedWeightsG[index],
      from,
      to,
      followsPointer: false,
      // The pan rides the cover and the spring, so the destination has to ride with it.
      liftsWithCover: true,
      arc: 0,
      radius: entry.radius,
      seatIndex: index,
      restCentre: new THREE.Vector3(),
      plan,
      liftAt: [0, 1],
      liftAtPlan: lift,
    };
    ghostsRef.current = [...ghostsRef.current, ghost];
    setGhosts(ghostsRef.current);
    transfers.start(id, 'weight-install', delay);
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
   * The 2D panel's removals, animated the same way — and a cleared stack (F03).
   *
   * `BEDO-021 §22`: the scene watches the state transition rather than being told by
   * whichever control caused it, so the panel button and the disc in the tank produce the
   * same two-second move without either surface knowing about the animation. The 3D path
   * has already raised its own ghost under this id by the time this runs, so it is left
   * alone.
   *
   * Each disc goes the way a hand would take it: drawn straight up the post until it is
   * clear of the tip, carried over the tank, and set down in its tray slot. "Clear all
   * weights" — and the lesson clearing the pan between readings — used to make every disc
   * vanish from the pan and reappear on the tray in the same frame. Now the stack comes off
   * top first, one disc at a time, each starting once the one above it is clear of the post;
   * the ones still waiting their turn stay seated, and still press on the spring.
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

    let removed: number[];
    const single = removedWeightIndex(previous, state.loadedWeightsG);
    if (single !== null) {
      // The disc in the tank was dragged or clicked, and is already flying.
      if (sceneHandledRemovalRef.current) {
        sceneHandledRemovalRef.current = false;
        return;
      }
      removed = [single];
    } else {
      // Several at once — Clear all, or the lesson tidying the pan. Only a stack cut down to
      // a prefix of itself is a set of discs lifted off the top; anything else is not a
      // removal this can animate.
      const next = state.loadedWeightsG;
      const isPrefix =
        next.length < previous.length && next.every((grams, i) => grams === previous[i]);
      if (!isPrefix) return;
      removed = [];
      for (let i = previous.length - 1; i >= next.length; i--) removed.push(i);
    }

    const group = groupRef.current;
    if (!group) return;
    const lift = liveHolderLift();
    const duration = durationOf('weight-removal');
    let delay = 0;
    const launched: Ghost[] = [];
    for (const index of removed) {
      const id = `weight:${index}`;
      if (transfers.has(id) || ghostsRef.current.some((g) => g.id === id)) continue;
      const entry = entries[index];
      if (!entry) continue;

      const wrapper = weightGhostWrapper(entry);
      const seat = new THREE.Vector3(entry.seat[0], entry.seat[1] + lift, entry.seat[2]);
      wrapper.position.copy(seat);
      const hover = hoverOver(entry) + lift;
      const plan = planHandling({
        start: [seat.x, seat.y, seat.z],
        end: [entry.measured.x, entry.measured.y, entry.measured.z],
        depart: hover - seat.y,
        approach: TRAY_LIFT,
        travelHeight: travelHeightOver(hover, entry.measured.y + TRAY_LIFT, DISC_TRAVEL_RISE),
        obstacles: [transferObstacle, holderColumn(index, entries, lift), ...standingParts()],
        radius: entry.radius,
        halfHeight: entry.thickness / 2,
      });

      const ghost: Ghost = {
        id,
        wrapper,
        grams: previous[index],
        // Off the seat it was on, back to the tray slot it came from — the same two points
        // the 3D path uses, so the panel button and the disc in the tank fly identically.
        from: new THREE.Vector3(entry.seat[0], entry.seat[1], entry.seat[2]),
        to: entry.measured.clone(),
        followsPointer: false,
        liftsWithCover: false,
        arc: 0,
        radius: entry.radius,
        restCentre: new THREE.Vector3(),
        plan,
        liftAt: [1, 0],
        liftAtPlan: lift,
      };
      launched.push(ghost);
      transfers.start(id, 'weight-removal', delay);
      // The next disc down starts once this one is off the post.
      delay += Math.max(STACK_CLEAR_STAGGER_SECONDS, plan.phases[0] * duration + 0.05);
    }
    if (!launched.length) return;
    ghostsRef.current = [...ghostsRef.current, ...launched];
    setGhosts(ghostsRef.current);
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
   * Outline a clickable part, the way the reference simulator does (it uses Highlight Plus).
   *
   * Edge only. The part's own material is never touched — no clone, no emissive, nothing
   * to restore — so chrome stays chrome while it is hovered, and a material shared with
   * other meshes cannot carry the highlight to them. See `src/lib/selectionOutline.ts`.
   */
  const setGlow = useCallback(
    (name: string, intensity: number) => {
      let handle = highlighted.current.get(name);
      if (!handle) {
        // A disc on the pan is a clone, so it is found through the stack, not by name.
        const obj = name.startsWith(STACK_KEY)
          ? stackRef.current.find((s) => `${STACK_KEY}${s.index}` === name)?.object
          : pick(name);
        if (!obj) return;
        handle = attachOutline(outlineLayer, obj);
        highlighted.current.set(name, handle);
      }
      handle.setIntensity(intensity);
    },
    [pick, outlineLayer]
  );

  const clearGlow = useCallback((name: string) => {
    const handle = highlighted.current.get(name);
    if (!handle) return;
    handle.dispose();
    highlighted.current.delete(name);
  }, []);

  // Unmount: nothing may be left in the layer.
  useEffect(
    () => () => {
      highlighted.current.forEach((handle) => handle.dispose());
      highlighted.current.clear();
    },
    []
  );

  useFrame((three, rawDelta) => {
    lastThree.current = three;
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
    // Hover only (BEDO-UX-ENV). The outline follows the pointer and nothing else: no guided
    // pulse, no latched selection, no installed-deflector glow. The step still says what
    // to touch — the instruction card and the guide arrow — but no part lights up until
    // the learner's pointer is actually on it.
    const wanted = new Set<string>();
    if (!sceneHidden) {
      if (hoveredKey) wanted.add(hoveredKey);
      // Drop-target feedback while dragging (`BEDO-021 §32`): set only while the pointer
      // is over that region, so it is hover feedback too.
      if (dropHighlightRef.current) wanted.add(dropHighlightRef.current);
    }

    for (const key of Array.from(highlighted.current.keys())) {
      if (!wanted.has(key)) clearGlow(key);
    }
    wanted.forEach((key) => setGlow(key, 1));

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

    // The pilot lamp follows the power state alone, and lights green (`pilotLamp.ts`). Its
    // colour and mask were set once in the material pass; the intensity, and how far the
    // lens's red has faded, move here.
    const lampMat = (pick(MESH.powerLight) as THREE.Mesh | undefined)?.material as
      | THREE.MeshStandardMaterial
      | undefined;
    if (lampMat?.emissive) {
      lampMat.emissiveIntensity = damp(
        lampMat.emissiveIntensity,
        pilotLampIntensity(state.isPowerOn),
        14
      );
      setPilotLampLevel(lampMat, lampMat.emissiveIntensity / PILOT_LAMP_ON_INTENSITY);
    }

    // --- Jet force, spring deflection, pointer ---------------------------------
    // The runtime's answer (F09): a fitted deflector, the pump running, the tank shut, at
    // the student's Q_total. This used to call `jetState` here without Q_total, so the
    // Parameters panel's pump flow never reached the carrier or the pointer.
    const jetForceN = state.live.jetForceOnCarrierN;
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
    // A disc queued to come off — a cleared stack comes off one disc at a time (F03) — is
    // still sitting on the pan until its turn, so it still presses on the spring.
    const waitingToLeaveG = ghostsRef.current.reduce(
      (total, g) =>
        g.grams !== undefined &&
        g.seatIndex === undefined &&
        g.liftAt?.[0] === 1 &&
        transfers.fractionOf(g.id) === 0
          ? total + g.grams
          : total,
      0
    );
    const seatedMassG =
      state.loadedWeightsG.reduce(
        (total, massG, index) =>
          inFlightSeats.has(index) || heldSeats.has(index) ? total : total + massG,
        0
      ) + waitingToLeaveG;
    // F19: the same g and the same grams-to-newtons as F_ac everywhere else.
    const weightForceN = gramsToNewtons(seatedMassG, GRAVITY_MS2);

    // X = h_F - h_w (storyboard sl. 8/19, `domain/spring.ts`), signed: the carrier rises
    // while the jet outweighs the load and sinks below rest while the load outweighs the
    // jet, towards the fixed pointer either way (F05). Capped above by the geometry over
    // the spring, and below by the carrier's mechanical stop — the minimum nozzle
    // clearance for the deflector that is fitted, or the spring's working compression
    // (`lib/carrierTravel.ts`). Past the stop, more load moves nothing.
    const restH = springInfoRef.current
      ? springInfoRef.current.restH
      : SPRING_REST_HEIGHT_MODEL_UNITS;
    const fittedId = lesson.hasInstalledDeflector ? state.selectedDeflectorId : 0;
    const stop = carrierStopsRef.current.get(fittedId) ?? carrierStopsRef.current.get(0);
    const dropMm = stop ? stop.dropMm : springCompressionLimitMm(restH * 1000);
    const targetDeflection = mmToModelUnits(
      springDeflectionMm(jetForceN, weightForceN, springTravelLimitMm(restH), dropMm)
    );
    // The carrier settles on a new load progressively and without overshoot, so its height
    // changes monotonically from one load to the next rather than jumping there in a frame.
    // Never past the stop in between: it starts inside the limits and only moves towards a
    // target that is.
    const deflection = settleToward(deflectionRef.current, targetDeflection, rawDelta);
    // The rod rides this, and so does the drop region measured from it.
    deflectionRef.current = deflection;

    // The pointer is the fixed reference the carrier is balanced against (F05): it is
    // clamped to its own pin, which stands on the apparatus base, at the carrier's rest
    // height. It never moves with the load. It used to ride the carrier's deflection —
    // so it followed the pan it was meant to be read against, and any load looked level.
    // It only swings aside, about its pin, while the cover is open.
    const pointerPivot = pivots.current[MESH.pointer];
    if (pointerPivot) {
      pointerPivot.position.y = baseY(pointerPivot, 'pivot:pointer');
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

    // The central rod carries the pan, so it rides the cover offset and the deflection.
    const rodObj = pick(MESH.rod);
    if (rodObj) {
      rodObj.position.y = baseY(rodObj, MESH.rod) + holderLift;
    }
    // The pointer pin (`JET Force 2_212`) does **not**. It is the thin vertical post the
    // reference pointer is clamped to — the datum the learner reads the pan against — and
    // it is fixed to the apparatus base, not to the cover. It used to be lifted by
    // `holderLift` here alongside the rod, so opening the cover carried the datum up with
    // the plate. It is never written now: its authored transform is its resting transform,
    // through every open/close cycle (BEDO-LOOK-03). The pointer arm keeps its own pivot
    // on this pin and its own spring-driven height below.

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
      // The deflector is screwed to the rod, so it rides exactly the lift the rod rides — the
      // same number, in the same frame. It used to be *damped* towards it while the rod was
      // set directly, so whenever the rod moved the deflector trailed behind: opening the
      // cover left it hanging up to 230 mm below the end of the rod for half a second, in
      // mid-air inside the tank (F03, measured 2026-09-28).
      activeDef.position.y = baseY(activeDef, deflector.installed) + holderLift;
    }

    // --- Water ------------------------------------------------------------------
    //
    // Computed from the simulation's own state, every frame (F08, `src/lib/jetFlow.ts`):
    // the exit velocity and flow the domain computes, the deflector that is actually on the
    // rod — none while it is off it or in the learner's hand — and the height the carrier
    // stands at this frame. The path runs from the nozzle to the pool on the tank's floor.
    const group = groupRef.current;
    const flowing = state.isPowerOn && state.valveOpening > 0.05 && !state.isCoverOpen;
    const edges = flowEdgesRef.current;
    if (flowing && !edges.running) {
      edges.running = true;
      // Re-opening while the last of the water is still draining keeps what is in the air.
      edges.startedAt = t;
    } else if (!flowing && edges.running) {
      edges.running = false;
      edges.stoppedAt = t;
    }
    const jetGeometry = jetGeometryRef.current;
    const jetAxis = jetAxisRef.current;
    const fittedSurface =
      lesson.hasInstalledDeflector && !ghostDeflectorIds.has(deflector.id)
        ? wettedRef.current.get(deflector.id) ?? null
        : null;
    // Water already in the air keeps falling for as long as it takes to reach the pool.
    const draining = !flowing && t - edges.stoppedAt < 1.0 && lastPathRef.current !== null;
    if ((flowing || draining) && group && jetGeometry && jetAxis) {
      // While draining, the water already in the air stays on the path it was on when the
      // flow stopped — opening the cover afterwards must not bend it.
      const paths = flowing
        ? buildJetPaths({
            v0: state.live.nozzleVelocityMS,
            q: state.live.flowRateM3S,
            geometry: jetGeometry,
            deflector: fittedSurface
              ? {
                  surface: fittedSurface,
                  // The deflector rides the rod: the cover offset and the carrier's deflection.
                  liftM: holderLift,
                  nominalDeflectionRad: THREE.MathUtils.degToRad(deflector.id),
                }
              : null,
          })
        : lastPathRef.current!;
      lastPathRef.current = paths;
      writeJetPath(jetFlowMesh.geometry, paths, jetAxis);
      jetFlowMesh.visible = true;
      jetFlowUniforms.uClock.value = t;
      jetFlowUniforms.uFlow.value = flowing ? state.valveOpening : 0;
      // The front leaves the nozzle when the flow starts; the tail when it stops.
      jetFlowUniforms.uHead.value = t - edges.startedAt;
      jetFlowUniforms.uTail.value = flowing ? -1 : t - edges.stoppedAt;
      const lastT = Math.max(...paths.map((p) => (p.points.length ? p.points[p.points.length - 1].t : 0)));
      poolUniforms.uTime.value = t;
      poolUniforms.uFlow.value = flowing ? state.valveOpening : 0;
      poolUniforms.uLanding.value = paths[0].landingRadius;
      // The floor is wet once the front has reached it, and dries after the tail has.
      poolUniforms.uWet.value = flowing
        ? THREE.MathUtils.clamp((t - edges.startedAt - lastT) / 0.3 + 1, 0, 1)
        : THREE.MathUtils.clamp(1 - (t - edges.stoppedAt) / 1.0, 0, 1);
      if (poolMesh) poolMesh.visible = poolUniforms.uWet.value > 0;
    } else {
      jetFlowMesh.visible = false;
      if (poolMesh) poolMesh.visible = false;
    }

    // --- The hose carries what the pump delivers, on the same authority ----------
    //
    // The water moves through the bore at Q / A: it fills the hose from the pump end at that
    // speed when the flow starts, carries its surface along at that speed, and runs out from
    // the pump end when the flow stops. Parcel units are metres at 1 m/s
    // (`CONDUIT_REFERENCE_SPEED`), so the geometry never needs rewriting.
    const hose = hoseRef.current;
    if (hose) {
      const bore = Math.PI * hose.radius * 0.8 * hose.radius * 0.8;
      if (flowing) {
        hose.speed = state.live.flowRateM3S / Math.max(bore, 1e-9);
        if (!hose.running) {
          hose.running = true;
          hose.head = 0;
          hose.tail = -1;
        }
        hose.head = Math.min(hose.head + (hose.speed * rawDelta) / CONDUIT_REFERENCE_SPEED, 1e6);
      } else {
        if (hose.running) {
          hose.running = false;
          hose.tail = 0;
        }
        if (hose.tail >= 0) hose.tail += (Math.max(hose.speed, 0.5) * rawDelta) / CONDUIT_REFERENCE_SPEED;
      }
      // The pattern is carried at a pace the eye can follow (`conduitPatternSpeed`); the
      // front above fills at the true speed.
      hoseUniforms.uClock.value += (flowing ? conduitPatternSpeed(hose.speed) : 0) * rawDelta / CONDUIT_REFERENCE_SPEED;
      hoseUniforms.uHead.value = hose.head;
      hoseUniforms.uTail.value = hose.tail;
      hoseUniforms.uFlow.value = flowing ? state.valveOpening : hose.tail >= 0 && hose.tail < hose.length ? 0.2 : 0;
      hoseUniforms.uSpeed.value = flowing ? hose.speed : 0;
    }

    // --- The supply hose: always full, and running while the pump draws -------------
    const supply = supplyRef.current;
    if (supply) {
      const bore = Math.PI * supply.radius * 0.8 * supply.radius * 0.8;
      const speed = flowing ? state.live.flowRateM3S / Math.max(bore, 1e-9) : 0;
      supplyUniforms.uClock.value += (conduitPatternSpeed(speed) * rawDelta) / CONDUIT_REFERENCE_SPEED;
      supplyUniforms.uFlow.value = flowing ? state.valveOpening : 0;
      supplyUniforms.uSpeed.value = speed;
    }

    // --- The tank fills once more arrives than the drain can carry -------------
    //
    // The second water state the reference shows (t = 74 s, full to just under the cover).
    // Driven by how much water is arriving, which is what the recording actually shows
    // changing — the student turns the *flow* valve, never the volumetric one, and the tank
    // is empty through ten seconds at the lower setpoint. See `src/lib/tankWater.ts`.
    // Gated on the measured interior so the fill starts only once the rig has actually been
    // measured — the same moment it always started. The level no longer *uses* the interior's
    // dimensions, because nothing is drawn from them, but the measurement is still what says
    // the apparatus is ready.
    if (tankInterior) {
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

      // The level is still simulated; it is simply no longer drawn (BEDO-WATER-14).
      //
      // It used to be both at once — the cylinder mesh was the picture of the standing water
      // *and* the thing every other water effect measured its waterline off. Deleting the
      // picture would have taken the measurement with it, so the two were separated first.
      //
      // With the body gone there is no standing water to measure against: the authored plume
      // is the water in the tank, and it is falling through air for its whole length. The
      // submerged-plume convergence that WATER-10 and WATER-13 added existed only to stop the
      // plume reading as a second volume beside the cylinder, and with the cylinder removed it
      // had nothing to converge into — it simply erased the water, leaving an empty glass at
      // high flow. It is gone with the body that justified it.
      //
      // The level itself stays. It is domain-adjacent state that the fill logic owns, it is
      // still advanced every frame from the authoritative inflow, and nothing about removing
      // its visualisation should remove it.
    }

    // --- The flowmeter column and the measuring tank (visual only) -----------------
    // By the bench's rules: shut, the volumetric valve lets the measuring tank collect the
    // water the jet delivers; open, the tank drains. A picture only — no value, reading or
    // step reads it (`lib/measuringTank.ts`). A reset or a new sheet starts it empty.
    if (measuringTankRun.current !== lesson.runId) {
      measuringTankRun.current = lesson.runId;
      measuringTankL.current = 0;
    }
    measuringTankL.current = advanceTankVolume(
      measuringTankL.current,
      state.live.flowRateLMin,
      state.isVolumetricValveOpen,
      delta
    );
    const litreHeight = litreHeightRef.current;
    if (litreHeight) {
      // The tube and the tank are one body of water, so they stand at the same height.
      const levelY = measuringTankL.current > 0 ? litreHeight(measuringTankL.current) : -1e6;
      columnRef.current?.setLevel(levelY);
      const basin = basinRef.current;
      if (basin) {
        setBasinLevel(basin.water, basin.interior, levelY);
        // Water pours into the measuring tank while its valve is shut and the jet runs.
        const stir = basin.water.userData.basinUniforms;
        if (stir) {
          stir.uTime.value = t;
          const target = flowing && !state.isVolumetricValveOpen ? Math.min(state.valveOpening * 1.5, 1) : 0;
          stir.uStir.value += (target - stir.uStir.value) * Math.min(delta * 2, 1);
        }
      }
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
    // The one custom disc: away while any custom mass is on the pan or in the air, and not
    // shown at all when the control is on a mass the row already has.
    const customDisc = pick(CUSTOM_WEIGHT_MESH);
    if (customDisc) {
      const fixed = (grams: number | undefined) =>
        grams === undefined || WEIGHTS.some((w) => w.grams === grams);
      const customAway =
        state.loadedWeightsG.some((grams) => !fixed(grams)) ||
        ghostsRef.current.some((g) => g.grams !== undefined && !fixed(g.grams));
      customDisc.visible = !fixed(customWeightRef.current) && !customAway;
    }

    // --- Ghosts: carried objects and physical transfers ---------------------------
    //
    // The stopwatch runs on real time, like the unscrew sequence: BEDO's two seconds are
    // two seconds, not two seconds' worth of clamped frames.
    if (ghosts.length) {
      const settled = transfers.advance(rawDelta);
      for (const ghost of ghosts) {
        if (ghost.followsPointer && ghost.carryTarget) {
          ghost.wrapper.position.lerp(ghost.carryTarget, 1 - Math.exp(-rawDelta * 18));
        }
        if (ghost.followsPointer || !ghost.plan) continue;
        const fraction = transfers.fractionOf(ghost.id);
        if (fraction === null) continue;
        // Lifted clear, carried over the tank, lined up on the destination's axis, and only
        // then moved onto it (F03, `lib/handlingPath.ts`).
        const sample = sampleHandling(ghost.plan, fraction);
        const [atStart, atEnd] = ghost.liftAt ?? [0, 0];
        // The pan and rod ride the cover and the spring. Whatever part of the route belongs
        // to them follows any change in that lift since the flight was planned.
        const drift = (holderLift - (ghost.liftAtPlan ?? 0)) * liftShare(sample, atStart, atEnd);
        ghost.wrapper.position.set(
          sample.position[0],
          sample.position[1] + drift,
          sample.position[2]
        );
        if (ghost.turn) orientInFlight(ghost.wrapper.quaternion, ghost.turn, sample);
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

    // F17: the spring, the carrier and the fitted deflector ride what carries them, and so
    // do their proxies — the same numbers, in the same frame.
    for (const h of hotspots) {
      if (!h.follows) continue;
      const proxy = proxyRefs.current.get(h.key);
      if (proxy) proxy.position.y = h.position[1] + (h.follows === 'holder' ? holderLift : coverOffsetRef.current);
    }

    // F17: where the inspected part is on screen, for its card. Resolved from the scene's
    // own key when the click gave one, else from the stable anchor id.
    const insp = inspectionRef.current;
    if (!insp || sceneHidden) {
      publishAnchorPoint(null);
    } else {
      const world = projectTmp.current;
      let found = false;
      const key = insp.sceneKey ?? hotspots.find((h) => anchorIdOf(refOf(h.action)) === insp.anchorId)?.key;
      if (key?.startsWith(STACK_KEY)) {
        const disc = stackRef.current.find((d) => `${STACK_KEY}${d.index}` === key)?.object;
        if (disc) {
          disc.getWorldPosition(world);
          found = true;
        }
      } else if (key) {
        const proxy = proxyRefs.current.get(key);
        if (proxy) {
          proxy.getWorldPosition(world);
          found = true;
        }
      }
      if (!found) {
        publishAnchorPoint(null);
      } else {
        world.project(three.camera);
        const rect = three.gl.domElement.getBoundingClientRect();
        const onScreen = world.z > -1 && world.z < 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1;
        publishAnchorPoint({
          x: rect.left + ((world.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - world.y) / 2) * rect.height,
          onScreen,
        });
      }
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

  // --- Hover, click and right-click on the hit proxies (F17) ---------------------------
  //
  // Hover is informational only: it sets the outline, the cursor and the label, and
  // dispatches nothing. Acting on the rig still takes an explicit click on an operational
  // part; a part's card opens on a right-click anywhere, or on a plain click on a part
  // that only answers questions when no control is behind it.

  /** Parts that only answer questions: pressing them does nothing to the rig. */
  const isInfoOnly = (action: Action) => action.kind === 'nozzle' || action.kind === 'part';

  /**
   * Which proxy under the pointer is "the" part.
   *
   * A disc on the pan, whenever one is under the pointer: it sits on the carrier and inside
   * the cover's sphere, and is the most specific thing there. Otherwise the nearest —
   * except that the tank cover's click sphere encloses the pan, the spring, the pointer
   * and the fitted deflector, and would otherwise always win. So when the nearest is the
   * cover and a more precise target is also under the pointer, the nearest precise one is
   * the part. Hover and the card only: the cover's click is untouched.
   */
  const winnerOf = (e: ThreeEvent<PointerEvent | MouseEvent>): THREE.Object3D | null => {
    const hits = e.intersections.filter(
      (i) => i.eventObject.userData.bedoProxy || i.eventObject.userData.bedoStackDisc
    );
    const disc = hits.find((i) => i.eventObject.userData.bedoStackDisc);
    if (disc) return disc.eventObject;
    const nearest = hits[0]?.eventObject ?? null;
    if (!nearest || nearest !== coverHotspotRef.current) return nearest;
    const precise = hits.find(
      (i) => i.eventObject.userData.bedoStackDisc || i.eventObject.userData.bedoProxy?.precise
    );
    return precise?.eventObject ?? nearest;
  };

  const hoverProxy = (
    e: ThreeEvent<PointerEvent>,
    h: Hotspot,
    infoOnly: boolean,
    draggable: boolean
  ) => {
    if (winnerOf(e) !== e.eventObject) {
      // Not this part: step aside without stopping the event, so the winner behind hears it.
      setHoveredKey((k) => (k === h.key ? null : k));
      setLabelledKey((k) => (k === h.key ? null : k));
      return;
    }
    // An operational winner keeps the event; an informational one lets it through, as the
    // nozzle always has — it must not become an obstacle.
    if (!infoOnly) e.stopPropagation();
    if (sceneHidden) return;
    pointerAt.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    // Actionability, not focus: a hotspot the gate would refuse must not offer the same
    // pointer — or the same outline — as one it would accept (BEDO-020 §24). The
    // informational parts outline and name themselves but keep the default cursor,
    // because there is nothing to press.
    if (actionableKeys.has(h.key)) {
      document.body.style.cursor = draggable ? 'grab' : 'pointer';
      setHoveredKey(h.key);
    } else if (infoOnly) {
      setHoveredKey(h.key);
    }
    setLabelledKey(h.key);
    setLabelClickOpens(
      infoOnly && !e.intersections.some((i) => i.eventObject.userData.bedoProxy?.operational)
    );
  };

  /** Where the right button went down, to tell a right-click from a right-drag (a pan). */
  const rightPressAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.button === 2) rightPressAt.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, []);
  const rightPressMoved = (e: MouseEvent) => {
    const at = rightPressAt.current;
    return !!at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 6;
  };

  const inspectProxy = (h: Hotspot) => {
    if (sceneHidden || !onInspectComponent) return;
    const ref = refOf(h.action);
    onInspectComponent({ ref, anchorId: anchorIdOf(ref), via: 'click', sceneKey: h.key });
  };
  const inspectStackDisc = (index: number) => {
    if (sceneHidden || !onInspectComponent) return;
    const ref = stackRefOf(index);
    if (ref) onInspectComponent({ ref, anchorId: anchorIdOf(ref), via: 'click', sceneKey: `${STACK_KEY}${index}` });
  };

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <primitive object={scene} />
      <primitive object={outlineLayer} />

      <group ref={weightStackRef}>
        {stack.map(({ key, object, seat, recentre, index, thickness, radius }) => (
          // The slot's origin *is* the disc's seat on the pan, so the disc and the target
          // the pointer hits cannot drift apart: one is recentred onto this origin, the
          // other simply sits at it (`docs/39 §7`).
          <group
            key={key}
            position={seat}
            visible={!inFlightSeats.has(index) && !heldSeats.has(index)}
          >
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
            {/*
              Only the top disc can be taken off — the discs are threaded on the post (F03).
              The ones beneath are still named on hover, but not outlined or grabbable.

              The proxy stays mounted while its disc is in the learner's hand: the drag holds
              pointer capture on it, and unmounting it would orphan the gesture. Only the disc
              is hidden (the slot group above).
            */}
            {!inFlightSeats.has(index) && (
              <mesh
                userData={{ bedoStackDisc: true }}
                {...(index === stack.length - 1
                  ? drag.handlersFor({ kind: 'weight', index })
                  : {})}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  if (sceneHidden) return;
                  pointerAt.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
                  const key = `${STACK_KEY}${index}`;
                  // Named whatever the gate says — it is a real disc of a real mass — but
                  // outlined only when taking it off would be accepted.
                  setLabelledKey(key);
                  if (weightsAreActionable && index === stack.length - 1) {
                    document.body.style.cursor = 'grab';
                    setHoveredKey(key);
                  }
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.preventDefault();
                  if (!rightPressMoved(e.nativeEvent)) inspectStackDisc(index);
                }}
                onPointerOut={() => {
                  if (!drag.current()) document.body.style.cursor = 'default';
                  const key = `${STACK_KEY}${index}`;
                  setHoveredKey((k) => (k === key ? null : k));
                  setLabelledKey((k) => (k === key ? null : k));
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
        The water (F08): one path from the nozzle to the pool on the tank floor, recomputed
        every frame from the flow, the fitted deflector and the carrier's height — see
        `src/lib/jetFlow.ts`. It replaces BEDO's eight authored caches, which were fixed
        shapes and could follow none of those (`docs/57`).
      */}
      <primitive object={jetFlowMesh} />
      {poolMesh && <primitive object={poolMesh} />}

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
        // F17: the deflector on the rod exists only while one is fitted, and the pointer
        // arm swings clear of the plate while the cover is up — no proxy where no part is.
        if (h.action.kind === 'part') {
          if (h.action.component === 'installedDeflector' && !lesson.hasInstalledDeflector) return null;
          if (h.action.component === 'pointer' && state.isCoverOpen) return null;
        }

        // Deflectors are dragged; everything else is pressed. Note the click path is not
        // lost — a press and release without movement resolves to `activate`, which puts
        // the identical interaction to the gate (`docs/38 §5`).
        const source: DragSource | null =
          h.action.kind === 'deflector' ? { kind: 'deflector', deflectorId: h.action.id } : null;
        const draggable = source !== null;
        // A proxy that only names its part must not become an obstacle in front of one
        // that does something. It takes no click meant for another part and stops no
        // event, so a press aimed at whatever sits behind it still gets there.
        const infoOnly = isInfoOnly(h.action);

        return (
          <mesh
            key={h.key}
            ref={(m: THREE.Mesh | null) => {
              if (h.key === MESH.tankCover) coverHotspotRef.current = m;
              if (m) proxyRefs.current.set(h.key, m);
              else proxyRefs.current.delete(h.key);
            }}
            position={h.position}
            userData={{ bedoProxy: { operational: !infoOnly, precise: !!h.half } }}
            {...(source ? drag.handlersFor(source) : {})}
            onPointerOver={(e) => hoverProxy(e, h, infoOnly, draggable)}
            // Also on move: the winner can change without leaving this proxy — the pointer
            // slides from the cover onto the spring standing inside the cover's sphere.
            onPointerMove={(e) => hoverProxy(e, h, infoOnly, draggable)}
            onPointerOut={() => {
              if (!drag.current()) document.body.style.cursor = 'default';
              setHoveredKey((k) => (k === h.key ? null : k));
              setLabelledKey((k) => (k === h.key ? null : k));
            }}
            // Right-click (a long press on touch) opens the part's card, on any part. A
            // right-*drag* pans the camera, so a press that moved is not a request.
            onContextMenu={(e) => {
              if (winnerOf(e) !== e.eventObject) return;
              e.stopPropagation();
              e.nativeEvent.preventDefault();
              if (rightPressMoved(e.nativeEvent)) return;
              inspectProxy(h);
            }}
            {...(draggable
              ? {}
              : infoOnly
                ? {
                    // A plain click opens the card only when no control is behind the
                    // part: it never takes a click that would have acted on the rig.
                    onClick: (e: ThreeEvent<MouseEvent>) => {
                      if (e.intersections.some((i) => i.eventObject.userData.bedoProxy?.operational)) return;
                      e.stopPropagation();
                      inspectProxy(h);
                    },
                  }
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
          </mesh>
        );
      })}
    </group>
  );
};

useGLTF.preload(assetUrl('Bedo_baked_v2.glb'), true, true, extendWithKTX2);
