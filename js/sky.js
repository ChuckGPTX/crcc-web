// Dynamic sky for the CRCC model: real sun position over Cedar Rapids, Preetham sky, drifting clouds,
// stars at night, and optional live weather (cloud cover + wind) from Open-Meteo.
import * as THREE from 'three';
import { Sky } from '/vendor/Sky.js';

const LAT = 41.9779, LON = -91.6656, RAD = Math.PI / 180;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Solar position (NOAA-style approximation, good to ~0.5 degrees)
export function sunPosition(date, lat = LAT, lon = LON) {
  const d = date.getTime() / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * RAD - ra, la = lat * RAD;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { el: el / RAD, az: ((az / RAD) + 360) % 360 };
}
// Wall-clock offset of America/Chicago for a given instant (ms)
function chiOffset(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
function chiDateAtHour(h, base = new Date()) { // today (Chicago calendar day) at local hour h
  const off = chiOffset(base), wall = new Date(base.getTime() + off);
  const midnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  return new Date(midnightWall + h * 3600000 - off);
}
const chiHour = date => { const w = new Date(date.getTime() + chiOffset(date)); return w.getUTCHours() + w.getUTCMinutes() / 60; };

const CLOUD_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`;
const CLOUD_FS = `
uniform float uTime, uCover, uDay, uDark; uniform vec3 uSun, uSunCol, uSky; uniform vec2 uWind; varying vec3 vDir;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); if (d.y < 0.01) discard;
  vec2 uv = d.xz / (d.y + 0.08) * 1.6 + uWind * uTime;
  float base = fbm(uv) * 0.8 + fbm(uv * 3.1 + 4.0) * 0.2;
  float th = 1.0 - uCover;
  float den = smoothstep(th - 0.05, th + 0.32, base);
  if (den < 0.01) discard;
  float lit = clamp(1.0 - (fbm(uv + uSun.xz * 0.08) - base) * 4.0, 0.0, 1.0);
  float sil = pow(max(dot(d, uSun), 0.0), 12.0) * (1.0 - den) * 2.5;
  vec3 shade = mix(uSky * 0.55, vec3(0.42, 0.45, 0.5), 0.5) * mix(1.0, 0.55, uDark);
  vec3 col = mix(shade, uSunCol * (0.85 + 0.5 * lit), lit * 0.75 * (1.0 - uDark * 0.6)) + uSunCol * sil;
  col = mix(vec3(0.035, 0.04, 0.06), col, uDay);
  float a = den * smoothstep(0.01, 0.18, d.y) * mix(0.95, 1.0, uDark);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function initSky(ctx) {
  const { scene, renderer, sun, hemi, SUN_DIR } = ctx;
  const params = new URLSearchParams(location.search);
  // --- sky dome
  const sky = new Sky(); sky.scale.setScalar(8000); sky.renderOrder = -3; sky.frustumCulled = false; scene.add(sky);
  const U = sky.material.uniforms; U.mieCoefficient.value = 0.005; U.mieDirectionalG.value = 0.8;
  // --- clouds
  const cloudU = { uTime: { value: 0 }, uCover: { value: 0.35 }, uDay: { value: 1 }, uDark: { value: 0 }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0.55, 0.7, 0.95) }, uWind: { value: new THREE.Vector2(0.004, 0.002) } };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(3500, 48, 24), new THREE.ShaderMaterial({ uniforms: cloudU, vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false, side: THREE.BackSide }));
  clouds.renderOrder = -1; clouds.frustumCulled = false; scene.add(clouds);
  // --- stars
  const sp = new Float32Array(3000 * 3); for (let i = 0; i < 3000; i++) { const u = Math.random(), v = Math.random() * 0.95 + 0.05, th = u * Math.PI * 2, ph = Math.acos(v);
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * 3800; sp[i * 3 + 1] = Math.cos(ph) * 3800; sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 3800; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  stars.renderOrder = -2; stars.frustumCulled = false; scene.add(stars);
  // --- moon light
  const moon = new THREE.DirectionalLight(0x9db4ff, 0); moon.position.set(-300, 900, 400); scene.add(moon, moon.target);
  // --- environment (reflections / ambient) from the sky itself
  const envScene = new THREE.Scene(), envSky = new Sky(); envSky.scale.setScalar(1000); envSky.material.uniforms = U; envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer); let envRT = null, lastEnvSun = new THREE.Vector3(9, 9, 9), lastEnvCover = -1;
  scene.background = null;

  const state = { mode: params.get('time') ? 'manual' : 'live', hour: +params.get('time') || 12, weather: null, el: 45, az: 200, cover: 0.3, windMs: 0, windFrom: 0, code: 0 };
  const sunCol = new THREE.Color(), tmp = new THREE.Color();
  const dayFog = new THREE.Color(0.72, 0.78, 0.85), goldFog = new THREE.Color(0.86, 0.68, 0.52), nightFog = new THREE.Color(0.035, 0.045, 0.075), greyFog = new THREE.Color(0.62, 0.65, 0.68);

  function applySun(date) {
    const p = sunPosition(date); state.el = p.el; state.az = p.az;
    const el = p.el * RAD, az = p.az * RAD;
    SUN_DIR.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    U.sunPosition.value.copy(SUN_DIR);
    const c = state.cover, e = p.el;
    const day = sstep(-6, 6, e), sunK = sstep(-1.5, 8, e) * (1 - 0.7 * c * c);
    U.turbidity.value = 2.2 + 8 * c; U.rayleigh.value = 2.4 + 0.9 * (1 - sstep(0, 20, e)) - 1.3 * c; U.mieCoefficient.value = 0.004 + 0.004 * c; U.skyGain.value = 0.55 * (1 - 0.3 * c);
    sunCol.setRGB(1, 0.5 + 0.45 * sstep(0, 30, e), 0.28 + 0.6 * sstep(2, 40, e));
    sun.color.copy(sunCol); sun.intensity = 3.1 * sunK;
    moon.intensity = 0.32 * (1 - day);
    hemi.color.setRGB(0.07, 0.09, 0.16).lerp(tmp.setRGB(0.81, 0.89, 1.0), day);
    hemi.groundColor.setRGB(0.03, 0.035, 0.03).lerp(tmp.setRGB(0.33, 0.38, 0.23), day);
    hemi.intensity = (0.35 + 0.45 * c) * day + 0.25 * (1 - day);
    scene.environmentIntensity = 0.12 + 0.68 * day;
    renderer.toneMappingExposure = 0.95 + 0.45 * (1 - day);
    if (scene.fog) {
      const f = scene.fog.color.copy(dayFog).lerp(goldFog, (1 - sstep(2, 14, e)) * sstep(-4, 1, e)).lerp(greyFog, c * 0.6);
      f.lerp(nightFog, 1 - day); scene.fog.density = 0.00038 * (1 + c * 0.8);
      U.uHorizon.value.set(f.r, f.g, f.b);
    }
    cloudU.uSun.value.copy(SUN_DIR); cloudU.uSunCol.value.copy(sunCol).multiplyScalar(0.6 + 0.6 * day);
    cloudU.uSky.value.setRGB(0.5, 0.65, 0.92).lerp(tmp.setRGB(0.95, 0.6, 0.45), 1 - sstep(0, 12, e));
    cloudU.uDay.value = sstep(-8, 4, e); cloudU.uDark.value = clamp((c - 0.55) * 2.2, 0, 1); cloudU.uCover.value = 0.2 + 0.75 * c;
    stars.material.opacity = (1 - sstep(-12, -3, e)) * (1 - c);
    // refresh reflections when the sky changes noticeably
    if (SUN_DIR.distanceTo(lastEnvSun) > 0.02 || Math.abs(c - lastEnvCover) > 0.05) {
      lastEnvSun.copy(SUN_DIR); lastEnvCover = c;
      const old = envRT; envRT = pmrem.fromScene(envScene, 0, 0.1, 2000); scene.environment = envRT.texture; old?.dispose();
    }
  }

  // --- live weather (Open-Meteo, no key)
  async function fetchWeather() {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code&wind_speed_unit=ms`);
      const j = await r.json(), c = j.current;
      state.weather = { tempF: Math.round(c.temperature_2m * 9 / 5 + 32), cloud: c.cloud_cover, wind: c.wind_speed_10m, from: c.wind_direction_10m, code: c.weather_code, at: Date.now() };
      if (state.mode === 'live') { state.cover = c.cloud_cover / 100; state.windMs = c.wind_speed_10m; state.windFrom = c.wind_direction_10m; state.code = c.weather_code; }
      if (state.code >= 51) state.cover = Math.max(state.cover, 0.85);
      ui.update(); applySun(currentDate());
    } catch (e) { console.warn('weather', e); }
  }
  const currentDate = () => state.mode === 'live' ? new Date() : chiDateAtHour(state.hour);
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = d => COMPASS[Math.round(d / 22.5) % 16];

  // --- sunrise/sunset for presets
  function dayMarks() {
    let rise = 6.5, set = 18.5, noon = 12.5, best = -99;
    for (let m = 0; m < 1440; m += 5) { const h = m / 60, e = sunPosition(chiDateAtHour(h)).el; const ep = sunPosition(chiDateAtHour(h - 1 / 12)).el;
      if (ep < -0.8 && e >= -0.8) rise = h; if (ep >= -0.8 && e < -0.8) set = h; if (e > best) { best = e; noon = h; } }
    return { rise, set, noon };
  }
  const PRESETS = () => { const m = dayMarks(); return { Live: null, Sunrise: m.rise + 0.3, Morning: m.rise + 2.5, Noon: m.noon, Afternoon: m.noon + 3, 'Golden hour': m.set - 0.8, Sunset: m.set - 0.15, Dusk: m.set + 0.45, Night: m.set + 2.5 }; };

  // --- UI in the side panel
  const ui = (() => {
    const panel = document.querySelector('#panel footer'); if (!panel) return { update() { } };
    const box = document.createElement('div');
    box.style.cssText = 'padding:8px 16px;border-top:1px solid var(--line);color:var(--mute);font-size:12.5px;display:grid;gap:6px';
    box.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><span>Sky</span><select id="skyMode" style="flex:1;font:inherit;color:var(--ink);background:rgba(255,255,255,.07);border:1px solid var(--line);border-radius:7px;padding:4px"></select></div>
      <input id="skyHour" type="range" min="0" max="24" step="0.05" style="width:100%"><div id="skyInfo" style="font-size:11.5px"></div>`;
    panel.parentNode.insertBefore(box, panel);
    const sel = box.querySelector('#skyMode'), rng = box.querySelector('#skyHour'), info = box.querySelector('#skyInfo');
    const P = PRESETS(); for (const k of Object.keys(P)) { const o = document.createElement('option'); o.value = k; o.textContent = k === 'Live' ? 'Live (now + real weather)' : k; sel.appendChild(o); }
    const o = document.createElement('option'); o.value = 'Custom'; o.textContent = 'Custom time'; sel.appendChild(o);
    sel.value = state.mode === 'live' ? 'Live' : 'Custom';
    sel.onchange = () => { const P2 = PRESETS(); if (sel.value === 'Live') { state.mode = 'live'; if (state.weather) { state.cover = state.weather.cloud / 100; state.windMs = state.weather.wind; state.windFrom = state.weather.from; } }
      else if (sel.value !== 'Custom') { state.mode = 'manual'; state.hour = ((P2[sel.value] % 24) + 24) % 24; } applySun(currentDate()); update(); };
    rng.oninput = () => { state.mode = 'manual'; state.hour = +rng.value; sel.value = 'Custom'; applySun(currentDate()); update(); };
    function update() {
      rng.value = state.mode === 'live' ? chiHour(new Date()) : state.hour;
      const hh = state.mode === 'live' ? chiHour(new Date()) : state.hour, t = `${(Math.floor(hh) + 11) % 12 + 1}:${String(Math.floor(hh % 1 * 60)).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
      const w = state.weather;
      info.textContent = `${t} · sun ${state.el.toFixed(0)}°` + (w ? ` · ${w.tempF}°F · ${Math.round(state.cover * 100)}% cloud · wind ${Math.round(state.windMs * 2.237)} mph from ${compass(state.windFrom)}` : '');
    }
    return { update };
  })();

  applySun(currentDate()); ui.update();
  if (!params.has('noweather')) { fetchWeather(); setInterval(fetchWeather, 10 * 60 * 1000); }
  let lastSun = 0;
  const camPos = new THREE.Vector3();
  function update(now, dt, camera) {
    camera.getWorldPosition(camPos);
    sky.position.copy(camPos); clouds.position.copy(camPos); stars.position.copy(camPos);
    cloudU.uTime.value = now / 1000;
    // drift clouds with the wind (direction the air moves toward)
    const to = (state.windFrom + 180) * RAD, ws = 0.0012 + state.windMs * 0.0009;
    cloudU.uWind.value.set(Math.sin(to) * ws, -Math.cos(to) * ws);
    if (state.mode === 'live' && now - lastSun > 20000) { lastSun = now; applySun(new Date()); ui.update(); }
  }
  // wind for the ball physics, sim frame (x east, y north), m/s toward; reduced from 10 m height to ball-flight heights
  const windSim = () => { const to = (state.windFrom + 180) * RAD, s = state.windMs * 0.75; return [Math.sin(to) * s, Math.cos(to) * s, 0]; };
  const windText = () => state.windMs < 0.5 ? 'Calm' : `Wind ${Math.round(state.windMs * 2.237)} mph ${compass(state.windFrom)}`;
  return { update, state, windSim, windText, setHour(h) { state.mode = 'manual'; state.hour = h; applySun(currentDate()); ui.update(); }, setCover(c) { state.cover = c; applySun(currentDate()); ui.update(); } };
}
