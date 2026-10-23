// Landmarks, neighbourhood names and the Himalayan peaks on the horizon.
// Positions come from OpenStreetMap / Overture Maps POIs and road geometry
// (cross-checked against the DEM); peak labels snap to the DEM summit.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const LANDMARKS = [
  {
    id: 'mall-road', top: true, name: 'Mall Road', cat: 'Promenade', lat: 30.4573, lon: 78.0735, roads: ['Mall Road'], dist: 2200,
    text: 'The 2 km ridge-top promenade between Library Chowk (Gandhi Chowk) in the west and Picture Palace / Kulri in the east. Laid out in the 19th century, it is lined with shops, cafés, hotels and the lower station of the Gun Hill ropeway. Vehicle access is restricted for much of the day.',
  },
  {
    id: 'gun-hill', top: true, name: 'Gun Hill', cat: 'Viewpoint', lat: 30.4597, lon: 78.0739, dist: 1300,
    text: 'The second-highest summit in Mussoorie, rising directly above Mall Road. Its name comes from a cannon that was fired here every day at noon in the colonial era so residents could set their watches. A ropeway climbs about 400 m from Mall Road to the top.',
  },
  {
    id: 'landour', top: true, name: 'Landour', cat: 'Cantonment town', lat: 30.4610, lon: 78.0951, dist: 2400,
    text: 'The small cantonment town above Mussoorie, founded in 1827 as a sanatorium for British soldiers. Its quiet deodar-shaded lanes include Char Dukan, Sisters Bazaar, Kellogg Church (home of the Landour Language School) and the Landour clock tower, and it is the long-time home of the writer Ruskin Bond.',
  },
  {
    id: 'lal-tibba', name: 'Lal Tibba', cat: 'Viewpoint', lat: 30.4630, lon: 78.0957, dist: 1200,
    text: 'The highest point of Landour, and of Mussoorie. On clear days the telescopes at the viewpoint look north across the Aglar valley to the snow peaks of the Greater Himalaya, including Bandarpunch, the Kedarnath group and the Gangotri group.',
  },
  {
    id: 'company-garden', top: true, name: 'Company Garden', cat: 'Garden', lat: 30.4609, lon: 78.0520, dist: 1200,
    text: 'A 19th-century botanical garden from the East India Company era, now a municipal park with flower beds, a small artificial lake and a waterfall. It lies just north of Happy Valley on the road to Kempty Falls.',
  },
  {
    id: 'kempty-falls', top: true, name: 'Kempty Falls', cat: 'Waterfall', lat: 30.4880, lon: 78.0367, dist: 1400, fall: true,
    text: 'A cascade in the Ringali Gad gorge on the Mussoorie–Chakrata road, about 13 km by road north-west of Mussoorie. The name is popularly said to come from "camp tea", the picnics British officers held here. It was developed as a resort after 1835.',
  },
  {
    id: 'mussoorie-lake', name: 'Mussoorie Lake', cat: 'Lake', lat: 30.4464, lon: 78.0780, dist: 1000,
    text: 'A small artificial lake on the Dehradun road just below the town, built by the City Board and the Mussoorie Dehradun Development Authority. It offers paddle boating and views over the Doon valley. The outline here is the OpenStreetMap water polygon.',
  },
  {
    id: 'camels-back', name: "Camel's Back Road", cat: 'Heritage walk', lat: 30.4601, lon: 78.0769, roads: ['Camels Back Road'], dist: 1700,
    text: 'A roughly 3 km road that loops around the north side of Gun Hill from Library to Kulri. It is named after a rock outcrop shaped like a camel\'s hump, and the old British cemetery lies along it. It is a favourite walk at sunset.',
  },
  {
    id: 'library', top: true, name: 'Library Bazaar', cat: 'Market', lat: 30.4598, lon: 78.0644, dist: 1000,
    text: 'The western end of Mall Road at Gandhi Chowk, named after the Mussoorie Library of 1843. It is a busy junction of shops and hotels, with the bus stand, Spring Road and the roads to Happy Valley and Kempty.',
  },
  {
    id: 'picture-palace', name: 'Picture Palace', cat: 'Market', lat: 30.4550, lon: 78.0819, dist: 1000,
    text: 'The eastern end of Mall Road at Kulri, named after the old cinema hall. From here the road climbs to Landour and the clock tower, and the Mussoorie bypass leads towards Dhanaulti.',
  },
  {
    id: 'clouds-end', name: "Cloud's End", cat: 'Heritage estate', lat: 30.4672, lon: 78.0078, dist: 1500,
    text: 'The far western end of the Mussoorie ridge, where a bungalow built in 1838 still stands among dense banj oak and deodar forest. It is now a heritage resort and the start of forest walks towards the Benog Wildlife Sanctuary.',
  },
  {
    id: 'everest-house', name: 'George Everest House', cat: 'Heritage site', lat: 30.4587, lon: 78.0235, dist: 1500,
    text: 'Park Estate on the Hathipaon ridge: the house and observatory of Sir George Everest, Surveyor General of India from 1830 to 1843, who lived here while directing the Great Trigonometrical Survey. It has been restored, and its open ridge-top lawn looks over both the Doon and the Aglar valleys.',
  },
  {
    id: 'jharipani-falls', name: 'Jharipani Falls', cat: 'Waterfall', lat: 30.4275, lon: 78.0939, dist: 1300, fall: true,
    text: 'A waterfall below Jharipani village on the old Rajpur–Jharipani–Mussoorie road. It is reached by a short walk from the road.',
  },
  {
    id: 'bhatta-falls', name: 'Bhatta Falls', cat: 'Waterfall', lat: 30.4378, lon: 78.0730, dist: 1300, fall: true,
    text: 'A waterfall near Bhatta village on the Dehradun–Mussoorie road, about 7 km below the town. A ropeway runs from the main road down to the falls.',
  },
  {
    id: 'dhanaulti', name: 'Dhanaulti Road', cat: 'Mountain route', lat: 30.4240, lon: 78.2465, roads: ['Tehri Rd', 'Mussoori Road', 'Mussoori-Chamba Road'], dist: 9000,
    text: 'The Mussoorie–Dhanaulti–Chamba road, about 25 km to Dhanaulti. It runs east from Landour along the ridge through Suakholi to the deodar-forested saddle of Dhanaulti, known for its Eco Parks, and continues towards Surkanda Devi and Chamba.',
  },
  {
    id: 'kulri', name: 'Kulri Bazaar', cat: 'Market', lat: 30.4556, lon: 78.0802, dist: 900, minor: true,
    text: 'The busy eastern bazaar of Mall Road, around Picture Palace and the Mussoorie Cart Road.',
  },
  {
    id: 'clock-tower', name: 'Landour Clock Tower', cat: 'Landmark', lat: 30.4554, lon: 78.0868, dist: 900, minor: true,
    text: 'The clock tower marks the start of the Landour Bazaar. From here a steep road climbs to Char Dukan and Sisters Bazaar.',
  },
  {
    id: 'sisters-bazaar', name: 'Sisters Bazaar', cat: 'Market', lat: 30.4573, lon: 78.1028, dist: 900, minor: true,
    text: 'A tiny bazaar on the Landour loop, named after the nursing sisters of the old military hospital. It is famous for its homemade jams and cheeses.',
  },
];

export const AREAS = [
  ['Kulri', 30.4545, 78.0790], ['Happy Valley', 30.4690, 78.0545], ['Barlowganj', 30.4405, 78.0870],
  ['Jharipani', 30.4235, 78.0850], ['Hathipaon', 30.4560, 78.0180], ['Kempty', 30.4905, 78.0440],
  ['Bhatta', 30.4345, 78.0775], ['Kyarkuli', 30.4428, 78.0700], ['Dhanaulti', 30.4255, 78.2440],
  ['Rajpur · Dehradun', 30.3880, 78.0930], ['Doon Valley', 30.33, 78.02], ['Aglar Valley', 30.51, 78.10],
];

// Real summit heights for the label; the marker is placed on the DEM summit nearby.
export const PEAKS = [
  ['Bandarpunch', 6316, 31.008, 78.553, 4000], ['Swargarohini', 6252, 31.088, 78.513, 4000],
  ['Kedarnath', 6940, 30.796, 79.068, 4000], ['Nag Tibba', 3022, 30.585, 78.145, 3000],
  ['Surkanda Devi', 2756, 30.411, 78.289, 1500],
];

function el(cls, html) {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}

export class LandmarkLayer {
  constructor(geo, scene, onSelect) {
    this.geo = geo;
    this.group = new THREE.Group();
    this.group.name = 'labels';
    scene.add(this.group);
    this.items = [];

    for (const lm of LANDMARKS) {
      const { x, z } = geo.toLocal(lm.lon, lm.lat);
      lm.pos = new THREE.Vector3(x, geo.height(x, z), z);
      lm.elev = geo.elevation(x, z);
      const div = el(`lm${lm.minor ? ' minor' : ''}`, `<div class="lm-card"><span class="lm-dot"></span><span class="lm-name">${lm.name}</span></div><div class="lm-stem"></div>`);
      div.addEventListener('pointerdown', (e) => e.stopPropagation());
      div.addEventListener('click', (e) => { e.stopPropagation(); onSelect(lm); });
      const obj = new CSS2DObject(div);
      obj.center.set(0.5, 1);
      obj.position.copy(lm.pos);
      this.group.add(obj);
      this.items.push({ obj, div, pos: lm.pos, kind: lm.minor ? 'minor' : 'major', lm });
    }
    for (const [name, lat, lon] of AREAS) {
      const { x, z } = geo.toLocal(lon, lat);
      const div = el('area-label', name);
      const obj = new CSS2DObject(div);
      obj.position.set(x, geo.height(x, z) + 30, z);
      this.group.add(obj);
      this.items.push({ obj, div, pos: obj.position, kind: 'area' });
    }
    for (const [name, h, lat, lon, r] of PEAKS) {
      const p = this.snapSummit(lon, lat, r);
      const div = el('peak-label', `<span class="peak-tri">▲</span>${name}<small>${h.toLocaleString('en-IN')} m</small>`);
      const obj = new CSS2DObject(div);
      obj.center.set(0.5, 1);
      obj.position.copy(p);
      this.group.add(obj);
      this.items.push({ obj, div, pos: p, kind: 'peak' });
    }
  }

  snapSummit(lon, lat, r) {
    const g = this.geo, c = g.toLocal(lon, lat);
    let best = c, bh = -1;
    for (let dx = -r; dx <= r; dx += r / 20) for (let dz = -r; dz <= r; dz += r / 20) {
      const h = g.elevation(c.x + dx, c.z + dz);
      if (h > bh) { bh = h; best = { x: c.x + dx, z: c.z + dz }; }
    }
    return new THREE.Vector3(best.x, g.height(best.x, best.z) + 20, best.z);
  }

  // Hide labels that are behind a ridge (ray-marched against the heightmap), too far,
  // or that would overlap a more important label on screen.
  updateVisibility(camera, camDist, w, h) {
    const cam = camera.position, g = this.geo;
    const small = w < 760;
    const placed = [];
    const cand = [];
    const v = new THREE.Vector3();
    for (const it of this.items) {
      const d = cam.distanceTo(it.pos);
      let show = true;
      if (it.kind === 'minor') show = camDist < (small ? 2500 : 4500);
      else if (it.kind === 'area') show = camDist < (small ? 12000 : 16000) && d < 30000;
      else if (it.kind === 'major') show = d < 45000;
      if (show) {
        const steps = 40;
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const x = cam.x + (it.pos.x - cam.x) * t, y = cam.y + (it.pos.y + 15 - cam.y) * t, z = cam.z + (it.pos.z - cam.z) * t;
          if (g.height(x, z) > y + 2) { show = false; break; }
        }
      }
      if (show) {
        v.copy(it.pos).project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) show = false;
        else {
          const rank = it.div.classList.contains('active') ? 0 : it.lm?.top ? 1 : { major: 1.5, peak: 2, minor: 3, area: 4 }[it.kind];
          cand.push({ it, rank, d, sx: (v.x + 1) / 2 * w, sy: (1 - v.y) / 2 * h });
        }
      }
      if (!show) it.div.classList.add('hidden');
    }
    cand.sort((a, b) => a.rank - b.rank || a.d - b.d);
    for (const c of cand) {
      const el = c.it.div;
      // Measure the landmark card (not its stem) or the whole label; cache once laid out.
      const card = c.it.kind === 'major' || c.it.kind === 'minor' ? el.firstElementChild : el;
      if (!c.it.bw) { const r = card.getBoundingClientRect(); if (r.width) { c.it.bw = r.width; c.it.bh = r.height; c.it.stem = el.offsetHeight - r.height; } }
      const bw = c.it.bw || 80, bh = c.it.bh || 20;
      // Landmarks and peaks hang above their anchor; area names are centred on it.
      const bottom = c.it.kind === 'area' ? c.sy + bh / 2 : c.sy - (card === el ? 0 : c.it.stem || 0);
      const box = { x0: c.sx - bw / 2 - 3, x1: c.sx + bw / 2 + 3, y1: bottom + 3 };
      box.y0 = box.y1 - bh - 6;
      const clash = c.rank > 0 && placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
      const offscreen = box.x0 < 0 || box.x1 > w;
      const hide = clash || (offscreen && c.rank > 0);
      el.classList.toggle('hidden', hide);
      if (!hide) placed.push(box);
    }
  }

  setVisible(v) { this.group.visible = v; }

  setActive(lm) {
    for (const it of this.items) if (it.lm) it.div.classList.toggle('active', it.lm === lm);
  }
}
