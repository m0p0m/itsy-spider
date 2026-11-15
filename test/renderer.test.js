const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const renderer = vm.createContext();
// Midpoint sampling removes the capture spiral's small radial jitter.
vm.runInContext('Math.random = () => 0.5', renderer);
for (const file of ['math.js', 'world.js', 'spider.js', 'silk.js']) {
  const source = readFileSync(path.join(__dirname, '..', 'src', 'renderer', file), 'utf8');
  vm.runInContext(source, renderer, { filename: file });
}
const { solveKnee, OrbWeb } = vm.runInContext('({ solveKnee, OrbWeb })', renderer);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const tolerance = 1e-8;

test('reachable legs preserve both bone lengths and bend away from the body', () => {
  const hip = { x: 12, y: -7 };
  const femur = 28;
  const tibia = 31;
  for (const foot of [{ x: 52, y: -7 }, { x: -8, y: 25 }]) {
    const dx = foot.x - hip.x;
    const dy = foot.y - hip.y;
    const side = ({ x, y }) => dx * (y - hip.y) - dy * (x - hip.x);
    const bodies = [{ x: hip.x - dy, y: hip.y + dx }, { x: hip.x + dy, y: hip.y - dx }];
    for (const body of bodies) {
      const knee = solveKnee(hip, foot, femur, tibia, body);
      assert.ok(Math.abs(distance(hip, knee) - femur) < tolerance, 'femur length');
      assert.ok(Math.abs(distance(knee, foot) - tibia) < tolerance, 'tibia length');
      assert.ok(side(knee) * side(body) < 0, 'knee and body lie on opposite sides');
    }
  }
});

const host = { x: 130, y: 75, w: 280, h: 250 };
const center = { x: 270, y: 200 };

test('orb web strokes connect existing nodes inside the host window', () => {
  const web = new OrbWeb('test-window', host, center, 85);
  assert.ok(web.strokes.length > 0, 'the web has strokes');
  for (const [index] of web.nodes.entries()) {
    const { x, y } = web.abs(index);
    assert.ok(x >= host.x - tolerance && x <= host.x + host.w + tolerance, `node ${index} x`);
    assert.ok(y >= host.y - tolerance && y <= host.y + host.h + tolerance, `node ${index} y`);
  }
  for (const { i, j } of web.strokes) {
    assert.ok(Number.isInteger(i) && i >= 0 && i < web.nodes.length, `stroke starts at node ${i}`);
    assert.ok(Number.isInteger(j) && j >= 0 && j < web.nodes.length, `stroke ends at node ${j}`);
  }
});

test('the laid capture spiral travels from the outside toward the hub', () => {
  const web = new OrbWeb('test-window', host, center, 85);
  const spiral = web.strokes.filter(({ kind, lay }) => kind === 'spiral' && lay);
  assert.ok(spiral.length > 1, 'the web lays multiple capture strokes');
  let previous = Infinity;
  for (const { i, j } of spiral) {
    const start = distance(center, web.abs(i));
    const end = distance(center, web.abs(j));
    assert.ok(start <= previous + tolerance, 'later strokes stay inward of earlier strokes');
    assert.ok(end < start, 'each stroke travels inward');
    previous = end;
  }
});
