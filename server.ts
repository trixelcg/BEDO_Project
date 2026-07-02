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

// Helper to parse query parameters and raw body data
const parseRequest = (req: http.IncomingMessage) => {
  return new Promise<{ body: any; query: any }>((resolve) => {
    const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
    const query = Object.fromEntries(urlObj.searchParams.entries());
    
    let bodyData = '';
    req.on('data', (chunk) => {
      bodyData += chunk;
    });
    req.on('end', () => {
      let body = {};
      try {
        if (bodyData) {
          body = JSON.parse(bodyData);
        }
      } catch (e) {
        body = bodyData;
      }
      resolve({ body, query });
    });
  });
};

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // Mock res object to match Vercel handler interface (res.status, res.json, res.send)
  const responseWrapper = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      res.setHeader(name, value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      res.statusCode = code;
      return this;
    },
    json(data: any) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(this.statusCode);
      res.end(JSON.stringify(data));
      return this;
    },
    send(data: any) {
      res.writeHead(this.statusCode);
      res.end(data);
      return this;
    }
  };

  // 1. Route API requests
  if (pathname.startsWith('/api/')) {
    const parts = pathname.split('/');
    const apiName = parts[2]?.split('?')[0];
    
    if (apiName) {
      try {
        const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
        const query = Object.fromEntries(urlObj.searchParams.entries());
        let body = {};
        
        if (apiName !== 'upload') {
          const parsed = await parseRequest(req);
          body = parsed.body;
        }
        
        const requestWrapper = Object.assign(req, { body, query });
        
        // Dynamically import the api handler file
        const modulePath = `./api/${apiName}.ts`;
        const module = await import(modulePath);
        await module.default(requestWrapper, responseWrapper);
        return;
      } catch (err: any) {
        console.error(`Error handling API route ${pathname}:`, err);
        responseWrapper.status(500).json({ error: 'Internal server error', details: err.message });
        return;
      }
    }
  }

  // 2. Serve static frontend assets
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
