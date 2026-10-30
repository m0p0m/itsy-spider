// Small 2D helpers shared by the renderer scripts (loaded as classic scripts).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const vec = (x = 0, y = 0) => ({ x, y });
const vcopy = (a) => ({ x: a.x, y: a.y });
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const vscale = (a, s) => ({ x: a.x * s, y: a.y * s });
const vlen = (a) => Math.hypot(a.x, a.y);
const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const vlerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const vdot = (a, b) => a.x * b.x + a.y * b.y;
const vcross = (a, b) => a.x * b.y - a.y * b.x;
const vangle = (a) => Math.atan2(a.y, a.x);
const fromAngle = (ang, len = 1) => ({ x: Math.cos(ang) * len, y: Math.sin(ang) * len });
const vnorm = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const vclampLen = (a, max) => {
  const l = Math.hypot(a.x, a.y);
  return l > max ? vscale(a, max / l) : a;
};

function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// Frame-rate independent exponential approach.
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const vapproach = (cur, target, rate, dt) => vlerp(cur, target, 1 - Math.exp(-rate * dt));
