# 49 — KTX2 texture memory (A1)

GPU texture residency only. No lighting, material, glass, water, floor, camera, lesson,
physics or geometry value changes: the apparatus GLB keeps every node, transform, accessor
and material definition it had, and only the *storage* of eight images changes.

    residency   814.12 MB  ->  394.08 MB     -420.04 MB  (-51.65%)
    GLB        11,948,588 B ->  9,288,148 B  -2,660,440 B (-22.3%)

## 1. Scope — eight textures, deliberately

`KHR_texture_basisu`, embedded in `public/Bedo_baked_v2.glb` at its existing URL. Per family,
because one mode does not suit every map:

| img | name | dims | role | mode | runtime format |
|---|---|---|---|---|---|
| 0 | `…_Lightmap` | 4096² | emissive (window mask), sRGB | ETC1S | `RGB_ETC2` 10.67 MB |
| 1 | `…_Normal` | 4096² | normal, linear | UASTC `-normal_map` | `RGBA_ASTC_4x4` 21.33 MB |
| 2 | `…_Diffuse` | 4096² | baseColor, sRGB | ETC1S | `RGB_ETC2` 10.67 MB |
| 3 | `…_Metalness-…` | 4096² | packed metal/rough, linear | UASTC | `RGBA_ASTC_4x4` 21.33 MB |
| 4 | `…_Diffuse-…_A` | 4096² | baseColor for `.002`, alpha 50.7% | ETC1S +alpha | `RGBA_ETC2_EAC` 21.33 MB |
| 10 | `background_uv_small` | 2598×1923 | baseColor, alpha 1.71% | ETC1S +alpha | `RGBA_ETC2_EAC` 6.36 MB |
| 18 | `Jetforce_background` | 4800×2950 | poster baseColor | ETC1S +alpha | `RGBA_ETC2_EAC` 18.02 MB |
| 21 | `numbering_cad` | 413×3602 | baseColor **and** `KHR_materials_transmission` | UASTC +alpha | `RGBA_ASTC_4x4` 1.91 MB |

ETC1S is wrong for the packed metal/rough map — measured against the source it moves the
green channel, roughness, by up to 118/255. UASTC holds that to 13. So packed and
channel-critical maps take UASTC and colour takes ETC1S.

### Two large textures are deliberately left alone

**`Gray metal`** (img 6, 1396×2696) stays its original JPEG. High-frequency noisy metal is
ETC1S's worst case: it dragged `6-weights` to PSNR 41.55 / SSIM 0.977 when every other view
sat above 45 dB, and `-q 255` only reached 43.39. UASTC fixed it (53.56 dB) at 4.1 MB, which
pushed the GLB to 13.0 MB — *larger than the original*. Rejected on transfer, not on quality.
With it restored, `6-weights` moves 2 pixels.

**`rosendal_plains_2_4k.webp`** is a loose `public/` asset feeding `scene.background`, not
part of the apparatus GLB. Unchanged.

Neither is counted as compressed, and neither is queued for a later pass.

## 2. Why the behavioural E2E suite is served a different file

`tests/e2e/fixture.ts` intercepts `/Bedo_baked_v2.glb` and answers from
`tests/fixtures/Bedo_baked_v2.functional.glb`, the pre-KTX2 asset, hash-pinned by
`tests/unit/assets.spec.ts`.

The reason is the renderer, not the asset. This suite runs under Chromium's default, which in
CI is SwiftShader, and software rasterisation has to emulate compressed-texture sampling.
Measured: the eleven-step lesson takes 15.3 s on the frozen asset and times out past 120 s on
the compressed one — with identical draw calls, triangles and shader programs, and identical
frame time on a real GPU. Software rendering is not a supported performance target here; the
frozen baseline itself manages about 2 fps in the same synthetic frame test.

This is safe because the structural gate compares the two files directly and requires 159
nodes, 128 meshes, 68 materials, identical raw *and* three-sanitised name sets, identical
hierarchy, transforms, accessors, bounds and all 68 material definitions. Only eight images
differ in storage. Nothing the behavioural suite asserts can depend on a texture codec.

What the codec *can* affect has its own gates, and those use the real production GLB with no
interception: visual parity across the 14 review views plus the Stage C glass and Stage D
water guards, GPU residency, transcode formats, hardware Chromium, real Safari 26.6.2, and a
SwiftShader smoke that proves the compressed asset loads, transcodes and reaches scene-ready
without error. That last one is correctness coverage, not a performance gate.

## 3. Asset generation

`basisu` 2.50.0. Generation is an explicit step, run **only when the source GLB or its
textures change** — never on an ordinary application build. Reproduced on Cloud Build
(Ubuntu 22.04, amd64): basisu built from source in 252 s, encoding 101 s, structural identity
gate PASS 50/50 inside CI. The Linux output is structurally equivalent to the local one but
not byte-identical, which is expected across compiler and SIMD differences.

Ordinary builds consume the validated GLB as committed. A prebuilt basisu tool image would
remove the 252 s compile from any future regeneration; it is not needed for correctness.

## 4. Cost that is not memory

The JS bundle grows 58,801 B (23.9 KB gzip) for `KTX2Loader` and its `ktx-parse` and
`zstddec` dependencies. This cannot be code-split: drei's `extendLoader` is synchronous,
`useGLTF.preload` runs at module scope, and `KHR_texture_basisu` is in `extensionsRequired`,
so the loader has to be attached before the GLB is parsed. The bundle guard moved
1,300,000 -> 1,380,000 once, deliberately, and is kept.

The Basis transcoder is self-hosted (`public/basis/`, 57,529 B + 527,333 B) rather than
loaded from a CDN, so first load gains no external dependency.

Frame time is unchanged. Paired alternating measurements, five runs per asset per
resolution: 1920x1080 p50 6.10 ms both; 2560x1440 p50 5.30 ms both. Draw calls (417),
triangles (120,602), shader programs and framebuffer binds are identical — there is no new
render pass. Scene-ready improves by roughly a second at every resolution, because KTX2
skips PNG and JPEG decoding.

## 5. This is the end of texture-memory work

Complete at eight textures. No Option B, no Option C, no further compression, no removal of
the room normal atlas, no atlas repacking, no texture resizing, no GLB regeneration for
performance. Gray metal and the outdoor panorama stay as they are.

If network transfer is revisited later it is a separate task with its own measurements,
commit and attribution, and it does not reopen this one.
