"""Shared, rounded event-chair geometry. Local front is -Y; center is floor.

One mesh with two material slots is reused for every matching upholstery/frame
pair. Curves and normals are baked once, without per-chair bevel modifiers.
Dimensions are estimates reconstructed from the venue's event furniture.
The pure chair_geometry()/chair_spec() helpers do not import Blender.
"""
from __future__ import annotations
import math

_GEOMETRY = None
_MESH_CACHE = {}


def chair_spec():
    return {
        "front": [0, -1, 0], "envelope": [.52, .60, .88],
        "seatWidth": .46, "seatDepth": .44, "seatHeight": .46,
        "backWidth": .45, "backPanelHeight": .34, "overallHeight": .86,
        "backRakeDegrees": 8, "seatCornerRadius": .025,
        "backOutlineRadius": .04, "backCurveDepth": .018,
        "materialSlots": 2,
    }


def _unit(vector):
    length = math.sqrt(sum(v*v for v in vector))
    if length < 1e-12:
        raise ValueError("Degenerate chair geometry normal")
    return tuple(v/length for v in vector)


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2],
            a[0]*b[1]-a[1]*b[0])


class _Geometry:
    def __init__(self):
        self.vertices, self.normals, self.faces = [], [], []
        self.materials, self.loop_normals = [], []

    def face(self, face, material, normal=None):
        self.faces.append(tuple(face))
        self.materials.append(material)
        self.loop_normals.extend(normal if normal is not None else self.normals[i]
                                 for i in face)

    def rounded_box(self, center, size, radii, material=0, rake=0,
                    curve=0, crown=0):
        """Welded rounded cuboid, with optional concave back and padded seat."""
        half = [value/2 for value in size]
        radii = [min(r, h*.94) for r, h in zip(radii, half)]
        axes = []
        for h, r in zip(half, radii):
            axes.append(sorted(set([-h, -h+r*.5, -h+r, 0, h-r, h-r*.5, h])))
        cache = {}
        cosine, sine = math.cos(rake), math.sin(rake)

        def vertex(raw):
            core = [max(-h+r, min(h-r, v)) for v, h, r in zip(raw, half, radii)]
            q = [(v-c)/r for v, c, r in zip(raw, core, radii)]
            q = _unit(q)
            point = [c+n*r for c, n, r in zip(core, q, radii)]
            normal = _unit([n/r for n, r in zip(q, radii)])
            x, y, z = point
            if crown:
                fx = max(0, 1-(x/half[0])**2)
                fy = max(0, 1-(y/half[1])**2)
                t = max(0, min(1, (z-(half[2]-radii[2]))/radii[2]))
                point[2] += crown*fx*fy*t
                dx = crown*(-2*x/half[0]**2)*fy*t
                dy = crown*fx*(-2*y/half[1]**2)*t
                dz = crown*fx*fy/radii[2] if 0 < t < 1 else 0
                nz = normal[2]/(1+dz)
                normal = _unit((normal[0]-dx*nz, normal[1]-dy*nz, nz))
            if curve:
                point[1] -= curve*(point[0]/half[0])**2
                normal = _unit((normal[0]+2*curve*point[0]/half[0]**2*normal[1],
                                normal[1], normal[2]))
            x, y, z = point
            point = (center[0]+x, center[1]+cosine*y-sine*z,
                     center[2]+sine*y+cosine*z)
            nx, ny, nz = normal
            normal = _unit((nx, cosine*ny-sine*nz, sine*ny+cosine*nz))
            key = tuple(round(v, 10) for v in point)
            if key not in cache:
                cache[key] = len(self.vertices)
                self.vertices.append(point)
                self.normals.append(normal)
            return cache[key]

        for axis in range(3):
            u, v = (axis+1) % 3, (axis+2) % 3
            for sign in (-1, 1):
                grid = []
                for j, vv in enumerate(axes[v]):
                    row = []
                    for i, uu in enumerate(axes[u]):
                        raw = [0, 0, 0]
                        raw[axis], raw[u], raw[v] = sign*half[axis], uu, vv
                        row.append(vertex(raw))
                    grid.append(row)
                for j in range(len(axes[v])-1):
                    for i in range(len(axes[u])-1):
                        face = (grid[j][i], grid[j][i+1],
                                grid[j+1][i+1], grid[j+1][i])
                        self.face(face if sign > 0 else tuple(reversed(face)), material)

    def rod(self, start, end, radius, material=1, segments=10):
        direction = _unit(tuple(end[i]-start[i] for i in range(3)))
        auxiliary = (0, 0, 1) if abs(direction[2]) < .9 else (0, 1, 0)
        u = _unit(_cross(direction, auxiliary))
        v = _cross(direction, u)
        base = len(self.vertices)
        for center in (start, end):
            for i in range(segments):
                angle = i*math.tau/segments
                normal = tuple(u[k]*math.cos(angle)+v[k]*math.sin(angle)
                               for k in range(3))
                self.vertices.append(tuple(center[k]+radius*normal[k]
                                           for k in range(3)))
                self.normals.append(normal)
        self.face(tuple(base+i for i in range(segments-1, -1, -1)), material,
                  tuple(-n for n in direction))
        self.face(tuple(base+segments+i for i in range(segments)), material, direction)
        for i in range(segments):
            following = (i+1) % segments
            self.face((base+i, base+following, base+segments+following,
                       base+segments+i), material)


def chair_geometry():
    """Return the finite, shared local mesh data used by all event chairs."""
    global _GEOMETRY
    if _GEOMETRY is not None:
        return _GEOMETRY
    g = _Geometry()
    g.rounded_box((0, 0, .425), (.46, .44, .06), (.025, .025, .025),
                  crown=.005)
    # The main 34 cm back panel keeps its observed outline, while a rounded
    # lumbar connector joins it to the seat instead of leaving a floating slot.
    rake = -math.radians(8)
    g.rounded_box((0, .20, .6889), (.45, .04, .34), (.04, .018, .04),
                  rake=rake, curve=.018)
    g.rounded_box((0, .19, .49), (.40, .06, .13), (.025, .024, .03),
                  rake=rake, curve=.012)
    # Under-seat frame and four thin, splayed legs with planted foot caps.
    for x in (-.205, .205):
        g.rod((x, -.17, .389), (x, .17, .389), .0105)
    for y in (-.17, .17):
        g.rod((-.205, y, .389), (.205, y, .389), .0105)
    for side in (-1, 1):
        for front in (-1, 1):
            foot = (side*.244, front*.255, .008)
            top = (side*.205, front*.165, .402)
            g.rod(foot, top, .0105)
            g.rod((foot[0], foot[1], 0), (foot[0], foot[1], .016), .015)
        g.rod((side*.19, .18, .402), (side*.19, .225, .825), .009)
    g.rod((-.19, .208, .62), (.19, .208, .62), .008)
    mins = [min(p[i] for p in g.vertices) for i in range(3)]
    maxs = [max(p[i] for p in g.vertices) for i in range(3)]
    _GEOMETRY = {
        "vertices": tuple(g.vertices), "faces": tuple(g.faces),
        "normals": tuple(g.normals), "loopNormals": tuple(g.loop_normals),
        "materialIndices": tuple(g.materials),
        "bounds": {"min": mins, "max": maxs}, "spec": chair_spec(),
    }
    return _GEOMETRY


def _shared_mesh(material, frame_material):
    import bpy
    key = (material.as_pointer(), frame_material.as_pointer())
    mesh = _MESH_CACHE.get(key)
    if mesh is not None and bpy.data.meshes.get(mesh.name) == mesh:
        return mesh
    data = chair_geometry()
    mesh = bpy.data.meshes.new("Venue event chair shared · "+material.name+" / "+frame_material.name)
    mesh.from_pydata(data["vertices"], [], data["faces"])
    mesh.update()
    mesh.materials.append(material)
    mesh.materials.append(frame_material)
    for polygon, index in zip(mesh.polygons, data["materialIndices"]):
        polygon.material_index = index
        polygon.use_smooth = True
    # Analytic normals keep broad faces calm and rounded edges curved.
    if hasattr(mesh, "normals_split_custom_set"):
        mesh.normals_split_custom_set(data["loopNormals"])
    elif hasattr(mesh, "normals_split_custom_set_from_vertices"):
        mesh.normals_split_custom_set_from_vertices(data["normals"])
    mesh["shared_event_chair"] = True
    _MESH_CACHE[key] = mesh
    return mesh


def build_chair(name, center=(0, 0, 0), material=None, frame_material=None, angle=0):
    """Build one root/one mesh instance; material arguments are bpy Materials."""
    import bpy
    if material is None or frame_material is None:
        raise ValueError("build_chair requires upholstery and frame Blender materials")
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root.location = tuple(float(value) for value in center)
    root.rotation_euler.z = angle
    root["role"] = "venue-chair"
    root["isFurniture"] = True
    root["seatHeight"] = .46
    root["overallHeight"] = .86
    root["envelope"] = [.52, .60, .88]
    root["front"] = [0, -1, 0]
    root["dimensions_status"] = "Estimated event chair; not field measured"
    obj = bpy.data.objects.new(name+" shared seating mesh",
                               _shared_mesh(material, frame_material))
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    return root

