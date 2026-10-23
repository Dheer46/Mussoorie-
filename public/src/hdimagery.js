// Optional sub-metre imagery streamed from Esri World Imagery around the point of
// interest. Tiles are composited into one canvas texture that the terrain shader
// projects onto the ground (Web Mercator -> local metres), blending into the
// Sentinel-2 base outside the streamed window.
import * as THREE from 'three';

const URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const N = 8; // tiles per side of the window
const TS = 256;

const lon2t = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2t = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
const t2lon = (x, z) => x / 2 ** z * 360 - 180;
const t2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;

export const hdUniforms = {
  uHdMap: { value: null },
  uHdOn: { value: 0 },
  uHdX: { value: new THREE.Vector2() },    // local x of the window's west and east edges
  uHdZ: { value: new THREE.Vector4() },    // zc (local z at lat_c), vTop, vSpan, ky
  uHdM: { value: new THREE.Vector2() },    // sec(lat_c), tan(lat_c)
};

// Mercator v is expanded to second order about the window centre to stay precise in float32.
export const HD_GLSL = /* glsl */`
  uniform sampler2D uHdMap; uniform float uHdOn; uniform vec2 uHdX; uniform vec4 uHdZ; uniform vec2 uHdM;
  vec3 applyHd(vec3 base, vec3 wp, out float hdW) {
    hdW = 0.0;
    if (uHdOn < 0.5) return base;
    float u = (wp.x - uHdX.x) / (uHdX.y - uHdX.x);
    float dphi = radians((uHdZ.x - wp.z) / uHdZ.w);
    float m = uHdM.x * dphi + 0.5 * uHdM.x * uHdM.y * dphi * dphi;   // mercator y offset (radians)
    float v = (uHdZ.y - m) / uHdZ.z;                                   // 0 at top edge
    if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) return base;
    vec4 t = texture2D(uHdMap, vec2(u, 1.0 - v));
    float edge = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u) * smoothstep(0.0, 0.08, v) * smoothstep(1.0, 0.92, v);
    hdW = t.a * edge;
    // Esri mosaics are brighter / more contrasty than the Sentinel-2 base; ease them in.
    vec3 hd = pow(t.rgb, vec3(1.08)) * 0.95;
    return mix(base, hd, hdW);
  }`;

export class HdImagery {
  constructor(geo, renderer) {
    this.geo = geo;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = N * TS;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    hdUniforms.uHdMap.value = this.tex;
    this.cache = new Map();
    this.enabled = false;
    this.window = null;
    this.failures = 0;
    this.onError = null;
  }

  setEnabled(v) {
    this.enabled = v;
    hdUniforms.uHdOn.value = v && this.window ? 1 : 0;
  }

  load(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let e = this.cache.get(key);
    if (e) return e;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    e = { img, ok: false };
    img.onload = () => { e.ok = true; this.dirty = true; };
    img.onerror = () => {
      this.failures++;
      if (this.failures === 6 && this.onError) this.onError();
    };
    img.src = URL(z, x, y);
    this.cache.set(key, e);
    if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value);
    return e;
  }

  update(target, camDist) {
    if (!this.enabled || camDist > 9000) { hdUniforms.uHdOn.value = 0; return; }
    const z = camDist < 2200 ? 18 : camDist < 4500 ? 17 : 16;
    const { lon, lat } = this.geo.toLonLat(target.x, target.z);
    const x0 = Math.floor(lon2t(lon, z) - N / 2 + 0.5), y0 = Math.floor(lat2t(lat, z) - N / 2 + 0.5);
    const key = `${z}/${x0}/${y0}`;
    if (!this.window || this.window.key !== key) {
      this.window = { key, z, x0, y0 };
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawn = new Set();
      // Geometry of the window in local coordinates.
      const lonW = t2lon(x0, z), lonE = t2lon(x0 + N, z);
      const latN = t2lat(y0, z), latS = t2lat(y0 + N, z);
      const latC = t2lat(y0 + N / 2, z);
      const phi = latC * Math.PI / 180, sec = 1 / Math.cos(phi), tan = Math.tan(phi);
      const merc = (la) => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360));
      const mC = merc(latC);
      const vTop = merc(latN) - mC, vSpan = merc(latN) - merc(latS);
      hdUniforms.uHdX.value.set(this.geo.toLocal(lonW, latC).x, this.geo.toLocal(lonE, latC).x);
      hdUniforms.uHdZ.value.set(this.geo.toLocal(lon, latC).z, vTop, vSpan, this.geo.ky);
      hdUniforms.uHdM.value.set(sec, tan);
      this.dirty = true;
    }
    hdUniforms.uHdOn.value = 1;
    if (!this.dirty) return;
    this.dirty = false;
    let changed = false;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = `${z}/${x0 + i}/${y0 + j}`;
      const e = this.load(z, x0 + i, y0 + j);
      if (e.ok && !this.drawn.has(k)) {
        try {
          this.ctx.drawImage(e.img, i * TS, j * TS, TS, TS);
          this.drawn.add(k); changed = true;
        } catch { /* tainted or broken tile */ }
      }
    }
    if (changed) this.tex.needsUpdate = true;
  }
}
