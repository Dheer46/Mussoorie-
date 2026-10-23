import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Geo, formatLatLon } from './geo.js';
import { Atmosphere, Clouds, env } from './atmosphere.js';
import { buildTerrain } from './terrain.js';
import { parseBuildings, buildBuildings } from './buildings.js';
import { buildRoads, buildWater, buildWaterfall, highlightRoads } from './roads.js';
import { Forest } from './vegetation.js';
import { LandmarkLayer, LANDMARKS } from './landmarks.js';
import { HdImagery } from './hdimagery.js';

const $ = (s) => document.querySelector(s);
const DATA = 'data/';
const QUALITY = {
  low: { dpr: 1, shadow: 2048, trees: 30000, treeShadows: false },
  high: { dpr: 1.5, shadow: 4096, trees: 90000, treeShadows: true },
  ultra: { dpr: 2, shadow: 4096, trees: 140000, treeShadows: true },
};

// ------------------------------------------------------------------ loading
const progress = (pct, msg) => {
  $('#load-bar').style.width = `${pct}%`;
  if (msg) $('#load-msg').textContent = msg;
};

async function fetchBuf(name) {
  const r = await fetch(DATA + name);
  if (r.ok) return r.arrayBuffer();
  // Hosts that won't serve raw binary get a base64 copy (<name>.txt).
  const t = await fetch(DATA + name + '.txt');
  if (!t.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const bin = atob((await t.text()).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function loadImage(name) {
  const img = new Image();
  img.src = DATA + name;
  await img.decode();
  return img;
}

function pixels(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function main() {
  progress(3, 'Loading elevation models…');
  const meta = await (await fetch(DATA + 'meta.json')).json();
  const [demBuf, farBuf] = await Promise.all([fetchBuf('dem.bin'), fetchBuf('far_dem.bin')]);
  const geo = new Geo(meta, new Uint16Array(demBuf), new Uint16Array(farBuf));
  progress(15, 'Loading Sentinel-2 imagery…');
  const [satImg, farImg, forestImg] = await Promise.all([loadImage('satellite.jpg'), loadImage('far_satellite.jpg'), loadImage('forest.png')]);
  progress(30, 'Loading OpenStreetMap buildings, roads and water…');
  const [bldBuf, roads, water] = await Promise.all([
    fetchBuf('buildings.bin'), fetch(DATA + 'roads.json').then((r) => r.json()), fetch(DATA + 'water.json').then((r) => r.json()),
  ]);

  // ---------------------------------------------------------------- renderer
  let quality = 'high';
  try { quality = localStorage.getItem('quality') || 'high'; } catch { /* storage unavailable */ }
  if (!QUALITY[quality]) quality = 'high';
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[quality].dpr));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  $('#view').appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.setSize(innerWidth, innerHeight);
  labels.domElement.className = 'labels';
  $('#view').appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0); // enables USE_FOG; the actual model is in atmosphere.js
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 5, 600000);

  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (img) => {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.needsUpdate = true;
    return t;
  };

  const atmos = new Atmosphere(renderer, scene, 30.455, 78.1);
  atmos.sun.shadow.mapSize.setScalar(QUALITY[quality].shadow);

  progress(40, 'Building terrain mesh (Copernicus GLO-30)…'); await nextFrame();
  const terrain = buildTerrain(geo, { near: tex(satImg), far: tex(farImg) }, scene);

  progress(55, `Extruding ${new Uint32Array(bldBuf, 0, 1)[0].toLocaleString()} buildings…`); await nextFrame();
  const satPx = pixels(satImg);
  const buildings = buildBuildings(geo, parseBuildings(bldBuf), satPx, scene);

  progress(75, 'Draping roads, streams and Mussoorie Lake…'); await nextFrame();
  const roadGroup = buildRoads(geo, roads, scene);
  const waterGroup = buildWater(geo, water, scene);
  const falls = new THREE.Group();
  for (const lm of LANDMARKS.filter((l) => l.fall)) {
    const { x, z } = geo.toLocal(lm.lon, lm.lat);
    falls.add(buildWaterfall(geo, x, z, falls, env));
  }
  scene.add(falls);

  progress(85, 'Planting deodar, chir pine, oak and sal forests…'); await nextFrame();
  const forest = new Forest(geo, pixels(forestImg), scene, QUALITY.ultra.trees);
  forest.budget = QUALITY[quality].trees;
  const setTreeShadows = (v) => forest.meshes.forEach((m) => { m.castShadow = v; });
  setTreeShadows(QUALITY[quality].treeShadows);

  progress(92, 'Sky, sun and clouds…'); await nextFrame();
  const clouds = new Clouds(scene);
  const hd = new HdImagery(geo, renderer);
  hd.onError = () => {
    toast('High-resolution imagery could not be streamed (offline or blocked). Showing the Sentinel-2 10 m mosaic instead.');
    $('#t-hd').checked = false; hd.setEnabled(false);
  };

  // ---------------------------------------------------------------- controls
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 120;
  controls.maxDistance = 140000;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
  controls.zoomToCursor = true;
  controls.listenToKeyEvents(window);
  controls.keyPanSpeed = 25;

  const home = geo.toLocal(78.0745, 30.4575);
  const HOME = { target: new THREE.Vector3(home.x, geo.height(home.x, home.z), home.z), dist: 9500, polar: 51, azim: -22 };
  const placeCamera = (target, dist, polarDeg, azimDeg) => {
    const s = new THREE.Spherical(dist, THREE.MathUtils.degToRad(polarDeg), THREE.MathUtils.degToRad(azimDeg));
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(s));
    controls.target.copy(target);
  };
  placeCamera(HOME.target, 46000, 62, -40);

  // Smooth camera flights between views.
  let flight = null;
  const flyTo = (target, dist, polarDeg, azimDeg, dur = 2.6) => {
    const off = camera.position.clone().sub(controls.target);
    const from = new THREE.Spherical().setFromVector3(off);
    const toAz = azimDeg === undefined ? from.theta : THREE.MathUtils.degToRad(azimDeg);
    let dAz = toAz - from.theta;
    dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
    flight = {
      t: 0, dur, t0: controls.target.clone(), t1: target.clone(),
      r0: from.radius, r1: dist, p0: from.phi, p1: THREE.MathUtils.degToRad(polarDeg ?? 52), a0: from.theta, a1: from.theta + dAz,
    };
  };
  const stepFlight = (dt) => {
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / flight.dur);
    const e = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
    // Rise in a gentle arc when travelling far.
    const hop = Math.sin(Math.PI * e) * Math.min(flight.t0.distanceTo(flight.t1) * 0.35, 6000);
    const tgt = flight.t0.clone().lerp(flight.t1, e);
    const r = THREE.MathUtils.lerp(flight.r0, flight.r1, e) + hop;
    const s = new THREE.Spherical(r, THREE.MathUtils.lerp(flight.p0, flight.p1, e), THREE.MathUtils.lerp(flight.a0, flight.a1, e));
    controls.target.copy(tgt);
    camera.position.copy(tgt).add(new THREE.Vector3().setFromSpherical(s));
    if (flight.t >= 1) flight = null;
  };
  controls.addEventListener('start', () => { flight = null; });

  // ---------------------------------------------------------------- landmarks & UI
  let highlight = null;
  const panel = $('#info');
  const select = (lm, fly = true) => {
    layer.setActive(lm);
    if (highlight) { scene.remove(highlight); highlight.geometry.dispose(); highlight = null; }
    if (lm.roads) { highlight = highlightRoads(geo, roads, lm.roads); if (highlight) scene.add(highlight); }
    $('#info-cat').textContent = lm.cat;
    $('#info-name').textContent = lm.name;
    $('#info-text').textContent = lm.text;
    $('#info-elev').textContent = `${Math.round(lm.elev).toLocaleString('en-IN')} m`;
    $('#info-coord').textContent = formatLatLon(lm.lat, lm.lon);
    panel.classList.add('open');
    document.querySelectorAll('#lm-list li').forEach((li) => li.classList.toggle('active', li.dataset.id === lm.id));
    if (fly) {
      let target = lm.pos.clone();
      if (lm.roads && highlight) { // frame the whole route
        highlight.geometry.computeBoundingBox();
        const bb = highlight.geometry.boundingBox; target = bb.getCenter(new THREE.Vector3());
        target.y = geo.height(target.x, target.z);
      }
      flyTo(target, lm.dist || 1800, 50);
    }
    history.replaceState(null, '', `#${lm.id}`);
  };
  const layer = new LandmarkLayer(geo, scene, select);
  $('#info-close').onclick = () => {
    panel.classList.remove('open'); layer.setActive(null);
    if (highlight) { scene.remove(highlight); highlight = null; }
    history.replaceState(null, '', location.pathname);
  };

  const list = $('#lm-list');
  for (const lm of LANDMARKS) {
    const li = document.createElement('li');
    li.dataset.id = lm.id;
    li.innerHTML = `<span class="li-name">${lm.name}</span><span class="li-cat">${lm.cat} · ${Math.round(lm.elev)} m</span>`;
    li.onclick = () => select(lm);
    list.appendChild(li);
  }
  $('#lm-search').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    list.querySelectorAll('li').forEach((li) => { li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  };
  $('#sidebar-toggle').onclick = () => document.body.classList.toggle('sidebar-hidden');
  if (innerWidth < 760) document.body.classList.add('sidebar-hidden');

  // Time of day (IST) and date.
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 3600e3);
  $('#date').value = istNow.toISOString().slice(0, 10);
  $('#time').value = 630; // 10:30 IST
  let timePlaying = false;
  const updateTime = () => {
    const mins = +$('#time').value;
    const [y, m, d] = $('#date').value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 0, 0) + (mins - 330) * 60e3);
    $('#time-label').textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')} IST`;
    atmos.setTime(date);
    const deg = (r) => (r * 180 / Math.PI).toFixed(0);
    $('#sun-label').textContent = `Sun ${deg(atmos.elevation)}° alt · ${deg(atmos.azimuth)}° az`;
  };
  $('#time').oninput = updateTime;
  $('#date').onchange = updateTime;
  $('#time-play').onclick = () => {
    timePlaying = !timePlaying;
    $('#time-play').textContent = timePlaying ? '❚❚' : '▶';
  };
  $('#time-now').onclick = () => {
    const n = new Date(Date.now() + 5.5 * 3600e3);
    $('#date').value = n.toISOString().slice(0, 10);
    $('#time').value = n.getUTCHours() * 60 + n.getUTCMinutes();
    updateTime();
  };
  updateTime();

  $('#clouds').oninput = (e) => clouds.setCoverage(+e.target.value);
  clouds.setCoverage(+$('#clouds').value);
  const bindToggle = (id, fn) => { const el = $(id); el.onchange = () => fn(el.checked); fn(el.checked); };
  bindToggle('#t-buildings', (v) => { buildings.group.visible = v; });
  bindToggle('#t-roads', (v) => { roadGroup.visible = v; });
  bindToggle('#t-forest', (v) => { forest.visible = v; forest.update(controls.target, 0, true); });
  bindToggle('#t-labels', (v) => { layer.setVisible(v); labels.domElement.style.display = v ? '' : 'none'; });
  bindToggle('#t-water', (v) => { waterGroup.visible = v; falls.visible = v; });
  bindToggle('#t-hd', (v) => hd.setEnabled(v));
  $('#quality').value = quality;
  $('#quality').onchange = (e) => {
    quality = e.target.value;
    try { localStorage.setItem('quality', quality); } catch { /* storage unavailable */ }
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
    atmos.sun.shadow.mapSize.setScalar(q.shadow);
    if (atmos.sun.shadow.map) { atmos.sun.shadow.map.dispose(); atmos.sun.shadow.map = null; }
    forest.budget = q.trees; setTreeShadows(q.treeShadows);
    forest.update(controls.target, camera.position.distanceTo(controls.target), true);
  };
  $('#reset').onclick = () => flyTo(HOME.target, HOME.dist, HOME.polar, HOME.azim, 3);
  $('#compass').onclick = () => flyTo(controls.target, camera.position.distanceTo(controls.target), THREE.MathUtils.radToDeg(new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)).phi), 0, 1.4);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 6000);
  }

  // ---------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // March the view ray against the heightmap (much cheaper than mesh raycasting).
  const pickGround = (cx, cy) => {
    ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0, prev = 0, step = 20;
    for (let i = 0; i < 2000 && t < 250000; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < geo.height(x, z)) {
        let a = prev, b = t;
        for (let k = 0; k < 24; k++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m < geo.height(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m;
        }
        return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
      prev = t; t += step; step = Math.min(step * 1.04, 400);
    }
    return null;
  };
  let hoverAt = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (performance.now() - hoverAt < 60) return;
    hoverAt = performance.now();
    const p = pickGround(e.clientX, e.clientY);
    if (!p) { $('#readout').textContent = '—'; return; }
    const { lon, lat } = geo.toLonLat(p.x, p.z);
    $('#readout').textContent = `${formatLatLon(lat, lon)}   ${Math.round(geo.elevation(p.x, p.z)).toLocaleString('en-IN')} m`;
  });
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('dblclick', (e) => {
    const p = pickGround(e.clientX, e.clientY);
    if (p) flyTo(p, Math.max(camera.position.distanceTo(controls.target) * 0.45, 400), undefined, undefined, 1.4);
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const p = pickGround(e.clientX, e.clientY);
    if (!p) return;
    const { lon, lat } = geo.toLonLat(p.x, p.z);
    let near = null, nd = Infinity;
    for (const lm of LANDMARKS) { const d = lm.pos.distanceTo(p); if (d < nd) { nd = d; near = lm; } }
    toast(`${formatLatLon(lat, lon)} · ${Math.round(geo.elevation(p.x, p.z))} m above sea level · ${(nd / 1000).toFixed(1)} km from ${near.name}`);
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
  });

  // ---------------------------------------------------------------- loop
  progress(100, 'Ready');
  const timer = new THREE.Timer();
  timer.connect(document);
  let labelAt = 0, hdAt = 0;
  const startHash = location.hash.slice(1);
  const startLm = LANDMARKS.find((l) => l.id === startHash);
  if (startLm) { select(startLm, false); flyTo(startLm.pos, startLm.dist || 1800, 50, -22, 4.5); }
  else flyTo(HOME.target, HOME.dist, HOME.polar, HOME.azim, 4.5);

  const tmp = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    env.uTime.value += dt;
    if (timePlaying) {
      let t = +$('#time').value + dt * 40;
      if (t > 1439) t = 0;
      $('#time').value = t; updateTime();
    }
    stepFlight(dt);
    controls.update(dt);
    // Keep the pivot on the ground and the camera above it.
    controls.target.y = THREE.MathUtils.lerp(controls.target.y, geo.height(controls.target.x, controls.target.z), 0.2);
    const ground = geo.height(camera.position.x, camera.position.z);
    if (camera.position.y < ground + 25) camera.position.y = ground + 25;
    const camDist = camera.position.distanceTo(controls.target);
    const alt = camera.position.y - ground;
    camera.near = THREE.MathUtils.clamp(Math.min(alt, camDist) * 0.2, 2, 800);
    camera.updateProjectionMatrix();

    atmos.updateShadow(controls.target, camDist);
    clouds.update(dt, controls.target);
    forest.update(controls.target, camDist);
    if (performance.now() - hdAt > 250) { hdAt = performance.now(); hd.update(controls.target, camDist); }
    if (performance.now() - labelAt > 200) { labelAt = performance.now(); layer.updateVisibility(camera, camDist); }

    const az = new THREE.Spherical().setFromVector3(tmp.copy(camera.position).sub(controls.target)).theta;
    $('#compass-needle').style.transform = `rotate(${THREE.MathUtils.radToDeg(az)}deg)`;
    const span = 2 * camDist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / innerHeight * 120;
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].find((v) => v >= span * 0.6) || 20000;
    $('#scale-bar').style.width = `${(nice / span) * 120}px`;
    $('#scale-label').textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;

    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  window.__mussoorie = { THREE, scene, camera, controls, geo, select, flyTo, atmos, clouds, forest, hd, renderer };
  $('#loader').classList.add('done');
  $('#stats').textContent = `${buildings.count.toLocaleString('en-IN')} buildings · ${roads.length.toLocaleString('en-IN')} road segments`;
}

main().catch((e) => {
  console.error(e);
  $('#load-msg').textContent = `Failed to load: ${e.message}. Serve the "public" folder over HTTP (see README).`;
  $('#loader').classList.add('error');
});
