// Road network, streams, Mussoorie Lake and waterfalls, draped on the terrain.
import * as THREE from 'three';
import { patchMaterial, FOG_PARS_F } from './atmosphere.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2)); // palette authored in sRGB
const ASPHALT = lin([0.24, 0.24, 0.25]), LANE = lin([0.33, 0.33, 0.34]), DIRT = lin([0.5, 0.43, 0.34]), PAVING = lin([0.6, 0.57, 0.53]);
const STYLE = {
  trunk: [7.5, ASPHALT], primary: [7, ASPHALT], secondary: [6.5, ASPHALT], tertiary: [5.5, LANE],
  residential: [4, LANE], unclassified: [4, LANE], living_street: [3.5, LANE], service: [3, LANE],
  unknown: [3.5, LANE], track: [3, DIRT], path: [1.6, DIRT], footway: [1.8, PAVING], steps: [1.8, PAVING],
  pedestrian: [3, PAVING], bridleway: [1.8, DIRT],
};
const NAMED = { 'Mall Road': [7, PAVING], 'Camels Back Road': [4.5, PAVING] };
const TILE = 3000;

function resample(p, step) {
  const out = [[p[0], p[1]]];
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  return out;
}

// Triangle strip following the terrain; heights are sampled at both edges so the
// ribbon banks with the slope.
function ribbon(geo, pts, width, lift, col, out) {
  const n = pts.length;
  if (n < 2) return;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz * width / 2, nz = dx * width / 2;
    const lx = pts[i][0] + nx, lz = pts[i][1] + nz, rx = pts[i][0] - nx, rz = pts[i][1] - nz;
    const hc = geo.height(pts[i][0], pts[i][1]);
    L.push([lx, Math.max(geo.height(lx, lz), hc - width) + lift, lz]);
    R.push([rx, Math.max(geo.height(rx, rz), hc - width) + lift, rz]);
  }
  for (let i = 0; i < n - 1; i++) {
    out.p.push(...L[i], ...L[i + 1], ...R[i], ...L[i + 1], ...R[i + 1], ...R[i]);
    for (let k = 0; k < 6; k++) out.c.push(...col);
  }
}

function meshFrom(buf, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

export function buildRoads(geo, roads, scene) {
  const tiles = new Map();
  const order = ['path', 'footway', 'steps', 'bridleway', 'track', 'service', 'unknown', 'living_street', 'unclassified', 'residential', 'pedestrian', 'tertiary', 'secondary', 'primary', 'trunk'];
  const sorted = [...roads].sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
  for (const r of sorted) {
    const [w, col] = NAMED[r.n] || STYLE[r.c] || STYLE.unknown;
    const pts = resample(r.p, 4);
    const mid = pts[pts.length >> 1];
    const k = `${Math.floor(mid[0] / TILE)},${Math.floor(mid[1] / TILE)}`;
    if (!tiles.has(k)) tiles.set(k, { p: [], c: [] });
    // Major roads ride slightly higher so junctions overlap cleanly.
    ribbon(geo, pts, w, 0.35 + order.indexOf(r.c) * 0.01, col, tiles.get(k));
  }
  const mat = patchMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  const group = new THREE.Group();
  group.name = 'roads';
  for (const t of tiles.values()) group.add(meshFrom(t, mat));
  scene.add(group);
  return group;
}

// Glowing overlay for the roads that make up a landmark (Mall Road, Dhanaulti road…).
export function highlightRoads(geo, roads, names) {
  const buf = { p: [], c: [] };
  for (const r of roads) if (names.includes(r.n)) ribbon(geo, resample(r.p, 4), 9, 1.2, [1, 0.62, 0.2], buf);
  if (!buf.p.length) return null;
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, toneMapped: false,
  });
  const m = meshFrom(buf, mat);
  m.renderOrder = 3;
  return m;
}

export function buildWater(geo, water, scene) {
  const group = new THREE.Group();
  group.name = 'water';
  const waterMat = patchMaterial(new THREE.MeshStandardMaterial({
    color: 0x2c4f55, roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  const lines = { p: [], c: [] };
  for (const l of water.lines) {
    const w = l.c === 'river' ? 14 : 2.6;
    const col = lin(l.c === 'river' ? [0.36, 0.46, 0.48] : [0.3, 0.4, 0.42]);
    ribbon(geo, resample(l.p, 6), w, 0.3, col, lines);
  }
  if (lines.p.length) {
    const m = meshFrom(lines, patchMaterial(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.2, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    })));
    group.add(m);
  }
  for (const a of water.areas) {
    if (a.c === 'swimming_pool' || a.p.length < 6) continue;
    const pts = [];
    for (let i = 0; i < a.p.length; i += 2) pts.push(new THREE.Vector2(a.p[i], a.p[i + 1]));
    const y = Math.min(...pts.map((p) => geo.height(p.x, p.y))) + 0.6;
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const pos = [];
    for (const t of tris) for (const i of [t[0], t[2], t[1]]) pos.push(pts[i].x, y, pts[i].y);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, waterMat);
    m.receiveShadow = true;
    group.add(m);
  }
  scene.add(group);
  return group;
}

// Animated cascade traced down the steepest-descent path from the waterfall's top.
export function buildWaterfall(geo, x, z, scene, uniforms) {
  const pts = [[x, z]];
  let cx = x, cz = z;
  for (let i = 0; i < 18; i++) {
    let best = null, bh = geo.height(cx, cz);
    for (let a = 0; a < 16; a++) {
      const nx = cx + Math.cos(a / 16 * Math.PI * 2) * 6, nz = cz + Math.sin(a / 16 * Math.PI * 2) * 6;
      const h = geo.height(nx, nz);
      if (h < bh) { bh = h; best = [nx, nz]; }
    }
    if (!best) break;
    pts.push(best); cx = best[0]; cz = best[1];
  }
  const buf = { p: [], c: [] };
  ribbon(geo, pts, 7, 1.2, [1, 1, 1], buf);
  const uvs = [];
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) uvs.push(0, i / n, 0, (i + 1) / n, 1, i / n, 0, (i + 1) / n, 1, (i + 1) / n, 1, i / n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vFogWorld;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vFogWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uNight; varying vec2 vUv;
      ${FOG_PARS_F}
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float streak = n2(vec2(vUv.x * 9.0, vUv.y * 14.0 - uTime * 3.0)) * 0.6 + n2(vec2(vUv.x * 23.0, vUv.y * 40.0 - uTime * 6.0)) * 0.4;
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
        float a = edge * (0.45 + 0.55 * streak);
        vec3 col = mix(vec3(0.86, 0.92, 0.95), vec3(0.12, 0.14, 0.18), uNight);
        gl_FragColor = vec4(applyAerial(col, vFogWorld), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 4;
  scene.add(m);
  return m;
}
