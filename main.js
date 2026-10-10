import * as THREE from 'three';
import { OrbitControls } from '/vendor/OrbitControls.js';

const $ = s => document.querySelector(s);
const bar = $('#bar i');
let progress = 0;
const setProg = p => { progress = Math.max(progress, p); bar.style.width = (progress * 100) + '%'; };

// ---------------------------------------------------------------- renderer / scene
const canvas = $('#c');
const MOBILE = matchMedia('(pointer:coarse)').matches || innerWidth < 700 || location.search.includes('lite');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = new THREE.Color(0xb9c6d4);
scene.fog = new THREE.FogExp2(FOG, 0.00038);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 9000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 3; controls.maxDistance = 2200;
controls.screenSpacePanning = false;
scene.userData.sky = new THREE.Object3D();
// sun from the south-west at ~48° (matches the HDRI used in the Blender renders)
const SUN_DIR = (() => { const az = 235 * Math.PI / 180, el = 48 * Math.PI / 180; return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)); })();
const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
{ const c = sun.shadow.camera; c.left = -170; c.right = 170; c.top = 170; c.bottom = -170; c.near = 10; c.far = 2000; }
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x55623a, 0.35));

// ---------------------------------------------------------------- data
const fetchJSON = u => fetch(u).then(r => r.json());
const fetchBuf = u => fetch(u).then(r => r.arrayBuffer());
const loadTex = u => new Promise((res, rej) => new THREE.TextureLoader().load(u, res, undefined, rej));
const [meta, hfBuf, treesBuf, blds, manual, cars, holes, cams, pins, gt, tex, skyTex, geo] = await Promise.all([
  fetchJSON('/data/meta.json'), fetchBuf('/data/hf.bin'), fetchBuf('/data/trees.bin'), fetchJSON('/data/buildings.json'),
  fetchJSON('/data/manual.json'), fetchJSON('/data/cars.json'), fetchJSON('/data/holes.json'), fetchJSON('/data/cams.json'),
  fetchJSON('/data/pins.json'), fetchJSON('/data/gt.json'), loadTex('/tex/terrain.jpg').catch(() => null),
  loadTex('/tex/sky.jpg').catch(() => null), fetchJSON('/geo/geo.json').catch(() => null)
]);
const texCache = {};
function T(name, repeat = 1, color = true) {
  const key = name + repeat; if (texCache[key]) return texCache[key];
  const t = new THREE.TextureLoader().load('/tex/' + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  return texCache[key] = t;
}
if (skyTex) {
  skyTex.mapping = THREE.EquirectangularReflectionMapping; skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(skyTex).texture; pm.dispose();
  scene.environmentIntensity = 0.75;
}
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
  const TX = meta.tex_x || [meta.x0, meta.x1], TY = meta.tex_y || [meta.y0, meta.y1];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = meta.x0 + c * S * STEP, y = meta.y0 + r * S * STEP, k = r * cols + c;
    pos[k * 3] = x; pos[k * 3 + 1] = meta.zmin + HF[(r * S) * NX + c * S] / meta.zscale - ZO; pos[k * 3 + 2] = -y;
    uv[k * 2] = (x - TX[0]) / (TX[1] - TX[0]); uv[k * 2 + 1] = (y - TY[0]) / (TY[1] - TY[0]);
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
  const m = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x5f8a3c, roughness: 0.96, metalness: 0 });
  const detail = T('grass_detail.jpg', 1, false);
  m.onBeforeCompile = sh => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D detailMap;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float g = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
        float turf = smoothstep(0.005, 0.05, g);
        float d1 = texture2D(detailMap, vWPos.xz / 0.9).r * 2.0;
        float d2 = texture2D(detailMap, vWPos.xz / 7.3 + 0.37).r * 2.0;
        float fade = 1.0 - smoothstep(40.0, 320.0, length(vWPos - cameraPosition));
        diffuseColor.rgb *= mix(1.0, clamp(d1 * mix(1.0, d2, 0.6), 0.55, 1.5), turf * fade * 0.85);
      }`);
  };
  const t = new THREE.Mesh(g, m); t.receiveShadow = true; scene.add(t);
  // skirt ground beyond the model, matching fog
  const far = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7c8f62 }));
  far.position.y = -14; scene.add(far);
}
// ---------------------------------------------------------------- water: carved ponds + creek, depth-tinted, reflective, animated ripples
const water = await (async () => {
  const [wj, wb] = await Promise.all([fetchJSON('/data/water.json').catch(() => null), fetchBuf('/data/water.bin').catch(() => null)]);
  if (!wj || !wb) return null;
  const V = new Float32Array(wb, 0, wj.nv * 4), I = new Uint32Array(wb, wj.nv * 16, wj.nt * 3);
  const pos = new Float32Array(wj.nv * 3), dep = new Float32Array(wj.nv);
  for (let i = 0; i < wj.nv; i++) { pos[i * 3] = V[i * 4]; pos[i * 3 + 1] = V[i * 4 + 2]; pos[i * 3 + 2] = -V[i * 4 + 1]; dep[i] = V[i * 4 + 3]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('wdepth', new THREE.BufferAttribute(dep, 1));
  g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeVertexNormals(); g.computeBoundingSphere();
  const nmap = T('water_n.jpg', 1, false);
  const uni = { uTime: { value: 0 }, uN: { value: nmap } };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.35 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float wdepth;\nvarying float vDepth;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = wdepth;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDepth;\nvarying vec3 vWPos;\nuniform float uTime;\nuniform sampler2D uN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      float dd = clamp(vDepth, 0.0, 3.0);
      diffuseColor.rgb = mix(vec3(0.105, 0.096, 0.062), vec3(0.010, 0.020, 0.016), smoothstep(0.0, 1.3, dd));
      float edge = smoothstep(-0.02, 0.07, vDepth);
      diffuseColor.a = mix(0.42, 0.93, smoothstep(0.05, 1.0, dd));`)
      .replace('#include <normal_fragment_maps>', `
      {
        vec3 n1 = texture2D(uN, vWPos.xz / 23.0 + uTime * vec2(0.008, 0.005)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uN, vWPos.xz / 7.9 + uTime * vec2(-0.012, 0.009)).xyz * 2.0 - 1.0;
        float calm = 0.55 + 0.45 * texture2D(uN, vWPos.xz / 160.0 + 0.3).x;
        float fadeN = 1.0 - 0.75 * smoothstep(60.0, 450.0, length(vWPos - cameraPosition));
        vec2 d = (n1.xy + n2.xy * 0.5) * 0.16 * calm * fadeN;
        normal = normalize((viewMatrix * vec4(normalize(vec3(d.x, 1.0, d.y)), 0.0)).xyz);
      }`)
      .replace('#include <opaque_fragment>', `
      float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
      diffuseColor.a = clamp(diffuseColor.a + fr * 0.7, 0.0, 1.0) * edge;
      #include <opaque_fragment>`);
  };
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 2; mesh.receiveShadow = true; scene.add(mesh);
  return { mesh, uni };
})();
setProg(0.65);

// ---------------------------------------------------------------- trees (detailed near LOD + simple far LOD)
const treeGroup = new THREE.Group(); scene.add(treeGroup);
async function loadGeo(name) {
  if (!geo || !geo[name]) return null;
  const buf = await fetchBuf('/geo/' + name.toLowerCase() + '.bin'); const out = [];
  for (const g of geo[name]) {
    const n = g.count, o = g.offset;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, o, n * 3), 3));
    bg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf, o + n * 12, n * 3), 3));
    bg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, o + n * 24, n * 2), 2));
    bg.computeBoundingSphere(); out.push({ mat: g.mat, geo: bg });
  }
  return out;
}
const TREE_MATS = {
  TreeBarkOak: () => new THREE.MeshStandardMaterial({ map: T('bark_oak.jpg'), roughness: 0.95 }),
  TreeBarkSpruce: () => new THREE.MeshStandardMaterial({ map: T('bark_spruce.jpg'), roughness: 0.95 }),
  TreeLeafA: () => new THREE.MeshStandardMaterial({ map: T('twigA.png'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }),
  TreeLeafB: () => new THREE.MeshStandardMaterial({ map: T('twigB.png'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }),
  TreeNeedles: () => new THREE.MeshStandardMaterial({ map: T('needles.png'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 }),
};
const [ga0, ga1, gb0] = await Promise.all([loadGeo('Tree_a0'), loadGeo('Tree_a1'), loadGeo('Tree_b0')]);
const IMP = { Tree_a0: { F: 16.97, cz: 8.0 }, Tree_a1: { F: 16.97, cz: 8.0 }, Tree_b0: { F: 19.11, cz: 8.99 } };
const impTex = await loadTex('/tex/tree_imp.webp').catch(() => null);
if (impTex) { impTex.colorSpace = THREE.SRGBColorSpace; impTex.anisotropy = 4; }
const trees = (() => {
  const TB = new Float32Array(treesBuf), n = TB.length / 8;
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const pos = new Float32Array(n * 3), near = new Float32Array(n * 16);
  const variant = new Uint8Array(n), tint = new Float32Array(n * 3), isz = new Float32Array(n * 3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const x = TB[i * 8], y = TB[i * 8 + 1], r = Math.max(1.4, TB[i * 8 + 3]), h = Math.max(4, TB[i * 8 + 4]), typ = TB[i * 8 + 5], rot = TB[i * 8 + 6], vr = TB[i * 8 + 7];
    const z = hAt(x, y) - 0.1; pos[i * 3] = x; pos[i * 3 + 1] = z; pos[i * 3 + 2] = -y;
    q.setFromAxisAngle(Y, rot);
    let sxy, sz, im;
    if (typ > 0.5) { variant[i] = 2; sxy = r / 3.2 * 1.05; sz = h / 18; im = IMP.Tree_b0; }
    else { variant[i] = (vr | 0) % 2; sxy = r / 5.6 * 1.05; sz = h / 16; im = variant[i] ? IMP.Tree_a1 : IMP.Tree_a0; }
    ps.set(x, z, -y); sc.set(sxy, sz, sxy); m4.compose(ps, q, sc); m4.toArray(near, i * 16);
    isz[i * 3] = im.F * sxy; isz[i * 3 + 1] = im.F * sz; isz[i * 3 + 2] = im.cz * sz;
    const tv = 0.8 + rng() * 0.35; tint[i * 3] = tv * (0.95 + rng() * 0.1); tint[i * 3 + 1] = tv; tint[i * 3 + 2] = tv * (0.9 + rng() * 0.1);
  }
  // far LOD: camera-facing impostors picked from an 8-bearing x 2-elevation atlas rendered in Blender under the same sun
  const ig = new THREE.InstancedBufferGeometry(); ig.copy(new THREE.PlaneGeometry(1, 1));
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), aSize = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), aVar = new THREE.InstancedBufferAttribute(new Float32Array(n), 1), aTint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  for (const a of [aPos, aSize, aVar, aTint]) a.setUsage(THREE.DynamicDrawUsage);
  ig.setAttribute('iPos', aPos); ig.setAttribute('iSize', aSize); ig.setAttribute('iVar', aVar); ig.setAttribute('iTint', aTint); ig.instanceCount = 0;
  const impMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, gain: { value: 2.15 }, sunDir: { value: new THREE.Vector3() } }]),
    fog: true,
    vertexShader: `
      attribute vec3 iPos; attribute vec3 iSize; attribute float iVar; attribute vec3 iTint;
      varying vec2 vUv; varying vec3 vTint;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 c = iPos + vec3(0.0, iSize.z, 0.0);
        vec3 toCam = cameraPosition - c;
        float elev = atan(toCam.y, length(toCam.xz));
        float bearing = atan(toCam.x, toCam.z * -1.0);
        float k = mod(floor(bearing / (PI * 0.25) + 0.5) + 8.0, 8.0);
        float row = elev > 0.57 ? 1.0 : 0.0;
        vec3 f = normalize(toCam);
        vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
        vec3 u = row > 0.5 ? cross(f, r) : vec3(0.0, 1.0, 0.0);
        vec3 wp = c + r * position.x * iSize.x + u * position.y * iSize.y;
        if (row > 0.5) wp += f * iSize.y * 0.25;
        vUv = vec2((k + position.x + 0.5) / 8.0, (5.0 - (iVar * 2.0 + row) + position.y + 0.5) / 6.0);
        vTint = iTint;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float gain;
      varying vec2 vUv; varying vec3 vTint;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.5) discard;
        gl_FragColor = vec4(t.rgb * gain * vTint, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`
  });
  impMat.uniforms.map.value = impTex;
  const imps = new THREE.Mesh(ig, impMat); imps.frustumCulled = false; treeGroup.add(imps);
  // near meshes per variant: [bark, leaves]
  const nearSets = [ga0, ga1, gb0].map(gs => {
    if (!gs) return null;
    return gs.map(g => {
      const mat = (TREE_MATS[g.mat] || (() => new THREE.MeshStandardMaterial({ color: 0x556644 })))();
      const im = new THREE.InstancedMesh(g.geo, mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      if (mat.alphaTest) {
        im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map, alphaTest: 0.45 });
        im.setColorAt(0, new THREE.Color(1, 1, 1));
      }
      treeGroup.add(im); return im;
    });
  });
  const R_NEAR = +(new URLSearchParams(location.search).get('near')) || (MOBILE ? 140 : 210), lastCam = new THREE.Vector3(1e9, 0, 0);
  function update(force) {
    if (!force && lastCam.distanceToSquared(camera.position) < 36) return;
    lastCam.copy(camera.position);
    const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
    const R2 = R_NEAR * R_NEAR;
    const cnt = [0, 0, 0]; let fa = 0;
    const AP = aPos.array, AS = aSize.array, AV = aVar.array, AT = aTint.array;
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 3] - cx, dz = pos[i * 3 + 2] - cz, dy = pos[i * 3 + 1] - cy;
      const v = variant[i], set = nearSets[v];
      if (set && dx * dx + dz * dz + dy * dy * 0.5 < R2) {
        const k = cnt[v]++;
        for (const im of set) {
          im.instanceMatrix.array.set(near.subarray(i * 16, i * 16 + 16), k * 16);
          if (im.instanceColor) { im.instanceColor.array[k * 3] = tint[i * 3]; im.instanceColor.array[k * 3 + 1] = tint[i * 3 + 1]; im.instanceColor.array[k * 3 + 2] = tint[i * 3 + 2]; }
        }
      } else {
        AP[fa * 3] = pos[i * 3]; AP[fa * 3 + 1] = pos[i * 3 + 1]; AP[fa * 3 + 2] = pos[i * 3 + 2];
        AS[fa * 3] = isz[i * 3]; AS[fa * 3 + 1] = isz[i * 3 + 1]; AS[fa * 3 + 2] = isz[i * 3 + 2];
        AV[fa] = v; AT[fa * 3] = tint[i * 3]; AT[fa * 3 + 1] = tint[i * 3 + 1]; AT[fa * 3 + 2] = tint[i * 3 + 2]; fa++;
      }
    }
    nearSets.forEach((set, v) => set && set.forEach(im => { im.count = cnt[v]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }));
    ig.instanceCount = fa; for (const a of [aPos, aSize, aVar, aTint]) a.needsUpdate = true;
  }
  return { update, imps, impMat };
})();
trees.update(true);
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
// clubhouse complex: exact geometry exported from the Blender model, with PBR textures
const CH_MATS = {
  CH_Brick: () => new THREE.MeshStandardMaterial({ map: T('brick.jpg', 1 / 1.5), normalMap: T('brick_n.jpg', 1 / 1.5, false), roughness: 0.9 }),
  CH_Shingle: () => new THREE.MeshStandardMaterial({ map: T('shingle.jpg', 1 / 1.6), normalMap: T('shingle_n.jpg', 1 / 1.6, false), roughness: 0.85 }),
  CH_Siding: () => new THREE.MeshStandardMaterial({ map: T('siding.jpg', 1 / 2.4), roughness: 0.7 }),
  CH_Trim: () => new THREE.MeshStandardMaterial({ color: 0xd2d2cb, roughness: 0.45 }),
  CH_Glass: () => new THREE.MeshStandardMaterial({ color: 0x06090c, roughness: 0.04, metalness: 0.3, envMapIntensity: 1.6 }),
  CH_Limestone: () => new THREE.MeshStandardMaterial({ map: T('limestone.jpg', 1 / 1.6), roughness: 0.9 }),
  CH_Concrete: () => new THREE.MeshStandardMaterial({ map: T('concrete.jpg', 1 / 3), roughness: 0.9 }),
  CH_Membrane: () => new THREE.MeshStandardMaterial({ color: 0xa9a9a5, roughness: 0.8 }),
  CH_Mulch: () => new THREE.MeshStandardMaterial({ color: 0x4a1a0e, roughness: 0.95 }),
  CH_Canvas: () => new THREE.MeshStandardMaterial({ color: 0xdccdaa, roughness: 0.85, side: THREE.DoubleSide }),
  CH_Metal: () => new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.35, metalness: 1 }),
  CH_CartBody: () => new THREE.MeshStandardMaterial({ color: 0xdcd8cc, roughness: 0.4 }),
  CH_Seat: () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
  CH_Stucco: () => new THREE.MeshStandardMaterial({ color: 0xcfc4b0, roughness: 0.85 }),
  CH_BarnRed: () => new THREE.MeshStandardMaterial({ map: T('siding.jpg', 1 / 2.4), color: 0xa8281c, roughness: 0.75 }),
  CH_BlackFrame: () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.4 }),
  CH_MetalRoof: () => new THREE.MeshStandardMaterial({ color: 0x5f6266, roughness: 0.6, metalness: 0.1 }),
};
const chGeo = await loadGeo('clubhouse');
if (chGeo) for (const g of chGeo) {
  const mat = (CH_MATS[g.mat] || (() => new THREE.MeshStandardMaterial({ color: 0x999999 })))();
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(g.geo, mat); m.castShadow = true; m.receiveShadow = true; scene.add(m);
}
function bake(buf, rough) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
  m.castShadow = true; m.receiveShadow = true; scene.add(m); return m;
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
if (manual.pool) { const pm = flatSurface(manual.pool, srgb(60, 160, 200), 0.12); pm.material = new THREE.MeshStandardMaterial({ color: srgb(60, 160, 200), roughness: 0.05, metalness: 0.1 }); }
setProg(0.88);

// ---------------------------------------------------------------- cars, pins, tee markers
{
  // parked cars: low-poly CC-BY model (Blendswap #20760), positions/models/colours from the Blender scene
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const carGeo = await loadGeo('car'); const cars2 = await fetchJSON('/data/cars2.json').catch(() => []);
  const PAL = [[0.24, [0.80, 0.80, 0.79]], [0.19, [0.018, 0.018, 0.02]], [0.17, [0.20, 0.21, 0.22]], [0.14, [0.48, 0.49, 0.50]], [0.09, [0.025, 0.05, 0.13]], [0.07, [0.36, 0.025, 0.02]], [0.04, [0.06, 0.10, 0.07]], [0.04, [0.42, 0.38, 0.31]], [0.02, [0.10, 0.12, 0.16]]];
  const pick = r => { let acc = 0; for (const [w, col] of PAL) { acc += w; if (r < acc) return col; } return PAL[0][1]; };
  const CAR_MATS = { 'Red Car.001': () => new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    Windows: () => new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.4 }),
    'Car Light': () => new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2 }), Grey: () => new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.5, metalness: 0.6 }),
    Reflect: () => new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.2, metalness: 1 }) };
  if (carGeo && cars2.length) for (const g of carGeo) {
    const mat = (CAR_MATS[g.mat] || (() => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 })))();
    const im = new THREE.InstancedMesh(g.geo, mat, cars2.length); im.castShadow = true; im.receiveShadow = true;
    cars2.forEach(([X, Y, ang, kind, L, r], i) => {
      q.setFromAxisAngle(up, ang * Math.PI / 180); const s = L / 4.1;
      m4.compose(new THREE.Vector3(X, hAt(X, Y), -Y), q, new THREE.Vector3(s, s * (kind === 'pickup' || kind.includes('suv') ? 1.08 : 1), s)); im.setMatrixAt(i, m4);
      if (g.mat === 'Red Car.001') { const col = pick(r); c.setRGB(col[0], col[1], col[2], THREE.LinearSRGBColorSpace); im.setColorAt(i, c); }
    });
    scene.add(im);
  }
  // white bridges, parking-lot paint, curbs and light poles
  const exGeo = await loadGeo('extras');
  const EX_MATS = { BridgeWhite: () => new THREE.MeshStandardMaterial({ color: 0xececE6, roughness: 0.45 }), BridgeDeck: () => new THREE.MeshStandardMaterial({ color: 0x807c74, roughness: 0.85 }),
    BridgeCable: () => new THREE.MeshStandardMaterial({ color: 0x28282a, roughness: 0.4, metalness: 0.8 }), LinePaint: () => new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }) };
  if (exGeo) for (const g of exGeo) {
    const mat = (EX_MATS[g.mat] || CH_MATS[g.mat] || (() => new THREE.MeshStandardMaterial({ color: 0x999999 })))(); mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(g.geo, mat); m.castShadow = g.mat !== 'LinePaint'; m.receiveShadow = true; scene.add(m);
  }
  // reference-photo details: flagpole, drive fence, globe lamps, awnings, terraces, racquet club + courts, parkway fence, poles, range targets, golf carts
  const ex2 = await loadGeo('extras2');
  const cut = (tex, col, extra = {}) => new THREE.MeshStandardMaterial({ map: T(tex, 1), color: col, alphaTest: 0.45, roughness: 0.5, metalness: 0.4, ...extra });
  const X2 = {
    X2_Iron: () => cut('fence_iron.png', 0x161616), X2_Chain: () => cut('chainlink.png', 0x1a1a1a),
    X2_Flag: () => new THREE.MeshStandardMaterial({ map: T('flag.png', 1), roughness: 0.8 }), X2_Awning: () => new THREE.MeshStandardMaterial({ map: T('awning.png', 1), roughness: 0.85 }),
    X2_AwnGreen: () => new THREE.MeshStandardMaterial({ color: 0x0f3a24, roughness: 0.85 }), X2_CourtBlue: () => new THREE.MeshStandardMaterial({ color: 0x3a6fb5, roughness: 0.75 }),
    X2_CourtDark: () => new THREE.MeshStandardMaterial({ color: 0x1f3c78, roughness: 0.75 }), X2_Line: () => new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
    X2_Globe: () => new THREE.MeshStandardMaterial({ color: 0xf4f2ec, emissive: 0xfff4e0, emissiveIntensity: 0.35, roughness: 0.2 }),
    X2_Black: () => new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.4, metalness: 0.6 }), X2_White: () => new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.45 }),
    X2_Pole: () => new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }), X2_Wire: () => new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.5 }),
    X2_Target: () => new THREE.MeshStandardMaterial({ color: 0x4e7a32, roughness: 0.8 }), X2_FlagR: () => new THREE.MeshStandardMaterial({ color: 0xc81e1e }),
    X2_FlagY: () => new THREE.MeshStandardMaterial({ color: 0xe6b81a }), X2_FlagB: () => new THREE.MeshStandardMaterial({ color: 0x1e44b4 }),
    X2_Gold: () => new THREE.MeshStandardMaterial({ color: 0xd8a640, roughness: 0.3, metalness: 1 }), X2_Bloom: () => new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.8 }),
    X2_Plant: () => new THREE.MeshStandardMaterial({ color: 0x3e5e22, roughness: 0.8 })
  };
  if (ex2) for (const g of ex2) {
    const mat = (X2[g.mat] || CH_MATS[g.mat] || (() => new THREE.MeshStandardMaterial({ color: 0x999999 })))(); mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(g.geo, mat); m.castShadow = g.mat !== 'X2_Line'; m.receiveShadow = true; scene.add(m);
  }
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
  clubhouse: { eye: [-345, 43.5, 55], tgt: [-262, 83.3], name: 'Clubhouse' },
  clubrear: { eye: [-200, 38.8, 16], tgt: [-246, 81], name: 'Clubhouse rear' },
  racquet: { eye: [-442, 24.8, 14], tgt: [-444, 92.7], name: 'Racquet club' },
  parking: { eye: [-290, 22.4, 36], tgt: [-335, 104.4, 0], name: 'Parking' },
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
$('#about').onclick = () => alert('Sources: USDA NAIP aerial imagery · USGS 3DEP elevation · OpenStreetMap contributors (ODbL) · course facts from GolfPass, Stymie, Golf Club Atlas, The Fried Egg, Corridor Business Journal and the USGA.\n\nTextures and sky: ambientCG and Poly Haven (CC0). Clear-water creek setup inspired by "Realistic Creek" by devmishra1234 (Blendswap, CC0). Cars: "VW Golf MK4" by Jay-Artist, "Chevrolet Impala 2009" and "Crown Victoria Sedan 2011" by MAC2001, "mercedes amg 63ML", "SUV", "Low Poly Hatchback Car" and "Golf Cart" (Blendswap, CC-BY 3.0); Chevrolet Pickup, crooked oaks, park bench, reeds, lamp post, grass field, chain-link fence by mrzeon (Blendswap, CC0). Suspension-bridge reference: Blendswap #5794 (CC-BY).\n\nModel built with Blender + three.js. An approximation of the real course, not survey-exact.');

// gallery
const GAL = [['v4_bunker', 'Ross-style bunker: steep grass face, raked sand'], ['v4_bridge', 'White suspension bridge over Indian Creek'], ['v4_bridge2', 'Second suspension bridge and creek'], ['v4_aerial', 'Clubhouse, pool and parking from above'], ['v4_club_rear', 'Clubhouse rear addition'], ['v4_parking', 'Parking lot'], ['v3_pond', 'Pond on the back nine — carved basin, clear water, reflections'], ['v3_creek', 'Creek bank, bunker and reeds'], ['v3_club_golden', 'Clubhouse at golden hour'], ['v3_club_blue', 'Clubhouse at blue hour, lights on'], ['v2_club_photo', 'Clubhouse patio and east wing'], ['v2_club_aerial', 'Clubhouse from the south-east'], ['v2_hero1', 'Clubhouse, parking lot, pool and tennis courts'], ['v2_wide_south', 'Whole course, from the south']]
  .concat(Array.from({ length: 18 }, (_, i) => ['v2_hole' + String(i + 1).padStart(2, '0'), 'Hole ' + (i + 1) + ' — tee view']));
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
let last = performance.now(), frameN = 0;
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
  sun.target.position.copy(controls.target); sun.position.copy(controls.target).addScaledVector(SUN_DIR, 900);
  if (++frameN % 8 === 0) trees.update(false);
  if (water) water.uni.uTime.value = now / 1000;
  if (labels.visible) for (const sp of labels.children) { const d = sp.position.distanceTo(camera.position); const k = Math.min(Math.max(d * 0.03, 7), 38); sp.scale.set(k, k, 1); sp.material.opacity = d < 60 ? 0 : 1; }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__crcc = { scene, camera, controls, setView, presetView, holeView, hAt, renderer, trees, labels, sun, SUN_DIR };
