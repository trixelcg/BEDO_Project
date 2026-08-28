import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import {
  DeviceModel,
  type DeflectorFlight,
  type InstallFraming,
  type WeightAvailability,
} from './DeviceModel';
import type { LessonView, SimulationView } from '../types/index';
import type { SceneConfig } from '../lib/sceneConfig';
import type { AnchorKey } from '../domain/apparatus';
import { ANCHOR_VIEW, COVER_LIFT, type Anchors } from '../lib/apparatusView';
import { fitDistance, regionOffset, usableRect } from '../lib/cameraFraming';
import { TRANSFER_SECONDS } from '../interaction/transfer';
import { ROOM_ENV_INTENSITY, captureRoomEnvironment } from '../lib/roomEnvironment';
import { classifyMaterial } from '../lib/materialFamilies';

interface Scene3DProps {
  state: SimulationView;
  lesson: LessonView;
  sceneConfig: SceneConfig;
  onCoverClick: () => void;
  /** Returns whether the gate accepted it — the scene animates the transfer only if so. */
  onSelectDeflector: (id: number) => boolean;
  onPowerClick: () => void;
  onFlowValveClick: () => void;
  onVolumetricValveClick: () => void;
  onAddWeight: (grams: number) => void;
  onRemoveWeight: (index: number) => boolean;
  /** What the weights will accept while discs are in flight. See `WeightAvailability`. */
  onWeightAvailability: (availability: WeightAvailability) => void;
}

const LabEnvironment: React.FC<{ config: SceneConfig }> = ({ config }) => {
  const { scene } = useThree();
  const texture = useTexture('/rosendal_plains_2_4k.webp');

  useEffect(() => {
    if (!texture) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.rotation = (config.hdrRotation * Math.PI) / 180;

    // Background only. This is an outdoor panorama seen through the laboratory window,
    // which is exactly what a window should show — but it is a lossy 8-bit WebP of a field,
    // and it used to light the entire room as well. Lighting now comes from the room
    // itself; see `RoomLighting` below and `src/lib/roomEnvironment.ts`.
    scene.background = texture;
    scene.backgroundIntensity = config.hdrLight;

    return () => {
      scene.background = null;
    };
  }, [texture, scene, config.hdrLight, config.hdrRotation]);

  return null;
};

/**
 * Lights the apparatus with the room it stands in.
 *
 * Rendered once, after the model is in the graph: a cube probe at the bench captures the
 * laboratory's own baked surfaces, and PMREM turns that into a roughness pyramid. The
 * apparatus is excluded from its own reflection.
 *
 * Deferred by two frames rather than run on mount — the GLB has to be present, and its
 * materials have to have been classified, or the probe would capture a half-built scene.
 */
const RoomLighting: React.FC<{
  groupRef: React.RefObject<THREE.Group | null>;
  intensity: number;
}> = ({ groupRef, intensity }) => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const captured = useRef(false);

  useFrame(() => {
    if (captured.current) return;
    const group = groupRef.current;
    if (!group || group.children.length === 0) return;

    // Do not capture a half-built room.
    //
    // This used to fire on the first frame the group had any children at all, and the
    // result was a scene that rendered about 10 units of mean luminance darker on roughly
    // half of all loads — the probe sometimes ran before the baked albedo had decoded, so
    // it prefiltered an untextured room and every surface in the apparatus then reflected
    // it. It reproduced by re-running the same build, which is what gave it away.
    //
    // Two conditions, both necessary. The room has to have been classified — until
    // `DeviceModel` runs its material pass the baked surfaces still carry their authored
    // `metalness: 1` and would capture as dark metal. And its colour map has to have an
    // actual decoded image, not merely a texture object.
    // *Every* room material, not the first one found. Waiting on only one still let the
    // probe fire while another wall was untextured, which shifted the captured environment
    // slightly and left two or three views irreproducible between runs.
    let sawRoom = false;
    let allReady = true;
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material || classifyMaterial(material) !== 'roomSurface') continue;
        sawRoom = true;
        const standard = material as THREE.MeshStandardMaterial;
        // Two separate readiness conditions, and the second is easy to miss.
        //
        // The albedo has to have decoded, or the probe prefilters an untextured room. And the
        // material pass has to have *run*: `MergedBake_Baked` ships authored at
        // `metalness: 1`, and a conductor has no diffuse response at all, so a room still in
        // that state captures almost black no matter how brightly it is lit. Classification
        // is by name, which is already true before anything is applied — so the name is not
        // evidence the pass happened. The applied metalness is.
        if (!standard.map?.image) allReady = false;
        if (standard.metalness !== 0) allReady = false;
      }
    });
    // A model with no room at all must not block for ever; it falls through and captures
    // whatever is there, which is the existing degraded-model behaviour.
    if (sawRoom && !allReady) return;

    captured.current = true;

    // The room is identified by material, the same way `DeviceModel` classifies it. The GLB
    // puts the room and the apparatus in one shared hierarchy, so there is no group that
    // means "the room" and no group that means "the apparatus".
    const isRoomSurface = (mesh: THREE.Mesh) => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return !!material && classifyMaterial(material) === 'roomSurface';
    };

    // Stand the probe at the apparatus, measured over the apparatus alone. Measuring the
    // whole group would include the floor and far wall and put the probe out in the room.
    const bounds = new THREE.Box3();
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      // Morph-target meshes are skipped: `Box3` expands over every target and would drag
      // the centre off. See `basePoseBox` in `lib/waterCache.ts`.
      if (!mesh.isMesh || isRoomSurface(mesh) || mesh.morphTargetInfluences) return;
      bounds.expandByObject(mesh);
    });
    const centre = bounds.isEmpty()
      ? new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());

    const room = captureRoomEnvironment(gl, scene, centre, isRoomSurface);
    if (!room) return;
    scene.environment = room.texture;
    scene.environmentIntensity = ROOM_ENV_INTENSITY * intensity;

    // Hand the environment to each material directly, as well as to the scene.
    //
    // `scene.environment` alone lights everything at exactly 1.0: three only consults a
    // material's `envMapIntensity` when that material has its own `envMap`. Without this the
    // per-family response in `materialFamilies.ts` is dead code — a baked wall and an
    // unbaked steel rod receive the room identically, which is wrong in both directions.
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard?.isMeshStandardMaterial || standard.envMap) continue;
        standard.envMap = room.texture;
        standard.needsUpdate = true;
      }
    });
  });

  return null;
};

/**
 * The sun, entering through the window.
 *
 * ## Why a single source
 *
 * The key light used to sit at `[5, 8, 5]` — outside the wall *opposite* the window, aimed
 * back through the room. It lit the apparatus adequately and produced no architecture at all:
 * no beam, no window shadow, nothing on the floor. Measured against the approved reference
 * render, the scene was missing both ends of the tonal range — the darkest 5% of the frame sat
 * at 57/255 where the reference reaches 23, and the brightest 5% stopped at 178 where the
 * reference reaches 216.
 *
 * Both ends come from the same missing thing, so both are fixed by the same addition rather
 * than by two corrective lights: one strong directional source placed *outside the window*.
 * The wall mass then does the work. It occludes the sun everywhere except the aperture, so the
 * beam, the mullion bars across the floor and the deep shade in the protected parts of the
 * room are all consequences of the room's own geometry rather than of anything painted in.
 *
 * ## Placement
 *
 * Azimuth and elevation come from `sceneConfig`, and the light is stood off far enough to sit
 * outside the building shell before being aimed at the apparatus. A directional light has no
 * position in the shading maths — only a direction — but the position still decides where its
 * shadow frustum sits, which is why the stand-off matters.
 */
const SUN_DISTANCE = 26;

const WindowSun: React.FC<{ config: SceneConfig }> = ({ config }) => {
  const light = useRef<THREE.DirectionalLight>(null);

  const position = useMemo(() => {
    const azimuth = (config.sunAzimuth * Math.PI) / 180;
    const elevation = (config.sunElevation * Math.PI) / 180;
    // Negative X: outside the wall the window is cut into.
    const horizontal = Math.cos(elevation) * SUN_DISTANCE;
    return new THREE.Vector3(
      -Math.cos(azimuth) * horizontal,
      Math.sin(elevation) * SUN_DISTANCE,
      Math.sin(azimuth) * horizontal
    );
  }, [config.sunAzimuth, config.sunElevation]);

  // The frustum covers the room, not the apparatus. The old one was 3.2 units across, which
  // is the bench and nothing else — a floor shadow could not have been drawn even if the
  // light had been in the right place.
  return (
    <directionalLight
      ref={light}
      position={position}
      intensity={config.sunIntensity * config.contrast}
      color={config.sunColor}
      castShadow
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.035}
      shadow-camera-left={-14}
      shadow-camera-right={14}
      shadow-camera-top={14}
      shadow-camera-bottom={-14}
      shadow-camera-near={1}
      shadow-camera-far={60}
    />
  );
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

/** World up, for building the camera's own right/up basis when shifting the frame. */
const UP = new THREE.Vector3(0, 1, 0);

const FLIGHT_SECONDS = 1.25;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * The rectangles the 2D overlay covers, measured rather than assumed.
 *
 * The sidebar is 380 px and sits on the left in English, the right in Arabic, and across
 * the top under 800 px. Reading it off the DOM at the moment the flight starts is what lets
 * one framing rule serve all three without the scene knowing which language is on.
 */
const overlayPanels = (): DOMRect[] =>
  Array.from(document.querySelectorAll('.sidebar-panel')).map((el) =>
    el.getBoundingClientRect()
  );

/**
 * Flies the camera to whichever part the current step is about, the way the reference
 * simulator reframes the apparatus between steps. Hands control straight back to
 * OrbitControls afterwards, and aborts the flight if the student grabs the view.
 */
const CameraRig: React.FC<{
  target: AnchorKey | null;
  coverLift: number;
  showMonitor: boolean;
  anchors: Anchors;
  groupRef: React.RefObject<THREE.Group | null>;
  /** Bounds of the deflector/rod/plate group, for the install flight to settle on. */
  installFraming: InstallFraming | null;
  /** Bumped once per accepted tray-to-rod transfer. */
  installSignal: number;
  /** That transfer's real endpoints, so the camera can keep the disc in shot. */
  installFlightPath: DeflectorFlight | null;
  /** Guided flow only — free mode leaves the view to the student (`docs/44 §D9`). */
  guided: boolean;
}> = ({
  target,
  coverLift,
  showMonitor,
  anchors,
  groupRef,
  installFraming,
  installSignal,
  installFlightPath,
  guided,
}) => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as any;
  const size = useThree((s) => s.size);

  const progress = useRef(1);
  const pending = useRef(false);
  /**
   * How long the current flight lasts. Step flights keep their own pace; the install
   * flight has to match the transfer it accompanies, which BEDO fixes at two seconds.
   */
  const duration = useRef(FLIGHT_SECONDS);
  /**
   * True while the guided install move owns the camera. OrbitControls is switched off for
   * exactly that long so it cannot fight the transition, and switched back on the moment
   * the move settles or is cancelled (`docs/44 §D8`).
   */
  const owning = useRef(false);
  const lastInstall = useRef(installSignal);
  /** The deflector transfer the camera is accompanying, in model space. */
  const installFlight = useRef<DeflectorFlight | null>(null);
  /** undefined until the first render settles — see below. */
  const lastTarget = useRef<AnchorKey | null | undefined>(undefined);
  const pendingInstall = useRef(false);
  const from = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  const to = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const scratch2 = useMemo(() => new THREE.Vector3(), []);
  /**
   * Everything the install move needs to recompose itself each frame: the head it settles
   * on, the disc's real path, and the viewport it was measured against. Null for step
   * flights, which keep their fixed destination.
   */
  const transit = useRef<{
    headCentre: THREE.Vector3;
    headRadius: number;
    dir: THREE.Vector3;
    right: THREE.Vector3;
    up: THREE.Vector3;
    discFrom: THREE.Vector3;
    discTo: THREE.Vector3;
    initialDistance: number;
    canvas: { left: number; top: number; width: number; height: number };
    region: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const quat = useMemo(() => new THREE.Quaternion(), []);

  // Fly when the focused part *changes*, not on first paint. Step 1 focuses the cover, so
  // flying on mount snapped the camera to a close-up of the plate and the student never
  // saw the bench they were standing at.
  useEffect(() => {
    if (showMonitor) return;
    if (lastTarget.current === undefined) {
      lastTarget.current = target;
      return;
    }
    if (target === lastTarget.current) return;
    lastTarget.current = target;
    if (!target || !anchors[target]) return;
    pending.current = true;
  }, [target, showMonitor, anchors]);

  // A drag or scroll means the student wants to look somewhere else — stop fighting them.
  // Not during the install move: that one deliberately owns the camera, and OrbitControls
  // is disabled for its duration so it cannot emit this at all.
  useEffect(() => {
    if (!controls) return;
    const abort = () => {
      if (owning.current) return;
      pending.current = false;
      progress.current = 1;
    };
    controls.addEventListener('start', abort);
    return () => controls.removeEventListener('start', abort);
  }, [controls]);

  /** Hands the view back to the student. Safe to call when it was never taken. */
  const release = useCallback(() => {
    if (!owning.current) return;
    owning.current = false;
    if (controls) controls.enabled = true;
  }, [controls]);

  // The deflector has been accepted and is on its way. Start moving now rather than when
  // it lands, so the learner can see where it is going (`docs/44 §D3`).
  useEffect(() => {
    if (installSignal === lastInstall.current) return;
    lastInstall.current = installSignal;
    if (!guided || showMonitor || !installFraming) return;
    installFlight.current = installFlightPath;
    pendingInstall.current = true;
  }, [installSignal, guided, showMonitor, installFraming, installFlightPath]);

  // Every cancellation path: a reset or experiment change takes the lesson off the install
  // step, the monitor takes the camera elsewhere, free mode hands the view back, and
  // unmount tears the whole rig down. None of them may leave the camera locked.
  useEffect(() => {
    if (!guided || showMonitor) {
      pendingInstall.current = false;
      if (owning.current) {
        progress.current = 1;
        release();
      }
    }
  }, [guided, showMonitor, release]);

  useEffect(() => release, [release]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!controls || !group) return;

    if (pendingInstall.current && installFraming) {
      pendingInstall.current = false;
      group.updateWorldMatrix(true, false);

      // Bounds, in world. The radius is carried through the same matrix as the centre so
      // the apparatus group's scale is applied rather than assumed.
      const centre = group.localToWorld(scratch.set(...installFraming.center));
      const edge = group.localToWorld(
        scratch2.set(
          installFraming.center[0] + installFraming.radius,
          installFraming.center[1],
          installFraming.center[2]
        )
      );
      const radius = centre.distanceTo(edge);

      // The direction the cover is always framed from. Reused rather than re-invented:
      // the plate is precisely what the learner reaches for next, so the house angle for
      // it is the right angle to settle on (`docs/44 §D5`).
      const dir = scratch2
        .set(...ANCHOR_VIEW.cover.offset)
        .applyQuaternion(group.getWorldQuaternion(quat))
        .normalize();

      const canvas = { left: size.left, top: size.top, width: size.width, height: size.height };
      const region = usableRect(canvas, overlayPanels());
      const distance = fitDistance(radius, (camera as THREE.PerspectiveCamera).fov, canvas, region);

      from.pos.copy(camera.position);
      from.target.copy(controls.target);

      // `to` is the destination **without** the panel offset. The offset used to be baked
      // in here, which meant the lerp applied it in proportion to the clock — and that is
      // what walked the incoming disc behind the sidebar between 74% and 91% of the
      // transfer. It is now a separate term, ramped by the disc's own arrival below.
      to.target.copy(centre);
      to.pos.copy(centre).addScaledVector(dir, distance);

      // The camera's own basis at the destination, for placing that offset.
      // Kept in vectors of their own: `scratch`/`scratch2` are shared and are reused below.
      const forward = scratch.copy(to.target).sub(to.pos).normalize();
      const rightKeep = new THREE.Vector3().crossVectors(forward, UP).normalize();
      const upKeep = new THREE.Vector3().crossVectors(rightKeep, forward).normalize();

      const flight = installFlight.current;
      transit.current = flight
        ? {
            headCentre: centre.clone(),
            headRadius: radius,
            dir: dir.clone(),
            right: rightKeep,
            up: upKeep,
            discFrom: group.localToWorld(new THREE.Vector3(...flight.from)),
            discTo: group.localToWorld(new THREE.Vector3(...flight.to)),
            initialDistance: 0,
            canvas,
            region,
          }
        : null;
      if (transit.current) {
        transit.current.initialDistance = transit.current.discFrom.distanceTo(
          transit.current.discTo
        );
      }

      // The camera travels for exactly as long as the disc does, so the two read as one
      // movement. `TRANSFER_SECONDS` is BEDO's number, not a tuning choice.
      duration.current = TRANSFER_SECONDS;
      progress.current = 0;
      pending.current = false;
      owning.current = true;
      controls.enabled = false;
    }

    if (pending.current) {
      duration.current = FLIGHT_SECONDS;
      transit.current = null;
      const anchor = target ? anchors[target] : undefined;
      const view = target ? ANCHOR_VIEW[target] : undefined;
      if (!anchor || !view) return;

      // Step 3 asks the student to press the plate again, and by then the plate is up in
      // the air — so frame it where it now is, not where it started.
      const lift = target === 'cover' ? coverLift : 0;

      from.pos.copy(camera.position);
      from.target.copy(controls.target);

      // Anchor and offset are both in model space, so convert after adding.
      to.target.copy(group.localToWorld(scratch.set(anchor[0], anchor[1] + lift, anchor[2])));
      to.pos.copy(
        group.localToWorld(
          scratch.set(
            anchor[0] + view.offset[0],
            anchor[1] + lift + view.offset[1],
            anchor[2] + view.offset[2]
          )
        )
      );

      progress.current = 0;
      pending.current = false;
    }

    if (progress.current >= 1) return;

    progress.current = Math.min(1, progress.current + delta / duration.current);
    const k = easeInOut(progress.current);

    const t = transit.current;
    if (t) {
      // Where the disc actually is, on the path the runtime is flying it along and with
      // the same easing the transfer uses.
      const disc = scratch.lerpVectors(t.discFrom, t.discTo, k);

      // Arrival, from the disc's own remaining distance — not from the clock and not from
      // a chosen exponent. Zero when it sets off, exactly one when it lands.
      const arrival =
        t.initialDistance > 1e-9
          ? Math.min(1, Math.max(0, 1 - disc.distanceTo(t.discTo) / t.initialDistance))
          : 1;

      // Smallest sphere containing both the head and the disc. As the disc arrives this
      // collapses onto the head sphere exactly, so the settle framing is the one already
      // validated — nothing is blended toward it approximately.
      const away = disc.distanceTo(t.headCentre);
      let unionRadius = t.headRadius;
      scratch2.copy(t.headCentre);
      if (away > t.headRadius) {
        unionRadius = (away + t.headRadius) / 2;
        scratch2.addScaledVector(
          disc.clone().sub(t.headCentre).divideScalar(away),
          unionRadius - t.headRadius
        );
      }

      const fov = (camera as THREE.PerspectiveCamera).fov;
      const distance = fitDistance(unionRadius, fov, t.canvas, t.region);
      const shift = regionOffset(t.canvas, t.region, distance, fov);

      // The pose that frames the union, with the panel offset applied only as far as the
      // disc has arrived.
      to.target.copy(scratch2).addScaledVector(t.right, shift.right * arrival);
      to.target.addScaledVector(t.up, shift.up * arrival);
      to.pos.copy(to.target).addScaledVector(t.dir, distance);
    }

    camera.position.lerpVectors(from.pos, to.pos, k);
    controls.target.lerpVectors(from.target, to.target, k);
    controls.update();

    // Settled. Hand the view straight back — no extra click, and nothing left locked.
    if (progress.current >= 1) release();
  });

  return null;
};

export const Scene3D: React.FC<Scene3DProps> = ({
  state,
  lesson,
  sceneConfig,
  onCoverClick,
  onSelectDeflector,
  onPowerClick,
  onFlowValveClick,
  onVolumetricValveClick,
  onAddWeight,
  onRemoveWeight,
  onWeightAvailability,
}) => {
  const apparatusRef = useRef<THREE.Group>(null);
  const [anchors, setAnchors] = useState<Anchors>({});
  const handleAnchors = useCallback((next: Anchors) => setAnchors(next), []);
  const [installFraming, setInstallFraming] = useState<InstallFraming | null>(null);
  const handleInstallFraming = useCallback(
    (next: InstallFraming | null) => setInstallFraming(next),
    []
  );
  /**
   * A counter rather than a boolean: two installs in a row are two separate camera moves,
   * and a boolean that is already true cannot say so.
   */
  const [installSignal, setInstallSignal] = useState(0);
  const [installFlightPath, setInstallFlightPath] = useState<DeflectorFlight | null>(null);
  const handleInstallStart = useCallback((flight: DeflectorFlight) => {
    setInstallFlightPath(flight);
    setInstallSignal((n) => n + 1);
  }, []);

  // Only the guided flow drives the camera; in free mode the student owns the view. Both
  // of these are answered by the lesson runner now — the step says what it is about, and
  // where the camera should stand if that differs. The first step points its arrow at the
  // plate but frames the whole bench, so the app opens on the view the operator stands in.
  const focusTarget: AnchorKey | null = lesson.target;
  const cameraTarget: AnchorKey | null = lesson.cameraView;

  return (
    <div className="canvas-container">
      <Canvas
        shadows="percentage"
        // Open where the operator stands: in front of the bench (-X), the view the
        // reference video starts on. This used to sit at +Z, behind the rig.
        camera={{ position: [-3.7, 0.95, -0.2], fov: 42 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <RendererController config={sceneConfig} />

        <Suspense fallback={null}>
          <LabEnvironment config={sceneConfig} />
        </Suspense>

        {/*
          A restrained hierarchy: the room's own environment does the ambient work, so this
          is only a key light for shape and contact.

          Two orange fills used to sit here at 0.3 and 0.4 (#f58220, #ff9100). Nothing in the
          model or the reference recording calls for orange light — the laboratory is lit
          white — and their only effect was to wash out the contrast the key light provides.
          Removed rather than dimmed.

          Ambient is kept low and neutral. The room bake already carries indirect light, so a
          bright ambient on top is double-lighting the very surfaces that are already lit.
        */}
        <ambientLight
          intensity={sceneConfig.selfIllumination * 0.5 * (2.0 - sceneConfig.contrast)}
          color={sceneConfig.ambientColor}
        />

        <WindowSun config={sceneConfig} />

        {/*
          Grounding. Kept, and tightened: the old 6-unit scale spread the same shadow budget
          over four times the area the bench actually occupies, so the contact under the
          apparatus was soft to the point of not reading as contact at all.
        */}
        <ContactShadows
          position={[0, -1.808, 0]}
          opacity={0.75}
          scale={3.2}
          blur={1.6}
          far={1.4}
          resolution={1024}
        />

        <Suspense fallback={<ModelLoadingPlaceholder />}>
          <DeviceModel
            state={state}
            lesson={lesson}
            focusTarget={focusTarget}
            groupRef={apparatusRef}
            anchors={anchors}
            onAnchors={handleAnchors}
            onCoverClick={onCoverClick}
            onSelectDeflector={onSelectDeflector}
            onInstallFraming={handleInstallFraming}
            onDeflectorInstallStart={handleInstallStart}
            onPowerClick={onPowerClick}
            onFlowValveClick={onFlowValveClick}
            onVolumetricValveClick={onVolumetricValveClick}
            onAddWeight={onAddWeight}
            onRemoveWeight={onRemoveWeight}
            onWeightAvailability={onWeightAvailability}
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

        <RoomLighting groupRef={apparatusRef} intensity={sceneConfig.hdrLight} />

        <CameraRig
          target={cameraTarget}
          coverLift={state.isCoverOpen ? COVER_LIFT : 0}
          showMonitor={state.showMonitor}
          anchors={anchors}
          groupRef={apparatusRef}
          installFraming={installFraming}
          installSignal={installSignal}
          installFlightPath={installFlightPath}
          guided={lesson.isGuided}
        />

        {/* makeDefault publishes the controls so CameraRig can drive them. */}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2 + 0.25}
          minDistance={0.6}
          maxDistance={8}
          target={[0, -0.1, -0.2]}
        />
      </Canvas>
    </div>
  );
};
