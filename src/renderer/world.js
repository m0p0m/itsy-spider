// The spider's picture of the desktop: the open windows, top-most first.
//
// Everything that sits somewhere (silk anchors, webs, the spider itself) is
// attached to a "host": a window id, or null for the desktop. Positions are
// stored relative to the host, so when you drag a window its webs come along,
// and when it is closed they fall. Drawing goes host by host from the bottom
// up, erasing each window's rectangle first, so a window raised over a web
// really hides it.

class World {
  constructor() {
    this.W = 0;
    this.H = 0;
    this.list = []; // top-most first
    this.byId = new Map();
    this.version = 0;
    this.edgeCache = new Map();
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
    this.edgeCache.clear();
  }

  // rects: [{id, x, y, w, h}] top-most first, in overlay coordinates.
  // Returns how each surviving window moved since last time.
  setWindows(rects) {
    const list = [];
    for (const r of rects) {
      if (r.x + r.w <= 0 || r.y + r.h <= 0 || r.x >= this.W || r.y >= this.H) continue;
      list.push({ id: String(r.id), x: r.x, y: r.y, w: r.w, h: r.h, z: list.length });
    }
    const moved = new Map();
    let changed = list.length !== this.list.length;
    list.forEach((w, i) => {
      const old = this.byId.get(w.id);
      if (old && (old.x !== w.x || old.y !== w.y)) moved.set(w.id, { x: w.x - old.x, y: w.y - old.y });
      const prev = this.list[i];
      if (!prev || prev.id !== w.id || prev.x !== w.x || prev.y !== w.y || prev.w !== w.w || prev.h !== w.h) changed = true;
    });
    this.list = list;
    this.byId = new Map(list.map((w) => [w.id, w]));
    if (changed) {
      this.version++;
      this.edgeCache.clear();
    }
    return moved;
  }

  // Layer depth: 0 is the top window, the desktop is the deepest.
  z(id) {
    if (id == null) return Infinity;
    const w = this.byId.get(id);
    return w ? w.z : -1;
  }

  alive(id) { return id == null || this.byId.has(id); }

  rect(id) {
    return (id != null && this.byId.get(id)) || { id: null, x: 0, y: 0, w: this.W, h: this.H };
  }

  topAt(p) {
    for (const w of this.list) {
      if (p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h) return w;
    }
    return null;
  }

  // The window drawn over point p if p belongs to host `id`, else null.
  coverAt(p, id) {
    const top = this.topAt(p);
    return top && top.z < this.z(id) ? top : null;
  }

  anchor(p, id) {
    if (id === undefined) id = this.topAt(p)?.id ?? null;
    const w = id != null ? this.byId.get(id) : null;
    return { id: w ? w.id : null, ox: p.x - (w ? w.x : 0), oy: p.y - (w ? w.y : 0) };
  }

  pos(a) {
    if (a.id == null) return { x: a.ox, y: a.oy };
    const w = this.byId.get(a.id);
    return w ? { x: w.x + a.ox, y: w.y + a.oy } : null;
  }

  origin(id) {
    const w = id != null ? this.byId.get(id) : null;
    return w ? { x: w.x, y: w.y } : { x: 0, y: 0 };
  }

  // The higher of two hosts (what a thread between them is drawn with).
  upper(a, b) { return this.z(a) <= this.z(b) ? a : b; }

  // Visible stretches of every window's top or bottom edge: ledges to walk
  // along and undersides to hang from.
  edges(kind) {
    if (this.edgeCache.has(kind)) return this.edgeCache.get(kind);
    const out = [];
    for (const w of this.list) {
      const y = kind === 'top' ? w.y : w.y + w.h;
      if (y < 4 || y > this.H - 4) continue;
      let spans = [[Math.max(0, w.x), Math.min(this.W, w.x + w.w)]];
      for (const a of this.list) {
        if (a.z >= w.z) break;
        if (y < a.y - 1 || y > a.y + a.h + 1) continue;
        spans = subtract(spans, a.x, a.x + a.w);
      }
      for (const [x0, x1] of spans) if (x1 - x0 > 70) out.push({ id: w.id, x0, x1, y });
    }
    this.edgeCache.set(kind, out);
    return out;
  }
}

function subtract(spans, a, b) {
  const out = [];
  for (const [x0, x1] of spans) {
    if (b <= x0 || a >= x1) {
      out.push([x0, x1]);
      continue;
    }
    if (a > x0) out.push([x0, a]);
    if (b < x1) out.push([b, x1]);
  }
  return out;
}
