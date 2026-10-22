import test from 'node:test';
import assert from 'node:assert/strict';
import { Race } from '../src/game/race.js';
import { createItemBoxes, isPickupCollected, ITEMS } from '../src/game/items.js';
import { resolveRailCollision } from '../src/game/physics.js';
import { createTrack, TRACK_CATALOG } from '../src/game/track.js';

const course = (extras = {}) => ({
  length: 100, width: 16, railOffset: 11, boostPads: [], coins: [],
  sample: distance => ({ x: 0, y: 1, z: distance, tx: 0, tz: 1, nx: 1, nz: 0, heading: 0, curvature: 0, slope: 0 }),
  ...extras,
});
function ready(track, options = {}) {
  const race = new Race(track, { mode: 'items', ...options }); race.phase = 'racing'; race.player.offset = 0;
  if (!options.multiplayer) race.racers = [race.player];
  return race;
}
function cross(race, distance, input = { throttle: 1 }) {
  race.player.distance = distance - .1; race.player.speed = 30;
  race.update(.01, input);
}

test('nitro crystals disappear per driver and cannot reward repeated crossing within the same lap', () => {
  const track = course({ coins: [{ id: 'crystal', distance: 10, lane: 0 }] });
  const race = ready(track); race.player.nitro = 20;
  cross(race, 10);
  assert.equal(race.player.nitro, 28); assert.equal(race.player.coins, 1);
  assert.equal(race.player.collectedLaps.crystal, 0);
  assert.ok(race.player.collected.crystal > 0 && race.player.collected.crystal <= race.elapsed, 'retain elapsed timestamp from the collecting substep');
  assert.ok(isPickupCollected(race.player, 'crystal', track));
  cross(race, 10);
  assert.equal(race.player.nitro, 28); assert.equal(race.player.coins, 1);
  const energy = race.consumeEvents().filter(e => e.type === 'energy');
  assert.equal(energy.length, 1); assert.equal(energy[0].crystalId, 'crystal');
  assert.equal(energy[0].lap, 0);
  race.player.bestDistance = 101; race.player.distance = 101;
  assert.equal(isPickupCollected(race.player, 'crystal', track), false, 'next lap restores the crystal');
  cross(race, 110);
  assert.equal(race.player.nitro, 36); assert.equal(race.player.collectedLaps.crystal, 1);
  assert.ok(isPickupCollected(race.player, 'crystal', track));
  race.player.bestDistance = 300; race.player.distance = 300; race.player.finished = true; race.player.lap = 3;
  race.player.collectedLaps.crystal = 2;
  assert.ok(isPickupCollected(race.player, 'crystal', track), 'finishing does not respawn a fourth lap of crystals');
});

test('pickup snapshots preserve independent player visibility and have no shared mutable collection maps', () => {
  const track = course({ coins: [{ id: 'c', distance: 10, lane: 0 }] });
  const server = ready(track, { multiplayer: true, humanPlayers: [{ id: 'a' }, { id: 'b' }] });
  server.racers.slice(2).forEach(r => { r.finished = true; });
  cross(server, 10);
  const snapshot = server.snapshot(), client = new Race(track);
  client.applySnapshot(snapshot, 'a');
  assert.equal(isPickupCollected(client.player, 'c', track), true);
  assert.equal(isPickupCollected(snapshot.racers.find(r => r.id === 'b'), 'c', track), false);
  client.player.collectedLaps.c = 99;
  assert.equal(server.player.collectedLaps.c, 0); assert.equal(snapshot.racers[0].collectedLaps.c, 0);
});

test('full nitro still collects and hides a crystal while feedback reports the actual capped reward', () => {
  const track = course({ coins: [{ id: 'full', distance: 10, lane: 0 }] });
  const race = ready(track); race.player.nitro = 100; cross(race, 10);
  assert.equal(race.player.nitro, 100); assert.equal(race.player.coins, 1);
  assert.equal(isPickupCollected(race.player, 'full', track), true);
  const full = race.consumeEvents().find(e => e.type === 'energy');
  assert.equal(full.amount, 0); assert.equal(full.text, '氮气已满');
  race.player.nitro = 97.5; cross(race, 110);
  const partial = race.consumeEvents().find(e => e.type === 'energy');
  assert.equal(partial.amount, 2.5); assert.equal(partial.text, '能量 +2.5');
  assert.equal(race.player.nitro, 100);
});

test('prediction cannot claim pickups, activate boxes or finish a race before confirmation', () => {
  const track = course({ coins: [{ id: 'c', distance: 10, lane: 0 }], itemBoxes: [{ id: 'box', distance: 10, lane: 0, type: 'rocket' }] });
  const race = ready(track); race.player.distance = 9.9; race.player.speed = 30;
  race.stepRacer(race.player, { throttle: 1, brake: 0, steer: 0 }, .01, { prediction: true });
  assert.equal(race.player.nitro, 55); assert.deepEqual(race.player.collectedLaps, {});
  assert.deepEqual(race.player.itemCollected, {}); assert.equal(race.player.rocket, 0);
  race.player.distance = 299.9; race.player.bestDistance = 299.9;
  race.stepRacer(race.player, { throttle: 1, brake: 0, steer: 0 }, .01, { prediction: true });
  assert.equal(race.player.finished, false); assert.equal(race.player.lapTimes.length, 0);
  const confirmedLap = race.player.lap;
  race.player.collectedLaps.c = 2;
  assert.ok(isPickupCollected(race.player, 'c', track));
  assert.equal(race.player.lap, confirmedLap, 'lap display also waits for authority');
});

test('boxes use deterministic positions and grant one manual inventory item only once per lap', () => {
  const track = course({ id: 'test' }), boxes = createItemBoxes(track);
  assert.deepEqual(boxes, createItemBoxes(track));
  assert.ok(boxes.every(box => box.type === 'random'));
  assert.ok(boxes.every(b => b.distance > 0 && b.distance < track.length));
  const race = ready(course({ itemBoxes: [{ id: 'box', distance: 10, lane: 0, type: 'shield' }] }));
  cross(race, 10); assert.equal(race.player.inventory, 'shield'); assert.equal(race.player.shield, 0);
  race.update(.01, { useItem: true });
  assert.equal(race.player.inventory, null); assert.ok(race.player.shield > ITEMS.shield.duration - .02 && race.player.shield <= ITEMS.shield.duration);
  assert.equal(race.player.itemCollected.box, 0);
  race.player.shield = 2; cross(race, 10);
  assert.ok(race.player.shield < 2, 'backtracking cannot refill the effect');
  assert.equal(race.consumeEvents().filter(e => e.type === 'item').length, 1);
  race.player.shield = .005; race.update(.01);
  assert.equal(race.player.shield, 0);
});

test('magnet widens crystal collection and stops attracting after expiry', () => {
  const track = course({ coins: [{ id: 'wide', distance: 20, lane: 6 }], itemBoxes: [{ id: 'magnet', type: 'magnet', distance: 10, lane: 0 }] });
  const race = ready(track); cross(race, 10); race.update(.01, { useItem: true }); cross(race, 20);
  assert.equal(race.player.coins, 1); assert.ok(race.player.magnet > 0);
  const normal = ready(track); cross(normal, 20); assert.equal(normal.player.coins, 0);
  const expired = ready(track); expired.player.magnet = .001; cross(expired, 20);
  assert.equal(expired.player.coins, 0); assert.equal(expired.player.magnet, 0);
});

test('rocket provides a bounded acceleration boost, and shield mitigates rail and car contact', () => {
  const track = course({ length: 1000 }), normal = ready(track), rocket = ready(track);
  rocket.player.rocket = 1;
  for (let i = 0; i < 30; i++) { normal.update(1 / 60, { throttle: 1 }); rocket.update(1 / 60, { throttle: 1 }); }
  assert.ok(rocket.player.speed > normal.player.speed + 5);
  for (let i = 0; i < 40; i++) rocket.update(1 / 60, { throttle: 1 });
  assert.equal(rocket.player.rocket, 0);
  const a = { offset: 12, lateralVelocity: 8, speed: 30, yaw: 0 }, b = { ...a, shield: 3 };
  resolveRailCollision(a, track); resolveRailCollision(b, track);
  assert.ok(b.speed > a.speed); assert.ok(Math.abs(b.offset) <= track.railOffset);
  const contact = shield => {
    const race = ready(track, { multiplayer: true, humanPlayers: [{ id: 'a' }, { id: 'b' }] });
    race.racers = race.racers.slice(0, 2);
    Object.assign(race.racers[0], { distance: 0, offset: 0, speed: 30, shield });
    Object.assign(race.racers[1], { distance: 2, offset: 0, speed: 0 });
    race.collisions(); return race.racers[0].speed;
  };
  assert.ok(contact(2) > contact(0)); assert.ok(contact(2) <= 30);
});

test('time trial has one centered kart, no boxes or traffic, and records interpolated lap splits', () => {
  const race = new Race(course({ id: 'circuit' }), { mode: 'time-trial' });
  assert.equal(race.racers.length, 1); assert.equal(race.player.offset, 0);
  assert.deepEqual(race.itemBoxes, []); race.phase = 'racing'; race.elapsed = 5;
  cross(race, 100);
  assert.equal(race.player.lapTimes.length, 1);
  assert.ok(race.player.lapTimes[0] >= 5 && race.player.lapTimes[0] <= 5.01);
  cross(race, 200); assert.equal(race.player.lapTimes.length, 2);
  cross(race, 300); assert.equal(race.player.lapTimes.length, 3);
  assert.equal(race.phase, 'finished'); assert.equal(race.results.length, 1);
  const client = new Race(race.track); client.applySnapshot(race.snapshot());
  assert.equal(client.mode, 'time-trial'); assert.deepEqual(client.itemBoxes, []);
  assert.equal(client.player.lapTimes.length, 3);
});

test('temporarily disconnected racers use AI without losing their human seat', () => {
  const race = ready(course({ length: 1000 }), { multiplayer: true, humanPlayers: [{ id: 'a' }, { id: 'b' }] });
  race.racers = race.racers.slice(0, 2); race.racers[1].distance = 20;
  race.disconnectedIds.add('b');
  for (let i = 0; i < 60; i++) race.update(1 / 60);
  assert.ok(race.racers[1].speed > 5); assert.ok(race.humanIds.has('b'));
  assert.equal(race.player.speed, 0); assert.equal(race.phase, 'racing');
});

test('four courses remain finite and preserve pickups/ranks through eight simulated minutes of varied inputs', () => {
  let seed = 0x51a77;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  let totalPickups = 0, shieldFrames = 0, checks = 0;
  for (const entry of TRACK_CATALOG) {
    const track = createTrack(entry.id), race = new Race(track, { laps: 3, mode: 'items' }); race.phase = 'racing';
    const knownCrystals = new Set(track.coins.map(c => c.id)), knownBoxes = new Set(race.itemBoxes.map(b => b.id));
    let simulated = 0, previousElapsed = 0;
    while (simulated < 120 && race.phase === 'racing') {
      const dt = [1 / 60, 1 / 30, .05, .1][Math.floor(random() * 4)], ai = race.aiInput(race.player, 0);
      const input = { throttle: random() > .015 ? 1 : 0, brake: random() < .02 ? .4 : ai.brake,
        steer: Math.max(-1, Math.min(1, ai.steer + (random() - .5) * .08)), drift: random() < .025, nitro: random() < .25, useItem: random() < .2 };
      race.update(dt, input); simulated += dt;
      // Exercise authority serialization and clear events exactly as the live
      // server does; a leak in long-lived event accumulation is not concealed.
      if (checks++ % 20 !== 0) continue;
      const snapshot = race.snapshot();
      assert.ok(snapshot.elapsed >= previousElapsed); previousElapsed = snapshot.elapsed;
      assert.deepEqual(race.racers.map(r => r.position).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
      for (const racer of race.racers) {
        for (const key of ['distance', 'bestDistance', 'offset', 'speed', 'yaw', 'lateralVelocity', 'nitro', 'shield', 'magnet', 'rocket', 'itemSlow', 'itemProtection']) assert.ok(Number.isFinite(racer[key]), `${entry.id}/${racer.id}/${key}`);
        assert.ok(racer.speed >= 0 && racer.speed < 80); assert.ok(racer.nitro >= 0 && racer.nitro <= 100);
        assert.ok(Math.abs(racer.offset) <= track.railOffset);
        for (const [id, lap] of Object.entries(racer.collectedLaps)) { assert.ok(knownCrystals.has(id)); assert.ok(Number.isInteger(lap) && lap >= 0 && lap < race.laps); }
        for (const [id, lap] of Object.entries(racer.itemCollected)) { assert.ok(knownBoxes.has(id)); assert.ok(Number.isInteger(lap) && lap >= 0 && lap < race.laps); }
        assert.ok(racer.coins <= track.coins.length * race.laps, 'rewinding/contacts cannot duplicate rewards');
        for (const type of ['shield', 'magnet', 'rocket']) assert.ok(racer[type] >= 0 && racer[type] <= ITEMS[type].duration);
        assert.ok(racer.inventory === null || ITEMS[racer.inventory]);
        assert.ok(race.itemObjects.length <= 24);
        if (racer.shield > 0) shieldFrames++;
      }
    }
    totalPickups += race.racers.reduce((sum, r) => sum + r.coins, 0);
    assert.ok(race.racers.some(r => Object.keys(r.itemCollected).length > 0), `${entry.id} exercised an item pickup`);
  }
  assert.ok(totalPickups > 50, 'the simulation reached real reward locations');
  assert.ok(shieldFrames > 0, 'shield and collision integration was exercised');
});
