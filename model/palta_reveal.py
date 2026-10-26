"""Palta reveal — a split avocado that opens and shows a partner logo on a medallion.

Builds dist/assets/palta-reveal.glb for the ONE16 twin (Spatial Agents · Operating System).
Same conventions as the other venue components: procedural geometry, flat PBR materials,
no photo textures, Three.js coordinates (Y up, front = +Z, metres).

    python3 model/palta_reveal.py                         # neutral logo placeholder
    python3 model/palta_reveal.py --logo path/to/logo.png # embed the partner's official file

Only numpy, scipy and Pillow are needed (no Blender). The logo is never drawn here: the slot
shows a neutral placeholder unless the official file is passed with --logo, or the viewer module
swaps the texture at runtime (dist/palta-reveal.mjs). Official Soroswap and DeFindex PNGs
in dist/assets/palta-reveal/partners/ are embedded unchanged inside the two seed cavities.

Node names use only letters and underscores, because three.js GLTFLoader rewrites spaces and
removes "/" ":" "." "[" "]" (PropertyBinding.sanitizeNodeName) before getObjectByName sees them.

Animations in the file
  "open"  0 → 2.6 s, play once and clamp: wobble, halves open on a back hinge, the seed rises and
          turns into the medallion, the glow ring comes up. Play it backwards to close.
  "idle"  3.2 s loop: the medallion floats and the glow ring turns. Runs on child nodes, so it
          never fights "open".
"""
import argparse, io, json, math, os, struct
import numpy as np
from scipy.interpolate import PchipInterpolator
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30

# ---------------------------------------------------------------- shape (fruit units, H = 1)
# r² control points along the height: rounded tips, wide bottom bulb, narrower neck.
_S = [0.0, 0.025, 0.08, 0.18, 0.30, 0.40, 0.52, 0.64, 0.76, 0.86, 0.93, 0.975, 1.0]
_R = [0.0, 0.150, 0.250, 0.322, 0.345, 0.340, 0.307, 0.258, 0.212, 0.180, 0.150, 0.100, 0.0]
_r2 = PchipInterpolator(_S, np.square(_R))
R_MAX = max(_R)
SEED_Y, SEED_R = 0.36, 0.165          # seed centre height and radius
CAVITY_R = SEED_R * 1.03
HINGE_Z = -R_MAX * 0.96               # halves open on a vertical hinge at the back
MEDAL_R = 0.29                        # medallion radius
OPEN_ANGLE = math.radians(62)


def radius(s):
    return np.sqrt(np.clip(_r2(s), 0, None))


def skin_noise(p, rng_seed=7):
    """Fine pebbling plus soft broad lumps, radial displacement in fruit units."""
    rng = np.random.default_rng(rng_seed)
    out = np.zeros(p.shape[:-1])
    for count, freq, amp in [(40, 120.0, 0.0011), (28, 60.0, 0.0014), (10, 9.0, 0.0022)]:
        dirs = rng.normal(size=(count, 3)); dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
        phase = rng.uniform(0, 2 * np.pi, count)
        layer = np.zeros(p.shape[:-1])
        for d, ph in zip(dirs, phase):
            layer += np.sin(freq * (p @ d) + ph)
        out += amp * 2.2 * layer / math.sqrt(count)
    return out


def srgb(c):
    """Colour picked in sRGB → linear, which is what glTF factors and COLOR_0 expect."""
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------- mesh helpers
def grid_faces(rows, cols, wrap=False):
    f = []
    cmax = cols if wrap else cols - 1
    for i in range(rows - 1):
        for j in range(cmax):
            a = i * cols + j; b = i * cols + (j + 1) % cols
            c = (i + 1) * cols + (j + 1) % cols; d = (i + 1) * cols + j
            f += [(a, b, c), (a, c, d)]
    return np.array(f, dtype=np.uint32)


def vertex_normals(v, f):
    n = np.zeros_like(v)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True); ln[ln == 0] = 1
    return n / ln


def orient(v, f, expected):
    """Flip winding so the summed face normal points along `expected`."""
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]).sum(axis=0)
    return f if fn @ np.asarray(expected, float) >= 0 else f[:, ::-1].copy()


def orient_outward(v, f, center):
    c = v[f].mean(axis=1)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    return f if ((c - center) * fn).sum() >= 0 else f[:, ::-1].copy()


class Part:
    """One primitive: positions, normals, optional colours / uvs, a material index."""
    def __init__(self, v, f, mat, color=None, uv=None, normals=None):
        self.v = np.asarray(v, np.float32); self.f = np.asarray(f, np.uint32)
        self.n = np.asarray(normals if normals is not None else vertex_normals(self.v, self.f), np.float32)
        self.mat = mat; self.color = color; self.uv = np.asarray(uv, np.float32) if uv is not None else None


def lerp_colors(t, stops):
    t = np.clip(t, 0, 1)
    xs = [s[0] for s in stops]
    return np.stack([np.interp(t, xs, [s[1][k] for s in stops]) for k in range(3)], axis=-1)


# ---------------------------------------------------------------- avocado half
def avocado_half(side, rows=120, cols_shell=72, rays=160, rings=46):
    """One half. side=+1 is the right half (x ≥ 0), side=-1 the left one.

    Each half gets its own bump pattern, blended to a shared pattern at the cut seam so the
    closed fruit has no cracks and does not look mirrored.
    """
    u = np.linspace(0, 1, rows)
    s = (1 - np.cos(np.pi * u)) / 2                       # cluster rings near the tips
    y = s
    r = radius(s)
    taper = np.clip(r / 0.12, 0, 1) ** 1.5                # no bumps at the tips

    phi = np.linspace(-np.pi / 2, np.pi / 2, cols_shell)  # back (z<0) → front (z>0)
    P = np.zeros((rows, cols_shell, 3))
    P[..., 0] = side * r[:, None] * np.cos(phi)[None, :]
    P[..., 1] = y[:, None]
    P[..., 2] = r[:, None] * np.sin(phi)[None, :]
    Pr = P.copy(); Pr[..., 0] = np.abs(Pr[..., 0])       # shared pattern lives in mirrored space
    seam_w = np.abs(np.cos(phi))[None, :] ** 0.7
    disp = (skin_noise(P, 7 if side > 0 else 19) * seam_w + skin_noise(Pr, 31) * (1 - seam_w)) * taper[:, None]
    radial = np.stack([side * np.cos(phi), np.zeros_like(phi), np.sin(phi)], -1)[None]
    P = P + disp[..., None] * radial
    shell_v = P.reshape(-1, 3)
    shell_f = orient_outward(shell_v, grid_faces(rows, cols_shell), np.array([0, 0.45, 0]))

    # Skin colour: Hass-like deep green, slightly lighter on the pebbles, brown stem scar on top.
    bump = (disp / 0.006).reshape(-1)
    rng = np.random.default_rng(3 if side > 0 else 5)
    tone = 1.0 + 0.55 * np.clip(bump, -0.6, 1.0) + 0.08 * rng.standard_normal(len(bump))
    col = srgb([0.16, 0.27, 0.10])[None] * tone[:, None]
    top = np.clip((shell_v[:, 1] - 0.972) / 0.02, 0, 1)
    col = col * (1 - top[:, None]) + srgb([0.33, 0.22, 0.11])[None] * top[:, None]
    shell = Part(shell_v, shell_f, 'skin', color=np.clip(col, 0, 1))

    # Cut face in the x = 0 plane, as a polar grid around the seed so the cavity rim is a clean
    # circle. Its outline is the displaced shell edge at φ = ±90°.
    outline = np.vstack([np.stack([y, P[:, -1, 2]], -1),            # front edge, bottom → top
                         np.stack([y[::-1], P[::-1, 0, 2]], -1)])   # back edge, top → bottom
    C = np.array([SEED_Y, 0.0])
    alpha = np.linspace(0, 2 * np.pi, rays, endpoint=False)
    dirs = np.stack([np.cos(alpha), np.sin(alpha)], -1)               # (y, z) directions
    A = outline; B = np.roll(outline, -1, axis=0); E = B - A
    # ray C + t·d meets segment A + u·E
    den = dirs[:, None, 0] * E[None, :, 1] - dirs[:, None, 1] * E[None, :, 0]
    AC = A[None] - C
    with np.errstate(divide='ignore', invalid='ignore'):
        t = (AC[..., 0] * E[None, :, 1] - AC[..., 1] * E[None, :, 0]) / den
        uu = (AC[..., 0] * dirs[:, None, 1] - AC[..., 1] * dirs[:, None, 0]) / den
    ok = (uu >= -1e-9) & (uu <= 1 + 1e-9) & (t > 1e-6)
    t = np.where(ok, t, np.inf).min(axis=1)                           # distance to the skin edge
    k_cav = 18                                                        # rings inside the cavity
    rad = np.concatenate([np.linspace(0, CAVITY_R, k_cav, endpoint=False)[None, :].repeat(rays, 0),
                          CAVITY_R + (t[:, None] - CAVITY_R) * np.linspace(0, 1, rings - k_cav)[None, :] ** 1.15], 1)
    Yc = C[0] + rad * dirs[:, None, 0]; Zc = C[1] + rad * dirs[:, None, 1]
    depth = np.where(rad < CAVITY_R, np.sqrt(np.clip(CAVITY_R ** 2 - rad ** 2, 0, None)), 0.0)
    Xc = side * depth
    cut_v = np.stack([Xc, Yc, Zc], -1).transpose(1, 0, 2).reshape(-1, 3)   # rings × rays
    cut_f = grid_faces(rad.shape[1], rays, wrap=True)
    cut_f = orient(cut_v, cut_f, (-side, 0, 0))

    # Flesh colour by absolute distance to the skin: dark rim, bright green band, butter centre.
    dist = (t[:, None] - rad).T.reshape(-1)
    flesh = srgb(lerp_colors(np.clip(dist / 0.16, 0, 1), [
        (0.0, (0.14, 0.26, 0.06)), (0.035, (0.30, 0.50, 0.08)), (0.10, (0.52, 0.70, 0.14)),
        (0.25, (0.76, 0.82, 0.26)), (0.55, (0.90, 0.88, 0.42)), (1.0, (0.95, 0.91, 0.56))]))
    in_cav = (rad.T.reshape(-1) < CAVITY_R)
    flesh[in_cav] = srgb([0.93, 0.89, 0.58]) * (0.92 + 0.08 * (rad.T.reshape(-1)[in_cav] / CAVITY_R))[:, None]
    cut = Part(cut_v, cut_f, 'flesh', color=np.clip(flesh, 0, 1))
    return [shell, cut]


# ---------------------------------------------------------------- other parts
def uv_sphere(radius_xyz, center=(0, 0, 0), rows=48, cols=64):
    th = np.linspace(0, np.pi, rows); ph = np.linspace(0, 2 * np.pi, cols, endpoint=False)
    T, Pp = np.meshgrid(th, ph, indexing='ij')
    v = np.stack([np.sin(T) * np.cos(Pp), np.cos(T), np.sin(T) * np.sin(Pp)], -1).reshape(-1, 3)
    n = v.copy()
    v = v * np.asarray(radius_xyz) + np.asarray(center)
    f = orient_outward(v, grid_faces(rows, cols, wrap=True), np.asarray(center))
    return v, f, n


def seed_part():
    v, f, n = uv_sphere((SEED_R, SEED_R * 1.06, SEED_R))
    rng = np.random.default_rng(11)
    shade = 1 + 0.08 * np.sin(18 * v[:, 1] / SEED_R + 2 * np.sin(5 * v[:, 0] / SEED_R)) \
              + 0.04 * rng.standard_normal(len(v))
    col = srgb([0.55, 0.33, 0.17])[None] * shade[:, None]
    return Part(v, f, 'seed', color=np.clip(col, 0, 1), normals=None)


def disc(radius_, z, segs=96, facing=1):
    a = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    v = np.vstack([[0, 0, z], np.stack([radius_ * np.cos(a), radius_ * np.sin(a), np.full(segs, z)], -1)])
    f = np.array([(0, 1 + i, 1 + (i + 1) % segs) for i in range(segs)], np.uint32)
    f = orient(v, f, (0, 0, facing))
    n = np.tile([0, 0, facing], (len(v), 1))
    return v, f, n


def torus(R, r, rows=96, cols=24, center=(0, 0, 0)):
    a = np.linspace(0, 2 * np.pi, rows, endpoint=False); b = np.linspace(0, 2 * np.pi, cols, endpoint=False)
    A, B = np.meshgrid(a, b, indexing='ij')
    ring = np.stack([np.cos(A), np.sin(A), np.zeros_like(A)], -1)
    n = ring * np.cos(B)[..., None] + np.array([0, 0, 1]) * np.sin(B)[..., None]
    v = ring * R + n * r + np.asarray(center)
    f = grid_faces(rows, cols, wrap=True)
    # wrap rows too
    extra = [(((rows - 1) * cols + j), ((rows - 1) * cols + (j + 1) % cols), (j + 1) % cols) for j in range(cols)] + \
            [(((rows - 1) * cols + j), (j + 1) % cols, j) for j in range(cols)]
    f = np.vstack([f, np.array(extra, np.uint32)])
    v = v.reshape(-1, 3); n = n.reshape(-1, 3)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    if (fn * n[f[:, 0]]).sum() < 0:
        f = f[:, ::-1].copy()
    return v, f, n


def cylinder_band(radius_, z0, z1, segs=96):
    a = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    ring = np.stack([np.cos(a), np.sin(a), np.zeros(segs)], -1)
    v = np.vstack([ring * radius_ + [0, 0, z0], ring * radius_ + [0, 0, z1]])
    n = np.vstack([ring, ring])
    f = grid_faces(2, segs, wrap=True)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    if (fn * n[f[:, 0]]).sum() < 0:
        f = f[:, ::-1].copy()
    return v, f, n


def medallion_parts(logo_aspect):
    thick = 0.03
    parts = []
    v, f, n = disc(MEDAL_R, thick / 2, facing=1); parts.append(Part(v, f, 'medal_face', normals=n))
    v, f, n = disc(MEDAL_R, -thick / 2, facing=-1); parts.append(Part(v, f, 'medal_rim', normals=n))
    v, f, n = cylinder_band(MEDAL_R, -thick / 2, thick / 2); parts.append(Part(v, f, 'medal_rim', normals=n))
    v, f, n = torus(MEDAL_R, 0.018, center=(0, 0, thick / 2)); parts.append(Part(v, f, 'medal_rim', normals=n))
    return parts


def logo_plane(aspect, z):
    """Largest rectangle of this aspect inside 82 % of the medallion face."""
    rho = MEDAL_R * 0.82
    w = 2 * rho * aspect / math.sqrt(1 + aspect ** 2); h = 2 * rho / math.sqrt(1 + aspect ** 2)
    v = np.array([[-w / 2, -h / 2, z], [w / 2, -h / 2, z], [w / 2, h / 2, z], [-w / 2, h / 2, z]], np.float32)
    f = np.array([[0, 1, 2], [0, 2, 3]], np.uint32)
    uv = np.array([[0, 1], [1, 1], [1, 0], [0, 0]], np.float32)
    return Part(v, f, 'logo', uv=uv, normals=np.tile([0, 0, 1], (4, 1)))


def interior_text_plane(material, width=0.40, height=0.11):
    """A front-facing text quad; the half-node rotation lays it onto its cut face."""
    v = np.array([[-width / 2, -height / 2, 0], [width / 2, -height / 2, 0],
                  [width / 2, height / 2, 0], [-width / 2, height / 2, 0]], np.float32)
    f = np.array([[0, 1, 2], [0, 2, 3]], np.uint32)
    uv = np.array([[0, 1], [1, 1], [1, 0], [0, 0]], np.float32)
    return Part(v, f, material, uv=uv, normals=np.tile([0, 0, 1], (4, 1)))


def cavity_point(u, v, inset=0.0, depth=0.10):
    """Project onto the seed bowl and offset toward its air space along the true normal."""
    u, v = np.asarray(u), np.asarray(v)
    if np.any(u * u + v * v >= CAVITY_R ** 2):
        raise ValueError('Cavity patch must stay inside the seed opening')
    h = np.sqrt(CAVITY_R ** 2 - u * u - v * v)
    normal = np.stack([-u, -v, h], -1) / CAVITY_R
    position = np.stack([u, v, np.full_like(h, depth) - h], -1) + inset * normal
    return position, normal


def cavity_patch(material, radius_=0.155, inset=0.0015, rings=12, segments=64):
    radii = np.linspace(radius_ / rings, radius_, rings)
    angles = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    R, A = np.meshgrid(radii, angles, indexing='ij')
    v, n = cavity_point(R * np.cos(A), R * np.sin(A), inset)
    center_v, center_n = cavity_point(np.array(0.0), np.array(0.0), inset)
    v = np.vstack([center_v, v.reshape(-1, 3)])
    n = np.vstack([center_n, n.reshape(-1, 3)])
    fan = np.array([(0, 1 + j, 1 + (j + 1) % segments) for j in range(segments)], np.uint32)
    # Existing grid_faces walks angle before radius, so reverse its winding for +Z-facing bowls.
    f = np.vstack([fan, grid_faces(rings, segments, wrap=True)[:, ::-1] + 1])
    return Part(v, f, material, normals=n)


def cavity_logo(material, aspect, radius_=0.13, inset=0.003, segments=24):
    """Keep the PNG's frontal aspect and UVs while cupping the whole mark into the bowl."""
    width = 2 * radius_ * aspect / math.hypot(1, aspect)
    height = 2 * radius_ / math.hypot(1, aspect)
    U, V = np.meshgrid(np.linspace(-width / 2, width / 2, segments + 1),
                       np.linspace(-height / 2, height / 2, segments + 1))
    v, n = cavity_point(U, V, inset)
    uv = np.stack([U / width + 0.5, 0.5 - V / height], -1)
    f = grid_faces(segments + 1, segments + 1)
    return Part(v.reshape(-1, 3), f, material, uv=uv.reshape(-1, 2), normals=n.reshape(-1, 3))


def glow_ring():
    v, f, n = torus(MEDAL_R * 1.22, 0.008, rows=128, cols=12)
    return [Part(v, f, 'glow', normals=n)]


def rounded_box(size, radius_, center, n=10):
    """Box with rounded edges: grid on each face, then pulled onto an inner box + radius."""
    sx, sy, sz = [s / 2 for s in size]; inner = np.array([sx - radius_, sy - radius_, sz - radius_])
    verts, faces = [], []
    g = np.linspace(-1, 1, n)
    A, B = np.meshgrid(g, g, indexing='ij')
    for axis in range(3):
        for sign in (-1, 1):
            p = np.zeros((n, n, 3))
            o = [k for k in range(3) if k != axis]
            p[..., axis] = sign; p[..., o[0]] = A; p[..., o[1]] = B
            p = p.reshape(-1, 3) * np.array([sx, sy, sz])
            expected = np.zeros(3); expected[axis] = sign
            base = sum(len(x) for x in verts)
            verts.append(p); faces.append(orient(p, grid_faces(n, n), expected) + base)
    v = np.vstack(verts); f = np.vstack(faces)
    clamp = np.clip(v, -inner, inner)
    d = v - clamp; ln = np.linalg.norm(d, axis=1, keepdims=True); ln[ln == 0] = 1
    nrm = d / ln
    v = clamp + nrm * radius_ + np.asarray(center)
    return v, f, nrm


def text_font(size, bold=False):
    """Use scalable fonts on Linux and Windows, including when rebuilding the old plaque."""
    inter = 'Inter-Bold.otf' if bold else 'Inter-Medium.otf'
    arial = 'arialbd.ttf' if bold else 'arial.ttf'
    dejavu = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    candidates = [os.path.join('/usr/share/fonts/opentype/inter', inter),
                  os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', arial),
                  os.path.join('/usr/share/fonts/truetype/dejavu', dejavu), dejavu]
    for font_path in candidates:
        try:
            return ImageFont.truetype(font_path, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def interior_text_texture(label):
    """Dark, centered text on transparency; words are typeset rather than drawn brand logos."""
    W, H = 1200, 330
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for size in range(236, 7, -1):
        font = text_font(size, bold=True)
        left, top, right, bottom = d.textbbox((0, 0), label, font=font)
        if right - left <= W - 80 and bottom - top <= H - 64:
            break
    origin = ((W - (right - left)) / 2 - left, (H - (bottom - top)) / 2 - top)
    d.text(origin, label, fill=(7, 18, 31, 255), font=font)
    return im


def plaque_texture():
    W, H = 512, 160
    im = Image.new('RGBA', (W, H), (102, 194, 219, 255))
    d = ImageDraw.Draw(im)
    f1 = text_font(58, bold=True); f2 = text_font(30)
    d.text((W / 2, 62), 'PROPUESTA', fill=(4, 10, 18, 255), font=f1, anchor='mm')
    d.text((W / 2, 122), 'Activación · concepto', fill=(4, 10, 18, 255), font=f2, anchor='mm')
    return im


def placeholder_logo():
    """Neutral slot: dashed ring and the word LOGO. Not anyone's mark."""
    S = 1024
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c, R = S / 2, S * 0.40
    for k in range(48):
        a0 = k * 360 / 48; d.arc([c - R, c - R, c + R, c + R], a0, a0 + 4.2, fill=(120, 132, 120, 255), width=14)
    font = text_font(150, bold=True); small = text_font(56)
    d.text((c, c - 30), 'LOGO', fill=(110, 122, 110, 255), font=font, anchor='mm')
    d.text((c, c + 95), 'archivo oficial', fill=(140, 150, 140, 255), font=small, anchor='mm')
    return im


# ---------------------------------------------------------------- animation curves
def ease_out_back(t, k=1.6):
    t = np.clip(t, 0, 1); return 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2


def ease_in_out(t):
    t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)


def ease_out(t):
    t = np.clip(t, 0, 1); return 1 - (1 - t) ** 3


def phase(t, a, b):
    return np.clip((t - a) / (b - a), 0, 1)


def quat_y(a):
    return np.stack([np.zeros_like(a), np.sin(a / 2), np.zeros_like(a), np.cos(a / 2)], -1)


def quat_z(a):
    return np.stack([np.zeros_like(a), np.zeros_like(a), np.sin(a / 2), np.cos(a / 2)], -1)


def quat_mul(q, p):
    x1, y1, z1, w1 = np.moveaxis(q, -1, 0); x2, y2, z2, w2 = np.moveaxis(p, -1, 0)
    return np.stack([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2], -1)


# ---------------------------------------------------------------- glTF writer
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.g = {'asset': {'version': '2.0', 'generator': 'palta_reveal.py (Spatial Agents · Operating System)'},
                  'scene': 0, 'scenes': [{'name': 'PaltaReveal', 'nodes': []}], 'nodes': [], 'meshes': [],
                  'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': [], 'animations': [],
                  'images': [], 'textures': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987,
                                                               'wrapS': 33071, 'wrapT': 33071}],
                  'extensionsUsed': ['KHR_materials_emissive_strength']}
        self.mat_index = {}

    def _view(self, data, target=None):
        while len(self.bin) % 4: self.bin.append(0)
        off = len(self.bin); self.bin += data
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: bv['target'] = target
        self.g['bufferViews'].append(bv); return len(self.g['bufferViews']) - 1

    def accessor(self, arr, kind, ctype=5126, target=None, normalized=False, minmax=False):
        arr = np.ascontiguousarray(arr)
        view = self._view(arr.tobytes(), target)
        acc = {'bufferView': view, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': kind}
        if normalized: acc['normalized'] = True
        if minmax:
            acc['min'] = [float(x) for x in np.atleast_1d(arr.min(axis=0))]
            acc['max'] = [float(x) for x in np.atleast_1d(arr.max(axis=0))]
        self.g['accessors'].append(acc); return len(self.g['accessors']) - 1

    def image(self, pil, name):
        buf = io.BytesIO(); pil.save(buf, 'PNG')
        view = self._view(buf.getvalue())
        self.g['images'].append({'name': name, 'bufferView': view, 'mimeType': 'image/png'})
        self.g['textures'].append({'sampler': 0, 'source': len(self.g['images']) - 1, 'name': name})
        return len(self.g['textures']) - 1

    def image_png(self, path, name):
        """Embed an official PNG byte-for-byte, preserving the supplied artwork."""
        with open(path, 'rb') as fh:
            data = fh.read()
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('Official cavity logo must be a PNG: ' + path)
        view = self._view(data)
        self.g['images'].append({'name': name, 'bufferView': view, 'mimeType': 'image/png'})
        self.g['textures'].append({'sampler': 0, 'source': len(self.g['images']) - 1, 'name': name})
        return len(self.g['textures']) - 1

    def material(self, key, m):
        self.g['materials'].append(m); self.mat_index[key] = len(self.g['materials']) - 1

    def mesh(self, name, parts):
        prims = []
        for p in parts:
            attrs = {'POSITION': self.accessor(p.v, 'VEC3', target=34962, minmax=True),
                     'NORMAL': self.accessor(p.n, 'VEC3', target=34962)}
            if p.color is not None:
                c = np.clip(np.hstack([p.color, np.ones((len(p.color), 1))]) * 255 + .5, 0, 255).astype(np.uint8)
                attrs['COLOR_0'] = self.accessor(c, 'VEC4', 5121, target=34962, normalized=True)
            if p.uv is not None:
                attrs['TEXCOORD_0'] = self.accessor(p.uv, 'VEC2', target=34962)
            idx = p.f.reshape(-1)
            small = idx.max() < 65535
            idx = idx.astype(np.uint16 if small else np.uint32)
            prims.append({'attributes': attrs, 'indices': self.accessor(idx, 'SCALAR', 5123 if small else 5125, target=34963),
                          'material': self.mat_index[p.mat]})
        self.g['meshes'].append({'name': name, 'primitives': prims}); return len(self.g['meshes']) - 1

    def node(self, name, parent=None, mesh=None, t=None, r=None, s=None, extras=None):
        n = {'name': name}
        if mesh is not None: n['mesh'] = mesh
        if t is not None: n['translation'] = [float(x) for x in t]
        if r is not None: n['rotation'] = [float(x) for x in r]
        if s is not None: n['scale'] = [float(x) for x in s]
        if extras: n['extras'] = extras
        self.g['nodes'].append(n); i = len(self.g['nodes']) - 1
        if parent is None: self.g['scenes'][0]['nodes'].append(i)
        else: self.g['nodes'][parent].setdefault('children', []).append(i)
        return i

    def animation(self, name, tracks, times):
        tin = self.accessor(times.astype(np.float32), 'SCALAR', minmax=True)
        samplers, channels = [], []
        for node, path, values in tracks:
            kind = 'VEC4' if path == 'rotation' else 'VEC3'
            out = self.accessor(values.astype(np.float32), kind)
            samplers.append({'input': tin, 'output': out, 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': path}})
        self.g['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})

    def write(self, path):
        while len(self.bin) % 4: self.bin.append(0)
        self.g['buffers'] = [{'byteLength': len(self.bin)}]
        for k in ['images', 'textures']:
            if not self.g[k]: del self.g[k]
        js = json.dumps(self.g, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        while len(js) % 4: js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as fh:
            fh.write(struct.pack('<III', 0x46546C67, 2, total))
            fh.write(struct.pack('<II', len(js), 0x4E4F534A)); fh.write(js)
            fh.write(struct.pack('<II', len(self.bin), 0x004E4942)); fh.write(self.bin)
        return total


def pbr(name, color, rough, metal=0.0, emissive=None, strength=None, tex=None, emissive_tex=None,
        alpha=None, double=False):
    m = {'name': name, 'pbrMetallicRoughness': {'baseColorFactor': [*color, 1.0] if len(color) == 3 else list(color),
                                                 'roughnessFactor': rough, 'metallicFactor': metal}}
    if tex is not None: m['pbrMetallicRoughness']['baseColorTexture'] = {'index': tex}
    if emissive is not None: m['emissiveFactor'] = list(emissive)
    if emissive_tex is not None: m['emissiveTexture'] = {'index': emissive_tex}
    if strength: m['extensions'] = {'KHR_materials_emissive_strength': {'emissiveStrength': strength}}
    if alpha: m['alphaMode'] = alpha
    if double: m['doubleSided'] = True
    return m


# ---------------------------------------------------------------- build
def build(out_path, logo_path=None, fruit_height=0.75, pedestal_height=0.95):
    if logo_path:
        logo = Image.open(logo_path).convert('RGBA'); source = os.path.basename(logo_path)
    else:
        logo = placeholder_logo(); source = 'placeholder'
    aspect = logo.width / logo.height

    g = GLB()
    tex_logo = g.image(logo, 'Palta reveal logo slot')
    tex_plaque = g.image(plaque_texture(), 'Palta reveal proposal plaque')
    tex_soroswap = g.image(interior_text_texture('SoroSwap'), 'SoroSwap interior label')
    tex_defindex = g.image(interior_text_texture('DeFindex'), 'DeFindex interior label')
    partner_logos = {}
    for key, brand in [('soroswap', 'SoroSwap'), ('defindex', 'DeFindex')]:
        logo_file = os.path.join(ROOT, 'dist', 'assets', 'palta-reveal', 'partners', key + '.png')
        with Image.open(logo_file) as official:
            logo_aspect = official.width / official.height
        partner_logos[key] = {
            'brand': brand, 'aspect': logo_aspect,
            'source': 'https://links.paltalabs.io/' + key + '.svg',
            'texture': g.image_png(logo_file, brand + ' official cavity logo'),
        }
    g.material('skin', pbr('Avocado skin • deep green pebbled', (1, 1, 1), 0.52, 0.0))
    g.material('flesh', pbr('Avocado flesh • butter to green', (1, 1, 1), 0.38, 0.0))
    g.material('seed', pbr('Avocado seed • polished brown', (1, 1, 1), 0.28, 0.0))
    g.material('medal_face', pbr('Medallion face • warm white', (0.93, 0.93, 0.89), 0.45, 0.0,
                                 emissive=(0.93, 0.93, 0.89), strength=0.15))
    g.material('medal_rim', pbr('Medallion rim • satin champagne', (0.80, 0.70, 0.48), 0.32, 0.75))
    g.material('logo', pbr('Medallion logo • official file', (1, 1, 1), 0.5, 0.0, emissive=(1, 1, 1),
                           strength=0.35, tex=tex_logo, emissive_tex=tex_logo, alpha='BLEND'))
    g.material('glow', pbr('Reveal glow • avocado lime', tuple(srgb([0.62, 0.86, 0.22])), 0.5, 0.0,
                           emissive=tuple(srgb([0.62, 0.86, 0.22])), strength=1.4))
    g.material('pedestal', pbr('Palta pedestal navy', (0.025, 0.055, 0.12), 0.55, 0.15))
    g.material('seam', pbr('Palta pedestal lime seam', (0.55, 0.78, 0.22), 0.4, 0.0,
                           emissive=(0.55, 0.78, 0.22), strength=0.9))
    g.material('plaque', pbr('Palta proposal plaque', (1, 1, 1), 0.5, 0.0, tex=tex_plaque))
    g.material('soroswap_text', pbr('SoroSwap interior text', (1, 1, 1), 0.8,
                                    tex=tex_soroswap, alpha='BLEND'))
    g.material('defindex_text', pbr('DeFindex interior text', (1, 1, 1), 0.8,
                                    tex=tex_defindex, alpha='BLEND'))
    g.material('cavity_backing', pbr('Seed cavity logo support navy',
                                      tuple(srgb([7 / 255, 18 / 255, 31 / 255])), 0.65))
    for key, official in partner_logos.items():
        g.material(key + '_logo', pbr(official['brand'] + ' official cavity logo', (1, 1, 1), 0.65,
                                     tex=official['texture'], alpha='BLEND',
                                     emissive=(1, 1, 1), emissive_tex=official['texture'], strength=0.60))

    # meshes
    right, left = avocado_half(+1), avocado_half(-1)
    for p in right + left:   # put the hinge at the node origin
        p.v[:, 2] -= HINGE_Z
    m_right = g.mesh('Avocado half right', right)
    m_left = g.mesh('Avocado half left', left)
    m_seed = g.mesh('Avocado seed', [seed_part()])
    m_medal = g.mesh('Medallion', medallion_parts(aspect))
    m_logo = g.mesh('Logo slot', [logo_plane(aspect, 0.03 / 2 + 0.002)])
    m_glow = g.mesh('Glow ring', glow_ring())
    m_soroswap = g.mesh('SoroSwap interior label', [interior_text_plane('soroswap_text')])
    m_defindex = g.mesh('DeFindex interior label', [interior_text_plane('defindex_text')])
    # Both the dark support and official mark follow the original concavity; its flesh rim stays visible.
    m_cavity_backing = g.mesh('Seed cavity logo support', [cavity_patch('cavity_backing')])
    for key, official in partner_logos.items():
        official['mesh'] = g.mesh(official['brand'] + ' official cavity logo',
                                  [cavity_logo(key + '_logo', official['aspect'])])
    pv, pf, pn = rounded_box((0.6, pedestal_height, 0.6), 0.025, (0, pedestal_height / 2, 0))
    seam_v, seam_f, seam_n = rounded_box((0.035, pedestal_height * 0.50, 0.012), 0.004,
                                         (0, pedestal_height * 0.64, 0.301))
    plaque = Part(np.array([[-0.13, 0.17, 0.307], [0.13, 0.17, 0.307], [0.13, 0.25, 0.307], [-0.13, 0.25, 0.307]]),
                  np.array([[0, 1, 2], [0, 2, 3]]), 'plaque',
                  uv=np.array([[0, 1], [1, 1], [1, 0], [0, 0]], np.float32), normals=np.tile([0, 0, 1], (4, 1)))
    m_ped = g.mesh('Palta pedestal', [Part(pv, pf, 'pedestal', normals=pn), Part(seam_v, seam_f, 'seam', normals=seam_n), plaque])

    # nodes
    root = g.node('palta_reveal', extras={
        'status': 'Proposed activation concept; not an observed installation.',
        'logo': 'Node palta_logo_slot shows ' + source + '. Supply the partner\'s official file.',
        'animations': 'open (play once, reverse to close); idle (loop, child nodes only)',
        'units': 'metres, Y up, front +Z'})
    g.node('palta_pedestal', root, m_ped)
    k = fruit_height
    # The turntable is never animated: the viewer module turns it to face the visitor.
    turn = g.node('palta_turntable', root, t=(0, pedestal_height, 0))
    fruit = g.node('palta_fruit', turn, s=(k, k, k))
    n_right = g.node('palta_half_right', fruit, m_right, t=(0, 0, HINGE_Z))
    n_left = g.node('palta_half_left', fruit, m_left, t=(0, 0, HINGE_Z))
    # Inward normals are +/-X when closed, then face +Z as the halves open by 62 degrees.
    g.node('palta_label_soroswap', n_left, m_soroswap,
           t=(0.008, 0.66, -HINGE_Z), r=quat_y(np.pi / 2), extras={'text': 'SoroSwap'})
    g.node('palta_label_defindex', n_right, m_defindex,
           t=(-0.008, 0.66, -HINGE_Z), r=quat_y(-np.pi / 2), extras={'text': 'DeFindex'})
    for key, half, side in [('soroswap', n_left, -1), ('defindex', n_right, 1)]:
        official = partner_logos[key]
        # Curved vertices use this group's depth=0.10 frame; normals point into the air space.
        # Logo starts outside, then the open clip settles it onto the curved dark backing.
        cavity = g.node('palta_cavity_' + key, half,
                        t=(side * 0.10, SEED_Y, -HINGE_Z), r=quat_y(-side * np.pi / 2))
        g.node('palta_cavity_' + key + '_backing', cavity, m_cavity_backing)
        official['node'] = g.node('palta_logo_' + key, cavity, official['mesh'],
                                  t=(0, 0, 0.25), s=(0.001,) * 3,
                                  extras={'brand': official['brand'], 'source': official['source'],
                                          'aspect': official['aspect'], 'projection': 'cavity-sphere'})
    n_seed = g.node('palta_seed', fruit, m_seed, t=(0, SEED_Y, 0))
    # At the default scale, the center is 2.105 m high and the whole glow ring clears
    # the open halves by 10.74 cm (including the ring tube radius of 0.008 fruit units).
    medal_rest = np.array([0, 1.54, 0.12])
    n_medal = g.node('palta_medallion', fruit, t=(0, SEED_Y, 0), s=(0.001,) * 3)
    n_float = g.node('palta_medallion_float', n_medal)
    g.node('palta_medallion_body', n_float, m_medal)
    g.node('palta_logo_slot', n_float, m_logo, extras={'aspect': aspect, 'source': source})
    n_glow = g.node('palta_glow_ring', fruit, t=medal_rest - [0, 0, 0.03], s=(0.001,) * 3)
    n_spin = g.node('palta_glow_spin', n_glow, m_glow)

    # ---- "open" (0 → 2.6 s)
    T = np.arange(0, 2.6 + 1e-9, 1 / FPS)
    wob = np.where(T < 0.55, np.sin(T / 0.55 * 3 * np.pi) * math.radians(4) * (1 - T / 0.55) * np.clip(T / 0.1, 0, 1), 0)
    squash = 1 - 0.035 * np.exp(-((T - 0.45) / 0.08) ** 2)
    fruit_r = quat_z(wob)
    fruit_s = np.stack([k * (2 - squash), k * squash, k * (2 - squash)], -1)
    ang = OPEN_ANGLE * ease_out_back(phase(T, 0.5, 1.6), 1.3)
    lift = 0.035 * ease_in_out(phase(T, 0.5, 1.2))
    right_t = np.stack([np.zeros_like(T), lift, np.full_like(T, HINGE_Z)], -1)
    seed_rise = ease_in_out(phase(T, 0.85, 1.45))
    seed_shrink = ease_in_out(phase(T, 1.45, 1.95))
    seed_y = SEED_Y + 0.10 * seed_rise
    seed_scale = (1 + 0.12 * seed_rise) * (1 - seed_shrink) + 0.001
    m_grow = ease_out_back(phase(T, 1.45, 2.3), 1.7)
    flight = phase(T, 1.45, 2.5)
    m_move = ease_in_out(flight)
    medal_t = np.array([0, SEED_Y + 0.10, 0])[None] * (1 - m_move[:, None]) + medal_rest[None] * m_move[:, None]
    medal_t[:, 2] += 0.10 * np.sin(np.pi * flight)  # a small forward arc, centered on X throughout
    medal_rot = quat_y(-np.pi * (1 - ease_out(phase(T, 1.45, 2.4))))
    medal_s = np.maximum(m_grow, 0.001)
    glow_s = np.maximum(ease_out(phase(T, 1.9, 2.6)), 0.001)
    # Let the center medallion rise first, then bring both curved marks from outside into their bowls.
    logo_grow = 0.001 + 0.999 * ease_in_out(phase(T, 1.85, 2.05))
    logo_entry = 0.25 * (1 - ease_in_out(phase(T, 2.05, 2.5)))
    logo_t = np.stack([np.zeros_like(T), np.zeros_like(T), logo_entry], -1)
    logo_tracks = []
    for official in partner_logos.values():
        logo_tracks += [(official['node'], 'translation', logo_t),
                        (official['node'], 'scale', np.repeat(logo_grow[:, None], 3, 1))]
    g.animation('open', [
        (fruit, 'rotation', fruit_r), (fruit, 'scale', fruit_s),
        (n_right, 'rotation', quat_y(ang)), (n_right, 'translation', right_t),
        (n_left, 'rotation', quat_y(-ang)), (n_left, 'translation', right_t),
        (n_seed, 'translation', np.stack([np.zeros_like(T), seed_y, np.zeros_like(T)], -1)),
        (n_seed, 'scale', np.repeat(seed_scale[:, None], 3, 1)),
        (n_medal, 'translation', medal_t), (n_medal, 'rotation', medal_rot),
        (n_medal, 'scale', np.repeat(medal_s[:, None], 3, 1)),
        (n_glow, 'translation', medal_t - [0, 0, 0.03]),
        (n_glow, 'scale', np.repeat(glow_s[:, None], 3, 1)),
    ] + logo_tracks, T)

    # ---- "idle" (3.2 s loop)
    I = np.arange(0, 3.2 + 1e-9, 1 / FPS); w = 2 * np.pi * I / 3.2
    g.animation('idle', [
        (n_float, 'translation', np.stack([np.zeros_like(I), 0.018 * np.sin(w), np.zeros_like(I)], -1)),
        (n_float, 'rotation', quat_y(math.radians(7) * np.sin(w + 0.6))),
        (n_spin, 'rotation', quat_z(-w)),
    ], I)

    size = g.write(out_path)
    return {'path': out_path, 'bytes': size, 'logo': source, 'aspect': aspect,
            'vertices': int(sum(a['count'] for a in g.g['accessors'] if a['type'] == 'VEC3' and 'min' in a))}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--logo', help='official logo file (PNG with transparency works best)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist', 'assets', 'palta-reveal.glb'))
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    print(json.dumps(build(a.out, a.logo), indent=1))
