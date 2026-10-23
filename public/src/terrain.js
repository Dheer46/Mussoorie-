// Detailed (30 m) terrain of the Mussoorie extent and the surrounding far-field (250 m)
// Garhwal Himalaya, both draped with Sentinel-2 imagery.
import * as THREE from 'three';
import { patchMaterial } from './atmosphere.js';
import { HD_GLSL, hdUniforms } from './hdimagery.js';

const NOISE = /* glsl */`
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

function buildGrid(geo, grid, opts) {
  const { w, h } = grid;
  const { W, S, E, N } = grid;
  const pos = new Float32Array(w * h * 3);
  const uv = new Float32Array(w * h * 2);
  const elev = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const lat = N - (N - S) * j / (h - 1);
    for (let i = 0; i < w; i++) {
      const lon = W + (E - W) * i / (w - 1);
      const k = j * w + i;
      const { x, z } = geo.toLocal(lon, lat);
      const e = opts.elevation ? opts.elevation(x, z) : grid.data[k] * grid.scale;
      pos[k * 3] = x; pos[k * 3 + 1] = e - geo.curvature(x, z) - (opts.drop || 0); pos[k * 3 + 2] = z;
      uv[k * 2] = (lon - opts.tex.W) / (opts.tex.E - opts.tex.W);
      uv[k * 2 + 1] = (lat - opts.tex.S) / (opts.tex.N - opts.tex.S);
      elev[k] = e;
    }
  }
  // Normals by central differences on the grid.
  const nrm = new Float32Array(w * h * 3);
  const P = (i, j) => (Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))) * 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const l = P(i - 1, j), r = P(i + 1, j), u = P(i, j - 1), d = P(i, j + 1);
    a.set(pos[r] - pos[l], pos[r + 1] - pos[l + 1], pos[r + 2] - pos[l + 2]);
    b.set(pos[d] - pos[u], pos[d + 1] - pos[u + 1], pos[d + 2] - pos[u + 2]);
    n.crossVectors(b, a).normalize();
    nrm.set([n.x, n.y, n.z], (j * w + i) * 3);
  }
  const idx = [];
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    if (opts.skipCell && opts.skipCell(pos, j * w + i, j * w + i + 1, (j + 1) * w + i, (j + 1) * w + i + 1)) continue;
    const k = j * w + i;
    idx.push(k, k + w, k + 1, k + 1, k + w, k + w + 1);
  }
  return { pos, uv, nrm, elev, idx };
}

export function buildTerrain(geo, textures, scene) {
  const group = new THREE.Group();

  // ------------------------------------------------------------------ far terrain
  const f = geo.far;
  const ext = geo.extent, m = 60;
  const fgrid = buildGrid(geo, f, {
    tex: f, drop: 2,
    // Inside the detail extent the far mesh takes 30 m heights so the two surfaces agree at the seam.
    elevation: (x, z) => geo.elevation(x, z),
    // Leave out cells that lie fully inside the detailed terrain.
    skipCell: (p, ...ks) => ks.every((k) => p[k * 3] > ext.minX + m && p[k * 3] < ext.maxX - m && p[k * 3 + 2] > ext.minZ + m && p[k * 3 + 2] < ext.maxZ - m),
  });
  // Rendered far-surface height (same triangle interpolation as the mesh).
  const farY = (x, z) => {
    const { lon, lat } = geo.toLonLat(x, z);
    const fx = (lon - f.W) / (f.E - f.W) * (f.w - 1), fy = (f.N - lat) / (f.N - f.S) * (f.h - 1);
    const x0 = Math.min(Math.floor(fx), f.w - 2), y0 = Math.min(Math.floor(fy), f.h - 2), tx = fx - x0, ty = fy - y0;
    const Y = (i, j) => fgrid.pos[((y0 + j) * f.w + x0 + i) * 3 + 1];
    return tx + ty <= 1 ? Y(0, 0) + tx * (Y(1, 0) - Y(0, 0)) + ty * (Y(0, 1) - Y(0, 0))
      : Y(1, 1) + (1 - tx) * (Y(0, 1) - Y(1, 1)) + (1 - ty) * (Y(1, 0) - Y(1, 1));
  };

  // ------------------------------------------------------------------ near terrain
  const d = geo.dem;
  const g = buildGrid(geo, d, { tex: d });
  // Skirt: a wall from the border down (or up) to the far-field surface closes the seam.
  const w = d.w, h = d.h;
  const border = [];
  for (let i = 0; i < w; i++) border.push(i);
  for (let j = 1; j < h; j++) border.push(j * w + w - 1);
  for (let i = w - 2; i >= 0; i--) border.push((h - 1) * w + i);
  for (let j = h - 2; j > 0; j--) border.push(j * w);
  border.push(0);
  const base = w * h;
  const pos = new Float32Array((base + border.length) * 3); pos.set(g.pos);
  const uv = new Float32Array((base + border.length) * 2); uv.set(g.uv);
  const nrm = new Float32Array((base + border.length) * 3); nrm.set(g.nrm);
  border.forEach((k, s) => {
    const t = base + s;
    const x = g.pos[k * 3], y = g.pos[k * 3 + 1], z = g.pos[k * 3 + 2];
    const fy = farY(x, z);
    pos.set([x, fy > y ? fy + 3 : fy - 30, z], t * 3);
    uv.set([g.uv[k * 2], g.uv[k * 2 + 1]], t * 2);
    nrm.set([g.nrm[k * 3], g.nrm[k * 3 + 1], g.nrm[k * 3 + 2]], t * 3);
    if (s < border.length - 1) g.idx.push(k, base + s, border[s + 1], border[s + 1], base + s, base + s + 1);
  });
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ng.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  ng.setIndex(new THREE.BufferAttribute(new Uint32Array(g.idx), 1));
  ng.computeBoundingSphere();

  const nearMat = patchMaterial(new THREE.MeshStandardMaterial({ map: textures.near, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }), (sh) => {
    Object.assign(sh.uniforms, hdUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE + HD_GLSL)
      .replace('#include <map_fragment>', /* glsl */`
        #include <map_fragment>
        float hdW;
        diffuseColor.rgb = applyHd(diffuseColor.rgb, vFogWorld, hdW);
        {
          // Sub-pixel detail so the 10 m imagery holds up when zoomed in close.
          float camD = distance(cameraPosition, vFogWorld);
          float fade = 1.0 - smoothstep(600.0, 5000.0, camD);
          float n = fbm(vFogWorld.xz * 0.11) * 0.6 + fbm(vFogWorld.xz * 0.9) * 0.4;
          diffuseColor.rgb *= mix(1.0, 0.78 + 0.44 * n, fade * 0.7 * (1.0 - hdW));
        }`);
  });
  const near = new THREE.Mesh(ng, nearMat);
  near.receiveShadow = true;
  near.castShadow = true;
  near.name = 'terrain';
  group.add(near);

  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fgrid.pos, 3));
  fg.setAttribute('normal', new THREE.BufferAttribute(fgrid.nrm, 3));
  fg.setAttribute('uv', new THREE.BufferAttribute(fgrid.uv, 2));
  fg.setAttribute('elev', new THREE.BufferAttribute(fgrid.elev, 1));
  fg.setIndex(new THREE.BufferAttribute(new Uint32Array(fgrid.idx), 1));
  fg.computeBoundingSphere();
  const farMat = patchMaterial(new THREE.MeshStandardMaterial({ map: textures.far, roughness: 0.95 }), (sh) => {
    // Overlap the detail mesh by one DEM cell so sampling differences never open a crack.
    sh.uniforms.uDetail = { value: new THREE.Vector4(ext.minX + 30, ext.minZ + 30, ext.maxX - 30, ext.maxZ - 30) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float elev;\nvarying float vElev;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElev = elev;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uDetail;\nvarying float vElev;')
      .replace('#include <clipping_planes_fragment>', /* glsl */`
        #include <clipping_planes_fragment>
        if (vFogWorld.x > uDetail.x && vFogWorld.x < uDetail.z && vFogWorld.z > uDetail.y && vFogWorld.z < uDetail.w) discard;`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        // Fresh snow on the high Himalaya is smoother and brighter than the 80 m texels suggest.
        float snow = smoothstep(4300.0, 5200.0, vElev) * smoothstep(0.55, 0.85, dot(diffuseColor.rgb, vec3(0.333)));
        roughnessFactor = mix(roughnessFactor, 0.55, snow);`);
  });
  const far = new THREE.Mesh(fg, farMat);
  far.receiveShadow = true;
  far.name = 'farTerrain';
  group.add(far);

  scene.add(group);
  return { group, near, far, nearMat, farMat };
}
