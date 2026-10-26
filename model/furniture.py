"""Padded arrival furniture reconstructed from the owner's October 26 videos.

Each part is an independent mesh: rounding and weighted normals never affect
the venue architecture or the seven interior steps. Blender is Z-up, a sofa's
local front is -Y, and center[2] is its floor elevation. All dimensions are
visual estimates, not measurements. No external texture or attendee data is
embedded here; appearance.py assigns the shared fabric maps after construction.
"""
from __future__ import annotations

import math
import bpy

_REFERENCE = "VID_20261026_021740335.mp4; VID_20261026_021758544.mp4 at 08.0, 10.1, 13.5 and 15.5 s"
_CORNER_RADIUS = .045
_BACK_RAKE = math.radians(9)
_CLEARANCE = .035


def _root(name, center, angle=0):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = tuple(float(value) for value in center)
    obj.rotation_euler.z = angle
    obj["reference"] = _REFERENCE
    obj["dimensions_status"] = "Estimated from video; not field measured"
    return obj


def _mesh_part(name, vertices, faces, material, parent, location=(0, 0, 0),
               rotation=(0, 0, 0), bevel=0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    if bevel:
        rounded = obj.modifiers.new("Upholstered rounded edges", "BEVEL")
        rounded.width = bevel
        rounded.segments = 3
        rounded.limit_method = "ANGLE"
        rounded.angle_limit = math.radians(30)
        rounded.harden_normals = True
        rounded.face_strength_mode = "FSTR_AFFECTED"
    normals = obj.modifiers.new("Padded surface weighted normals", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    normals.weight = 50
    normals.mode = "FACE_AREA_WITH_ANGLE"
    obj["furniture_part"] = True
    return obj


def _rounded_box(name, location, size, material, parent, radius=_CORNER_RADIUS,
                 rotation=(0, 0, 0), crown=0):
    """A closed box; a sampled top surface gives cushions a gentle real bulge.

    The top is sampled before the edge bevel, so the cushion is not a flat
    slab with a painted seam. Internal top edges remain below the bevel's
    angle threshold. Mesh coordinates include dimensions, avoiding scaled
    modifiers, stretched radii or dependence on Blender's active object.
    """
    width, depth, height = map(float, size)
    if min(width, depth, height) <= 0:
        raise ValueError("Furniture part dimensions must be positive")
    nx, ny = (6, 5) if crown else (1, 1)
    vertices = []
    layer_size = (nx + 1) * (ny + 1)
    for layer in range(2):
        for j in range(ny + 1):
            v = j / ny
            for i in range(nx + 1):
                u = i / nx
                z = (-height / 2 if layer == 0 else height / 2)
                if layer == 1:
                    z += crown * math.sin(math.pi * u) * math.sin(math.pi * v)
                vertices.append(((u - .5) * width, (v - .5) * depth, z))
    def index(i, j, layer):
        return layer * layer_size + j * (nx + 1) + i
    faces = []
    for j in range(ny):
        for i in range(nx):
            a, b = index(i, j, 0), index(i + 1, j, 0)
            c, d = index(i + 1, j + 1, 0), index(i, j + 1, 0)
            faces.append((a, d, c, b))
            faces.append(tuple(vertex + layer_size for vertex in (a, b, c, d)))
    for i in range(nx):
        faces.append((index(i, 0, 0), index(i + 1, 0, 0),
                      index(i + 1, 0, 1), index(i, 0, 1)))
        faces.append((index(i + 1, ny, 0), index(i, ny, 0),
                      index(i, ny, 1), index(i + 1, ny, 1)))
    for j in range(ny):
        faces.append((index(0, j + 1, 0), index(0, j, 0),
                      index(0, j, 1), index(0, j + 1, 1)))
        faces.append((index(nx, j, 0), index(nx, j + 1, 0),
                      index(nx, j + 1, 1), index(nx, j, 1)))
    return _mesh_part(name, vertices, faces, material, parent, location, rotation,
                      min(radius, min(size) * .44))


def _rotated_bounds(x0, x1, y0, y1, center, angle, margin=_CLEARANCE):
    """Conservative world-aligned collider around a rotated local rectangle."""
    c, s = math.cos(angle), math.sin(angle)
    corners = [(center[0] + c * x - s * y,
                center[1] + s * x + c * y)
               for x in (x0, x1) for y in (y0, y1)]
    return (min(x for x, _ in corners) - margin,
            max(x for x, _ in corners) + margin,
            min(y for _, y in corners) - margin,
            max(y for _, y in corners) + margin)


def _register_bounds(block, bounds):
    x0, x1, y0, y1 = bounds
    block((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)


def build_sofa(name, center=(0, 0, 0), width=1.4, material=None,
               angle=0, chaise=False, mirrored=False):
    """Return a padded sofa root, with the floor origin at center.

    Small modules have one continuous seat cushion. The 2.2 m L has a normal
    cushion and a long chaise cushion; mirrored=True places its return on local
    -X. Local main depth is 1.0 m, increasing to 1.5 m on the return. Both blue
    modules use the same 0.40 m seat and approximately 0.84 m back height.
    """
    if material is None:
        raise ValueError("build_sofa requires an actual Blender material")
    if width < .95:
        raise ValueError("A padded sofa must be at least 0.95 m wide")
    root = _root(name, center, angle)
    root["furniture_type"] = "padded L sofa" if chaise else "padded armchair"
    root["estimated_width_m"] = width
    root["estimated_depth_m"] = 1.5 if chaise else 1.0
    root["estimated_height_m"] = .84
    root["seat_height_m"] = .40
    root["back_rake_degrees"] = 9
    root["mirrored_return"] = bool(mirrored)

    _rounded_box(name + " upholstered plinth", (0, 0, .14),
                 (width, 1.0, .28), material, root, radius=.05)
    # A puffed panel is modeled flat in XY, then turned upright and raked back.
    # Its front crown follows -Y; its upper edge leans toward the rear (+Y).
    _rounded_box(name + " soft raked back", (0, .365, .576),
                 (width, .50, .18), material, root, radius=.05,
                 rotation=(math.pi / 2 - _BACK_RAKE, 0, 0), crown=.012)
    # The frame continues below the raked cushion. It closes the rear gap
    # between plinth and back; the front cushion still has a fine soft seam.
    _rounded_box(name + " lower back upholstery bridge", (0, .38, .30),
                 (width - .22, .24, .20), material, root, radius=.04)
    for side in (-1, 1):
        _rounded_box(name + (" left padded arm" if side < 0 else " right padded arm"),
                     (side * (width / 2 - .09), -.015, .432),
                     (.18, .97, .40), material, root, radius=.045, crown=.008)

    inner_width = width - .36
    if not chaise:
        _rounded_box(name + " continuous seat cushion", (0, -.12, .32),
                     (inner_width - .018, .76, .14), material, root,
                     radius=.05, crown=.010)
    else:
        sign = -1 if mirrored else 1
        chaise_width = min(.78, inner_width * .48)
        gap = .018
        normal_width = inner_width - chaise_width - gap
        chaise_x = sign * (inner_width / 2 - chaise_width / 2)
        normal_x = -sign * (inner_width / 2 - normal_width / 2)
        # Only the extension outside the main plinth is modeled, avoiding
        # overlapping coplanar top faces under the seat cushions.
        _rounded_box(name + " chaise plinth extension",
                     (sign * (width / 2 - .48), -.75, .14),
                     (.96, .50, .28), material, root, radius=.05)
        _rounded_box(name + " regular seat cushion", (normal_x, -.12, .32),
                     (normal_width, .76, .14), material, root,
                     radius=.05, crown=.010)
        _rounded_box(name + " long chaise cushion", (chaise_x, -.37, .32),
                     (chaise_width, 1.26, .14), material, root,
                     radius=.05, crown=.010)
    return root


def _ring_mesh(name, rings, material, parent, center=(0, 0, 0), segments=64,
               cap_bottom=True, cap_top=True):
    vertices = []
    for radius, z in rings:
        vertices.extend((center[0] + radius * math.cos(i * math.tau / segments),
                         center[1] + radius * math.sin(i * math.tau / segments),
                         center[2] + z) for i in range(segments))
    faces = []
    for j in range(len(rings) - 1):
        for i in range(segments):
            following = (i + 1) % segments
            faces.append((j * segments + i, j * segments + following,
                          (j + 1) * segments + following, (j + 1) * segments + i))
    if cap_bottom:
        faces.append(tuple(range(segments - 1, -1, -1)))
    if cap_top:
        faces.append(tuple((len(rings) - 1) * segments + i for i in range(segments)))
    return _mesh_part(name, vertices, faces, material, parent)


def build_pouf(name, center=(0, 0, 0), material=None, diameter=.64, height=.44):
    """Return a smooth 64-sided upholstered pouf with a 2.5 cm padded rim."""
    if material is None:
        raise ValueError("build_pouf requires an actual Blender material")
    if diameter <= .10 or height <= .10:
        raise ValueError("Pouf dimensions must exceed 0.10 m")
    root = _root(name, center)
    root["furniture_type"] = "round upholstered pouf"
    root["estimated_diameter_m"] = diameter
    root["estimated_height_m"] = height
    radius = diameter / 2
    rim = min(.025, height * .15, radius * .15)
    # Curved rings soften both rims; the upper surface is gently convex.
    rings = [(radius - rim, 0.0),
             (radius - rim * .32, rim * .32),
             (radius, rim),
             (radius, height - rim),
             (radius - rim * .22, height - rim * .38),
             (radius - rim, height - .004),
             (radius * .70, height)]
    body = _ring_mesh(name + " padded cylinder", rings, material, root)
    body["rim_radius_m"] = rim
    # A real slim circular seam follows the top rim, rather than a painted band.
    seam_radius = radius - rim * .07
    thread_radius = .0017
    vertices = []
    major_segments, minor_segments = 64, 6
    seam_z = height - rim * .8
    for i in range(major_segments):
        a = i * math.tau / major_segments
        for j in range(minor_segments):
            b = j * math.tau / minor_segments
            r = seam_radius + thread_radius * math.cos(b)
            vertices.append((r * math.cos(a), r * math.sin(a),
                             seam_z + thread_radius * math.sin(b)))
    faces = []
    for i in range(major_segments):
        for j in range(minor_segments):
            faces.append((i * minor_segments + j,
                          ((i + 1) % major_segments) * minor_segments + j,
                          ((i + 1) % major_segments) * minor_segments + (j + 1) % minor_segments,
                          i * minor_segments + (j + 1) % minor_segments))
    _mesh_part(name + " upper stitched seam", vertices, faces, material, root)
    return root


def build_lower_lounge(block, blue_material, yellow_material, low):
    """Build four blue modules and four yellow poufs, with rotated colliders.

    The side L faces the center aisle; the other blue module is perpendicular,
    its back below the hall guardrail and its front toward the umbrella passage.
    Both L returns are mirrored to the entrance end of their respective modules.
    The closest furniture collider remains well outside central x=[-1.1, 1.1].
    """
    roots = []
    for side in (-1, 1):
        side_name = "left" if side < 0 else "right"
        center = (side * 5.1, -4.1, low)
        angle = -side * math.pi / 2
        mirrored = side < 0
        roots.append(build_sofa("Lower lounge " + side_name + " L", center,
                                width=2.2, material=blue_material, angle=angle,
                                chaise=True, mirrored=mirrored))
        _register_bounds(block, _rotated_bounds(-1.1, 1.1, -.5, .5, center, angle))
        sign = -1 if mirrored else 1
        extension_center_x = sign * (2.2 / 2 - .48)
        _register_bounds(block, _rotated_bounds(extension_center_x - .48,
                                                extension_center_x + .48,
                                                -1.0, -.5, center, angle))
        center = (side * 3.6, -.65, low)
        roots.append(build_sofa("Lower lounge " + side_name + " armchair", center,
                                width=1.4, material=blue_material, angle=0))
        _register_bounds(block, _rotated_bounds(-.7, .7, -.5, .5, center, 0))
        for index, y in enumerate((-4.90, -1.65), 1):
            x = side * 3.25
            roots.append(build_pouf("Lower lounge " + side_name + " yellow pouf " + str(index),
                                    (x, y, low), yellow_material))
            block(x, y, .64 + _CLEARANCE * 2, .64 + _CLEARANCE * 2)
    return roots

