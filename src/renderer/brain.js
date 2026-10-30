// The spider's brain: senses -> emotions -> a choice of what to do.
//
// Not a trained network: a small drive-based mind, the way simple animals are
// usually modelled. It is predictable enough to tune and feels alive because
// every decision comes from how it feels right now:
//
//   senses    cursor distance, speed, whether it is coming *at* the spider,
//             how long it has been still, which windows are around
//   emotions  fear, hunger (real time since its last catch), energy,
//             curiosity, boredom, and trust in you, remembered across restarts
//   reflex    "spider sense": something rushing in close triggers a dodge
//             jump before any thinking happens
//   actions   each scores itself from the emotions; the best one wins, with a
//             bit of stubbornness so it does not flicker between ideas
//
// The world it acts on is the `env` object built in app.js.

const MEMORY_KEY = 'itsy.mind.v1';

class Brain {
  constructor(env) {
    this.env = env;
    const CFG = env.CFG;
    let mem = {};
    try { mem = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}'); } catch (_) { /* no storage */ }
    this.trust = mem.trust ?? 0.2;
    this.lastCatch = mem.lastCatch ?? Date.now() - CFG.hungerFull * 300;
    if (env.DEMO) this.lastCatch = Date.now() - CFG.hungerFull * 1000;
    this.fear = 0;
    this.energy = 1;
    this.curiosity = 0.6;
    this.boredom = 0.2;
    this.threat = 0;
    this.dist = Infinity;
    this.interest = 0;
    this.calm = false;

    this.action = null;
    this.actionTime = 0;
    this.choiceTimer = 0;
    this.reflexCooldown = 0;
    this.saveTimer = 0;
    this.huntCooldown = env.now() + (env.DEMO ? 20 : 60);
    this.lastWebAt = env.now() - CFG.webEvery * 0.5;
    this.lastRappel = env.now() - CFG.rappelEvery * 0.5;
  }

  get hunger() {
    return clamp((Date.now() - this.lastCatch) / 1000 / this.env.CFG.hungerFull, 0, 1);
  }

  fed() {
    this.lastCatch = Date.now();
    this.remember();
  }

  remember() {
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify({ trust: this.trust, lastCatch: this.lastCatch })); } catch (_) { /* no storage */ }
  }

  get name() { return this.action ? this.action.name : 'idle'; }

  update(dt) {
    const e = this.env, sp = e.spider;
    this.perceive(dt);
    this.feel(dt);

    this.reflexCooldown -= dt;
    if (this.reflexCooldown <= 0 && this.threat > 0.5 && this.dist < 150 * e.k() &&
        sp.mode === 'walk' && this.interruptible()) {
      this.dodge();
    }

    this.choiceTimer -= dt;
    if (this.choiceTimer <= 0 || !this.action) {
      this.choiceTimer = 0.25;
      this.choose();
    }

    if (this.action) {
      this.actionTime += dt;
      if (this.action.update(dt) === 'done') this.switchTo(null);
    }

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 5;
      this.remember();
    }
  }

  perceive(dt) {
    const e = this.env, c = e.cursor, sp = e.spider;
    if (!c.inside) {
      this.dist = Infinity;
      this.threat = 0;
      this.calm = false;
      this.interest = approach(this.interest, 0, 2, dt);
      return;
    }
    this.dist = vdist(c.p, sp.pos);
    const toward = this.dist > 1 ? vdot(c.v, vnorm(vsub(sp.pos, c.p))) : 0;
    const k = e.k();
    const prox = clamp(1 - this.dist / (320 * k), 0, 1);
    this.threat = clamp((toward - 120) / 650, 0, 1) * prox +
      clamp(1 - this.dist / (60 * k), 0, 1) * clamp(c.speed / 350, 0, 1) * 0.8;
    this.calm = this.dist < 280 * k && c.speed < 160 && this.threat < 0.05;
    const interesting = this.dist > 100 * k && this.dist < 520 && c.speed > 15 && c.speed < 420 && this.threat < 0.1;
    this.interest = approach(this.interest, interesting ? 1 : 0, interesting ? 3 : 0.8, dt);
  }

  feel(dt) {
    const sp = this.env.spider;
    const doing = this.name;
    this.fear += this.threat * 2.4 * dt - dt * (0.09 + (this.dist > 400 ? 0.1 : 0));
    this.trust += (this.calm ? 0.01 : 0) * dt + (doing === 'befriend' && this.calm ? 0.01 : 0) * dt - this.threat * 0.2 * dt;
    this.energy += doing === 'rest' ? 0.07 * dt : -dt * (0.004 + (sp.speed / sp.s / 1000) * 0.012);
    this.curiosity += doing === 'watch' ? -0.06 * dt : 0.015 * dt;
    this.boredom += ['rest', 'freeze', 'watch'].includes(doing) ? 0.015 * dt
      : ['explore', 'rappel', 'spin'].includes(doing) ? -0.03 * dt : 0.004 * dt;
    for (const key of ['fear', 'trust', 'energy', 'curiosity', 'boredom']) this[key] = clamp(this[key], 0, 1);
  }

  // Spider sense: jump sideways out of the cursor's path.
  dodge() {
    const e = this.env, sp = e.spider, c = e.cursor;
    const away = vnorm(vsub(sp.pos, c.p));
    let perp = { x: -c.v.y, y: c.v.x };
    if (vdot(perp, away) < 0) perp = vscale(perp, -1);
    const dir = vnorm(vadd(away, vscale(vnorm(perp), 0.8)));
    sp.jump(e.clampToScreen(vadd(sp.pos, vscale(dir, rand(90, 130) * e.k()))), 0.28, 30);
    this.fear = Math.min(1, this.fear + 0.45);
    this.trust = Math.max(0, this.trust - 0.04);
    this.reflexCooldown = 0.8;
    e.think('!');
    this.switchTo('flee');
  }

  // Something broke its silk.
  startle() {
    this.fear = Math.min(1, this.fear + 0.3);
    this.trust = Math.max(0, this.trust - 0.05);
    this.env.think('!');
  }

  interruptible() {
    return !this.action || !this.action.interruptible || this.action.interruptible();
  }

  choose() {
    let best = null, bestScore = -Infinity;
    for (const [name, def] of Object.entries(ACTIONS)) {
      const s = def.score(this, this.env);
      if (s > bestScore) { best = name; bestScore = s; }
    }
    if (!best || bestScore <= 0) return;
    if (this.action) {
      if (best === this.action.name || !this.interruptible()) return;
      if (this.actionTime < (this.action.minTime || 0)) return;
      // Commitment: what it is doing keeps most of the urge it started with
      // (cooldowns zero some scores the moment an action begins).
      const live = ACTIONS[this.action.name].score(this, this.env);
      if (bestScore <= Math.max(live, this.actionScore * 0.85) + 0.15) return;
    }
    this.switchTo(best, bestScore);
  }

  switchTo(name, score = 1) {
    const e = this.env, sp = e.spider;
    if (this.action && this.action.end) this.action.end();
    this.action = null;
    this.actionTime = 0;
    this.actionScore = score;
    sp.faceTarget = null;
    sp.crouchTarget = 0;
    sp.waveTarget = 0;
    sp.excited = 0;
    sp.stop();
    if (!name) return;
    if (sp.mode === 'hang' && !['flee', 'rappel', 'freeze', 'watch', 'rest'].includes(name)) e.letGo();
    this.action = ACTIONS[name].make(this, e);
    if (!this.action) this.choiceTimer = 0.5;
  }

  onClick() { if (this.action && this.action.onClick) this.action.onClick(); }
  release() { if (this.action && this.action.release) this.action.release(); }
}

// ------------------------------------------------------------- actions

const ACTIONS = {
  explore: {
    score: (b) => 0.22 + b.curiosity * 0.2 + b.boredom * 0.35,
    make: (b, e) => explore(b, e),
  },
  rest: {
    score: (b) => (1 - b.energy) * 0.95,
    make: (b, e) => rest(b, e),
  },
  spin: {
    score: (b, e) => {
      if (b.fear > 0.2) return 0;
      if (e.unfinishedWeb()) return 0.55;
      return b.energy > 0.4 && e.now() - b.lastWebAt > e.CFG.webEvery && e.activeWebs() < e.CFG.maxWebs ? 0.5 : 0;
    },
    make: (b, e) => spin(b, e),
  },
  rappel: {
    score: (b, e) => (e.now() - b.lastRappel > e.CFG.rappelEvery && hangSpots(e).length
      ? 0.2 + b.curiosity * 0.25 + b.boredom * 0.25 : 0),
    make: (b, e) => rappel(b, e),
  },
  watch: {
    score: (b) => b.interest * (0.25 + b.curiosity * 0.6),
    make: (b, e) => watch(b, e),
  },
  befriend: {
    score: (b, e) => {
      const c = e.cursor;
      const ok = c.inside && b.trust > 0.45 && b.dist < 650 && c.speed < 250 && b.threat < 0.08;
      return ok ? 0.15 + b.trust * 0.7 : 0;
    },
    make: (b, e) => befriend(b, e),
  },
  hunt: {
    score: (b, e) => {
      const c = e.cursor;
      if (!c.inside || c.idle < e.CFG.idleToHunt || e.now() < b.huntCooldown || b.hunger < e.CFG.minHunger) return 0;
      return 0.4 + b.hunger * 0.8 - b.trust * 0.35 + (b.name === 'hunt' ? 1 : 0);
    },
    make: (b, e) => hunt(b, e),
  },
  flee: {
    score: (b) => (b.fear > 0.3 ? b.fear * 1.4 : 0),
    make: (b, e) => flee(b, e),
  },
  freeze: {
    score: (b, e) => (b.fear > 0.1 && b.fear <= 0.3 && b.dist < 260 * e.k() ? 0.5 + b.fear : 0),
    make: (b, e) => freeze(b, e),
  },
  emerge: {
    score: (b, e) => (e.cover() ? 3 : 0),
    make: (b, e) => emerge(b, e),
  },
};

function explore(b, e) {
  const sp = e.spider, k = e.k();
  const path = [];
  const ledges = e.world.edges('top').filter((l) => l.x1 - l.x0 > 120);
  if (ledges.length && Math.random() < 0.6) {
    // Walk along the top edge of a window.
    const l = weightedPick(ledges, (x) => x.x1 - x.x0);
    const y = l.y + 9 * k;
    let a = l.x0 + 25 * k, z = l.x1 - 25 * k;
    if (Math.abs(sp.pos.x - z) < Math.abs(sp.pos.x - a)) [a, z] = [z, a];
    const far = lerp(a, z, rand(0.5, 1));
    path.push({ p: { x: a, y } }, { wait: rand(0.3, 1.2) }, { p: { x: far, y }, speed: rand(55, 85), calm: true }, { wait: rand(0.6, 2.5) });
  } else {
    let p = null;
    for (let i = 0; i < 10 && !p; i++) {
      const q = vec(rand(60, e.W() - 60), rand(60, e.H() - 60));
      if (vdist(q, sp.pos) > 180 * k) p = q;
    }
    path.push({ p: p || e.clampToScreen(vadd(sp.pos, fromAngle(rand(0, TAU), 200 * k))) }, { wait: rand(0.6, 3) });
  }
  e.startDrag();
  let i = 0, wait = 0;
  return {
    name: 'explore', minTime: 1.5,
    update(dt) {
      if (wait > 0) {
        wait -= dt;
        if (wait <= 0) i++;
        return;
      }
      if (i >= path.length) return 'done';
      const step = path[i];
      if (step.wait) {
        wait = step.wait;
        sp.stop();
        if (Math.random() < 0.6) e.pinDrag();
        return;
      }
      sp.moveTo(step.p, { speed: step.speed || rand(80, 120), slowRadius: 40, stopGo: !step.calm });
      if (sp.arrived) i++;
    },
  };
}

function rest(b, e) {
  const sp = e.spider;
  const web = e.homeWeb();
  const dur = rand(5, 12);
  let t = 0;
  if (dur > 8) e.think('z');
  return {
    name: 'rest', minTime: 3,
    update(dt) {
      t += dt;
      if (sp.mode === 'hang') {
        // Dozing on its thread.
      } else if (web && !web.dying) {
        sp.moveTo(web.center, { speed: 80, slowRadius: 30, stopGo: false });
        if (sp.arrived) sp.faceTarget = vadd(web.center, vec(0, 100)); // head down, like real orb weavers
      }
      if (t > dur && b.energy > 0.6) return 'done';
    },
  };
}

function spin(b, e) {
  const sp = e.spider, k = e.k();
  const web = e.unfinishedWeb() || e.startWeb();
  if (!web) {
    b.lastWebAt = e.now();
    return null;
  }
  let phase = 'approach', t = 0, sit = rand(6, 14);
  return {
    // Interruptible: food or a friend wins; an unfinished web scores high, so
    // it comes back to finish it later.
    name: 'spin', minTime: 2,
    update(dt) {
      if (web.dying) return 'done';
      if (phase === 'approach') {
        sp.moveTo(web.pen, { speed: 140, slowRadius: 30, stopGo: false });
        if (vdist(sp.pos, web.pen) < 14 * k) {
          e.pinDrag();
          e.dropDrag();
          phase = 'spin';
        }
      } else if (phase === 'spin') {
        web.advance(dt, e.CFG.buildSpeed * sp.s, sp.pos, 16 * k);
        sp.moveTo(web.pen, { speed: e.CFG.buildSpeed * 1.45, slowRadius: 8, stopGo: false });
        if (web.done) {
          b.lastWebAt = e.now();
          web.pluck = 1;
          phase = 'sit';
        }
      } else {
        t += dt;
        sp.moveTo(web.center, { speed: 70, slowRadius: 20, stopGo: false });
        if (sp.arrived) sp.faceTarget = vadd(web.center, vec(0, 100));
        if (t > sit) return 'done';
      }
    },
  };
}

// Undersides of windows with room below to dangle.
function hangSpots(e) {
  return e.world.edges('bottom').filter((l) => e.H() - l.y > 140);
}

function rappel(b, e) {
  const sp = e.spider, k = e.k();
  b.lastRappel = e.now();
  const spots = hangSpots(e);
  if (!spots.length) return null;
  const l = spots.reduce((best, s) => {
    const d = Math.abs(clamp(sp.pos.x, s.x0, s.x1) - sp.pos.x) + Math.abs(s.y - sp.pos.y);
    return !best || d < best.d ? { s, d } : best;
  }, null).s;
  const x = clamp(clamp(sp.pos.x, l.x0, l.x1) + rand(-80, 80), l.x0 + 25, l.x1 - 25);
  const ledge = { x, y: l.y - 10 * k };
  const maxLen = Math.min(240 * k, e.H() - l.y - 50);
  let phase = 'go', t = 0, dur = rand(4, 9);
  e.startDrag();
  return {
    name: 'rappel', minTime: 2,
    update(dt) {
      if (phase === 'go') {
        sp.moveTo(ledge, { speed: 100, slowRadius: 30, stopGo: true });
        if (sp.arrived) {
          e.pinDrag();
          e.dropDrag();
          e.hangFrom({ x, y: l.y }, l.id, rand(50 * k, maxLen));
          phase = 'hang';
        }
        return;
      }
      if (sp.mode !== 'hang') return 'done';
      t += dt;
      if (phase === 'hang' && t > dur) {
        if (Math.random() < 0.65) {
          sp.hang.targetLen = 0;
          sp.hang.speed = 70;
          phase = 'climb';
        } else {
          sp.hang.targetLen = Math.min(maxLen, sp.hang.len + 60 * k);
          phase = 'drop';
        }
      } else if (phase === 'hang' && Math.random() < dt * 0.3) {
        sp.hang.targetLen = clamp(sp.hang.targetLen + rand(-30, 30) * k, 30 * k, maxLen);
      }
      if (phase === 'climb' && sp.hang.len < 3) {
        e.endHang();
        return 'done';
      }
      if (phase === 'drop' && Math.abs(sp.hang.len - sp.hang.targetLen) < 2) {
        e.letGo();
        return 'done';
      }
    },
  };
}

function watch(b, e) {
  const sp = e.spider, k = e.k();
  e.think('?');
  let lost = 0, t = 0;
  return {
    name: 'watch', minTime: 1.5,
    update(dt) {
      t += dt;
      const c = e.cursor;
      if (sp.mode === 'hang') {
        if (b.interest < 0.3) return 'done';
        return;
      }
      sp.faceTarget = c.p;
      sp.excited = 0.5;
      const d = vdist(sp.pos, c.p);
      const away = vnorm(vsub(sp.pos, c.p));
      if (d > 260 * k) sp.moveTo(vadd(c.p, vscale(away, 200 * k)), { speed: 70, slowRadius: 40, stopGo: true });
      else if (d < 110 * k && b.trust < 0.5) sp.moveTo(vadd(sp.pos, vscale(away, 30 * k)), { speed: 60, slowRadius: 10, stopGo: false });
      else sp.stop();
      lost = b.interest < 0.3 ? lost + dt : 0;
      if (lost > 1.5 || t > 14) return 'done';
    },
  };
}

function befriend(b, e) {
  const sp = e.spider, k = e.k();
  e.think('♥');
  let dance = 0, heart = 0;
  return {
    name: 'befriend', minTime: 2,
    update(dt) {
      const c = e.cursor;
      if (!c.inside) return 'done';
      const d = vdist(sp.pos, c.p);
      if (d > 700) return 'done';
      const near = 55 * k;
      const away = d > 1 ? vnorm(vsub(sp.pos, c.p)) : vec(0, 1);
      sp.faceTarget = c.p;
      if (d > near + 25 * k) {
        sp.waveTarget = 0;
        sp.moveTo(vadd(c.p, vscale(away, near)), { speed: 70, slowRadius: 30, stopGo: true });
        return;
      }
      // Close enough: wave and do a little side-to-side shuffle, like a
      // jumping spider's display.
      dance += dt;
      sp.waveTarget = 1;
      sp.excited = 0.6;
      const perp = { x: -away.y, y: away.x };
      sp.moveTo(vadd(vadd(c.p, vscale(away, near)), vscale(perp, Math.sin(dance * 2.6) * 9 * k)),
        { speed: 50, slowRadius: 6, stopGo: false });
      heart += dt;
      if (heart > 6) {
        heart = 0;
        e.think('♥');
      }
    },
  };
}

function hunt(b, e) {
  const sp = e.spider, k = e.k(), CFG = e.CFG;
  const prey = vcopy(e.cursor.p);
  let phase = 'stalk', timer = 0, ang = 0, added = 0, ties = 0, duration = 0, since = 0, lastClick = 0, rewrap = 0;
  e.pinDrag();
  e.dropDrag();
  sp.excited = 0.4;

  const release = () => {
    if (!['wrap', 'guard'].includes(phase)) return;
    const c = e.freeCursor();
    let dir = vsub(sp.pos, c);
    if (vlen(dir) < 1) dir = fromAngle(rand(0, TAU));
    sp.jump(e.clampToScreen(vadd(c, vscale(vnorm(dir), 160 * k))), 0.36, 42);
    b.huntCooldown = e.now() + CFG.cooldown;
    b.fear = Math.min(1, b.fear + 0.35);
    phase = 'escape';
  };

  return {
    name: 'hunt', minTime: 0.5,
    interruptible: () => phase === 'stalk',
    release,
    onClick() {
      if (!['wrap', 'guard'].includes(phase)) return;
      const left = e.trap().breakStrand();
      lastClick = e.now();
      sp.crouch = 1;
      if (left === 0 && (phase === 'guard' || added >= e.trap().required)) release();
    },
    update(dt) {
      const c = e.cursor;
      const moved = vdist(c.p, prey) > 30 || !c.inside;
      if (phase === 'stalk') {
        if (moved) {
          b.huntCooldown = e.now() + 2;
          return 'done';
        }
        let away = vsub(sp.pos, prey);
        if (vlen(away) < 1) away = vec(0, 1);
        sp.moveTo(e.clampToScreen(vadd(prey, vscale(vnorm(away), 110 * k)), 10), { speed: 85, slowRadius: 30, stopGo: true });
        if (vdist(sp.pos, prey) < 130 * k) {
          sp.stop();
          sp.faceTarget = prey;
          sp.crouchTarget = 1;
          sp.excited = 1;
          phase = 'crouch';
          timer = 0.7;
        }
      } else if (phase === 'crouch') {
        timer -= dt;
        const aim = Math.abs(angleDiff(sp.heading, vangle(vsub(prey, sp.pos))));
        // Moving the mouse now is too late: it pounces where the cursor was.
        if ((timer <= 0 && aim < 0.15) || moved) {
          sp.crouchTarget = 0;
          sp.faceTarget = null;
          sp.jump(vadd(prey, vec(4.5, 9)), 0.3, 52);
          e.lift(true);
          phase = 'air';
        }
      } else if (phase === 'air') {
        if (!sp.landed) return;
        if (c.inside && vdist(c.p, prey) < 25) {
          const required = Math.round(lerp(CFG.minClicks, CFG.maxClicks, b.hunger));
          e.catchCursor(prey, required);
          b.fed();
          ang = vangle(vsub(sp.pos, e.trap().center));
          duration = 0.28 * required + 0.5;
          timer = 0;
          phase = 'wrap';
        } else {
          e.lift(false);
          b.huntCooldown = e.now() + 4;
          e.think('?');
          return 'done';
        }
      } else if (phase === 'wrap') {
        const trap = e.trap();
        timer += dt;
        ang += 7 * dt;
        sp.moveTo(vadd(trap.center, fromAngle(ang, 26 * k)), { speed: 300, slowRadius: 8, stopGo: false });
        const step = duration / trap.required;
        while (added < trap.required && timer > (added + 1) * step) { trap.addStrand(); added++; }
        while (ties < 6 && timer > ((ties + 1) * duration) / 6) { trap.addTie(); ties++; }
        if (timer > duration + 0.2) {
          phase = 'guard';
          since = e.now();
          lastClick = e.now();
        }
      } else if (phase === 'guard') {
        const trap = e.trap();
        const ctr = trap.center;
        if (rewrap > 0) {
          ang += 9 * dt;
          sp.moveTo(vadd(ctr, fromAngle(ang, 24 * k)), { speed: 300, slowRadius: 8, stopGo: false });
          rewrap -= dt;
          if (rewrap <= 0) trap.addStrand();
        } else {
          let side = vsub(sp.pos, ctr);
          if (vlen(side) < 1) side = vec(1, 0);
          sp.moveTo(vadd(ctr, vscale(vnorm(side), 36 * k)), { speed: 120, slowRadius: 20, stopGo: false });
          sp.faceTarget = ctr;
          sp.excited = 0.4 + trap.shake;
          // Stop clicking and it wraps you up again.
          if (e.now() - lastClick > CFG.regrowAfter && trap.strands.length < trap.required) {
            rewrap = 0.55;
            ang = vangle(vsub(sp.pos, ctr));
            lastClick = e.now();
          }
        }
        if (e.now() - since > CFG.maxTrap) release();
      } else if (phase === 'escape') {
        if (sp.landed) {
          e.lift(false);
          e.startDrag();
          return 'done';
        }
      }
    },
    end() { e.lift(false); },
  };
}

// The point that keeps the most distance from the cursor without running
// past it.
function safeSpot(e) {
  const sp = e.spider, c = e.cursor.p, W = e.W(), H = e.H();
  const cands = [vec(50, 50), vec(W - 50, 50), vec(50, H - 50), vec(W - 50, H - 50)];
  for (let i = 0; i < 14; i++) cands.push(vec(rand(50, W - 50), rand(50, H - 50)));
  let best = cands[0], bestScore = -Infinity;
  for (const p of cands) {
    const d = vsub(p, sp.pos);
    const t = clamp(vdot(vsub(c, sp.pos), d) / Math.max(1, vdot(d, d)), 0, 1);
    const pass = vdist(vadd(sp.pos, vscale(d, t)), c);
    const score = vdist(p, c) - 0.35 * vlen(d) - (pass < 110 ? 500 : 0);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

function flee(b, e) {
  const sp = e.spider;
  if (b.fear > 0.5) e.think('!');
  if (sp.mode === 'hang') {
    sp.hang.targetLen = 0;
    sp.hang.speed = 260;
  }
  let target = safeSpot(e);
  return {
    name: 'flee', minTime: 1.2,
    update() {
      if (sp.mode === 'hang') {
        if (sp.hang.len < 3) e.endHang();
        return;
      }
      if (sp.mode === 'air') return;
      if (vdist(e.cursor.p, target) < 150 * e.k()) target = safeSpot(e);
      sp.moveTo(target, { speed: 230, slowRadius: 30, stopGo: false });
      if (sp.arrived) sp.crouchTarget = 0.5;
      if (b.fear < 0.12) return 'done';
    },
  };
}

function freeze(b, e) {
  const sp = e.spider;
  return {
    name: 'freeze', minTime: 0.8,
    update() {
      sp.stop();
      sp.crouchTarget = 0.6;
      if (b.fear < 0.06) return 'done';
    },
  };
}

// Covered by a window that came to the front: crawl out from under it.
function emerge(b, e) {
  const sp = e.spider;
  let t = 0;
  return {
    name: 'emerge', minTime: 0,
    interruptible: () => false,
    update(dt) {
      t += dt;
      const cover = e.cover();
      if (!cover) return 'done';
      if (sp.mode === 'hang') e.letGo();
      const p = sp.pos, m = 22 * e.k();
      const cands = [
        vec(cover.x - m, p.y), vec(cover.x + cover.w + m, p.y),
        vec(p.x, cover.y - m), vec(p.x, cover.y + cover.h + m),
      ].filter((q) => q.x > 10 && q.y > 10 && q.x < e.W() - 10 && q.y < e.H() - 10);
      if (!cands.length || t > 4) {
        e.popOut();
        return 'done';
      }
      const target = cands.reduce((a, q) => (vdist(q, p) < vdist(a, p) ? q : a));
      sp.moveTo(target, { speed: 150, slowRadius: 10, stopGo: false });
    },
  };
}

function weightedPick(items, weight) {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = Math.random() * total;
  for (const x of items) {
    r -= weight(x);
    if (r <= 0) return x;
  }
  return items[items.length - 1];
}
