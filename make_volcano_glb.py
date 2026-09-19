import json, struct, math, array
from pathlib import Path

out = Path(r"C:\Users\bryma\Temp\LivingLab\assets")
out.mkdir(parents=True, exist_ok=True)

def cone_mesh(radius_bottom=0.11, radius_top=0.035, height=0.16, segments=24, y0=0.0):
    verts, norms, uvs, indices = [], [], [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        x, z = radius_bottom * math.cos(a), radius_bottom * math.sin(a)
        verts += [x, y0, z]
        n = math.sqrt(x * x + z * z) or 1
        norms += [x / n * 0.7, 0.3, z / n * 0.7]
        uvs += [i / segments, 0.0]
    for i in range(segments):
        a = 2 * math.pi * i / segments
        x, z = radius_top * math.cos(a), radius_top * math.sin(a)
        verts += [x, y0 + height, z]
        n = math.sqrt(x * x + z * z) or 1
        norms += [x / n * 0.5, 0.7, z / n * 0.5]
        uvs += [i / segments, 1.0]
    for i in range(segments):
        i0, i1 = i, (i + 1) % segments
        t0, t1 = segments + i, segments + ((i + 1) % segments)
        indices += [i0, i1, t0, i1, t1, t0]
    center_idx = len(verts) // 3
    verts += [0.0, y0 + height - 0.02, 0.0]
    norms += [0.0, 1.0, 0.0]
    uvs += [0.5, 0.5]
    for i in range(segments):
        indices += [center_idx, segments + i, segments + ((i + 1) % segments)]

    def add_sphere(cx, cy, cz, r, segs=8):
        base = len(verts) // 3
        for j in range(segs + 1):
            v = j / segs
            phi = v * math.pi
            for i in range(segs):
                u = i / segs
                th = u * 2 * math.pi
                x = cx + r * math.sin(phi) * math.cos(th)
                y = cy + r * math.cos(phi)
                z = cz + r * math.sin(phi) * math.sin(th)
                verts.extend([x, y, z])
                norms.extend([(x - cx) / r, (y - cy) / r, (z - cz) / r])
                uvs.extend([u, v])
        for j in range(segs):
            for i in range(segs):
                a = base + j * segs + i
                b = base + j * segs + (i + 1) % segs
                c = base + (j + 1) * segs + i
                d = base + (j + 1) * segs + (i + 1) % segs
                indices.extend([a, c, b, b, c, d])

    add_sphere(0.0, y0 + height + 0.04, 0.0, 0.03)
    add_sphere(0.02, y0 + height + 0.07, 0.01, 0.025)
    add_sphere(-0.015, y0 + height + 0.09, -0.01, 0.02)
    return verts, norms, uvs, indices

def pad4(b):
    return b + b"\x00" * ((4 - len(b) % 4) % 4)

v, n, u, idx = cone_mesh()
v_arr, n_arr, u_arr = array.array("f", v), array.array("f", n), array.array("f", u)
i_arr = array.array("H", idx)
parts = [pad4(v_arr.tobytes()), pad4(n_arr.tobytes()), pad4(u_arr.tobytes()), pad4(i_arr.tobytes())]
bin_blob = b"".join(parts)
o_v, o_n, o_u, o_i = 0, len(parts[0]), len(parts[0]) + len(parts[1]), len(parts[0]) + len(parts[1]) + len(parts[2])
vc, ic = len(v) // 3, len(idx)
gltf = {
    "asset": {"version": "2.0", "generator": "livinglab-fallback"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0, "name": "Volcano"}],
    "meshes": [{"name": "VolcanoMesh", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
    "materials": [{"name": "VolcanoRock", "pbrMetallicRoughness": {"baseColorFactor": [0.35, 0.22, 0.14, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.9}}],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": vc, "type": "VEC3", "max": [0.12, 0.28, 0.12], "min": [-0.12, 0.0, -0.12]},
        {"bufferView": 1, "componentType": 5126, "count": vc, "type": "VEC3"},
        {"bufferView": 2, "componentType": 5126, "count": vc, "type": "VEC2"},
        {"bufferView": 3, "componentType": 5123, "count": ic, "type": "SCALAR"},
    ],
    "bufferViews": [
        {"buffer": 0, "byteOffset": o_v, "byteLength": len(v_arr.tobytes()), "target": 34962},
        {"buffer": 0, "byteOffset": o_n, "byteLength": len(n_arr.tobytes()), "target": 34962},
        {"buffer": 0, "byteOffset": o_u, "byteLength": len(u_arr.tobytes()), "target": 34962},
        {"buffer": 0, "byteOffset": o_i, "byteLength": len(i_arr.tobytes()), "target": 34963},
    ],
    "buffers": [{"byteLength": len(bin_blob)}],
}
json_bytes = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))

def chunk(tag, data):
    return struct.pack("<I", len(data)) + tag + data

glb = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(json_bytes) + 8 + len(bin_blob))
glb += chunk(b"JSON", json_bytes) + chunk(b"BIN\x00", bin_blob)
path = out / "volcano.glb"
path.write_bytes(glb)
(out / "USDZ_PENDING.txt").write_text("usdz needs Blender USD export. glb ready for model-viewer / Scene Viewer.\n", encoding="utf-8")
print("wrote", path, path.stat().st_size)
