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
            const mimeTypes: Record<string, string> = {
              '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json'
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
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
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary',
    '.mp4': 'video/mp4',
    '.webp': 'image/webp',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  
  if (ext === '.js' || ext === '.css' || ext === '.glb') {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (ext === '.html' || ext === '.json') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

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
