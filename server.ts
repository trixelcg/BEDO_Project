import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Storage } from '@google-cloud/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

const bucketName = process.env.GCS_BUCKET_NAME || 'bedo-project-assets-2026';
let storage: Storage | null = null;
try {
  storage = new Storage();
} catch (e) {
  console.warn("GCP Storage client could not be initialized in server.ts. Using local fallback.", e);
}

/**
 * One MIME table, used by BOTH the local-file path and the GCS proxy path.
 *
 * These used to be two different tables: the local path knew about `.js`, and the proxy
 * path had five entries and fell back to `application/octet-stream`. That gap is not
 * cosmetic — a browser refuses to execute an ES module served as octet-stream, so a
 * bundle proxied from the bucket loaded with status 200 and then failed to run. During a
 * Cloud Run traffic split that is exactly the request that gets proxied, so the split
 * tore every page load whose HTML and JS landed on different revisions (PERF-05/05B).
 *
 * Keep the two paths on one table so they cannot drift apart again.
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

/**
 * Immutability follows the URL, not the file extension.
 *
 * `/assets/*` (Vite content-hashed) and `/runtime/<hash>/*` (content-addressed runtime
 * assets) carry their content hash in the path, so they can never change meaning and are
 * safe to cache for a year. Everything else must not be: a stable name like
 * `/Bedo_baked_v2.glb` can legitimately differ between releases, and marking that
 * `immutable` pins a stale model in the browser cache with no way to revise it.
 */
const isContentAddressed = (pathname: string): boolean =>
  pathname.startsWith('/assets/') || pathname.startsWith('/runtime/');

const cacheControlFor = (pathname: string, ext: string): string =>
  isContentAddressed(pathname)
    ? 'public, max-age=31536000, immutable'
    : ext === '.html' || ext === '.json'
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=300';

/**
 * This generation's content-addressed URLs, mapped back to the files in `dist/`.
 *
 * `assetUrl()` in the bundle emits `/runtime/<hash>/Bedo_baked_v2.glb`. Those bytes are
 * already in the image (Vite copies `public/` into `dist/`), just under their plain name,
 * so there is no reason to ship a second content-addressed copy of an 11.9 MB model.
 * This map lets the revision answer its own generation's URLs from local disk.
 *
 * A URL from a DIFFERENT generation is deliberately absent here. It falls through to the
 * GCS proxy below and is served from the shared bucket — which is the whole point: during
 * a traffic split any revision can answer any generation's asset request.
 */
const runtimeLocalFiles = new Map<string, string>();
try {
  const manifestPath = path.join(__dirname, 'dist', 'runtime-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const { uploads } = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      uploads: { key: string; source: string }[];
    };
    for (const u of uploads) {
      const local = path.join(__dirname, 'dist', u.source.replace(/^public\//, ''));
      if (fs.existsSync(local)) runtimeLocalFiles.set('/' + u.key, local);
    }
    console.log(`Runtime manifest: ${runtimeLocalFiles.size} content-addressed assets served locally`);
  } else {
    console.warn('Runtime manifest absent — content-addressed assets will be served from GCS.');
  }
} catch (e) {
  console.error('Failed to read runtime manifest; falling back to GCS for runtime assets.', e);
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  /**
   * This server has no API.
   *
   * It served six inherited handlers until BEDO-001 deleted them, then one
   * (`save-config`) until BEDO-003 deleted that too — it existed to let a developer
   * panel write the scene configuration to disk and to a public GCS bucket, which meant
   * any visitor could restyle the deployed site for everyone. The scene configuration is
   * now a checked-in constant (`src/lib/sceneConfig.ts`) and nothing in the training
   * product calls an endpoint.
   *
   * The prefix is still answered explicitly, rather than falling through to the static
   * handler, so that `/api/anything` is a flat 404 and never an index.html that a client
   * might try to parse as JSON.
   */
  if (pathname.startsWith('/api/') || pathname === '/api') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // This generation's content-addressed runtime assets resolve to local files.
  // Other generations fall through to the shared bucket below.
  const localRuntime = runtimeLocalFiles.get(pathname);
  if (localRuntime) {
    const rtExt = path.extname(localRuntime).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[rtExt] || 'application/octet-stream');
    res.setHeader('Cache-Control', cacheControlFor(pathname, rtExt));
    res.statusCode = 200;
    fs.createReadStream(localRuntime).pipe(res);
    return;
  }

  // Serve static frontend assets
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'dist', pathname === '/' ? 'index.html' : pathname);
  }
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const hasExtension = !!path.extname(pathname);
    if (hasExtension) {
      // Proxy missing static assets directly from GCS bucket in production
      if (storage && process.env.NODE_ENV === 'production') {
        const filename = decodeURIComponent(pathname.substring(1));
        try {
          const file = storage.bucket(bucketName).file(filename);
          const [exists] = await file.exists();
          if (exists) {
            const ext = path.extname(filename).toLowerCase();
            res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
            res.setHeader('Cache-Control', cacheControlFor(pathname, ext));
            res.statusCode = 200;
            file.createReadStream().pipe(res);
            return;
          }
        } catch (e) {
          console.error(`[GCS Proxy] Error:`, e);
        }
      }
      
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Asset Not Found');
      return;
    }
    filePath = path.join(__dirname, 'dist', 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', cacheControlFor(pathname, ext));

  if (fs.existsSync(filePath)) {
    const stream = fs.createReadStream(filePath);
    res.statusCode = 200;
    stream.pipe(res);
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
