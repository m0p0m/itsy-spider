// Glue: cursor + windows in, brain + body + silk updated, layers drawn.
// Runs inside the Electron overlay, and as a plain web page where a fake
// desktop with draggable windows stands in for the real one.

(() => {
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo') === '1';
  const bridge = window.itsy || null;
  const WEB = !bridge;
  const FAST = DEMO || WEB;

  const CFG = {
    scale: 0.62,
    idleToHunt: FAST ? 10 : 25, // seconds the cursor must rest before it gets hunted
    cooldown: FAST ? 30 : 120, // seconds after an escape before hunting again
    minHunger: 0.25, // right after a meal it is full and leaves the cursor alone
    minClicks: 3, // strands on a quick re-catch
    maxClicks: 10, // strands after a long fast
    hungerFull: FAST ? 90 : 3600, // seconds without a catch to reach maxClicks
    regrowAfter: 1.5, // stop clicking this long and it re-wraps
    maxTrap: 60, // it gets bored and lets go
    buildSpeed: FAST ? 170 : 110,
    webEvery: FAST ? 20 : 150,
    rappelEvery: FAST ? 15 : 60,
    maxWebs: 3,
    maxThreads: 30,
    threadLife: 15 * 60,
    webLife: 45 * 60,
    swipeSpeed: 1000, // px/s: brushing the mouse this fast through silk tears it
  };

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const world = new World();
  let W = 0, H = 0, dpr = 1;
  const now = () => performance.now() / 1000;

  // ------------------------------------------------------------ cursor

  const cursor = {
    p: vec(-9999, -9999), v: vec(), speed: 0, inside: false,
    rest: vec(-9999, -9999), lastMove: now(), lastEvent: now(),
    get idle() { return now() - this.lastMove; },
  };

  function onCursor(p) {
    const t = now();
    const np = vec(p.x, p.y);
    const dt = t - cursor.lastEvent;
    if (cursor.inside && dt > 0.002) {
      const inst = vscale(vsub(np, cursor.p), 1 / Math.min(dt, 0.1));
      cursor.v = vlerp(cursor.v, inst, 0.5);
      if (vlen(inst) > CFG.swipeSpeed && !(trap && !trap.released)) cutSilk(cursor.p, np);
    }
    cursor.p = np;
    cursor.lastEvent = t;
    cursor.inside = p.x >= 0 && p.y >= 0 && p.x < W && p.y < H;
    if (vdist(np, cursor.rest) > 3) {
      cursor.rest = vcopy(np);
      cursor.lastMove = t;
    }
  }

  // ------------------------------------------------------------- state

  const spider = new Spider(rand(W * 0.3, W * 0.7), -60, { scale: CFG.scale, dpr: window.devicePixelRatio || 1, heading: Math.PI / 2 });
  let threads = [];
  let snaps = [];
  let webs = [];
  let drag = null; // anchor of the live dragline
  let hangAnchor = null;
  let trap = null;
  let lifted = false; // pouncing / guarding: drawn above every window
  let occluded = false;
  let seenVersion = 0;
  let thought = null;
  let beatTimer = 0;
  const settings = { size: CFG.scale, pixel: false, brain: WEB };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    world.resize(W, H);
    if (spider.dpr !== dpr) {
      spider.dpr = dpr;
      spider.makeBuffers();
    }
  }
  resize();
  spider.pos = vec(rand(W * 0.3, W * 0.7), -60);
  spider.plantFeet();
  window.addEventListener('resize', () => {
    resize();
    if (WEB) reportFakeWindows();
  });

  function setTrapped(value) {
    document.body.classList.toggle('trapped', value);
    if (bridge) bridge.setTrapped(value);
  }

  function clampToScreen(p, m = 30) {
    return { x: clamp(p.x, m, W - m), y: clamp(p.y, m, H - m) };
  }

  function addThread(a, b) {
    const A = world.pos(a), B = world.pos(b);
    if (!A || !B || vdist(A, B) < 30) return;
    threads.push(new Thread(a, b));
    const alive = threads.filter((t) => !t.dying);
    if (alive.length > CFG.maxThreads) alive[0].dying = true;
  }

  function startWeb() {
    const k = env.k();
    const R = rand(60, 105) * k;
    const hosts = [...new Set([spider.host, ...world.list.slice(0, 4).map((w) => w.id), null])];
    for (let i = 0; i < 40; i++) {
      const host = pick(hosts);
      const r = world.rect(host);
      if (r.w < R * 2.8 || r.h < R * 2.8) continue;
      const left = Math.random() < 0.5, top = Math.random() < 0.7;
      const c = {
        x: left ? r.x + R + rand(6, 30) : r.x + r.w - R - rand(6, 30),
        y: top ? r.y + R + rand(6, 30) : r.y + r.h - R - rand(6, 30),
      };
      if (world.coverAt(c, host)) continue;
      if (webs.some((w) => !w.dying && vdist(w.center, c) < w.R + R + 30)) continue;
      const web = new OrbWeb(host, r, c, R);
      webs.push(web);
      return web;
    }
    return null;
  }

  // The window (or desktop) the spider is standing on. Walking onto a
  // higher window climbs it; a window raised over a resting spider hides it
  // until it crawls out.
  function updateHost() {
    const changed = world.version !== seenVersion;
    seenVersion = world.version;
    if (spider.mode === 'hang') {
      if (hangAnchor) spider.host = hangAnchor.id;
      occluded = !!world.coverAt(spider.pos, spider.host);
      return;
    }
    const top = world.topAt(spider.pos);
    const topId = top ? top.id : null;
    if (!world.alive(spider.host) || topId === spider.host || world.z(topId) > world.z(spider.host)) {
      spider.host = topId;
      occluded = false;
    } else if (changed || occluded) {
      occluded = true;
    } else {
      spider.host = topId;
    }
  }

  // Brushing the mouse fast through silk tears it.
  function cutSilk(p, q) {
    let hit = false;
    for (const th of threads) {
      if (th.dying) continue;
      const x = th.cut(p, q);
      if (!x) continue;
      snaps.push(new Snap(th.a, x, th.layer), new Snap(th.b, x, th.layer));
      th.dying = true;
      th.alpha = 0;
      hit = true;
    }
    for (const w of webs) {
      if (!w.dying && w.hitBy(p, q)) {
        w.collapse();
        hit = true;
      }
    }
    if (drag) {
      const A = world.pos(drag);
      if (A && segmentsCross(p, q, A, spider.spinneret())) {
        snaps.push(new Snap(drag, spider.spinneret(), spider.host));
        drag = null;
        hit = true;
      }
    }
    if (hit && vdist(spider.pos, q) < 700) brain.startle();
  }

  function clearSilk() {
    for (const t of threads) t.dying = true;
    for (const w of webs) w.collapse();
    drag = null;
  }

  function applyWindows(list) {
    const moved = world.setWindows(list);
    for (const [id, d] of moved) {
      if (spider.host === id && spider.mode !== 'hang' && !lifted) spider.translate(d);
      if (hangAnchor && hangAnchor.id === id) spider.nudgeHang(d);
    }
  }

  function applySettings(s) {
    Object.assign(settings, s);
    if (settings.size !== CFG.scale) {
      CFG.scale = settings.size;
      spider.setScale(settings.size);
    }
    spider.pixel = !!settings.pixel;
  }

  // ------------------------------------------------------------ brain

  const env = {
    CFG, DEMO: FAST, world, cursor, spider, now,
    k: () => spider.s / 0.62,
    W: () => W,
    H: () => H,
    clampToScreen,
    think(glyph) { thought = { glyph, t: 0 }; },
    startDrag() { if (!drag) drag = world.anchor(spider.spinneret(), spider.host); },
    pinDrag() {
      if (!drag) return;
      const here = world.anchor(spider.spinneret(), spider.host);
      addThread(drag, here);
      drag = here;
    },
    dropDrag() { drag = null; },
    unfinishedWeb: () => webs.find((w) => !w.done && !w.dying) || null,
    activeWebs: () => webs.filter((w) => !w.dying).length,
    homeWeb: () => webs.find((w) => w.done && !w.dying && vdist(w.center, spider.pos) < 600 && !world.coverAt(w.center, w.host)) || null,
    startWeb,
    hangFrom(p, id, length) {
      hangAnchor = world.anchor(p, id);
      spider.startHang(world.pos(hangAnchor), length);
      spider.host = hangAnchor.id;
    },
    endHang() {
      if (spider.mode === 'hang') spider.endHang();
      hangAnchor = null;
    },
    // Drop off the thread and leave it hanging behind.
    letGo() {
      if (spider.mode !== 'hang') return;
      if (hangAnchor) addThread(hangAnchor, world.anchor(spider.spinneret()));
      spider.endHang();
      hangAnchor = null;
    },
    catchCursor(p, required) {
      trap = new Trap(p, required);
      setTrapped(true);
    },
    trap: () => trap,
    freeCursor() {
      const c = trap.center;
      trap.burst();
      setTrapped(false);
      return c;
    },
    lift(v) { lifted = v; },
    cover: () => (occluded ? world.coverAt(spider.pos, spider.host) : null),
    popOut() {
      const top = world.topAt(spider.pos);
      spider.host = top ? top.id : null;
      occluded = false;
    },
  };
  const brain = new Brain(env);

  // -------------------------------------------------------------- input

  if (bridge) {
    bridge.onCursor(onCursor);
    bridge.onWindows(applyWindows);
    bridge.onSettings(applySettings);
    bridge.onCommand((cmd) => {
      if (cmd === 'free') brain.release();
      if (cmd === 'clear') clearSilk();
    });
  } else {
    window.addEventListener('mousemove', (e) => onCursor({ x: e.clientX, y: e.clientY }));
    document.addEventListener('mouseleave', () => { cursor.inside = false; });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'p') applySettings({ pixel: !settings.pixel });
      if (e.key === 'b') settings.brain = !settings.brain;
      if (e.key === 'c') clearSilk();
    });
    setupFakeDesktop();
  }
  window.addEventListener('mousedown', (e) => {
    if (!trap || trap.released) return;
    e.preventDefault();
    brain.onClick();
  });
  window.addEventListener('contextmenu', (e) => { if (trap && !trap.released) e.preventDefault(); });

  // ------------------------------------------------------------- update

  function update(dt) {
    if (now() - cursor.lastEvent > 0.05) cursor.v = vapproach(cursor.v, vec(), 10, dt);
    cursor.speed = vlen(cursor.v);

    if (spider.mode === 'hang' && hangAnchor) {
      const A = world.pos(hangAnchor);
      if (A) spider.hang.A = A;
      else env.endHang(); // its window vanished: it falls
    } else if (spider.mode !== 'hang') {
      hangAnchor = null;
    }
    if (drag && !world.alive(drag.id)) drag = null;

    updateHost();
    brain.update(dt);
    spider.update(dt);

    const t = now();
    for (const th of threads) {
      th.update(dt, t, world);
      if (th.age > CFG.threadLife) th.dying = true;
    }
    threads = threads.filter((th) => !th.dead);
    for (const s of snaps) s.update(dt, t, world);
    snaps = snaps.filter((s) => !s.dead);
    for (const w of webs) {
      w.update(dt, t, world);
      if (w.age > CFG.webLife) w.dying = true;
    }
    webs = webs.filter((w) => !w.dead);

    if (trap) {
      trap.update(dt, cursor.p);
      if (trap.finished) trap = null;
    }
    if (bridge && trap && !trap.released) {
      beatTimer -= dt;
      if (beatTimer <= 0) {
        bridge.beat();
        beatTimer = 0.5;
      }
    }
    if (thought) {
      thought.t += dt;
      if (thought.t > 1.8) thought = null;
    }
  }

  // ------------------------------------------------------------ drawing

  function render(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    updateSheen(ctx, W, H, t);

    // Bottom-up: the desktop, then each window. Erasing a window's rectangle
    // before drawing what sits on it hides everything behind that window.
    const spiderLayer = lifted ? 'top' : spider.host;
    drawLayer(null, spiderLayer);
    for (let i = world.list.length - 1; i >= 0; i--) {
      const w = world.list[i];
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.restore();
      drawLayer(w.id, spiderLayer);
    }

    const caught = trap && !trap.released;
    if (caught) {
      // Never fully transparent while trapped, so every pixel takes the clicks.
      const c = trap.center;
      const g = ctx.createRadialGradient(c.x, c.y, 60, c.x, c.y, Math.max(W, H) * 0.8);
      g.addColorStop(0, 'rgba(0,0,0,0.02)');
      g.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    drawLayer('top', spiderLayer);
    if (trap) trap.draw(ctx, t);
    if (spiderLayer === 'top') drawSpider();
    if (caught) drawCounter(trap);
    if (settings.brain) drawBrain();
  }

  function drawLayer(id, spiderLayer) {
    for (const th of threads) if (th.layer === id) th.draw(ctx);
    for (const s of snaps) if (s.layer === id) s.draw(ctx);
    for (const w of webs) {
      const layer = world.alive(w.host) ? w.host : 'top';
      if (layer === id) w.draw(ctx);
    }
    if (spiderLayer === id && id !== 'top') drawSpider();
  }

  function drawSpider() {
    const s = spider.spinneret();
    if (drag) {
      const A = world.pos(drag);
      if (A) {
        ctx.beginPath();
        polyline(ctx, silkCurve(A, s, now(), { phase: 0, k1: 0.3, k2: -0.2, sag: 0.03 }));
        strokeSilk(ctx, 0.6, 0.7);
      }
    }
    if (spider.mode === 'hang') {
      const A = spider.hang.A;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(s.x, s.y);
      strokeSilk(ctx, 0.7, 0.85);
    }
    spider.draw(ctx);
    drawThought();
  }

  const GLYPHS = { '!': '#e5484d', '?': '#3e63dd', '♥': '#e93d82', z: '#7c66dc' };
  function drawThought() {
    if (!thought) return;
    const a = thought.t, k = env.k();
    const pop = a < 0.15 ? easeOut(a / 0.15) : 1;
    const fade = a > 1.4 ? Math.max(0, 1 - (a - 1.4) / 0.4) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(spider.pos.x + 18 * k, spider.pos.y - 38 * k - a * 5);
    ctx.scale(pop, pop);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-8, 10, 2.6, 0, TAU); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = GLYPHS[thought.glyph] || '#333';
    ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(thought.glyph, 0, 1);
    ctx.restore();
  }

  function drawCounter(trap) {
    const c = trap.center;
    const n = trap.strands.length;
    const text = n ? `${n} × click to break free` : 'almost…';
    ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    const w = ctx.measureText(text).width + 18;
    const x = clamp(c.x - w / 2, 8, W - w - 8), y = clamp(c.y + 46, 8, H - 30);
    ctx.fillStyle = 'rgba(18,14,12,0.78)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 9, y + 11.5);
  }

  // What it is thinking, for videos and for tuning.
  function drawBrain() {
    const b = brain;
    const rows = [
      ['hunger', b.hunger, '#f76b15'], ['fear', b.fear, '#e5484d'], ['trust', b.trust, '#e93d82'],
      ['energy', b.energy, '#30a46c'], ['curiosity', b.curiosity, '#3e63dd'], ['boredom', b.boredom, '#9a9a9a'],
    ];
    const w = 168, h = 34 + rows.length * 15;
    const x = 16, y = H - h - 64;
    ctx.save();
    ctx.fillStyle = 'rgba(16,17,20,0.84)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
    ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(`🕷 ${b.name}`, x + 10, y + 15);
    ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
    rows.forEach(([label, value, color], i) => {
      const ry = y + 34 + i * 15;
      ctx.fillStyle = '#b8b8b8';
      ctx.fillText(label, x + 10, ry);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 76, ry - 3, 80, 6);
      ctx.fillStyle = color;
      ctx.fillRect(x + 76, ry - 3, 80 * clamp(value, 0, 1), 6);
    });
    ctx.restore();
  }

  // ------------------------------------------- browser demo: fake desktop

  function setupFakeDesktop() {
    document.body.classList.add('web');
    const desk = document.getElementById('desk');
    const specs = [
      { title: 'spider.js — Editor', x: 0.06, y: 0.1, w: 0.5, h: 0.56, tpl: 'tpl-code' },
      { title: 'Notes', x: 0.56, y: 0.4, w: 0.34, h: 0.42, tpl: 'tpl-notes' },
    ];
    let zTop = 10;
    specs.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = s.tpl === 'tpl-notes' ? 'fw notes' : 'fw';
      el.dataset.id = `fake${i}`;
      Object.assign(el.style, { left: `${s.x * W}px`, top: `${s.y * H}px`, width: `${s.w * W}px`, height: `${s.h * H}px`, zIndex: ++zTop });
      el.innerHTML = `<div class="bar"><b class="close" title="Close for a few seconds"></b><b></b><b></b><span>${s.title}</span></div>`;
      el.appendChild(document.getElementById(s.tpl).content.cloneNode(true));
      desk.appendChild(el);

      el.addEventListener('pointerdown', () => {
        el.style.zIndex = ++zTop;
        reportFakeWindows();
      });
      el.querySelector('.close').addEventListener('click', () => {
        el.style.display = 'none';
        reportFakeWindows();
        setTimeout(() => {
          el.style.display = '';
          el.style.zIndex = ++zTop;
          reportFakeWindows();
        }, 4000);
      });
      const bar = el.querySelector('.bar');
      let grab = null;
      bar.addEventListener('pointerdown', (ev) => {
        grab = { x: ev.clientX - el.offsetLeft, y: ev.clientY - el.offsetTop };
        bar.setPointerCapture(ev.pointerId);
      });
      bar.addEventListener('pointermove', (ev) => {
        if (!grab) return;
        el.style.left = `${ev.clientX - grab.x}px`;
        el.style.top = `${ev.clientY - grab.y}px`;
        reportFakeWindows();
      });
      bar.addEventListener('pointerup', () => { grab = null; });
    });
    reportFakeWindows();
  }

  function reportFakeWindows() {
    const els = [...document.querySelectorAll('.fw')]
      .filter((el) => el.style.display !== 'none')
      .sort((a, b) => b.style.zIndex - a.style.zIndex);
    applyWindows(els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id, x: r.left, y: r.top, w: r.width, h: r.height };
    }));
  }

  // ---------------------------------------------------------------- loop

  let last = performance.now();
  function frame(ms) {
    const dt = Math.min(0.033, Math.max(0, (ms - last) / 1000));
    last = ms;
    update(dt);
    render(ms / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for poking at it from devtools (and for stepping time in tests).
  window.__itsy = {
    brain, spider, world, CFG, settings, applySettings, clearSilk, onCursor,
    step(dt) { update(dt); render(now()); },
    get webs() { return webs; },
    get threads() { return threads; },
  };
})();
