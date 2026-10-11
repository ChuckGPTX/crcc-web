// Procedural golf gear for the VR mode: clubs, hands, shoes, bag, cup + flag.
// Club head frame: x = toward toe, y = up (at address), z = back (the face looks toward -z).
// Origin = hosel point on the face plane at ball-centre height; sweet spot = (0.035, 0, -0.0215).
import * as THREE from 'three';

export const SWEET = new THREE.Vector3(0.035, 0, -0.0215);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const grooveTex = () => canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#c9cfd4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 1); }
  g.fillStyle = 'rgba(60,66,72,.55)'; for (let y = 18; y < h - 10; y += 9) g.fillRect(28, y, w - 56, 2.2);
});
const gripTex = () => { const t = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#202224'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { g.fillStyle = y % 8 ? '#2a2c2f' : '#191a1c'; g.fillRect(0, y, w, 2); }
  g.fillStyle = '#c9a43a'; g.fillRect(0, h * 0.82, w, 6);
}); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };

const MAT = {};
function mats() {
  if (MAT.chrome) return MAT;
  MAT.chrome = new THREE.MeshStandardMaterial({ color: 0xe2e6ea, metalness: 1, roughness: 0.16 });
  MAT.satin = new THREE.MeshStandardMaterial({ color: 0xbfc5cb, metalness: 1, roughness: 0.38 });
  MAT.face = new THREE.MeshStandardMaterial({ map: grooveTex(), metalness: 0.9, roughness: 0.42, side: THREE.DoubleSide });
  MAT.crown = new THREE.MeshPhysicalMaterial({ color: 0x0d1013, metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  MAT.sole = new THREE.MeshStandardMaterial({ color: 0x9aa2a9, metalness: 1, roughness: 0.3 });
  MAT.steel = new THREE.MeshStandardMaterial({ color: 0xd5dadf, metalness: 1, roughness: 0.12 });
  MAT.graphite = new THREE.MeshPhysicalMaterial({ color: 0x1b2026, metalness: 0.35, roughness: 0.28, clearcoat: 0.8 });
  MAT.grip = new THREE.MeshStandardMaterial({ map: gripTex(), roughness: 0.92 });
  MAT.black = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.35, metalness: 0.2 });
  MAT.white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
  MAT.accent = new THREE.MeshStandardMaterial({ color: 0xc9a43a, metalness: 0.6, roughness: 0.35 });
  MAT.skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.65 });
  MAT.glove = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.75 });
  MAT.gloveTab = new THREE.MeshStandardMaterial({ color: 0x1f3a5f, roughness: 0.6 });
  return MAT;
}

const Y = new THREE.Vector3(0, 1, 0);
export function rod(a, b, r0, r1, mat, seg = 12) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(Y, d.normalize()); return m;
}

function driverHead(scale, M) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 48, 28);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { // pear shape: fuller at the toe and back, flat face
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    x *= 0.058 * scale * (1 + 0.08 * x); y *= 0.031 * scale * (y > 0 ? 1 : 0.8); z *= 0.054 * scale;
    x += 0.052 * scale; y += 0.006 * scale; z += 0.054 * scale;
    if (z < 0.0035) z = 0.0035;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const head = new THREE.Mesh(geo, M.crown); g.add(head);
  // sole plate
  const sole = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), M.sole);
  sole.scale.set(0.057 * scale, 0.026 * scale, 0.053 * scale); sole.position.set(0.052 * scale, 0.004 * scale, 0.055 * scale); g.add(sole);
  // face insert
  const fs = new THREE.Shape(); const w = 0.088 * scale, h = 0.04 * scale, r = 0.012 * scale;
  fs.moveTo(-w / 2 + r, -h / 2); fs.lineTo(w / 2 - r, -h / 2); fs.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); fs.lineTo(w / 2, h / 2 - r);
  fs.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); fs.lineTo(-w / 2 + r, h / 2); fs.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); fs.lineTo(-w / 2, -h / 2 + r); fs.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const face = new THREE.Mesh(new THREE.ShapeGeometry(fs, 6), M.face); face.rotation.y = Math.PI; face.position.set(0.052 * scale, 0.004 * scale, 0.0025); g.add(face);
  // crown alignment mark
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.0008, 0.012), M.white); mark.position.set(0.052 * scale, 0.0372 * scale, 0.012); g.add(mark);
  const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.009, 0.03, 14), M.crown); hosel.position.set(0.004, 0.022, 0.012); g.add(hosel);
  return g;
}

function ironHead(top, M, wedge) {
  const g = new THREE.Group(), s = new THREE.Shape();
  s.moveTo(0.004, -0.021); s.lineTo(0.068, -0.0225); s.quadraticCurveTo(0.088, -0.022, 0.088, -0.004);
  s.quadraticCurveTo(0.088, top, 0.074, top + 0.002); s.lineTo(0.018, 0.017); s.quadraticCurveTo(0.004, 0.013, 0.0, 0.004); s.lineTo(0.004, -0.021);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 10 }), M.chrome);
  g.add(body);
  const face = new THREE.Mesh(new THREE.ShapeGeometry(s, 10), M.face); face.rotation.y = Math.PI; face.scale.x = -1; face.position.z = -0.0021; g.add(face);
  // cavity back badge
  const b = new THREE.Shape(); b.moveTo(0.02, -0.012); b.lineTo(0.07, -0.013); b.quadraticCurveTo(0.078, -0.004, 0.072, top - 0.008); b.lineTo(0.024, 0.009); b.lineTo(0.02, -0.012);
  const badge = new THREE.Mesh(new THREE.ShapeGeometry(b, 6), wedge ? M.sole : M.accent); badge.position.z = 0.0182; g.add(badge);
  const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.008, 0.05, 14), M.chrome); hosel.position.set(0.001, 0.03, 0.009); g.add(hosel);
  return g;
}

function putterHead(M) {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.021, 0.026, 2, 1, 1), M.satin); blade.position.set(0.058, -0.0105, 0.013); g.add(blade);
  const flange = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.02), M.satin); flange.position.set(0.058, -0.017, 0.034); g.add(flange);
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.0008, 0.04), M.white); line.position.set(0.058, 0.0003, 0.022); g.add(line);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.103, 0.019), M.face); face.rotation.y = Math.PI; face.position.set(0.058, -0.0105, -0.0003); g.add(face);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 10), M.satin); neck.position.set(0.012, 0.012, 0.012); g.add(neck);
  return g;
}

// Full club in the "club frame" (same axes as the head frame, origin at the hand).
// sC = shaft direction (unit, hand -> head) in that frame; L = hand-to-hosel length (m).
export function buildClub(club, sC, L) {
  const M = mats(), g = new THREE.Group();
  const s = sC.clone().normalize(), at = k => s.clone().multiplyScalar(k);
  const wood = club.type === 'driver' || club.type === 'wood';
  g.add(rod(at(-0.17), at(0.1), 0.0128, 0.0105, M.grip));
  g.add(rod(at(-0.172), at(-0.168), 0.0128, 0.0128, M.black));
  g.add(rod(at(0.1), at(L - 0.05), 0.0068, 0.0046, wood ? M.graphite : M.steel));
  g.add(rod(at(L - 0.055), at(L - 0.035), 0.0058, 0.0062, M.black));
  let head;
  if (club.type === 'driver') head = driverHead(1, M);
  else if (club.type === 'wood') head = driverHead(0.8, M);
  else if (club.type === 'putter') head = putterHead(M);
  else head = ironHead(club.type === 'wedge' ? 0.034 : 0.027 + (club.loft - 27) * 0.0002, M, club.type === 'wedge');
  const hp = new THREE.Group(); hp.add(head); hp.rotation.x = THREE.MathUtils.degToRad(club.loft) * 0.9;
  hp.position.copy(at(L)); g.add(hp);
  return g;
}

// A closed hand around a club grip. Local frame: +y = along the shaft toward the head.
export function buildFist(glove) {
  const M = mats(), g = new THREE.Group(), m = glove ? M.glove : M.skin;
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), m); palm.scale.set(0.036, 0.048, 0.041); palm.position.set(0.0, 0, 0.012); g.add(palm);
  for (let i = 0; i < 4; i++) { const k = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), m); k.scale.set(0.012, 0.0115, 0.013); k.position.set(-0.024, -0.026 + i * 0.0175, -0.004); g.add(k); }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.03, 4, 8), m); thumb.position.set(0.018, 0.02, -0.02); thumb.rotation.z = -0.25; g.add(thumb);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.05, 14), glove ? M.gloveTab : M.skin); wrist.position.set(0.0, -0.06, 0.03); wrist.rotation.x = 0.5; g.add(wrist);
  return g;
}

export function buildShoe(right) {
  const M = mats(), g = new THREE.Group();
  const up = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.white); up.scale.set(0.048, 0.042, 0.135); up.position.set(0, 0.04, 0); g.add(up);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.018, 0.285), M.black); sole.position.set(0, 0.009, 0); g.add(sole);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), M.black); cap.scale.set(0.047, 0.028, 0.05); cap.position.set(0, 0.032, -0.105); g.add(cap);
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.07), M.gloveTab); tongue.position.set(0, 0.08, -0.01); tongue.rotation.x = 0.35; g.add(tongue);
  if (right) g.scale.x = -1;
  return g;
}

export function buildBag(clubs) {
  const M = mats(), g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.86, 24), new THREE.MeshStandardMaterial({ color: 0x173252, roughness: 0.6 })); body.position.y = 0.43; g.add(body);
  for (const y of [0.12, 0.8]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.134, 0.134, 0.06, 24), new THREE.MeshStandardMaterial({ color: 0xd9c9a0, roughness: 0.7 })); b.position.y = y; g.add(b); }
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.06), new THREE.MeshStandardMaterial({ color: 0x0f2338, roughness: 0.65 })); pocket.position.set(0, 0.42, 0.13); g.add(pocket);
  clubs.forEach((c, i) => {
    const a = i / clubs.length * Math.PI * 2, r = 0.07, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const cap = new THREE.Mesh(c.type === 'driver' || c.type === 'wood' ? new THREE.SphereGeometry(0.045, 14, 10) : new THREE.BoxGeometry(0.07, 0.03, 0.02),
      c.type === 'driver' || c.type === 'wood' ? new THREE.MeshStandardMaterial({ color: [0x0f0f0f, 0x6b1a1a][i % 2], roughness: 0.8 }) : M.chrome);
    cap.position.set(x, 0.98 + (c.type === 'driver' ? 0.08 : c.type === 'wood' ? 0.05 : 0), z); if (cap.geometry.type === 'SphereGeometry') cap.scale.y = 1.4; else cap.rotation.y = a;
    g.add(cap); g.add(rod(new THREE.Vector3(x, 0.86, z), cap.position, 0.006, 0.006, M.steel, 6));
  });
  g.rotation.z = 0.2; return g;
}

export function buildPin(holeNo) {
  const g = new THREE.Group(), M = mats();
  const cup = new THREE.Mesh(new THREE.CircleGeometry(0.054, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050505 })); cup.position.y = 0.004; g.add(cup);
  const liner = new THREE.Mesh(new THREE.RingGeometry(0.052, 0.058, 28).rotateX(-Math.PI / 2), M.white); liner.position.y = 0.005; g.add(liner);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 2.13, 10), new THREE.MeshStandardMaterial({ color: 0xf2d24a, roughness: 0.5 })); pole.position.y = 1.065; g.add(pole);
  const tex = canvasTex(256, 160, (c, w, h) => { c.fillStyle = '#d4202a'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 110px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(holeNo), w / 2, h / 2 + 6); });
  const flagGeo = new THREE.PlaneGeometry(0.5, 0.32, 10, 2); flagGeo.translate(0.25, 0, 0);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 })); flag.position.y = 1.95; g.add(flag);
  g.userData.flag = flag; g.userData.base = flagGeo.attributes.position.array.slice();
  return g;
}
export function wavePin(pin, t) {
  const f = pin.userData.flag, p = f.geometry.attributes.position, b = pin.userData.base;
  for (let i = 0; i < p.count; i++) { const x = b[i * 3]; p.array[i * 3 + 2] = Math.sin(t * 4 + x * 9) * 0.04 * x * 2; }
  p.needsUpdate = true;
}
