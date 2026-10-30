// The spider's body: steering, an alternating-tetrapod gait, two-bone IK legs,
// hanging on a thread, jumping, and a 2.5D look (every joint has a height and
// the shadow is offset by it). Decisions live in brain.js; this is muscles.
//
// Body frame: x = forward, y = right (screen coordinates, y down).
// Speeds and distances given to moveTo are in body units and get multiplied
// by the scale, so a small spider walks with small steps.

const BASE_Z = 11;
const SHADOW_DIR = { x: 0.42, y: 0.62 }; // light from the top-left
const KNEE_RISE = 8;
const STEP_LIFT = 8;
const ABDOMEN = { x: -19, rx: 18, ry: 14.5 }; // a big, round rear end
const SPINNERET = 36;

// Angles are measured from "forward" towards the leg's side, in degrees.
// At rest each leg is ~80% extended: seen from above a spider's legs are long
// gentle arcs, the knee is high rather than bent sideways.
const LEG_DEFS = [
  { hip: 40, foot: 48, reach: 58, femur: 28, tibia: 31, w: 1.2 },
  { hip: 72, foot: 82, reach: 56, femur: 29, tibia: 32, w: 1 },
  { hip: 106, foot: 118, reach: 52, femur: 29, tibia: 32, w: 1 },
  { hip: 140, foot: 150, reach: 62, femur: 36, tibia: 39, w: 1.05 },
];

function solveKnee(hip, foot, a, b, awayFrom) {
  const dx = foot.x - hip.x, dy = foot.y - hip.y;
  const d = clamp(Math.hypot(dx, dy), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const base = Math.atan2(dy, dx);
  const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  // Bend the knee to the side of the hip->foot line away from the body, so
  // legs arch outward and never flip between the two IK solutions.
  const bodySide = Math.sign(vcross({ x: dx, y: dy }, vsub(awayFrom, hip))) || 1;
  const ang = base - bodySide * alpha;
  return { x: hip.x + Math.cos(ang) * a, y: hip.y + Math.sin(ang) * a };
}

class Spider {
  constructor(x, y, opts = {}) {
    this.s = opts.scale || 0.62;
    this.dpr = opts.dpr || 1;
    this.pos = vec(x, y);
    this.vel = vec();
    this.heading = opts.heading ?? Math.PI / 2;
    this.turnVel = 0;
    this.mode = 'walk'; // walk | air | hang
    this.target = null;
    this.faceTarget = null;
    this.maxSpeed = 130;
    this.slowRadius = 50;
    this.arriveRadius = 4;
    this.stopGo = false;
    this.going = true;
    this.goTimer = 0;
    this.crouch = 0;
    this.crouchTarget = 0;
    this.z = BASE_Z * this.s;
    this.air = null;
    this.hang = null;
    this.wave = 0;
    this.waveTarget = 0;
    this.walkPhase = 0;
    this.stillTime = 0;
    this.nextGroup = 0;
    this.t = 0;
    this.excited = 0;
    this.pixel = false;
    this.host = null;

    this.legs = [];
    for (const side of [-1, 1]) {
      LEG_DEFS.forEach((d, i) => {
        this.legs.push({
          side, i,
          group: (i + (side > 0 ? 1 : 0)) % 2,
          hipA: (d.hip * Math.PI) / 180,
          footA: (d.foot * Math.PI) / 180,
          reach: d.reach, femur: d.femur, tibia: d.tibia, w: d.w,
          foot: vec(), z: 0, stepping: false, t: 0, dur: 0.12, from: vec(),
          target: vec(), hip: vec(), knee: vec(), free: false,
        });
      });
    }
    this.plantFeet();
    this.makeBuffers();
  }

  setScale(s) {
    this.s = s;
    this.plantFeet();
    this.makeBuffers();
  }

  plantFeet() {
    for (const leg of this.legs) {
      leg.foot = this.restPos(leg);
      leg.hip = this.hipPos(leg);
      leg.stepping = false;
      leg.z = 0;
      leg.knee = solveKnee(leg.hip, leg.foot, leg.femur * this.s, leg.tibia * this.s, this.pos);
    }
  }

  makeBuffers() {
    this.bufSize = Math.ceil(300 * this.s);
    this.shadow = document.createElement('canvas');
    this.shadow.width = this.shadow.height = Math.ceil(this.bufSize * this.dpr);
    this.sctx = this.shadow.getContext('2d');
    this.pix = document.createElement('canvas');
    this.pctx = this.pix.getContext('2d');
  }

  get fwd() { return fromAngle(this.heading); }
  get speed() { return vlen(this.vel); }

  local(f, r) {
    const s = this.s, c = Math.cos(this.heading), n = Math.sin(this.heading);
    return { x: this.pos.x + (c * f - n * r) * s, y: this.pos.y + (n * f + c * r) * s };
  }

  hipPos(leg) {
    return this.local(6 + Math.cos(leg.hipA) * 7.5, leg.side * Math.sin(leg.hipA) * 6.8);
  }

  restPos(leg) {
    return this.local(Math.cos(leg.footA) * leg.reach, leg.side * Math.sin(leg.footA) * leg.reach);
  }

  // Legs folded while jumping: front pair reaching forward, back pair trailing.
  airPos(leg) {
    const a = leg.i < 2 ? leg.footA * 0.7 : leg.footA + (Math.PI - leg.footA) * 0.35;
    const r = leg.reach * 0.85;
    return this.local(Math.cos(a) * r, leg.side * Math.sin(a) * r);
  }

  // Legs gathered around the body while dangling on silk.
  hangPos(leg) {
    const a = leg.i < 2 ? leg.footA * 0.65 : leg.footA * 0.95;
    const r = leg.reach * (leg.i < 2 ? 0.72 : 0.55);
    const twitch = Math.sin(this.t * 1.7 + leg.i * 1.3 + leg.side) * 2;
    return this.local(Math.cos(a) * r + twitch, leg.side * Math.sin(a) * r);
  }

  // Front leg raised and waving (greeting / courtship display).
  wavePos(leg) {
    const a = 0.5 + Math.sin(this.t * 7 + leg.side * 1.6) * 0.18;
    const r = leg.reach * 0.82;
    return this.local(Math.cos(a) * r, leg.side * Math.sin(a) * r);
  }

  spinneret() { return this.local(-SPINNERET, 0); }
  head() { return this.local(18, 0); }

  get arrived() {
    return this.mode === 'walk' && (!this.target || vdist(this.pos, this.target) <= this.arriveRadius * this.s + 1);
  }

  get landed() { return this.mode !== 'air'; }

  moveTo(p, opts = {}) {
    this.target = vcopy(p);
    if (opts.speed) this.maxSpeed = opts.speed;
    if (opts.slowRadius !== undefined) this.slowRadius = opts.slowRadius;
    if (opts.stopGo !== undefined) this.stopGo = opts.stopGo;
  }

  stop() { this.target = null; }

  translate(d) {
    const add = (p) => { p.x += d.x; p.y += d.y; };
    add(this.pos);
    if (this.target) add(this.target);
    for (const leg of this.legs) {
      add(leg.foot); add(leg.from); add(leg.target); add(leg.knee); add(leg.hip);
    }
    if (this.air) { add(this.air.from); add(this.air.to); }
  }

  jump(to, dur = 0.32, height = 46) {
    this.mode = 'air';
    this.air = { from: vcopy(this.pos), to: vcopy(to), t: 0, dur, height };
    this.heading = vangle(vsub(to, this.pos));
    this.target = null;
    this.vel = vec();
    for (const leg of this.legs) leg.stepping = false;
  }

  // Dangle from point A (updated every frame by the caller) on a thread that
  // pays out to `length`.
  startHang(A, length) {
    this.mode = 'hang';
    this.target = null;
    this.vel = vec();
    // Start from where the body actually is, so it never jumps.
    const spin = this.spinneret();
    const ang = Math.atan2(spin.x - A.x, spin.y - A.y);
    this.hang = { A: vcopy(A), len: vdist(A, spin), targetLen: length, ang, angVel: 0, speed: 60 };
  }

  endHang() {
    this.mode = 'walk';
    this.hang = null;
    for (const leg of this.legs) this.startStep(leg);
  }

  // Window under the anchor moved: the body lags behind and starts to swing.
  nudgeHang(d) {
    if (!this.hang) return;
    this.hang.A = vadd(this.hang.A, d);
    this.hang.ang -= clamp((0.6 * d.x) / Math.max(30, this.hang.len), -0.4, 0.4);
  }

  update(dt) {
    this.t += dt;
    this.crouch = approach(this.crouch, this.crouchTarget, 10, dt);
    this.wave = approach(this.wave, this.waveTarget, 6, dt);
    if (this.mode === 'air') return this.updateAir(dt);
    if (this.mode === 'hang') return this.updateHang(dt);
    this.updateWalk(dt);
  }

  updateWalk(dt) {
    const s = this.s;
    let desired = vec();
    let dist = 0;
    if (this.target) {
      const d = vsub(this.target, this.pos);
      dist = vlen(d);
      if (dist > this.arriveRadius * s) {
        const sp = this.maxSpeed * s * clamp(dist / Math.max(1, this.slowRadius * s), 0.15, 1);
        desired = vscale(d, sp / dist);
      }
    }

    // Real spiders move in short bursts: walk, freeze, walk.
    if (this.stopGo && vlen(desired) > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) {
        this.going = !this.going;
        this.goTimer = this.going ? rand(0.35, 1.5) : rand(0.12, 0.6);
      }
      if (!this.going) desired = vec();
    }

    // Walking sideways or backwards is fine for a spider, just slower; it
    // only turns its body when it means to go somewhere further away.
    let want = null, turnRate = 0;
    if (vlen(desired) > 0) {
      const da = vangle(desired);
      const off = Math.abs(angleDiff(this.heading, da));
      desired = vscale(desired, 0.45 + 0.55 * Math.max(0, Math.cos(off)));
      const backing = off > 2.3 && dist < 70 * s;
      if (dist > 40 * s && !backing) {
        want = da;
        turnRate = 3 + 4 * Math.min(1, vlen(this.vel) / (this.maxSpeed * s));
      }
    }
    if (this.faceTarget) {
      want = vangle(vsub(this.faceTarget, this.pos));
      turnRate = 4;
    }
    const rate = vlen(desired) > vlen(this.vel) ? 9 : 14;
    this.vel = vapproach(this.vel, desired, rate, dt);
    if (vlen(desired) === 0 && vlen(this.vel) < 1) this.vel = vec();
    this.pos = vadd(this.pos, vscale(this.vel, dt));

    const speed = vlen(this.vel);
    const before = this.heading;
    if (want !== null) {
      const diff = angleDiff(this.heading, want);
      this.heading += clamp(diff * Math.min(1, dt * 10), -turnRate * dt, turnRate * dt);
    }
    this.turnVel = (this.heading - before) / Math.max(dt, 1e-4);

    this.walkPhase += speed * dt * 0.09 / s;
    this.z = (BASE_Z - this.crouch * 4 + Math.sin(this.walkPhase * 2) * 0.8 * Math.min(1, speed / (60 * s))) * s;
    this.updateLegs(dt);
  }

  updateLegs(dt) {
    const s = this.s;
    const speed = vlen(this.vel);
    const moving = speed > 3 * s || Math.abs(this.turnVel) > 0.4;
    this.stillTime = moving ? 0 : this.stillTime + dt;
    const threshold = (moving ? 13 : this.stillTime > 0.25 ? 3.5 : Infinity) * s;
    // Feet land about half a gait cycle ahead of their rest spot, so they
    // spend the cycle sweeping from in front of the hip to behind it.
    const lead = vclampLen(vscale(this.vel, this.stepDur()), 13 * s);

    for (const leg of this.legs) {
      leg.hip = this.hipPos(leg);
      leg.target = vadd(this.restPos(leg), lead);
      leg.free = leg.i === 0 && this.wave > 0.05;
    }

    if (!this.legs.some((l) => l.stepping)) {
      const err = [0, 0];
      for (const leg of this.legs) {
        if (!leg.free) err[leg.group] = Math.max(err[leg.group], vdist(leg.foot, leg.target));
      }
      if (Math.max(err[0], err[1]) > threshold) {
        let g = this.nextGroup;
        if (err[g] < threshold * 0.35) g = 1 - g;
        for (const leg of this.legs) {
          if (!leg.free && leg.group === g && vdist(leg.foot, leg.target) > 2 * s) this.startStep(leg);
        }
        this.nextGroup = 1 - g;
      }
    }

    // A foot left too far behind (sudden dash) steps on its own.
    for (const leg of this.legs) {
      if (!leg.free && !leg.stepping && vdist(leg.foot, leg.hip) > (leg.femur + leg.tibia) * s * 0.97) this.startStep(leg);
    }

    for (const leg of this.legs) {
      if (leg.free) {
        leg.stepping = false;
        leg.foot = vlerp(leg.foot, this.wavePos(leg), 1 - Math.exp(-14 * dt));
        leg.z = (16 + Math.sin(this.t * 7 + leg.side * 1.6) * 6) * s * this.wave;
      } else if (leg.stepping) {
        leg.t = Math.min(1, leg.t + dt / leg.dur);
        leg.foot = vlerp(leg.from, leg.target, easeInOut(leg.t));
        leg.z = Math.sin(Math.PI * leg.t) * STEP_LIFT * s;
        if (leg.t >= 1) {
          leg.stepping = false;
          leg.z = 0;
        }
      } else if (leg.z > 0) {
        // A waved leg coming back down.
        this.startStep(leg);
      }
      leg.knee = solveKnee(leg.hip, leg.foot, leg.femur * s, leg.tibia * s, this.pos);
    }
  }

  startStep(leg) {
    leg.stepping = true;
    leg.t = 0;
    leg.from = vcopy(leg.foot);
    leg.dur = this.stepDur();
  }

  stepDur() { return clamp(0.18 - (vlen(this.vel) / this.s) * 0.0006, 0.055, 0.18); }

  updateAir(dt) {
    const a = this.air;
    a.t = Math.min(1, a.t + dt / a.dur);
    this.pos = vlerp(a.from, a.to, a.t);
    this.z = (BASE_Z + Math.sin(Math.PI * a.t) * a.height) * this.s;
    for (const leg of this.legs) {
      leg.hip = this.hipPos(leg);
      leg.foot = vapproach(leg.foot, this.airPos(leg), 28, dt);
      leg.z = this.z * 0.8;
      leg.knee = solveKnee(leg.hip, leg.foot, leg.femur * this.s, leg.tibia * this.s, this.pos);
    }
    if (a.t >= 1) {
      this.mode = 'walk';
      this.air = null;
      this.z = BASE_Z * this.s;
      this.crouch = 1;
      for (const leg of this.legs) leg.z = 0;
    }
  }

  updateHang(dt) {
    const h = this.hang, s = this.s;
    const step = h.speed * s * dt;
    h.len += clamp(h.targetLen - h.len, -step * 1.6, step);
    const len = Math.max(h.len, 1);
    // Pendulum, plus a little life so it never hangs perfectly still.
    h.angVel += (-(900 / Math.max(len, 25)) * Math.sin(h.ang) - 1.3 * h.angVel + Math.sin(this.t * 0.8) * 0.15) * dt;
    h.ang += h.angVel * dt;
    const dir = { x: Math.sin(h.ang), y: Math.cos(h.ang) };
    const spin = vadd(h.A, vscale(dir, len));
    const down = vangle(dir);
    this.heading += angleDiff(this.heading, down) * Math.min(1, dt * 8);
    this.pos = vadd(spin, vscale(this.fwd, SPINNERET * s)); // head down, silk from the abdomen
    this.z = approach(this.z, (BASE_Z + 7) * s, 4, dt);
    for (const leg of this.legs) {
      leg.hip = this.hipPos(leg);
      leg.foot = vapproach(leg.foot, this.hangPos(leg), 12, dt);
      leg.z = this.z * 0.9;
      leg.knee = solveKnee(leg.hip, leg.foot, leg.femur * s, leg.tibia * s, this.pos);
    }
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx) {
    if (this.pixel) return this.drawPixel(ctx);
    const persp = this.perspective();
    this.drawShadow(ctx, persp, false);
    ctx.save();
    if (persp !== 1) {
      ctx.translate(this.pos.x, this.pos.y);
      ctx.scale(persp, persp);
      ctx.translate(-this.pos.x, -this.pos.y);
    }
    this.drawLegs(ctx);
    this.drawBody(ctx);
    ctx.restore();
  }

  perspective() { return 1 + (this.z / this.s - BASE_Z) / 150; }

  // Same drawing into a low-res buffer, outlined like a sprite and blown up
  // without smoothing.
  drawPixel(ctx) {
    const px = Math.max(2, Math.round(3.4 * this.s));
    const size = this.bufSize, half = size / 2;
    const n = Math.ceil(size / px);
    if (this.pix.width !== n) {
      this.pix.width = this.pix.height = n;
      this.outline = document.createElement('canvas');
      this.outline.width = this.outline.height = n;
    }
    const pc = this.pctx;
    const ox = this.pos.x - half, oy = this.pos.y - half;
    const persp = this.perspective();
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.clearRect(0, 0, n, n);
    pc.setTransform(1 / px, 0, 0, 1 / px, -ox / px, -oy / px);
    pc.save();
    pc.translate(this.pos.x, this.pos.y);
    pc.scale(persp * 1.08, persp * 1.08);
    pc.translate(-this.pos.x, -this.pos.y);
    this.drawLegs(pc, true);
    this.drawBody(pc);
    pc.restore();

    // One-pixel light outline behind the sprite so it reads on dark windows.
    const oc = this.outline.getContext('2d');
    oc.globalCompositeOperation = 'copy';
    oc.drawImage(this.pix, 0, 0);
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = 'rgba(214,220,232,0.55)';
    oc.fillRect(0, 0, n, n);
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.globalCompositeOperation = 'destination-over';
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pc.drawImage(this.outline, dx, dy);
    pc.setTransform(1 / px, 0, 0, 1 / px, -ox / px, -oy / px);
    this.drawShadow(pc, persp, true);
    pc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pix, ox, oy, n * px, n * px);
    ctx.restore();
  }

  shadowOffset(z) { return { x: SHADOW_DIR.x * z, y: SHADOW_DIR.y * z }; }

  drawShadow(ctx, persp, hard) {
    const s = this.s, size = this.bufSize, half = size / 2;
    const sc = this.sctx;
    const ox = this.pos.x - half, oy = this.pos.y - half;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, this.shadow.width, this.shadow.height);
    sc.setTransform(this.dpr, 0, 0, this.dpr, -ox * this.dpr, -oy * this.dpr);
    sc.fillStyle = sc.strokeStyle = '#000';
    sc.lineCap = sc.lineJoin = 'round';

    const kneeZ = this.z + KNEE_RISE * s;
    for (const leg of this.legs) {
      const h = vadd(leg.hip, this.shadowOffset(this.z));
      const k = vadd(leg.knee, this.shadowOffset(Math.max(kneeZ, leg.z)));
      const f = vadd(leg.foot, this.shadowOffset(leg.z));
      sc.lineWidth = 3 * s * leg.w;
      sc.beginPath(); sc.moveTo(h.x, h.y); sc.lineTo(k.x, k.y); sc.stroke();
      sc.lineWidth = 1.9 * s * leg.w;
      sc.beginPath(); sc.moveTo(k.x, k.y); sc.lineTo(f.x, f.y); sc.stroke();
    }
    const bo = this.shadowOffset(this.z);
    const ab = vadd(this.local(ABDOMEN.x, 0), bo), ce = vadd(this.local(6, 0), bo);
    sc.beginPath(); sc.ellipse(ab.x, ab.y, ABDOMEN.rx * s * persp, ABDOMEN.ry * s * persp, this.heading, 0, TAU); sc.fill();
    sc.beginPath(); sc.ellipse(ce.x, ce.y, 11 * s * persp, 9.4 * s * persp, this.heading, 0, TAU); sc.fill();

    const lift = (this.z / s - BASE_Z) / 60; // shadows soften and fade as it rises
    ctx.save();
    ctx.globalAlpha = 0.38 * (1 - Math.min(0.6, lift));
    if (!hard) ctx.filter = `blur(${((1.4 + lift * 4) * s / 0.62).toFixed(1)}px)`;
    ctx.drawImage(this.shadow, ox, oy, size, size);
    ctx.restore();
  }

  // Red-and-blue "super spider": red femurs, blue lower legs, black joints,
  // each segment shaded like a glossy cylinder.
  drawLegs(ctx, flat) {
    const s = this.s;
    if (!flat) {
      // Faint pale halo so it stays readable on dark windows.
      ctx.save();
      ctx.strokeStyle = 'rgba(220,228,255,0.07)';
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const leg of this.legs) {
        ctx.lineWidth = (3.4 * leg.w + 1.6) * s;
        ctx.beginPath();
        ctx.moveTo(leg.hip.x, leg.hip.y);
        ctx.lineTo(leg.knee.x, leg.knee.y);
        ctx.lineTo(leg.foot.x, leg.foot.y);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const leg of this.legs) {
      const { hip, knee, foot } = leg;
      const along = vnorm(vsub(foot, knee));
      const out = vscale({ x: -along.y, y: along.x }, -leg.side);
      const mid = vadd(vlerp(knee, foot, 0.56), vscale(out, 1.1 * s));
      const w = leg.w * s;
      const segs = [
        [hip, knee, 3.7 * w, 3.0 * w, LEG_RED],
        [knee, mid, 2.8 * w, 2.1 * w, LEG_BLUE],
        [mid, foot, 2.0 * w, 0.9 * w, LEG_BLUE],
      ];
      for (const [a, b, wa, wb, colors] of segs) {
        ctx.fillStyle = flat ? colors[1] : cylinder(ctx, a, b, (wa + wb) / 2, colors);
        taper(ctx, a, b, wa, wb);
      }
      // Dark joints and claw tips.
      ctx.fillStyle = '#10121e';
      dot(ctx, knee, 1.45 * w);
      dot(ctx, mid, 1.0 * w);
      dot(ctx, foot, 0.55 * w);
      if (flat) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      dot(ctx, vadd(knee, { x: -0.45 * s, y: -0.55 * s }), 0.45 * w);
    }
  }

  drawBody(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.heading);
    ctx.scale(this.s, this.s);
    // Light direction expressed in the body frame.
    const lc = Math.cos(-this.heading), ls = Math.sin(-this.heading);
    const light = (wx, wy) => ({ x: lc * wx - ls * wy, y: ls * wx + lc * wy });

    // Pedipalps and fangs, tucked under the head.
    const tap = Math.sin(this.t * (6 + this.excited * 12)) * (0.4 + this.excited * 1.1);
    for (const side of [-1, 1]) {
      const ph = side > 0 ? tap : -tap;
      ctx.fillStyle = '#7a0a16';
      ctx.beginPath(); ctx.ellipse(16.4 + ph * 0.4, side * 4.3, 2.4, 1.1, side * 0.45, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1d33';
      ctx.beginPath(); ctx.arc(18.2 + ph, side * 4.9, 0.9, 0, TAU); ctx.fill();
    }

    // Abdomen: big glossy blue egg with a red centre panel carrying the web
    // pattern, shaded like a sphere so it stands out from the screen.
    const A = ABDOMEN;
    let l = light(-5, -6);
    let g = ctx.createRadialGradient(A.x + l.x * 1.2, l.y * 1.2, 0.5, A.x, 0, A.rx * 1.2);
    g.addColorStop(0, '#8db0ff');
    g.addColorStop(0.3, '#2a5ce0');
    g.addColorStop(0.75, '#14318f');
    g.addColorStop(1, '#0a1748');
    blob(ctx, A.x, 0, A.rx, A.ry, 2.15, -0.08);
    ctx.strokeStyle = 'rgba(220,228,255,0.12)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    g = ctx.createRadialGradient(A.x + 2 + l.x * 0.8, l.y * 0.8, 0.5, A.x, 0, A.rx);
    g.addColorStop(0, '#ff7676');
    g.addColorStop(0.4, '#d81b2c');
    g.addColorStop(1, '#7a0714');
    ctx.fillStyle = g;
    const tail = A.x - A.rx + 1.5;
    const panel = new Path2D();
    panel.moveTo(-1.5, 0);
    panel.bezierCurveTo(-6, -A.ry * 0.88, tail + 8, -A.ry * 0.76, tail, 0);
    panel.bezierCurveTo(tail + 8, A.ry * 0.76, -6, A.ry * 0.88, -1.5, 0);
    ctx.fill(panel);
    ctx.save();
    ctx.clip(panel);
    webPattern(ctx, -2, 0, -tail, 6, Math.PI, 0.9);
    ctx.restore();
    // Seam between red and blue, like a suit.
    ctx.strokeStyle = '#0a0b1c';
    ctx.lineWidth = 0.8;
    ctx.stroke(panel);
    sphereShade(ctx, A.x, 0, A.rx, l);
    ctx.restore();
    blob(ctx, A.x, 0, A.rx, A.ry, 2.15, -0.08);
    rimLight(ctx, A.x, 0, A.rx, l);
    ctx.strokeStyle = '#06081a';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    gloss(ctx, A.x + l.x * 1.3, l.y * 1.3, 6.5, 3.2, Math.atan2(l.y, l.x));
    sparkle(ctx, A.x + l.x * 1.6, l.y * 1.6, 1.3);

    // Pedicel + head: glossy red with web lines radiating from the eyes.
    ctx.fillStyle = '#12050a';
    ctx.beginPath(); ctx.ellipse(-2.5, 0, 3, 2.6, 0, 0, TAU); ctx.fill();
    l = light(-4, -5);
    g = ctx.createRadialGradient(6 + l.x, l.y, 0.5, 6, 0, 13);
    g.addColorStop(0, '#ff7a7a');
    g.addColorStop(0.35, '#e01e32');
    g.addColorStop(0.8, '#8e0a1a');
    g.addColorStop(1, '#4d0410');
    blob(ctx, 6, 0, 11, 9.4, 2.7, 0.07);
    ctx.strokeStyle = 'rgba(220,228,255,0.12)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    webPattern(ctx, 15, 0, 18, 4, Math.PI, 1.1);
    sphereShade(ctx, 6, 0, 11, l);
    ctx.restore();
    blob(ctx, 6, 0, 11, 9.4, 2.7, 0.07);
    rimLight(ctx, 6, 0, 11, l);
    ctx.strokeStyle = '#1a0308';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    gloss(ctx, 5 + l.x * 0.8, l.y * 0.8, 4, 2.2, Math.atan2(l.y, l.x));
    sparkle(ctx, 5 + l.x * 1.05, l.y * 1.05, 0.9);

    // The eyes: two big white lenses with heavy black rims, angled outward.
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(12.6, side * 4);
      ctx.rotate(side * 0.55);
      ctx.beginPath();
      ctx.moveTo(4.2, 0);
      ctx.bezierCurveTo(3.4, side * -3.2, -2.6, side * -3.4, -3.6, side * -0.6);
      ctx.bezierCurveTo(-3.8, side * 1.6, 1.8, side * 2.6, 4.2, 0);
      ctx.closePath();
      ctx.fillStyle = '#05050a';
      ctx.fill();
      ctx.scale(0.72, 0.62);
      ctx.translate(0.3, side * -0.3);
      ctx.beginPath();
      ctx.moveTo(4.2, 0);
      ctx.bezierCurveTo(3.4, side * -3.2, -2.6, side * -3.4, -3.6, side * -0.6);
      ctx.bezierCurveTo(-3.8, side * 1.6, 1.8, side * 2.6, 4.2, 0);
      ctx.closePath();
      const lg = ctx.createLinearGradient(-3, -3, 3, 3);
      lg.addColorStop(0, '#ffffff');
      lg.addColorStop(1, '#cfd8ea');
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

const LEG_RED = ['#4a0510', '#c0142a', '#ff6a72'];
const LEG_BLUE = ['#07123d', '#1f43b8', '#7a9bff'];

// Gradient across a leg segment: bright on the side facing the light.
function cylinder(ctx, a, b, w, [dark, mid, light]) {
  const m = vlerp(a, b, 0.5);
  const n = vnorm({ x: -(b.y - a.y), y: b.x - a.x });
  const toLight = vdot(n, { x: -0.55, y: -0.83 }) > 0 ? 1 : -1;
  const p0 = vadd(m, vscale(n, (toLight * w) / 2)), p1 = vsub(m, vscale(n, (toLight * w) / 2));
  const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
  g.addColorStop(0, mid);
  g.addColorStop(0.25, light);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, dark);
  return g;
}

// Web lines like a suit pattern: rays fanning out from (cx, cy) towards
// angle `dir`, joined by rings that sag back towards the centre.
function webPattern(ctx, cx, cy, R, rings, dir, lw) {
  const n = 7, spread = 1.35;
  const ang = (i) => dir - spread + (2 * spread * i) / (n - 1);
  const at = (a, r) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  ctx.strokeStyle = 'rgba(8,4,14,0.6)';
  ctx.lineWidth = lw * 0.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = at(ang(i), R);
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
  }
  for (let k = 1; k <= rings; k++) {
    const r = (R * k) / rings;
    for (let i = 0; i < n - 1; i++) {
      const p0 = at(ang(i), r), p1 = at(ang(i + 1), r), c = at((ang(i) + ang(i + 1)) / 2, r * 0.86);
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
    }
  }
  ctx.stroke();
}

// Darkens the half facing away from the light so a flat shape reads as a
// sphere. Call while clipped to the shape; `l` points towards the light.
function sphereShade(ctx, cx, cy, r, l) {
  const d = vnorm(l);
  const g = ctx.createLinearGradient(cx + d.x * r, cy + d.y * r, cx - d.x * r, cy - d.y * r);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.45, 'rgba(0,0,0,0)');
  g.addColorStop(0.8, 'rgba(0,0,30,0.3)');
  g.addColorStop(1, 'rgba(0,0,30,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r * 1.5, cy - r * 1.5, r * 3, r * 3);
}

// Thin bounce light along the shadowed edge of the current path.
function rimLight(ctx, cx, cy, r, l) {
  const d = vnorm(l);
  const g = ctx.createLinearGradient(cx + d.x * r, cy + d.y * r, cx - d.x * r, cy - d.y * r);
  g.addColorStop(0, 'rgba(160,190,255,0)');
  g.addColorStop(0.7, 'rgba(160,190,255,0)');
  g.addColorStop(1, 'rgba(170,200,255,0.6)');
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = g;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.restore();
}

// Small sharp specular point on top of the soft gloss.
function sparkle(ctx, x, y, r) {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

// Soft specular highlight.
function gloss(ctx, x, y, rx, ry, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Superellipse with an optional taper (wider front for taper > 0).
const BLOB_STEPS = 40;
function blob(ctx, cx, cy, a, b, n, taperK) {
  ctx.beginPath();
  for (let k = 0; k <= BLOB_STEPS; k++) {
    const th = (k / BLOB_STEPS) * TAU;
    const c = Math.cos(th), s = Math.sin(th);
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (1 + taperK * (x / a));
    if (k) ctx.lineTo(cx + x, cy + y);
    else ctx.moveTo(cx + x, cy + y);
  }
  ctx.closePath();
}

function taper(ctx, a, b, wa, wb) {
  const n = vnorm({ x: -(b.y - a.y), y: b.x - a.x });
  ctx.beginPath();
  ctx.moveTo(a.x + n.x * wa / 2, a.y + n.y * wa / 2);
  ctx.lineTo(b.x + n.x * wb / 2, b.y + n.y * wb / 2);
  ctx.lineTo(b.x - n.x * wb / 2, b.y - n.y * wb / 2);
  ctx.lineTo(a.x - n.x * wa / 2, a.y - n.y * wa / 2);
  ctx.closePath();
  ctx.fill();
  dot(ctx, a, wa / 2);
  dot(ctx, b, wb / 2);
}

function dot(ctx, p, r) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.fill();
}
