import { defineConfig, type PreviewServer } from 'vite'
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
