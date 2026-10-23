// Forests of the Mussoorie hills, instanced around the point of interest.
// Where trees grow comes from Sentinel-2 NDVI (forest.png, with buildings and roads
// masked out); which species grows follows the altitudinal zonation of the Garhwal
// lesser Himalaya: sal in the Doon, chir pine on the warm mid slopes, banj oak and
// deodar on the upper ridges.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from './atmosphere.js';
import { rng } from './geo.js';

const CELL = 200;

function colored(g, c) {
  if (g.index) g = g.toNonIndexed();
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  const lin = c.map((v) => Math.pow(v, 2.2)); // palette is authored in sRGB
  for (let i = 0; i < n; i++) a.set(lin, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}

const BARK = [0.24, 0.18, 0.13];

// All geometries are 1 m tall; instances are scaled to the real tree height.
function deodar() {
  const parts = [colored(new THREE.CylinderGeometry(0.008, 0.016, 0.35, 5).translate(0, 0.175, 0), BARK)];
  const tiers = 7;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = 0.2 * (1 - t) + 0.025;
    const y0 = 0.12 + t * 0.8;
    const cone = new THREE.ConeGeometry(r, 0.2 - t * 0.05, 7, 1, true).translate(0, y0 + 0.08, 0);
    const shade = 0.85 + 0.15 * t;
    parts.push(colored(cone, [0.13 * shade, 0.21 * shade, 0.15 * shade]));
  }
  parts.push(colored(new THREE.ConeGeometry(0.03, 0.12, 5).translate(0, 0.96, 0), [0.15, 0.24, 0.16]));
  return mergeGeometries(parts);
}

function chirPine() {
  const parts = [colored(new THREE.CylinderGeometry(0.01, 0.022, 0.75, 5).translate(0, 0.375, 0), [0.33, 0.24, 0.17])];
  const r = rng(3);
  for (let i = 0; i < 5; i++) {
    const g = new THREE.IcosahedronGeometry(0.12 + r() * 0.05, 0).scale(1, 0.6, 1)
      .translate((r() - 0.5) * 0.16, 0.66 + i * 0.065, (r() - 0.5) * 0.16);
    parts.push(colored(g, [0.24 + r() * 0.04, 0.31 + r() * 0.04, 0.14]));
  }
  return mergeGeometries(parts);
}

function broadleaf(col) {
  const parts = [colored(new THREE.CylinderGeometry(0.03, 0.05, 0.45, 5).translate(0, 0.225, 0), BARK)];
  const r = rng(5);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.IcosahedronGeometry(0.2 + r() * 0.1, 1).scale(1, 0.85, 1)
      .translate((r() - 0.5) * 0.36, 0.55 + r() * 0.25, (r() - 0.5) * 0.36);
    const s = 0.85 + r() * 0.3;
    parts.push(colored(g, col.map((v) => v * s)));
  }
  return mergeGeometries(parts);
}

const SPECIES = [
  { name: 'deodar', geo: deodar, h: [18, 38], w: 0.9 },
  { name: 'chir', geo: chirPine, h: [16, 30], w: 1.0 },
  { name: 'oak', geo: () => broadleaf([0.2, 0.26, 0.15]), h: [9, 18], w: 1.1 },
  { name: 'sal', geo: () => broadleaf([0.18, 0.3, 0.13]), h: [14, 26], w: 0.9 },
];

function pickSpecies(e, r) {
  if (e > 2000) return r < 0.45 ? 0 : r < 0.85 ? 2 : 1;
  if (e > 1500) return r < 0.25 ? 0 : r < 0.6 ? 2 : 1;
  if (e > 1000) return r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
  return r < 0.6 ? 3 : r < 0.85 ? 1 : 2;
}

export class Forest {
  constructor(geo, density, scene, budget = 90000) {
    this.geo = geo; this.density = density; this.budget = budget;
    this.cache = new Map();
    this.meshes = SPECIES.map((s) => {
      const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
      const m = new THREE.InstancedMesh(s.geo(), mat, budget);
      m.count = 0;
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    });
    this.center = new THREE.Vector3(1e9, 0, 0);
    this.radius = 0;
    this.visible = true;
  }

  densityAt(x, z) {
    const { lon, lat } = this.geo.toLonLat(x, z);
    const { W, S, E, N } = this.geo.bbox;
    const d = this.density;
    const px = Math.floor((lon - W) / (E - W) * d.width), py = Math.floor((N - lat) / (N - S) * d.height);
    if (px < 0 || py < 0 || px >= d.width || py >= d.height) return 0;
    return d.data[(py * d.width + px) * 4] / 255;
  }

  cell(ci, cj) {
    const key = ci * 100000 + cj;
    let c = this.cache.get(key);
    if (c) return c;
    const r = rng(key * 2654435761);
    const out = [];
    const step = 10;
    for (let a = 0; a < CELL / step; a++) for (let b = 0; b < CELL / step; b++) {
      const x = ci * CELL + (a + r()) * step, z = cj * CELL + (b + r()) * step;
      const dens = this.densityAt(x, z);
      const pr = r();
      if (pr > dens * dens * 0.95) continue;
      const y = this.geo.height(x, z);
      const e = this.geo.elevation(x, z);
      const sp = pickSpecies(e, r());
      const [h0, h1] = SPECIES[sp].h;
      out.push(x, y - 0.6, z, h0 + (h1 - h0) * Math.pow(r(), 1.4), r() * Math.PI * 2, sp, r());
    }
    // Shuffle so that a prefix is a uniform thinning of the cell (used for far LOD).
    const n = out.length / 7, f = new Float32Array(out);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      for (let k = 0; k < 7; k++) { const t = f[i * 7 + k]; f[i * 7 + k] = f[j * 7 + k]; f[j * 7 + k] = t; }
    }
    c = f;
    this.cache.set(key, c);
    if (this.cache.size > 4000) this.cache.delete(this.cache.keys().next().value);
    return c;
  }

  update(target, camDist, force = false) {
    const show = this.visible && camDist < 6500;
    this.meshes.forEach((m) => { m.visible = show; });
    if (!show) return;
    const radius = THREE.MathUtils.clamp(camDist * 0.8 + 600, 1200, 4000);
    if (!force && this.center.distanceTo(target) < 220 && Math.abs(radius - this.radius) < 400) return;
    this.center.copy(target); this.radius = radius;

    const cells = [];
    const r = Math.ceil(radius / CELL);
    const ci0 = Math.floor(target.x / CELL), cj0 = Math.floor(target.z / CELL);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const cx = (ci0 + i + 0.5) * CELL, cz = (cj0 + j + 0.5) * CELL;
      const d = Math.hypot(cx - target.x, cz - target.z);
      if (d <= radius + CELL && this.geo.insideDetail(cx, cz)) cells.push([d, ci0 + i, cj0 + j]);
    }
    cells.sort((a, b) => a[0] - b[0]);
    const counts = [0, 0, 0, 0];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let total = 0;
    for (const [d, ci, cj] of cells) {
      const f = this.cell(ci, cj);
      const n = f.length / 7;
      // Thin out distant cells; their trees cover few pixels.
      const keep = Math.ceil(n * THREE.MathUtils.clamp(1.25 - d / radius, 0.25, 1));
      for (let k = 0; k < keep && total < this.budget; k++) {
        const o = k * 7, sp = f[o + 5], mesh = this.meshes[sp], h = f[o + 3];
        p.set(f[o], f[o + 1], f[o + 2]);
        q.setFromAxisAngle(up, f[o + 4]);
        s.set(h * SPECIES[sp].w, h, h * SPECIES[sp].w);
        m4.compose(p, q, s);
        mesh.setMatrixAt(counts[sp], m4);
        const v = 0.8 + f[o + 6] * 0.4;
        mesh.setColorAt(counts[sp], col.setRGB(v, v * (0.95 + f[o + 6] * 0.1), v * 0.95));
        counts[sp]++; total++;
      }
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    this.count = total;
  }
}
