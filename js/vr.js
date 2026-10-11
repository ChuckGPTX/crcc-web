// WebXR golf for the CRCC model: club on the right controller, real swing -> ball physics, gorilla-tag style movement.
import * as THREE from 'three';
import { Course, BallSim, State } from '/js/ballsim.js';
import { CLUBS, computeStrike } from '/js/swing.js';

const YD = 1.0936133, SURF_NAMES = ['Rough', 'Fairway', 'Green', 'Tee box', 'Bunker', 'Water', 'Path', 'Semi-rough', 'Native'];
const store = { get: (k, d) => { try { const v = localStorage.getItem('crccvr.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('crccvr.' + k, JSON.stringify(v)); } catch { } } };

export function initVR(ctx) {
  const { renderer, scene, camera, hAt, holes, pins, sun } = ctx;
  if (!navigator.xr) return null;
  let course = null, sim = null, loading = null;
  const loadPhysics = () => loading ||= Promise.all([fetch('/data/phys_hf.bin').then(r => r.arrayBuffer()), fetch('/data/phys_surf.bin').then(r => r.arrayBuffer())])
    .then(([h, s]) => { course = new Course(h, s); sim = new BallSim(course); });

  // ------------------------------------------------------------ state
  const S = {
    on: false, hole: +(new URLSearchParams(location.search).get('hole')) || 1, club: store.get('club', 3), strokes: 0, total: 0,
    tilt: store.get('tilt', 40), last: null, msg: '', msgT: 0, base: null, appliedRig: new THREE.Vector3(), appliedYaw: 0,
    rig: new THREE.Vector3(), yaw: 0, vel: new THREE.Vector3(), hist: [], tee: [0, 0], pin: [0, 0], startPos: [0, 0], holed: false, trail: [], trailT: 0, resetAt: 0, lastLie: 1,
  };
  const prevBtn = {};
  const hand = { left: { prev: null }, right: { prev: null } };

  // ------------------------------------------------------------ scene objects
  const world = new THREE.Group(); world.name = 'vr'; scene.add(world);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x222222 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02135, 20, 14), ballMat); ball.castShadow = false; world.add(ball);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe3c565, transparent: true, opacity: 0.7 })); world.add(ring);
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 3), 3)); trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffe27a })); trail.frustumCulled = false; world.add(trail);
  const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -40)]), new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, dashSize: 0.6, gapSize: 0.6 }));
  aimLine.computeLineDistances(); aimLine.frustumCulled = false; world.add(aimLine);

  // club (built in the grip's local frame)
  const clubGroup = new THREE.Group(); const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.035), new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.8, roughness: 0.35 }));
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xcfd6da, metalness: 0.9, roughness: 0.3 });
  const faceP = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.004), faceMat); faceP.position.z = 0.0185;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0045, 1, 8), new THREE.MeshStandardMaterial({ color: 0x9aa4ab, metalness: 0.85, roughness: 0.3 }));
  const gripM = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.011, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
  clubGroup.add(shaft, headBox, faceP, gripM);
  const sLocal = new THREE.Vector3(), rLocal = new THREE.Vector3(1, 0, 0), nLocal = new THREE.Vector3();
  function shaftLen() { return CLUBS[S.club].putter ? 0.88 : 0.95 + (CLUBS[S.club].loft < 20 ? 0.2 - CLUBS[S.club].loft * 0.006 : -0.0025 * (CLUBS[S.club].loft - 20)); }
  function buildClub() {
    const a = THREE.MathUtils.degToRad(S.tilt), L = shaftLen();
    sLocal.set(0, -Math.sin(a), -Math.cos(a)); nLocal.crossVectors(rLocal, sLocal).normalize();
    clubGroup.matrix.makeBasis(rLocal, sLocal, nLocal); clubGroup.matrixAutoUpdate = false;
    shaft.scale.set(1, L, 1); shaft.position.set(0, L / 2, 0); headBox.position.set(0, L, 0); faceP.position.set(0, L, 0.0185); gripM.position.set(0, 0.125, 0);
  }

  // wrist HUD
  const hudC = document.createElement('canvas'); hudC.width = 512; hudC.height = 320; const hx = hudC.getContext('2d');
  const hudTex = new THREE.CanvasTexture(hudC); hudTex.colorSpace = THREE.SRGBColorSpace;
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true }));
  hud.rotation.x = -Math.PI / 2.6; hud.position.set(0, 0.03, 0.02);
  // in-air big readout panel that floats in front of the tee (so you can see numbers while watching the ball)
  const bigC = document.createElement('canvas'); bigC.width = 768; bigC.height = 256; const bx = bigC.getContext('2d');
  const bigTex = new THREE.CanvasTexture(bigC); bigTex.colorSpace = THREE.SRGBColorSpace;
  const big = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5), new THREE.MeshBasicMaterial({ map: bigTex, transparent: true, depthWrite: false })); world.add(big);

  const holeInfo = n => {
    const h = holes.find(x => x.hole === n) || holes[0], f = pins.flags.find(x => x.hole === h.hole);
    return { n: h.hole, par: h.par, yards: h.yards, tee: h.line[0], pin: f ? [f.x, f.y] : h.line[h.line.length - 1] };
  };
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function say(t, secs = 4) { S.msg = t; S.msgT = performance.now() + secs * 1000; drawHud(); drawBig(); }

  function drawHud() {
    const c = hx, hi = holeInfo(S.hole), d = sim ? Math.round(dist2(sim.pos, S.pin) * YD) : hi.yards, l = S.last;
    c.clearRect(0, 0, 512, 320); c.fillStyle = 'rgba(12,24,16,.88)'; c.beginPath(); c.roundRect(0, 0, 512, 320, 28); c.fill();
    c.fillStyle = '#e3c565'; c.font = '600 44px sans-serif'; c.fillText(`Hole ${hi.n}  ·  Par ${hi.par}`, 24, 58);
    c.fillStyle = '#fff'; c.font = '600 40px sans-serif'; c.fillText(`${d} yd to pin`, 24, 112);
    c.font = '34px sans-serif'; c.fillStyle = '#cfe0c8'; c.fillText(`${CLUBS[S.club].n}   ·   Strokes ${S.strokes}`, 24, 160);
    if (l) { c.fillStyle = '#fff'; c.font = '30px sans-serif';
      c.fillText(l.putt ? `Putt ${l.speed.toFixed(1)} m/s` : `${l.mph.toFixed(0)} mph  launch ${l.vla.toFixed(1)}°  spin ${(l.back / 100 | 0) * 100}`, 24, 208);
      c.fillText(l.carry != null ? `Carry ${l.carry} yd · Total ${l.total} yd` : 'In flight…', 24, 248); }
    if (S.msg && performance.now() < S.msgT) { c.fillStyle = '#ffd86b'; c.font = '600 30px sans-serif'; c.fillText(S.msg, 24, 296); }
    hudTex.needsUpdate = true;
  }
  function drawBig() {
    const c = bx, l = S.last; c.clearRect(0, 0, 768, 256);
    if (!l && !(S.msg && performance.now() < S.msgT)) { bigTex.needsUpdate = true; return; }
    c.fillStyle = 'rgba(12,24,16,.75)'; c.beginPath(); c.roundRect(0, 0, 768, 256, 30); c.fill(); c.fillStyle = '#fff';
    c.font = '600 64px sans-serif';
    if (l && l.carry != null) c.fillText(`${l.carry} yd carry · ${l.total} total`, 30, 84);
    else if (l) c.fillText('…', 30, 84);
    c.font = '38px sans-serif'; c.fillStyle = '#cfe0c8';
    if (l && !l.putt) c.fillText(`Ball ${l.mph.toFixed(0)} mph · Launch ${l.vla.toFixed(1)}° · Spin ${l.back | 0} rpm`, 30, 146);
    if (l) c.fillText(`Club ${l.clubMph.toFixed(0)} mph · Face ${l.faceToPath >= 0 ? 'open' : 'closed'} ${Math.abs(l.faceToPath).toFixed(1)}° to path`, 30, 196);
    if (l && l.offline != null) c.fillText(`Offline ${Math.abs(l.offline)} yd ${l.offline >= 0 ? 'right' : 'left'} · ${l.rest || ''}`, 30, 240);
    if (S.msg && performance.now() < S.msgT) { c.fillStyle = '#ffd86b'; c.font = '600 44px sans-serif'; c.fillText(S.msg, 30, 240); }
    bigTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ rig (player position) helpers
  const yAxis = new THREE.Vector3(0, 1, 0), qTmp = new THREE.Quaternion(), vTmp = new THREE.Vector3();
  function applyRig() {
    if (!S.base) return;
    qTmp.setFromAxisAngle(yAxis, -S.yaw);
    vTmp.copy(S.rig).negate().applyQuaternion(qTmp);
    const t = new XRRigidTransform({ x: vTmp.x, y: vTmp.y, z: vTmp.z, w: 1 }, { x: qTmp.x, y: qTmp.y, z: qTmp.z, w: qTmp.w });
    renderer.xr.setReferenceSpace(S.base.getOffsetReferenceSpace(t));
    S.appliedRig.copy(S.rig); S.appliedYaw = S.yaw;
  }
  const toPhysical = (w, out) => out.copy(w).sub(S.appliedRig).applyAxisAngle(yAxis, -S.appliedYaw);
  const toWorldDir = (d, out) => out.copy(d).applyAxisAngle(yAxis, S.yaw);
  function groundY(x, z) { return hAt(x, -z); }
  // stand beside the ball facing it, with the target line on the left (right-handed setup)
  function setupAtBall() {
    if (!sim) return;
    const bx = sim.pos[0], by = sim.pos[1], ball3 = new THREE.Vector3(bx, sim.pos[2], -by);
    let tx = S.pin[0] - bx, ty = S.pin[1] - by; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; // target dir (east,north)
    const T3 = new THREE.Vector3(tx, 0, -ty), F = T3.clone().applyAxisAngle(yAxis, -Math.PI / 2); // facing dir: target on the left
    S.yaw = Math.atan2(-F.x, -F.z);
    // head (physical) position -> make head xz land at (ball - F*0.8)
    const stand = ball3.clone().addScaledVector(F, -0.8);
    const head = camera.position.clone(); const ph = toPhysical(head, new THREE.Vector3());
    const R = new THREE.Vector3(ph.x, 0, ph.z).applyAxisAngle(yAxis, S.yaw);
    S.rig.set(stand.x - R.x, groundY(stand.x, stand.z), stand.z - R.z); S.vel.set(0, 0, 0);
    applyRig();
  }

  // ------------------------------------------------------------ shots
  function placeBall(x, y) { sim.place(x, y); S.startPos = [x, y]; S.trail.length = 0; trailGeo.setDrawRange(0, 0); S.holed = false; }
  function newHole(n) {
    const hi = holeInfo(n); S.hole = n; S.tee = hi.tee; S.pin = hi.pin; S.strokes = 0; S.last = null;
    placeBall(hi.tee[0], hi.tee[1]); setupAtBall(); drawHud(); drawBig();
  }
  const gripPos = new THREE.Vector3(), gripQ = new THREE.Quaternion(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), headNow = new THREE.Vector3();
  function ctrl(handed) { for (const c of controllers) if (c.userData.hand === handed) return c; return handed === 'right' ? controllers[1] : controllers[0]; }
  function haptic(handed, str = 1, ms = 70) {
    try { const gp = ctrl(handed).userData.src?.gamepad; gp?.hapticActuators?.[0]?.pulse(str, ms); gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: str, weakMagnitude: str }); } catch { }
  }
  function tryStrike(now, dt, gripObj) {
    const club = CLUBS[S.club];
    gripObj.updateMatrixWorld(true); gripObj.matrixWorld.decompose(gripPos, gripQ, tmpA);
    const sW = sLocal.clone().applyQuaternion(gripQ), rW = rLocal.clone().applyQuaternion(gripQ), nW = nLocal.clone().applyQuaternion(gripQ);
    headNow.copy(gripPos).addScaledVector(sW, shaftLen());
    S.hist.push({ t: now, p: headNow.clone() }); while (S.hist.length > 12) S.hist.shift();
    // closest approach of the swept head segment to the ball
    const prev = S.hist.length > 1 ? S.hist[S.hist.length - 2].p : headNow;
    const b = new THREE.Vector3(sim.pos[0], sim.pos[2], -sim.pos[1]);
    const seg = tmpB.copy(headNow).sub(prev), sl2 = seg.lengthSq();
    const tt = sl2 > 1e-10 ? THREE.MathUtils.clamp(b.clone().sub(prev).dot(seg) / sl2, 0, 1) : 0;
    const closest = prev.clone().addScaledVector(seg, tt), d = closest.distanceTo(b);
    if (sim.moving || performance.now() < S.resetAt || d > 0.075) return;
    // velocity over ~35 ms before contact
    let ref = S.hist[0]; for (const h of S.hist) { if (now - h.t <= 45) { ref = h; break; } }
    const dtv = Math.max(0.008, (now - ref.t) / 1000); const v3 = headNow.clone().sub(ref.p).divideScalar(dtv);
    const lie = course.surface(sim.pos[0], sim.pos[1]);
    const r = computeStrike(club, [v3.x, -v3.z, v3.y], [nW.x, -nW.z, nW.y], lie, 30);
    if (!r.ok) return;
    S.hist.length = 0; S.strokes++; S.lastLie = lie;
    if (r.putt) sim.putt(sim.pos[0], sim.pos[1], r.speed, r.aim);
    else sim.launch(sim.pos[0], sim.pos[1], r.mph, r.vla, 0, r.back, r.side, r.aim);
    S.last = { ...r, carry: null, total: null }; S.startPos = sim.start.slice(); S.trail.length = 0; S.trailT = 0;
    haptic('right', 1, 110); drawHud(); drawBig();
  }
  function onRest() {
    const l = S.last; if (!l) return;
    l.carry = Math.round(sim.carry * YD); l.total = Math.round(sim.total * YD);
    // offline distance relative to start heading
    const hx = l.aim[0], hy = l.aim[1], dx = sim.pos[0] - sim.start[0], dy = sim.pos[1] - sim.start[1];
    l.offline = Math.round((dx * hy - dy * hx) * YD * -1); // + = right
    l.rest = SURF_NAMES[sim.restSurface];
    if (sim.state === State.InWater) { say('Water! +1 stroke, replaying'); S.strokes++; S.resetAt = performance.now() + 2500; setTimeout(() => { placeBall(S.startPos[0], S.startPos[1]); setupAtBall(); }, 2500); }
    else if (sim.state === State.OutOfBounds) { say('Out of bounds! +1 stroke, replaying'); S.strokes++; S.resetAt = performance.now() + 2500; setTimeout(() => { placeBall(S.startPos[0], S.startPos[1]); setupAtBall(); }, 2500); }
    else {
      const dp = dist2(sim.pos, S.pin);
      if (dp < 0.11 && sim.restSurface === 2) { S.holed = true; say(`Holed! ${S.strokes} stroke${S.strokes > 1 ? 's' : ''} (par ${holeInfo(S.hole).par})`, 7); S.total += S.strokes;
        setTimeout(() => newHole(S.hole % 18 + 1), 7000); }
      else say(`${Math.round(dp * YD * 3)} ft to pin`, 5);
    }
    drawHud(); drawBig();
  }

  // ------------------------------------------------------------ controllers
  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)], grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  controllers.forEach((c, i) => { c.addEventListener('connected', e => { c.userData.src = e.data; c.userData.hand = e.data.handedness; attachParts(); }); scene.add(c, grips[i]); });
  function gripOf(handed) { return controllers.indexOf(ctrl(handed)) >= 0 ? grips[controllers.indexOf(ctrl(handed))] : grips[1]; }
  let attached = false;
  function attachParts() {
    const rg = gripOf('right'), lg = gripOf('left'); if (!rg || !lg || rg === lg) return;
    rg.add(clubGroup); lg.add(hud); attached = true; buildClub();
  }
  const btn = (handed, i) => { const g = ctrl(handed).userData.src?.gamepad; return !!(g && g.buttons[i] && g.buttons[i].pressed); };
  const axes = handed => { const g = ctrl(handed).userData.src?.gamepad; return g ? [g.axes[2] || 0, g.axes[3] || 0] : [0, 0]; };
  const edge = (key, down) => { const e = down && !prevBtn[key]; prevBtn[key] = down; return e; };
  let turnLock = false;

  function locomotion(dt) {
    let moved = false, anyGrab = false;
    for (const hd of ['left', 'right']) {
      const st = hand[hd], grab = btn(hd, 1);
      if (grab) {
        anyGrab = true;
        const g = gripOf(hd); g.updateMatrixWorld(true); const p = toPhysical(new THREE.Vector3().setFromMatrixPosition(g.matrixWorld), new THREE.Vector3());
        if (st.prev) {
          const d = st.prev.clone().sub(p); d.y = 0; const w = toWorldDir(d, new THREE.Vector3());
          const cap = 0.6; if (w.length() > cap) w.setLength(cap);
          S.rig.add(w); moved = true; S.vel.lerp(w.clone().divideScalar(Math.max(dt, 1 / 120)), 0.35);
        }
        st.prev = p;
      } else st.prev = null;
    }
    if (!anyGrab && S.vel.lengthSq() > 0.0004) { // momentum glide after letting go
      S.rig.addScaledVector(S.vel, dt); S.vel.multiplyScalar(Math.exp(-2.2 * dt)); moved = true;
    } else if (anyGrab && !moved) S.vel.multiplyScalar(0.5);
    if (S.vel.length() > 7) S.vel.setLength(7);
    // keep inside the model and on the ground
    if (moved) { const gy = groundY(S.rig.x, S.rig.z); S.rig.y += (gy - S.rig.y) * Math.min(1, dt * 14); applyRig(); }
    // snap turn (right stick)
    const [ax] = axes('right');
    if (Math.abs(ax) > 0.7 && !turnLock) {
      turnLock = true; const dyaw = ax > 0 ? -Math.PI / 6 : Math.PI / 6; // stick right = turn right
      const head = camera.position.clone(), ph = toPhysical(head, new THREE.Vector3());
      S.yaw += dyaw; const R = new THREE.Vector3(ph.x, 0, ph.z).applyAxisAngle(yAxis, S.yaw);
      S.rig.x = head.x - R.x; S.rig.z = head.z - R.z; applyRig();
    } else if (Math.abs(ax) < 0.3) turnLock = false;
  }

  function buttons() {
    if (edge('rA', btn('right', 4))) { S.club = (S.club + 1) % CLUBS.length; store.set('club', S.club); buildClub(); haptic('right', .3, 30); drawHud(); }
    if (edge('rB', btn('right', 5))) { S.club = (S.club + CLUBS.length - 1) % CLUBS.length; store.set('club', S.club); buildClub(); haptic('right', .3, 30); drawHud(); }
    if (edge('lX', btn('left', 4))) { setupAtBall(); say('Back at the ball', 2); }
    if (edge('lY', btn('left', 5))) { aimLine.visible = !aimLine.visible; }
    if (edge('rStick', btn('right', 3))) { if (sim && !sim.moving) { placeBall(S.startPos[0], S.startPos[1]); setupAtBall(); say('Ball reset (no penalty)', 2); } }
    // left stick up/down: adjust how the club sits in your hand (shaft angle)
    const [, ly] = axes('left');
    if (Math.abs(ly) > 0.6) { S.tilt = THREE.MathUtils.clamp(S.tilt - ly * 0.35, 10, 75); buildClub(); store.set('tilt', S.tilt); }
  }

  // ------------------------------------------------------------ per-frame
  let acc = 0, prevNow = 0;
  function update(now, dt) {
    if (!S.on || !sim) return;
    if (!attached) attachParts();
    locomotion(dt); buttons();
    if (attached) tryStrike(now, dt, gripOf('right'));
    // physics at 240 Hz
    if (sim.moving) {
      acc += dt; let n = 0; const was = sim.state;
      while (acc >= 1 / 240 && n++ < 60) { sim.step(1 / 240); acc -= 1 / 240; if (!sim.moving) break; }
      if (!sim.moving) { acc = 0; onRest(); }
      S.trailT += dt; if (S.trailT > 0.04 && S.trail.length < 899) { S.trailT = 0; S.trail.push(sim.pos[0], sim.pos[2], -sim.pos[1]); const a = trailGeo.attributes.position.array; for (let i = 0; i < S.trail.length; i++) a[i] = S.trail[i]; trailGeo.attributes.position.needsUpdate = true; trailGeo.setDrawRange(0, S.trail.length / 3); }
      if (S.last && S.last.carry == null && Math.floor(now / 250) % 2 === 0) drawBig();
    }
    ball.position.set(sim.pos[0], sim.pos[2], -sim.pos[1]);
    const flying = sim.state === State.Flight; ball.scale.setScalar(flying ? 3.5 : 1);
    ring.position.set(sim.pos[0], sim.pos[2] - 0.015, -sim.pos[1]); ring.visible = !sim.moving;
    // aim line from the ball toward the pin
    aimLine.position.copy(ball.position); aimLine.rotation.y = Math.atan2(-(S.pin[0] - sim.pos[0]), (S.pin[1] - sim.pos[1]));
    // readout panel hovers in front of the player's current look direction, anchored near the ball
    big.position.set(sim.pos[0], sim.pos[2] + 1.9, -sim.pos[1]); big.lookAt(camera.position); big.visible = !!(S.last || (S.msg && now < S.msgT));
    if (S.msg && now > S.msgT) { S.msg = ''; drawHud(); drawBig(); }
    // keep sun shadow window on the player
    sun.target.position.copy(camera.position); sun.position.copy(camera.position).addScaledVector(ctx.SUN_DIR, 900);
  }

  // ------------------------------------------------------------ enter / exit
  const vrBtn = document.createElement('button');
  vrBtn.textContent = '⛳ Enter VR'; vrBtn.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;padding:12px 20px;font-size:16px;font-weight:650;background:#e3c565;color:#1a2314;border:0;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.4);display:none';
  document.body.appendChild(vrBtn);
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (ok) vrBtn.style.display = 'block'; }).catch(() => { });
  const savedNear = camera.near, savedFar = camera.far;
  vrBtn.onclick = async () => {
    if (S.on) return;
    vrBtn.textContent = 'Loading physics…';
    try {
      await loadPhysics();
      renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFramebufferScaleFactor(+(new URLSearchParams(location.search).get('scale')) || 0.8);
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      session.addEventListener('end', () => { S.on = false; camera.near = savedNear; camera.far = savedFar; camera.updateProjectionMatrix(); sun.castShadow = true; vrBtn.textContent = '⛳ Enter VR'; });
      await renderer.xr.setSession(session);
      camera.near = 0.04; camera.far = 7000; camera.updateProjectionMatrix();
      if (!new URLSearchParams(location.search).has('shadows')) sun.castShadow = false; // keeps Quest frame rate up
      S.base = renderer.xr.getReferenceSpace(); S.on = true; vrBtn.textContent = '⛳ Enter VR';
      buildClub(); attachParts(); newHole(S.hole);
      // head pose arrives a frame later: re-seat once it is available
      setTimeout(() => { setupAtBall(); }, 700);
      say('Grip = grab the world and push · A/B = club · X = back to ball', 8);
    } catch (e) { console.warn('VR start failed', e); vrBtn.textContent = '⛳ Enter VR'; alert('Could not start VR: ' + (e.message || e)); }
  };
  window.__crccVR = { S, get sim() { return sim; }, CLUBS, update, loadPhysics, newHole, controllers, grips, buildClub };
  return update;
}
