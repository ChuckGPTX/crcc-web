// WebXR golf for the CRCC model (Quest 3 browser).
// Club = one controller held with both hands (like Golf+), calibrated once at address.
// Movement: left stick walk, pump both arms (grips held) to run, off-hand grip to pull, X to glide to your ball.
import * as THREE from 'three';
import { Course, BallSim, State } from '/js/ballsim.js';
import { CLUBS, computeStrike } from '/js/swing.js';
import { buildClub, buildFist, buildShoe, buildBag, buildPin, wavePin, buildBall, loadHeads, SWEET } from '/js/clubs.js';
import { Sfx } from '/js/sfx.js';

const YD = 1.0936133, SURF = ['Rough', 'Fairway', 'Green', 'Tee box', 'Bunker', 'Water', 'Path', 'Semi-rough', 'Native'];
const store = { get: (k, d) => { try { const v = localStorage.getItem('crccvr.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('crccvr.' + k, JSON.stringify(v)); } catch { } } };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const toSim = v => [v.x, -v.z, v.y];

export function initVR(ctx) {
  const { renderer, scene, camera, hAt, holes, pins, sun } = ctx;
  if (!navigator.xr) return null;
  if (!camera.parent) scene.add(camera);
  const params = new URLSearchParams(location.search);
  let course = null, sim = null, loading = null;
  const loadPhysics = () => loading ||= Promise.all([fetch('/data/phys_hf.bin').then(r => r.arrayBuffer()), fetch('/data/phys_surf.bin').then(r => r.arrayBuffer())])
    .then(([h, s]) => { course = new Course(h, s); sim = new BallSim(course); });
  const sfx = new Sfx();
  let heads = null; const headsReady = (params.has('procclubs') ? Promise.resolve(null) : loadHeads()).then(h => { heads = h; if (clubModel) rebuildClub(); }).catch(e => console.warn('club heads', e));
  if (params.has('lefty')) { const lf = params.get('lefty') !== '0'; if (lf !== store.get('lefty', false)) store.set('cal2', null); store.set('lefty', lf); }
  if (params.has('refit')) store.set('cal2', null);

  // ------------------------------------------------------------ state
  const S = {
    on: false, hole: +params.get('hole') || 1, club: store.get('club', 3), strokes: 0, cards: store.get('cards', {}),
    lefty: store.get('lefty', false), cal: store.get('cal2', null),
    last: null, msg: '', msgT: 0, base: null, appliedRig: V3(), appliedYaw: 0, rig: V3(), yaw: 0, vel: V3(), vign: 0,
    hist: [], pin: [0, 0], startPos: [0, 0], trail: [], trailT: 0, resetAt: 0, armed: true, fat: 0, turfDone: false,
    slowUntil: 0, glide: null, trigT: 0, landedShown: false, feet: null, headPrev: null, speed: 0,
  };
  const prevBtn = {}, handSt = { left: { prev: null, pv: V3() }, right: { prev: null, pv: V3() } };
  const clubHand = () => S.lefty ? 'left' : 'right', offHand = () => S.lefty ? 'right' : 'left';

  // ------------------------------------------------------------ scene objects
  const world = new THREE.Group(); world.name = 'vr'; world.visible = false; scene.add(world);
  const ball = buildBall(); world.add(ball);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.062, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })); world.add(ring);
  const mkLine = (n, color, op) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setDrawRange(0, 0);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: op < 1, opacity: op })); l.frustumCulled = false; world.add(l); return l; };
  const tracer = mkLine(1200, 0xffe066, 0.95), headTrail = mkLine(28, 0xffffff, 0.5);
  const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(), V3(0, 0, -30)]), new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, dashSize: 0.5, gapSize: 0.5 }));
  aimLine.computeLineDistances(); aimLine.frustumCulled = false; world.add(aimLine);
  const bag = buildBag(CLUBS); world.add(bag);
  const shoes = [buildShoe(false), buildShoe(true)]; shoes.forEach(s => world.add(s));
  let pinObj = null;
  // landing marker
  const lmC = document.createElement('canvas'); lmC.width = 256; lmC.height = 96; const lmTex = new THREE.CanvasTexture(lmC); lmTex.colorSpace = THREE.SRGBColorSpace;
  const landMark = new THREE.Group(); world.add(landMark); landMark.visible = false;
  landMark.add(new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthWrite: false })));
  const lmSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: lmTex, depthTest: false })); lmSprite.scale.set(6, 2.25, 1); lmSprite.position.y = 3; landMark.add(lmSprite);
  // comfort vignette (child of the head)
  const vig = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, uniforms: { a: { value: 0 } },
    vertexShader: 'varying vec2 v; void main(){ v = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float a; varying vec2 v; void main(){ float r = length(v); gl_FragColor = vec4(0.0, 0.0, 0.0, a * smoothstep(0.35, 0.95, r)); }' }));
  vig.position.z = -0.25; vig.scale.setScalar(0.32); vig.renderOrder = 999; vig.visible = false; camera.add(vig);

  // club + hands
  const clubRoot = new THREE.Group(); clubRoot.matrixAutoUpdate = false;
  let clubModel = null; const fistTrail = buildFist(false), fistLead = buildFist(true);
  const L = { s: V3(), t: V3(), n: V3(), u: V3() };   // calibrated vectors in grip-local space
  function setLocalFrame() {
    if (S.cal) { L.s.fromArray(S.cal.s); L.t.fromArray(S.cal.t); L.n.fromArray(S.cal.n); }
    else { L.s.set(0, -0.26, -0.97).normalize(); L.t.set(0, 0.707, -0.707); L.n.set(S.lefty ? 1 : -1, 0, 0); }
    L.u.crossVectors(L.t, L.n).multiplyScalar(S.lefty ? -1 : 1).normalize();
  }
  const clubLen = (c = S.club) => { const base = S.cal ? S.cal.L / (CLUBS[S.cal.club].inch / 37) : 0.86; return base * CLUBS[c].inch / 37; };
  function rebuildClub() {
    setLocalFrame();
    const X = S.lefty ? L.t.clone().negate() : L.t.clone(), Z = L.n.clone().negate();
    clubRoot.matrix.makeBasis(X, L.u, Z);
    const sC = V3(L.s.dot(X), L.s.dot(L.u), L.s.dot(Z)).normalize();
    if (clubModel) { clubRoot.remove(clubModel); clubModel.traverse(o => o.geometry?.dispose()); }
    clubModel = buildClub(CLUBS[S.club], sC, clubLen(), { lefty: S.lefty, heads });
    S.sweetCF = clubModel.userData.sweet; S.headOff = clubModel.userData.headOff;
    clubRoot.add(clubModel);
    for (const f of [fistTrail, fistLead]) f.quaternion.setFromUnitVectors(UP, sC);
    fistTrail.position.copy(sC).multiplyScalar(0.0); clubRoot.add(fistTrail);
    S.sC = sC;
  }

  // ------------------------------------------------------------ HUD + readout
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return [c, c.getContext('2d'), t]; };
  const [, hx, hudTex] = mkCanvas(512, 320);
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true }));
  hud.rotation.x = -Math.PI / 2.6; hud.position.set(0, 0.03, 0.03);
  const [, bx, bigTex] = mkCanvas(1024, 384);
  const big = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: bigTex, transparent: true, depthWrite: false })); world.add(big);

  const holeInfo = n => {
    const h = holes.find(x => x.hole === n) || holes[0], f = pins.flags.find(x => x.hole === h.hole);
    return { n: h.hole, par: h.par, yards: h.yards, tee: h.line[0], pin: f ? [f.x, f.y] : h.line[h.line.length - 1] };
  };
  const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function say(t, secs = 4) { S.msg = t; S.msgT = performance.now() + secs * 1000; drawHud(); drawBig(); }
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); };

  let showCard = false;
  function drawHud() {
    const c = hx; c.clearRect(0, 0, 512, 320); c.fillStyle = 'rgba(10,22,14,.9)'; rr(c, 0, 0, 512, 320, 28);
    if (showCard) {
      c.fillStyle = '#e3c565'; c.font = '600 34px sans-serif'; c.fillText('Scorecard', 22, 44);
      c.font = '24px sans-serif'; let tot = 0, par = 0;
      for (let i = 1; i <= 18; i++) { const hi = holeInfo(i), s = S.cards[i], col = (i - 1) % 9, row = i > 9 ? 1 : 0, x = 22 + col * 53, y = 100 + row * 110;
        c.fillStyle = '#9fb59a'; c.fillText(String(i), x, y); c.fillText('p' + hi.par, x, y + 30);
        c.fillStyle = s == null ? '#556' : s < hi.par ? '#7fe07f' : s > hi.par ? '#ff9d7a' : '#fff'; c.font = '600 28px sans-serif'; c.fillText(s == null ? '–' : String(s), x, y + 66); c.font = '24px sans-serif';
        if (s != null) { tot += s; par += hi.par; } }
      c.fillStyle = '#fff'; c.font = '600 28px sans-serif'; c.fillText(par ? `Total ${tot} (${tot - par >= 0 ? '+' : ''}${tot - par})` : 'No holes finished yet', 22, 305);
      hudTex.needsUpdate = true; return;
    }
    const hi = holeInfo(S.hole), dy = sim ? Math.round(d2(sim.pos, S.pin) * YD) : hi.yards, l = S.last;
    c.fillStyle = '#e3c565'; c.font = '600 42px sans-serif'; c.fillText(`Hole ${hi.n} · Par ${hi.par}`, 22, 54);
    c.fillStyle = '#fff'; c.font = '600 40px sans-serif'; c.fillText(`${dy} yd to pin`, 22, 106);
    c.font = '32px sans-serif'; c.fillStyle = '#cfe0c8'; c.fillText(`${CLUBS[S.club].n}  ·  Stroke ${S.strokes + 1}`, 22, 152);
    if (sim) { c.fillStyle = '#9fb59a'; c.font = '28px sans-serif'; c.fillText(`${SURF[course.surface(sim.pos[0], sim.pos[1])]}${ctx.sky ? ' · ' + ctx.sky.windText() : ''}`, 22, 194); }
    if (!S.cal) { c.fillStyle = '#ffd86b'; c.font = '600 27px sans-serif'; c.fillText('Address the ball, pull trigger', 22, 244); c.fillText('to fit the club to your grip', 22, 278); }
    else if (l) { c.fillStyle = '#fff'; c.font = '28px sans-serif'; c.fillText(l.carry != null ? `Last: ${l.carry} carry · ${l.total} total` : 'Ball in the air…', 22, 244); }
    if (S.trigT > 0) { c.fillStyle = '#ffd86b'; rr(c, 22, 288, 468 * Math.min(1, S.trigT / 1.2), 14, 7); }
    hudTex.needsUpdate = true;
  }
  function drawBig() {
    const c = bx, l = S.last, now = performance.now(); c.clearRect(0, 0, 1024, 384);
    const msg = S.msg && now < S.msgT ? S.msg : !S.cal ? 'Address the ball, rest the club behind it, pull the trigger' : '';
    if (!l && !msg) { bigTex.needsUpdate = true; return; }
    c.fillStyle = 'rgba(10,22,14,.78)'; rr(c, 0, 0, 1024, 384, 36);
    let y = 86;
    if (l) {
      c.fillStyle = l.quality === 'Pure' || l.quality === 'Solid' ? '#7fe07f' : '#ffb36b'; c.font = '600 54px sans-serif'; c.fillText(l.quality || '', 36, y);
      c.fillStyle = '#fff'; c.font = '600 54px sans-serif';
      c.fillText(l.carry != null ? (l.putt ? `${(l.total / YD * 3.28).toFixed(1)} ft` : `${l.carry} yd carry · ${l.total} total`) : (l.putt ? 'Rolling…' : 'In flight…'), 300, y);
      c.font = '36px sans-serif'; c.fillStyle = '#cfe0c8'; y += 62;
      if (!l.putt) c.fillText(`Club ${l.clubMph.toFixed(0)} mph · Ball ${l.mph.toFixed(0)} mph · Smash ${l.smash.toFixed(2)}`, 36, y), y += 50,
        c.fillText(`Launch ${l.vla.toFixed(1)}° · Spin ${l.back | 0} rpm · Face ${Math.abs(l.faceToPath).toFixed(1)}° ${l.faceToPath >= 0 ? 'open' : 'closed'} to path`, 36, y), y += 50;
      else c.fillText(`Putter ${(l.clubMph / 2.237).toFixed(2)} m/s · ball ${l.speed.toFixed(2)} m/s`, 36, y), y += 50;
      if (l.offline != null && !l.putt) { c.fillText(`${Math.abs(l.offline)} yd ${l.offline >= 0 ? 'right' : 'left'} · ${l.rest}`, 36, y); y += 50; }
    }
    if (msg) { c.fillStyle = '#ffd86b'; c.font = '600 42px sans-serif'; c.fillText(msg, 36, l ? 360 : 120); }
    bigTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ play space (rig)
  const qT = new THREE.Quaternion(), vT = V3();
  function applyRig() {
    if (!S.base) { S.appliedRig.copy(S.rig); S.appliedYaw = S.yaw; return; }
    qT.setFromAxisAngle(UP, -S.yaw); vT.copy(S.rig).negate().applyQuaternion(qT);
    renderer.xr.setReferenceSpace(S.base.getOffsetReferenceSpace(new XRRigidTransform({ x: vT.x, y: vT.y, z: vT.z, w: 1 }, { x: qT.x, y: qT.y, z: qT.z, w: qT.w })));
    S.appliedRig.copy(S.rig); S.appliedYaw = S.yaw;
  }
  const toPhys = (w, out = V3()) => out.copy(w).sub(S.appliedRig).applyAxisAngle(UP, -S.appliedYaw);
  const ground = (x, z) => hAt(x, -z);
  const headWorld = () => camera.getWorldPosition(V3());
  const headFwd = () => { const d = camera.getWorldDirection(V3()); d.y = 0; return d.lengthSq() < 1e-6 ? V3(0, 0, -1) : d.normalize(); };
  // where to stand for the current ball: beside it, facing it, target on the lead side
  function addressPose() {
    const bx = sim.pos[0], by = sim.pos[1], ball3 = V3(bx, sim.pos[2], -by);
    let tx = S.pin[0] - bx, ty = S.pin[1] - by; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const T3 = V3(tx, 0, -ty), F = T3.clone().applyAxisAngle(UP, S.lefty ? Math.PI / 2 : -Math.PI / 2);
    const yaw = Math.atan2(-F.x, -F.z), stand = ball3.clone().addScaledVector(F, -0.78);
    const ph = toPhys(headWorld()), R = V3(ph.x, 0, ph.z).applyAxisAngle(UP, yaw);
    return { rig: V3(stand.x - R.x, ground(stand.x, stand.z), stand.z - R.z), yaw, F, T3, stand, ball3 };
  }
  function setupAtBall(glide = false) {
    if (!sim) return; const p = addressPose();
    // golf bag sits behind you, away from the target
    const bp = p.stand.clone().addScaledVector(p.F, -0.9).addScaledVector(p.T3, -0.6); bag.position.set(bp.x, ground(bp.x, bp.z), bp.z); bag.rotation.y = p.yaw;
    if (glide) { S.glide = { a: S.rig.clone(), b: p.rig, ya: S.yaw, yb: p.yaw, t: 0, dur: Math.min(3.5, 0.8 + S.rig.distanceTo(p.rig) / 25) }; return; }
    S.rig.copy(p.rig); S.yaw = p.yaw; S.vel.set(0, 0, 0); applyRig(); S.feet = null;
  }

  // ------------------------------------------------------------ hole flow
  function placeBall(x, y) { S.holedNow = false; sim.place(x, y); S.startPos = [x, y]; S.trail.length = 0; tracer.geometry.setDrawRange(0, 0); landMark.visible = false; }
  function newHole(n) {
    const hi = holeInfo(n); S.hole = n; S.pin = hi.pin; S.strokes = 0; S.last = null;
    if (pinObj) world.remove(pinObj); pinObj = buildPin(n); const pz = course.height(hi.pin[0], hi.pin[1]); pinObj.position.set(hi.pin[0], pz, -hi.pin[1]); world.add(pinObj);
    placeBall(hi.tee[0], hi.tee[1]); setupAtBall(); drawHud(); drawBig();
  }
  function holed() {
    S.holedNow = true; sim.state = State.Stopped; sim.vel = [0, 0, 0]; sim.pos = [S.pin[0], S.pin[1], course.height(S.pin[0], S.pin[1]) - 0.03];
    const par = holeInfo(S.hole).par, d = S.strokes - par, names = { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };
    S.cards[S.hole] = S.strokes; store.set('cards', S.cards);
    sfx.cup(); if (d < 0) sfx.cheer(); haptic(clubHand(), 0.6, 200);
    if (S.last) { S.last.carry = Math.round(sim.carry * YD); S.last.total = Math.round(d2(sim.start, S.pin) * YD); }
    say(`${S.strokes === 1 ? 'HOLE IN ONE!' : names[d] ?? `+${d}`}  (${S.strokes}) · next hole soon`, 8);
    setTimeout(() => newHole(S.hole % 18 + 1), 8000);
  }

  // ------------------------------------------------------------ controllers
  const controllers = [0, 1].map(i => renderer.xr.getController(i)), grips = [0, 1].map(i => renderer.xr.getControllerGrip(i));
  controllers.forEach((c, i) => { c.addEventListener('connected', e => { c.userData.src = e.data; c.userData.hand = e.data.handedness; attach(); });
    c.addEventListener('disconnected', () => { c.userData.src = null; }); scene.add(c, grips[i]); });
  const ctrl = h => controllers.find(c => c.userData.hand === h) || controllers[h === 'right' ? 1 : 0];
  const gripOf = h => grips[controllers.indexOf(ctrl(h))];
  function attach() {
    const cg = gripOf(clubHand()), og = gripOf(offHand()); if (cg === og) return;
    cg.add(clubRoot); og.add(hud); rebuildClub();
  }
  const gp = h => ctrl(h).userData.src?.gamepad;
  const btn = (h, i) => !!gp(h)?.buttons[i]?.pressed;
  const axes = h => { const g = gp(h); return g ? [g.axes[2] || 0, g.axes[3] || 0] : [0, 0]; };
  const edge = (k, d) => { const e = d && !prevBtn[k]; prevBtn[k] = d; return e; };
  function haptic(h, str = 1, ms = 60) { try { const g = gp(h); g?.hapticActuators?.[0]?.pulse(str, ms); } catch { } }

  // ------------------------------------------------------------ club pose + swing
  const H = V3(), Q = new THREE.Quaternion(), sc = V3();
  const W = { s: V3(), t: V3(), n: V3(), u: V3(), hosel: V3(), ss: V3(), sole: V3() };
  function clubWorld() {
    const g = gripOf(clubHand()); g.updateMatrixWorld(true); g.matrixWorld.decompose(H, Q, sc);
    W.s.copy(L.s).applyQuaternion(Q); W.t.copy(L.t).applyQuaternion(Q); W.n.copy(L.n).applyQuaternion(Q); W.u.copy(L.u).applyQuaternion(Q);
    W.ss.copy(S.sweetCF).applyMatrix4(clubRoot.matrixWorld);
    W.sole.copy(W.ss).addScaledVector(W.u, -0.021);
  }
  function calibrate() {
    clubWorld();
    const B = V3(sim.pos[0], sim.pos[2], -sim.pos[1]), D = B.clone().sub(H);
    const s0 = D.clone().normalize(), t = V3(s0.x, 0, s0.z);
    if (t.length() < 0.15) { say('Club too upright — reach out to the ball', 3); return; }
    t.normalize();
    const T = V3(S.pin[0] - sim.pos[0], 0, -(S.pin[1] - sim.pos[1])).normalize();
    const n = T.clone().addScaledVector(t, -T.dot(t)).normalize();
    const Xw = S.lefty ? t.clone().negate() : t.clone(), Uw = V3().crossVectors(t, n).multiplyScalar(S.lefty ? -1 : 1).normalize(), Zw = n.clone().negate();
    const qi = Q.clone().invert(), old = S.cal;
    for (let it = 0; it < 3; it++) { // head offset depends on the shaft angle, so solve a couple of times
      const h = S.headOff, sv = D.clone().addScaledVector(Xw, -h.x).addScaledVector(Uw, -h.y).addScaledVector(Zw, -h.z), len = sv.length();
      if (len < 0.45 || len > 1.5) { S.cal = old; rebuildClub(); say(len < 0.45 ? 'Too close — step back from the ball' : 'Too far — step closer to the ball', 3); return; }
      S.cal = { s: sv.normalize().applyQuaternion(qi).toArray(), t: t.clone().applyQuaternion(qi).toArray(), n: n.clone().applyQuaternion(qi).toArray(), L: len, club: S.club };
      rebuildClub();
    }
    store.set('cal2', S.cal); haptic(clubHand(), 0.8, 120); sfx.tick();
    say('Club fitted to your grip. Swing away!', 3);
  }

  const ballW = V3(), seg = V3(), cp = V3(), dv = V3();
  function swing(now, dt) {
    clubWorld();
    S.hist.push({ t: now, p: W.ss.clone() }); while (S.hist.length > 14) S.hist.shift();
    let ref = S.hist[0]; for (const h of S.hist) if (now - h.t <= 40) { ref = h; break; }
    const vel = W.ss.clone().sub(ref.p).divideScalar(Math.max(0.008, (now - ref.t) / 1000)), sp = vel.length();
    S.speed = sp; sfx.whoosh(sp);
    if (sp > 9 && Math.floor(now / 30) % 2 === 0) haptic(clubHand(), Math.min(0.35, sp / 120), 20);
    // clubhead trail
    const ht = headTrail.geometry, ha = ht.attributes.position.array;
    if (sp > 6) { ha.copyWithin(3, 0, ha.length - 3); ha[0] = W.ss.x; ha[1] = W.ss.y; ha[2] = W.ss.z; ht.attributes.position.needsUpdate = true; ht.setDrawRange(0, Math.min(28, (ht.drawRange.count || 0) + 1)); }
    else if (ht.drawRange.count) ht.setDrawRange(0, Math.max(0, ht.drawRange.count - 2));
    if (sp < 1.2) { S.armed = true; S.fat = 0; S.turfDone = false; }
    if (!sim || sim.moving || now < S.resetAt || !S.cal) return;
    ballW.set(sim.pos[0], sim.pos[2], -sim.pos[1]);
    // turf: sole below ground just before the ball = fat
    const g = ground(W.sole.x, W.sole.z), depth = g - W.sole.y;
    if (depth > 0.006 && sp > 4) {
      const toBall = ballW.clone().sub(W.ss); toBall.y = 0; const hv = vel.clone(); hv.y = 0;
      if (toBall.length() < 0.45 && hv.dot(toBall) > 0 && S.armed) S.fat = Math.max(S.fat, depth);
      if (!S.turfDone) { S.turfDone = true; sfx.turf(Math.min(1, sp / 20)); haptic(clubHand(), 0.7, 60); }
    }
    if (!S.armed) return;
    const prev = S.hist.length > 1 ? S.hist[S.hist.length - 2].p : W.ss;
    seg.copy(W.ss).sub(prev); const l2 = seg.lengthSq();
    const tt = l2 > 1e-10 ? THREE.MathUtils.clamp(dv.copy(ballW).sub(prev).dot(seg) / l2, 0, 1) : 0;
    cp.copy(prev).addScaledVector(seg, tt); dv.copy(ballW).sub(cp);
    const toe = dv.dot(W.t), vert = -dv.dot(W.u), depthN = dv.dot(W.n);
    if (Math.abs(toe) > 0.055 || Math.abs(vert) > 0.038 || Math.abs(depthN) > 0.03) return;
    // club bottoming out under the ball (sole well below the turf at contact) also plays heavy
    const soleC = cp.clone().addScaledVector(W.u, -0.021), dC = ground(soleC.x, soleC.z) - soleC.y;
    if (dC > 0.01) S.fat = Math.max(S.fat, dC - 0.004);
    const lie = course.surface(sim.pos[0], sim.pos[1]);
    const r = computeStrike(CLUBS[S.club], toSim(vel), toSim(W.n), lie, 0, { toe, vert, fat: S.fat, lefty: S.lefty });
    if (!r.ok) return;
    S.armed = false; S.hist.length = 0; S.strokes++; S.landedShown = false;
    sim.wind = ctx.sky && !params.has('nowind') ? ctx.sky.windSim() : [0, 0, 0];
    if (r.putt) sim.putt(sim.pos[0], sim.pos[1], r.speed, r.aim);
    else sim.launch(sim.pos[0], sim.pos[1], r.mph, r.vla, 0, r.back, r.side, r.aim);
    S.last = { ...r, carry: null, total: null }; S.startPos = sim.start.slice(); S.trail.length = 0; S.trailT = 1;
    if (!r.putt) S.slowUntil = now + 380;
    const power = r.putt ? Math.min(1, r.speed / 4) : Math.min(1, r.clubMph / 100);
    sfx.impact(CLUBS[S.club].type, r.quality, power); haptic(clubHand(), r.quality === 'Pure' || r.quality === 'Solid' ? 1 : 0.55, r.putt ? 40 : 120);
    if (S.fat > 0.004) sfx.turf(0.9);
    drawHud(); drawBig();
  }
  function onRest() {
    const l = S.last; if (!l) return;
    l.carry = Math.round(sim.carry * YD); l.total = Math.round(sim.total * YD);
    const hx2 = l.aim[0], hy2 = l.aim[1], dx = sim.pos[0] - sim.start[0], dy = sim.pos[1] - sim.start[1];
    l.offline = Math.round((dx * hy2 - dy * hx2) * YD); l.rest = SURF[sim.restSurface];
    const replay = why => { say(`${why} +1 stroke, replaying`, 3); S.strokes++; S.resetAt = performance.now() + 2600;
      setTimeout(() => { placeBall(S.startPos[0], S.startPos[1]); setupAtBall(true); }, 2600); };
    if (sim.state === State.InWater) replay('Water!');
    else if (sim.state === State.OutOfBounds) replay('Out of bounds!');
    else { const dp = d2(sim.pos, S.pin); say(dp < 15 ? `${(dp * 3.28).toFixed(1)} ft to the hole · X to walk up` : `${Math.round(dp * YD)} yd to go · X to walk to your ball`, 6); }
    drawHud(); drawBig();
  }

  // ------------------------------------------------------------ movement
  let turnLock = false;
  function locomotion(dt) {
    const head = headWorld();
    if (S.glide) {
      const G = S.glide; G.t += dt / G.dur; const k = G.t >= 1 ? 1 : G.t < .5 ? 4 * G.t ** 3 : 1 - (-2 * G.t + 2) ** 3 / 2;
      S.rig.lerpVectors(G.a, G.b, k); let dyw = G.yb - G.ya; dyw = Math.atan2(Math.sin(dyw), Math.cos(dyw)); S.yaw = G.ya + dyw * k;
      S.rig.y = G.a.y + (G.b.y - G.a.y) * k; applyRig(); S.vign = 0.6;
      if (G.t >= 1) { S.glide = null; setupAtBall(); }
      return;
    }
    const ballIdle = sim && !sim.moving, bw = sim ? V3(sim.pos[0], 0, -sim.pos[1]) : null;
    const atAddress = ballIdle && Math.hypot(head.x - bw.x, head.z - bw.z) < 1.6;
    const fwd = headFwd(), right = V3(-fwd.z, 0, fwd.x);
    const target = V3(); let mode = '';
    // 1) left stick walk (head-relative), click to jog
    const [lx, ly] = axes('left');
    if (Math.hypot(lx, ly) > 0.15) { const run = btn('left', 3) ? 5.5 : 2.2; target.addScaledVector(fwd, -ly * run).addScaledVector(right, lx * run); mode = 'stick'; }
    // 2) grips: never the club hand on its own (you squeeze it while swinging)
    const gO = btn(offHand(), 1) && !atAddress, gC = btn(clubHand(), 1) && !atAddress;
    const handPhys = h => { const g = gripOf(h); g.updateMatrixWorld(true); return toPhys(V3().setFromMatrixPosition(g.matrixWorld)); };
    for (const h of ['left', 'right']) { const st = handSt[h], p = handPhys(h); if (st.prev) st.pv.copy(p).sub(st.prev).divideScalar(Math.max(dt, 1 / 120)); st.prev = p; }
    if (gO && gC) { // pump both arms to run where you look
      const pump = (handSt.left.pv.length() + handSt.right.pv.length()) / 2, v = THREE.MathUtils.clamp((pump - 0.35) * 3.4, 0, 10);
      target.addScaledVector(fwd, v); mode = 'pump';
    } else if (gO) { // grab the air with the off hand and pull yourself along (gorilla style)
      const pv = handSt[offHand()].pv.clone(); pv.y = 0; const w = pv.negate().applyAxisAngle(UP, S.yaw).multiplyScalar(1.8);
      S.vel.copy(w.clampLength(0, 9)); mode = 'pull';
    }
    if (mode === 'stick' || mode === 'pump') S.vel.lerp(target, Math.min(1, dt * (mode === 'pump' ? 4 : 10)));
    else if (mode !== 'pull') S.vel.multiplyScalar(Math.exp(-(S.vel.length() > 2 ? 1.1 : 3) * dt)); // glide, then settle
    if (S.vel.lengthSq() > 1e-4) {
      S.rig.addScaledVector(S.vel, dt);
      const gy = ground(head.x + S.vel.x * dt, head.z + S.vel.z * dt); S.rig.y += (gy - S.rig.y) * Math.min(1, dt * 10);
      applyRig();
    }
    S.vign += ((S.vel.length() > 0.6 ? Math.min(0.7, S.vel.length() / 6) : 0) - S.vign) * Math.min(1, dt * 6);
    // snap turn on the right stick, around your head
    const [rx] = axes('right');
    if (Math.abs(rx) > 0.7 && !turnLock) {
      turnLock = true; const ph = toPhys(head); S.yaw += rx > 0 ? -Math.PI / 6 : Math.PI / 6;
      const R = V3(ph.x, 0, ph.z).applyAxisAngle(UP, S.yaw); S.rig.x = head.x - R.x; S.rig.z = head.z - R.z; applyRig(); sfx.tick();
    } else if (Math.abs(rx) < 0.3) turnLock = false;
  }

  function buttons(now, dt) {
    if (edge('A', btn('right', 4))) { S.club = (S.club + 1) % CLUBS.length; store.set('club', S.club); rebuildClub(); haptic('right', .3, 25); sfx.tick(); drawHud(); }
    if (edge('B', btn('right', 5))) { S.club = (S.club + CLUBS.length - 1) % CLUBS.length; store.set('club', S.club); rebuildClub(); haptic('right', .3, 25); sfx.tick(); drawHud(); }
    if (edge('X', btn('left', 4)) && sim && !sim.moving) setupAtBall(true);
    if (edge('Y', btn('left', 5))) aimLine.visible = !aimLine.visible;
    if (edge('RS', btn('right', 3)) && sim && !sim.moving) { placeBall(S.startPos[0], S.startPos[1]); setupAtBall(); say('Mulligan — ball replaced', 2); }
    const card = btn(offHand(), 0); if (card !== showCard) { showCard = card; drawHud(); }
    // trigger on the club hand: first press fits the club; hold 1.2 s at the ball to re-fit
    const trig = btn(clubHand(), 0);
    if (!S.cal) { if (edge('T', trig) && sim && !sim.moving) calibrate(); }
    else if (trig && S.speed < 0.8 && sim && !sim.moving) { S.trigT += dt; if (Math.floor(S.trigT * 10) !== Math.floor((S.trigT - dt) * 10)) drawHud(); if (S.trigT >= 1.2) { S.trigT = -10; calibrate(); } }
    else if (!trig) { if (S.trigT) { S.trigT = 0; drawHud(); } }
  }

  // ------------------------------------------------------------ avatar bits (hands, shoes)
  function avatar(dt) {
    // lead hand: on the grip above the trail hand when the off-hand controller is near the club hand
    const og = gripOf(offHand()), cg = gripOf(clubHand());
    const near = og.getWorldPosition(V3()).distanceTo(cg.getWorldPosition(V3())) < 0.3;
    if (near && fistLead.parent !== clubRoot) { clubRoot.add(fistLead); fistLead.position.copy(S.sC).multiplyScalar(-0.09); fistLead.quaternion.setFromUnitVectors(UP, S.sC); }
    if (!near && fistLead.parent !== og) { og.add(fistLead); fistLead.position.set(0, 0, 0); fistLead.quaternion.setFromUnitVectors(UP, V3(0, 0, -1)); }
    // shoes follow your head slowly (so they stay planted while you swing)
    const head = headWorld(), f = headFwd();
    const tgt = head.clone().addScaledVector(f, -0.12), yaw = Math.atan2(-f.x, -f.z);
    if (!S.feet) S.feet = { p: tgt.clone(), yaw };
    const moving = S.headPrev ? head.distanceTo(S.headPrev) / Math.max(dt, 1e-3) : 0; S.headPrev = head;
    const away = S.feet.p.distanceTo(tgt);
    if (away > 0.35 || moving > 0.8 || (sim && sim.moving)) { const k = Math.min(1, dt * (away > 0.35 ? 6 : 2)); S.feet.p.lerp(tgt, k);
      let dy = yaw - S.feet.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); S.feet.yaw += dy * k; }
    const side = V3(Math.cos(S.feet.yaw), 0, -Math.sin(S.feet.yaw));
    shoes.forEach((s, i) => { const p = S.feet.p.clone().addScaledVector(side, i ? 0.2 : -0.2); s.position.set(p.x, ground(p.x, p.z), p.z); s.rotation.y = S.feet.yaw + (i ? -0.14 : 0.14); });
  }

  // ------------------------------------------------------------ per frame
  let acc = 0, waveT = 0;
  function update(now, dt) {
    if (!S.on || !sim) return;
    locomotion(dt); buttons(now, dt); swing(now, dt); avatar(dt);
    if (sim.moving) {
      const scale = now < S.slowUntil ? 0.3 : 1; acc += dt * scale; let n = 0; const wasLanded = sim.landed;
      while (acc >= 1 / 240 && n++ < 80) { sim.step(1 / 240); acc -= 1 / 240; if (!sim.moving) break;
        if (sim.state === State.Rolling && d2(sim.pos, S.pin) < 0.054 && Math.hypot(sim.vel[0], sim.vel[1]) < 1.6) { holed(); break; } }
      if (!wasLanded && sim.landed && !S.landedShown && S.last && !S.last.putt) {
        S.landedShown = true; const c = lmC.getContext('2d'); c.clearRect(0, 0, 256, 96); c.fillStyle = 'rgba(10,22,14,.8)'; rr(c, 0, 0, 256, 96, 20);
        c.fillStyle = '#ffe066'; c.font = '600 56px sans-serif'; c.textAlign = 'center'; c.fillText(`${Math.round(sim.carry * YD)} yd`, 128, 66); c.textAlign = 'left'; lmTex.needsUpdate = true;
        landMark.position.set(sim.first[0], sim.first[2] + 0.02, -sim.first[1]); landMark.visible = true;
        sfx.land(headWorld().distanceTo(landMark.position));
      }
      if (!sim.moving) { acc = 0; if (!S.holedNow) onRest(); }
      S.trailT += dt * scale;
      if (S.trailT > 0.03 && S.trail.length < 3597) { S.trailT = 0; S.trail.push(sim.pos[0], sim.pos[2], -sim.pos[1]);
        const a = tracer.geometry.attributes.position.array; a.set(S.trail.slice(-3), S.trail.length - 3); tracer.geometry.attributes.position.needsUpdate = true; tracer.geometry.setDrawRange(0, S.trail.length / 3); }
      if (S.last && S.last.carry == null && Math.floor(now / 200) % 2 === 0) drawBig();
    }
    ball.position.set(sim.pos[0], sim.pos[2], -sim.pos[1]);
    ball.scale.setScalar(sim.state === State.Flight ? 1 + Math.min(5, headWorld().distanceTo(ball.position) / 25) : 1);
    ring.position.set(sim.pos[0], ground(ball.position.x, ball.position.z) + 0.006, -sim.pos[1]); ring.visible = !sim.moving;
    aimLine.position.copy(ball.position); aimLine.rotation.y = Math.atan2(-(S.pin[0] - sim.pos[0]), (S.pin[1] - sim.pos[1]));
    big.position.set(sim.start[0], sim.start[2] + 2.1, -sim.start[1]); big.lookAt(headWorld()); big.visible = !!(S.last || !S.cal || (S.msg && now < S.msgT));
    if (S.msg && now > S.msgT) { S.msg = ''; drawHud(); drawBig(); }
    vig.visible = S.vign > 0.02; vig.material.uniforms.a.value = S.vign;
    if (pinObj) wavePin(pinObj, (waveT += dt));
    const hw = headWorld(); sun.target.position.copy(hw); sun.position.copy(hw).addScaledVector(ctx.SUN_DIR, 900);
  }

  // ------------------------------------------------------------ enter / exit
  const vrBtn = document.createElement('button');
  vrBtn.textContent = '⛳ Enter VR'; vrBtn.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;padding:12px 20px;font-size:16px;font-weight:650;background:#e3c565;color:#1a2314;border:0;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.4);display:none';
  document.body.appendChild(vrBtn);
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (ok) vrBtn.style.display = 'block'; }).catch(() => { });
  const savedNear = camera.near, savedFar = camera.far;
  vrBtn.onclick = async () => {
    if (S.on) return;
    vrBtn.textContent = 'Loading…'; sfx.init();
    try {
      await loadPhysics(); await Promise.race([headsReady, new Promise(r => setTimeout(r, 4000))]);
      renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFramebufferScaleFactor(+params.get('scale') || 0.85);
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      session.addEventListener('end', () => { S.on = false; world.visible = false; camera.near = savedNear; camera.far = savedFar; camera.updateProjectionMatrix(); sun.castShadow = true; vrBtn.textContent = '⛳ Enter VR'; sfx.whoosh(0); });
      await renderer.xr.setSession(session);
      camera.near = 0.03; camera.far = 7000; camera.updateProjectionMatrix();
      if (!params.has('shadows')) sun.castShadow = false;
      S.base = renderer.xr.getReferenceSpace(); S.on = true; world.visible = true; vrBtn.textContent = '⛳ Enter VR';
      attach(); newHole(S.hole);
      setTimeout(() => setupAtBall(), 700);
      if (S.cal) say('Left stick walk · pump both grips to run · X: walk to ball · A/B: club', 7);
    } catch (e) { console.warn('VR start failed', e); vrBtn.textContent = '⛳ Enter VR'; alert('Could not start VR: ' + (e.message || e)); }
  };

  // debug / test hooks
  function preview() { // lay the gear out in front of the desktop camera (no headset needed)
    world.visible = true; const g = new THREE.Group(); world.add(g);
    const base = V3(-236.19, 0, -44.2); base.y = ground(base.x, base.z);
    CLUBS.forEach((c, i) => { const m = buildClub(c, V3(0, -1, 0), 0.86 * c.inch / 37, { heads }); m.position.set(base.x - 0.9 + i * 0.26, base.y + 0.86 * c.inch / 37 + 0.0, base.z); m.rotation.y = -0.5; g.add(m); });
    const f1 = buildFist(false), f2 = buildFist(true); f1.position.set(base.x - 0.4, base.y + 0.3, base.z + 0.6); f2.position.set(base.x - 0.2, base.y + 0.3, base.z + 0.6); g.add(f1, f2);
    shoes[0].position.set(base.x + 0.2, base.y, base.z + 0.7); shoes[1].position.set(base.x + 0.45, base.y, base.z + 0.7);
    bag.position.set(base.x + 1.1, base.y, base.z - 0.2);
    const p = buildPin(1); p.position.set(base.x + 0.9, base.y, base.z + 0.9); g.add(p);
    return base;
  }
  window.__crccVR = { headsReady, S, get sim() { return sim; }, CLUBS, update, loadPhysics, newHole, controllers, grips, rebuildClub, calibrate, attach, clubWorld, W, preview, setupAtBall };
  return update;
}
