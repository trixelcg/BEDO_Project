# 10 — Security Remediation

**Status:** ✅ Completed and verified
**Branch:** `phase2/security-remediation`
**Commit:** `93b6dbb` — *security: remove unused TTS/avatar API surface and gate the router*
**Date:** 2026‑08‑20
**Scope:** surgical removal of confirmed‑unused attack surface. No backend redesign. No frontend change.

---

## 1. Vulnerability summary

`cloudbuild.yaml` deploys to Cloud Run with `--allow-unauthenticated`. `server.ts` routed **every**
`/api/<segment>` request by `await import('./api/' + segment + '.ts')`, with no authentication, no rate limiting
and no allow‑list. Every file in `api/` was therefore a public internet endpoint, automatically, by existing.

Six of the seven handlers were inherited from a different product — an Arabic TTS conversational‑avatar
application. Evidence of the fork:

- default bucket name `tts-character-assets-2026` in three handlers (BEDO's own bucket is `bedo-project-assets-2026`)
- a hard‑coded Arabic assistant persona prompt in `chat.ts`
- `visemeMap` / `ttsConfig` / `aiConfig` fields still present in the config payload
- `git log` begins at *"initial commit of migrated R3F project"* with `api/` already present

| # | Endpoint | Class | What an anonymous caller could do |
|---|---|---|---|
| V‑1 | `POST /api/chat` | **Broken access control → financial abuse** | With `{"provider":"gemini"}` and no key, the handler fetched the **Cloud Run service account's own metadata token** (`chat.ts:75‑135`) and called Vertex AI. Unlimited LLM inference **billed to the project**. |
| V‑2 | `POST /api/tts` | **Broken access control → financial abuse** | Same pattern with `{"provider":"gcp"}` (`tts.ts:6‑33`) — Google Cloud TTS on the project's account. |
| V‑3 | `POST`/`PUT /api/upload` | **Unrestricted file upload** | Wrote an arbitrary request body to an arbitrary object name in the GCS bucket and called `makePublic()` (`gcsStorage.ts:25‑62`). Arbitrary public file hosting on a `storage.googleapis.com` URL, attributed to this project. |
| V‑4 | `GET /api/crawl?url=…` | **SSRF** | Fetched any URL supplied by the caller and returned the body (`crawl.ts:4‑33`). Reaches internal/VPC endpoints. |
| V‑5 | `POST /api/register` | **Unauthenticated write / storage abuse** | Unrate‑limited JSON writes into `registrations/*.json` in the bucket. |
| V‑6 | Router | **Unrestricted module load** | `await import('./api/' + segment + '.ts')` with `segment` taken from the request path (`server.ts:94`). Not exploitable via WHATWG URL normalisation as written, but one encoding quirk from arbitrary module execution — and it published every file in `api/` by default. |
| V‑7 | Error handling | **Information disclosure** | The 500 path echoed `err.message` to the client (`server.ts:100`), leaking internal paths and module‑resolution detail. |

### Confirmed impact of the surviving endpoint

During verification, a single unauthenticated `POST /api/save-config` caused the server to write
`public/config.json` and begin uploading `Bedo_baked_v2.glb` (26 MB) and `rosendal_plains_2_4k.webp` to the
bucket. This is retained behaviour — see **§5 Residual risks**.

---

## 2. Pre‑removal dependency audit

Every removal was gated on proving the endpoint is unreachable from the product.

**Complete inventory of frontend network calls** (`grep -rn "fetch(\|XMLHttpRequest\|axios\|WebSocket\|EventSource\|sendBeacon" src/ index.html`):

```
src/App.tsx:97    fetch('/config.json')        ← static file, currently 404s
src/App.tsx:122   fetch('/api/save-config')    ← Scene Settings → "Save Config"
```

**That is the entire set.** No other endpoint is called from anywhere in `src/`.

**Reference graph for each candidate** (`grep -rn` across the repo excluding `node_modules`, `.git`, `dist`):

| File | External references found | Verdict |
|---|---|---|
| `api/chat.ts` | none (only self‑references: a log string and an `api.openai.com` URL) | unused |
| `api/tts.ts` | none (only the string `tts-1` model id and the shared `tts-character-assets-2026` bucket default) | unused |
| `api/crawl.ts` | **none at all** | unused |
| `api/register.ts` | none (only its own log line) | unused |
| `api/upload.ts` | referenced only by `server.ts:86`'s `apiName !== 'upload'` body‑parse special case, and by a self‑referential mock URL inside `gcsStorage.ts:87` | unused by the product |
| `api/gcsStorage.ts` | imported by **`api/upload.ts` only** — orphaned once `upload.ts` is removed | unused |
| `api/save-config.ts` | **`src/App.tsx:122`** | **IN USE — retained** |

**Configuration audit:**

| Item | Finding | Action |
|---|---|---|
| `cloudbuild.yaml` | sets only `GCS_BUCKET_NAME` and `NODE_ENV`; no API keys | no change needed |
| `Dockerfile` | `COPY --from=builder /app/api ./api` — copies whatever exists | no change needed; deleted files simply stop shipping |
| `.env*` files | none exist in the repo | none |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `GCP_API_KEY` | referenced **only** by the deleted `chat.ts` / `tts.ts`; not set anywhere in repo config | now dead — **see §5, action required outside the repo** |
| `@google-cloud/storage` | still required by `server.ts` and `api/save-config.ts` | **retained** |
| `vite.config.ts:15` `'/uploads'` proxy | dev‑only, inert once `upload.ts`/`gcsStorage.ts` are gone | **left in place** — see §6 |

---

## 3. What was removed

```
 api/chat.ts       | 244 ---------------------------------------------
 api/crawl.ts      | 112 ---------------------
 api/gcsStorage.ts |  90 ------------------
 api/register.ts   |  60 --------------
 api/tts.ts        | 214 -------------------------------------------
 api/upload.ts     |  64 --------------
 server.ts         |  28 ++++---
 7 files changed, 17 insertions(+), 795 deletions(-)
```

**784 of 1 008 `api/` lines deleted (78 %).** `api/` now contains exactly one file: `save-config.ts`.

### `server.ts` — the three changes

**(a) Route allow‑list.** Added above the request handler:

```ts
/**
 * The only API routes this server will serve.
 *
 * Previously the router imported `./api/${apiName}.ts` for whatever path segment
 * arrived, which made every file in api/ a public endpoint automatically. An
 * allow-list means adding a file to api/ no longer publishes it by accident.
 */
const API_ROUTES = new Set(['save-config']);
```

and the guard changed from `if (apiName)` to `if (apiName && API_ROUTES.has(apiName))`, with an explicit
`404 {"error":"Not found"}` for anything else. This is **defence in depth**: even if a handler file were
re‑introduced to `api/`, it would not become reachable without an explicit entry here.

**(b) Removed the dead `upload` special case.** `if (apiName !== 'upload') { … }` guarded body parsing for a
handler that no longer exists. Body is now always parsed — identical behaviour for `save-config`, which was
already on the parsing path.

**(c) Stopped leaking error detail.** `{ error: 'Internal server error', details: err.message }` →
`{ error: 'Internal server error' }`.

### Deliberately **not** changed

Per the instruction *"do not redesign the backend during this task"*:

- `api/save-config.ts` — in use; not touched.
- `vite.config.ts` — the `/uploads` dev proxy is now inert but harmless; removing it is cosmetic and would
  leave it inconsistent with `save-config.ts`'s surviving `/uploads/` branch. Tracked as **BEDO‑018**.
- `Dockerfile`, `cloudbuild.yaml` — no change required.
- Everything in `src/` — **zero frontend changes**.

---

## 4. Verification

All checks run on branch `phase2/security-remediation` at commit `93b6dbb`.

### 4.1 Static

| Check | Before | After |
|---|---|---|
| `npx tsc -b --force` | exit 0 | **exit 0** |
| `npx oxlint` | 10 warnings, 0 errors | **5 warnings, 0 errors** (the 5 removed were in deleted files) |
| `npm run build` | succeeds | **succeeds** — `dist/assets/index-QL93SMHB.js 1,235.63 kB │ gzip: 343.33 kB` |
| `git status` | — | only the 6 deletions + `server.ts`; **`src/` untouched** |

### 4.2 Runtime

Server started with `PORT=8099 npx tsx server.ts`.

> **Note on methodology.** A first attempt on the default port 8080 returned 404s carrying a
> `correlationId` field — a response shape this server does not produce. Port 8080 was occupied by an
> unrelated local service and the results were discarded. The run below includes an identity probe
> confirming the responses come from *this* server.

```
identity probe   GET  /api/__identity_probe__      -> {"error":"Not found"}   ✅ our server

removed routes   POST /api/chat                    -> HTTP 404  {"error":"Not found"}
                 POST /api/tts                     -> HTTP 404  {"error":"Not found"}
                 POST /api/upload                  -> HTTP 404  {"error":"Not found"}
                 POST /api/crawl                   -> HTTP 404  {"error":"Not found"}
                 POST /api/register                -> HTTP 404  {"error":"Not found"}
                 POST /api/gcsStorage              -> HTTP 404  {"error":"Not found"}

SSRF             GET  /api/crawl?url=http%3A%2F%2Fmetadata.google.internal%2FcomputeMetadata%2Fv1%2F
                                                   -> HTTP 404

module probes    POST /api/%2e%2e%2fserver         -> HTTP 404
                 POST /api/save-config%2f..%2fserver -> HTTP 404
                 POST /api/SAVE-CONFIG             -> HTTP 404   (case-sensitive allow-list)

regression       POST /api/save-config             -> handler reached and completed
                 GET  /                            -> HTTP 200  text/html        916 B
                 GET  /index.html                  -> HTTP 200  text/html        916 B
                 GET  /rosendal_plains_2_4k.webp   -> HTTP 200  image/webp   448 452 B
                 GET  /favicon.svg                 -> HTTP 200  image/svg+xml  9 522 B
```

**On the `save-config` regression test.** `curl` reported `000` (its 20 s timeout), but the server log proves
the route reached the handler and the handler ran to completion:

```
GCS Upload: uploading local .../public/Bedo_baked_v2.glb to gs://tts-character-assets-2026/Bedo_baked_v2.glb
GCS Upload: uploading local .../public/rosendal_plains_2_4k.webp to gs://...
Successfully saved configuration and assets to public folder: .../public/config.json
GCS Save Config: uploading config.json to gs://tts-character-assets-2026/config.json
```

The delay is `@google-cloud/storage` retrying a 26 MB upload without local credentials — **pre‑existing
behaviour, unrelated to this change**. Routing is intact.

The `public/config.json` written during this probe was deleted afterwards; `git status` confirms no stray
artifact.

---

## 5. Residual risks

Ordered by severity. **None of these were introduced by this change**; they are what remains.

| ID | Residual risk | Severity | Recommendation |
|---|---|---|---|
| R‑1 | **`POST /api/save-config` is still unauthenticated** on a public URL. It writes `public/config.json`, uploads it to the GCS bucket, calls `makePublic()`, and **downloads `characterUrl`/`locationUrl`/`hdrUrl` from any URL the caller supplies** (`save-config.ts:59‑95, 104‑107`) before publishing them. This is both an abuse vector (arbitrary file hosting on a Google domain) and a griefing vector (any visitor can change the scene configuration for every other user). | **Critical** | **BEDO‑003.** Bake `SceneConfig` into the bundle and delete the endpoint. This is the plan in `docs/12`; the Scene Settings panel becomes dev‑only. |
| R‑2 | **The GCS bucket may already contain objects written by anonymous callers.** `/api/upload` and `/api/register` were live on a public URL for an unknown period. | **High** | Audit `gs://bedo-project-assets-2026` **and** `gs://tts-character-assets-2026` for unexpected objects and for anything under `registrations/`. Review bucket IAM for `allUsers` grants left by `makePublic()`. **Outside this repo — needs a GCP console/CLI session.** |
| R‑3 | **Billing exposure may already have occurred.** `/api/chat` and `/api/tts` used the service account's metadata token. | **High** | Review Vertex AI and Cloud TTS usage/billing for the deployment window. Check the Cloud Run service account's roles and remove `aiplatform.user` / TTS permissions if they are no longer needed. **Outside this repo.** |
| R‑4 | **Dead API‑key env vars.** `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `GCP_API_KEY` are no longer read by any code. If they are set as Cloud Run env vars or in Secret Manager, they are now unused credentials sitting in the deployment. | **Medium** | Remove them from the Cloud Run service config / Secret Manager and **rotate them**, since they were readable by a service that exposed them via an unauthenticated proxy. **Outside this repo.** |
| R‑5 | `Cache-Control: immutable, max-age=31536000` on non‑hashed `.glb` filenames (`server.ts:164‑168`). Not a security issue, but it means a compromised or stale asset cannot be invalidated for a year. | Medium | **BEDO‑019.** |
| R‑6 | No rate limiting, no request size limit, no CORS policy, no security headers (CSP, HSTS, `X-Content-Type-Options`) on any route. `parseRequest` accumulates the entire body in memory with no cap. | Medium | **BEDO‑020.** Trivial DoS via a large body on `/api/save-config`. |
| R‑7 | Static file serving does not verify the resolved path stays inside the document root (`server.ts:107‑143`). WHATWG URL normalisation currently prevents traversal, and the runtime probes returned 404, but the invariant is not asserted in code. | Low | **BEDO‑020.** Add an explicit `path.resolve` containment check. |
| R‑8 | `--allow-unauthenticated` on the Cloud Run service. Appropriate for a public training POC, but it means every future endpoint is public by default. | Low (by design) | Keep the allow‑list discipline. Consider IAP for any future authoring surface. |

---

## 6. Follow‑up actions required outside this repository

These cannot be done from the codebase and need a GCP session. **I have not performed them.**

1. **Redeploy** this branch so the removal takes effect in production. The endpoints are live until then.
2. Audit both GCS buckets for anonymously written objects and stray `allUsers` IAM bindings.
3. Review Vertex AI / Cloud TTS billing and usage for the exposure window.
4. Remove and **rotate** the four dead API keys if present in Cloud Run env or Secret Manager.
5. Trim the Cloud Run service account to least privilege (it needs GCS object write for `save-config` only — and nothing at all once R‑1 is closed).

---

## 7. Rollback

Everything is one revert away:

```bash
git revert 93b6dbb          # restores all six handlers and the original router
```

The change touches no frontend code and no build configuration, so a revert cannot affect the application.
