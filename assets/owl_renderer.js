/* Nuri owl preview renderer. Browser port of firmware/EyeRenderer.cpp: same geometry, same
 * per-state look table (protocol/state_params.json), same tweening and gaze patterns, so the
 * preview and the physical eyes show the same protocol the same way. Canvas2D instead of
 * TFT_eSprite, which is the only intended difference. */
(function (global) {
  'use strict';
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const DEFAULT_TTL = { proud: 6000, celebrating: 8000, confused: 5000 };

  class OwlRenderer {
    constructor(canvasL, canvasR, cfg) {
      this.ctx = [canvasL.getContext('2d'), canvasR.getContext('2d')];
      this.pal = cfg.palette; this.geo = cfg.geometry; this.table = cfg.states;
      this.state = 'idle'; this.intensity = 1; this.tau = 0.083; this.muted = false;
      this.ttlAt = 0;
      this.t = 0; this.last = performance.now();
      this.blinking = false; this.blinkStart = 0; this.blinkAmt = 0; this.nextBlink = 0;
      this.sx = 0; this.sy = 0; this.wx = 0; this.wy = 0; this.nextSaccade = 0;
      this.nudgeX = 0; this.nudgeY = 0; this.nudgeUntil = 0; this.gx = 0; this.gy = 0;
      this.pulse = 0; this.bounce = 0; this.rot = 0; this.flash = 0; this.overlay = null; this.panel = null;
      this.live = this._targets(); this._tgt = this._targets();
      this._scheduleBlink(this.last);
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }
    _eff() { return this.muted ? 'sleeping' : this.state; }
    _targets() {
      const p = this.table[this._eff()], n = this.table.idle, I = this.muted ? 1 : this.intensity;
      return {
        lidTop: [0, 1].map(e => lerp(n.lidTop[e], p.lidTop[e], I)),
        slant: [0, 1].map(e => lerp(n.slant[e], p.slant[e], I)),
        pupil: [0, 1].map(e => lerp(n.pupil[e], p.pupil[e], I)),
        bottom: lerp(n.bottom, p.bottom, I), happy: lerp(n.happy, p.happy, I), curve: lerp(n.lidCurve, p.lidCurve, I),
        gx: lerp(n.gaze.x, p.gaze.x, I), gy: lerp(n.gaze.y, p.gaze.y, I), gamp: lerp(n.gaze.amp, p.gaze.amp, I),
        pulseAmp: p.pulse.amp * I, bounce: p.bounce.px * I,
        ring: [0, 1, 2].map(k => lerp(n.ring[k], p.ring[k], I)), bright: lerp(n.bright, p.bright, I),
        scale: [0, 1].map(e => lerp(n.ringScale[e], p.ringScale[e], I)),
      };
    }
    setState(state, intensity = 1, transitionMs = 250, ttlMs) {
      if (!this.table[state]) return;
      this.state = state; this.intensity = clamp(intensity, 0, 1);
      this.tau = Math.max(transitionMs / 3000, 0.016); this.nextSaccade = 0;
      this._tgt = this._targets(); this._scheduleBlink(performance.now());
      const ttl = ttlMs !== undefined ? ttlMs : (DEFAULT_TTL[state] || 0);
      this.ttlAt = ttl ? performance.now() + ttl : 0;
    }
    setOverlay(o) { this.overlay = o || null; }   // demo only: 'offline' | 'setup' status dots (same place, size, colours and halo as the firmware)
    setPanel(l, r) { this.panel = (l || r) ? [l || '', r || ''] : null; }   // demo only: text panel as the firmware draws on the eyes
    _drawPanel(eye) {
      const c = this.ctx[eye], P = this.pal;
      c.fillStyle = rgb(P.visor); c.fillRect(0, 0, 240, 240);
      c.beginPath(); c.arc(120, 120, 112, 0, 6.2832); c.fillStyle = rgb(P.socket); c.fill();
      const ls = this.panel[eye].split('\n').slice(0, 7).map((t) => {
        if (t[0] === '^') return { t: t.slice(1), px: 40, h: 52, col: '#fff', f: 'monospace' };
        if (t[0] === '~') return { t: t.slice(1), px: 15, h: 20, col: rgb(P.rim), f: 'sans-serif' };
        if (t[0] === '!') return { t: t.slice(1), px: 26, h: 30, col: rgb(P.offline_amber), f: 'sans-serif' };
        return { t, px: 26, h: 30, col: '#fff', f: 'sans-serif' };
      });
      let y = 120 - ls.reduce((a, l) => a + l.h, 0) / 2;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const l of ls) { c.font = `${l.px}px ${l.f}`; c.fillStyle = l.col; c.fillText(l.t, 120, y + l.h / 2); y += l.h; }
    }
    setMuted(m) { if (m === this.muted) return; this.muted = m; this.tau = 0.08; this._tgt = this._targets(); }
    nudge(dx, dy, ms) { this.nudgeX = dx; this.nudgeY = dy; this.nudgeUntil = performance.now() + ms; }
    _scheduleBlink(now) {
      const b = this.table[this._eff()].blink;
      this.nextBlink = b.max_s > 0 ? now + 1000 * (b.min_s + Math.random() * (b.max_s - b.min_s)) : 0;
    }
    _loop(now) {
      let dt = Math.min((now - this.last) / 1000, 0.1); this.last = now; this.t += dt;
      if (this.ttlAt && now >= this.ttlAt) { this.ttlAt = 0; this.setState('idle', 1, 400, 0); this.onAutoIdle && this.onAutoIdle(); }
      const sp = this.table[this._eff()], L = this.live, T = this._tgt, a = 1 - Math.exp(-dt / this.tau);
      for (const k of ['lidTop', 'slant', 'pupil', 'scale']) for (let e = 0; e < 2; e++) L[k][e] += (T[k][e] - L[k][e]) * a;
      for (const k of ['bottom', 'happy', 'curve', 'gx', 'gy', 'gamp', 'pulseAmp', 'bounce', 'bright']) L[k] += (T[k] - L[k]) * a;
      for (let k = 0; k < 3; k++) L.ring[k] += (T.ring[k] - L.ring[k]) * a;
      // blink
      if (this.blinking) {
        const ph = (now - this.blinkStart) / sp.blink.ms;
        if (ph >= 1) { this.blinking = false; this.blinkAmt = 0; this._scheduleBlink(now); }
        else this.blinkAmt = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
      } else if (this.nextBlink && now >= this.nextBlink && L.lidTop[0] > 0.15) { this.blinking = true; this.blinkStart = now; }
      if (sp.blink.max_s <= 0) { this.blinking = false; this.blinkAmt = 0; }
      // gaze
      const g = sp.gaze; let tx = L.gx, ty = L.gy;
      if (g.mode === 'wander') {
        if (now >= this.nextSaccade) {
          this.wx = L.gx + (Math.random() * 2 - 1) * L.gamp; this.wy = L.gy + (Math.random() * 2 - 1) * L.gamp * 0.6;
          this.nextSaccade = now + (800 + Math.random() * 1700) / Math.max(g.speed, 0.1);
        }
        tx = this.wx; ty = this.wy;
      } else if (g.mode === 'scan') { tx = L.gx + L.gamp * Math.sin(this.t * g.speed * 2); ty = L.gy + 0.05 * Math.sin(this.t * 1.3); }
      else if (g.mode === 'drift') { tx = L.gx + L.gamp * Math.sin(this.t * g.speed); ty = L.gy + L.gamp * 0.6 * Math.cos(this.t * g.speed * 0.8); }
      else { tx = L.gx + L.gamp * Math.sin(this.t * 1.7); ty = L.gy + L.gamp * 0.7 * Math.sin(this.t * 1.1); }
      const ag = 1 - Math.exp(-dt / (g.mode === 'wander' ? 0.05 : 0.12));
      this.sx += (tx - this.sx) * ag; this.sy += (ty - this.sy) * ag;
      if (now >= this.nudgeUntil) { this.nudgeX = 0; this.nudgeY = 0; }
      const gn = 1 - Math.exp(-dt / 0.06);
      this.gx += (this.sx + this.nudgeX - this.gx) * gn; this.gy += (this.sy + this.nudgeY - this.gy) * gn;
      this.pulse = sp.pulse.hz > 0 ? L.pulseAmp * Math.sin(2 * Math.PI * sp.pulse.hz * this.t) : 0;
      this.bounce = sp.bounce.hz > 0 ? -L.bounce * Math.abs(Math.sin(Math.PI * sp.bounce.hz * this.t)) : 0;
      this.rot = (this.rot + sp.rotate_hz * 360 * dt) % 360;
      this.flash = sp.sparkle ? 0.3 * Math.sin(this.t * 9) : 0;
      this.draw(0); this.draw(1);
      requestAnimationFrame(this._loop);
    }
    draw(eye) {
      if (this.panel) { this._drawPanel(eye); return; }
      const c = this.ctx[eye], P = this.pal, G = this.geo, L = this.live;
      const cx = G.center, cy = G.center + this.bounce, R = G.socket_r, s = eye === 0 ? 1 : -1;
      const sp = this.table[this._eff()];
      const circle = (x, y, r, col) => { c.beginPath(); c.arc(x, y, Math.trunc(r), 0, 6.2832); c.fillStyle = col; c.fill(); };
      const c8 = (v) => Math.max(0, Math.min(255, Math.trunc(v)));
      const col3 = (r, g, b) => `rgb(${c8(r)},${c8(g)},${c8(b)})`;
      c.fillStyle = rgb(P.visor); c.fillRect(0, 0, 240, 240);
      // ring colour at the current brightness (same Q8 integer scaling as the firmware)
      const K = clamp(L.bright * (1 + this.pulse * 4 + this.flash), 0, 1.7);
      const RR = Math.trunc(L.ring[0]), RG = Math.trunc(L.ring[1]), RB = Math.trunc(L.ring[2]);
      const ringCol = (q8) => { const k = Math.trunc(K * q8); return col3((RR * k) >> 8, (RG * k) >> 8, (RB * k) >> 8); };
      const mixWhite = (w8) => { const k = Math.trunc(K * 256), m = (v) => (((v * (256 - w8) + 255 * w8) >> 8) * k) >> 8; return col3(m(RR), m(RG), m(RB)); };
      // ring: shifts a little with gaze (parallax: the pupil moves more)
      const gl = Math.hypot(this.gx, this.gy), gs = gl > 1 ? 1 / gl : 1;
      const gdx = this.gx * gs * G.gaze_max, gdy = this.gy * gs * G.gaze_max;
      const sc = L.scale[eye] * (1 + this.pulse * 0.6);
      const rx = cx + gdx * G.ring_gaze, ry = cy + gdy * G.ring_gaze;
      const Ro = G.ring_r * sc, W = G.ring_w * sc, Gw = G.glow_w * sc, Ri = Ro - W;
      const GLOW_OUT = [112, 70, 40, 20, 8], GLOW_IN = [76, 40, 18], GLOW_IN_R = [0, -4, -9];
      for (let j = 4; j >= 0; j--) circle(rx, ry, Ro + Gw * (j + 1) / 5, ringCol(GLOW_OUT[j]));
      circle(rx, ry, Ro, ringCol(235));
      circle(rx, ry, Ro - W * 0.22, mixWhite(150));
      circle(rx, ry, Ro - W * 0.72, ringCol(200));
      for (let j = 0; j < 3; j++) circle(rx, ry, Ri + GLOW_IN_R[j], ringCol(GLOW_IN[j]));
      circle(rx, ry, Ri - 16 * sc, rgb(P.disc));
      if (sp.rotate_hz > 0) {   // thinking: bright segment rotating around the ring
        const rm = Ro - W * 0.5, dr = W * 0.5 + 1;
        for (let j = 0; j < 9; j++) {
          const ang = (this.rot - j * 7) * 0.0174533;
          circle(rx + rm * Math.cos(ang), ry + rm * Math.sin(ang), dr, mixWhite(210 - j * 22));
        }
      }
      // pupil dot + specular highlight up-left
      const px = cx + gdx * G.pupil_gaze, py = cy + gdy * G.pupil_gaze;
      const pr = clamp(G.pupil_r * L.pupil[eye], 8, 30);
      circle(px, py, pr + 3, ringCol(56)); circle(px, py, pr, rgb(P.pupil));
      const hx = rx - Ro * 0.34 + gdx * 0.2, hy = ry - Ro * 0.36 + gdy * 0.2;
      if (sp.sparkle) {
        const k = 14 + 3 * Math.sin(this.t * 9), w = 4;
        c.fillStyle = rgb(P.highlight); c.beginPath();
        c.moveTo(hx, hy - k); c.lineTo(hx + w, hy); c.lineTo(hx, hy + k); c.lineTo(hx - w, hy); c.closePath();
        c.moveTo(hx - k, hy); c.lineTo(hx, hy - w); c.lineTo(hx + k, hy); c.lineTo(hx, hy + w); c.closePath(); c.fill();
      } else circle(hx, hy, 7 * sc, rgb(P.highlight));
      // visor slats (lids)
      const topOpen = clamp(L.lidTop[eye] * (1 - this.blinkAmt), 0, 1);
      const edgeC = lerp(cy + G.lid_closed_y, cy + G.lid_open_y, topOpen);
      const curvePx = L.curve * G.curve_px, slantPx = L.slant[eye] * 45;
      const closeAmt = clamp((0.25 - topOpen) / 0.25, 0, 1);
      const edgeY = (x) => { const u = clamp((x - cx) / R, -1.3, 1.3); return edgeC + curvePx * (1 - Math.min(1, u * u)) - slantPx * u * s; };
      let bBase = cy + 125 - L.bottom * 135 - L.happy * 45;
      bBase = lerp(bBase, edgeC + curvePx, closeAmt);
      if (bBase < cy + R + 6) { const Rc = 400 - L.happy * 280; circle(cx, bBase + Rc, Rc, rgb(P.visor)); }
      c.fillStyle = rgb(P.visor); c.beginPath(); c.moveTo(-4, -10);
      for (let x = -4; x <= 244; x += 12) c.lineTo(x, edgeY(x));
      c.lineTo(244, -10); c.closePath(); c.fill();
      if (closeAmt >= 0.98) circle(cx, cy, R + 4, rgb(P.visor));
      // closed eye = thin glowing slit along the slat edge
      if (closeAmt > 0.05) {
        const q = Math.trunc(closeAmt * 256);
        const strip = (h, col) => {
          c.fillStyle = col; c.beginPath();
          const x0 = Math.trunc(cx) - 70, x1 = Math.trunc(cx) + 70;
          c.moveTo(x0, edgeY(x0) - h);
          for (let x = x0 + 10; x <= x1; x += 10) c.lineTo(x, edgeY(x) - h);
          for (let x = x1; x >= x0; x -= 10) c.lineTo(x, edgeY(x) + h);
          c.closePath(); c.fill();
        };
        strip(5, ringCol((56 * q) >> 8)); strip(3, ringCol((150 * q) >> 8)); strip(1.5, mixWhite((140 * q) >> 8));
      }
      // status dots (setup / offline): black halo + dot, as in the firmware
      if (!this.muted && (this.overlay === 'setup' || this.overlay === 'offline')) {
        circle(cx, cy + 94, 10, rgb(P.visor)); circle(cx, cy + 94, 7, rgb(this.overlay === 'setup' ? P.setup_blue : P.offline_amber));
      }
      // privacy indicator (same place and size as the firmware)
      if (this.muted) {
        circle(cx, cy + 78, 11, rgb(P.mute_red)); c.strokeStyle = '#fff'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(cx - 7, cy + 71); c.lineTo(cx + 7, cy + 85); c.stroke();
      }
    }
  }

  // Servo-less body: keyframes mirror Servos.cpp (offsets in degrees from the safe pose).
  // Channels: t=tilt n=nod u=turn wl wr fl fr. null/undefined = keep.
  const S = (o, dw) => ({ o, dw: dw || 100 });
  const SEQ = {
    head_tilt: { sided: 1, st: [S({ t: 18 }, 700), S({ t: 0 })] },
    nod: { st: [S({ n: 14 }, 150), S({ n: -6 }), S({ n: 14 }, 150), S({ n: 0 })] },
    head_turn: { sided: 1, st: [S({ u: 22 }, 600), S({ u: 0 })] },
    wing_flap: { sided: 1, st: [S({ wl: 35, wr: 35 }, 60), S({ wl: -10, wr: -10 }, 60)] },
    foot_tap: { sided: 1, st: [S({ fl: 18, fr: 18 }, 80), S({ fl: 0, fr: 0 }, 80)] },
    hop: { st: [S({ n: 6, fl: 25, fr: 25 }, 120), S({ n: 0, fl: 0, fr: 0 }, 150)] },
    shuffle: { st: [S({ fl: 14, fr: 0 }, 90), S({ fl: 0, fr: 14 }, 90), S({ fl: 0, fr: 0 }, 40)] },
    pose_rest: { hold: 1, st: [S({ t: 0, n: 0, u: 0, wl: 0, wr: 0, fl: 0, fr: 0 }, 0)] },
    pose_curious: { hold: 1, st: [S({ t: 16, n: 6, u: 14, wl: 10, wr: 10 }, 0)] },
    pose_proud: { hold: 1, st: [S({ t: 0, n: -6, u: 0, wl: 25, wr: 25, fl: 0, fr: 0 }, 0)] },
    pose_thinking: { hold: 1, st: [S({ t: 16, fl: 18 }, 150), S({ fl: 0 }, 150), S({ fl: 18 }, 150), S({ fl: 0 }, 150)] },
    pose_celebrate: { once: 1, st: [S({ t: 0, n: 8, wl: 60, wr: 60, fl: 20, fr: 0 }, 140), S({ fl: 0, fr: 20 }, 140), S({ fl: 20, fr: 0 }, 140), S({ fl: 0, fr: 20 }, 140), S({ fl: 0, fr: 0 })] },
    pose_sleepy: { hold: 1, st: [S({ t: 0, n: -14, u: 0, wl: -15, wr: -15 }, 0)] },
  };
  const ZERO = () => ({ t: 0, n: 0, u: 0, wl: 0, wr: 0, fl: 0, fr: 0 });
  const LIM = { t: 90, n: 90, u: 90, wl: 240, wr: 240, fl: 150, fr: 150 };
  class OwlBody {
    constructor(els) { this.els = els; this.cur = ZERO(); this.tgt = ZERO(); this.queue = null; this.run = null; this.last = performance.now(); requestAnimationFrame(this._loop.bind(this)); }
    post(g) {
      if (!g || !SEQ[g.cue]) return;
      this.queue = { cue: g.cue, side: g.side || 'both', rep: g.repeat || 1, spd: clamp(g.speed || 0.6, 0.2, 1) };
      if (this.els.label) this.els.label.textContent = g.cue.replace('_', ' ');
    }
    park() { this.queue = null; this.run = null; this.tgt = ZERO(); if (this.els.label) this.els.label.textContent = 'safe pose'; }
    _apply(step, q, def) {
      const L = q.side === 'left' || q.side === 'both', R = q.side === 'right' || q.side === 'both';
      for (const k in step.o) {
        let v = step.o[k];
        if (def.sided) {
          if ((k === 'wl' || k === 'fl') && !L) v = 0;
          if ((k === 'wr' || k === 'fr') && !R) v = 0;
          if ((k === 't' || k === 'u') && q.side === 'left') v = -v;
        }
        this.tgt[k] = v;
      }
    }
    _loop(now) {
      const dt = Math.min((now - this.last) / 1000, 0.1); this.last = now;
      const spd = this.run ? this.run.q.spd : 0.5; let done = true;
      for (const k in this.cur) { const e = this.tgt[k] - this.cur[k], m = LIM[k] * spd * dt; if (Math.abs(e) > 0.4) { this.cur[k] += Math.abs(e) < m ? e : Math.sign(e) * m; done = false; } }
      if (!this.run && this.queue) { const q = this.queue; this.queue = null; const def = SEQ[q.cue]; this.run = { q, def, i: 0, rep: (def.hold || def.once) ? 1 : q.rep, dwelling: false, until: 0 }; this._apply(def.st[0], q, def); }
      else if (this.run) {
        const r = this.run;
        if (!r.dwelling && done) { r.dwelling = true; r.until = now + r.def.st[r.i].dw; }
        else if (r.dwelling && now >= r.until) {
          r.dwelling = false;
          if (++r.i >= r.def.st.length) { if (--r.rep > 0) r.i = 0; else { if (!r.def.hold) { this.tgt = ZERO(); if (this.els.label) this.els.label.textContent = 'safe pose'; } this.run = null; } }
          if (this.run) this._apply(r.def.st[r.i], r.q, r.def);
        }
      }
      const E = this.els, c = this.cur;
      E.head.style.transform = `translateY(${c.n * 0.5}px) rotate(${c.t}deg) perspective(600px) rotateY(${c.u}deg)`;
      E.wl.style.transform = `rotate(${-c.wl}deg)`; E.wr.style.transform = `rotate(${c.wr}deg)`;
      E.fl.style.transform = `translateY(${-c.fl * 0.8}px)`; E.fr.style.transform = `translateY(${-c.fr * 0.8}px)`;
      requestAnimationFrame(this._loop.bind(this));
    }
  }

  global.NuriOwlPreview = { OwlRenderer, OwlBody, DEFAULT_TTL };
})(window);
