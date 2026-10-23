// Geodesy + elevation sampling. Scene units are metres: +x east, +y up, +z south,
// origin at the centre of the detailed DEM extent (meta.proj).

const EARTH_R = 6371000;
// Standard atmospheric refraction makes the horizon appear as if Earth were ~7/6 larger.
const CURVE_R = EARTH_R * 7 / 6;

export class Geo {
  constructor(meta, dem, far) {
    this.meta = meta;
    const p = meta.proj;
    this.lat0 = p.lat0; this.lon0 = p.lon0; this.kx = p.kx; this.ky = p.ky;
    const [W, S, E, N] = meta.bbox;
    this.bbox = { W, S, E, N };
    this.dem = { data: dem, w: meta.dem.width, h: meta.dem.height, scale: meta.dem.scale, W, S, E, N };
    const fb = meta.far.bbox;
    this.far = { data: far, w: meta.far.width, h: meta.far.height, scale: meta.far.scale, W: fb[0], S: fb[1], E: fb[2], N: fb[3] };
    const a = this.toLocal(W, N), b = this.toLocal(E, S);
    this.extent = { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z };
  }

  toLocal(lon, lat) {
    return { x: (lon - this.lon0) * this.kx, z: (this.lat0 - lat) * this.ky };
  }

  toLonLat(x, z) {
    return { lon: this.lon0 + x / this.kx, lat: this.lat0 - z / this.ky };
  }

  static sample(g, lon, lat) {
    const fx = (lon - g.W) / (g.E - g.W) * (g.w - 1);
    const fy = (g.N - lat) / (g.N - g.S) * (g.h - 1);
    if (fx < 0 || fy < 0 || fx > g.w - 1 || fy > g.h - 1) return null;
    const x0 = Math.min(Math.floor(fx), g.w - 2), y0 = Math.min(Math.floor(fy), g.h - 2);
    const tx = fx - x0, ty = fy - y0, d = g.data, w = g.w;
    const i = y0 * w + x0;
    // Interpolate on the same two triangles per cell that the terrain mesh uses, so
    // anything placed with this sits exactly on the rendered surface.
    const h00 = d[i], h10 = d[i + 1], h01 = d[i + w], h11 = d[i + w + 1];
    const h = tx + ty <= 1
      ? h00 + tx * (h10 - h00) + ty * (h01 - h00)
      : h11 + (1 - tx) * (h01 - h11) + (1 - ty) * (h10 - h11);
    return h * g.scale;
  }

  // True elevation above sea level (m) at a local position.
  elevation(x, z) {
    const { lon, lat } = this.toLonLat(x, z);
    const e = Geo.sample(this.dem, lon, lat);
    if (e !== null) return e;
    const f = Geo.sample(this.far, lon, lat);
    return f === null ? 300 : f;
  }

  // Drop of the Earth's surface below the tangent plane at the origin.
  curvature(x, z) {
    return (x * x + z * z) / (2 * CURVE_R);
  }

  // Scene y of the ground surface.
  height(x, z) {
    return this.elevation(x, z) - this.curvature(x, z);
  }

  insideDetail(x, z, margin = 0) {
    const e = this.extent;
    return x > e.minX + margin && x < e.maxX - margin && z > e.minZ + margin && z < e.maxZ - margin;
  }
}

// Deterministic PRNG (mulberry32) so procedural detail is stable between sessions.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function formatLatLon(lat, lon) {
  const f = (v, p, n) => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
    return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${v >= 0 ? p : n}`;
  };
  return `${f(lat, 'N', 'S')}  ${f(lon, 'E', 'W')}`;
}
