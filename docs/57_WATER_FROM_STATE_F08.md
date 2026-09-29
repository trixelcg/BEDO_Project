# 57 — Water computed from the simulation state (F08)

Working-tree change on top of F03–F07 (`docs/53`–`56`). Not committed, not deployed.

**Observed (QA, F08):** the water is not physically coupled to the nozzle, the deflector or the
receiver:

* it spreads before impact, and even with no deflector;
* the post-impact pattern does not follow the deflector, and can pass through solids;
* it stops mid-path and looks cloth-like;
* it does not reach the base;
* load and flow changes do not change it.

## 1. What was wrong — measured

The water was not simulated. It was eight Alembic caches BEDO authored — one pre-impact column
and one spray per deflector — played back and switched between (`waterCache.ts`,
`waterJet.ts`). A cache is a fixed shape, so none of it could follow the state:

| QA symptom | cause, measured |
|---|---|
| spray with no deflector | The frame loop drew the selected deflector's spray whenever the pump ran: whether or not a deflector was on the rod, and while one was in the learner's hand. |
| spreading before impact / in free space | Each spray's impact is baked at one height. The 90° cache tops out at y 1282.0 mm; the flat deflector's underside is at 1289.5 mm at rest, so the splash sat 7.5 mm below it. The spray did not follow the carrier upward; above rest it stayed as authored. |
| does not reach the deflector | Below 46 % valve — including the first reading, 40 % — the drawn water was `Water_low`, whose top stops at the nozzle mouth (1265.3 mm), 24 mm short of the deflector. The domain still applies the jet's force to the deflector at that reading. |
| through solids | The caches reach below the tank floor (1081.0 mm): 90° to 1062.1, 120° to 1051.6 — up to 29 mm into the base. |
| stops mid-path | To hide that, a fade band (`PLUME_CUT_*`, BEDO-WATER-15) ended every spray in mid-air, 90–170 mm above the floor. |
| flow does nothing | Flow switched between the two caches at one threshold, and changed the ripple speed. |

## 2. The correction

One path per azimuth in the (radius, height) half-plane about the nozzle axis, recomputed every
frame from the state and swept into a single mesh (`src/lib/jetFlow.ts`,
`src/lib/jetFlowMesh.ts`):

1. **Free jet.** It rises straight up from the nozzle mouth at the domain's own exit velocity
   (`nozzleVelocityMS`). It slows under gravity, v² = v0² − 2gh, and widens only by
   continuity, r = r0·√(v0/v), from the 10 mm bore. Nothing spreads in free space.
2. **Contact.** The deflector's underside is measured off its own mesh at load, along each of
   the 40 azimuths the water is drawn at (`measureWettedSurface`): upward rays, first hit, at
   0.5 mm radial steps. It rides the carrier's lift (`holderLift`) every frame.
   * The column rises until its own edge meets that surface. It fills a cup, runs up to a
     cone's apex, or meets a plate.
   * With no deflector on the rod, or one being carried, there is no contact and no
     deflection: the jet runs straight to the cover.
3. **Film.** The water runs along the underside to the rim, 0.6 mm off the surface
   (`FILM_OFFSET_M`), at Bernoulli speed.
4. **Free sheet.** From the rim, at the deflector's deflection angle — the same angle its
   momentum factor comes from — under gravity.
   * The six round deflectors use their nominal angle. The 30° and 60° cones' own measured
     slopes agree to within 3°.
   * The 45° deflector is not round: its underside is a wedge, two 45° faces meeting in a level
     ridge. There the water leaves each azimuth at that azimuth's own slope — 45° up the faces,
     level along the ridge.
5. **On a solid, it follows the solid** — along the cover's underside, down the tank wall, or
   down the outside of the nozzle tube — **to the pool on the floor**, where the path ends. The
   pool is a 2 mm film (`POOL_DEPTH_M`) with rings and foam where the water lands.

Where each solid is:

* The cover's underside is measured where the water meets it: 1356.3 mm, the lower plate.
  `TankInterior.ceilingY` reads `Tank_cover` alone, which sits 8.4 mm higher.
* The nozzle tube's mouth is at 1261.8 mm, radius 15.0 mm. The tank wall and floor come from
  `measureTankInterior`.

**How it looks.** The column is a body of water. Sheets are tinted by their thickness from
continuity, Q / (2πrv), and tear into ligaments as they thin. Run-off on the glass is a clear
film with rivulets — never a tinted body, which is what BEDO-WATER-14 removed.

Ripples, glints and foam are sampled at `uTime − t`, where `t` is how long the water at a vertex
has been travelling since it left the nozzle. The pattern therefore moves along the path at the
water's own speed.

**Starting and stopping.** When the flow starts, the water appears from the nozzle outward at
its travel time. When it stops, the water already in the air finishes its fall on the path it
was on.

**Unchanged:**

* The physics. Nothing in `src/domain` reads any of this.
* The tank level state.
* The hose.

**Retired from drawing:** the eight caches. They are no longer loaded. The files stay in
`public/WaterShapes` and `WATER_SHAPES` still declares them; `waterShapeForFlow`,
`PLUME_CUT_*` and `waterCache.ts` are marked superseded.

## 3. Evidence — running app (local dev build, Chrome, 1920 × 889)

Each deflector was fitted in free mode, at valve 0.4 (reading 1, v0 = 3.336 m/s). Along all
40 azimuths, the path the app drew was read back from the mesh.

| deflector | jet → surface at contact | points inside a solid | first solid the water meets | ends |
|---|---|---|---|---|
| none | — (no contact, no film, no sheet) | 0 | cover, 1355.7 mm (straight column, r 5.00 → 5.23 mm) | pool 1083.0 |
| 45° wedge | 0.60 mm, every azimuth | 0 | faces: cover, 1355.7 mm; ridge: level to the wall | pool 1083.0 |
| 90° | 0.60 mm | 0 | wall, 1284.9 mm | pool 1083.0 |
| 120° | 0.53–0.66 mm | 0 | wall, 1247.1 mm | pool 1083.0 |
| 135° | 0.53–0.67 mm | 0 | wall, 1217.9 mm | pool 1083.0 |
| 180° | 0.44–0.66 mm | 0 | none: a curtain falls past the tube (r 16.0 against 15.0 mm) to the floor | pool 1083.0 |
| 30° | 0.55–0.62 mm | 0 | cover, 1355.7 mm, then the wall | pool 1083.0 |
| 60° | 0.56–0.64 mm | 0 | wall, 1327.1 mm | pool 1083.0 |

The contact gap is the 0.6 mm film offset, so the water meets each deflector where the
deflector actually is.

**Flow** (60° deflector):

| valve | exit velocity | column radius at contact | where the sheet meets the tank |
|---|---|---|---|
| 0.15 | 1.32 m/s | 5.46 mm | wall, 1300.1 mm |
| 0.40 | 3.34 m/s | 5.06 mm | wall, 1327.1 mm |
| 0.60 | 9.23 m/s | 5.01 mm | cover |
| 1.00 | 23.65 m/s | 5.00 mm | cover |

**Carrier** (60° deflector, valve 0.4):

* +500 g: the deflector drops 16.48 mm. The contact drops 16.50 mm, the release 16.4 mm and
  the wall strike 16.3 mm.
* Clear the weights: all of them return exactly.

**Lesson:** reading 1 still balances at 80 g with the water drawn. The console showed no errors.

## 4. Tests

**New:** `tests/unit/f08-acceptance.spec.ts`, 14 tests, all passing. It runs against the
shipped model, with the nozzle, tank, cover and all seven deflectors measured as
`DeviceModel` measures them:

* **Measurement.** The ceiling, floor and mouth are where the model has them. Six deflectors
  measure as round; the 45° wedge does not.
* **AC1:**
  * With no deflector, no path has a film or a sheet.
  * The column only rises, and widens only by continuity.
  * The scene gates the water on `hasInstalledDeflector` and on the deflector not being carried.
* **AC2:** For every deflector, flow and azimuth:
  * the column top and every film point sit exactly the film offset under the measured surface;
  * the sheet releases at the rim.
* **AC3:**
  * The round deflectors release at their angle, and the cones' measured slopes agree.
  * The wedge releases between 45° and level.
  * The first strike orders 30 ≥ 60 > 90 > 120 > 135, and 180 turns back.
  * No two patterns meet the tank in the same place.
* **AC4:** For every deflector, flow and azimuth, every point is:
  * inside the tank;
  * outside the nozzle tube;
  * under the deflector's underside, checked by raycast against the part.
* **AC5:**
  * Every path — each deflector and none, at every flow — ends in the pool and is continuous.
  * No fade band remains.
* **AC6:**
  * The exit speed is the domain's.
  * Contact speed rises and the column narrows with flow.
  * The 60° sheet climbs at least as high.
  * The material advects on parcel time.
* **AC7:** −16.5 mm of carrier moves the contact and the release by −16.5 mm, for every
  deflector.

**Updated for F08.** These specs asserted the cache wiring. The claims that still hold are
kept; the rest are replaced with the F08 equivalents:

* `water-jet.spec.ts` (3 tests);
* `water-uv.spec.ts` (the shader block now reads `jetFlowMesh.ts`);
* `water-surfaces.spec.ts` (visibility, materials, no fade band, clear run-off, hose untouched).

**Whole unit suite:** unchanged apart from the new spec.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci`. `hose-water.spec.ts`, `water-surfaces.spec.ts` and
  `api-surface.spec.ts` cannot load in this environment; the first two were run here with the
  repository path substituted, and both pass.
* **Load cost:** the one-off surface measurement takes about 0.4 s in Node for all seven
  deflectors. Check the load hitch on a low-end device.
* **Pre-baked water files:** `public/WaterShapes` (2.6 MB) still ships but nothing loads it.
  Moving it to `assets-source/` is a separate decision; the asset tests would need updating
  with it.
* **Visual review:** there is no reference footage for the per-deflector patterns. The
  geometry is physical (§2). The look — tint, tearing, rivulets — wants a product-owner pass.

## 6. One water material for the jet and the hose (2026-09-28)

Product-owner request: water that looks more realistic and visibly flows, on the water
shapes and on the hose. Both now wear `src/lib/waterMaterial.ts`:

* **Reflection on top, absorption underneath.** The material is blended premultiplied: the
  room's reflection is added at full strength (Fresnel-weighted, on a near-mirror surface with
  water's index, 1.333), and only the water's own absorption dims what is behind it. A plain
  alpha blend scales the reflection down as well, which is what made the water read as
  tinted plastic.
* **Tint by thickness (Beer–Lambert).** Absorption is 60 / 22 / 9 per metre (red / green /
  blue), the ratios of water scaled for the dyed water in the reference. The 10 mm jet is a
  clear rod with a faint cyan core; a 0.2 mm sheet is next to invisible except for its
  highlights; the hose bore is blue-green through the middle.
* **A surface that flows.** Ripples, bright streaks and bubbles are carried by the water at
  its own speed, and stretched along the flow.
* **Air where the water works.** Foam over the deflector, a torn edge on thinning sheets,
  bubbles in a fast jet and in the hose, rivulets down the glass.
* **The hose.** A clear tube, always drawn. The water inside moves at the flow speed through
  the bore (Q / A), fills the hose from the pump end when the pump starts, and runs out from
  the pump end when it stops. The distance along the tube and the angle round it are measured
  off the hose mesh at load (`measureConduit`), so the flow follows the tube round its bend.
* **Tests:**
  * `water-material.spec.ts` (new, 6): the optics and the configuration.
  * `hose-water.spec.ts`: rewritten for the conduit; the distance along the hose is measured
    on the shipped model.
  * `water-uv`, `water-surfaces` and `f08-acceptance`: retargeted to the shared material.
* **Whole unit suite:** unchanged apart from these.

## 7. Refraction, reflection and surface waves (2026-09-28)

Product-owner request: more reflection and refraction, and more wavy.

* **Refraction.**
  * The jet and the film over the deflector are refracted: what is behind them is seen
    through the water and bent by its surface (three's transmission, index 1.333, a touch of
    dispersion).
  * The refraction depth is exaggerated × 6 (`REFRACTION_DEPTH_SCALE`) so the bending reads at
    lesson distance. The absorption colour is set for the real depth, so the tint is still
    the tint of 10 mm of water.
  * Free sheets and run-off stay a thin blended layer. They are a fraction of a millimetre
    thick and bend nothing visibly. They are drawn by a second material on the same
    geometry (`bedoWaterSheets`).
* **Surface waves** (`WATER_WAVE_*` in `waterMaterial.ts`). There are four trains, laid out on
  distance along the path, not on travel time. A pattern carried at 3 m/s would move several
  wavelengths a frame and read as flicker; the ripples on a real fast jet stand nearly
  still.
  * The two long trains move the surface, so the jet's outline and the sheets ripple.
  * All four tilt the normal per pixel. That tilt is what bends the refracted view and
    breaks up the reflection.
  * Crests focus the light behind them into bright bands.
  * On the column: necking, bending, oval and fine ring modes. On sheets: lobes.
  * Amplitudes stay inside the gaps. The films' waves stay under half the 0.6 mm film
    offset; the 180° curtain's under its 1.0 mm clearance from the nozzle tube.
* **More reflection.** Environment reflection is ×2.2, with more sheen at grazing angles.
* **Defect found and fixed.**
  * The body, sheet and hose materials share one `onBeforeCompile` source, which is
    three's default program cache key. So the jet was compiled once and drawn with the
    hose's shader. Nothing was discarded, the whole tank was refracted blue, and black
    dashed rings appeared where the sheet met the glass.
  * Each kind now has its own cache key and its defines on the material.
* **Tests.** `water-material.spec.ts` now has 12 tests:
  * one program per kind;
  * which kinds refract;
  * the absorption colour is the real depth's;
  * the wave amplitudes stay inside the gaps;
  * the shader moves the surface and tilts the normal;
  * the mesh carries the wave coordinates (`aRun`).

  `water-surfaces` and `hose-water` are retargeted to the new shader lines. Whole unit suite:
  unchanged apart from these.

### Black patches round the jet (QA, 2026-09-29)

**Observed:** black, jagged patches along the jet and at the 45° deflector.

There were four causes, each found by isolating it in the running app:

1. **Ambient occlusion.**
   * **Cause:** the GTAO pre-pass redraws the scene with an override material, and skips
     only materials it can tell are see-through. The sheet layer and the pool are blended at
     opacity 1 with no transmission, so they were kept. The pass drew the whole path mesh,
     jet included, into its depth buffer (the override knows nothing of the discards), and
     shaded a dark halo round it.
   * **Fix:** the water materials set `userData.seeThrough`, and `labPostProcessing` honours
     it.
2. **The water refracting itself.**
   * **Cause:** three draws a double-sided transmissive material's back faces into the
     refraction buffer, with the same shader. The shader then sampled the buffer it was
     being drawn into, and came out black.
   * **Fix:** the water is discarded in that pass (`FLIP_SIDED`). The jet column also drops
     its far faces in the main pass.
3. **Refraction by the fine ripples.**
   * **Cause:** at ×6 depth and the rig's ×1.8 scale, each pixel sampled 108 mm behind the
     jet. The fine ripples sent neighbouring pixels to the bright wall and to the black cover
     plate.
   * **Fix:** refraction now uses the surface and its long waves only. The fine ripples still
     shape the reflection. The depth is now ×3 (`REFRACTION_DEPTH_SCALE`), and the
     absorption distance is scaled by the model's scale, as three scales the ray.
4. **Safety nets.**
   * A normal tilted away from the camera is turned back toward it.
   * Where the refraction buffer is empty, what is straight behind the water fills in.

**Verified:** in the running app, with the 45° deflector (the reported case) at valve 0.4, in
free mode, close up and from the lesson view: no black. The other deflectors were not
re-checked after this fix. Every shader kind, including three's back-face variants,
compiles in headless Chromium.

**Tests:** 3 more in `water-material.spec.ts`, 15 in all. Whole unit suite: unchanged apart
from these.
