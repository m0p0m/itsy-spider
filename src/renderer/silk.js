// Everything made of silk: loose threads, orb webs, snapped ends and the
// cocoon that traps the cursor. Silk is drawn twice (a faint dark under-stroke,
// then a light core) so it stays visible on both dark and light windows.
// Threads and webs are anchored to windows through world.js anchors.

let SHEEN = 'rgba(255,255,255,0.6)';

// Silk catches the light: a faint rainbow tint across the screen plus a slow
// bright band that sweeps over every thread.
function updateSheen(ctx, w, h, t) {
  const p = ((t * 0.045) % 1.6) - 0.3;
  const g = ctx.createLinearGradient(0, 0, w, h * 0.6);
  const tint = ['rgba(225,235,255,0.6)', 'rgba(255,228,245,0.6)', 'rgba(228,255,244,0.6)', 'rgba(255,246,222,0.6)'];
  const stops = tint.map((c, i) => [i / (tint.length - 1), c]);
  for (const d of [-0.08, 0, 0.08]) {
    const at = p + d;
    if (at > 0 && at < 1) stops.push([at, d === 0 ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.7)']);
  }
  stops.sort((a, b) => a[0] - b[0]).forEach(([at, c]) => g.addColorStop(at, c));
  SHEEN = g;
}

function strokeSilk(ctx, width = 0.8, alpha = 1, path) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(40,45,60,0.2)';
  ctx.lineWidth = width + 1;
  path ? ctx.stroke(path) : ctx.stroke();
  ctx.strokeStyle = SHEEN;
  ctx.lineWidth = width;
  ctx.shadowColor = 'rgba(210,225,255,0.55)';
  ctx.shadowBlur = 3;
  path ? ctx.stroke(path) : ctx.stroke();
  ctx.restore();
}

// A smooth curve through points (each corner rounded off at the midpoints).
function smoothPath(path, pts) {
  if (pts.length < 2) return;
  path.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) return path.lineTo(pts[1].x, pts[1].y);
  for (let i = 1; i < pts.length - 1; i++) {
    path.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  const last = pts[pts.length - 1];
  path.lineTo(last.x, last.y);
}

// Where a ray from `o` at angle `ang` leaves rectangle r.
function rayToRect(o, ang, r) {
  const d = fromAngle(ang);
  let t = Infinity;
  if (d.x > 1e-6) t = Math.min(t, (r.x + r.w - o.x) / d.x);
  if (d.x < -1e-6) t = Math.min(t, (r.x - o.x) / d.x);
  if (d.y > 1e-6) t = Math.min(t, (r.y + r.h - o.y) / d.y);
  if (d.y < -1e-6) t = Math.min(t, (r.y - o.y) / d.y);
  return vadd(o, vscale(d, Math.max(0, t)));
}

function segmentsCross(p1, p2, p3, p4) {
  const d1 = vsub(p2, p1), d2 = vsub(p4, p3);
  const den = vcross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = vcross(vsub(p3, p1), d2) / den;
  const u = vcross(vsub(p3, p1), d1) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? vadd(p1, vscale(d1, t)) : null;
}

// Silk hangs: a parabola-ish sag pulled down by gravity, a little irregular.
function silkCurve(A, B, t, opts) {
  const len = vdist(A, B);
  const n = clamp(Math.round(len / 12), 4, 48);
  const dir = len > 0 ? vscale(vsub(B, A), 1 / len) : vec(1, 0);
  const nrm = { x: -dir.y, y: dir.x };
  const sag = Math.min(len * (opts.sag ?? 0.08), 60) * (1 - Math.abs(dir.y) * 0.7);
  // Slow breeze: two drifting waves so it never looks mechanical.
  const sway = (Math.sin(t * 0.7 + opts.phase) * 0.7 + Math.sin(t * 0.43 + opts.phase * 2.3) * 0.3) * Math.min(len * 0.014, 9) +
    (opts.pluck || 0) * Math.sin(t * 30) * 8;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, bell = 4 * u * (1 - u);
    const kink = (opts.k1 * Math.sin(TAU * u) + opts.k2 * 0.6 * Math.sin(3 * Math.PI * u)) * Math.min(1.4, len / 80);
    pts.push({
      x: A.x + (B.x - A.x) * u + nrm.x * (sway * bell + kink),
      y: A.y + (B.y - A.y) * u + sag * bell + nrm.y * (sway * bell + kink),
    });
  }
  return pts;
}

function polyline(ctx, pts) {
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}

// --------------------------------------------------------------- Thread

class Thread {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.phase = rand(0, TAU);
    this.k1 = rand(-1, 1);
    this.k2 = rand(-1, 1);
    this.age = 0;
    this.alpha = 0;
    this.dying = false;
    this.falling = 0;
    this.pluck = 0;
    this.pts = [];
    this.layer = null;
  }

  get dead() { return this.dying && this.alpha <= 0; }

  update(dt, t, world) {
    this.age += dt;
    this.pluck = approach(this.pluck, 0, 2.5, dt);
    const A = world.pos(this.a), B = world.pos(this.b);
    if (!A || !B) {
      // Its window closed: the thread drops away (drawn above everything).
      this.dying = true;
      this.layer = 'top';
      this.falling += dt * 600;
      this.pts = this.pts.map((p, i) => ({ x: p.x, y: p.y + this.falling * dt * Math.sin((Math.PI * i) / Math.max(1, this.pts.length - 1)) }));
    } else {
      this.layer = world.upper(this.a.id, this.b.id);
      this.pts = silkCurve(A, B, t, this);
    }
    this.alpha = this.dying ? this.alpha - dt * 0.8 : Math.min(1, this.alpha + dt * 4);
  }

  draw(ctx) {
    if (this.pts.length < 2) return;
    ctx.beginPath();
    polyline(ctx, this.pts);
    strokeSilk(ctx, 0.75, Math.max(0, this.alpha) * 0.85);
  }

  // Index of the segment a swipe from p to q crosses, and where.
  cut(p, q) {
    for (let i = 1; i < this.pts.length; i++) {
      const hit = segmentsCross(p, q, this.pts[i - 1], this.pts[i]);
      if (hit) return hit;
    }
    return null;
  }
}

// A cut thread end springing back to its anchor.
class Snap {
  constructor(anchor, tip, layer) {
    this.anchor = anchor;
    this.tip = vcopy(tip);
    this.layer = layer;
    this.t = 0;
    this.pts = [];
  }

  get dead() { return this.t >= 1; }

  update(dt, t, world) {
    this.t += dt * 2.6;
    const A = world.pos(this.anchor);
    if (!A) { this.t = 1; return; }
    const e = easeOut(Math.min(1, this.t));
    const tip = vlerp(this.tip, A, e);
    const n = vnorm({ x: -(A.y - tip.y), y: A.x - tip.x });
    const wob = Math.sin(this.t * 28) * (1 - this.t) * 9;
    const mid = vadd(vlerp(tip, A, 0.5), vadd(vscale(n, wob), vec(0, (1 - e) * 14)));
    this.pts = [A, mid, tip];
  }

  draw(ctx) {
    if (!this.pts.length) return;
    const [A, mid, tip] = this.pts;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y);
    strokeSilk(ctx, 0.75, 1 - this.t);
  }
}

// ---------------------------------------------------------------- OrbWeb

// The web is a graph of nodes stored relative to its host window; `strokes`
// is the route the spider walks while spinning it. The spider chases the
// "pen" and the pen only advances while the spider keeps up, so the silk
// always comes out of the spider.
class OrbWeb {
  constructor(host, rect, center, R) {
    this.host = host;
    this.R = R;
    this.nodes = [];
    this.strokes = [];
    this.drops = [];
    this.k = 0;
    this.frac = 0;
    this.done = false;
    this.alpha = 1;
    this.dying = false;
    this.collapsing = false;
    this.fallT = 0;
    this.pluck = 0;
    this.age = 0;
    this.px = [];
    this.py = [];
    this.origin = { x: host == null ? 0 : rect.x, y: host == null ? 0 : rect.y };
    this.rel = vsub(center, this.origin);
    this.build(rect, center);
    this.update(0, 0, null);
  }

  get dead() { return this.dying && this.alpha <= 0; }
  get center() { return vadd(this.origin, this.rel); }

  node(p, w) {
    this.nodes.push({ x: p.x - this.origin.x, y: p.y - this.origin.y, w, ph: (p.x + p.y) * 0.012 });
    return this.nodes.length - 1;
  }

  build(rect, c) {
    const R = this.R, m = 2;
    const inside = (p) => ({ x: clamp(p.x, rect.x + m, rect.x + rect.w - m), y: clamp(p.y, rect.y + m, rect.y + rect.h - m) });
    const hub = this.node(c, 0.8);

    const K = 5 + Math.floor(Math.random() * 3);
    const rot = rand(0, TAU);
    const frame = [], anchors = [];
    for (let k = 0; k < K; k++) {
      const ang = rot + (k / K) * TAU + rand(-0.22, 0.22);
      const f = inside(vadd(c, fromAngle(ang, R * rand(0.95, 1.2))));
      frame.push(this.node(f, 0.45));
      const a = rayToRect(f, ang + rand(-0.15, 0.15), rect);
      anchors.push(vdist(a, f) < R * 2.2 ? this.node(a, 0) : -1);
    }

    // Radials end where they hit the frame polygon.
    const n = 18 + Math.floor(Math.random() * 7);
    const radAng = [], radLen = [];
    for (let j = 0; j < n; j++) {
      const ang = (j / n) * TAU + rand(-0.05, 0.05);
      const d = fromAngle(ang);
      let best = Infinity;
      for (let k = 0; k < K; k++) {
        const a = this.abs(frame[k]), b = this.abs(frame[(k + 1) % K]);
        const e = vsub(b, a), ac = vsub(a, c);
        const den = vcross(d, e);
        if (Math.abs(den) < 1e-6) continue;
        const t = vcross(ac, e) / den, u = vcross(ac, d) / den;
        if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
      }
      radAng.push(ang);
      radLen.push(best === Infinity ? R : best);
    }

    // Spiral nodes sit on the radials; index i walks the spiral continuously
    // (radial i % n). Spacing breathes a little from turn to turn.
    const chains = Array.from({ length: n }, () => [hub]);
    const hubSpiral = [];
    for (let i = 0; i < n * 2; i++) {
      const j = i % n, r = 4 + (i / n) * 3.5 + rand(-0.6, 0.6);
      const id = this.node(vadd(c, fromAngle(radAng[j], r)), 0.8);
      hubSpiral.push(id);
      chains[j].push(id);
    }
    const capture = [];
    const rIn = Math.max(18, R * 0.22);
    const spacing = rand(5.5, 7.5) * clamp(R / 90, 0.8, 1.3);
    const maxLen = Math.max(...radLen);
    let r = rIn, turnSpacing = spacing;
    for (let i = 0; r < maxLen; i++) {
      const j = i % n;
      if (j === 0) turnSpacing = spacing * rand(0.85, 1.15);
      r += turnSpacing / n;
      const rr = r + rand(-1, 1);
      if (rr < radLen[j] - 4) {
        const id = this.node(vadd(c, fromAngle(radAng[j], rr)), 1);
        capture.push(id);
        chains[j].push(id);
      } else {
        capture.push(-1);
      }
    }
    for (let j = 0; j < n; j++) chains[j].push(this.node(vadd(c, fromAngle(radAng[j], radLen[j])), 0.5));

    // The route.
    let cur = frame[0];
    const go = (to, lay, kind) => {
      this.strokes.push({ i: cur, j: to, lay, kind });
      cur = to;
    };
    for (let k = 0; k < K; k++) {
      if (anchors[k] >= 0) {
        go(anchors[k], true, 'frame');
        go(frame[k], false);
      }
      go(frame[(k + 1) % K], true, 'frame');
    }
    go(hub, false);
    const order = [];
    for (let q = 0; q < Math.ceil(n / 2); q++) {
      order.push(q);
      if (q + Math.floor(n / 2) < n) order.push(q + Math.floor(n / 2));
    }
    for (const j of [...new Set(order)]) {
      const chain = chains[j];
      for (let i = 1; i < chain.length; i++) go(chain[i], true, 'radial');
      for (let i = chain.length - 2; i >= 0; i--) go(chain[i], false);
    }
    go(hubSpiral[0], false);
    for (let i = 1; i < hubSpiral.length; i++) go(hubSpiral[i], true, 'hub');
    // Capture spiral is laid from the outside in, like the real thing, with
    // the odd skipped segment.
    let last = capture.length - 1;
    while (last >= 0 && capture[last] < 0) last--;
    if (last >= 0) {
      go(capture[last], false);
      for (let i = last - 1; i >= 0; i--) {
        if (capture[i] < 0) continue;
        go(capture[i], capture[i + 1] >= 0 && Math.random() > 0.03, 'spiral');
      }
    }

    // Glue droplets along the capture spiral.
    this.strokes.forEach((st, idx) => {
      if (st.kind !== 'spiral' || !st.lay) return;
      const len = vdist(this.abs(st.i), this.abs(st.j));
      for (let d = rand(2, 6); d < len; d += rand(5, 11)) this.drops.push({ s: idx, u: d / len, r: rand(0.45, 1.1), ph: rand(0, TAU) });
    });
  }

  abs(i) { return { x: this.nodes[i].x + this.origin.x, y: this.nodes[i].y + this.origin.y }; }
  pos(i) { return { x: this.px[i], y: this.py[i] }; }

  get pen() {
    const s = this.strokes[Math.min(this.k, this.strokes.length - 1)];
    return vlerp(this.pos(s.i), this.pos(s.j), this.done ? 1 : this.frac);
  }

  // Moves the pen along the route while the spider is close to it.
  advance(dt, speed, spiderPos, reach) {
    if (this.done || this.dying || vdist(spiderPos, this.pen) > reach) return;
    let budget = speed * dt;
    while (budget > 0 && !this.done) {
      const s = this.strokes[this.k];
      const len = Math.max(0.5, vdist(this.pos(s.i), this.pos(s.j)));
      const left = (1 - this.frac) * len;
      if (budget < left) {
        this.frac += budget / len;
        budget = 0;
      } else {
        budget -= left;
        this.frac = 0;
        this.k++;
        if (this.k >= this.strokes.length) this.done = true;
      }
    }
  }

  collapse() {
    if (this.collapsing) return;
    this.collapsing = true;
    this.dying = true;
  }

  update(dt, t, world) {
    this.age += dt;
    if (world) {
      if (!world.alive(this.host)) this.collapse();
      else this.origin = world.origin(this.host);
    }
    if (this.dying) this.alpha -= dt * (this.collapsing ? 0.9 : 0.6);
    if (this.collapsing) this.fallT += dt;
    this.pluck = approach(this.pluck, 0, 1.8, dt);
    this.t = t;
    // The whole web breathes slowly in the air; the hub and spiral move most.
    const amp = 2.2, drop = 0.5 * 900 * this.fallT * this.fallT;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const tremble = this.pluck * Math.sin(t * 28 + n.ph * 3) * 3;
      this.px[i] = this.origin.x + n.x + (Math.sin(t * 0.55 + n.ph) * amp + tremble) * n.w;
      this.py[i] = this.origin.y + n.y + (Math.cos(t * 0.42 + n.ph * 1.3) * amp * 0.8 + tremble * 0.6) * n.w + drop * Math.min(1, n.w * 1.6);
    }
  }

  draw(ctx) {
    const SAG = { frame: 0.07, radial: 0.02 };
    const paths = { frame: new Path2D(), radial: new Path2D(), hub: new Path2D(), spiral: new Path2D() };
    const seg = [];
    const count = this.done ? this.strokes.length : this.k;
    // Consecutive spiral strokes are joined into one smooth curve.
    let run = null, runKind = null, runEnd = -1;
    const flush = () => {
      if (run && run.length > 1) smoothPath(paths[runKind], run);
      run = null;
    };
    for (let s = 0; s <= count && s < this.strokes.length; s++) {
      const st = this.strokes[s];
      if (!st.lay) {
        flush();
        continue;
      }
      const a = this.pos(st.i);
      const b = s === count ? vlerp(a, this.pos(st.j), this.frac) : this.pos(st.j);
      seg[s] = [a, b];
      if (st.kind === 'spiral' || st.kind === 'hub') {
        if (!run || runKind !== st.kind || runEnd !== st.i) {
          flush();
          run = [a];
          runKind = st.kind;
        }
        run.push(b);
        runEnd = st.j;
      } else {
        flush();
        const len = vdist(a, b);
        paths[st.kind].moveTo(a.x, a.y);
        paths[st.kind].quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + len * SAG[st.kind], b.x, b.y);
      }
    }
    flush();
    const a = Math.max(0, this.alpha);
    strokeSilk(ctx, 1.05, 0.8 * a, paths.frame);
    strokeSilk(ctx, 0.65, 0.6 * a, paths.radial);
    strokeSilk(ctx, 0.55, 0.55 * a, paths.hub);
    strokeSilk(ctx, 0.55, 0.75 * a, paths.spiral);

    // Glue droplets; a few of them catch the light and twinkle.
    const drops = new Path2D();
    const t = this.t || 0;
    ctx.save();
    for (const d of this.drops) {
      const sg = seg[d.s];
      if (!sg || (d.s === count && d.u > this.frac)) continue;
      const len = vdist(sg[0], sg[1]);
      const x = lerp(sg[0].x, sg[1].x, d.u);
      const y = lerp(sg[0].y, sg[1].y, d.u) + d.u * (1 - d.u) * len * 0.12;
      drops.moveTo(x + d.r, y);
      drops.arc(x, y, d.r, 0, TAU);
      if (d.r > 0.9) {
        const tw = Math.max(0, Math.sin(t * 1.7 + d.ph));
        if (tw > 0.6) {
          ctx.globalAlpha = a * (tw - 0.6) * 2.2;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(x, y, d.r * 1.9, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 0.85 * a;
    ctx.fillStyle = SHEEN;
    ctx.fill(drops);
    ctx.restore();
  }

  hitBy(p, q) {
    const c = this.center;
    const d = vsub(q, p);
    const t = clamp(vdot(vsub(c, p), d) / Math.max(1e-6, vdot(d, d)), 0, 1);
    return vdist(vadd(p, vscale(d, t)), c) < this.R * 0.95;
  }
}

// ------------------------------------------------------------------ Trap

const ARROW = [[0, 0], [0, 17], [4, 13.2], [6.8, 19.4], [9.4, 18.3], [6.7, 12.2], [12, 12.2]];

function drawArrowCursor(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.beginPath();
  ARROW.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();
}

// The cocoon around a caught cursor. The real cursor is hidden while trapped;
// this draws a fake one that is stuck in the silk and only strains a little
// when the user shakes the mouse.
class Trap {
  constructor(p, required) {
    this.p = vcopy(p);
    this.required = required;
    this.strands = [];
    this.ties = [];
    this.debris = [];
    this.snapped = [];
    this.offset = vec();
    this.shake = 0;
    this.lastReal = vcopy(p);
    this.released = false;
    this.flash = 0;
  }

  get cursor() { return vadd(this.p, this.offset); }
  get center() { return vadd(this.cursor, { x: 4.5, y: 9 }); }
  get finished() { return this.released && !this.debris.length && !this.snapped.length; }

  addStrand() {
    this.strands.push({
      rx: rand(9, 14), ry: rand(5.5, 10), rot: rand(0, Math.PI),
      ox: rand(-2.5, 2.5), oy: rand(-3, 3), a0: rand(0, TAU), grow: 0,
    });
  }

  addTie() {
    this.ties.push({ ang: rand(0, TAU), len: rand(60, 150), grow: 0, phase: rand(0, TAU) });
  }

  tieAnchor(tie) { return vadd(this.p, vadd({ x: 4.5, y: 9 }, fromAngle(tie.ang, tie.len))); }

  breakStrand() {
    const s = this.strands.pop();
    if (s) this.shred(s, 1);
    this.flash = 1;
    return this.strands.length;
  }

  burst() {
    while (this.strands.length) this.shred(this.strands.pop(), 2.2);
    for (const tie of this.ties) this.snapped.push({ anchor: this.tieAnchor(tie), from: this.center, t: 0 });
    this.ties = [];
    this.released = true;
  }

  // A broken strand becomes two curling pieces that fall away.
  shred(s, force) {
    const c = vadd(this.center, { x: s.ox, y: s.oy });
    const cut = rand(0, TAU);
    for (const half of [0, 1]) {
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const a = cut + (half + k / 10) * Math.PI;
        const lx = Math.cos(a) * s.rx, ly = Math.sin(a) * s.ry;
        pts.push({ x: lx * Math.cos(s.rot) - ly * Math.sin(s.rot), y: lx * Math.sin(s.rot) + ly * Math.cos(s.rot) });
      }
      const dir = fromAngle(cut + (half + 0.5) * Math.PI);
      this.debris.push({
        pts, pos: vcopy(c), vel: vadd(vscale(dir, rand(60, 140) * force), { x: 0, y: -rand(20, 80) }),
        rot: 0, spin: rand(-6, 6), life: 1,
      });
    }
  }

  update(dt, real) {
    const speed = vdist(real, this.lastReal) / Math.max(dt, 1e-3);
    this.lastReal = vcopy(real);
    this.shake = approach(this.shake, clamp(speed / 900, 0, 1), 8, dt);
    if (!this.released) {
      const pull = vclampLen(vscale(vsub(real, this.p), 0.06), 9);
      const jitter = { x: rand(-1, 1) * this.shake * 2.5, y: rand(-1, 1) * this.shake * 2.5 };
      this.offset = vapproach(this.offset, vadd(pull, jitter), 25, dt);
    }
    this.flash = approach(this.flash, 0, 6, dt);
    for (const s of this.strands) s.grow = Math.min(1, s.grow + dt * 4);
    for (const tie of this.ties) tie.grow = Math.min(1, tie.grow + dt * 3);
    for (const d of this.debris) {
      d.vel.y += 420 * dt;
      d.vel = vscale(d.vel, Math.exp(-1.5 * dt));
      d.pos = vadd(d.pos, vscale(d.vel, dt));
      d.rot += d.spin * dt;
      d.life -= dt * 1.1;
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    for (const sn of this.snapped) sn.t += dt * 3.5;
    this.snapped = this.snapped.filter((sn) => sn.t < 1);
  }

  draw(ctx, t) {
    const c = this.center;

    // Tie lines pinning the cocoon down; they go taut as the cursor strains.
    if (this.ties.length) {
      ctx.beginPath();
      for (const tie of this.ties) {
        const end = vlerp(c, this.tieAnchor(tie), tie.grow);
        const mid = vlerp(c, end, 0.5);
        const slack = Math.max(0, 5 - vlen(this.offset) * 0.6) + Math.sin(t * 2 + tie.phase);
        ctx.moveTo(c.x, c.y);
        ctx.quadraticCurveTo(mid.x, mid.y + slack, end.x, end.y);
      }
      strokeSilk(ctx, 0.8, 0.85);
    }
    for (const sn of this.snapped) {
      const e = easeOut(sn.t);
      const tip = vlerp(sn.from, sn.anchor, e);
      const n = vnorm({ x: -(sn.anchor.y - sn.from.y), y: sn.anchor.x - sn.from.x });
      const wob = Math.sin(sn.t * 30) * (1 - sn.t) * 10;
      const mid = vadd(vlerp(tip, sn.anchor, 0.5), vscale(n, wob));
      ctx.beginPath();
      ctx.moveTo(sn.anchor.x, sn.anchor.y);
      ctx.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y);
      strokeSilk(ctx, 0.8, 1 - sn.t);
    }

    if (!this.released) {
      drawArrowCursor(ctx, this.cursor);
      // Milky fill so the cursor looks wrapped, thicker with every strand.
      if (this.strands.length) {
        ctx.fillStyle = `rgba(245,245,240,${Math.min(0.55, 0.06 * this.strands.length)})`;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 11, 13, 0.3, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      for (const s of this.strands) {
        const wob = Math.sin(t * 22 + s.a0) * this.shake * 0.12;
        const cx = c.x + s.ox, cy = c.y + s.oy;
        ctx.moveTo(cx + Math.cos(s.rot) * s.rx * Math.cos(s.a0) - Math.sin(s.rot) * s.ry * Math.sin(s.a0),
          cy + Math.sin(s.rot) * s.rx * Math.cos(s.a0) + Math.cos(s.rot) * s.ry * Math.sin(s.a0));
        ctx.ellipse(cx, cy, s.rx, s.ry, s.rot + wob, s.a0, s.a0 + TAU * s.grow);
      }
      strokeSilk(ctx, 1.1, 0.95);
      if (this.flash > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${0.5 * this.flash})`;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 16 + (1 - this.flash) * 14, 0, TAU);
        ctx.fill();
      }
    }

    for (const d of this.debris) {
      ctx.save();
      ctx.translate(d.pos.x, d.pos.y);
      ctx.rotate(d.rot);
      ctx.beginPath();
      polyline(ctx, d.pts);
      strokeSilk(ctx, 1, Math.max(0, d.life));
      ctx.restore();
    }
  }
}
