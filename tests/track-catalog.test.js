import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TRACK_ID, TRACK_CATALOG, createTrack, track } from '../src/game/track.js';
import { createTerrainSampler, MAP_LAYOUT } from '../src/game/map-layout.js';

const tracks = TRACK_CATALOG.map(({ id }) => createTrack(id));
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);

test('catalog has four distinct deterministic routes and rejects unsupported identifiers', () => {
  assert.equal(DEFAULT_TRACK_ID, 'sunny-island');
  assert.equal(track.id, DEFAULT_TRACK_ID);
  assert.equal(TRACK_CATALOG.length, 4);
  assert.equal(new Set(TRACK_CATALOG.map(entry => entry.id)).size, 4);
  assert.equal(new Set(tracks.map(route => Math.round(route.length))).size, 4);
  assert.ok(Object.isFrozen(TRACK_CATALOG));
  for (const entry of TRACK_CATALOG) {
    assert.ok(entry.name && entry.description && entry.subtitle && entry.difficulty && entry.theme);
    const a = createTrack(entry.id), b = createTrack(entry.id);
    assert.deepEqual(a.controlPoints, b.controlPoints);
    assert.deepEqual(a.coins, b.coins);
    assert.deepEqual(a.boostPads, b.boostPads);
    assert.equal(a.length, b.length);
    assert.equal(a.theme, entry.theme);
  }
  for (const id of ['unknown', '__proto__', '', null, {}, 1]) assert.throws(() => createTrack(id), RangeError);
});

test('every course closes continuously with a finite normalized road frame', () => {
  for (const route of tracks) {
    assert.ok(route.length > 1600 && route.length < 2500, route.id);
    assert.equal(route.width, 16);
    assert.ok(route.bounds.width > 550 && route.bounds.depth > 450, route.id);
    for (const fraction of [0, .00001, .1, .25, .5, .75, .99999]) {
      const d = fraction * route.length, p = route.sample(d), next = route.sample(d + route.length), previous = route.sample(d - route.length);
      for (const key of ['x', 'y', 'z', 'tx', 'tz', 'nx', 'nz', 'slope', 'curvature', 'pitch']) {
        assert.ok(Number.isFinite(p[key]), `${route.id}: ${key}`);
        close(p[key], next[key]);close(p[key], previous[key]);
      }
      close(Math.hypot(p.tx, p.tz), 1);close(p.tx * p.nx + p.tz * p.nz, 0);
    }
  }
});

test('every route remains within the shared arcade steering and slope limits', () => {
  for (const route of tracks) {
    let previous = route.sample(-1), minimum = Infinity, maximum = -Infinity;
    for (let d = 0; d < route.length; d++) {
      const p = route.sample(d);
      assert.ok(Math.abs(p.slope) < .085, `${route.id}: slope at ${d}`);
      assert.ok(Math.abs(p.curvature) < .075, `${route.id}: curvature at ${d}`);
      assert.ok(Math.abs(p.curvature - previous.curvature) < .014, `${route.id}: curvature jump at ${d}`);
      minimum = Math.min(minimum, p.curvature);maximum = Math.max(maximum, p.curvature);previous = p;
    }
    if (route.id === 'starlight-canyon') assert.ok(minimum < -.01 && maximum > .01, 'canyon has meaningful left and right drift corners');
    if (route.id === 'bay-loop') assert.ok(maximum < .012, 'bay stays a broad, approachable high-speed course');
  }
});

test('new circuits never cross themselves or bring unrelated road sections inside their guardrails', () => {
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (const route of tracks.slice(1)) {
    const count = Math.ceil(route.length / 5), spacing = route.length / count;
    const points = Array.from({ length: count }, (_, i) => route.sample(i * spacing));
    for (let i = 0; i < count; i++) for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const a = points[i], b = points[(i + 1) % count], c = points[j], d = points[(j + 1) % count];
      assert.ok(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0), `${route.id}: road crossing ${i}/${j}`);
      const along = Math.min(j - i, count - j + i) * spacing;
      if (along > 60) assert.ok(Math.hypot(a.x - c.x, a.z - c.z) > 26, `${route.id}: unrelated guardrails overlap ${i}/${j}`);
    }
  }
});

test('new road surfaces and verges stay above rendered terrain triangles through hills and bridge zones', () => {
  const settings = MAP_LAYOUT.terrain;
  const dx = settings.width / (settings.chunksX * settings.segments), dz = settings.depth / (settings.chunksZ * settings.segments);
  for (const route of tracks.slice(1)) {
    const sampler = createTerrainSampler(route);
    const height = (x, z) => {
      const gx = (x + settings.width / 2) / dx, gz = (z + settings.depth / 2) / dz;
      const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
      const x0 = ix * dx - settings.width / 2, z0 = iz * dz - settings.depth / 2;
      const h00 = sampler.terrainHeight(x0, z0), h10 = sampler.terrainHeight(x0 + dx, z0);
      const h01 = sampler.terrainHeight(x0, z0 + dz), h11 = sampler.terrainHeight(x0 + dx, z0 + dz);
      return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    };
    for (let d = 0; d < route.length; d += 5) {
      const p = route.sample(d);
      assert.ok(sampler.nearest(p.x, p.z).d < .05, `${route.id}: spatial index at ${d}`);
      for (const lane of [-11, -8, 0, 8, 11]) assert.ok(height(p.x + p.nx * lane, p.z + p.nz * lane) < p.y - .05, `${route.id}: terrain clips road at ${d}/${lane}`);
    }
    for (const u of [.75, .77, .79]) {
      const p = route.sample(u * route.length);
      assert.ok(sampler.terrainHeight(p.x, p.z) < -.8, `${route.id}: bridge water ${u}`);
      assert.ok(p.y > 8, `${route.id}: bridge clearance ${u}`);
    }
  }
});

test('every destination provides continuous named zones and reachable unique rewards', () => {
  for (const route of tracks) {
    assert.equal(route.zones.length, 5);
    assert.deepEqual(new Set(route.zones.map(zone => zone.kind)), new Set(['coast', 'forest', 'mountain', 'bridge', 'village']));
    close(route.zones[0].start, 0);close(route.zones.at(-1).end, route.length);
    for (let i = 0; i < route.zones.length; i++) {
      const zone = route.zones[i];
      if (i) close(zone.start, route.zones[i - 1].end);
      assert.equal(route.sample((zone.start + zone.end) / 2).zone.name, zone.name);
    }
    assert.ok(route.boostPads.length >= 8 && route.coins.length >= 90);
    const pickups = [...route.boostPads, ...route.coins];
    assert.equal(new Set(pickups.map(item => item.id)).size, pickups.length);
    for (const item of pickups) {
      assert.ok(item.distance >= 0 && item.distance < route.length);
      assert.ok(Math.abs(item.lane) < route.width / 2 - 1);
    }
  }
});
