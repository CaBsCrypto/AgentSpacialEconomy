"""Derive upright native-AR assets without changing the supplied Passport geometry/artwork.

Run from any directory: python scripts/build-passport-spatial.py
Only a new root transform is authored. The original GLB BIN chunk, USDZ geometry,
texture bytes, horizontal anchoring and source assets remain unchanged.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "dist" / "assets"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
USD_MARKER = "# Passport native upright placement"


def read_glb(data: bytes):
    if len(data) < 12:
        raise ValueError("GLB header is missing")
    magic, version, size = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or size != len(data):
        raise ValueError("Expected an intact GLB version 2")
    chunks = []
    offset = 12
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        start = offset + 8
        if length % 4 or start + length > len(data):
            raise ValueError("Invalid GLB chunk")
        chunks.append((kind, data[start:start + length]))
        offset = start + length
    if not chunks or chunks[0][0] != JSON_CHUNK:
        raise ValueError("GLB must begin with JSON")
    return json.loads(chunks[0][1]), chunks


def write_glb(document, chunks):
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    output_chunks = [(JSON_CHUNK, encoded), *chunks[1:]]
    payload = b"".join(struct.pack("<II", len(value), kind) + value for kind, value in output_chunks)
    return struct.pack("<4sII", b"glTF", 2, len(payload) + 12) + payload


def identity():
    return [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.]


def multiply(a, b):
    # glTF matrices are column-major; the same flat array is a USD row-major matrix.
    return [sum(a[k * 4 + row] * b[column * 4 + k] for k in range(4))
            for column in range(4) for row in range(4)]


def transform_point(matrix, point):
    return [sum(matrix[k * 4 + row] * point[k] for k in range(3)) + matrix[12 + row]
            for row in range(3)]


def node_matrix(node):
    if "matrix" in node:
        return node["matrix"]
    x, y, z, w = node.get("rotation", [0., 0., 0., 1.])
    sx, sy, sz = node.get("scale", [1., 1., 1.])
    tx, ty, tz = node.get("translation", [0., 0., 0.])
    return [
        (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0.,
        2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0.,
        2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0.,
        tx, ty, tz, 1.,
    ]


def scene_bounds(document):
    minimum = [float("inf")] * 3
    maximum = [float("-inf")] * 3

    def visit(index, parent, ancestors):
        if index in ancestors:
            raise ValueError("GLB nodes contain a cycle")
        node = document["nodes"][index]
        matrix = multiply(parent, node_matrix(node))
        if "mesh" in node:
            for primitive in document["meshes"][node["mesh"]]["primitives"]:
                accessor = document["accessors"][primitive["attributes"]["POSITION"]]
                if accessor.get("type") != "VEC3" or "min" not in accessor or "max" not in accessor:
                    raise ValueError("Passport POSITION accessor must include VEC3 bounds")
                for corner in itertools.product(*zip(accessor["min"], accessor["max"])):
                    point = transform_point(matrix, corner)
                    for axis in range(3):
                        minimum[axis] = min(minimum[axis], point[axis])
                        maximum[axis] = max(maximum[axis], point[axis])
        for child in node.get("children", []):
            visit(child, matrix, {*ancestors, index})

    scene = document["scenes"][document.get("scene", 0)]
    for index in scene.get("nodes", []):
        visit(index, identity(), set())
    if not all(high > low for low, high in zip(minimum, maximum)):
        raise ValueError("Passport must have a nonzero width, height and thickness")
    return minimum, maximum


def placement_transform(document, width, elevation):
    minimum, maximum = scene_bounds(document)
    center = [(low + high) / 2 for low, high in zip(minimum, maximum)]
    scale = width / (maximum[0] - minimum[0])
    # Center the source, rotate X +90 degrees so front +Y becomes +Z, scale to
    # native width, then lift the center above the horizontal anchor's origin.
    matrix = [scale, 0., 0., 0., 0., 0., scale, 0., 0., -scale, 0., 0.,
              -scale * center[0], elevation + scale * center[2], -scale * center[1], 1.]
    return matrix, {"minimum": minimum, "maximum": maximum, "center": center, "scale": scale}


def spatial_glb(source, matrix, width, elevation):
    document, chunks = read_glb(source)
    scene = document["scenes"][document.get("scene", 0)]
    node = {
        "name": "Passport native spatial placement",
        "children": list(scene.get("nodes", [])),
        "matrix": matrix,
        "extras": {"widthMeters": width, "centerHeightMeters": elevation,
                   "source": "passport.glb", "orientation": "upright front +Z"},
    }
    scene["nodes"] = [len(document["nodes"])]
    document["nodes"].append(node)
    return write_glb(document, chunks)


def spatial_usda(source, matrix):
    text = source.decode("utf-8")
    if USD_MARKER in text:
        raise ValueError("Source USDZ already contains a native spatial transform")
    anchor = re.search(r'^([ \t]*)token preliminary:planeAnchoring:alignment = "horizontal"[ \t]*$', text, re.M)
    if not anchor or len(re.findall('token preliminary:planeAnchoring:alignment', text)) != 1:
        raise ValueError("Expected one horizontal anchor in the source USDZ")
    indent = anchor.group(1)
    rows = ["(" + ", ".join(format(value, ".17g") for value in matrix[i:i + 4]) + ")"
            for i in range(0, 16, 4)]
    newline = "\r\n" if "\r\n" in text else "\n"
    addition = newline + newline.join([
        indent + USD_MARKER,
        indent + "matrix4d xformOp:transform = ( " + ", ".join(rows) + " )",
        indent + 'uniform token[] xformOpOrder = ["xformOp:transform"]',
    ])
    return (text[:anchor.end()] + addition + text[anchor.end():]).encode("utf-8")


def write_spatial_usdz(source_path, output_path, matrix):
    with zipfile.ZipFile(source_path) as source, zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_STORED) as output:
        entries = source.infolist()
        if not entries or entries[0].filename != "model.usda":
            raise ValueError("Source USDZ must begin with model.usda")
        for entry in entries:
            value = source.read(entry.filename)
            if entry.filename == "model.usda":
                value = spatial_usda(value, matrix)
            info = zipfile.ZipInfo(entry.filename, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            base_offset = output.fp.tell() + 30 + len(info.filename.encode("utf-8"))
            padding = -base_offset % 64
            if padding:
                if padding < 4:
                    padding += 64
                info.extra = struct.pack("<HH", 0x1986, padding - 4) + bytes(padding - 4)
            output.writestr(info, value)
    with zipfile.ZipFile(output_path) as check:
        if check.testzip() is not None:
            raise ValueError("Generated USDZ failed its CRC check")
        for entry in check.infolist():
            data_offset = entry.header_offset + 30 + len(entry.filename.encode("utf-8")) + len(entry.extra)
            if data_offset % 64 or entry.compress_type != zipfile.ZIP_STORED:
                raise ValueError("Generated USDZ violates its storage/alignment requirements")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-glb", type=Path, default=ASSETS / "passport.glb")
    parser.add_argument("--source-usdz", type=Path, default=ASSETS / "passport.usdz")
    parser.add_argument("--output-dir", type=Path, default=ASSETS)
    parser.add_argument("--width", type=float, default=.20)
    parser.add_argument("--elevation", type=float, default=.18)
    args = parser.parse_args()
    if not (math.isfinite(args.width) and math.isfinite(args.elevation) and args.width > 0 and args.elevation >= 0):
        parser.error("Width must be positive and center elevation must be nonnegative")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    glb_source = args.source_glb.read_bytes()
    document, _ = read_glb(glb_source)
    matrix, original = placement_transform(document, args.width, args.elevation)
    glb_output = args.output_dir / "passport-spatial.glb"
    usdz_output = args.output_dir / "passport-spatial.usdz"
    if glb_output.resolve() == args.source_glb.resolve() or usdz_output.resolve() == args.source_usdz.resolve():
        raise ValueError("Spatial output must not overwrite a source asset")
    glb_output.write_bytes(spatial_glb(glb_source, matrix, args.width, args.elevation))
    write_spatial_usdz(args.source_usdz, usdz_output, matrix)
    print(json.dumps({"glb": str(glb_output), "glbBytes": glb_output.stat().st_size,
                      "usdz": str(usdz_output), "usdzBytes": usdz_output.stat().st_size,
                      "widthMeters": args.width, "centerHeightMeters": args.elevation,
                      "original": original, "matrix": matrix,
                      "sourceGlbSha256": hashlib.sha256(glb_source).hexdigest()}, indent=2))


if __name__ == "__main__":
    main()
