import test from 'node:test';
import assert from 'node:assert/strict';
import { Race } from '../src/game/race.js';
import { ITEMS, ITEM_RULES, chooseItem } from '../src/game/items.js';

const course = (extras = {}) => ({
  id: 'manual-item-test', length: 1000, width: 16, railOffset: 11, boostPads: [], coins: [],
  sample: distance => ({ x: 0, y: 1, z: distance, tx: 0, tz: 1, nx: 1, nz: 0, heading: 0, curvature: 0, slope: 0 }),
  ...extras,
});
function ready(options = {}, track = course()) {
  const race = new Race(track, { mode: 'items', ...options });
  race.phase = 'racing'; race.racers = [race.player]; race.player.offset = 0;
  return race;
}
function cross(race, distance) {
  race.player.distance = distance - .1; race.player.speed = 30;
  race.update(.01, { throttle: 1 });
}
const object = (type = 'bubble') => ({ id: 'attack', type, ownerId: 'other', distance: 10, offset: 0, life: 3, speed: 0 });

test('competitive and time trial modes have no boxes, inventory effects, or item attacks', () => {
  for (const mode of ['race', 'time-trial']) {
    const race = ready({ mode }, course({ itemBoxes: [{ id: 'box', type: 'rocket', distance: 10, lane: 0 }] }));
    cross(race, 10); race.update(.01, { useItem: true });
    assert.deepEqual(race.itemBoxes, []); assert.equal(race.player.inventory, null);
    assert.equal(race.player.rocket, 0); assert.equal(race.hitWithItem(race.player, object()), false);
    assert.deepEqual(race.itemObjects, []); assert.equal(race.player.itemSlow, 0);
  }
  assert.equal(new Race(course()).mode, 'race', 'existing launches retain pure racing');
});

test('a full inventory preserves its item and leaves the next box available', () => {
  const race = ready({}, course({ itemBoxes: [
    { id: 'a', type: 'shield', distance: 10, lane: 0 }, { id: 'b', type: 'rocket', distance: 20, lane: 0 },
  ] }));
  cross(race, 10); cross(race, 20);
  assert.equal(race.player.inventory, 'shield'); assert.equal(race.player.itemCollected.a, 0);
  assert.equal(race.player.itemCollected.b, undefined); assert.equal(race.player.shield, 0);
  race.update(.01, { useItem: true }); cross(race, 20);
  assert.equal(race.player.inventory, 'rocket'); assert.equal(race.player.itemCollected.b, 0);
});

test('manual use is independent of nitro, requires a fresh press, and cannot auto-use newly collected items', () => {
  const race = ready(); race.player.inventory = 'rocket'; race.player.speed = 10;
  const nitro = race.player.nitro;
  race.update(.01, { throttle: 1, useItem: true });
  assert.equal(race.player.inventory, null); assert.ok(race.player.rocket > 0); assert.equal(race.player.nitro, nitro);
  race.player.inventory = 'shield'; race.update(.1, { useItem: true });
  assert.equal(race.player.inventory, 'shield'); assert.equal(race.player.shield, 0);
  race.update(.01, { useItem: false }); race.update(.01, { useItem: true });
  assert.equal(race.player.inventory, null); assert.ok(race.player.shield > 0);
  assert.equal(race.consumeEvents().filter(e => e.type === 'itemUse').length, 2);
});

test('sequenced quick taps survive release and are consumed exactly once across snapshot replay', () => {
  const race = ready(); race.player.inventory = 'shield';
  race.update(.01, { useItem: false, itemUseSeq: 1 });
  assert.ok(race.player.shield > 0); assert.equal(race.player.lastItemUseSeq, 1);
  race.player.inventory = 'magnet';
  const resumed = ready(); resumed.applySnapshot(race.snapshot());
  resumed.update(.01, { useItem: true, itemUseSeq: 1 });
  assert.equal(resumed.player.inventory, 'magnet'); assert.equal(resumed.player.magnet, 0);
  resumed.update(.01, { useItem: false, itemUseSeq: 2 });
  assert.equal(resumed.player.inventory, null); assert.ok(resumed.player.magnet > 0);
  resumed.update(.01, { itemUseSeq: 3 }); // Empty presses must not spend a future pickup.
  resumed.player.inventory = 'rocket'; resumed.update(.01, { useItem: true, itemUseSeq: 3 });
  assert.equal(resumed.player.inventory, 'rocket'); assert.equal(resumed.player.lastItemUseSeq, 3);
});

test('prediction cannot consume items, advance attack objects, or acknowledge item action sequences', () => {
  const race = ready(); race.player.inventory = 'bubble'; race.itemObjects = [object()];
  race.stepRacer(race.player, { throttle: 0, steer: 0, brake: 0, useItem: true, itemUseSeq: 5 }, .1, { prediction: true });
  assert.equal(race.player.inventory, 'bubble'); assert.equal(race.player.lastItemUseSeq, 0);
  assert.equal(race.player.itemUseHeld, false); assert.deepEqual(race.itemObjects, [object()]);
  assert.equal(race.consumeEvents().filter(e => e.type === 'itemUse' || e.type === 'itemHit').length, 0);
});

test('a hit slows once for one second, protects for two seconds, and leaves steering and drift intact', () => {
  const race = ready(); Object.assign(race.player, { speed: 40, yaw: .3, yawRate: .1, lateralVelocity: 4, isDrifting: true, driftCharge: .7 });
  assert.equal(race.hitWithItem(race.player, object()), true);
  assert.equal(race.player.speed, 30); assert.equal(race.player.itemSlow, 1); assert.equal(race.player.itemProtection, 2);
  assert.equal(race.player.yaw, .3); assert.equal(race.player.yawRate, .1); assert.equal(race.player.lateralVelocity, 4);
  assert.equal(race.player.isDrifting, true); assert.equal(race.player.driftCharge, .7); assert.equal(race.player.spin, 0);
  assert.equal(race.hitWithItem(race.player, object('jelly')), false); assert.equal(race.player.speed, 30);
  for (let i = 0; i < 11; i++) race.update(.1, { throttle: 1 });
  assert.equal(race.player.itemSlow, 0); assert.ok(race.player.itemProtection > .8);
  assert.equal(race.hitWithItem(race.player, object()), false);
  for (let i = 0; i < 10; i++) race.update(.1, { throttle: 1 });
  const before = race.player.speed;
  assert.equal(race.hitWithItem(race.player, object()), true); assert.equal(race.player.speed, before * .75);
});

test('shield consumes one attack, grants protection, and never stacks attack slowdown', () => {
  const race = ready(); race.player.shield = 7; race.player.speed = 32;
  assert.equal(race.hitWithItem(race.player, object()), true);
  assert.equal(race.player.shield, 0); assert.equal(race.player.speed, 32);
  assert.equal(race.player.itemSlow, 0); assert.equal(race.player.itemProtection, 2);
  assert.equal(race.hitWithItem(race.player, object('jelly')), false);
  assert.equal(race.consumeEvents().filter(e => e.type === 'shieldBlock').length, 1);
});

test('bubble projectiles travel forward, hit another driver once, and disappear', () => {
  const race = ready(); const target = { ...race.player, id: 'target', distance: 10, speed: 40 };
  race.racers.push(target); race.player.inventory = 'bubble';
  race.useItem(race.player); assert.equal(race.itemObjects[0].distance, 3.4);
  race.stepItemObjects(.1);
  assert.equal(target.speed, 30); assert.equal(target.itemSlow, 1); assert.deepEqual(race.itemObjects, []);
  assert.equal(race.player.itemSlow, 0); assert.equal(race.consumeEvents().filter(e => e.type === 'itemHit').length, 1);
});

test('bubble assistance only eases toward a nearby forward lane at a limited rate', () => {
  const race = ready();
  const target = { ...race.player, id: 'target', distance: 25, offset: 2, speed: 0 };
  race.racers.push(target); race.player.inventory = 'bubble'; race.useItem(race.player);
  const projectile = race.itemObjects[0]; race.stepItemObjects(.1);
  assert.ok(projectile.offset > 0 && projectile.offset <= .28 + 1e-9); assert.equal(projectile.targetId, 'target');
  target.distance = projectile.distance - 5;
  const previousOffset = projectile.offset; race.stepItemObjects(.01);
  assert.equal(projectile.offset, previousOffset); assert.equal(projectile.targetId, null, 'never turns back toward a passed driver');
  target.distance = projectile.distance + 10; target.offset = 7;
  race.stepItemObjects(.01); assert.equal(projectile.offset, previousOffset, 'distant lanes do not attract it');
  target.offset = 1; target.distance = projectile.distance + 80;
  race.stepItemObjects(.01); assert.equal(projectile.offset, previousOffset, 'distant road sections do not attract it');
});

test('jelly stays behind its owner, ignores the owner, and hits a following driver', () => {
  const race = ready(); race.player.distance = 20; race.player.inventory = 'jelly'; race.useItem(race.player);
  const trap = race.itemObjects[0]; assert.equal(trap.type, 'jelly'); assert.equal(trap.distance, 16.6);
  race.player.distance = trap.distance; race.stepItemObjects(.1);
  assert.equal(race.itemObjects.length, 1); assert.equal(race.player.itemSlow, 0);
  const target = { ...race.player, id: 'follower', speed: 32 };
  race.racers.push(target); race.stepItemObjects(.1);
  assert.equal(target.speed, 24); assert.equal(race.itemObjects.length, 0);
});

test('nearby road coordinates cannot hit across separated world geometry or elevations', () => {
  for (const axis of ['x', 'y']) {
    const race = ready({}, course({ sample: distance => ({ x: 0, y: 0, z: distance, nx: 1, nz: 0, [axis]: distance < 10.5 ? 0 : 20 }) }));
    race.player.distance = 11; race.player.speed = 40; race.itemObjects = [object()];
    race.stepItemObjects(.01);
    assert.equal(race.player.speed, 40); assert.equal(race.itemObjects.length, 1);
  }
});

test('attack object count and life are bounded without allowing owner hits', () => {
  const race = ready();
  for (let i = 0; i < 40; i++) { race.player.inventory = 'jelly'; race.useItem(race.player); }
  assert.equal(race.itemObjects.length, ITEM_RULES.maxObjects);
  assert.equal(new Set(race.itemObjects.map(o => o.id)).size, ITEM_RULES.maxObjects);
  for (let i = 0; i < 91; i++) race.stepItemObjects(.1);
  assert.equal(race.itemObjects.length, 0); assert.equal(race.player.itemSlow, 0);
});

test('item snapshots restore independent boxes, objects, held inventory, timers, and random state', () => {
  const race = ready(); race.player.inventory = 'bubble'; race.useItem(race.player);
  Object.assign(race.player, { inventory: 'shield', itemProtection: 1.5, itemSlow: .5, lastItemUseSeq: 9 });
  const snapshot = race.snapshot(), restored = ready({ mode: 'race' }); restored.applySnapshot(snapshot);
  assert.equal(restored.mode, 'items'); assert.equal(restored.player.inventory, 'shield');
  assert.equal(restored.player.itemProtection, 1.5); assert.equal(restored.player.itemSlow, .5); assert.equal(restored.player.lastItemUseSeq, 9);
  assert.deepEqual(restored.itemObjects, race.itemObjects); assert.equal(restored.itemRandomState, race.itemRandomState);
  restored.itemObjects[0].distance = 99; restored.itemBoxes[0].distance = 99;
  assert.notEqual(snapshot.itemObjects[0].distance, 99); assert.notEqual(race.itemObjects[0].distance, 99);
  assert.notEqual(snapshot.itemBoxes[0].distance, 99); assert.notEqual(race.itemBoxes[0].distance, 99);
});

test('each finished driver drops held effects and their attacks while the room keeps racing', () => {
  const race = new Race(course(), { mode: 'items', multiplayer: true, humanPlayers: [{ id: 'a' }, { id: 'b' }] });
  race.phase = 'racing'; race.racers = race.racers.slice(0, 2);
  Object.assign(race.player, { distance: 2999.9, speed: 30, offset: 0, inventory: 'rocket', shield: 4, magnet: 5, rocket: 2, itemSlow: .5, itemProtection: 1 });
  race.itemObjects = [{ ...object(), ownerId: 'a' }, { ...object(), id: 'keep', ownerId: 'b', distance: 500 }];
  race.update(.01, { throttle: 1 });
  assert.equal(race.player.finished, true); assert.equal(race.phase, 'racing');
  assert.equal(race.player.inventory, null);
  for (const key of ['shield', 'magnet', 'rocket', 'itemSlow', 'itemProtection', 'boost', 'driftBoost']) assert.equal(race.player[key], 0);
  assert.ok(race.itemObjects.every(o => o.ownerId !== 'a')); assert.ok(race.itemObjects.some(o => o.id === 'keep'));
  race.racers[1].inventory = 'shield'; race.racers[1].magnet = 5; race.finish();
  assert.deepEqual(race.itemObjects, []); assert.equal(race.racers[1].inventory, null); assert.equal(race.racers[1].magnet, 0);
  const restored = ready(); restored.applySnapshot(race.snapshot(), 'a');
  assert.equal(restored.phase, 'finished'); assert.deepEqual(restored.itemObjects, []);
});

test('rank weights retain all five rewards and modestly favor recovery tools for trailing drivers', () => {
  const sample = rank => {
    const counts = Object.fromEntries(Object.keys(ITEMS).map(type => [type, 0]));
    for (let i = 0; i < 10000; i++) counts[chooseItem(rank, 8, () => i / 10000)]++;
    return counts;
  };
  const leading = sample(1), trailing = sample(8);
  assert.ok(Object.values(leading).every(count => count > 0)); assert.ok(Object.values(trailing).every(count => count > 0));
  assert.ok(trailing.rocket > leading.rocket); assert.ok(trailing.magnet > leading.magnet);
  const a = ready({ itemSeed: 42 }), b = ready({ itemSeed: 42 });
  assert.deepEqual(Array.from({ length: 20 }, () => a.itemRandom()), Array.from({ length: 20 }, () => b.itemRandom()));
});

test('AI waits after pickup then uses its actual held item through the same consumption rule', () => {
  const race = new Race(course(), { mode: 'items' }); race.phase = 'racing'; race.racers = race.racers.slice(0, 2);
  const ai = race.racers[1]; Object.assign(ai, { distance: 50, offset: 0, inventory: 'shield', itemAiDelay: .5 });
  race.update(.1); assert.equal(ai.inventory, 'shield'); assert.equal(ai.shield, 0);
  for (let i = 0; i < 6; i++) race.update(.1);
  assert.equal(ai.inventory, null); assert.ok(ai.shield > 0);
  assert.equal(race.consumeEvents().filter(e => e.type === 'itemUse' && e.racerId === ai.id).length, 1);
});
