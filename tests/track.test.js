import test from 'node:test';
import assert from 'node:assert/strict';
import { track } from '../src/game/track.js';
import { createTerrainSampler, MAP_LAYOUT } from '../src/game/map-layout.js';

const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

test('the expanded island has a closed 2.1 km route and continuous road frame', () => {
  assert.ok(track.length > 1800 && track.length < 2200);
  assert.ok(track.bounds.width * track.bounds.depth > 300000, 'route footprint exceeds nine old 200 x 162 m footprints');
  assert.equal(track.width, 16);
  for (const d of [0, 3, 140, 700, 1800, track.length - .01]) {
    const a = track.sample(d), b = track.sample(d + track.length), c = track.sample(d - track.length);
    for (const key of ['x', 'y', 'z', 'tx', 'tz', 'slope', 'curvature']) { close(a[key], b[key]); close(a[key], c[key]); }
    close(Math.hypot(a.tx, a.tz), 1);
    close(a.tx * a.nx + a.tz * a.nz, 0);
  }
  close(angle(track.sample(.001).heading - track.sample(-.001).heading), 0, .001);
});

test('road slope and curvature remain smooth and within driving limits', () => {
  let previous = track.sample(-1);
  for (let d = 0; d < track.length; d += 1) {
    const p = track.sample(d);
    assert.ok(Math.abs(p.slope) < .085, `slope at ${d} = ${p.slope}`);
    assert.ok(Math.abs(p.curvature) < .075, `curvature at ${d} = ${p.curvature}`);
    assert.ok(Math.abs(p.curvature - previous.curvature) < .014, `curvature jump at ${d}`);
    assert.ok(Number.isFinite(p.pitch));
    const finiteDifference = angle(track.sample(d + 1.5).heading - track.sample(d - 1.5).heading) / 3;
    close(p.curvature, finiteDifference);
    previous = p;
  }
});

test('the closed route does not intersect itself', () => {
  const count = Math.ceil(track.length / 5), pts = Array.from({ length: count }, (_, i) => track.sample(i / count * track.length));
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < count; i++) for (let j = i + 2; j < count; j++) {
    if (i === 0 && j === count - 1) continue;
    const a = pts[i], b = pts[(i + 1) % count], c = pts[j], d = pts[(j + 1) % count];
    assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0), `route crosses itself at segments ${i}, ${j}`);
  }
});

test('terrain stays below both road edges and the bridge opens over water', () => {
  const terrain = createTerrainSampler(track);
  for (let d = 0; d < track.length; d += 5) {
    const p = track.sample(d);
    assert.ok(terrain.nearest(p.x, p.z).d < .05);
    for (const lane of [-8, 0, 8]) {
      const h = terrain.terrainHeight(p.x + p.nx * lane, p.z + p.nz * lane);
      assert.ok(h < p.y - .1, `terrain ${h} reaches road ${p.y} at ${d}, lane ${lane}`);
    }
  }
  for (const u of [.75, .77, .79]) {
    const p = track.sample(u * track.length);
    assert.ok(terrain.terrainHeight(p.x, p.z) < -.8, `bridge at ${u} must have visible water underneath`);
    assert.ok(p.y > 10, 'bridge deck stays well above water');
  }
});

test('the rendered terrain triangles leave clearance across the full road width', () => {
  const sampler = createTerrainSampler(track), settings = MAP_LAYOUT.terrain;
  const dx = settings.width / (settings.chunksX * settings.segments), dz = settings.depth / (settings.chunksZ * settings.segments);
  const height = (x, z) => {
    const gx = (x + settings.width / 2) / dx, gz = (z + settings.depth / 2) / dz, ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
    const x0 = ix * dx - settings.width / 2, z0 = iz * dz - settings.depth / 2;
    const h00 = sampler.terrainHeight(x0, z0), h10 = sampler.terrainHeight(x0 + dx, z0), h01 = sampler.terrainHeight(x0, z0 + dz), h11 = sampler.terrainHeight(x0 + dx, z0 + dz);
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  };
  for (let d = 0; d < track.length; d += 4) {
    const p = track.sample(d);
    for (const lane of [-8, -4, 0, 4, 8]) assert.ok(height(p.x + p.nx * lane, p.z + p.nz * lane) < p.y - .05, `terrain triangle clips road at ${d}, lane ${lane}`);
  }
});

test('zones and route pickups cover the expanded lap with valid lanes', () => {
  assert.equal(track.zones.length, 5);
  close(track.zones[0].start, 0);
  close(track.zones.at(-1).end, track.length);
  for (let i = 0; i < track.zones.length; i++) {
    const z = track.zones[i];
    if (i) close(z.start, track.zones[i - 1].end);
    assert.equal(track.sample((z.start + z.end) / 2).zone.id, z.id);
  }
  assert.ok(track.boostPads.length >= 8);
  assert.ok(track.coins.length >= 90);
  for (const item of [...track.boostPads, ...track.coins]) {
    assert.ok(item.distance >= 0 && item.distance < track.length);
    assert.ok(Math.abs(item.lane) < track.width / 2 - 1);
  }
});
