"""Sentinel-2 (80 m overview) colour texture for the far-field Garhwal Himalaya terrain.

Same processing as fetch_imagery.py, mosaicked from six MGRS tiles across UTM 43/44.
Output: public/data/far_satellite.jpg covering meta.json["far"]["bbox"].
"""
import json, os, sys
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds
from scipy.ndimage import zoom
from PIL import Image
from s2lib import retry, scene_dir, sun_angles, normals, c_correct, tone

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/data"
meta = json.load(open(os.path.join(OUT, "meta.json")))["far"]
W, S, E, N = meta["bbox"]
STEP = 0.001
WIDTH, HEIGHT = int(round((E - W) / STEP)), int(round((N - S) / STEP))
SCENES = ["S2A_43RGP_20251106_0_L2A", "S2C_43RGP_20251114_0_L2A", "S2C_43RGP_20251124_0_L2A",
          "S2B_43RGQ_20251109_0_L2A", "S2C_43RGQ_20251114_0_L2A", "S2C_43RGQ_20251124_0_L2A",
          "S2B_44RKU_20251109_0_L2A", "S2C_44RKU_20251114_0_L2A", "S2C_44RKU_20251124_0_L2A",
          "S2B_44RKV_20251109_0_L2A", "S2C_44RKV_20251114_0_L2A", "S2C_44RKV_20251124_0_L2A",
          "S2C_44RLU_20251111_0_L2A", "S2B_44RLU_20251126_0_L2A",
          "S2A_44RLV_20251103_0_L2A", "S2C_44RLV_20251111_0_L2A", "S2C_44RLV_20251101_0_L2A"]
dst_tr = from_bounds(W, S, E, N, WIDTH, HEIGHT)

def band(scene, b):
    with rasterio.open(scene_dir(scene) + b + ".tif", overview_level=2) as src:
        out = np.full((HEIGHT, WIDTH), np.nan, np.float32)
        reproject(src.read(1), out, src_transform=src.transform, src_crs=src.crs, dst_transform=dst_tr,
                  dst_crs="EPSG:4326", resampling=Resampling.bilinear, src_nodata=0, dst_nodata=np.nan)
        return out / 10000.0

dem = np.fromfile(os.path.join(OUT, "far_dem.bin"), "<u2").reshape(meta["height"], meta["width"]).astype(np.float32)
dem = zoom(dem, (HEIGHT / dem.shape[0], WIDTH / dem.shape[1]), order=1)
nrm = normals(dem, STEP * 111320 * np.cos(np.radians((N + S) / 2)), STEP * 110600)
stack = []
for sc in SCENES:
    print("reading", sc, flush=True)
    im = np.stack([retry(lambda: band(sc, b)) for b in ("B04", "B03", "B02")], -1)
    stack.append(c_correct(im, nrm, *sun_angles(sc)))
rgb = np.nanmedian(np.stack(stack), axis=0)
Image.fromarray((tone(rgb) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "far_satellite.jpg"), quality=85, optimize=True)
print(WIDTH, HEIGHT, np.isnan(rgb).mean())
