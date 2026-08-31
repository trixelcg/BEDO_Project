import { RUNTIME_ASSET_MANIFEST } from '../generated/assetManifest';

/**
 * Resolve a runtime asset to a URL that is safe during a Cloud Run traffic split.
 *
 * Cloud Run routes every request independently, so during a canary the HTML can come from
 * one revision and a later asset request from another. A stable name like
 * `/Bedo_baked_v2.glb` exists on both revisions, so such a request does not 404 — it
 * quietly returns the *other* generation's bytes. That is how a bundle built against the
 * A1 model ends up rendering the frozen v2 model with nothing in the console to say so.
 *
 * In a production build each versioned asset therefore resolves to a content-addressed
 * path (`/runtime/<hash>/Bedo_baked_v2.glb`). Two generations occupy two distinct URLs,
 * both live in the shared bucket simultaneously, and whichever revision answers returns
 * the bytes that bundle was built against.
 *
 * In development the plain name is used: the Vite dev server serves `public/` at the root
 * and knows nothing about content-addressed paths. The E2E suite runs against that dev
 * server, so it exercises the same files under the names they have on disk.
 */
export const assetUrl = (logicalName: string): string => {
  // Callers may pass a root-relative path (`/WaterShapes/Water_low.glb`) straight from
  // the domain layer, which authors asset paths but must not depend on URL resolution.
  const name = logicalName.replace(/^\//, '');
  if (!import.meta.env.PROD) return `/${name}`;
  const addressed = RUNTIME_ASSET_MANIFEST[name];
  if (!addressed) {
    // Fail loudly in the build rather than silently shipping a split-unsafe URL.
    throw new Error(
      `assetUrl: "${name}" is not in the runtime asset manifest. ` +
        `Add it to VERSIONED_FILES in scripts/release/asset-manifest.mjs and rebuild.`,
    );
  }
  return `/${addressed}`;
};

/**
 * Directory form, for loaders that take a base path and append their own filenames.
 * The Basis transcoder is the case that matters: `KTX2Loader.setTranscoderPath()` fetches
 * `basis_transcoder.js` and `.wasm` from the directory it is given, and the pair must come
 * from the same generation, so the directory is versioned as a unit.
 */
export const assetDirUrl = (logicalDir: string): string => assetUrl(`${logicalDir}/`);
