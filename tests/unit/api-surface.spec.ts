import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { REPO_ROOT } from '../helpers/glb';

/**
 * Code without its comments.
 *
 * These assertions are about what the program does, and every one of these files
 * *documents* the endpoints that were removed — matching on prose would mean the tests
 * fail for explaining themselves.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

/**
 * Security regression: the removed API surface stays removed (BEDO-002 §11, BEDO-003 §7).
 *
 * BEDO-001 deleted six inherited handlers and replaced the router's
 * `import('./api/' + segment)` with an allow-list. BEDO-003 deleted the last handler,
 * `save-config`, and with it the allow-list, the router and the `api/` directory: the
 * server now answers every `/api/*` path with 404 and has no way to reach a handler at
 * all. The risk this guards is a quiet reintroduction — a file dropped back into `api/`,
 * or a route added to the server — restoring endpoints that billed anonymous Vertex
 * AI/TTS calls and accepted arbitrary public GCS writes (`docs/10`, `docs/26`).
 *
 * This boots the real server and asks it, rather than reading the source, because what
 * matters is what the server actually answers.
 */

const REMOVED_ROUTES = [
  // BEDO-001
  'chat',
  'tts',
  'upload',
  'crawl',
  'register',
  'gcsStorage',
  // BEDO-003
  'save-config',
];

let server: ChildProcessByStdio<null, Readable, Readable>;
let baseUrl: string;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (typeof address === 'string' || address === null) {
        reject(new Error('could not reserve a port'));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;

  server = spawn('npx', ['tsx', 'server.ts'], {
    cwd: REPO_ROOT,
    // NODE_ENV stays unset: the GCS proxy fallback is production-only, and this test must
    // never reach for a network bucket.
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const log: string[] = [];
  server.stdout.on('data', (chunk) => log.push(String(chunk)));
  server.stderr.on('data', (chunk) => log.push(String(chunk)));

  // Poll the server rather than sleeping: it is ready when it answers, not after n ms.
  const deadline = Date.now() + 25_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start within 25 s.\n${log.join('')}`);
    }
    try {
      await fetch(`${baseUrl}/api/__readiness_probe__`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}, 40_000);

afterAll(() => {
  server?.kill('SIGTERM');
});

describe('routes deleted by BEDO-001 and BEDO-003', () => {
  it.each(REMOVED_ROUTES)('/api/%s is not served for POST', async (route) => {
    const response = await fetch(`${baseUrl}/api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status, `/api/${route} answered ${response.status}`).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it.each(REMOVED_ROUTES)('/api/%s is not served for GET either', async (route) => {
    const response = await fetch(`${baseUrl}/api/${route}`);
    expect(response.status).toBe(404);
  });

  it('does not resolve a handler from a path segment', () => {
    // The original vulnerability was `import('./api/' + segment)`, which published every
    // file in api/ automatically and let the path decide the module.
    return Promise.all(
      ['save-config/../chat', '..%2Fsave-config', 'save-config.ts', 'SAVE-CONFIG'].map(
        async (segment) => {
          const response = await fetch(`${baseUrl}/api/${segment}`, { method: 'POST' });
          expect(response.status, `/api/${segment} answered ${response.status}`).toBe(404);
        }
      )
    );
  });

  it('answers the bare /api prefix rather than falling through to index.html', async () => {
    // A client that got HTML back here would try to parse it as JSON — which is exactly
    // how the old `/config.json` fetch failed.
    for (const path of ['/api', '/api/']) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, `${path} answered ${response.status}`).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
    }
  });

  it('answers 404 for an unknown route without leaking the reason', async () => {
    const response = await fetch(`${baseUrl}/api/definitely-not-a-route`, { method: 'POST' });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(JSON.stringify({ error: 'Not found' }));
  });
});

describe('the API surface is now empty', () => {
  it('/api/save-config is gone, handler and all', async () => {
    // Before BEDO-003 this answered 405 for GET, which proved a handler was reachable.
    // A 404 now proves the route no longer resolves to anything.
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${baseUrl}/api/save-config`, { method });
      expect(response.status, `${method} answered ${response.status}`).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
    }
  });

  it('the api/ directory does not exist', () => {
    expect(
      existsSync(`${REPO_ROOT}/api`),
      'api/ is back — every file in it used to become a public endpoint'
    ).toBe(false);
  });

  it('the server declares no routes and imports no handler', () => {
    const source = stripComments(readFileSync(`${REPO_ROOT}/server.ts`, 'utf8'));
    expect(source).not.toContain('API_ROUTES');
    expect(source).not.toContain('save-config');
    // No dynamic import of anything — that construct is what published api/ wholesale.
    expect(source).not.toMatch(/await import\(/);
  });

  it('nothing in the client calls an API', () => {
    const sources = sourceFiles(`${REPO_ROOT}/src`);
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const source = stripComments(readFileSync(file, 'utf8'));
      expect(source, `${file} still calls /api`).not.toContain('/api/');
      expect(source, `${file} still fetches config.json`).not.toContain('config.json');
    }
  });
});

describe('static serving', () => {
  it('still serves the built front end when one exists', async () => {
    const response = await fetch(`${baseUrl}/`);
    if (existsSync(`${REPO_ROOT}/dist/index.html`)) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    } else {
      // Nothing has been built yet — the router must still answer, not hang or throw.
      expect(response.status).toBe(404);
    }
  });

  it('serves the apparatus model from public/ with the right content type', async () => {
    const response = await fetch(`${baseUrl}/WaterShapes/Water90_Flat.glb`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('model/gltf-binary');
    await response.arrayBuffer();
  });
});
