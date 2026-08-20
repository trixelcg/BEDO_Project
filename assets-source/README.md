# assets-source

Source and superseded assets that the web application does **not** load.

They live here, outside `public/`, for one reason: Vite copies **everything** in `public/`
into `dist/` and from there into the container image. Keeping these files in `public/`
shipped 39 MB to every visitor's origin server that no visitor could ever request.

Nothing here is deleted, because it is worth keeping — it is the input to the asset work
in `docs/23` (BEDO‑032…035), not disposable output.

| Path | What it is | Why it is not served |
|---|---|---|
| `WaterShapes/*.abc` (8, 20.3 MB) | Alembic caches: the simulated water plumes as authored | The runtime loads the baked `.glb` exports of these, in `public/WaterShapes/`. The caches are the *source* for re-exporting them. |
| `models/Bedo_M.glb` (16.9 MB) | An earlier export of the apparatus | Superseded by `public/Bedo_baked_v2.glb`. Kept as a reference point for the re-export work. |
| `models/Bedo_model_optimized.glb` (1.7 MB) | A previously optimised export | Not wired to anything, but it is the only existing evidence of a smaller apparatus model — directly relevant to BEDO‑032/033. |
| `images/icons.svg` (5 KB) | An icon sheet | No reference anywhere in the app; `lucide-react` provides every icon in use. |
| `images/hero.png` (13 KB) | Unattributed image from `src/assets/` | Never imported. Kept rather than deleted because its provenance is unknown. |

**Verified unreachable before moving** (BEDO‑004): no source reference, no build-output
reference, never requested in a full runtime network trace, and no dynamic path
construction exists anywhere in `src/` that could name them. See `docs/28`.

If the team keeps a separate art repository, this directory is what belongs in it.
`.dockerignore` keeps it out of the container image.
