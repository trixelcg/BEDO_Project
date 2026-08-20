import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers/glb';

/**
 * Security regression: the removed API surface stays removed (BEDO-002 §11).
 *
 * BEDO-001 deleted six inherited handlers and replaced the router's
 * `import('./api/' + segment)` with an allow-list. The risk that remains is a quiet
 * reintroduction: drop a file back into `api/`, or widen `API_ROUTES`, and the endpoints
 * that billed anonymous Vertex AI/TTS calls and accepted arbitrary GCS writes are public
 * again (`docs/10`).
 *
 * This boots the real server and asks it, rather than reading the source, because the
 * allow-list is only meaningful in terms of what the router actually answers.
 */

const REMOVED_ROUTES = ['chat', 'tts', 'upload', 'crawl', 'register', 'gcsStorage'];

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

describe('routes deleted by BEDO-001', () => {
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
    // The vulnerability was `import('./api/' + segment)`, which published every file in
    // api/ automatically and let the path decide the module.
    return Promise.all(
      ['save-config/../chat', '..%2Fsave-config', 'save-config.ts', 'SAVE-CONFIG'].map(
        async (segment) => {
          const response = await fetch(`${baseUrl}/api/${segment}`, { method: 'POST' });
          expect([404, 405], `/api/${segment} answered ${response.status}`).toContain(
            response.status
          );
        }
      )
    );
  });

  it('answers 404 for an unknown route without leaking the reason', async () => {
    const response = await fetch(`${baseUrl}/api/definitely-not-a-route`, { method: 'POST' });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(JSON.stringify({ error: 'Not found' }));
  });
});

describe('the one allowed route', () => {
  it('/api/save-config still reaches its handler', async () => {
    // GET is rejected by the handler itself with 405, which proves routing resolved:
    // an unrouted path would have been 404'd by the router before the handler ran.
    const response = await fetch(`${baseUrl}/api/save-config`);
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });

  it('is the only route in the allow-list', () => {
    // Pinned against the source as well, so widening the list is a visible diff.
    const source = readFileSync(`${REPO_ROOT}/server.ts`, 'utf8');
    const match = source.match(/const API_ROUTES = new Set\(\[([^\]]*)\]\)/);
    expect(match, 'API_ROUTES allow-list not found in server.ts').not.toBeNull();
    const routes = match![1]
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(routes).toEqual(['save-config']);
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
