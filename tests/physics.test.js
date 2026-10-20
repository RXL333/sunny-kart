import test from 'node:test';
import assert from 'node:assert/strict';
import { Race } from '../src/game/race.js';
import { PHYSICS, kartContact, kineticEnergy, resolveRailCollision, solveKartCollisions, stepKartPhysics } from '../src/game/physics.js';

const straight = { length: 10000, width: 16, railOffset: 11, boostPads: [], coins: [], sample: distance => ({ heading: 0, curvature: 0, slope: 0, tx: 0, tz: 1, nx: 1, nz: 0, x: 0, y: 5, z: distance }) };
const car = (id, values = {}) => ({ id, distance: 50, offset: 0, speed: 20, lateralVelocity: 0, yaw: 0, yawRate: 0, isDrifting: false, ...values });
const totalEnergy = cars => cars.reduce((sum, r) => sum + kineticEnergy(r), 0);
const input = overrides => ({ throttle: 0, brake: 0, steer: 0, drift: false, ...overrides });
const penetration = (a, b) => kartContact(a, b, straight)?.penetration || 0;

test('rear-end contact transfers momentum, separates rounded bodies and cannot add kinetic energy', () => {
  const a = car('rear', { distance: 50, speed: 34 }), b = car('front', { distance: 52.7, speed: 9 });
  const before = totalEnergy([a, b]);
  const contacts = solveKartCollisions([a, b], straight);
  assert.equal(contacts.length, 1);
  assert.ok(a.speed < 34 && b.speed > 9);
  assert.ok(totalEnergy([a, b]) <= before + 1e-9);
  assert.ok(penetration(a, b) < 0.025);
  const stable = totalEnergy([a, b]);
  for (let i = 0; i < 80; i++) solveKartCollisions([a, b], straight);
  assert.ok(totalEnergy([a, b]) <= stable + 1e-9);
  assert.ok(penetration(a, b) < 0.005);
});

test('opposing lateral impacts dissipate side motion and do not tunnel through each other', () => {
  const a = car('left', { offset: -0.7, lateralVelocity: 8, yaw: 0.12 });
  const b = car('right', { offset: 0.7, lateralVelocity: -8, yaw: -0.12 });
  const before = totalEnergy([a, b]);
  solveKartCollisions([a, b], straight);
  assert.ok(a.offset < b.offset);
  assert.ok(totalEnergy([a, b]) < before);
  assert.ok(Math.abs(a.lateralVelocity) < 8 && Math.abs(b.lateralVelocity) < 8);
  assert.ok(penetration(a, b) < 0.025);
});

test('tight inside bends collide by world body distance rather than centerline progress alone', () => {
  const radius = 20;
  const bend = { ...straight, length: Math.PI * 2 * radius, sample: distance => {
    const heading = distance / radius;
    return { heading, curvature: 1 / radius, x: radius * (1 - Math.cos(heading)), z: radius * Math.sin(heading), tx: Math.sin(heading), tz: Math.cos(heading), nx: Math.cos(heading), nz: -Math.sin(heading) };
  } };
  const a = car('inside-rear', { distance: 0, offset: 7, speed: 25 });
  const b = car('inside-front', { distance: 5, offset: 7, speed: 10 });
  assert.ok(kartContact(a, b, bend)?.penetration > 0, '5m of centerline progress is only 3.25m along this inside lane');
  const before = totalEnergy([a, b]);
  solveKartCollisions([a, b], bend);
  assert.ok((kartContact(a, b, bend)?.penetration || 0) < 0.025);
  assert.ok(totalEnergy([a, b]) <= before + 1e-9);
});

test('a stationary overlapping queue separates without creating motion or repeated jitter', () => {
  const cars = [car('a', { speed: 0 }), car('b', { speed: 0, distance: 52 }), car('c', { speed: 0, distance: 54 })];
  for (let i = 0; i < 20; i++) solveKartCollisions(cars, straight);
  assert.equal(totalEnergy(cars), 0);
  assert.ok(penetration(cars[0], cars[1]) < 0.005);
  assert.ok(penetration(cars[1], cars[2]) < 0.005);
  const positions = cars.map(r => r.distance);
  for (let i = 0; i < 10; i++) solveKartCollisions(cars, straight);
  assert.ok(cars.every((r, i) => Math.abs(r.distance - positions[i]) < 0.00001));
});

test('rail contact constrains the full body, reflects softly and loses energy', () => {
  const r = car('wall', { offset: 10.8, speed: 32, lateralVelocity: 12, yaw: 0.35 });
  const before = kineticEnergy(r);
  assert.ok(resolveRailCollision(r, straight) > 0);
  assert.ok(r.offset + PHYSICS.bodyRadius + Math.abs(Math.sin(r.yaw)) * PHYSICS.bodyHalfSpan <= straight.railOffset + 0.001);
  assert.ok(r.lateralVelocity < 0 && Math.abs(r.lateralVelocity) < 2);
  assert.ok(kineticEnergy(r) < before);
  for (let i = 0; i < 120; i++) {
    stepKartPhysics(r, input({ throttle: 1, steer: 1 }), straight, 1 / 120);
    assert.ok(Math.abs(r.offset) + PHYSICS.bodyRadius + Math.abs(Math.sin(r.yaw)) * PHYSICS.bodyHalfSpan <= straight.railOffset + 0.001);
  }
  assert.ok(Number.isFinite(r.speed) && r.speed < 34);
});

test('curves require steering: centered wheels keep world heading and carry the kart outward', () => {
  const curved = { ...straight, sample: distance => ({ heading: distance * 0.012, curvature: 0.012, slope: 0 }) };
  const unsteered = car('straight-ahead', { distance: 0, speed: 30 });
  for (let i = 0; i < 120; i++) stepKartPhysics(unsteered, input({ throttle: 1 }), curved, 1 / 120);
  assert.ok(unsteered.offset < -3);
  assert.ok(unsteered.yaw < -0.25);
  assert.ok(Math.abs(unsteered.distance * 0.012 + unsteered.yaw) < 0.02);
});

test('normal grip arrests lateral slip faster than drift, and countersteer can recover a drift', () => {
  const normal = car('normal', { lateralVelocity: 8 }), drifting = car('drift', { lateralVelocity: 8, isDrifting: true });
  for (let i = 0; i < 24; i++) {
    stepKartPhysics(normal, input({ throttle: 1 }), straight, 1 / 120);
    stepKartPhysics(drifting, input({ throttle: 1 }), straight, 1 / 120);
  }
  assert.ok(Math.abs(drifting.lateralVelocity) > Math.abs(normal.lateralVelocity) * 2);
  const r = car('recover', { offset: -4, speed: 28, isDrifting: true });
  for (let i = 0; i < 85; i++) stepKartPhysics(r, input({ throttle: 1, steer: 0.3 }), straight, 1 / 120);
  const driftYaw = r.yaw;
  r.isDrifting = false;
  for (let i = 0; i < 55; i++) stepKartPhysics(r, input({ throttle: 1, steer: -0.6 }), straight, 1 / 120);
  assert.ok(Math.abs(r.yaw) < Math.abs(driftYaw));
  assert.ok(Math.abs(r.offset) < straight.width / 2);
});

test('Race substeps give the same movement at 120, 60, 30 and 10 FPS', () => {
  function run(dt) {
    const r = new Race(straight); r.phase = 'racing'; r.racers = [r.player];
    for (let i = 0; i < Math.round(3 / dt); i++) r.update(dt, { throttle: 1, steer: 0.06 });
    return r.player;
  }
  const reference = run(1 / 120);
  for (const dt of [1 / 60, 1 / 30, 1 / 10]) {
    const r = run(dt);
    for (const key of ['distance', 'offset', 'speed', 'lateralVelocity', 'yaw']) assert.ok(Math.abs(r[key] - reference[key]) < 1e-6, `${key} drifted at dt=${dt}`);
  }
});

test('fast rear-end approaches remain ordered with a 100ms browser frame', () => {
  const r = new Race(straight, { humanPlayers: [{ id: 'fast', name: 'Fast' }, { id: 'slow', name: 'Slow' }], multiplayer: true });
  r.phase = 'racing'; r.racers = r.racers.slice(0, 2); r.player = r.racers[0];
  const [a, b] = r.racers;
  Object.assign(a, { distance: 50, offset: 0, speed: 45 });
  Object.assign(b, { distance: 54.2, offset: 0, speed: 5 });
  for (let i = 0; i < 12; i++) {
    r.update(0.1, {}, { fast: { throttle: 0 }, slow: { throttle: 0 } });
    assert.ok(a.distance < b.distance);
    assert.ok(penetration(a, b) < 0.025);
  }
  assert.ok(a.speed < 45);
});
