"""Energy Corner: independent goal frame, flexible net and kickable football.

Coordinates are estimated Blender Z-up venue coordinates. Dynamic actors keep
their origin at a useful physical pivot; their geometry is made local before
export, so runtime transforms never rotate an entire world-space vertex cloud.
"""
import math

BALL_HOME = (12.65, 28.1, .15)
NET_PIVOT = (14.35, 28.5, .45)
FOOTBALL_TARGET = {"x": 14.08, "y": .15, "z": -28.5}


def _finish_at(geometry, pivot, role):
    geometry.v = [(x-pivot[0], y-pivot[1], z-pivot[2])
                  for x, y, z in geometry.v]
    obj = geometry.finish()
    obj.location = pivot
    obj["interactionRole"] = role
    obj["reference"] = "VID_20261026_021930226.mp4; interactive visual addition"
    if getattr(obj, "data", None):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def _ball(geometry, white, black):
    """A smooth sphere with twelve small raised pentagonal black panels."""
    center = BALL_HOME
    radius, segments, rings = .15, 32, 16
    start = len(geometry.v)
    geometry.v.append((center[0], center[1], center[2]+radius))
    for j in range(1, rings):
        theta = math.pi*j/rings
        for i in range(segments):
            a = math.tau*i/segments
            geometry.v.append((center[0]+radius*math.sin(theta)*math.cos(a),
                               center[1]+radius*math.sin(theta)*math.sin(a),
                               center[2]+radius*math.cos(theta)))
    bottom = len(geometry.v)
    geometry.v.append((center[0], center[1], center[2]-radius))
    first = start+1
    for i in range(segments):
        following = (i+1) % segments
        geometry.face((start, first+i, first+following), white)
        for j in range(rings-2):
            a = first+j*segments+i
            b = first+j*segments+following
            geometry.face((a, a+segments, b+segments, b), white)
        last = first+(rings-2)*segments
        geometry.face((last+i, bottom, last+following), white)
    phi = (1+math.sqrt(5))/2
    directions = []
    for a in (-1, 1):
        for b in (-1, 1):
            directions.extend([(0, a, b*phi), (a, b*phi, 0), (b*phi, 0, a)])
    for direction in directions:
        length = math.sqrt(sum(v*v for v in direction))
        n = tuple(v/length for v in direction)
        auxiliary = (0, 0, 1) if abs(n[2]) < .9 else (0, 1, 0)
        u = (n[1]*auxiliary[2]-n[2]*auxiliary[1],
             n[2]*auxiliary[0]-n[0]*auxiliary[2],
             n[0]*auxiliary[1]-n[1]*auxiliary[0])
        ul = math.sqrt(sum(v*v for v in u))
        u = tuple(v/ul for v in u)
        v = (n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2],
             n[0]*u[1]-n[1]*u[0])
        base = len(geometry.v)
        panel_radius = radius+.0015
        geometry.v.append(tuple(center[k]+n[k]*panel_radius for k in range(3)))
        for step in (1, 2):
            theta = .28*step/2
            for i in range(5):
                a = math.tau*i/5
                geometry.v.append(tuple(center[k]+panel_radius*(
                    n[k]*math.cos(theta)+(u[k]*math.cos(a)+v[k]*math.sin(a))*math.sin(theta))
                    for k in range(3)))
        for i in range(5):
            following = (i+1) % 5
            geometry.face((base, base+1+i, base+1+following), black)
            geometry.face((base+1+i, base+6+i, base+6+following, base+1+following), black)


def build_football(layout, Geo, materials, graphic_plane, palette):
    """Build the observed Energy Corner and add its stable section metadata."""
    white, black = palette["white"], palette["black"]
    frame = Geo("Energy Corner white goal frame")
    net = Geo("Energy Corner flexible goal net")
    ball = Geo("Energy Corner football")
    graphic_plane("Energy Corner branded backdrop", "energy-banner",
                  (14.71, 28.5, 1.6), 4.6, 2.7, facing="-X")
    gx, gy, rear = 13.78, 28.5, 14.35
    for dy in (-1.1, 1.1):
        y = gy+dy
        frame.rod((gx, y, .03), (gx, y, 1.10), .035, white, 16)
        frame.rod((gx, y, .03), (rear, y, .03), .028, white, 12)
        frame.rod((gx, y, 1.10), (rear, y, .85), .025, white, 12)
    frame.rod((gx, gy-1.1, 1.10), (gx, gy+1.1, 1.10), .035, white, 16)
    frame.rod((rear, gy-1.1, .85), (rear, gy+1.1, .85), .022, white, 12)
    for i in range(17):
        y = gy-1.1+i*2.2/16
        net.rod((rear, y, .03), (rear, y, .85), .0035, white, 4)
    for i in range(9):
        z = .03+i*.82/8
        net.rod((rear, gy-1.1, z), (rear, gy+1.1, z), .0035, white, 4)
    for dy in (-1.1, 1.1):
        y = gy+dy
        for i in range(9):
            f = i/8
            net.rod((gx, y, .03+f*1.07), (rear, y, .03+f*.82), .0035, white, 4)
        for i in range(1, 4):
            f = i/4
            x = gx+(rear-gx)*f
            net.rod((x, y, .03), (x, y, 1.10-f*.25), .0035, white, 4)
    _ball(ball, white, black)
    frame_object = frame.finish()
    frame_object["reference"] = "VID_20261026_021930226.mp4; estimated local dimensions"
    net_object = _finish_at(net, NET_PIVOT, "goal-net")
    ball_object = _finish_at(ball, BALL_HOME, "football")
    ball_object["footballTarget"] = [FOOTBALL_TARGET[k] for k in ("x", "y", "z")]
    ball_object["footballRadius"] = .15
    layout.setdefault("obstacles", []).append({
        "minX": 14.07-.85/2, "maxX": 14.07+.85/2,
        "minZ": -gy-2.35/2, "maxZ": -gy+2.35/2})
    section = {
        "id": "energy", "label": "Energy Corner · fútbol",
        "polygon": [[10.4, -31], [14.6, -31], [14.6, -25.4], [10.4, -25.4]],
        "view": {"x": 11, "z": -28.5, "yaw": -math.pi/2, "pitch": -.35},
        "reviewSection": 23,
        "evidence": "VID_20261026_021930226.mp4; placement estimated from the narrated walkthrough."}
    existing = next((zone for zone in layout.setdefault("zones", [])
                     if zone.get("id") == "energy"), None)
    if existing is None:
        layout["zones"].append(section)
    else:
        existing.update(section)
    layout["football"] = {"home": {"x": 12.65, "y": .15, "z": -28.1},
                          "target": dict(FOOTBALL_TARGET)}
    return {"frame": frame_object, "net": net_object, "ball": ball_object}

