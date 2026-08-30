import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The behavioural E2E suite, served the pre-KTX2 apparatus GLB.
 *
 * ## Why this interception exists
 *
 * `public/Bedo_baked_v2.glb` now carries `KHR_texture_basisu`: eight of its images are
 * KTX2, which the GPU samples as ETC2/ASTC. That is a large win in texture residency
 * (814.12 MB -> 394.08 MB) and costs nothing on a real GPU. But this suite runs under
 * Chromium's default renderer, which in CI is SwiftShader, and software rasterisation has
 * to emulate compressed-texture sampling. Measured: the eleven-step lesson takes 15.3 s on
 * the frozen asset and times out past 120 s on the compressed one, purely from that
 * emulation. Software rendering is not a supported performance target for this simulation —
 * the frozen baseline itself only manages about 2 fps in the same synthetic frame test —
 * so the suite is given an asset whose textures need no emulation.
 *
 * This is sound because the two files are the *same model*: the structural gate compares
 * them directly and requires 159 nodes, 128 meshes, 68 materials, identical raw and
 * three-sanitised name sets, identical hierarchy, transforms, accessors, bounds and all 68
 * material definitions. Only the storage of eight images differs. Nothing this suite
 * asserts — node names, geometry, lesson state — can depend on a texture codec.
 *
 * What the codec *can* affect is covered elsewhere and deliberately not here: visual parity,
 * GPU residency, transcode formats, and browser compatibility each have their own gate
 * running against the real production GLB, on hardware Chromium and on real Safari, plus a
 * SwiftShader correctness smoke that proves the compressed asset loads and transcodes.
 *
 * The route is installed on the page before any navigation, so the browser asks for the
 * production URL and never learns it was answered from disk. No application code branches
 * for tests, and no `?glb=` override exists in the runtime.
 */
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/Bedo_baked_v2.functional.glb'
);

/** The apparatus URL the application requests. Unchanged by this release. */
export const APPARATUS_URL = '**/Bedo_baked_v2.glb';

export const test = base.extend({
  // `runTest` rather than Playwright's conventional `use`: the lint rule for React hooks
  // reads a bare `use(...)` call as a hook and rejects it here.
  page: async ({ page }, runTest) => {
    const body = readFileSync(FIXTURE);
    await page.route(APPARATUS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'model/gltf-binary',
        body,
      })
    );
    await runTest(page);
  },
});

export { expect };
