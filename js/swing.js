// Turns a clubhead strike (velocity + face orientation) into launch-monitor numbers. Pure maths, no three.js.
// Frame: x east, y north, z up. Right-handed golfer.
export const CLUBS = [
  { n: 'Driver', loft: 10.5, smash: 1.48, k: 2.0 },
  { n: '3 Wood', loft: 15, smash: 1.45, k: 1.8 },
  { n: '5 Iron', loft: 27, smash: 1.38, k: 1.65 },
  { n: '7 Iron', loft: 34, smash: 1.33, k: 1.70 },
  { n: '9 Iron', loft: 42, smash: 1.28, k: 1.85 },
  { n: 'P Wedge', loft: 46, smash: 1.24, k: 2.00 },
  { n: 'S Wedge', loft: 56, smash: 1.15, k: 2.05 },
  { n: 'Putter', loft: 3, smash: 1.2, k: 0, putter: true },
];
// How the lie changes the shot: ball speed, spin, launch
export const LIE = {
  2: { v: 1, s: 1, l: 0 }, 3: { v: 1, s: 1, l: 0 }, 1: { v: 1, s: 1, l: 0 },
  7: { v: 0.93, s: 0.75, l: 1 }, 0: { v: 0.88, s: 0.6, l: 2 }, 8: { v: 0.72, s: 0.45, l: 3 },
  4: { v: 0.70, s: 0.5, l: 4 }, 6: { v: 1, s: 1, l: 0 }, 5: { v: 1, s: 1, l: 0 },
};
const MPH = 2.23694, deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// headVel: clubhead velocity m/s. faceN: face normal (unit, points toward target). lie: surface id.
export function computeStrike(club, headVel, faceN, lie = 1, refElev = 30) {
  const [vx, vy, vz] = headVel, sh = Math.hypot(vx, vy), speed = Math.hypot(vx, vy, vz);
  const fh = Math.hypot(faceN[0], faceN[1]) || 1, fx = faceN[0] / fh, fy = faceN[1] / fh;
  // club must be travelling into its face
  const into = sh > 1e-6 ? (vx * fx + vy * fy) / sh : 0;
  if (into < 0.3) return { ok: false, why: 'not moving into the face' };
  const pathAz = Math.atan2(vy, vx), faceAz = Math.atan2(fy, fx);
  const wf = club.putter ? 0.9 : 0.85;
  let sx = wf * fx + (1 - wf) * Math.cos(pathAz), sy = wf * fy + (1 - wf) * Math.sin(pathAz);
  const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl;
  const fp = deg(wrap(pathAz - faceAz)); // + = face right of path (open, for a right-hander)
  if (club.putter) {
    const v = clamp(speed * 1.2 * (LIE[lie]?.v ?? 1), 0, 8);
    if (v < 0.15) return { ok: false, why: 'too soft' };
    return { ok: true, putt: true, speed: v, aim: [sx, sy], faceAz: deg(faceAz), pathAz: deg(pathAz), faceToPath: fp, clubMph: speed * MPH };
  }
  const clubMph = Math.min(speed * MPH, 135);
  if (clubMph < 4) return { ok: false, why: 'too slow' };
  const L = LIE[lie] ?? LIE[1];
  const ballMph = Math.min(clubMph * club.smash * L.v, 190);
  const attack = clamp(deg(Math.atan2(vz, sh)), -12, 12);
  const elRaw = deg(Math.asin(clamp(faceN[2], -1, 1)));
  const dynLoft = clamp(club.loft + clamp(elRaw - refElev, -12, 12), 1, 70);
  const spinLoft = clamp(dynLoft - attack, 2, 65);
  const vla = clamp(dynLoft * (1 - 0.0105 * dynLoft) + 0.1 * attack + L.l, 2, 48);
  const back = clamp(spinLoft * ballMph * club.k * L.s, 400, 11000);
  const side = clamp(fp * 180 * (ballMph / 130), -3800, 3800);
  return { ok: true, putt: false, mph: ballMph, vla, back, side, aim: [sx, sy], faceAz: deg(faceAz), pathAz: deg(pathAz), faceToPath: fp, attack, dynLoft, clubMph };
}
