// Synthesised sounds (no audio files): swing whoosh, club impacts, turf, landing, cup, ambient birds and wind.
export class Sfx {
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // continuous whoosh, driven by clubhead speed
    const w = ctx.createBufferSource(); w.buffer = buf; w.loop = true;
    this.wf = ctx.createBiquadFilter(); this.wf.type = 'bandpass'; this.wf.Q.value = 1.4; this.wf.frequency.value = 500;
    this.wg = ctx.createGain(); this.wg.gain.value = 0; w.connect(this.wf).connect(this.wg).connect(this.master); w.start();
    // ambient wind
    const a = ctx.createBufferSource(); a.buffer = buf; a.loop = true; const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 380;
    const ag = ctx.createGain(); ag.gain.value = 0.035; a.connect(af).connect(ag).connect(this.master); a.start(); this.windGain = ag;
    this.birdTimer = setInterval(() => { if (Math.random() < 0.45) this.bird(); }, 3200);
  }
  _burst(dur, type, freq, q, vol, when = 0) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  _tone(f0, f1, dur, vol, type = 'sine', when = 0) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  whoosh(speed) {
    if (!this.ctx) return; const t = this.ctx.currentTime, k = Math.min(1, Math.max(0, (speed - 3) / 35));
    this.wg.gain.setTargetAtTime(k * k * 0.55, t, 0.03); this.wf.frequency.setTargetAtTime(350 + speed * 45, t, 0.03);
  }
  impact(type, quality, power) {
    const v = Math.min(1, 0.35 + power * 0.65), bad = quality !== 'Pure' && quality !== 'Solid';
    if (type === 'driver' || type === 'wood') { this._burst(0.09, 'bandpass', bad ? 1800 : 3600, 3, v * 0.9); this._tone(bad ? 900 : 1700, bad ? 600 : 1300, 0.12, v * 0.25, 'triangle'); }
    else if (type === 'putter') { this._burst(0.05, 'bandpass', 1300, 4, v * 0.6); this._tone(900, 700, 0.06, v * 0.2); }
    else { this._burst(0.06, 'bandpass', bad ? 1400 : 2600, 2.5, v * 0.9); this._tone(bad ? 500 : 1100, 400, 0.07, v * 0.18, 'square'); }
  }
  turf(vol = 0.6) { this._burst(0.16, 'lowpass', 600, 0.7, vol); }
  land(dist) { this._burst(0.12, 'lowpass', 420, 0.8, 0.7 / (1 + dist / 35)); }
  cup() { [0, 0.07, 0.16, 0.28].forEach((w, i) => this._tone(1500 - i * 150, 1100, 0.05, 0.25, 'triangle', w)); this._burst(0.2, 'lowpass', 300, 1, 0.3, 0.3); }
  tick() { this._tone(2200, 2000, 0.03, 0.1, 'triangle'); }
  cheer() { this._burst(1.6, 'bandpass', 1800, 0.4, 0.25); }
  bird() { const b = 2400 + Math.random() * 1600; for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) this._tone(b, b * 1.4, 0.09, 0.03, 'sine', i * 0.13); }
}
