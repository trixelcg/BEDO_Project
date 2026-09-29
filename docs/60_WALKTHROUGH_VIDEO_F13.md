# 60 — Walkthrough video player (F13)

Working-tree change on top of F03–F10 (`docs/53`–`59`). Not committed, not deployed.

**Observed (QA, E24 / IMG18):**

* after opening the walkthrough, the learner could not reliably close it, seek, or get
  back to the apparatus;
* the player could leave them stuck.

## 1. What was wrong — three causes, found in the code and in the running app

| # | Where | What it did |
|---|---|---|
| 1 | `UIOverlay.tsx` modal | A plain child of `.ui-container`, which is `pointer-events: none` and only gives pointer input back to children marked `interactive`. The modal was not marked (flagged in `AnswerSheet.tsx` and `docs/28 §11`). Close and the video's native controls never got a click. The clicks fell through to the 3D canvas behind the video, where they could operate the apparatus. |
| 2 | Stacking | `.ui-container` is its own stacking context (z-index 10). The modal's z-index 1000 only counted inside it. The docked Data Monitor (z-index 100, a sibling above that context) was painted over the player's right side, **Close button included**. Seen in the browser once cause 1 was fixed. |
| 3 | `server.ts` (production) | Every file was sent whole with 200: no `Accept-Ranges`, and `Range` was ignored (local files and the GCS proxy alike). A browser seeks an MP4 by asking for a byte range, so the timeline had nothing to seek with. Measured (§3): against the old server `seekable` is `[0, 0]` and every seek lands on 0:00. |

There was no Escape handler either. With all three, a reload was the only way out, and a
reload loses the experiment. The Vite dev server does serve ranges, so cause 3 shows only
on the deployed site; causes 1 and 2 show everywhere.

The video file itself is fine: `moov` is at the front (byte 48), so it streams.

## 2. The correction

**`src/components/WalkthroughVideo.tsx` (new)** replaces the inline modal.

* **Always on top and clickable.**
  * It is portalled to `<body>`, `position: fixed`, z-index 2000, and `interactive`.
  * It covers the scene and the monitor, so nothing underneath takes a click while it is
    up.
* **Close always exits.**
  * The Close button is never disabled. Loading, an error or playback never gates it.
  * **Escape** closes it too. The handler is a capture-phase listener on `window`, so one
    Escape closes the video and nothing else: the board view and the Data Monitor keep
    their own Escape.
  * Closing pauses the video first.
  * If the video fails to load, a message says so and Close still works.
* **Controls**, driven from the media element's own events (`play`, `pause`,
  `timeupdate`, `seeked`, `loadedmetadata`), so they stay right after any seek:
  * Play/Pause;
  * −10 s / +10 s;
  * a timeline slider with `aria-valuetext`;
  * an m:ss / m:ss readout;
  * Mute.
* **Seeking** is clamped to the video (`src/lib/videoPlayback.ts`). `play()`'s promise is
  caught, so an interrupted play never throws.
* **Keyboard:**
  * Space or `k` toggles playback;
  * ← / → skip 5 s (reversed in Arabic);
  * Tab stays inside the dialog;
  * focus starts on Close and returns to the Video button on close.
  * No other key reaches the simulator's shortcuts while the video is up.
* **Layout:** the controls sit in their own row under the video, so they are on screen at
  any window height. They read left to right in Arabic too, since a timeline runs with
  time.
* **State:** the player imports nothing from the simulation and sends no commands. Its
  only way out is `onClose`. The simulator stays mounted underneath.

**`server.ts`** now honours `Range` for local files, runtime assets and the GCS proxy:

* `206` + `Content-Range` for a satisfiable range, including suffix and open-ended ones;
* `416` for an unsatisfiable one;
* `Accept-Ranges: bytes` and `Content-Length` on every file.

`HEAD` gets headers only. A stream error ends the response instead of hanging it.

## 3. Evidence

**The real server (`tsx server.ts`, storage stubbed), with curl:**

| request | answer |
|---|---|
| plain | 200, `Accept-Ranges: bytes`, `Content-Length: 3798` |
| `bytes=100-199` of the 5.27 MB model | 206, `Content-Range: bytes 100-199/5272536`, 100 bytes, identical to the file's bytes 100–199 |
| `bytes=3000-` | 206, `bytes 3000-3797/3798` |
| `bytes=-10` | 206, `bytes 3788-3797/3798` |
| `bytes=99999999-` | 416, `Content-Range: bytes */3798` |
| HEAD | 200, headers only |
| full body | identical to the file |

**Seeking in a browser, old server against new** (headless Chromium, the walkthrough
re-encoded to VP9 because this Chromium has no H.264 decoder; 89.13 s):

| | seekable | seek 60 → | seek 12 → | seek 70 → | play 1.5 s after the seek | pause |
|---|---|---|---|---|---|---|
| **old** `server.ts` | `[0, 0]` | 0 | 0 | 0 | starts from 0 | ok |
| **new** `server.ts` | `[0, 89.13]` | 60 | 12 | 70 | advances 1.46 s from 70 | ok |

**Your dev build in Chrome.** The rig was in free mode: the 90° deflector fitted, pump on,
valve 0.4, 50 g loaded, one reading recorded, Data Monitor docked.

* A real mouse click on **Video** opens the player over everything, monitor included. A
  real click on **Play** reaches the button (it turns to "Pause").
* A real click on **Close** exits. Focus goes back to the Video button. Valve, pump, load,
  readings and board all match the snapshot taken before opening.
* Opened again, **+10 s** clicked, **Escape** pressed: the video closes, the Data Monitor
  stays open, and the rig still matches the snapshot.
* Chrome does not load media in a background tab, so the actual picture was not watched
  here; seeking in a real browser is the table above.

## 4. Tests

**New:**

* `tests/unit/f13-walkthrough-video.spec.ts` — 12 tests, all passing:
  * each cause pinned: `interactive`, dialog, portal and stacking, capture-phase Escape,
    Close never disabled, no simulator imports;
  * the server's range responses and that every file goes through them;
  * time clamping and formatting;
  * `play()` rejections caught.
* `tests/integration/walkthrough-video.spec.tsx` (jsdom, with a fake media element that
  fires real events):
  * **AC1:** Close; Escape (and the monitor stays open); close after a load error; pause
    on close; focus in and back.
  * **AC2:** ±10 s and the slider, forward and back; clamped at both ends; arrow keys.
  * **AC3:** pause → seek → play → seek → pause; Space.
  * **AC4:** free mode with pump, valve and weights: open → seek → play → close, and
    everything is unchanged.

**Whole unit suite:** unchanged apart from the new spec. `tsc`: only the existing TS2345
in `DeviceModel.tsx`.

## 5. Not verified here — run before merging

* **CI:** `npm run test:ci`. The jsdom integration spec needs the real vitest/jsdom and
  was not run here.
* **The deployed server.** Seeking on Cloud Run needs a deploy. After one, check that
  `curl -H 'Range: bytes=0-99' -I <site>/Bedo_Mesu_J.mp4` returns 206.
* **Watching the H.264 file play and seek in a foreground Chrome tab** on the dev build.
