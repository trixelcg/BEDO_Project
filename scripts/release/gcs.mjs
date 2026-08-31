/**
 * Minimal Google Cloud Storage access for the release scripts.
 *
 * ## Why not just call `gcloud`
 *
 * The release steps run in Cloud Build, and no stock builder image has both tools:
 * `gcr.io/google.com/cloudsdktool/cloud-sdk` has gcloud but no node, and `node:20` has node
 * but no gcloud (verified, not assumed). The alternative was `apt-get install nodejs`
 * inside the cloud-sdk image, which makes every release depend on a package repository
 * being reachable and on whatever version it happens to serve that day.
 *
 * Talking to the GCS REST API directly removes the choice entirely: `node:20` needs no
 * installs, no `npm ci`, and no SDK — Node 18+ ships `fetch`, and Cloud Build's metadata
 * server hands out an access token over plain HTTP.
 *
 * Credentials come from the metadata server in CI and from `gcloud auth print-access-token`
 * on a developer machine, so one code path serves both.
 */
import { execFileSync } from 'child_process';

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

let cachedToken = null;

/** An OAuth access token: metadata server first (CI), gcloud second (local). */
export const accessToken = async () => {
  if (cachedToken) return cachedToken;
  try {
    const res = await fetch(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const { access_token: token } = await res.json();
      if (token) return (cachedToken = token);
    }
  } catch {
    // Not running on GCP infrastructure — fall through to the local developer path.
  }
  try {
    cachedToken = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return cachedToken;
  } catch (e) {
    throw new Error(
      'No GCS credentials: the metadata server is unreachable and `gcloud auth ' +
        `print-access-token` + ' failed. ' + (e.stderr || e.message),
    );
  }
};

const api = 'https://storage.googleapis.com/storage/v1';
const uploadApi = 'https://storage.googleapis.com/upload/storage/v1';

/** Every object in the bucket, paged to completion: name -> { size, md5 }. */
export const listAll = async (bucket) => {
  const token = await accessToken();
  const out = new Map();
  let pageToken;
  do {
    const url = new URL(`${api}/b/${bucket}/o`);
    url.searchParams.set('fields', 'items(name,size,md5Hash,contentType,cacheControl),nextPageToken');
    url.searchParams.set('maxResults', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list gs://${bucket} failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    for (const item of body.items || [])
      out.set(item.name, { size: Number(item.size), md5: item.md5Hash,
        contentType: item.contentType, cacheControl: item.cacheControl });
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
};

/**
 * Upload one object with its metadata in a single request.
 *
 * Multipart rather than a simple upload followed by a metadata PATCH: one round trip means
 * an object can never exist with the right bytes and the wrong `Cache-Control`.
 */
export const upload = async (bucket, key, body, { contentType, cacheControl, predefinedAcl }) => {
  const token = await accessToken();
  const boundary = `bedo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: key, contentType, cacheControl });
  const parts = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const url = new URL(`${uploadApi}/b/${bucket}/o`);
  url.searchParams.set('uploadType', 'multipart');
  if (predefinedAcl) url.searchParams.set('predefinedAcl', predefinedAcl);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: parts,
  });
  if (!res.ok) throw new Error(`upload ${key} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
};
