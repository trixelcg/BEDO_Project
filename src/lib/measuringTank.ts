// The flowmeter's water column and the measuring tank's water — a picture, nothing more.
//
// **Visual only.** The level follows the bench's rules — while the volumetric valve is
// shut the measuring tank collects the water the jet delivers, and while it is open the
// tank drains — but no result reads it: Q, V₀, V, F_th, the board, the Data Monitor and
// the readings all come from the simulation as before, and nothing waits on the tank. It
// lives here, outside `src/domain`, so that it cannot reach an equation (the same rule as
// `tankWater.ts`'s drain threshold).
//
// ## The column
//
// The bench's sight-tube scale is two stacked quads in the model:
//
//   * `Rectangle002` — the strip with the glass tube down its middle (`numbering`, the tube
//     drawn empty);
//   * `Rectangle003` — the graduations over it (`numbering_cad`, transparent but for the
//     ticks and numbers, 1 to 60 L).
//
// The model also ships `TUBE`, the same strip with the tube drawn full — the material of
// `LIQUID001`, a 7 x 17 mm quad at the foot of the tube that `DeviceModel` has always
// hidden. The column here is that texture, shown on the strip below the water level and
// the empty one above it: the tube fills, and nothing new is modelled.
//
// Where a litre is on the strip is read off the graduations themselves, not chosen:
// `numbering_cad` is 3602 px tall and its 60 ticks sit at row 3601.21 − 59.0421·L
// (least-squares, worst tick 1.2 px off), so 0 L is the strip's lower edge and 60 L is
// 58.7 px below its top. The overlay's own vertices and UVs then give that row's height on
// the rig, measured at load.
//
// ## The tank
//
// The measuring tank is the deep basin in the bench top (`Bing Sink`): its floor is within
// 1 cm of the scale's zero, which is how a sight tube is plumbed. Water is drawn in it at
// the column's height — the tube and the tank are one body of water — over the basin's
// measured floor. Its footprint is measured by casting rays at the basin, so a re-exported
// model moves the water with it.

import * as THREE from 'three';

/** The top graduation of the bench scale, L — read off the scale texture, not chosen. */
export const MEASURING_TANK_CAPACITY_L = 60;

/**
 * How fast the tank empties with the volumetric valve open, L/s.
 *
 * **Invented, presentation only.** No BEDO document gives a drain rate (DEC02); this only
 * sets how quickly the picture empties. Replace it if a figure is supplied.
 */
export const DRAIN_RATE_L_PER_S = 3;

/**
 * The tank's volume `dtS` seconds on, by the bench's rules: shut, it collects the flow
 * arriving (`flowLMin`, the flow the jet delivers); open, it drains. Between empty and the
 * top mark — past that the water overflows.
 */
export function advanceTankVolume(
  volumeL: number,
  flowLMin: number,
  volumetricValveOpen: boolean,
  dtS: number
): number {
  const dt = Math.max(0, dtS);
  const next = volumetricValveOpen
    ? volumeL - DRAIN_RATE_L_PER_S * dt
    : volumeL + (Math.max(0, flowLMin) / 60) * dt;
  return Math.min(MEASURING_TANK_CAPACITY_L, Math.max(0, next));
}

/** The graduation texture's measured rows (see above). */
export const SCALE_TEXTURE = { height: 3602, rowAtZeroL: 3601.21, rowsPerLitre: 59.0421 } as const;

/** Texture v (from the image's top) of the `litres` graduation on `numbering_cad`. */
export const litreToV = (litres: number): number =>
  (SCALE_TEXTURE.rowAtZeroL - SCALE_TEXTURE.rowsPerLitre * litres) / SCALE_TEXTURE.height;

/**
 * Rig-space height as a linear function of a quad's texture v, fitted over its vertices.
 * Null when the quad carries no UVs or no vertical extent.
 */
export function heightForV(mesh: THREE.Mesh, toRig: (world: THREE.Vector3) => THREE.Vector3): ((v: number) => number) | null {
  const pos = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  if (!pos || !uv) return null;
  mesh.updateWorldMatrix(true, false);
  let vMin = Infinity;
  let vMax = -Infinity;
  let yAtMin = 0;
  let yAtMax = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const v = uv.getY(i);
    const y = toRig(p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)).y;
    if (v < vMin) {
      vMin = v;
      yAtMin = y;
    }
    if (v > vMax) {
      vMax = v;
      yAtMax = y;
    }
  }
  if (!(vMax - vMin > 1e-6)) return null;
  const slope = (yAtMax - yAtMin) / (vMax - vMin);
  return (v: number) => yAtMin + (v - vMin) * slope;
}

/**
 * Show the full-tube texture below `levelY` (rig space) on the tube strip. Returns the
 * setter the frame loop calls. Idempotent per material: the material is cloned, so no
 * other mesh that shared it is affected.
 */
export function applyColumn(
  strip: THREE.Mesh,
  fullMap: THREE.Texture,
  rigInverse: THREE.Matrix4
): { setLevel: (levelY: number) => void; dispose: () => void } | null {
  const source = strip.material as THREE.MeshStandardMaterial;
  if (!source || !(source as THREE.MeshStandardMaterial).map) return null;
  const material = source.clone();
  strip.material = material;
  const uniforms = {
    uBedoWorldToRig: { value: rigInverse.clone() },
    uBedoLevelY: { value: -1e6 },
    uBedoFullMap: { value: fullMap },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform mat4 uBedoWorldToRig;
         varying float vBedoRigY;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vBedoRigY = (uBedoWorldToRig * modelMatrix * vec4(transformed, 1.0)).y;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uBedoLevelY;
         uniform sampler2D uBedoFullMap;
         varying float vBedoRigY;`
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
           vec4 sampledDiffuseColor = texture2D( map, vMapUv );
           // Below the water level the tube is the model's own full-tube texture.
           if ( vBedoRigY <= uBedoLevelY ) sampledDiffuseColor = texture2D( uBedoFullMap, vMapUv );
           diffuseColor *= sampledDiffuseColor;
         #endif`
      );
  };
  material.customProgramCacheKey = () => 'bedo-flowmeter-column';
  material.needsUpdate = true;
  return {
    setLevel: (levelY: number) => {
      uniforms.uBedoLevelY.value = levelY;
    },
    dispose: () => {
      strip.material = source;
      material.dispose();
    },
  };
}

/** The measuring tank's interior, in rig space. */
export interface BasinInterior {
  floorY: number;
  min: THREE.Vector2; // x, z
  max: THREE.Vector2;
}

/**
 * Measure the deepest region of a basin mesh: a grid of downward rays finds the floor
 * heights, the lowest band is the tank, and horizontal rays from its middle find its walls.
 */
export function measureBasin(
  basin: THREE.Object3D,
  toRig: (world: THREE.Vector3) => THREE.Vector3,
  gridSize = 24
): BasinInterior | null {
  basin.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(basin);
  if (box.isEmpty()) return null;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const cells: { x: number; z: number; y: number }[] = [];
  for (let i = 0; i < gridSize; i++) {
    for (let k = 0; k < gridSize; k++) {
      const x = box.min.x + ((i + 0.5) / gridSize) * (box.max.x - box.min.x);
      const z = box.min.z + ((k + 0.5) / gridSize) * (box.max.z - box.min.z);
      ray.set(new THREE.Vector3(x, box.max.y + 1, z), down);
      const hit = ray.intersectObject(basin, true)[0];
      if (hit) cells.push({ x, z, y: hit.point.y });
    }
  }
  if (cells.length === 0) return null;
  const floor = Math.min(...cells.map((c) => c.y));
  const band = (box.max.y - box.min.y) * 0.01;
  const deep = cells.filter((c) => c.y <= floor + band);
  const cx = deep.reduce((a, c) => a + c.x, 0) / deep.length;
  const cz = deep.reduce((a, c) => a + c.z, 0) / deep.length;
  const probeY = floor + (box.max.y - box.min.y) * 0.1;
  const wall = (dir: THREE.Vector3): THREE.Vector3 | null => {
    ray.set(new THREE.Vector3(cx, probeY, cz), dir);
    return ray.intersectObject(basin, true)[0]?.point ?? null;
  };
  const px = wall(new THREE.Vector3(1, 0, 0));
  const nx = wall(new THREE.Vector3(-1, 0, 0));
  const pz = wall(new THREE.Vector3(0, 0, 1));
  const nz = wall(new THREE.Vector3(0, 0, -1));
  if (!px || !nx || !pz || !nz) return null;
  // Corners into rig space; the rig is not rotated relative to the world about Y, but
  // taking min/max of both corners keeps this right if it is mirrored.
  const a = toRig(new THREE.Vector3(nx.x, floor, nz.z));
  const b = toRig(new THREE.Vector3(px.x, floor, pz.z));
  return {
    floorY: a.y,
    min: new THREE.Vector2(Math.min(a.x, b.x), Math.min(a.z, b.z)),
    max: new THREE.Vector2(Math.max(a.x, b.x), Math.max(a.z, b.z)),
  };
}

/** Pulled in from the basin walls, so the water cannot z-fight them. */
export const BASIN_WALL_CLEARANCE = 0.002;

/** What moves the measuring tank's water: the clock, and how hard water is arriving. */
export interface BasinUniforms {
  uTime: { value: number };
  /** 0..1: water pouring in stirs the surface; still water only breathes. */
  uStir: { value: number };
  /** Depth of the water, rig metres — the colour deepens with it. */
  uDepth: { value: number };
}

export const createBasinUniforms = (): BasinUniforms => ({
  uTime: { value: 0 },
  uStir: { value: 0 },
  uDepth: { value: 0 },
});

/**
 * Absorption of the tank water, per metre (red, green, blue): water's own order — red
 * goes first, blue last — at a third of the dyed jet's strength (`WATER_ABSORPTION_PER_M`
 * in `waterMaterial.ts`). The jet's is scaled to tint millimetres; over the basin's
 * centimetres it turned a few litres into an opaque aqua slab. At this, a few centimetres
 * read as clear aqua over the white floor and a full tank as deep blue-green.
 */
const BASIN_ABSORPTION_PER_M = [20, 7, 3] as const;

/**
 * The water body in the tank: a box resized each frame to the level.
 *
 * Drawn as water, not as a tinted box: the room reflected in its surface (Fresnel, strong
 * at grazing angles), the floor seen through it and dimmed by depth (Beer–Lambert), and a
 * surface that moves — two drifting ripple fields that always breathe, and rings of chop
 * that grow while water is pouring in. One box, one draw, no extra pass.
 */
export function createBasinWater(
  interior: BasinInterior,
  rippleTexture?: THREE.Texture,
  uniforms: BasinUniforms = createBasinUniforms()
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0); // origin on the floor, so scale.y is the depth
  const material = new THREE.MeshPhysicalMaterial({
    // A dark albedo: the light the water gives back is its reflection and what it
    // scatters, both added below — not a diffuse surface colour.
    color: new THREE.Color('#0b2a33'),
    roughness: 0.04,
    metalness: 0,
    ior: 1.333,
    specularIntensity: 1,
    envMapIntensity: 1.6,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  material.name = 'Water in measuring tank';
  // Left out of the ambient-occlusion pre-pass, like the rest of the water.
  material.userData.seeThrough = true;
  // Reflects the room itself once the probe is taken (`reflectionProbe.ts`).
  material.userData.bedoReflect = 'water';
  if (rippleTexture) {
    material.customProgramCacheKey = () => 'bedo-basin-water';
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, { uWaterTex: { value: rippleTexture } });
      shader.vertexShader =
        'varying vec3 vBasinW;\nvarying vec3 vBasinN;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vBasinW = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vBasinN = normalize(mat3(modelMatrix) * objectNormal);`
        );
      shader.fragmentShader =
        'uniform float uTime;\nuniform float uStir;\nuniform float uDepth;\nuniform sampler2D uWaterTex;\n' +
        'varying vec3 vBasinW;\nvarying vec3 vBasinN;\n' +
        shader.fragmentShader
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
             if (vBasinN.y > 0.5) {
               // Two ripple fields drifting across each other: the surface is never still.
               // Stirred, a faster, finer chop joins them.
               vec2 p = vBasinW.xz;
               vec2 g = (texture2D(uWaterTex, p * 3.1 + vec2(uTime * 0.021, uTime * 0.013)).rg - 0.5) * 0.5
                      + (texture2D(uWaterTex, p * 5.3 - vec2(uTime * 0.017, -uTime * 0.026)).rg - 0.5) * 0.35
                      + (texture2D(uWaterTex, p * 11.0 + vec2(-uTime * 0.09, uTime * 0.07)).rg - 0.5) * 0.9 * uStir;
               vec3 bump = (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz;
               normal = normalize(normal + bump * (0.35 + 0.65 * uStir));
             }`
          )
          .replace('#include <premultiplied_alpha_fragment>', '')
          .replace(
            '#include <opaque_fragment>',
            `#include <opaque_fragment>
             {
               vec3 V = normalize(cameraPosition - vBasinW);
               float cosView = clamp(abs(dot(normalize(vBasinN), V)), 0.05, 1.0);
               // The light here, as a white matte surface would show it.
               vec3 irr = totalDiffuse / max(diffuseColor.rgb, vec3(0.02));
               float light = clamp(dot(irr, vec3(0.2126, 0.7152, 0.0722)), 0.3, 1.1);
               // Down to the floor and back is the path the floor's light takes.
               float path = uDepth / cosView;
               vec3 T = exp(-vec3(${BASIN_ABSORPTION_PER_M.map((k) => k.toFixed(1)).join(', ')}) * path);
               // What is behind the water is tinted by the absorption pass below this one
               // (\`createBasinAbsorption\`); this layer only adds the light the water scatters
               // back — more of it the deeper the water — and dims the floor by as much.
               float a = clamp((1.0 - dot(T, vec3(0.3333))) * 0.45 + 0.1, 0.1, 0.6);
               // What the water scatters back: clear aqua when shallow, blue-green deep.
               // The same water as the jet and the hoses (\`WATER_BODY\` in waterMaterial.ts),
               // deepening from aqua to blue-green with the depth the eye looks through.
               vec3 body = mix(vec3(0.42, 0.7, 0.8), vec3(0.1, 0.36, 0.5), clamp((1.0 - T.g) * 1.6 + 0.25, 0.0, 1.0));
               // Caustic light moving on the floor, seen through shallow water.
               // Two fields at unrelated scales, drifting apart, so the network never repeats.
               float c = texture2D(uWaterTex, vBasinW.xz * 4.7 + vec2(uTime * 0.05, -uTime * 0.04)).b * 0.55
                       + texture2D(uWaterTex, vBasinW.xz * 2.9 + vec2(-uTime * 0.03, uTime * 0.045)).b * 0.45;
               float caustic = pow(1.0 - abs(2.0 * c - 1.0), 10.0) * T.b * (0.25 + 0.5 * uStir);
               gl_FragColor = vec4(totalSpecular * 1.1 + (body * a + vec3(0.85, 0.95, 1.0) * caustic * 0.18) * light, a);
             }`
          );
    };
  } else {
    material.premultipliedAlpha = false;
    material.color.set('#4f8fb3');
    material.opacity = 0.62;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'bedo-measuring-tank-water';
  if (rippleTexture) {
    // Drawn first, with the box's own geometry: it rides the level and hides with it.
    const absorption = createBasinAbsorption(geometry, uniforms);
    mesh.add(absorption);
  }
  mesh.userData.basinUniforms = uniforms;
  const c = BASIN_WALL_CLEARANCE;
  mesh.position.set((interior.min.x + interior.max.x) / 2, interior.floorY, (interior.min.y + interior.max.y) / 2);
  mesh.scale.set(interior.max.x - interior.min.x - 2 * c, 1e-4, interior.max.y - interior.min.y - 2 * c);
  mesh.visible = false;
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * The water's colour on what is seen through it (user, 2026-09-30: "should not be fully
 * clear").
 *
 * Alpha blending can only *dim* the white basin floor behind the water: a single alpha has
 * no colour, so however opaque the water was made, the floor came through grey. Real water
 * tints it — red is absorbed first, blue last (Beer–Lambert) — so the floor under a few
 * centimetres reads aqua, under more, blue-green. This pass multiplies what is already
 * drawn by the water's per-channel transmittance along the line of sight (down to the
 * floor and back up), before the water's own reflection and scattered light are added on
 * top. One more draw of a 12-triangle box.
 */
function createBasinAbsorption(geometry: THREE.BufferGeometry, uniforms: BasinUniforms): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { uDepth: uniforms.uDepth },
    vertexShader: `varying vec3 vW;
      varying vec3 vN;
      void main() {
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: `uniform float uDepth;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float cosView = clamp(abs(dot(normalize(vN), V)), 0.1, 1.0);
        // Down to the floor and back up to the eye.
        float path = 2.0 * uDepth / cosView;
        gl_FragColor = vec4(exp(-vec3(${BASIN_ABSORPTION_PER_M.map((k) => k.toFixed(1)).join(', ')}) * path), 1.0);
      }`,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  material.name = 'Water in measuring tank (absorption)';
  material.userData.seeThrough = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'bedo-measuring-tank-water-absorption';
  mesh.renderOrder = 1;
  return mesh;
}

/** Set the tank water to `levelY` (rig space); hidden while the level is under the floor. */
export function setBasinLevel(water: THREE.Mesh, interior: BasinInterior, levelY: number): void {
  const depth = levelY - interior.floorY;
  water.visible = depth > 0.0005;
  if (water.visible) water.scale.y = depth;
  const uniforms = water.userData.basinUniforms as BasinUniforms | undefined;
  if (uniforms) uniforms.uDepth.value = Math.max(depth, 0);
}
