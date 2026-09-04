import { defineConfig, type PreviewServer } from 'vite'
import pkg from './package.json' with { type: 'json' }
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
/**
 * A build stamp, so a running page can say which build it came from.
 *
 * Cloud Run splits traffic per request, so during a rollout two builds serve at once and
 * "which one am I looking at?" is not answerable from the URL. `BUILD_GEN` is echoed to
 * the console at boot and exposed as `window.__BEDO_BUILD__`, which makes a torn or
 * unexpected load identifiable from the page itself instead of by guesswork.
 */
const BUILD_GEN = process.env.BUILD_GEN || 'dev';

/**
 * Production bundles request immutable runtime URLs that are normally served by the
 * shared GCS origin. `vite preview` has no bucket fallback, so without this preview-only
 * adapter the real model 404s and visual verification can never reach scene-ready.
 *
 * The manifest is read inside `configurePreviewServer`, not when the plugin is built.
 * Vite evaluates this config for every command, so reading it eagerly made `npm run dev`
 * depend on a *production* artefact: on a clean checkout that has not yet run
 * `npm run assets:manifest`, ordinary development died in config load. Preview is the only
 * consumer, so that is where the file is needed and where a missing one is worth failing
 * on — loudly, because a preview that silently 404s the model is the exact defect this
 * adapter exists to prevent. Nothing here relaxes the release gates: `npm run build`
 * regenerates the manifest, and `scripts/release/verify-asset-closure.mjs` independently
 * refuses to release without it.
 */
const localRuntimeAssets = () => {
  const mime = (file: string) => {
    if (file.endsWith('.glb')) return 'model/gltf-binary';
    if (file.endsWith('.webp')) return 'image/webp';
    if (file.endsWith('.wasm')) return 'application/wasm';
    if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
    return 'application/octet-stream';
  };

  return {
    name: 'bedo-local-runtime-assets',
    apply: 'serve' as const,
    configurePreviewServer(server: PreviewServer) {
      const manifestPath = path.resolve('public/runtime-manifest.json');
      if (!existsSync(manifestPath)) {
        throw new Error(
          `vite preview needs public/runtime-manifest.json to serve content-addressed ` +
            `runtime assets, and it is absent. Run \`npm run assets:manifest\` (or ` +
            `\`npm run build\`, which does it) and preview again.`
        );
      }
      const { uploads } = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        uploads: Array<{ key: string; source: string }>;
      };
      const byUrl = new Map(uploads.map(({ key, source }) => [`/${key}`, path.resolve(source)]));

      server.middlewares.use((req, res, next) => {
        const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '';
        const file = byUrl.get(pathname);
        if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        res.statusCode = 200;
        res.setHeader('Content-Type', mime(file));
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).pipe(res);
      });
    },
  };
};

export default defineConfig({
  plugins: [react(), localRuntimeAssets()],
  define: {
    __BUILD_GEN__: JSON.stringify(BUILD_GEN),
    /*
      The application's version, from the one file that owns it.

      The printed wall chart carries "2.0.0" and "Copyright 2022" baked into its texture —
      it shares the `MergedBake_Baked` atlas with seventeen other primitives, so repainting
      it would repaint the room, and it cannot be corrected in place. What can be corrected
      is every version the interface states itself, and there is now one source for that:
      bump `package.json` and the intro screen and the monitor follow.
    */
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Suppress the chunk size warning — large 3D libs are expected
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // No proxy: BEDO-003 removed the last API route, so the dev server has nothing to
    // forward and `npm run dev` no longer starts a backend alongside it.
    port: 5179,
  }
})
