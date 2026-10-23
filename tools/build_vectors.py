"""Convert Overture Maps (OpenStreetMap-derived) extracts into compact web formats.

Inputs : SRC/{buildings,roads,water}.parquet (fetch_overture.py), SRC/ndvi.png (fetch_imagery.py)
Outputs: public/data/buildings.bin, roads.json, water.json, forest.png
Coordinates are local metres: x east, z south of the bbox centre (see meta.json "proj").
"""
import json, math, os, sys, hashlib
import numpy as np, pyarrow.parquet as pq, shapely
from shapely.geometry import Polygon, MultiPolygon
from PIL import Image, ImageDraw

SRC, OUT = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(OUT, "meta.json")))
W, S, E, N = meta["bbox"]
LAT0, LON0 = (S + N) / 2, (W + E) / 2
phi = math.radians(LAT0)
KX = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
KY = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
meta["proj"] = {"lat0": LAT0, "lon0": LON0, "kx": KX, "ky": KY}
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)

def xy(coords):
    a = np.asarray(coords)[:, :2]
    return np.stack([(a[:, 0] - LON0) * KX, (LAT0 - a[:, 1]) * KY], 1)

def inside(lon, lat):
    return W <= lon <= E and S <= lat <= N

def h01(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

# ---------------------------------------------------------------- buildings
B = pq.read_table(os.path.join(SRC, "buildings.parquet")).to_pylist()
pos, offs, floors, kinds = [], [0], [], []
KIND = {"house": 1, "residential": 1, "apartments": 2, "commercial": 3, "retail": 3, "hotel": 3,
        "college": 4, "school": 4, "university": 4, "church": 5, "temple": 5, "religious": 5}
for b in B:
    g = shapely.from_wkb(b["geometry"])
    polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
    for p in polys:
        if not isinstance(p, Polygon) or p.is_empty:
            continue
        c = p.centroid
        if not inside(c.x, c.y):
            continue
        ring = xy(p.exterior.coords)[:-1]
        ring_poly = Polygon(ring).simplify(0.4)
        if ring_poly.is_empty or ring_poly.area < 12:
            continue
        ring = np.asarray(ring_poly.exterior.coords)[:-1]
        if len(ring) < 3 or len(ring) > 64:
            continue
        if Polygon(ring).exterior.is_ccw:  # store clockwise in x/z (= CCW seen from above, y up)
            ring = ring[::-1]
        area = ring_poly.area
        r = h01(b["id"])
        if b.get("num_floors"):
            fl = int(b["num_floors"])
        elif b.get("height"):
            fl = max(1, round(b["height"] / 3.2))
        else:
            # Hill-town massing: small village houses 1-2 floors, town blocks 2-4, hotels 3-6.
            if area < 45: fl = 1 + (r > 0.55)
            elif area < 120: fl = 2 + (r > 0.6)
            elif area < 350: fl = 2 + int(r * 3)
            else: fl = 3 + int(r * 4)
        pos.append(ring.astype(np.float32))
        offs.append(offs[-1] + len(ring))
        floors.append(min(fl, 12))
        kinds.append(KIND.get(b.get("class") or "", 0))
pos = np.concatenate(pos).astype("<f4")
n = len(floors)
with open(os.path.join(OUT, "buildings.bin"), "wb") as f:
    f.write(np.array([n, len(pos)], "<u4").tobytes())
    f.write(np.array(offs, "<u4").tobytes())
    f.write(np.array(floors, "u1").tobytes())
    f.write(np.array(kinds, "u1").tobytes())
    f.write(b"\0" * ((4 - (2 * n) % 4) % 4))
    f.write(pos.tobytes())
print("buildings", n, len(pos))

# ---------------------------------------------------------------- roads
R = pq.read_table(os.path.join(SRC, "roads.parquet")).to_pylist()
roads = []
for r in R:
    g = shapely.from_wkb(r["geometry"])
    lines = list(g.geoms) if g.geom_type == "MultiLineString" else [g]
    for ln in lines:
        p = xy(ln.coords)
        roads.append({"c": r["class"] or "unknown", "n": (r["names"] or {}).get("primary") or "",
                      "p": np.round(p.ravel(), 1).tolist()})
json.dump(roads, open(os.path.join(OUT, "roads.json"), "w"), separators=(",", ":"))
print("roads", len(roads))

# ---------------------------------------------------------------- water
Wt = pq.read_table(os.path.join(SRC, "water.parquet")).to_pylist()
water = {"areas": [], "lines": []}
for w in Wt:
    g = shapely.from_wkb(w["geometry"])
    name = (w["names"] or {}).get("primary") or ""
    if g.geom_type in ("Polygon", "MultiPolygon"):
        for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
            water["areas"].append({"n": name, "c": w["class"], "p": np.round(xy(p.exterior.coords)[:-1].ravel(), 1).tolist()})
    elif g.geom_type in ("LineString", "MultiLineString"):
        for l in (g.geoms if g.geom_type == "MultiLineString" else [g]):
            water["lines"].append({"n": name, "c": w["class"], "p": np.round(xy(l.coords).ravel(), 1).tolist()})
json.dump(water, open(os.path.join(OUT, "water.json"), "w"), separators=(",", ":"))
print("water", len(water["areas"]), len(water["lines"]))

# ---------------------------------------------------------------- forest density
nd = Image.open(os.path.join(SRC, "ndvi.png"))
Wd, Hd = nd.size
nd = np.asarray(nd, np.float32) / 255
dens = ((nd - 0.42) / 0.33).clip(0, 1)  # bare/urban < 0.42 NDVI, dense forest > 0.75
mask = Image.new("L", (Wd, Hd), 255); dr = ImageDraw.Draw(mask)
sx = Wd / ((E - W) * KX); sz = Hd / ((N - S) * KY)
ox, oz = (W - LON0) * KX, (LAT0 - N) * KY
def px(p): return [((x - ox) * sx, (z - oz) * sz) for x, z in p]
for i in range(n):
    dr.polygon(px(pos[offs[i]:offs[i + 1]]), fill=0)
RW = {"trunk": 3, "primary": 3, "secondary": 2, "tertiary": 2, "residential": 1, "unclassified": 1, "service": 1}
for r in roads:
    if r["c"] in RW:
        p = np.array(r["p"]).reshape(-1, 2)
        dr.line(px(p), fill=0, width=RW[r["c"]])
dens = dens * (np.asarray(mask, np.float32) / 255)
Image.fromarray((dens * 255).astype(np.uint8)).save(os.path.join(OUT, "forest.png"), optimize=True)
print("forest", dens.mean())
