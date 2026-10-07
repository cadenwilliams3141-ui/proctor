# -*- coding: utf-8 -*-
"""Build the Proctor sim rig as a GLB (Y up, metres, one named node per mounting slot) and render previews.

blender -b --python blender/build_rig.py -- [--no-export] [--views hero,pov] [--engine cycles|eevee|workbench]
                                            [--samples 96] [--res 1600x1000] [--floor-ao]

Blender axes while building: X = driver's right, Y = forward (toward the screens), Z = up. The glTF
exporter turns that into X right, Y up, -Z forward. Every part is generic look-alike geometry: no
maker's shapes, logos or lettering.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
STEM = 'proctor_rig'

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
CELL = 0.04                      # 40-series aluminium profile
SHARP = math.radians(50)         # 45 degree chamfers stay smooth, square edges split


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith('--') else True
    return default


# ----------------------------------------------------------------------------- layout (metres)

EYE = Vector((0.0, -0.02, 1.10))          # driver's eye point
MON_Y, MON_Z = 0.60, 1.07                 # centre screen apex: 620 mm from the eye
MON_R = 1.5                               # 1500R
MON_ARC, MON_H = 0.80, 0.335              # visible arc length and height of a 34" 21:9 panel
MON_SIDE = math.radians(55)               # side screens turned in
MON_BEAM = 0.16                           # stand beam centre, behind the screen apex
TILT = math.radians(10)                   # steering column
COL = Matrix.Translation((0.0, 0.40, 0.70)) @ Matrix.Rotation(-TILT, 4, 'X')   # rim centre, +Y down the column
PED = Matrix.Translation((0.0, 0.98, 0.262)) @ Matrix.Rotation(math.radians(12), 4, 'X')   # pedal base, top face
SHIFT = Matrix.Translation((0.335, 0.30, 0.446))
HBRAKE = Matrix.Translation((-0.335, 0.30, 0.446))
ALONG_Y = Matrix.Rotation(-math.pi / 2, 4, 'X')     # turns a Z-axis primitive to lie along +Y
YZ_TO_X = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # prism (x, y, z) -> (y, z, x)

# ----------------------------------------------------------------------------- materials

ACCENT = '#9184d9'
MATERIALS = {
    'alu_black':     dict(color='#1d1e23', metallic=0.9, rough=0.42),
    'alu_raw':       dict(color='#c9cbd1', metallic=1.0, rough=0.32),
    'steel_black':   dict(color='#17181c', metallic=0.4, rough=0.55),
    'steel_brushed': dict(color='#b4b7be', metallic=1.0, rough=0.36),
    'spring':        dict(color='#2a2b30', metallic=0.9, rough=0.4),
    'chrome':        dict(color='#e6e7ea', metallic=1.0, rough=0.12),
    'bolt':          dict(color='#8a8d94', metallic=1.0, rough=0.35),
    'plastic':       dict(color='#111216', rough=0.55),
    'rubber':        dict(color='#0c0c0d', rough=0.9),
    'grip_tape':     dict(color='#0e0e10', rough=1.0),
    'seat_fabric':   dict(color='#202127', rough=0.95),
    'seat_bolster':  dict(color='#111215', rough=0.62),
    'seat_shell':    dict(color='#0e0e10', rough=0.28, coat=0.6),
    'seat_accent':   dict(color=ACCENT, rough=0.8),
    'carbon':        dict(color='#17181b', rough=0.3, coat=0.8),
    'suede':         dict(color='#131315', rough=1.0),
    'marker':        dict(color='#e0b76a', rough=0.7),
    'anodized':      dict(color=ACCENT, metallic=1.0, rough=0.3),
    'elastomer':     dict(color='#e0a86a', rough=0.7),
    'bezel':         dict(color='#08080a', rough=0.3),
    'screen':        dict(color='#05050a', rough=0.15, emit='#5d5294', emit_strength=1.5),
    'dash_screen':   dict(color='#05050a', rough=0.2, emit='#b5abfc', emit_strength=1.0),
    'btn_black':     dict(color='#1a1b1f', rough=0.5),
    'btn_red':       dict(color='#e0685e', rough=0.4, emit='#e0685e', emit_strength=0.5),
    'btn_green':     dict(color='#6fbf8f', rough=0.4, emit='#6fbf8f', emit_strength=0.5),
    'btn_amber':     dict(color='#e0b76a', rough=0.4, emit='#e0b76a', emit_strength=0.5),
    'btn_accent':    dict(color='#b5abfc', rough=0.4, emit='#b5abfc', emit_strength=0.5),
    'led':           dict(color='#b5abfc', rough=0.3, emit='#b5abfc', emit_strength=3.0),
}
_mats = {}


def lin(hexstr):
    """sRGB hex -> scene-linear RGB."""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def material(name):
    if name in _mats:
        return _mats[name]
    s = MATERIALS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgb = lin(s['color'])
    b.inputs['Base Color'].default_value = (*rgb, 1.0)
    b.inputs['Metallic'].default_value = s.get('metallic', 0.0)
    b.inputs['Roughness'].default_value = s.get('rough', 0.5)
    if 'coat' in s:
        b.inputs['Coat Weight'].default_value = s['coat']
        b.inputs['Coat Roughness'].default_value = 0.08
    if 'emit' in s:
        b.inputs['Emission Color'].default_value = (*lin(s['emit']), 1.0)
        b.inputs['Emission Strength'].default_value = s['emit_strength']
    m.diffuse_color = (*rgb, 1.0)
    m.metallic = s.get('metallic', 0.0)
    m.roughness = s.get('rough', 0.5)
    _mats[name] = m
    return m


# ----------------------------------------------------------------------------- mesh helpers

class Part:
    """One exported node. Geometry is merged in part-local coordinates, one material slot per name."""

    def __init__(self, name, matrix=None, uv=False):
        self.name = name
        self.matrix = matrix or Matrix.Identity(4)
        self.bm = bmesh.new()
        self.mats = []
        if uv:
            self.bm.loops.layers.uv.new('UVMap')

    def slot(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add(self, src, mat, M=None, recalc=True):
        """Merge bmesh `src` (consumed). `mat` is a name, or a list indexed by the source's material_index."""
        if recalc:
            bmesh.ops.recalc_face_normals(src, faces=src.faces[:])
        if M is not None:
            src.transform(M)
        names = [mat] if isinstance(mat, str) else list(mat)
        remap = [self.slot(n) for n in names]
        me = bpy.data.meshes.new('_tmp')
        src.to_mesh(me)
        src.free()
        n0 = len(self.bm.faces)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces[n0:]:
            f.material_index = remap[min(f.material_index, len(remap) - 1)]

    def finish(self):
        bm = self.bm
        bm.normal_update()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0.0) < SHARP
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        tris = sum(len(f.verts) - 2 for f in bm.faces)
        bm.free()
        for n in self.mats:
            me.materials.append(material(n))
        ob = bpy.data.objects.new(self.name, me)
        ob.matrix_world = self.matrix
        bpy.context.scene.collection.objects.link(ob)
        wn = ob.modifiers.new('weighted_normal', 'WEIGHTED_NORMAL')
        wn.keep_sharp = True
        wn.weight = 50
        print('%-16s %6d triangles, %2d materials' % (self.name, tris, len(self.mats)))
        return ob, tris


def frame_from(zaxis, yhint, origin=(0, 0, 0)):
    """Matrix whose local Z runs along `zaxis` and whose local Y leans toward `yhint`."""
    z = Vector(zaxis).normalized()
    y = Vector(yhint)
    if abs(z.dot(y.normalized())) > 0.98:
        y = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    y = (y - z * y.dot(z)).normalized()
    x = y.cross(z)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = Vector(origin)
    return M


def at(*xyz):
    return Matrix.Translation(xyz if len(xyz) == 3 else xyz[0])


def rot(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def box(sx, sy, sz, bevel=0.0015):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts[:])
    b = min(bevel, 0.45 * min(sx, sy, sz))
    if b > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=b, segments=1, profile=0.5, affect='EDGES')
    return bm


def cyl(r, h, segs=24, bevel=0.0, r2=None):
    """Cylinder (or cone) along Z, centred on the origin."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r, radius2=r if r2 is None else r2, depth=h)
    if bevel > 0:
        rims = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-9]
        bmesh.ops.bevel(bm, geom=rims, offset=bevel, segments=1, profile=0.5, affect='EDGES')
    return bm


def grid(rows, close_u=False, close_v=False, cap=False):
    """Quad sheet through rows of points; closed in either direction on request."""
    bm = bmesh.new()
    V = [[bm.verts.new(p) for p in row] for row in rows]
    nu, nv = len(V), len(V[0])
    for i in range(nu if close_u else nu - 1):
        i2 = (i + 1) % nu
        for j in range(nv if close_v else nv - 1):
            j2 = (j + 1) % nv
            bm.faces.new((V[i][j], V[i2][j], V[i2][j2], V[i][j2]))
    if cap and close_v and not close_u:
        bm.faces.new(V[0])
        bm.faces.new(V[-1][::-1])
    return bm


def lathe(profile, segs=32):
    """Revolve (radius, z) points around Z. Open ends with radius > 0 are capped."""
    rows = []
    for r, z in profile:
        rows.append([Vector((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z))
                     for k in range(segs)])
    bm = grid(rows, close_v=True)
    bm.verts.ensure_lookup_table()
    if profile[0][0] > 1e-6:
        bm.faces.new([bm.verts[k] for k in range(segs)])
    if profile[-1][0] > 1e-6:
        n = len(profile) - 1
        bm.faces.new([bm.verts[n * segs + k] for k in range(segs)][::-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    return bm


def prism(outline, depth):
    """Extrude a counter-clockwise XY outline along Z, centred."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, -depth / 2)) for x, y in outline]
    hi = [bm.verts.new((x, y, depth / 2)) for x, y in outline]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(hi)
    bm.faces.new(lo[::-1])
    return bm


def tube_path(pts, r, segs=8, closed=False):
    """Round tube swept along a polyline."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tang = []
    for i in range(n):
        a, b = (pts[(i - 1) % n], pts[(i + 1) % n]) if closed else (pts[max(i - 1, 0)], pts[min(i + 1, n - 1)])
        tang.append((b - a).normalized())
    nrm = tang[0].orthogonal().normalized()
    rows = []
    for i in range(n):
        if i:
            nrm = tang[i - 1].rotation_difference(tang[i]) @ nrm
        nrm = (nrm - tang[i] * nrm.dot(tang[i])).normalized()
        bi = tang[i].cross(nrm)
        rows.append([pts[i] + r * (math.cos(2 * math.pi * k / segs) * nrm + math.sin(2 * math.pi * k / segs) * bi)
                     for k in range(segs)])
    return grid(rows, close_u=closed, close_v=True, cap=not closed)


def helix(radius, length, turns, steps=14):
    n = int(turns * steps)
    return [(radius * math.cos(2 * math.pi * i / steps), radius * math.sin(2 * math.pi * i / steps), length * i / n)
            for i in range(n + 1)]


def face_toward(bm, direction):
    """Flip an open sheet so that it faces `direction`."""
    bm.normal_update()
    d = Vector(direction)
    if sum(f.normal.dot(d) * f.calc_area() for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])


def tslot_outline(a, b, slot=0.008, depth=0.0055, ch=0.0025):
    """Cross-section of an a x b cell T-slot profile: one groove per cell face, chamfered corners."""
    W, H = a * CELL, b * CELL
    corners = [Vector((-W / 2, -H / 2)), Vector((W / 2, -H / 2)), Vector((W / 2, H / 2)), Vector((-W / 2, H / 2))]
    inward = [Vector((0, 1)), Vector((-1, 0)), Vector((0, -1)), Vector((1, 0))]
    cells = [a, b, a, b]
    pts = []
    for k in range(4):
        p0, p1 = corners[k], corners[(k + 1) % 4]
        d = (p1 - p0).normalized()
        pts.append(p0 + d * ch)
        for i in range(cells[k]):
            c = p0 + d * ((i + 0.5) * CELL)
            pts += [c - d * slot / 2, c - d * slot / 2 + inward[k] * depth,
                    c + d * slot / 2 + inward[k] * depth, c + d * slot / 2]
        pts.append(p1 - d * ch)
    return [(p.x, p.y) for p in pts]


def beam(P, a, b, p0, p1, up, xf=None, mat='alu_black', caps=True):
    """T-slot profile from p0 to p1; `a` cells across, `b` cells along `up`."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    M = frame_from(p1 - p0, up, (p0 + p1) / 2)
    if xf is not None:
        M = xf @ M
    P.add(prism(tslot_outline(a, b), L), mat, M)
    if caps:
        for sgn in (-1, 1):
            P.add(box(a * CELL - 0.001, b * CELL - 0.001, 0.003, 0.001), 'plastic',
                  M @ at(0, 0, sgn * (L / 2 + 0.0015)))
    return M


def gusset(P, corner, d1, d2, size=0.075, width=0.034, xf=None, mat='alu_black'):
    """Cast corner bracket: legs along d1 and d2 from `corner`, webbed at both sides."""
    d1, d2 = Vector(d1).normalized(), Vector(d2).normalized()
    t = 0.007
    M = Matrix((d1, d2, d1.cross(d2))).transposed().to_4x4()
    M.translation = Vector(corner)
    if xf is not None:
        M = xf @ M
    P.add(prism([(0, 0), (size, 0), (size, t), (t, t), (t, size), (0, size)], width), mat, M)
    for sgn in (-1, 1):
        P.add(prism([(t, t), (size, t), (t, size)], 0.004), mat, M @ at(0, 0, sgn * (width / 2 - 0.002)))
    R3 = M.to_3x3()
    bolt(P, M @ Vector((size * 0.6, t, 0)), R3 @ Vector((0, 1, 0)))
    bolt(P, M @ Vector((t, size * 0.6, 0)), R3 @ Vector((1, 0, 0)))


def bolt(P, pos, normal, r=0.0065, h=0.005, mat='bolt'):
    n = Vector(normal).normalized()
    P.add(cyl(r, h, 10, bevel=0.001), mat, frame_from(n, (0, 0, 1), Vector(pos) + n * h / 2))


def strut(P, p0, p1, kind, xf=None):
    """Spring or elastomer assembly between two points (part-local)."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    M = frame_from(p1 - p0, X, p0)
    if xf is not None:
        M = xf @ M
    P.add(cyl(0.004, L, 12), 'chrome', M @ at(0, 0, L / 2))
    for z in (0.0, L):
        P.add(cyl(0.007, 0.012, 12), 'steel_brushed', M @ at(0, 0, z) @ rot('X', 90))      # clevis pins
    if kind == 'brake':
        P.add(box(0.03, 0.03, 0.03, 0.003), 'alu_black', M @ at(0, 0, L - 0.028))           # load cell
        z = L - 0.048
        for i in range(3):
            P.add(cyl(0.019, 0.003, 20), 'steel_brushed', M @ at(0, 0, z))
            P.add(cyl(0.016, 0.015, 20, bevel=0.003), 'elastomer' if i != 1 else 'rubber', M @ at(0, 0, z - 0.0095))
            z -= 0.019
        P.add(cyl(0.019, 0.003, 20), 'steel_brushed', M @ at(0, 0, z))
        P.add(cyl(0.012, 0.022, 20, bevel=0.002), 'anodized', M @ at(0, 0, z - 0.014))      # preload nut
    else:
        r = 0.012 if kind == 'throttle' else 0.014
        s0, s1 = L * 0.22, L * 0.86
        P.add(tube_path(helix(r, s1 - s0, 9 if kind == 'throttle' else 7), 0.0022, 6), 'spring', M @ at(0, 0, s0))
        for z in (s0 - 0.004, s1 + 0.004):
            P.add(cyl(r + 0.004, 0.006, 20, bevel=0.0015), 'anodized', M @ at(0, 0, z))


# ----------------------------------------------------------------------------- frame and seat

def monitor_matrix(s):
    """Local frame of a screen: origin at the apex, +X along the width, the picture faces -Y."""
    M0 = at(0, MON_Y, MON_Z)
    if s == 0:
        return M0
    half = (MON_ARC / 2 + 0.005) / MON_R
    xe, ye = MON_R * math.sin(half), MON_R * math.cos(half) - MON_R
    Rz = Matrix.Rotation(-s * MON_SIDE, 4, 'Z')
    target = M0 @ Vector((s * (xe + 0.006), ye, 0))
    return at(target - Rz @ Vector((-s * xe, ye, 0))) @ Rz


def seat_mesh():
    # (y, z) of the surface the driver touches, then half width, flat half width, bolster height
    stations = [
        (0.535, 0.325, .225, .150, .005), (0.515, 0.375, .230, .150, .015), (0.440, 0.385, .240, .150, .035),
        (0.300, 0.372, .245, .160, .055), (0.160, 0.358, .250, .165, .080), (0.070, 0.360, .250, .165, .100),
        (0.020, 0.385, .250, .165, .115), (-0.012, 0.44, .250, .165, .120), (-0.035, 0.53, .245, .160, .115),
        (-0.066, 0.63, .250, .160, .100), (-0.098, 0.73, .265, .185, .080), (-0.132, 0.84, .285, .210, .085),
        (-0.158, 0.92, .270, .180, .075), (-0.182, 1.00, .190, .120, .060), (-0.205, 1.08, .165, .100, .055),
        (-0.222, 1.15, .140, .085, .040), (-0.228, 1.19, .110, .070, .020),
    ]
    NU = 12
    n = len(stations)
    rows = []
    for i, (y, z, W, w, b) in enumerate(stations):
        p, q = stations[max(i - 1, 0)], stations[min(i + 1, n - 1)]
        t = Vector((0, q[0] - p[0], q[1] - p[1])).normalized()
        nrm = t.cross(X).normalized()                       # toward the driver
        row = []
        for k in range(NU + 1):
            x = (-1 + 2 * k / NU) * W
            s = min(1.0, max(0.0, (abs(x) - w) / ((W - w) * 0.8)))
            row.append(Vector((x, y, z)) + nrm * (b * s * s * (3 - 2 * s)))
        rows.append(row)
    bm = grid(rows)
    face_toward(bm, (0, 0.4, 1))
    bm.faces.index_update()
    for f in bm.faces:                                       # faces are created row by row, NU per row
        i, k = divmod(f.index, NU)
        centre = abs((k + 0.5) / NU * 2 - 1)
        f.material_index = 0 if centre < 0.6 else 1
        if 2 <= i <= 11 and 0.33 < centre < 0.5:
            f.material_index = 2
    me = bpy.data.meshes.new('_seat')
    bm.to_mesh(me)
    bm.free()
    for name in ('seat_fabric', 'seat_bolster', 'seat_accent', 'seat_shell'):
        me.materials.append(material(name))
    ob = bpy.data.objects.new('_seat', me)
    bpy.context.scene.collection.objects.link(ob)
    so = ob.modifiers.new('shell', 'SOLIDIFY')
    so.thickness = 0.035
    so.offset = -1.0
    so.use_rim = True
    so.material_offset = 3
    so.material_offset_rim = 3
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    dg = bpy.context.evaluated_depsgraph_get()
    out = bmesh.new()
    out.from_mesh(ob.evaluated_get(dg).to_mesh())
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


def build_frame():
    P = Part('slot_frame')
    RX, Y0, Y1, RZ = 0.27, -0.30, 1.16, 0.11
    # base rails on levelling feet
    for s in (-1, 1):
        beam(P, 1, 4, (s * RX, Y0, RZ), (s * RX, Y1, RZ), Z)
        for y in (Y0 + 0.07, 0.42, Y1 - 0.07):
            P.add(lathe([(0.026, 0.0), (0.03, 0.004), (0.03, 0.011), (0.012, 0.016), (0.007, 0.018), (0.007, 0.03)], 20),
                  'rubber', at(s * RX, y, 0))
    for y, z in ((-0.22, 0.17), (0.22, 0.17), (0.74, 0.17), (1.10, 0.07)):
        beam(P, 2, 1, (-0.25, y, z), (0.25, y, z), Z, caps=False)
        for s in (-1, 1):
            bolt(P, (s * 0.29, y, z), (s, 0, 0))

    # seat: sliders, side brackets, bucket
    for s in (-1, 1):
        P.add(box(0.032, 0.46, 0.016, 0.002), 'steel_black', at(s * 0.20, 0.0, 0.198))
        P.add(box(0.024, 0.42, 0.012, 0.002), 'steel_brushed', at(s * 0.20, 0.01, 0.212))
        P.add(box(0.085, 0.36, 0.005, 0.001), 'steel_black', at(s * 0.222, 0.06, 0.2205))
        P.add(box(0.005, 0.36, 0.14, 0.001), 'steel_black', at(s * 0.262, 0.06, 0.288))
        for y in (-0.06, 0.18):
            bolt(P, (s * 0.2645, y, 0.33), (s, 0, 0))
            bolt(P, (s * 0.2645, y, 0.26), (s, 0, 0))
    P.add(tube_path([(-0.20, 0.25, 0.212), (-0.20, 0.29, 0.212), (-0.17, 0.31, 0.215), (0.17, 0.31, 0.215),
                     (0.20, 0.29, 0.212), (0.20, 0.25, 0.212)], 0.005, 8), 'chrome')        # slider release bar
    P.add(seat_mesh(), ['seat_fabric', 'seat_bolster', 'seat_accent', 'seat_shell'], recalc=False)

    # wheel uprights and tilting deck
    UY, UTOP = 0.60, 0.72
    for s in (-1, 1):
        beam(P, 1, 4, (s * RX, UY, 0.19), (s * RX, UY, UTOP), Y)
        gusset(P, (s * RX, UY - 0.08, 0.19), -Y, Z)
        gusset(P, (s * RX, UY + 0.08, 0.19), Y, Z)
        P.add(box(0.006, 0.22, 0.13, 0.002), 'steel_black', COL @ at(s * 0.2455, 0.23, -0.07))
        for y, z in ((0.17, -0.095), (0.29, -0.095), (0.15, -0.025), (0.31, -0.025)):
            bolt(P, COL @ Vector((s * 0.2425, y, z)), (-s, 0, 0))
    beam(P, 4, 1, (-0.24, 0.23, -0.095), (0.24, 0.23, -0.095), Z, xf=COL, caps=False)

    # pedal deck: two cross profiles carried by side plates, and a heel plate
    for y in (-0.10, 0.10):
        beam(P, 2, 1, (-0.24, y, -0.024), (0.24, y, -0.024), Z, xf=PED, caps=False)
    for s in (-1, 1):
        P.add(box(0.006, 0.36, 0.10, 0.002), 'steel_black', PED @ at(s * 0.2455, 0.0, -0.052))
        for y in (-0.10, 0.10):
            bolt(P, PED @ Vector((s * 0.2425, y, -0.024)), (-s, 0, 0))
    P.add(box(0.46, 0.20, 0.004, 0.001), 'steel_black', at(0, 0.74, 0.192))
    P.add(box(0.40, 0.15, 0.0012, 0.0), 'grip_tape', at(0, 0.74, 0.1946))

    # side arms for the shifter and the handbrake
    for s in (-1, 1):
        beam(P, 1, 2, (s * 0.31, 0.30, 0.05), (s * 0.31, 0.30, 0.40), Y)
        beam(P, 2, 1, (s * 0.33, 0.10, 0.42), (s * 0.33, 0.50, 0.42), Z)
        gusset(P, (s * 0.31, 0.26, 0.40), -Y, -Z, size=0.06)
        gusset(P, (s * 0.31, 0.34, 0.40), Y, -Z, size=0.06)
        P.add(box(0.11, 0.20, 0.006, 0.0015), 'steel_black', at(s * 0.335, 0.30, 0.443))
        for z in (0.08, 0.15):
            bolt(P, (s * 0.33, 0.30, z), (s, 0, 0))

    # freestanding triple-screen stand
    SX, SY = 0.50, 0.82
    for s in (-1, 1):
        beam(P, 1, 2, (s * SX, SY, 0.04), (s * SX, SY, 1.30), Y)
        beam(P, 2, 1, (s * SX, 0.42, 0.02), (s * SX, 1.22, 0.02), Z)
        gusset(P, (s * SX, SY - 0.04, 0.04), -Y, Z)
        gusset(P, (s * SX, SY + 0.04, 0.04), Y, Z)
        M = monitor_matrix(s)
        beam(P, 1, 2, (-s * 0.40, MON_BEAM, 0), (s * 0.37, MON_BEAM, 0), Z, xf=M)
        inner = M @ Vector((-s * 0.40, MON_BEAM, 0))
        end = Vector((s * 0.56, MON_Y + MON_BEAM, MON_Z))
        mid = (inner + end) / 2
        P.add(cyl(0.013, 0.10, 16, bevel=0.002), 'steel_brushed', at(mid))                 # hinge pin
        for dz in (-0.03, 0.03):
            P.add(box((inner - end).length + 0.07, 0.05, 0.005, 0.001), 'steel_black',
                  frame_from(Z, (inner - end).cross(Z), mid + Vector((0, 0, dz))))
    beam(P, 1, 2, (-0.56, MON_Y + MON_BEAM, MON_Z), (0.56, MON_Y + MON_BEAM, MON_Z), Z)
    for s in (-1, 1):
        gusset(P, (s * (SX + 0.02), SY - 0.04, MON_Z), (s, 0, 0), Y, size=0.04)
    return P.finish()


# ----------------------------------------------------------------------------- screens

def curved_slab(R, phi0, phi1, z0, z1, r_in, r_out, n=24):
    rows = []
    for i in range(n + 1):
        phi = phi0 + (phi1 - phi0) * i / n
        rows.append([Vector((r * math.sin(phi), r * math.cos(phi) - R, z))
                     for r, z in ((r_in, z0), (r_in, z1), (r_out, z1), (r_out, z0))])
    return grid(rows, close_v=True, cap=True)


def build_monitors():
    P = Part('slot_monitors', uv=True)
    half = (MON_ARC / 2) / MON_R
    body = (MON_ARC / 2 + 0.005) / MON_R
    z0, z1 = -MON_H / 2, MON_H / 2
    for s in (-1, 0, 1):
        M = monitor_matrix(s)
        P.add(curved_slab(MON_R, -body, body, z0 - 0.020, z1 + 0.005, MON_R, MON_R + 0.016), 'bezel', M)
        P.add(curved_slab(MON_R, -body * 0.62, body * 0.62, -0.125, 0.105, MON_R + 0.015, MON_R + 0.048, 14),
              'plastic', M)
        P.add(box(0.11, 0.006, 0.11, 0.001), 'steel_black', M @ at(0, 0.051, 0))
        P.add(box(0.05, MON_BEAM - 0.02 - 0.054, 0.05, 0.002), 'steel_black',
              M @ at(0, (0.054 + MON_BEAM - 0.02) / 2, 0))
        for dx in (-0.04, 0.04):
            for dz in (-0.04, 0.04):
                bolt(P, M @ Vector((dx, 0.054, dz)), M.to_3x3() @ Vector((0, 1, 0)), r=0.004, h=0.003)
        # the picture: its own material, UVs run left to right across all three screens
        n = 24
        rows = []
        for i in range(n + 1):
            phi = -half + 2 * half * i / n
            r = MON_R - 0.0006
            rows.append([Vector((r * math.sin(phi), r * math.cos(phi) - MON_R, z)) for z in (z0, z1)])
        scr = grid(rows)
        face_toward(scr, (0, -1, 0))
        uv = scr.loops.layers.uv.new('UVMap')
        for f in scr.faces:
            for lp in f.loops:
                c = lp.vert.co
                u = (math.atan2(c.x, c.y + MON_R) + half) / (2 * half)
                lp[uv].uv = ((s + 1 + u) / 3.0, (c.z - z0) / (z1 - z0))
        P.add(scr, 'screen', M, recalc=False)
    return P.finish()


# ----------------------------------------------------------------------------- wheelbase and rim

def build_wheelbase():
    P = Part('slot_wheelbase', COL @ at(0, 0.12, 0))      # origin: centre of the motor's front face
    prof = [(0.060, 0.0), (0.064, 0.004), (0.064, 0.030)]
    for i in range(9):
        z = 0.034 + i * 0.017
        prof += [(0.057, z), (0.057, z + 0.006), (0.066, z + 0.008), (0.066, z + 0.014), (0.057, z + 0.016)]
    prof += [(0.064, 0.190), (0.064, 0.211), (0.060, 0.215)]
    P.add(lathe(prof, 40), 'alu_black', ALONG_Y)
    P.add(lathe([(0.0652, 0.010), (0.0665, 0.012), (0.0665, 0.022), (0.0652, 0.024)], 40), 'anodized', ALONG_Y)
    P.add(box(0.136, 0.012, 0.136, 0.004), 'alu_black', at(0, -0.006, 0))
    for dx in (-0.054, 0.054):
        for dz in (-0.054, 0.054):
            bolt(P, (dx, -0.012, dz), (0, -1, 0), r=0.005, h=0.004)
    P.add(cyl(0.024, 0.008, 24, bevel=0.002), 'steel_brushed', ALONG_Y @ at(0, 0, -0.016))
    P.add(cyl(0.014, 0.036, 20), 'chrome', ALONG_Y @ at(0, 0, -0.030))
    # cradle on the deck
    P.add(box(0.13, 0.19, 0.012, 0.002), 'steel_black', at(0, 0.108, -0.069))
    for y in (0.035, 0.18):
        P.add(box(0.11, 0.022, 0.05, 0.003), 'steel_black', at(0, y, -0.045))
        for dx in (-0.052, 0.052):
            bolt(P, (dx, y + 0.017, -0.063), (0, 0, 1), r=0.005, h=0.004)
    # rear panel
    P.add(box(0.076, 0.008, 0.052, 0.002), 'plastic', at(0, 0.219, 0.0))
    P.add(cyl(0.004, 0.003, 12), 'led', ALONG_Y @ at(-0.026, 0.014, 0.2235))
    P.add(cyl(0.007, 0.004, 16, bevel=0.001), 'btn_black', ALONG_Y @ at(0.024, 0.014, 0.224))
    for dx in (-0.012, 0.008):
        P.add(tube_path([(dx, 0.223, -0.012), (dx, 0.245, -0.014), (dx * 1.4, 0.262, -0.035), (dx * 1.6, 0.266, -0.075)],
                        0.0045, 8), 'rubber')
    return P.finish()


def rim_outline():
    """Spoke plate, wheel plane coordinates (x right, y up), counter-clockwise."""
    right = [(0.024, -0.110), (0.020, -0.060), (0.030, -0.042), (0.060, -0.036), (0.072, -0.022),
             (0.100, -0.022), (0.132, -0.016), (0.132, 0.024), (0.100, 0.030), (0.070, 0.038), (0.048, 0.046)]
    return right + [(-x, y) for x, y in reversed(right)]


def build_rim():
    P = Part('slot_rim', COL, uv=True)                    # origin: rim centre; wheel plane is local XZ
    R, flat = 0.134, -0.108
    pts = []
    for i in range(72):
        t = 2 * math.pi * i / 72
        pts.append(Vector((R * math.sin(t), 0, max(R * math.cos(t), flat))))
    for _ in range(4):                                    # round off the flat-bottom corners
        pts = [(pts[i - 1] + pts[i] * 2 + pts[(i + 1) % 72]) / 4 for i in range(72)]
    torus = tube_path(pts, 0.0165, 12, closed=True)
    for f in torus.faces:
        c = f.calc_center_median()
        f.material_index = 1 if (abs(c.x) < 0.011 and c.z > 0) else 0
    P.add(torus, ['suede', 'marker'])
    to_plane = Matrix.Rotation(math.pi / 2, 4, 'X')       # outline y -> local z
    P.add(prism(rim_outline(), 0.005), 'carbon', at(0, 0.006, 0) @ to_plane)
    P.add(box(0.125, 0.030, 0.072, 0.005), 'plastic', at(0, 0.0235, 0.005))
    # dash display with a row of shift lights over it
    P.add(box(0.066, 0.002, 0.036, 0.0005), 'bezel', at(0, 0.0025, 0.010))
    dash = grid([[Vector((-0.029, 0.0013, -0.004)), Vector((-0.029, 0.0013, 0.024))],
                 [Vector((0.029, 0.0013, -0.004)), Vector((0.029, 0.0013, 0.024))]])
    face_toward(dash, (0, -1, 0))
    uv = dash.loops.layers.uv.new('UVMap')
    for f in dash.faces:
        for lp in f.loops:
            lp[uv].uv = ((lp.vert.co.x + 0.029) / 0.058, (lp.vert.co.z + 0.004) / 0.028)
    P.add(dash, 'dash_screen', recalc=False)
    for i in range(9):
        P.add(box(0.0046, 0.002, 0.003, 0.0004), ('btn_green', 'btn_amber', 'btn_red')[i // 3],
              at((i - 4) * 0.0072, 0.0025, 0.0345))
    # push buttons: red on the left spoke and green on the right, as in the schematic
    buttons = [(-0.086, 0.020, 'btn_red'), (-0.108, 0.004, 'btn_black'), (-0.084, -0.006, 'btn_amber'),
               (0.086, 0.020, 'btn_green'), (0.108, 0.004, 'btn_accent'), (0.084, -0.006, 'btn_black')]
    for x, z, m in buttons:
        P.add(cyl(0.0086, 0.003, 18), 'plastic', ALONG_Y @ at(x, -z, 0.002))
        P.add(cyl(0.0062, 0.006, 18, bevel=0.0012), m, ALONG_Y @ at(x, -z, 0.0005))
    for x in (-0.042, 0.042):                             # rotary encoders
        P.add(cyl(0.0105, 0.012, 20, bevel=0.0015), 'anodized', ALONG_Y @ at(x, 0.026, -0.0025))
        P.add(box(0.002, 0.001, 0.008, 0.0), 'btn_black', at(x, -0.0088, -0.022))
    # shift paddles behind the plate, and the quick release
    for s in (-1, 1):
        P.add(box(0.058, 0.003, 0.105, 0.001), 'carbon', at(s * 0.098, 0.042, 0.006) @ rot('Z', -s * 9))
        P.add(box(0.03, 0.022, 0.03, 0.003), 'alu_black', at(s * 0.068, 0.036, 0.006))
    P.add(cyl(0.030, 0.034, 28, bevel=0.002), 'alu_black', ALONG_Y @ at(0, 0, 0.054))
    P.add(lathe([(0.0345, 0.0), (0.037, 0.003), (0.037, 0.019), (0.0345, 0.022)], 28), 'anodized',
          ALONG_Y @ at(0, 0, 0.050))
    P.add(cyl(0.022, 0.008, 24), 'steel_brushed', ALONG_Y @ at(0, 0, 0.074))
    return P.finish()


# ----------------------------------------------------------------------------- pedals, shifter, handbrake

def build_pedals():
    P = Part('slot_pedals', PED)                          # origin: top of the base plate, +Y away from the driver
    P.add(box(0.44, 0.30, 0.004, 0.001), 'steel_black', at(0, 0, -0.002))
    cheek = [(-0.055, 0.0), (0.105, 0.0), (0.105, 0.022), (0.03, 0.05), (-0.03, 0.058), (-0.055, 0.03)]
    kinds = (('clutch', -0.135, 0.19, 0.060, 0.075), ('brake', 0.0, 0.19, 0.070, 0.075), ('throttle', 0.135, 0.21, 0.042, 0.13))
    lean = math.radians(20)
    d = Vector((0, -math.sin(lean), math.cos(lean)))      # up the pedal arm
    f = Vector((0, -math.cos(lean), -math.sin(lean)))     # out of the pedal face, toward the driver
    for kind, x, L, fw, fh in kinds:
        O = Vector((x, 0, 0))
        for s in (-1, 1):
            P.add(prism(cheek, 0.004), 'steel_brushed', at(x + s * 0.024, 0, 0) @ YZ_TO_X)
        pivot = O + Vector((0, -0.03, 0.04))
        for y, z in ((-0.03, 0.04), (0.09, 0.012), (-0.045, 0.012)):
            P.add(cyl(0.006, 0.056, 12), 'bolt', at(x, y, z) @ rot('Y', 90))
        arm = at(pivot + d * (L / 2)) @ Matrix.Rotation(lean, 4, 'X')
        for s in (-1, 1):
            P.add(box(0.004, 0.026, L + 0.02, 0.001), 'steel_brushed', arm @ at(s * 0.012, 0, 0))
        P.add(box(0.02, 0.012, 0.03, 0.002), 'alu_black', arm @ at(0, 0, L / 2 - 0.02))
        face = at(pivot + d * (L - fh / 2 + 0.012) + f * 0.016) @ Matrix.Rotation(lean, 4, 'X')
        P.add(box(fw, 0.005, fh, 0.0015), 'alu_black', face)
        for i in range(3 if kind != 'throttle' else 5):   # grip ribs
            zz = (i - (1 if kind != 'throttle' else 2)) * 0.022
            P.add(box(fw - 0.01, 0.002, 0.004, 0.0008), 'steel_brushed', face @ at(0, -0.0035, zz))
        strut(P, pivot + d * (0.115 if kind != 'throttle' else 0.10) - f * 0.004, O + Vector((0, 0.09, 0.016)), kind)
        for y in (-0.045, 0.095):
            for s in (-1, 1):
                bolt(P, (x + s * 0.036, y, 0), (0, 0, 1), r=0.005, h=0.004)
    return P.finish()


def build_shifter():
    P = Part('slot_shifter', SHIFT)
    P.add(box(0.085, 0.15, 0.07, 0.004), 'alu_black', at(0, 0, 0.035))
    P.add(box(0.095, 0.16, 0.004, 0.001), 'steel_brushed', at(0, 0, 0.072))
    for x in (-0.017, 0.0, 0.017):                        # H gate
        P.add(box(0.006, 0.052, 0.0012, 0.0), 'bezel', at(x, 0.02, 0.0745))
    P.add(box(0.040, 0.006, 0.0012, 0.0), 'bezel', at(0, 0.02, 0.0745))
    for dx in (-0.039, 0.039):
        for dy in (-0.071, 0.071):
            bolt(P, (dx, dy, 0.074), (0, 0, 1), r=0.004, h=0.003)
    lever = at(0, 0.02, 0.074) @ rot('X', 7)
    P.add(lathe([(0.026, 0.0), (0.024, 0.006), (0.019, 0.010), (0.020, 0.016), (0.014, 0.021), (0.015, 0.027),
                 (0.009, 0.033)], 24), 'rubber', lever)
    P.add(cyl(0.0055, 0.15, 14), 'chrome', lever @ at(0, 0, 0.10))
    P.add(cyl(0.011, 0.012, 20, bevel=0.002), 'anodized', lever @ at(0, 0, 0.168))
    knob = [(0.010, 0.0)] + [(0.025 * math.sin(a), 0.027 - 0.027 * math.cos(a))
                             for a in (math.pi * k / 12 for k in range(3, 12))] + [(0.0, 0.054)]
    P.add(lathe(knob, 24), 'plastic', lever @ at(0, 0, 0.170))
    P.add(cyl(0.008, 0.012, 14, bevel=0.001), 'anodized', at(-0.046, -0.04, 0.045) @ rot('Y', 90))   # mode switch
    return P.finish()


def build_handbrake():
    P = Part('slot_handbrake', HBRAKE)
    P.add(box(0.062, 0.20, 0.014, 0.002), 'alu_black', at(0, 0, 0.007))
    cheek = [(-0.09, 0.0), (0.09, 0.0), (0.09, 0.03), (-0.02, 0.068), (-0.07, 0.068), (-0.09, 0.04)]
    for s in (-1, 1):
        P.add(prism(cheek, 0.005), 'alu_black', at(s * 0.02, 0, 0.014) @ YZ_TO_X)
    lean = math.radians(10)
    d = Vector((0, -math.sin(lean), math.cos(lean)))
    pivot = Vector((0, -0.045, 0.062))
    P.add(cyl(0.007, 0.05, 12), 'bolt', at(pivot) @ rot('Y', 90))
    arm = at(pivot + d * 0.11) @ Matrix.Rotation(lean, 4, 'X')
    P.add(box(0.012, 0.028, 0.24, 0.002), 'steel_brushed', arm)
    P.add(cyl(0.017, 0.105, 20, bevel=0.004), 'rubber', arm @ at(0, 0, 0.125))
    P.add(cyl(0.0185, 0.006, 20, bevel=0.001), 'anodized', arm @ at(0, 0, 0.07))
    a, b = pivot + d * 0.085 + Vector((0, 0.014, 0)), Vector((0, 0.078, 0.04))
    M = frame_from(b - a, X, a)
    L = (b - a).length
    P.add(cyl(0.005, L, 12), 'chrome', M @ at(0, 0, L / 2))
    P.add(cyl(0.014, L * 0.5, 20, bevel=0.002), 'anodized', M @ at(0, 0, L * 0.70))
    P.add(tube_path(helix(0.011, L * 0.36, 5), 0.002, 6), 'spring', M @ at(0, 0, L * 0.06))
    for dy in (-0.085, 0.085):
        bolt(P, (0, dy, 0.014), (0, 0, 1), r=0.004, h=0.003)
    return P.finish()


# ----------------------------------------------------------------------------- export

def export_glb(path, objs):
    for ob in bpy.context.scene.objects:
        ob.select_set(ob in objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, use_selection=True)
    print('wrote %s (%.2f MB)' % (path, os.path.getsize(path) / 1e6))


# ----------------------------------------------------------------------------- previews

# name: (camera position, look-at point, lens mm, orthographic width in m or None)
VIEWS = {
    'hero':   ((-2.05, -2.35, 1.80), (0.0, 0.42, 0.66), 42, None),
    'right':  ((2.25, -1.90, 1.45), (0.0, 0.42, 0.66), 42, None),
    'front':  ((1.6, 3.1, 1.7), (0.0, 0.35, 0.65), 42, None),
    'pov':    (tuple(EYE), (0.0, 0.60, 0.97), 14, None),
    'wheel':  ((-0.50, -0.22, 1.02), (0.02, 0.44, 0.69), 50, None),
    'pedals': ((0.75, 0.30, 0.72), (0.0, 0.96, 0.33), 50, None),
    'side':   ((20.0, 0.42, 0.66), (0.0, 0.42, 0.66), 85, 2.6),
    'top':    ((0.0, 0.42, 20.0), (0.0, 0.42, 0.0), 85, 2.6),
}


def screen_picture():
    """Render-only picture for the screens: dusk sky, a horizon line and dark ground, as seen from the eye."""
    m = material('screen')
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sub = nt.nodes.new('ShaderNodeVectorMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = EYE
    nrm = nt.nodes.new('ShaderNodeVectorMath')
    nrm.operation = 'NORMALIZE'
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mp = nt.nodes.new('ShaderNodeMapRange')
    mp.inputs['From Min'].default_value = -0.35
    mp.inputs['From Max'].default_value = 0.35
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    stops = [(0.0, '#0b0c14'), (0.30, '#161826'), (0.425, '#2b2741'), (0.455, '#e0a86a'), (0.475, '#9184d9'),
             (0.62, '#423a6a'), (1.0, '#161826')]
    el = ramp.color_ramp.elements
    while len(el) < len(stops):
        el.new(0.5)
    for e, (pos, col) in zip(el, stops):
        e.position = pos
        e.color = (*lin(col), 1.0)
    nt.links.new(geo.outputs['Position'], sub.inputs[0])
    nt.links.new(sub.outputs['Vector'], nrm.inputs[0])
    nt.links.new(nrm.outputs['Vector'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mp.inputs['Value'])
    nt.links.new(mp.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 4.0


def setup_render(engine):
    sc = bpy.context.scene
    w, h = (int(v) for v in str(arg('--res', '1600x1000')).split('x'))
    sc.render.resolution_x, sc.render.resolution_y = w, h
    world = bpy.data.worlds.new('w')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (*lin('#161826'), 1.0)
    bg.inputs[1].default_value = 0.35
    if engine == 'workbench':
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'MATERIAL'
        sh.show_shadows = True
        sh.show_cavity = True
        sh.show_object_outline = True
        bg.inputs[1].default_value = 1.0
    else:
        if engine == 'eevee':
            for name in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
                try:
                    sc.render.engine = name
                    break
                except Exception:
                    continue
        else:
            sc.render.engine = 'CYCLES'
            sc.cycles.samples = int(arg('--samples', 96))
            sc.cycles.use_denoising = True
            sc.cycles.max_bounces = 6
            sc.render.threads_mode = 'FIXED'
            sc.render.threads = 10                         # leave two for whatever else is running
        screen_picture()
        me = bpy.data.meshes.new('ground')
        me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
        gm = bpy.data.materials.new('ground')
        try:
            gm.use_nodes = True
        except Exception:
            pass
        b = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Base Color'].default_value = (*lin('#1b1d2b'), 1.0)
        b.inputs['Roughness'].default_value = 0.32
        me.materials.append(gm)
        sc.collection.objects.link(bpy.data.objects.new('ground', me))
        lights = (('key', (-2.4, -2.6, 3.4), 900.0, 2.6, '#fff4e6'),
                  ('fill', (2.8, -1.2, 1.6), 260.0, 2.0, '#9184d9'),
                  ('back', (0.6, 3.2, 2.6), 380.0, 2.2, '#cfd3e5'))
        for name, loc, energy, size, col in lights:
            lt = bpy.data.lights.new(name, 'AREA')
            lt.energy, lt.size, lt.color = energy, size, lin(col)
            ob = bpy.data.objects.new(name, lt)
            ob.location = loc
            ob.rotation_euler = (Vector((0, 0.4, 0.6)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
            sc.collection.objects.link(ob)
    for vt in ('AgX', 'Filmic', 'Standard'):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            continue
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def render_views(cam, names):
    sc = bpy.context.scene
    for name in names:
        loc, target, lens, ortho = VIEWS[name]
        cam.location = loc
        cam.data.type = 'ORTHO' if ortho else 'PERSP'
        cam.data.lens = lens
        cam.data.clip_start = 0.02
        if ortho:
            cam.data.ortho_scale = ortho
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        if name == 'top':
            cam.rotation_euler = (0.0, 0.0, 0.0)
        sc.render.filepath = os.path.join(OUT, 'preview_%s.png' % name)
        bpy.ops.render.render(write_still=True)
        print('rendered', sc.render.filepath)


def render_floor_ao(objs):
    """Top-down soft shadow of the rig on the floor: the viewer lays it under the model as a contact shadow."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = int(arg('--samples', 96))
    sc.cycles.use_denoising = True
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 10
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('white')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0
    for ob in objs:
        ob.visible_camera = False
    span, cy = 3.6, 0.45
    me = bpy.data.meshes.new('ao_floor')
    me.from_pydata([(-span, cy - span, 0), (span, cy - span, 0), (span, cy + span, 0), (-span, cy + span, 0)],
                   [], [(0, 1, 2, 3)])
    wm = bpy.data.materials.new('ao_white')
    wm.diffuse_color = (1, 1, 1, 1)
    me.materials.append(wm)
    sc.collection.objects.link(bpy.data.objects.new('ao_floor', me))
    cam = bpy.data.objects.new('ao_cam', bpy.data.cameras.new('ao_cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 3.6
    cam.location = (0, cy, 10)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, 'floor_ao.png')
    sc.render.image_settings.color_mode = 'BW'
    bpy.ops.render.render(write_still=True)
    print('rendered', sc.render.filepath)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    built = [build_frame(), build_monitors(), build_wheelbase(), build_rim(), build_pedals(),
             build_shifter(), build_handbrake()]
    objs = [ob for ob, _ in built]
    print('total %d triangles' % sum(t for _, t in built))
    eye = bpy.data.objects.new('anchor_eye', None)
    eye.location = EYE
    bpy.context.scene.collection.objects.link(eye)
    if not arg('--no-export'):
        export_glb(os.path.join(OUT, STEM + '.glb'), objs + [eye])
    if arg('--floor-ao'):
        render_floor_ao(objs)
        return
    views = arg('--views')
    if views:
        cam = setup_render(arg('--engine', 'cycles'))
        render_views(cam, str(views).split(','))


main()
