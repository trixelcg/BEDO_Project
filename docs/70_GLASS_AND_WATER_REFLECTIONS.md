# 70 — Glass and water that reflect the laboratory

Working-tree change on top of docs/69. Not committed, not deployed.

**Request (user, 2026-09-30):** the water and the glass still do not look real. The water should look more realistic, with correct refraction. The glass of the apparatus, the windows and the façades has no reflections.

## Why they looked flat: two causes, both measured

1. **Every glass and water surface reflected a synthetic studio at 45 %.**
   * A material without its own `envMap` reflects `scene.environment`: three's `RoomEnvironment`, a small neutral studio (`studioEnvironment.ts`).
   * three then **overrides** that material's `envMapIntensity` with `scene.environmentIntensity` (`WebGLRenderer`, 0.45 here).
   * So the tank's `envMapIntensity` of 2.0 and the water's 2.2 were ignored, and everything see-through reflected a dim grey room that is not the lab.
2. **The tank glass multiplied its own reflection by its alpha.**
   * It is straight-alpha blended at 0.10 face-on (0.32 at the rim).
   * The room reflected in it therefore arrived at a tenth of its strength.

## What changed

**`src/lib/reflectionProbe.ts` (new), mounted as `LabReflections` in `Scene3D`.**

* A cube map of the actual lab: 256 px, half float, taken once from 35 cm above the tank, about a second after the apparatus is in the graph.
* Everything see-through is hidden while it is taken.
* Radiance is clamped to 16 before the PMREM filter. The first cut did not clamp: sun highlights on polished parts (up to 26,480 in linear) overflowed the blurred levels to Inf, and every surface sampling the probe turned black.
* The probe is given as `envMap` to glass and water only, at intensity 1 (three honours the material's own intensity once it has an `envMap`). The studio still lights everything else as approved.
* Taken from *inside* the tank, the rod and nozzle showed as ghosts in the tank's walls. Hence the position above it.
* Family rule (`reflectiveFamily`):
  * **Glass:** the four glass materials of the two models by name, or anything clear, smooth and transmissive with no map.
  * **Water:** tagged where it is built (`userData.bedoReflect`).
  * The printed transmissive labels are excluded.

**Sheet glass (windows, doors and partitions, campus glazing): `SHEET_GLASS`.**

* Face-on, clear glass reflects 4 %, and against the bright room the panes vanished, leaving frames around air.
* They are now float glass:
  * roughness 0: the authored 0.025–0.035 blurred both the reflection and the view through the pane;
  * specular ×2 (F0 ≈ 0.08, a pane with two faces);
  * a faint green-blue tint;
  * 6 mm of iron-oxide absorption, so the colour deepens at an angle.

**Tank glass (`modelAdapter.applyGlassRim`).**

* Premultiplied: the specular term (Fresnel inside it) at full strength, plus the faint lit body scaled by the alpha.
* The alpha now only dims what is behind. Face-on, the contents are seen as before; the room now shows in the wall.

**Water (`waterMaterial.ts`).**

* `WATER_VISIBILITY.body` 0.5 → 0.28. At 0.5 the jet read as a frosted plastic rod. It now stays visible through its refraction (unchanged: three's transmission, the long-wave normal), its edge light and core line, and the probe's reflection.
* `runoff` 0.18 → 0.08. The film on the tank wall covered the glass as one milky band; water running down clear acrylic is mostly clear, and its rivulets carry what shows.
* Column bubbles are smaller and sparser. At the old size they read as white blotches.
* Hose caustics toned down (sharper, patchier, half the strength). With a real reflection over them they read as contour lines.

## Cost

Dev build, pump running, 180 frames each way:
* 23.5 / 23.9 ms per frame with the probe, 23.9 ms without it: no measurable difference.
* The capture itself costs 86 ms once at load, including shader compilation (about 15 ms if repeated).
* One extra PMREM texture.

## Verified

* New `tests/unit/reflection-probe.spec.ts` (6 tests):
  * who gets the probe and who does not;
  * idempotence;
  * the sheet-glass tuning;
  * the tank wall writes `totalSpecular` unscaled and is not premultiplied twice.
* `tsc -b` is clean. The full suite has the same 13 failures as before this change (docs/69), none of them in rendering.
* Live:
  * the tank reads as clear acrylic with the room reflected in it, and no ghosts;
  * the partitions read as tinted glass with the room in them;
  * the jet reads as a clear, refracting column;
  * the hoses show their water under a real reflection;
  * no shader diagnostics.
