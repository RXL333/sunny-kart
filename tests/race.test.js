import test from 'node:test';
import assert from 'node:assert/strict';
import { Race } from '../src/game/race.js';
import { track } from '../src/game/track.js';

function advance(race, seconds, input = {}, others = {}) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) race.update(1 / 60, input, others);
}
const straightTrack = { length: 10000, width: 16, railOffset: 11, boostPads: [], coins: [], sample: distance => ({ x: 0, y: 5, z: distance, tx: 0, tz: 1, nx: 1, nz: 0, heading: 0, curvature: 0, slope: 0, width: 16 }) };
function started(options, course = track) {
  const race = new Race(course, options); race.start(); advance(race, 3.1); return race;
}
const removeTraffic = race => race.racers.filter(r => !race.humanIds.has(r.id)).forEach(r => { r.finished = true; });

test('track is smooth and closes with unit-length tangent and right normal', () => {
  const a = track.sample(0), b = track.sample(track.length);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.00001);
  for (const p of track.points) {
    assert.ok(Math.abs(Math.hypot(p.tx, p.tz) - 1) < 0.00001);
    assert.ok(Math.abs(p.tx * p.nx + p.tz * p.nz) < 0.00001);
    assert.equal(p.width, track.width);
  }
});

test('no automatic throttle; braking cannot reverse or earn laps', () => {
  const race = started();
  removeTraffic(race); // A parked kart may legitimately be pushed by live AI.
  advance(race, 2);
  assert.equal(race.player.distance, 0);
  advance(race, 1, { throttle: 1 });
  assert.ok(race.player.speed > 5);
  advance(race, 3, { brake: 1, throttle: -1 });
  const distance = race.player.distance;
  advance(race, 3, { brake: 1 });
  assert.equal(race.player.speed, 0);
  assert.equal(race.player.distance, distance);
  assert.equal(race.player.lap, 1);
});

test('pause freezes countdown and racing, resume preserves state, restart clears race', () => {
  const race = new Race(track); race.start(); advance(race, 1);
  race.pause(); const countdown = race.countdown; advance(race, 2);
  assert.equal(race.countdown, countdown);
  race.resume(); advance(race, 3, { throttle: 1 });
  race.pause(); const { distance, speed } = race.player; const elapsed = race.elapsed;
  advance(race, 5, { throttle: 1, nitro: true });
  assert.equal(race.player.distance, distance); assert.equal(race.player.speed, speed); assert.equal(race.elapsed, elapsed);
  race.resume(); advance(race, 1, { throttle: 1 }); assert.ok(race.player.distance > distance);
  race.restart(); assert.equal(race.phase, 'countdown'); assert.equal(race.elapsed, 0); assert.equal(race.player.distance, 0); assert.equal(race.player.nitro, 55);
});

test('drifting then releasing creates boost and refills nitro; active nitro consumes energy', () => {
  const race = started({}, straightTrack);
  removeTraffic(race);
  race.player.nitro = 20; race.player.offset = -5;
  advance(race, 2, { throttle: 1 });
  advance(race, 1.2, { throttle: 1, drift: true, steer: 0.25 });
  assert.ok(race.player.driftCharge > 0.24);
  const nitro = race.player.nitro;
  race.update(1 / 60, { throttle: 1 });
  assert.ok(race.player.boost > 0); assert.ok(race.player.nitro > nitro);
  assert.equal(race.player.driftCharge, 0);
  const energy = race.player.nitro;
  // Countersteer arrests the released drift before using the stored nitrogen.
  advance(race, 0.4, { throttle: 1, nitro: true, steer: -0.65 });
  assert.ok(race.player.nitro < energy); assert.ok(race.player.nitroActive);
});

test('lap progression requires full forward distance and completion produces ordered results', () => {
  const race = started();
  race.player.distance = track.length - 0.1; race.player.bestDistance = race.player.distance; race.player.speed = 25;
  race.update(1 / 60, { throttle: 1 });
  assert.equal(race.player.lap, 2); assert.equal(race.phase, 'racing');
  race.player.distance = track.length * 3 - 0.1; race.player.bestDistance = race.player.distance;
  race.update(1 / 60, { throttle: 1 });
  assert.equal(race.phase, 'finished'); assert.equal(race.player.lap, 3);
  assert.ok(race.finishTime > 0); assert.equal(race.results.length, 8);
  assert.equal(race.results[0].id, race.player.id);
});

test('authoritative multiplayer uses independent human inputs and snapshots preserve local identity', () => {
  const race = started({ humanPlayers: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }], multiplayer: true });
  removeTraffic(race);
  advance(race, 2, {}, { alice: { throttle: 1 }, bob: { brake: 1 } });
  assert.ok(race.racers.find(r => r.id === 'alice').speed > 10);
  assert.equal(race.racers.find(r => r.id === 'bob').speed, 0);
  const client = new Race(track); client.applySnapshot(race.snapshot(), 'bob');
  assert.equal(client.player.id, 'bob'); assert.deepEqual(client.humanIds, new Set(['alice', 'bob']));
  assert.equal(client.elapsed, race.elapsed);
});

test('AI can finish circuit without player input, and light collisions remain finite', () => {
  const race = started({ multiplayer: true });
  advance(race, track.length * 3 / 22 + 50);
  assert.ok(race.racers.filter(r => !race.humanIds.has(r.id)).every(r => r.finished));
  assert.ok(race.racers.every(r => Number.isFinite(r.distance) && Number.isFinite(r.offset)));
  assert.equal(race.player.finished, false);
});

test('second multiplayer driver receives personal drift events in snapshots', () => {
  const race = started({ humanPlayers: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }], multiplayer: true });
  const bob = race.racers.find(r => r.id === 'bob');
  bob.distance = 200; bob.offset = -5; bob.speed = 30; bob.nitro = 10;
  race.consumeEvents();
  advance(race, 1, {}, { bob: { throttle: 1, drift: true, steer: 0.25 } });
  race.update(1 / 60, {}, { bob: { throttle: 1 } });
  const client = new Race(track); client.applySnapshot(race.snapshot(), 'bob');
  assert.ok(client.consumeEvents().some(e => e.type === 'driftBoost' && e.racerId === 'bob'));
});
