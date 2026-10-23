"""Fetch a coarse (~250 m) Copernicus GLO-90 DSM of the surrounding Garhwal Himalaya.

Used for the far-field terrain (Doon valley, Shivaliks, Bandarpunch / Swargarohini /
Gangotri ranges) that frames the detailed Mussoorie model.
Output: public/data/far_dem.bin (uint16 metres, row 0 = north) + meta.json["far"]
"""
import json, os, sys
import numpy as np, rasterio
from rasterio.merge import merge
from rasterio.enums import Resampling

W, S, E, N = 77.30, 29.95, 79.30, 31.25
STEP = 0.0025
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/data"
URL = "https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N{0:02d}_00_E{1:03d}_00_DEM/Copernicus_DSM_COG_30_N{0:02d}_00_E{1:03d}_00_DEM.tif"
src = []
for lat in (29, 30, 31):
    for lon in (77, 78, 79):
        try:
            src.append(rasterio.open(URL.format(lat, lon)))
        except Exception as e:
            print("skip", lat, lon, e)
h, _ = merge(src, bounds=(W - STEP / 2, S - STEP / 2, E + STEP / 2, N + STEP / 2), res=STEP,
             resampling=Resampling.average, nodata=0)
h = h[0].clip(0, 9000)
h.astype("<u2").tofile(os.path.join(OUT, "far_dem.bin"))
mp = os.path.join(OUT, "meta.json"); meta = json.load(open(mp))
meta["far"] = {"bbox": [W, S, E, N], "width": h.shape[1], "height": h.shape[0], "scale": 1,
               "source": "Copernicus GLO-90 DSM (ESA / Airbus), resampled to 0.0025 deg"}
json.dump(meta, open(mp, "w"), indent=1)
print(h.shape, h.min(), h.max())
