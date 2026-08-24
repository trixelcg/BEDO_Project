# ABC (Alembic vertex cache) -> GLB with morph targets.
#
#   Blender -b --python scripts/water/abc_to_morph_glb.py -- <in.abc> <out.glb> [--no-morph] [--keep-uv]
#
# The eight water shapes are constant-topology Alembic caches: 81 samples at 24 fps
# (3.3333 s), one mesh each, every frame distinct. `docs/44` records how that was measured.
#
# ## Why the base mesh is the LAST frame
#
# The runtime measures each shape's own extents (`waterFit` in DeviceModel) and scales the
# jet from them so it leaves the nozzle at its true 10 mm bore (BEDO-017), and it bakes a
# surface coordinate from the same vertices (BEDO-043). Both read the *base* geometry.
#
# Exporting frame 0 as the base would hand them a 0.1-unit nub and silently rescale the
# whole correction. Exporting frame 80 - which is exactly what the superseded static GLBs
# already were - keeps every one of those measurements bit-identical, and makes the
# animation purely additive: all influences at zero is today's geometry, unchanged.
#
# So each morph target f holds `frame[f] - frame[80]`, and frame 80 needs no target at all.
import bpy, sys, os, struct

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
want_morph = '--no-morph' not in argv
keep_uv = '--keep-uv' in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.alembic_import(filepath=src, as_background_job=False,
                          set_frame_range=True, validate_meshes=False)

scn = bpy.context.scene
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if len(meshes) != 1:
    raise SystemExit(f'expected exactly one mesh, got {[o.name for o in meshes]}')
obj = meshes[0]
f0, f1 = scn.frame_start, scn.frame_end
frames = list(range(f0, f1 + 1))
BASE = frames[-1]

# --- capture every sample -------------------------------------------------------------
coords = {}
nv = None
for f in frames:
    scn.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    if nv is None:
        nv = len(me.vertices)
    elif len(me.vertices) != nv:
        raise SystemExit(f'topology changed at frame {f}: {len(me.vertices)} != {nv}')
    buf = [0.0] * (nv * 3)
    me.vertices.foreach_get('co', buf)
    coords[f] = buf
    ev.to_mesh_clear()

# --- freeze the cache, pin the rest mesh to the base frame -----------------------------
for m in list(obj.modifiers):
    if m.type == 'MESH_SEQUENCE_CACHE':
        obj.modifiers.remove(m)
obj.data.vertices.foreach_set('co', coords[BASE])
obj.data.update()

# Flatten the 3ds Max group empties the cache carries, so the export is a single mesh node
# - which is exactly what the superseded static GLBs were. The transform is kept, so the
# geometry does not move.
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
if obj.parent:
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
for o in [x for x in bpy.data.objects if x.type == 'EMPTY']:
    bpy.data.objects.remove(o, do_unlink=True)

if not keep_uv:
    # Nothing samples them: every shape declares `textures: 0, images: 0`, the runtime
    # replaces the material outright and derives its own surface coordinate from the
    # vertices (src/lib/waterUv.ts). Shipping them would also split more vertices at UV
    # seams, and every extra vertex is multiplied by the morph-target count.
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])

# --- shape keys ------------------------------------------------------------------------
if want_morph:
    basis = obj.shape_key_add(name='Basis', from_mix=False)
    basis.data.foreach_set('co', coords[BASE])
    for f in frames:
        if f == BASE:
            continue          # zero delta by construction; the base already is this frame
        k = obj.shape_key_add(name=f'f{f:03d}', from_mix=False)
        k.data.foreach_set('co', coords[f])
        k.value = 0.0
    obj.data.update()

bpy.ops.object.select_all(action='DESELECT')

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    use_selection=False,
    export_apply=False,
    export_yup=True,
    export_morph=want_morph,
    # Normals matter here: these shapes deform from a nub to a full plume, and lighting
    # computed from the settled pose looks wrong through the whole 3.3 s growth.
    export_morph_normal=want_morph,
    export_morph_tangent=False,
    export_normals=True,
    export_texcoords=keep_uv,
    export_materials='NONE',
    export_animations=False,
    export_skins=False,
    export_cameras=False,
    export_lights=False,
)
print(f'CONVERTED {os.path.basename(src)} -> {os.path.basename(dst)} '
      f'verts={nv} frames={len(frames)} base=f{BASE} morph={want_morph} '
      f'bytes={os.path.getsize(dst)}')
