// Turns a clubhead strike (velocity + face orientation + where on the face it hit) into launch-monitor numbers.
// Pure maths, no three.js. Frame: x east, y north, z up.
export const CLUBS = [
  { n: 'Driver', type: 'driver', loft: 10.5, smash: 1.48, k: 2.0, inch: 45.5 },
  { n: '3 Wood', type: 'wood', loft: 15, smash: 1.45, k: 1.8, inch: 43 },
  { n: '5 Iron', type: 'iron', loft: 27, smash: 1.38, k: 1.65, inch: 38 },
  { n: '7 Iron', type: 'iron', loft: 34, smash: 1.33, k: 1.70, inch: 37 },
  { n: '9 Iron', type: 'iron', loft: 42, smash: 1.28, k: 1.85, inch: 36 },
  { n: 'P Wedge', type: 'wedge', loft: 46, smash: 1.24, k: 2.00, inch: 35.5 },
  { n: 'S Wedge', type: 'wedge', loft: 56, smash: 1.15, k: 2.05, inch: 35.25 },
  { n: 'Putter', type: 'putter', loft: 3, smash: 1.2, k: 0, inch: 34, putter: true },
];
// How the lie changes the shot: ball speed, spin, launch
export const LIE = {
  2: { v: 1, s: 1, l: 0 }, 3: { v: 1, s: 1, l: 0 }, 1: { v: 1, s: 1, l: 0 },
  7: { v: 0.93, s: 0.75, l: 1 }, 0: { v: 0.88, s: 0.6, l: 2 }, 8: { v: 0.72, s: 0.45, l: 3 },
  4: { v: 0.70, s: 0.5, l: 4 }, 6: { v: 1, s: 1, l: 0 }, 5: { v: 1, s: 1, l: 0 },
};
const MPH = 2.23694, deg = r => r * 180 / Math.PI;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// headVel: clubhead velocity m/s. faceN: face normal (unit, toward target). lie: surface id.
// refElev: face elevation (deg) that means "neutral loft" (0 when calibrated at address).
// contact: { toe: m (+ toward toe), vert: m (+ = struck low on the face / thin), fat: m of turf hit first, lefty }
export function computeStrike(club, headVel, faceN, lie = 1, refElev = 0, contact = {}) {
  const [vx, vy, vz] = headVel, sh = Math.hypot(vx, vy), speed = Math.hypot(vx, vy, vz);
  const fh = Math.hypot(faceN[0], faceN[1]) || 1, fx = faceN[0] / fh, fy = faceN[1] / fh;
  const into = sh > 1e-6 ? (vx * fx + vy * fy) / sh : 0;
  if (into < 0.3) return { ok: false, why: 'not moving into the face' };
  const pathAz = Math.atan2(vy, vx), faceAz = Math.atan2(fy, fx);
  const wf = club.putter ? 0.9 : 0.85;
  let sx = wf * fx + (1 - wf) * Math.cos(pathAz), sy = wf * fy + (1 - wf) * Math.sin(pathAz);
  const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl;
  const fp = deg(wrap(pathAz - faceAz)); // + = face right of path
  const toe = contact.toe || 0, vert = contact.vert || 0, fat = contact.fat || 0;
  // strike quality
  const offC = Math.abs(toe);
  let eff = 1 - Math.min(0.35, (offC / 0.02) ** 2 * 0.05);           // off-centre loses ball speed
  let quality = 'Pure', launchMul = 1, spinMul = 1;
  if (offC > 0.022) quality = toe > 0 ? 'Toe' : 'Heel';
  if (fat > 0.004) { eff *= clamp(1 - 0.25 - fat * 9, 0.25, 0.85); spinMul *= 0.8; quality = 'Fat'; }
  if (vert > 0.024) { eff *= 0.45; launchMul = 0.2; spinMul = 0.3; quality = 'Topped'; }
  else if (vert > 0.012) { eff *= 0.85; launchMul = 0.55; spinMul = 0.7; quality = 'Thin'; }
  else if (vert < -0.016 && !fat) { launchMul = 1.1; spinMul = 1.15; eff *= 0.94; quality = 'High on face'; }
  if (club.putter) {
    const v = clamp(speed * 1.2 * (LIE[lie]?.v ?? 1) * (eff * 0.5 + 0.5), 0, 8);
    if (v < 0.12) return { ok: false, why: 'too soft' };
    return { ok: true, putt: true, speed: v, aim: [sx, sy], faceAz: deg(faceAz), pathAz: deg(pathAz), faceToPath: fp, clubMph: speed * MPH, quality: quality === 'Pure' ? 'Solid' : quality };
  }
  const clubMph = Math.min(speed * MPH, 135);
  if (clubMph < 4) return { ok: false, why: 'too slow' };
  const L = LIE[lie] ?? LIE[1];
  const ballMph = Math.min(clubMph * club.smash * L.v * eff, 190);
  const attack = clamp(deg(Math.atan2(vz, sh)), -12, 12);
  const elRaw = deg(Math.asin(clamp(faceN[2], -1, 1)));
  const dynLoft = clamp(club.loft + clamp(elRaw - refElev, -12, 12), 1, 70);
  const spinLoft = clamp(dynLoft - attack, 2, 65);
  const vla = clamp((dynLoft * (1 - 0.0105 * dynLoft) + 0.1 * attack + L.l) * launchMul, 1, 48);
  const back = clamp(spinLoft * ballMph * club.k * L.s * spinMul, 300, 11000);
  let side = fp * 180 * (ballMph / 130);
  // gear effect on woods: toe hits draw, heel hits fade (mirrored for left-handers)
  if (club.type === 'driver' || club.type === 'wood') side += -(toe / 0.01) * 260 * (contact.lefty ? -1 : 1);
  side = clamp(side, -3800, 3800);
  return { ok: true, putt: false, mph: ballMph, vla, back, side, aim: [sx, sy], faceAz: deg(faceAz), pathAz: deg(pathAz), faceToPath: fp, attack, dynLoft, clubMph, quality, smash: ballMph / Math.max(clubMph, 1) };
}
