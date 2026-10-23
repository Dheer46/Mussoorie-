"""Fetch Copernicus GLO-30 DSM for the Mussoorie extent and write a uint16 heightmap.

Output: public/data/dem.bin (little-endian uint16, elevation in decimetres, row 0 = north)
        public/data/meta.json (grid size, bbox, elevation stats)
"""
import json, os, sys
import numpy as np, rasterio
from rasterio.merge import merge
from rasterio.enums import Resampling

W, S, E, N = 77.94, 30.37, 78.26, 30.54
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/data"
URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N30_00_E{0:03d}_00_DEM/Copernicus_DSM_COG_10_N30_00_E{0:03d}_00_DEM.tif"
STEP = 1 / 3600  # 1 arc-second
src = [rasterio.open(URL.format(e)) for e in (77, 78)]
# Resample onto an exact 1" grid that starts on the bbox corner (pixel centres).
nx = int(round((E - W) / STEP)) + 1
ny = int(round((N - S) / STEP)) + 1
mosaic, tr = merge(src, bounds=(W - STEP, S - STEP, E + STEP, N + STEP), res=STEP, resampling=Resampling.bilinear)
z = mosaic[0].astype(np.float64)
# Bilinear sample at the target pixel centres.
inv = ~tr
cols, rows = inv * (W + np.arange(nx) * STEP, np.full(nx, N))
_, rows = inv * (np.full(ny, W), N - np.arange(ny) * STEP)
cols = cols - 0.5; rows = rows - 0.5
c0 = np.floor(cols).astype(int); r0 = np.floor(rows).astype(int)
fc = cols - c0; fr = (rows - r0)[:, None]
a = z[np.ix_(r0, c0)]; b = z[np.ix_(r0, c0 + 1)]; c = z[np.ix_(r0 + 1, c0)]; d = z[np.ix_(r0 + 1, c0 + 1)]
h = (a * (1 - fc) + b * fc) * (1 - fr) + (c * (1 - fc) + d * fc) * fr
os.makedirs(OUT, exist_ok=True)
np.round(h * 10).astype("<u2").tofile(os.path.join(OUT, "dem.bin"))
meta = {"bbox": [W, S, E, N], "dem": {"width": nx, "height": ny, "scale": 0.1,
        "min": float(h.min()), "max": float(h.max()),
        "source": "Copernicus GLO-30 DSM (ESA / Airbus), 1 arc-second"}}
mp = os.path.join(OUT, "meta.json")
if os.path.exists(mp):
    old = json.load(open(mp)); old.update(meta); meta = old
json.dump(meta, open(mp, "w"), indent=1)
print(nx, ny, h.min(), h.max())
