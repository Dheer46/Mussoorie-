"""Build a true-colour satellite texture from Sentinel-2 L2A (10 m) for the Mussoorie extent.

A per-pixel median of several cloud-free post-monsoon scenes suppresses residual
haze/cloud; slope shading from the acquisition sun is partially removed using the DEM
(run fetch_dem.py first), then reflectance is tone-mapped to sRGB.
Output: public/data/satellite.jpg (equirectangular, north up, same bbox as the DEM)
        build/ndvi.png            (8-bit NDVI*255, consumed by build_vectors.py for forest placement)
Set S2_CACHE=<dir> to cache the reprojected bands between runs.
"""
import json, os, sys
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds
from scipy.ndimage import zoom
from PIL import Image
from s2lib import retry, scene_dir, sun_angles, normals, c_correct, tone

W, S, E, N = 77.94, 30.37, 78.26, 30.54
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/data"
NDVI_OUT = sys.argv[2] if len(sys.argv) > 2 else "build/ndvi.png"
WIDTH = 4096
HEIGHT = int(round(WIDTH * (N - S) * 110.6 / ((E - W) * 111.32 * np.cos(np.radians((N + S) / 2)))))
SCENES = ["S2B_44RKU_20251027_0_L2A", "S2A_44RKU_20251103_0_L2A", "S2B_44RKU_20251109_0_L2A",
          "S2C_44RKU_20251111_0_L2A", "S2B_44RKU_20251116_0_L2A"]
dst_tr = from_bounds(W, S, E, N, WIDTH, HEIGHT)

def band(scene, b):
    with rasterio.open(scene_dir(scene) + b + ".tif") as src:
        out = np.zeros((HEIGHT, WIDTH), np.float32)
        reproject(rasterio.band(src, 1), out, dst_transform=dst_tr, dst_crs="EPSG:4326",
                  resampling=Resampling.lanczos, src_nodata=0, dst_nodata=np.nan)
        # Earth Search COGs already have the baseline-04.00 BOA offset removed
        # ("earthsearch:boa_offset_applied"), so DN / 10000 is reflectance.
        return out / 10000.0

meta = json.load(open(os.path.join(OUT, "meta.json")))["dem"]
dem = np.fromfile(os.path.join(OUT, "dem.bin"), "<u2").reshape(meta["height"], meta["width"]) * 0.1
dem = zoom(dem, (HEIGHT / dem.shape[0], WIDTH / dem.shape[1]), order=1)
nrm = normals(dem, (E - W) * 111320 * np.cos(np.radians((N + S) / 2)) / WIDTH, (N - S) * 110600 / HEIGHT)

CACHE = os.environ.get("S2_CACHE")
stack = []
for sc in SCENES:
    cp = CACHE and os.path.join(CACHE, sc + ".npy")
    if cp and os.path.exists(cp):
        im = np.load(cp)
    else:
        print("reading", sc, flush=True)
        im = np.stack([retry(lambda: band(sc, b)) for b in ("B04", "B03", "B02", "B08")], -1)
        if cp: np.save(cp, im)
    stack.append(c_correct(im, nrm, *sun_angles(sc)))
med = np.nanmedian(np.stack(stack), axis=0)
rgb, nir = med[..., :3], med[..., 3]
ndvi = np.nan_to_num((nir - rgb[..., 0]) / (nir + rgb[..., 0] + 1e-6)).clip(0, 1)
os.makedirs(os.path.dirname(NDVI_OUT) or ".", exist_ok=True)
Image.fromarray((ndvi * 255).astype(np.uint8)).resize((WIDTH // 2, HEIGHT // 2), Image.BILINEAR).save(NDVI_OUT)
Image.fromarray((tone(rgb) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "satellite.jpg"), quality=88, optimize=True)
print(WIDTH, HEIGHT)
