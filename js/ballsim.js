// Golf ball physics for the CRCC course (JS port of the Unreal C++ model).
// Frame: x east, y north, z up, metres. z = elevation - 240 m (same as the site's hAt()).
export const Surf = { Rough: 0, Fairway: 1, Green: 2, Tee: 3, Sand: 4, Water: 5, Path: 6, SemiRough: 7, Native: 8 };
export const State = { Idle: 0, Flight: 1, Rolling: 2, Stopped: 3, InWater: 4, OutOfBounds: 5 };
const G = 9.80665, R = 0.02135, M = 0.04593, AREA = Math.PI * R * R, SPIN_DECAY = 0.025;

export class Course {
  constructor(hfBuf, surfBuf) {
    const f = new Float32Array(hfBuf, 0, 5);
    this.hx0 = f[0]; this.hy0 = f[1]; this.hstep = f[2]; this.hnx = f[3] | 0; this.hny = f[4] | 0;
    this.H = new Float32Array(hfBuf, 20, this.hnx * this.hny);
    const g = new Float32Array(surfBuf, 0, 5);
    this.sx0 = g[0]; this.sy0 = g[1]; this.scell = g[2]; this.snx = g[3] | 0; this.sny = g[4] | 0;
    this.S = new Uint8Array(surfBuf, 20, this.snx * this.sny);
  }
  height(x, y) {
    const fx = Math.min(Math.max((x - this.hx0) / this.hstep, 0), this.hnx - 1.001);
    const fy = Math.min(Math.max((y - this.hy0) / this.hstep, 0), this.hny - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, H = this.H, n = this.hnx;
    const a = H[iy * n + ix], b = H[iy * n + ix + 1], c = H[(iy + 1) * n + ix], d = H[(iy + 1) * n + ix + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  normal(x, y) {
    const s = this.hstep;
    const dx = (this.height(x + s, y) - this.height(x - s, y)) / (2 * s);
    const dy = (this.height(x, y + s) - this.height(x, y - s)) / (2 * s);
    const l = Math.hypot(dx, dy, 1); return [-dx / l, -dy / l, 1 / l];
  }
  inBounds(x, y) { return x >= this.sx0 && y >= this.sy0 && x < this.sx0 + this.snx * this.scell && y < this.sy0 + this.sny * this.scell; }
  surface(x, y) {
    if (!this.inBounds(x, y)) return Surf.Rough;
    return this.S[((y - this.sy0) / this.scell | 0) * this.snx + ((x - this.sx0) / this.scell | 0)];
  }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

export class BallSim {
  constructor(course) {
    this.C = course; this.state = State.Idle;
    this.pos = [0, 0, 0]; this.vel = [0, 0, 0]; this.omega = [0, 0, 0];
    this.start = [0, 0, 0]; this.first = [0, 0, 0];
    this.wind = [0, 0, 0]; this.stimp = 10; this.rho = 1.17;
    this.time = 0; this.apex = 0; this.carry = 0; this.total = 0; this.landed = false; this.bounces = 0;
    this.restSurface = Surf.Rough; this.firstSurface = Surf.Rough;
  }
  params(s) {
    switch (s) {
      case Surf.Fairway: return [0.38, 0.45, 0.30, 0.60];
      case Surf.Green: return [0.30, 0.35, 0.56 / Math.max(this.stimp, 4), 0.85];
      case Surf.Tee: return [0.38, 0.45, 0.28, 0.60];
      case Surf.Sand: return [0, 1, 1.6, 1];
      case Surf.Path: return [0.55, 0.35, 0.08, 0.15];
      case Surf.SemiRough: return [0.30, 0.50, 0.45, 0.75];
      case Surf.Native: return [0.15, 0.65, 1.20, 0.90];
      case Surf.Water: return [0, 1, 5, 1];
      default: return [0.20, 0.60, 0.90, 0.85];
    }
  }
  place(x, y) { this.pos = [x, y, this.C.height(x, y) + R]; this.vel = [0, 0, 0]; this.omega = [0, 0, 0]; this.start = this.pos.slice(); this.state = State.Idle; }
  get moving() { return this.state === State.Flight || this.state === State.Rolling; }
  _begin(x, y) {
    this.pos = [x, y, this.C.height(x, y) + R]; this.start = this.pos.slice();
    this.time = 0; this.apex = this.pos[2]; this.carry = this.total = 0; this.landed = false; this.bounces = 0;
  }
  // aim = [ax, ay] start heading (already includes any start-line offset); hla = extra degrees, + = right
  launch(x, y, mph, vla, hla, back, side, aim) {
    this._begin(x, y);
    const al = Math.hypot(aim[0], aim[1]) || 1, ax = aim[0] / al, ay = aim[1] / al;
    const h = -hla * Math.PI / 180, c = Math.cos(h), s = Math.sin(h);
    const head = [ax * c - ay * s, ax * s + ay * c, 0];
    const V = mph * 0.44704, v = vla * Math.PI / 180;
    this.vel = [head[0] * V * Math.cos(v), head[1] * V * Math.cos(v), V * Math.sin(v)];
    const up = [0, 0, 1], cr = cross(head, up), k = 2 * Math.PI / 60;
    this.omega = [cr[0] * back * k, cr[1] * back * k, -side * k];
    this.state = State.Flight;
  }
  putt(x, y, speed, aim) {
    this._begin(x, y); this.landed = true; this.first = this.pos.slice();
    const N = this.C.normal(this.pos[0], this.pos[1]);
    let D = [aim[0], aim[1], 0]; const l = len(D) || 1; D = [D[0] / l, D[1] / l, 0];
    const d = dot(D, N); D = [D[0] - N[0] * d, D[1] - N[1] * d, D[2] - N[2] * d]; const dl = len(D) || 1;
    this.vel = [D[0] / dl * speed, D[1] / dl * speed, D[2] / dl * speed];
    const c = cross(N, this.vel); this.omega = [c[0] / R, c[1] / R, c[2] / R];
    this.state = State.Rolling;
  }
  _finish(ns, s) {
    this.state = ns; this.restSurface = s; this.vel = [0, 0, 0]; this.omega = [0, 0, 0];
    this.total = Math.hypot(this.pos[0] - this.start[0], this.pos[1] - this.start[1]);
  }
  step(dt) {
    if (!this.moving) return;
    this.time += dt;
    if (this.state === State.Flight) this._flight(dt); else this._roll(dt);
  }
  runToRest(dt = 1 / 240, maxT = 120) {
    while (this.moving && this.time < maxT) this.step(dt);
    if (this.moving) this._finish(State.Stopped, this.C.surface(this.pos[0], this.pos[1]));
  }
  _acc(v, w) {
    const vr = [v[0] - this.wind[0], v[1] - this.wind[1], v[2] - this.wind[2]], sp = len(vr);
    const a = [0, 0, -G];
    if (sp > 0.3) {
      const S = Math.min(0.8, R * len(w) / sp), Cd = 0.2123 + 0.3234 * S, Cl = S > 1e-4 ? 0.5194 * Math.pow(S, 0.4796) : 0;
      const q = 0.5 * this.rho * sp * sp * AREA / M, kd = Cd * q / sp;
      a[0] -= vr[0] * kd; a[1] -= vr[1] * kd; a[2] -= vr[2] * kd;
      const L = cross(w, vr), ll = len(L);
      if (ll * ll > 1e-9) { const kl = Cl * q / ll; a[0] += L[0] * kl; a[1] += L[1] * kl; a[2] += L[2] * kl; }
    }
    return a;
  }
  _flight(dt) {
    const v = this.vel, w = this.omega, p = this.pos, C = this.C;
    const a1 = this._acc(v, w);
    const vm = [v[0] + a1[0] * dt / 2, v[1] + a1[1] * dt / 2, v[2] + a1[2] * dt / 2];
    const a2 = this._acc(vm, w);
    const nv = [v[0] + a2[0] * dt, v[1] + a2[1] * dt, v[2] + a2[2] * dt];
    const np = [p[0] + (v[0] + nv[0]) * dt / 2, p[1] + (v[1] + nv[1]) * dt / 2, p[2] + (v[2] + nv[2]) * dt / 2];
    const dec = Math.exp(-SPIN_DECAY * dt), nw = [w[0] * dec, w[1] * dec, w[2] * dec];
    this.apex = Math.max(this.apex, np[2]);
    if (!C.inBounds(np[0], np[1])) { this.pos = np; this._finish(State.OutOfBounds, Surf.Rough); return; }
    const h = C.height(np[0], np[1]) + R;
    if (np[2] <= h && nv[2] < 0) {
      const dz0 = p[2] - (C.height(p[0], p[1]) + R), dz1 = np[2] - h;
      const f = (dz0 - dz1) > 1e-9 ? clamp(dz0 / (dz0 - dz1), 0, 1) : 1;
      const ip = [p[0] + (np[0] - p[0]) * f, p[1] + (np[1] - p[1]) * f, 0]; ip[2] = C.height(ip[0], ip[1]) + R;
      this._impact(ip, nv, nw);
    } else { this.pos = np; this.vel = nv; this.omega = nw; }
  }
  _impact(P, V, W) {
    const C = this.C, sf = C.surface(P[0], P[1]);
    this.pos = P;
    if (!this.landed) { this.landed = true; this.first = P.slice(); this.firstSurface = sf; this.carry = Math.hypot(P[0] - this.start[0], P[1] - this.start[1]); }
    if (sf === Surf.Water) { this._finish(State.InWater, sf); return; }
    const N = C.normal(P[0], P[1]), vn = dot(V, N);
    if (vn >= 0) { this.vel = V; this.omega = W; return; }
    const pm = this.params(sf); this.bounces++;
    let vt = [V[0] - N[0] * vn, V[1] - N[1] * vn, V[2] - N[2] * vn]; let w = W.slice();
    if (sf === Surf.Sand) { this.vel = vt.map(x => x * 0.15); this.omega = w.map(x => x * 0.1); this.state = State.Rolling; return; }
    const e = clamp(pm[0] * (1 - 0.020 * (-vn)), 0.04, pm[0]);
    const wn = cross(w, N), u = [vt[0] - R * wn[0], vt[1] - R * wn[1], vt[2] - R * wn[2]];
    const un = len(u), JnM = (1 + e) * (-vn);
    let dvt = [0, 0, 0];
    if (un > 1e-6) { const dv = Math.min(un / 3.5, pm[1] * JnM); dvt = [-u[0] / un * dv, -u[1] / un * dv, -u[2] / un * dv]; }
    const sinI = clamp(-vn / Math.max(1e-3, Math.sqrt(vn * vn + dot(vt, vt))), 0, 1);
    vt = [vt[0] + dvt[0], vt[1] + dvt[1], vt[2] + dvt[2]];
    const cw = cross(N, dvt); w = [w[0] - cw[0] / (0.4 * R), w[1] - cw[1] / (0.4 * R), w[2] - cw[2] / (0.4 * R)];
    const pk = clamp(1 - pm[3] * sinI, 0.05, 1); vt = vt.map(x => x * pk);
    const vnOut = e * (-vn);
    if (vnOut < 1.2) { this.vel = vt; this.omega = w; this.state = State.Rolling; }
    else { this.vel = [vt[0] + N[0] * vnOut, vt[1] + N[1] * vnOut, vt[2] + N[2] * vnOut]; this.omega = w; this.state = State.Flight; this.pos[2] += 0.001; }
  }
  _roll(dt) {
    const C = this.C, p = this.pos, sf = C.surface(p[0], p[1]);
    if (!C.inBounds(p[0], p[1])) { this._finish(State.OutOfBounds, sf); return; }
    if (sf === Surf.Water) { this._finish(State.InWater, sf); return; }
    const pm = this.params(sf), N = C.normal(p[0], p[1]);
    const vd = dot(this.vel, N);
    let v = [this.vel[0] - N[0] * vd, this.vel[1] - N[1] * vd, this.vel[2] - N[2] * vd];
    const gd = -G * N[2], gt = [0 - N[0] * (-G * N[2]), 0 - N[1] * (-G * N[2]), -G - N[2] * (-G * N[2])];
    const gn = Math.max(0.05, G * N[2]);
    const wn = cross(this.omega, N), u = [v[0] - R * wn[0], v[1] - R * wn[1], v[2] - R * wn[2]], un = len(u);
    if (un > 0.05) {
      const dv = Math.min(un / 3.5, pm[1] * gn * dt), dvt = [-u[0] / un * dv, -u[1] / un * dv, -u[2] / un * dv];
      v = [v[0] + dvt[0] + gt[0] * dt, v[1] + dvt[1] + gt[1] * dt, v[2] + dvt[2] + gt[2] * dt];
      const cw = cross(N, dvt); this.omega = [this.omega[0] - cw[0] / (0.4 * R), this.omega[1] - cw[1] / (0.4 * R), this.omega[2] - cw[2] / (0.4 * R)];
    } else {
      v = [v[0] + gt[0] * 5 / 7 * dt, v[1] + gt[1] * 5 / 7 * dt, v[2] + gt[2] * 5 / 7 * dt];
      const sp = len(v), dec = pm[2] * (sf === Surf.Green ? 1 : 1 + 0.10 * sp) * gn * dt;
      if (sp <= dec) v = [0, 0, 0]; else v = [v[0] - v[0] / sp * dec, v[1] - v[1] / sp * dec, v[2] - v[2] / sp * dec];
      const c = cross(N, v); this.omega = [c[0] / R, c[1] / R, c[2] / R];
    }
    if (len(v) < 0.02 && len(gt) * 5 / 7 <= pm[2] * gn) { this.pos[2] = C.height(p[0], p[1]) + R; this._finish(State.Stopped, sf); return; }
    const np = [p[0] + v[0] * dt, p[1] + v[1] * dt, 0], hz = C.height(np[0], np[1]) + R;
    const ballistic = p[2] + v[2] * dt - 0.5 * G * dt * dt;
    if (hz < ballistic - 0.001 && len(v) > 1.0) { this.pos = [np[0], np[1], ballistic]; this.vel = [v[0], v[1], v[2] - G * dt]; this.state = State.Flight; return; }
    np[2] = hz; this.pos = np; this.vel = v;
  }
}
