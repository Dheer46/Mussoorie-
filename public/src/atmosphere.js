// Sun, sky, aerial perspective (height fog), cumulus clouds and their ground shadows.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { rng } from './geo.js';

const MAX_CLOUD_SHADOWS = 24;

// Shared uniforms. Every material in the scene references these objects, so updating
// .value here re-lights the whole world.
export const env = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uFogColor: { value: new THREE.Color(0.7, 0.78, 0.88) },
  uFogDensity: { value: 1 / 16000 },
  uFogFalloff: { value: 1 / 1300 },
  uFogBase: { value: 650 },
  uTime: { value: 0 },
  uNight: { value: 0 },
  uClouds: { value: Array.from({ length: MAX_CLOUD_SHADOWS }, () => new THREE.Vector4(0, -1e5, 0, 1)) },
  uCloudShadow: { value: 0.55 },
};

const FOG_PARS_V = /* glsl */`varying vec3 vFogWorld;`;
const FOG_V = /* glsl */`
  {
    vec4 fwp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      fwp = instanceMatrix * fwp;
    #endif
    vFogWorld = (modelMatrix * fwp).xyz;
  }`;

export const FOG_PARS_F = /* glsl */`
  varying vec3 vFogWorld;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFogFalloff;
  uniform float uFogBase;
  uniform vec4 uClouds[${MAX_CLOUD_SHADOWS}];
  uniform float uCloudShadow;
  // Analytic integral of an exponential-height fog along the view ray (Quilez).
  vec3 applyAerial(vec3 col, vec3 wp) {
    vec3 rd = wp - cameraPosition;
    float dist = length(rd);
    rd /= max(dist, 1e-3);
    float b = uFogFalloff;
    float k = rd.y * b;
    float base = uFogDensity * exp(-(cameraPosition.y - uFogBase) * b);
    float amt = abs(k) < 1e-6 ? base * dist : base * (1.0 - exp(clamp(-k * dist, -80.0, 80.0))) / k;
    float f = 1.0 - exp(-max(amt, 0.0));
    float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 6.0);
    vec3 fc = mix(uFogColor, uSunColor * 1.05, sunAmt * 0.55);
    return mix(col, fc, f);
  }
  // Shadows cast by the cumulus layer: project the fragment toward the sun onto each
  // cloud's altitude and test against the cloud footprint.
  float cloudShadow(vec3 wp) {
    float s = 1.0;
    float sy = max(uSunDir.y, 0.06);
    for (int i = 0; i < ${MAX_CLOUD_SHADOWS}; i++) {
      vec4 c = uClouds[i];
      vec2 q = wp.xz + uSunDir.xz * (c.y - wp.y) / sy;
      float d = length(q - c.xz) / c.w;
      s *= 1.0 - uCloudShadow * smoothstep(1.0, 0.35, d);
    }
    return s;
  }`;

const FOG_F = /* glsl */`
  #ifdef USE_FOG
    gl_FragColor.rgb = applyAerial(gl_FragColor.rgb, vFogWorld);
  #endif`;

const CLOUD_SHADOW_F = /* glsl */`
  #include <lights_fragment_end>
  {
    float cs = cloudShadow(vFogWorld);
    reflectedLight.directDiffuse *= cs;
    reflectedLight.directSpecular *= cs;
  }`;

// Adds aerial perspective + cloud shadows to a built-in material; `extra(shader)` can
// apply further edits. Uniform objects are shared with `env`.
export function patchMaterial(mat, extra) {
  mat.fog = true;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', FOG_PARS_V)
      .replace('#include <fog_vertex>', FOG_V);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', FOG_PARS_F)
      .replace('#include <fog_fragment>', FOG_F)
      .replace('#include <lights_fragment_end>', CLOUD_SHADOW_F);
    if (extra) extra(shader);
  };
  return mat;
}

// ---------------------------------------------------------------------------- sun
// Low-precision solar ephemeris (Astronomical Almanac), good to ~0.1°.
export function solarPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * rad - ra;
  const phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { el, az: (az + 2 * Math.PI) % (2 * Math.PI) };
}

// Approximate colour of direct sunlight after passing through the atmosphere.
function sunlightColor(el) {
  const e = Math.max(el, 0) * 180 / Math.PI;
  const t = THREE.MathUtils.smoothstep(e, 0, 35);
  return new THREE.Color().setRGB(1.0, 0.55 + 0.4 * t, 0.28 + 0.62 * t);
}

export class Atmosphere {
  constructor(renderer, scene, lat, lon) {
    this.renderer = renderer; this.scene = scene; this.lat = lat; this.lon = lon;
    this.sky = new Sky();
    this.sky.scale.setScalar(900000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.1;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.86;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.00004;
    scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0x8fa8d8, 0);
    scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3b4a2a, 0.0);
    scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'])
      this.envSky.material.uniforms[k].value = u[k].value;
    this.envScene.add(this.envSky);
    this.envRT = null;
    this.lastEnvDir = new THREE.Vector3(0, -1, 0);

    this.stars = makeStars();
    scene.add(this.stars);
    this.sunDir = new THREE.Vector3();
  }

  setTime(date) {
    const { el, az } = solarPosition(date, this.lat, this.lon);
    this.elevation = el; this.azimuth = az;
    const d = this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    env.uSunDir.value.copy(d);
    this.sky.material.uniforms.sunPosition.value.copy(d);
    this.envSky.material.uniforms.sunPosition.value.copy(d);

    const day = THREE.MathUtils.smoothstep(Math.sin(el), -0.05, 0.12);
    const night = 1 - THREE.MathUtils.smoothstep(Math.sin(el), -0.2, 0.0);
    env.uNight.value = night;
    const sc = sunlightColor(el);
    env.uSunColor.value.copy(sc);
    this.sun.color.copy(sc);
    this.sun.intensity = 4.2 * day;
    this.sun.castShadow = day > 0.01;

    // Moonlight + faint skyglow keep the night scene readable.
    this.moon.intensity = 0.35 * night;
    this.hemi.intensity = 0.05 + 0.45 * night;
    this.hemi.color.setRGB(0.55 + 0.45 * day, 0.62 + 0.38 * day, 0.85 + 0.15 * day);

    // Haze colour follows the sky near the horizon.
    const dusk = THREE.MathUtils.smoothstep(1 - Math.abs(Math.sin(el)), 0.85, 1.0) * day;
    const fog = new THREE.Color(0.66, 0.74, 0.86).lerp(new THREE.Color(0.86, 0.66, 0.52), dusk * 0.7);
    fog.lerp(new THREE.Color(0.035, 0.045, 0.075), night);
    fog.multiplyScalar(0.25 + 0.75 * Math.max(day, 0.05) + 0.0);
    env.uFogColor.value.copy(fog);

    this.stars.material.opacity = night;
    this.stars.visible = night > 0.01;
    this.renderer.toneMappingExposure = 0.62 + 0.6 * night;

    if (this.lastEnvDir.distanceTo(d) > 0.01) {
      this.lastEnvDir.copy(d);
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.16 * day + 0.03;
    }
  }

  // Keep the shadow frustum fitted around what the camera is looking at.
  updateShadow(target, viewDist) {
    const size = THREE.MathUtils.clamp(viewDist * 1.2, 600, 14000);
    const cam = this.sun.shadow.camera;
    cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size;
    cam.near = 5000; cam.far = 45000;
    cam.updateProjectionMatrix();
    const dir = this.sunDir.y > 0.02 ? this.sunDir : new THREE.Vector3(0, 1, 0);
    // Snap to shadow texels so shadows don't shimmer while panning.
    const texel = (2 * size) / this.sun.shadow.mapSize.x;
    const t = target.clone();
    t.x = Math.round(t.x / texel) * texel; t.z = Math.round(t.z / texel) * texel;
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(dir, 25000);
    this.sun.shadow.normalBias = texel * 1.2;
    this.moon.target.position.copy(t);
    this.moon.position.copy(t).add(new THREE.Vector3(-0.4, 0.8, 0.3).multiplyScalar(20000));
  }
}

function makeStars() {
  const r = rng(7), n = 4000, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const y = Math.abs(u);
    p.set([s * Math.cos(th) * 400000, y * 400000, s * Math.sin(th) * 400000], i * 3);
    const b = 0.4 + r() * 0.6;
    c.set([b, b, b * (0.9 + r() * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  return pts;
}

// ---------------------------------------------------------------------------- clouds
function puffTexture() {
  // Soft cauliflower puff: a radial falloff eroded by value-noise fbm.
  const s = 256, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(s, s);
  const r = rng(11), G = 16, grid = Array.from({ length: (G + 1) * (G + 1) }, r);
  const vn = (x, y) => {
    const xi = Math.floor(x) % G, yi = Math.floor(y) % G, fx = x - Math.floor(x), fy = y - Math.floor(y);
    const g = (i, j) => grid[(j % G) * (G + 1) + (i % G)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (g(xi, yi) * (1 - sx) + g(xi + 1, yi) * sx) * (1 - sy) + (g(xi, yi + 1) * (1 - sx) + g(xi + 1, yi + 1) * sx) * sy;
  };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s * 2 - 1, v = y / s * 2 - 1;
    const d = Math.sqrt(u * u + v * v);
    let n = 0, a = 0.5, f = 4;
    for (let o = 0; o < 4; o++) { n += a * vn(x / s * f, y / s * f); a *= 0.5; f *= 2; }
    const m = Math.max(0, 1 - d) ** 1.4 * (0.55 + 0.9 * n) - 0.18;
    const alpha = Math.max(0, Math.min(1, m * 1.6));
    const i = (y * s + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Clouds {
  constructor(scene, count = 46, domain = 70000) {
    this.domain = domain;
    const r = rng(2024);
    const clusters = [];
    const offs = [], sizes = [], clus = [], seeds = [];
    for (let c = 0; c < count; c++) {
      const cx = (r() - 0.5) * domain, cz = (r() - 0.5) * domain;
      const cy = 3300 + r() * 900;
      const rad = 700 + r() * 1300;
      clusters.push(new THREE.Vector4(cx, cy, cz, rad));
      const puffs = 14 + Math.floor(r() * 18);
      for (let i = 0; i < puffs; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        const h = Math.pow(r(), 1.6) * rad * 0.7;
        offs.push(cx + Math.cos(a) * d, cy + h, cz + Math.sin(a) * d * 0.7);
        sizes.push((0.45 + r() * 0.4) * rad * (1.2 - 0.5 * h / rad));
        clus.push(cx, cy, cz, rad);
        seeds.push(r());
      }
    }
    // Lay the vertical tower of each cumulus behind its flat base.
    this.clusters = clusters;
    this.puffsPerCluster = [];
    const geo = new THREE.InstancedBufferGeometry();
    geo.copy(new THREE.PlaneGeometry(1, 1));
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offs), 3));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1));
    geo.setAttribute('aCluster', new THREE.InstancedBufferAttribute(new Float32Array(clus), 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    geo.instanceCount = sizes.length;
    this.total = sizes.length;
    this.uniforms = {
      ...env,
      map: { value: puffTexture() },
      uOrigin: { value: new THREE.Vector2() },
      uDrift: { value: new THREE.Vector2() },
      uDomain: { value: domain },
      uOpacity: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec3 aOffset; attribute float aSize; attribute vec4 aCluster; attribute float aSeed;
        uniform vec2 uOrigin; uniform vec2 uDrift; uniform float uDomain; uniform vec3 uSunDir;
        varying vec2 vUv; varying float vLight; varying vec3 vFogWorld; varying float vFade; varying float vSeed;
        void main() {
          vec2 cc = aCluster.xz + uDrift;
          vec2 wrapped = mod(cc - uOrigin + 0.5 * uDomain, uDomain) - 0.5 * uDomain + uOrigin;
          vec3 center = vec3(wrapped.x, aCluster.y, wrapped.y);
          vec3 puff = center + (aOffset - aCluster.xyz);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float rot = aSeed * 6.2831;
          vec2 p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
          vec3 wp = puff + (right * p.x + up * p.y) * aSize;
          vec3 n = normalize(puff - center + (right * position.x + up * position.y) * aSize * 0.8 + vec3(0.0, aCluster.w * 0.15, 0.0));
          float h = clamp((puff.y - aCluster.y) / aCluster.w, 0.0, 1.0);
          vLight = clamp(0.55 + 0.55 * dot(n, uSunDir), 0.0, 1.0) * (0.55 + 0.45 * h);
          vUv = uv; vFogWorld = wp; vSeed = aSeed;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vFade = smoothstep(300.0, 2500.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float uOpacity; uniform float uNight;
        varying vec2 vUv; varying float vLight; varying float vFade; varying float vSeed;
        ${FOG_PARS_F}
        void main() {
          float a = texture2D(map, vUv).a;
          if (a < 0.01) discard;
          vec3 shade = mix(vec3(0.6, 0.65, 0.74), vec3(1.0), vLight);
          vec3 col = shade * mix(uSunColor * 1.35 + 0.15, vec3(0.06, 0.07, 0.1), uNight);
          col = applyAerial(col, vFogWorld);
          gl_FragColor = vec4(col, clamp(a * 0.85, 0.0, 1.0) * vFade * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.drift = new THREE.Vector2();
    this.wind = new THREE.Vector2(6, -2); // m/s, westerlies
    this.setCoverage(0.5);
  }

  setCoverage(c) {
    this.coverage = c;
    // Instances are generated cluster by cluster, so a prefix keeps whole clouds.
    this.mesh.geometry.instanceCount = Math.round(this.total * c);
    this.mesh.visible = c > 0.01;
    this.activeClusters = Math.round(this.clusters.length * c);
  }

  update(dt, origin) {
    this.drift.addScaledVector(this.wind, dt);
    this.uniforms.uDrift.value.copy(this.drift);
    this.uniforms.uOrigin.value.set(origin.x, origin.z);
    // Feed the clouds nearest the view to the ground-shadow uniform.
    const D = this.domain, list = [];
    for (let i = 0; i < this.activeClusters; i++) {
      const c = this.clusters[i];
      let x = c.x + this.drift.x, z = c.z + this.drift.y;
      x = ((x - origin.x + 0.5 * D) % D + D) % D - 0.5 * D + origin.x;
      z = ((z - origin.z + 0.5 * D) % D + D) % D - 0.5 * D + origin.z;
      list.push({ x, y: c.y, z, w: c.w * 0.9, d: (x - origin.x) ** 2 + (z - origin.z) ** 2 });
    }
    list.sort((a, b) => a.d - b.d);
    const u = env.uClouds.value;
    for (let i = 0; i < u.length; i++) {
      const c = list[i];
      if (c) u[i].set(c.x, c.y, c.z, c.w); else u[i].set(0, -1e5, 0, 1);
    }
  }
}
