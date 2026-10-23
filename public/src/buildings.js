// Extruded building footprints (Overture Maps / OpenStreetMap) with hill-town massing:
// walls drop to the lowest ground point (buildings step down the slopes on stilts and
// retaining walls), pitched tin roofs on rectangular footprints, flat RCC roofs with
// water tanks elsewhere, and procedural windows that light up after dusk.
import * as THREE from 'three';
import { patchMaterial } from './atmosphere.js';
import { hash2 } from './geo.js';

const FLOOR_H = 3.1;
const TILE = 2500;

const lin = (c) => c.map((v) => Math.pow(v, 2.2)); // palettes are authored in sRGB
const WALLS = [[0.93, 0.91, 0.86], [0.95, 0.93, 0.84], [0.88, 0.84, 0.74], [0.92, 0.86, 0.78],
  [0.84, 0.86, 0.85], [0.80, 0.80, 0.78], [0.94, 0.88, 0.80], [0.80, 0.86, 0.90], [0.70, 0.68, 0.64],
  [0.96, 0.96, 0.95], [0.90, 0.80, 0.70], [0.86, 0.90, 0.82]].map(lin);
const ROOFS = { red: [0.56, 0.24, 0.19], maroon: [0.42, 0.19, 0.17], green: [0.27, 0.38, 0.29], grey: [0.55, 0.56, 0.56],
  blue: [0.32, 0.41, 0.52], slate: [0.34, 0.35, 0.36], concrete: [0.62, 0.60, 0.56], beige: [0.68, 0.63, 0.55] };
for (const k in ROOFS) ROOFS[k] = lin(ROOFS[k]);

class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.info = []; }
  tri(a, b, c, col, uvs, info) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(...col); this.info.push(...info); }
    if (uvs) this.uv.push(...uvs); else this.uv.push(0, 0.05, 0, 0.05, 0, 0.05);
  }
  // Emit a triangle whose normal points to the same side as `out`.
  triOut(a, b, c, out, col, info) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) this.tri(a, c, b, col, null, info);
    else this.tri(a, b, c, col, null, info);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('info', new THREE.Float32BufferAttribute(this.info, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// Minimum-area oriented rectangle (rotating edge directions; footprints are small).
function minRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    let ux = b[0] - a[0], uz = b[1] - a[1];
    const l = Math.hypot(ux, uz); if (l < 1e-6) continue;
    ux /= l; uz /= l;
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const p of pts) {
      const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux;
      mnu = Math.min(mnu, u); mxu = Math.max(mxu, u); mnv = Math.min(mnv, v); mxv = Math.max(mxv, v);
    }
    const area = (mxu - mnu) * (mxv - mnv);
    if (!best || area < best.area) {
      const cu = (mnu + mxu) / 2, cv = (mnv + mxv) / 2;
      best = { area, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, L: mxu - mnu, B: mxv - mnv };
    }
  }
  if (best && best.B > best.L) { // make u the long axis
    best = { ...best, ux: -best.uz, uz: best.ux, L: best.B, B: best.L };
  }
  return best;
}

export function parseBuildings(buf) {
  const head = new Uint32Array(buf, 0, 2);
  const n = head[0], nv = head[1];
  let o = 8;
  const offs = new Uint32Array(buf, o, n + 1); o += (n + 1) * 4;
  const floors = new Uint8Array(buf, o, n); o += n;
  const kinds = new Uint8Array(buf, o, n); o += n;
  o += (4 - (2 * n) % 4) % 4;
  const pos = new Float32Array(buf, o, nv * 2);
  return { n, offs, floors, kinds, pos };
}

export function buildBuildings(geo, data, satPixels, scene) {
  const tiles = new Map();
  const tanks = [];
  const tileOf = (x, z) => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    if (!tiles.has(k)) tiles.set(k, { walls: new Builder(), roofs: new Builder() });
    return tiles.get(k);
  };
  const sat = (x, z) => {
    if (!satPixels) return null;
    const { lon, lat } = geo.toLonLat(x, z);
    const { W, S, E, N } = geo.bbox;
    const px = Math.floor((lon - W) / (E - W) * satPixels.width), py = Math.floor((N - lat) / (N - S) * satPixels.height);
    if (px < 0 || py < 0 || px >= satPixels.width || py >= satPixels.height) return null;
    const i = (py * satPixels.width + px) * 4, d = satPixels.data;
    return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
  };

  for (let b = 0; b < data.n; b++) {
    let pts = [];
    for (let k = data.offs[b]; k < data.offs[b + 1]; k++) pts.push([data.pos[k * 2], data.pos[k * 2 + 1]]);
    let a2 = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
    if (a2 > 0) pts = pts.reverse();
    const area = Math.abs(a2) / 2;
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cz += p[1]; }
    cx /= pts.length; cz /= pts.length;
    const gs = pts.map((p) => geo.height(p[0], p[1]));
    const gMin = Math.min(...gs), gMax = Math.max(...gs), gC = geo.height(cx, cz);
    const top0 = Math.max(gMax, gC);
    const fl = data.floors[b];
    const yb = gMin - 2, yt = top0 + fl * FLOOR_H + 0.4;
    const r1 = hash2(b, 1), r2 = hash2(b, 2), r3 = hash2(b, 3);
    const wall = WALLS[Math.floor(r1 * WALLS.length)].map((v) => v * (0.92 + 0.08 * r2));
    const info = [fl, r3];
    const t = tileOf(cx, cz);

    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const u0 = per, u1 = per + len; per = u1;
      const v0 = (yb - top0) / FLOOR_H, v1 = (yt - top0) / FLOOR_H;
      const pB = [p[0], yb, p[1]], qB = [q[0], yb, q[1]], qT = [q[0], yt, q[1]], pT = [p[0], yt, p[1]];
      t.walls.tri(pB, qB, qT, wall, [u0, v0, u1, v0, u1, v1], info);
      t.walls.tri(pB, qT, pT, wall, [u0, v0, u1, v1, u0, v1], info);
    }

    // Roof colour: read from the satellite pixel where the roof is big enough to show.
    const sc = area > 60 ? sat(cx, cz) : null;
    let roofKey;
    if (sc && sc[0] > sc[1] * 1.18 && sc[0] > sc[2] * 1.25) roofKey = r2 < 0.7 ? 'red' : 'maroon';
    else if (sc && sc[2] > sc[0] * 1.08 && sc[2] > sc[1]) roofKey = 'blue';
    else {
      const r = r2;
      roofKey = r < 0.3 ? 'grey' : r < 0.48 ? 'green' : r < 0.66 ? 'red' : r < 0.74 ? 'maroon' : r < 0.84 ? 'slate' : 'blue';
    }
    const rect = minRect(pts);
    const fill = rect ? area / rect.area : 0;
    const pitched = rect && fill > 0.8 && area < 1600 && rect.B > 4 && hash2(b, 4) < 0.82;
    const shade = 0.85 + 0.25 * hash2(b, 5);
    if (pitched) {
      const col = ROOFS[roofKey].map((v) => v * shade);
      const ov = 0.45, L = rect.L / 2 + ov, B = rect.B / 2 + ov;
      const ux = rect.ux, uz = rect.uz, vx = -uz, vz = ux;
      const rh = (rect.B / 2) * Math.tan(THREE.MathUtils.degToRad(22 + 10 * hash2(b, 6)));
      const at = (u, v, y) => [rect.cx + ux * u + vx * v, y, rect.cz + uz * u + vz * v];
      const ye = yt - 0.2, yr = yt + rh;
      const A = at(L, B, ye), Bc = at(-L, B, ye), C = at(-L, -B, ye), D = at(L, -B, ye);
      const hip = hash2(b, 7) < 0.6;
      const rl = hip ? Math.max(L - B, 0) : L;
      const R1 = at(rl, 0, yr), R2 = at(-rl, 0, yr);
      const upV = (sx, sz) => [sx, 1, sz];
      t.roofs.triOut(A, Bc, R2, upV(vx, vz), col, [0, 0]); t.roofs.triOut(A, R2, R1, upV(vx, vz), col, [0, 0]);
      t.roofs.triOut(C, D, R1, upV(-vx, -vz), col, [0, 0]); t.roofs.triOut(C, R1, R2, upV(-vx, -vz), col, [0, 0]);
      if (hip) {
        t.roofs.triOut(D, A, R1, upV(ux, uz), col, [0, 0]);
        t.roofs.triOut(Bc, C, R2, upV(-ux, -uz), col, [0, 0]);
      } else {
        const ga = at(L - ov, B - ov, yt - 0.2), gd = at(L - ov, -B + ov, yt - 0.2), gr = at(L - ov, 0, yr - 0.1);
        const gb = at(-L + ov, B - ov, yt - 0.2), gc = at(-L + ov, -B + ov, yt - 0.2), gr2 = at(-L + ov, 0, yr - 0.1);
        t.walls.triOut(gd, ga, gr, [ux, 0, uz], wall, info);
        t.walls.triOut(gb, gc, gr2, [-ux, 0, -uz], wall, info);
      }
    } else {
      const flatKey = r2 < 0.5 ? 'concrete' : r2 < 0.7 ? 'beige' : roofKey;
      const col = ROOFS[flatKey].map((v) => v * shade);
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const [i, j, k] of tris) {
        t.roofs.triOut([pts[i][0], yt, pts[i][1]], [pts[j][0], yt, pts[j][1]], [pts[k][0], yt, pts[k][1]], [0, 1, 0], col, [0, 0]);
      }
      // Black polyethylene water tanks — a fixture of nearly every flat roof in the hills.
      if (area > 25 && hash2(b, 8) < 0.7) {
        const tx = cx + (pts[0][0] - cx) * 0.45, tz = cz + (pts[0][1] - cz) * 0.45;
        tanks.push(tx, yt, tz, 0.8 + hash2(b, 9) * 0.5);
      }
    }
  }

  const wallMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }), (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 info;\nvarying vec2 vInfo;\nvarying vec2 vWallUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = info; vWallUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec2 vInfo; varying vec2 vWallUv; uniform float uNight;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <map_fragment>', /* glsl */`
        #include <map_fragment>
        float winMask = 0.0, winOn = 0.0;
        {
          vec2 w = vWallUv;
          float camD = distance(cameraPosition, vFogWorld);
          float sharp = 1.0 - smoothstep(700.0, 2600.0, camD);
          if (w.y < 0.0) diffuseColor.rgb *= 0.62; // plinth / retaining wall below the entrance level
          if (w.y > 0.12 && w.y < vInfo.x - 0.02) {
            vec2 cell = vec2(floor(w.x / 3.3), floor(w.y));
            float cx = fract(w.x / 3.3), cy = fract(w.y);
            float win = step(0.27, cx) * step(cx, 0.73) * step(0.3, cy) * step(cy, 0.8);
            winMask = mix(0.22, win, sharp);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.08, 0.09), winMask * 0.8);
            float on = step(0.45, h12(cell + vInfo.y * 97.0));
            float occupied = step(0.3, vInfo.y);   // some buildings are dark (closed hotels, empty cottages)
            winOn = mix(0.3, on, sharp) * winMask * occupied;
          }
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.7, 0.36) * winOn * uNight * 1.6;`);
  });
  const roofMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }));

  const group = new THREE.Group();
  group.name = 'buildings';
  for (const t of tiles.values()) {
    for (const [bld, mat] of [[t.walls, wallMat], [t.roofs, roofMat]]) {
      if (!bld.p.length) continue;
      const m = new THREE.Mesh(bld.geometry(), mat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
  }
  if (tanks.length) {
    const g = new THREE.CylinderGeometry(0.6, 0.6, 1.3, 10).translate(0, 0.65, 0);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
    const im = new THREE.InstancedMesh(g, mat, tanks.length / 4);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < tanks.length / 4; i++) {
      const s = tanks[i * 4 + 3];
      m4.makeScale(s, s, s).setPosition(tanks[i * 4], tanks[i * 4 + 1], tanks[i * 4 + 2]);
      im.setMatrixAt(i, m4);
    }
    im.castShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  scene.add(group);
  return { group, count: data.n, wallMat };
}
