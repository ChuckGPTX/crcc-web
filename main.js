import * as THREE from 'three';
import { OrbitControls } from '/vendor/OrbitControls.js';

const $ = s => document.querySelector(s);
const bar = $('#bar i');
let progress = 0;
const setProg = p => { progress = Math.max(progress, p); bar.style.width = (progress * 100) + '%'; };

// ---------------------------------------------------------------- renderer / scene
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const FOG = new THREE.Color(0xc4d6e6);
scene.fog = new THREE.FogExp2(FOG, 0.00042);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 8000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 3; controls.maxDistance = 2200;
controls.screenSpacePanning = false;

// sky dome
{
  const g = new THREE.SphereGeometry(5000, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x5b8fd0) }, mid: { value: new THREE.Color(0xa9c8e8) }, hor: { value: FOG } },
    vertexShader: 'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 p;uniform vec3 top,mid,hor;void main(){float h=clamp(p.y,0.,1.);vec3 c=mix(hor,mid,smoothstep(0.,.18,h));c=mix(c,top,smoothstep(.15,.85,h));gl_FragColor=vec4(c,1.);}'
  });
  const s = new THREE.Mesh(g, m); s.renderOrder = -1; scene.add(s);
  scene.userData.sky = s;
}
// lights (sun from the south-west, ~34° elevation, like the Blender scene)
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
{ const az = 235 * Math.PI / 180, el = 34 * Math.PI / 180;
  const d = 1000; sun.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, -Math.cos(az) * Math.cos(el) * d); }
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x66723f, 1.0));

// ---------------------------------------------------------------- data
const fetchJSON = u => fetch(u).then(r => r.json());
const fetchBuf = u => fetch(u).then(r => r.arrayBuffer());
const loadTex = u => new Promise((res, rej) => new THREE.TextureLoader().load(u, res, undefined, rej));
const [meta, hfBuf, treesBuf, blds, manual, cars, holes, cams, pins, gt, tex] = await Promise.all([
  fetchJSON('/data/meta.json'), fetchBuf('/data/hf.bin'), fetchBuf('/data/trees.bin'), fetchJSON('/data/buildings.json'),
  fetchJSON('/data/manual.json'), fetchJSON('/data/cars.json'), fetchJSON('/data/holes.json'), fetchJSON('/data/cams.json'),
  fetchJSON('/data/pins.json'), fetchJSON('/data/gt.json'), loadTex('/tex/terrain.jpg').catch(() => null)
]);
setProg(0.5);
const HF = new Uint16Array(hfBuf);
const NX = meta.nx, NY = meta.ny, STEP = meta.step, ZO = meta.ZO;
const hAt = (x, y) => { // elevation relative to ZO, bilinear
  let fx = (x - meta.x0) / STEP, fy = (y - meta.y0) / STEP;
  fx = Math.min(Math.max(fx, 0), NX - 1.001); fy = Math.min(Math.max(fy, 0), NY - 1.001);
  const i = fy | 0, j = fx | 0, a = fx - j, b = fy - i;
  const g = (ii, jj) => meta.zmin + HF[ii * NX + jj] / meta.zscale;
  return g(i, j) * (1 - a) * (1 - b) + g(i, j + 1) * a * (1 - b) + g(i + 1, j) * (1 - a) * b + g(i + 1, j + 1) * a * b - ZO;
};
const P = (x, y, z) => new THREE.Vector3(x, z, -y);   // local meters (x east, y north) -> three (y up)

// ---------------------------------------------------------------- terrain
{
  const S = 2;
  const cols = Math.floor((NX - 1) / S) + 1, rows = Math.floor((NY - 1) / S) + 1;
  const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
  const W = meta.x1 - meta.x0, H = meta.y1 - meta.y0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = meta.x0 + c * S * STEP, y = meta.y0 + r * S * STEP, k = r * cols + c;
    pos[k * 3] = x; pos[k * 3 + 1] = meta.zmin + HF[(r * S) * NX + c * S] / meta.zscale - ZO; pos[k * 3 + 2] = -y;
    uv[k * 2] = (x - meta.x0) / W; uv[k * 2 + 1] = (y - meta.y0) / H;
  }
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6); let n = 0;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx[n++] = a; idx[n++] = b; idx[n++] = d; idx[n++] = b; idx[n++] = e; idx[n++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  const m = new THREE.MeshLambertMaterial({ map: tex, color: tex ? 0xffffff : 0x5f8a3c });
  const t = new THREE.Mesh(g, m); scene.add(t);
  // skirt ground beyond the model, matching fog
  const far = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7c8f62 }));
  far.position.y = -14; scene.add(far);
}
setProg(0.65);

// ---------------------------------------------------------------- trees
const treeGroup = new THREE.Group(); scene.add(treeGroup);
{
  const T = new Float32Array(treesBuf), n = T.length / 8;
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  let nd = 0, nc = 0;
  for (let i = 0; i < n; i++) (T[i * 8 + 5] > 0.5 ? nc++ : nd++);
  const crownG = new THREE.IcosahedronGeometry(1, 1);
  const trunkG = new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0);
  const coneG = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ flatShading: false });
  const crowns = new THREE.InstancedMesh(crownG, mat, nd), trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x4a3a2a }), nd + nc);
  const cones = new THREE.InstancedMesh(coneG, mat, nc);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  let a = 0, b = 0, t = 0;
  for (let i = 0; i < n; i++) {
    const x = T[i * 8], y = T[i * 8 + 1], r = Math.max(1.4, T[i * 8 + 3]), h = Math.max(4, T[i * 8 + 4]), typ = T[i * 8 + 5], rot = T[i * 8 + 6];
    const z = hAt(x, y) - 0.1;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    if (typ > 0.5) {
      ps.set(x, z + h * 0.08, -y); sc.set(r * 0.85, h * 0.92, r * 0.85); m4.compose(ps, q, sc); cones.setMatrixAt(b, m4);
      col.setHSL(0.31 + rng() * 0.04, 0.35, 0.07 + rng() * 0.04); cones.setColorAt(b, col); b++;
      ps.set(x, z, -y); sc.set(0.25, h * 0.15, 0.25); m4.compose(ps, q, sc); trunks.setMatrixAt(t++, m4);
    } else {
      const th = h * 0.5;
      ps.set(x, z, -y); sc.set(Math.max(0.18, r * 0.07), th, Math.max(0.18, r * 0.07)); m4.compose(ps, q, sc); trunks.setMatrixAt(t++, m4);
      ps.set(x, z + th * 0.9 + (h - th * 0.9) * 0.5, -y); sc.set(r, (h - th * 0.9) * 0.5 * 1.05, r); m4.compose(ps, q, sc); crowns.setMatrixAt(a, m4);
      col.setHSL(0.24 + rng() * 0.07, 0.40 + rng() * 0.1, 0.10 + rng() * 0.08); crowns.setColorAt(a, col); a++;
    }
  }
  for (const o of [crowns, trunks, cones]) { o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; o.frustumCulled = false; treeGroup.add(o); }
}
setProg(0.8);

// ---------------------------------------------------------------- buildings
const bWall = [], bRoof = []; // {pos:[], col:[]}
const mkBuf = () => ({ p: [], c: [] });
const WALLS = mkBuf(), ROOFS = mkBuf();
const srgb = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
function area2(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; }
function ccw(poly) { return area2(poly) < 0 ? poly.slice().reverse() : poly; }
function tri(buf, a, b, c, col) { for (const v of [a, b, c]) { buf.p.push(v.x, v.y, v.z); buf.c.push(col.r, col.g, col.b); } }
function walls(poly, z0, z1, col) {
  const pl = ccw(poly);
  for (let i = 0; i < pl.length; i++) {
    const a = pl[i], b = pl[(i + 1) % pl.length];
    const A = P(a[0], a[1], z0), B = P(b[0], b[1], z0), C = P(b[0], b[1], z1), D = P(a[0], a[1], z1);
    tri(WALLS, A, B, C, col); tri(WALLS, A, C, D, col);
  }
}
function flat(poly, z, col, buf = ROOFS) {
  const pl = ccw(poly), v = pl.map(p => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(v, []);
  for (const t of tris) tri(buf, P(pl[t[0]][0], pl[t[0]][1], z), P(pl[t[2]][0], pl[t[2]][1], z), P(pl[t[1]][0], pl[t[1]][1], z), col);
}
function hip(poly, z, rise, col, inset = 0.15) {
  const pl = ccw(poly); let cx = 0, cy = 0; for (const p of pl) { cx += p[0]; cy += p[1]; } cx /= pl.length; cy /= pl.length;
  const apex = P(cx, cy, z + rise);
  for (let i = 0; i < pl.length; i++) {
    const a = pl[i], b = pl[(i + 1) % pl.length];
    const ax = a[0] + (cx - a[0]) * inset, ay = a[1] + (cy - a[1]) * inset, bx = b[0] + (cx - b[0]) * inset, by = b[1] + (cy - b[1]) * inset;
    tri(ROOFS, P(a[0], a[1], z), P(b[0], b[1], z), P(bx, by, z + rise * 0.0 + 0.0), col); // eave lip
    tri(ROOFS, P(a[0], a[1], z), P(bx, by, z), P(ax, ay, z), col);
    tri(ROOFS, P(ax, ay, z), P(bx, by, z), apex, col);
  }
}
function obbRise(poly) { let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9; for (const p of poly) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); } return Math.min(mxx - mnx, mxy - mny); }
const palette = [[214, 205, 188], [226, 222, 212], [176, 150, 120], [160, 166, 168], [196, 176, 150], [120, 128, 140], [208, 196, 170], [236, 232, 224]];
for (const b of blds) {
  const P_ = b.p; if (P_.length < 3) continue;
  let zs = 0, zmin = 1e9; for (const p of P_) { const z = hAt(p[0], p[1]); zs += z; zmin = Math.min(zmin, z); }
  const F = zs / P_.length + 0.15, base = zmin - 0.8;
  const rcol = srgb(b.rgb[0] * 0.62, b.rgb[1] * 0.62, b.rgb[2] * 0.62);
  const id = +b.id || 0; const wc = srgb(...palette[(id * 7) % palette.length]);
  if (b.kind === 'school' || b.area > 1400) { const h = b.kind === 'school' ? 9 : 7; walls(P_, base, F + h, srgb(168, 150, 130)); flat(P_, F + h, rcol); }
  else if (b.kind === 'garage' || b.area < 45) { const h = 2.9; walls(P_, base, F + h, wc); hip(P_, F + h, b.area > 20 ? 1.0 : 0.4, rcol, 0.3); }
  else if (b.area > 380) { const h = 5.2; walls(P_, base, F + h, wc); hip(P_, F + h, 0.6, rcol, 0.2); }
  else { const two = b.area > 150, h = two ? 5.6 : 3.2; walls(P_, base, F + h, wc); hip(P_, F + h, Math.min(4.2, obbRise(P_) * 0.55), rcol, 0.5); }
}
// clubhouse complex (hand-traced)
const WALLC = { brick: srgb(142, 70, 56), stucco: srgb(214, 200, 176) };
for (const set of [manual.clubhouse, manual.pool_house, manual.brown_house]) for (const v of set || []) {
  let zs = 0, zmin = 1e9; for (const p of v.poly) { const z = hAt(p[0], p[1]); zs += z; zmin = Math.min(zmin, z); }
  const F = zs / v.poly.length + 0.1, base = zmin - 1.0, top = F + Math.max(v.eave, 0.1);
  walls(v.poly, base, top, WALLC[v.wall] || WALLC.brick);
  const rc = v.roof_color ? srgb(v.roof_color[0] * 255, v.roof_color[1] * 255, v.roof_color[2] * 255) : srgb(88, 94, 106);
  if (v.roof === 'flat' || !v.rise) flat(v.poly, top, v.roof === 'flat' && v.eave < 1 ? srgb(150, 150, 146) : srgb(205, 205, 200));
  else hip(v.poly, top, v.rise, rc, 0.2);
}
function bake(buf, rough) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  scene.add(m); return m;
}
bake(WALLS); bake(ROOFS);
// pool + deck
function flatSurface(poly, col, lift) {
  const buf = mkBuf(); const pl = ccw(poly), v = pl.map(p => new THREE.Vector2(p[0], p[1])); const tris = THREE.ShapeUtils.triangulateShape(v, []);
  let zs = 0; for (const p of pl) zs += hAt(p[0], p[1]); const z = zs / pl.length + lift;
  for (const t of tris) tri(buf, P(pl[t[0]][0], pl[t[0]][1], z), P(pl[t[2]][0], pl[t[2]][1], z), P(pl[t[1]][0], pl[t[1]][1], z), col);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); scene.add(m); return m;
}
if (manual.pool_deck) flatSurface(manual.pool_deck, srgb(205, 200, 188), 0.05);
if (manual.pool) flatSurface(manual.pool, srgb(70, 165, 205), 0.12);
setProg(0.88);

// ---------------------------------------------------------------- cars, pins, tee markers
{
  const n = cars.length;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 0.7, 1.82), new THREE.MeshLambertMaterial(), n);
  const cab = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.55, 1.6), new THREE.MeshLambertMaterial({ color: 0x1b2128 }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  cars.forEach((cr, i) => {
    const [X, Y, ang, , , r, g, b] = cr; const z = hAt(X, Y);
    q.setFromAxisAngle(up, ang * Math.PI / 180);
    m4.compose(new THREE.Vector3(X, z + 0.55, -Y), q, s1); body.setMatrixAt(i, m4);
    const o = new THREE.Vector3(-0.15, 0.6, 0).applyQuaternion(q);
    m4.compose(new THREE.Vector3(X + o.x, z + 0.55 + o.y, -Y + o.z), q, s1); cab.setMatrixAt(i, m4);
    const luma = 0.3 * r + 0.59 * g + 0.11 * b; let cr_, cg, cb;
    if (luma > 0.62) { cr_ = 0.85; cg = 0.85; cb = 0.86; }
    else if (luma < 0.26) { cr_ = 0.04; cg = 0.045; cb = 0.05; }
    else { const k = 0.8, s = 1.7; cr_ = (luma + (r - luma) * s) * k; cg = (luma + (g - luma) * s) * k; cb = (luma + (b - luma) * s) * k; }
    c.setRGB(Math.max(.02, cr_), Math.max(.02, cg), Math.max(.02, cb), THREE.SRGBColorSpace); body.setColorAt(i, c);
  });
  body.instanceColor.needsUpdate = true; scene.add(body, cab);
  // flagsticks
  const fl = pins.flags, poleG = new THREE.CylinderGeometry(0.03, 0.025, 2.1, 5).translate(0, 1.05, 0);
  const poles = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0xf2f2ee }), fl.length);
  const flagG = new THREE.BufferGeometry(); flagG.setAttribute('position', new THREE.Float32BufferAttribute([0.02, 2.08, 0, 0.02, 1.78, 0, 0.55, 1.93, 0], 3)); flagG.computeVertexNormals();
  const flags = new THREE.InstancedMesh(flagG, new THREE.MeshBasicMaterial({ color: 0xd0201a, side: THREE.DoubleSide }), fl.length);
  fl.forEach((f, i) => { m4.makeTranslation(f.x, hAt(f.x, f.y), -f.y); poles.setMatrixAt(i, m4); flags.setMatrixAt(i, m4); });
  scene.add(poles, flags);
  // tee markers (black, blue, white, gold, red)
  const colors = [0x111111, 0x2255cc, 0xf4f4f4, 0xe0b020, 0xcc2222];
  const markG = new THREE.ConeGeometry(0.12, 0.3, 8).translate(0, 0.15, 0);
  for (let k = 0; k < 5; k++) {
    const pts = pins.tees.filter(t => t[2] === k); if (!pts.length) continue;
    const im = new THREE.InstancedMesh(markG, new THREE.MeshLambertMaterial({ color: colors[k] }), pts.length);
    pts.forEach((t, i) => { m4.makeTranslation(t[0], hAt(t[0], t[1]), -t[1]); im.setMatrixAt(i, m4); }); scene.add(im);
  }
}
// hole number labels + route lines
const labels = new THREE.Group(); scene.add(labels);
const lines = new THREE.Group(); lines.visible = false; scene.add(lines);
function numSprite(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = 'rgba(15,29,20,.88)'; x.beginPath(); x.arc(64, 64, 58, 0, 7); x.fill(); x.lineWidth = 6; x.strokeStyle = '#e3c565'; x.stroke();
  x.fillStyle = '#fff'; x.font = '700 64px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false })); s.scale.set(26, 26, 1); s.renderOrder = 10; return s;
}
for (const h of holes) {
  const [x, y] = h.line[0]; const s = numSprite(h.hole); s.position.set(x, hAt(x, y) + 20, -y); labels.add(s);
  const pts = h.line.map(([a, b]) => new THREE.Vector3(a, hAt(a, b) + 1.2, -b));
  // densify to follow the ground
  const dense = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(2, Math.ceil(a.distanceTo(b) / 6)); for (let k = 0; k < n; k++) { const t = k / n, X = a.x + (b.x - a.x) * t, Z = a.z + (b.z - a.z) * t; dense.push(new THREE.Vector3(X, hAt(X, -Z) + 1.2, Z)); } } dense.push(pts[pts.length - 1]);
  lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(dense), new THREE.LineBasicMaterial({ color: 0xe3c565, depthTest: false, transparent: true, opacity: .9 })));
}
setProg(1);

// ---------------------------------------------------------------- camera presets + UI
const views = {
  overview: { eye: [80, -980, 560], tgt: [0, -20, 0], name: 'Overview' },
  clubhouse: { eye: [-170, -10, 60], tgt: [-265, 85, 4], name: 'Clubhouse' },
  parking: { eye: [-290, 20, 36], tgt: [-335, 90, 0], name: 'Parking' },
  top: { eye: [0, -30, 1500], tgt: [0, -29.9, 0], name: 'Top-down' }
};
const flyState = { t: 1, a: null, b: null, dur: 2 };
function setView(eye, tgt, dur = 2.2) {
  flyState.a = { e: camera.position.clone(), t: controls.target.clone() }; flyState.b = { e: eye, t: tgt }; flyState.t = 0; flyState.dur = dur;
}
const holeView = h => { const c = cams[String(h)]; const ex = c.eye[0], ey = c.eye[1], tx = c.tgt[0], ty = c.tgt[1];
  return { e: P(ex, ey, hAt(ex, ey) + c.h), t: P(tx, ty, hAt(tx, ty) + 1) }; };
const presetView = v => ({ e: P(v.eye[0], v.eye[1], v.eye[2] > 200 ? v.eye[2] : hAt(v.eye[0], v.eye[1]) + v.eye[2]), t: P(v.tgt[0], v.tgt[1], v.tgt[2] !== undefined ? v.tgt[2] : hAt(v.tgt[0], v.tgt[1]) + 3) });
const titleEl = $('#title');
function showTitle(a, b) { titleEl.innerHTML = a + (b ? '<small>' + b + '</small>' : ''); titleEl.classList.add('show'); clearTimeout(showTitle.t); showTitle.t = setTimeout(() => titleEl.classList.remove('show'), 4200); }

const viewsEl = $('#views');
const holesEl = $('#holes');
function clearOn() { document.querySelectorAll('.on').forEach(e => e.classList.remove('on')); }
for (const k of Object.keys(views)) {
  const b = document.createElement('button'); b.textContent = views[k].name; b.onclick = () => { clearOn(); b.classList.add('on'); const v = presetView(views[k]); setView(v.e, v.t, k === 'top' ? 2.5 : 2.2); showTitle(views[k].name); if (innerWidth < 640) $('#panel').classList.add('hide'); location.hash = k; };
  viewsEl.appendChild(b); views[k].btn = b;
}
const gb = document.createElement('button'); gb.textContent = 'Gallery'; viewsEl.appendChild(gb);
for (const h of holes) {
  const b = document.createElement('button'); b.className = 'hole';
  b.innerHTML = `<b>${h.hole}</b><span>${h.name || 'Par ' + h.par}<em>Par ${h.par} · HCP ${h.hcp}</em></span><small>${h.yards} yds</small>`;
  b.onclick = () => { clearOn(); b.classList.add('on'); const v = holeView(h.hole); setView(v.e, v.t, 2.4); showTitle('Hole ' + h.hole + (h.name ? ' · ' + h.name : ''), `Par ${h.par} · ${h.yards} yards · Handicap ${h.hcp}`); if (innerWidth < 640) $('#panel').classList.add('hide'); location.hash = 'hole' + h.hole; };
  holesEl.appendChild(b); h.btn = b;
}
$('#oTrees').onchange = e => treeGroup.visible = e.target.checked;
$('#oLines').onchange = e => lines.visible = e.target.checked;
$('#oLabels').onchange = e => labels.visible = e.target.checked;
$('#oSpin').onchange = e => { controls.autoRotate = e.target.checked; controls.autoRotateSpeed = 0.6; };
$('#tog').onclick = () => $('#panel').classList.remove('hide');
$('#about').onclick = () => alert('Sources: USDA NAIP aerial imagery · USGS 3DEP elevation · OpenStreetMap contributors (ODbL) · course facts from GolfPass, Stymie, Golf Club Atlas, The Fried Egg, Corridor Business Journal and the USGA.\n\nModel built with Blender + three.js. An approximation of the real course, not survey-exact.');

// gallery
const GAL = [['wide_south', 'Whole course, from the south'], ['hero1', 'Clubhouse, parking lot, pool and tennis courts']]
  .concat(Array.from({ length: 18 }, (_, i) => ['hole' + String(i + 1).padStart(2, '0') + '_b', 'Hole ' + (i + 1) + ' — tee view']));
const grid = $('#grid');
for (const [f, cap] of GAL) { const fig = document.createElement('figure'); fig.innerHTML = `<img loading="lazy" src="/renders/${f}.jpg" alt="${cap}"><figcaption>${cap}</figcaption>`; fig.firstChild.onclick = () => { $('#lb img').src = `/renders/${f}.jpg`; $('#lb').classList.add('show'); }; grid.appendChild(fig); }
gb.onclick = () => $('#gal').classList.add('show');
$('#gclose').onclick = () => { $('#gal').classList.remove('show'); };
$('#lb').onclick = () => $('#lb').classList.remove('show');
addEventListener('keydown', e => { if (e.key === 'Escape') { $('#lb').classList.remove('show'); $('#gal').classList.remove('show'); } });

// initial camera
{ const v = presetView(views.overview); camera.position.copy(v.e); controls.target.copy(v.t); }
const hashTarget = location.hash.slice(1);
function applyHash(h) {
  if (/^hole\d+$/.test(h)) { const n = +h.slice(4); const hh = holes.find(x => x.hole === n); if (hh) hh.btn.click(); }
  else if (views[h]) views[h].btn.click();
}
setTimeout(() => $('#load').classList.add('done'), 150);
if (hashTarget) setTimeout(() => applyHash(hashTarget), 500);
else setTimeout(() => { const v = presetView({ eye: [-220, -300, 160], tgt: [-100, 40, 0] }); setView(v.e, v.t, 4); showTitle('Cedar Rapids Country Club', 'Par 72 · 18 holes · tap a hole to fly it'); }, 700);

// ---------------------------------------------------------------- loop
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
let last = performance.now();
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
controls.addEventListener('start', () => { flyState.t = 1; });
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (flyState.t < 1) {
    flyState.t = Math.min(1, flyState.t + dt / flyState.dur); const k = ease(flyState.t);
    camera.position.lerpVectors(flyState.a.e, flyState.b.e, k); controls.target.lerpVectors(flyState.a.t, flyState.b.t, k);
  }
  // keep camera above ground
  const gy = hAt(camera.position.x, -camera.position.z) + 1.8; if (camera.position.y < gy) camera.position.y = gy;
  controls.update();
  scene.userData.sky.position.copy(camera.position);
  if (labels.visible) for (const sp of labels.children) { const d = sp.position.distanceTo(camera.position); const k = Math.min(Math.max(d * 0.03, 7), 38); sp.scale.set(k, k, 1); sp.material.opacity = d < 60 ? 0 : 1; }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__crcc = { scene, camera, controls, setView, presetView, holeView, hAt };
