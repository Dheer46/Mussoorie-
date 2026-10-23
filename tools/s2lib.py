"""Shared Sentinel-2 helpers: terrain normals, topographic C-correction and tone mapping."""
import time
import numpy as np, requests

BASE = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/"

def scene_dir(scene):
    # S2B_44RKU_20251027_0_L2A -> 44/R/KU/2025/10/S2B_44RKU_20251027_0_L2A/
    tile = scene.split("_")[1]; date = scene.split("_")[2]
    return f"{BASE}{tile[:2]}/{tile[2]}/{tile[3:]}/{date[:4]}/{int(date[4:6])}/{scene}/"

def retry(fn, tries=5):
    for i in range(tries):
        try:
            return fn()
        except Exception as e:
            if i == tries - 1: raise
            print("retrying after", type(e).__name__, flush=True); time.sleep(2 ** i)

def sun_angles(scene):
    p = retry(lambda: requests.get(scene_dir(scene) + scene + ".json").json())["properties"]
    return np.radians(p["view:sun_azimuth"]), np.radians(p["view:sun_elevation"])

def normals(dem, px, py):
    """Unit normals (east, north, up) of a north-up DEM with pixel size px, py metres."""
    gy, gx = np.gradient(dem, py, px)
    n = np.stack([-gx, gy, np.ones_like(dem)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)

def c_correct(img, nrm, az, el, c=1.1):
    """Partially remove baked-in sun shading (C-correction); the viewer re-lights the terrain."""
    sun = np.array([np.sin(az) * np.cos(el), np.cos(az) * np.cos(el), np.sin(el)])
    cos_i = (nrm @ sun).clip(0.02, 1)
    f = ((np.sin(el) + c) / (cos_i + c)).clip(0.75, 1.7)[..., None]
    img[..., :3] *= f
    img[..., 2:3] *= f ** -0.45  # shadowed slopes are lit by blue skylight only
    return img

def tone(rgb):
    """Surface reflectance -> display sRGB with a gentle filmic curve."""
    rgb = np.nan_to_num(rgb, nan=0.05).clip(0, None) * 3.2
    rgb = rgb / (1 + rgb * 0.35)
    rgb = np.power(rgb.clip(0, 1), 1 / 1.6)
    lum = rgb.mean(-1, keepdims=True)
    rgb = (lum + (rgb - lum) * 1.25).clip(0, 1)
    rgb[..., 2] *= 0.86 + 0.14 * (lum[..., 0] / max(lum.max(), 1e-6))
    return rgb
