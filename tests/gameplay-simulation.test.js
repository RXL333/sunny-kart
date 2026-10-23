import test from 'node:test';
import assert from 'node:assert/strict';
import { Race, DRIFT_STAGES, driftStageFor } from '../src/game/race.js';
import { itemWeights, itemThreatFor } from '../src/game/items.js';

const course = (extras = {}) => ({
  id: 'gameplay-test', length: 10000, width: 16, railOffset: 11, boostPads: [], coins: [], itemBoxes: [],
  sample: distance => ({ x: 0, y: 1, z: distance, tx: 0, tz: 1, nx: 1, nz: 0, heading: 0, curvature: 0, slope: 0 }),
  ...extras,
});
const controls = extra => ({ throttle: 1, brake: 0, steer: 0, drift: false, ...extra });
function ready(options = {}, track = course()) {
  const race = new Race(track, options); race.phase = 'racing';
  race.racers = race.racers.slice(0, 2); race.player.offset = 0;
  if (race.racers[1]) Object.assign(race.racers[1], { distance: 115, offset: 0, speed: 25 });
  Object.assign(race.player, { distance: 100, speed: 25 });
  race.consumeEvents();
  return race;
}

test('each charged drift tier releases its advertised boost and nitrogen exactly once', () => {
  assert.equal(driftStageFor(.239), 0);
  for (const tier of DRIFT_STAGES) {
    const race = ready(), p = race.player;
    Object.assign(p, { nitro: 0, isDrifting: true, driftCharge: tier.threshold });
    race.stepRacer(p, controls(), 1 / 120);
    assert.equal(p.boost, tier.duration); assert.equal(p.driftBoost, tier.duration);
    assert.equal(p.nitro, tier.nitro); assert.equal(p.driftCharge, 0);
    assert.equal(p.stats.driftBoosts, 1);
    assert.deepEqual(race.consumeEvents().filter(e => e.type === 'driftBoost').map(e => e.stage), [tier.stage]);
    race.stepRacer(p, controls(), 1 / 120);
    assert.equal(p.nitro, tier.nitro); assert.equal(p.stats.driftBoosts, 1);
  }
  const race = ready();
  Object.assign(race.player, { nitro: 0, offset: 10, isDrifting: true, driftCharge: 1 });
  race.stepRacer(race.player, controls(), 1 / 120);
  assert.equal(race.player.boost, 0); assert.equal(race.player.nitro, 0);
  assert.equal(race.player.stats.driftBoosts, 0, 'leaving the road cancels the release reward');
});

test('drift charging sends each ready cue once; prediction does not emit cues or award statistics', () => {
  const race = ready(), p = race.player;
  p.driftCharge = .23;
  race.stepRacer(p, controls({ drift: true, steer: .3 }), .04);
  race.stepRacer(p, controls({ drift: true, steer: .3 }), .04);
  assert.deepEqual(race.consumeEvents().filter(e => e.type === 'driftStage').map(e => e.stage), [1]);
  const stats = { ...p.stats };
  p.driftCharge = .54;
  race.stepRacer(p, controls({ drift: true, steer: .3 }), .04, { prediction: true });
  race.stepRacer(p, controls(), .04, { prediction: true });
  assert.deepEqual(p.stats, stats); assert.deepEqual(race.consumeEvents(), []);
});

test('tailing a nearby same-lane driver grants one bounded breakthrough and a cooldown', () => {
  const race = ready(), p = race.player;
  for (let i = 0; i < 126; i++) race.stepDraft(p, controls(), 1 / 120, false);
  assert.equal(p.stats.draftBoosts, 1); assert.ok(p.draftBoost > 1.3);
  assert.ok(p.draftCooldown > 3.1); assert.equal(p.draftCharge, 0);
  for (let i = 0; i < 120; i++) race.stepDraft(p, controls(), 1 / 120, false);
  assert.equal(p.stats.draftBoosts, 1); assert.equal(p.draftCharge, 0);
  assert.equal(race.consumeEvents().filter(e => e.type === 'draftBoost').length, 1);
});

test('tailwind needs a real nearby lead car and clears completely in time trial', () => {
  for (const change of [
    race => { race.racers = [race.player]; },
    race => { race.racers[1].offset = 4; },
    race => { race.racers[1].distance = 140; },
    race => { race.racers[1].speed = 0; },
    race => { race.player.offroad = true; },
    race => { race.racers[1].finished = true; },
  ]) {
    const race = ready(); change(race);
    race.stepDraft(race.player, controls(), 2, false);
    assert.equal(race.player.drafting, false); assert.equal(race.player.draftBoost, 0);
  }
  const elevated = ready({}, course({ sample: d => ({ x: 0, y: d > 110 ? 10 : 1, z: d, heading: 0 }) }));
  elevated.stepDraft(elevated.player, controls(), 2, false);
  assert.equal(elevated.player.draftBoost, 0, 'no wake across separated elevations');
  const trial = ready({ mode: 'time-trial' });
  Object.assign(trial.player, { draftBoost: 1, draftCharge: .9, draftCooldown: 3, drafting: true, draftTargetId: 'old' });
  trial.stepDraft(trial.player, controls(), .01, false);
  for (const key of ['draftBoost', 'draftCharge', 'draftCooldown']) assert.equal(trial.player[key], 0);
  assert.equal(trial.player.drafting, false); assert.equal(trial.player.draftTargetId, null);
});

test('prediction may charge tailwind but authority alone awards its boost and statistics', () => {
  const race = ready(), p = race.player;
  p.draftCharge = .99;
  race.stepDraft(p, controls(), .1, true);
  assert.equal(p.draftCharge, 1); assert.equal(p.draftBoost, 0); assert.equal(p.draftCooldown, 0);
  assert.equal(p.stats.draftBoosts, 0); assert.deepEqual(race.consumeEvents(), []);
  race.stepDraft(p, controls(), 1 / 120, false);
  assert.equal(p.stats.draftBoosts, 1); assert.ok(p.draftBoost > 0);
});

test('switching lead cars or braking cannot preserve an instant charged breakthrough', () => {
  const race = ready(), p = race.player;
  p.draftCharge = .95; p.draftTargetId = 'departed';
  race.stepDraft(p, controls(), .02, false);
  assert.ok(p.draftCharge < .03); assert.equal(p.draftBoost, 0);
  race.stepDraft(p, controls({ brake: 1 }), .1, false);
  assert.equal(p.drafting, false); assert.equal(p.draftCharge, 0);
});

test('a hit or shield block confirms to both drivers once without changing their controls', () => {
  for (const shielded of [false, true]) {
    const race = ready({ mode: 'items' }), [source, target] = race.racers;
    Object.assign(target, { shield: shielded ? 5 : 0, yaw: .2, yawRate: .1, driftCharge: .7, isDrifting: true });
    const object = { id: 'attack', ownerId: source.id, type: 'bubble' };
    const speed = target.speed;
    assert.equal(race.hitWithItem(target, object), true);
    assert.equal(race.hitWithItem(target, object), false);
    assert.equal(target.speed, shielded ? speed : speed * .75);
    assert.equal(target.yaw, .2); assert.equal(target.driftCharge, .7); assert.equal(target.isDrifting, true);
    assert.equal(source.stats.itemHits, shielded ? 0 : 1); assert.equal(target.stats.blocks, shielded ? 1 : 0);
    const state = race.snapshot(), sender = ready(), receiver = ready();
    sender.applySnapshot(state, source.id); receiver.applySnapshot(state, target.id);
    assert.deepEqual(sender.consumeEvents().map(e => [e.type, e.outcome, e.targetId]), [['itemConfirm', shielded ? 'blocked' : 'hit', target.id]]);
    assert.deepEqual(receiver.consumeEvents().map(e => e.type), [shielded ? 'shieldBlock' : 'itemHit']);
    assert.equal(target.stats.clean, true, 'item contact does not count as a driving collision');
  }
});

test('catch-up reward weights reflect the actual gap while keeping every item available', () => {
  const packed = Object.fromEntries(itemWeights(8, 8, 1)), distant = Object.fromEntries(itemWeights(8, 8, 150));
  assert.ok(distant.rocket > packed.rocket); assert.ok(distant.magnet > packed.magnet);
  for (const weights of [packed, distant, Object.fromEntries(itemWeights(1, 8, 0))]) assert.ok(Object.values(weights).every(v => v > 0));
});

test('incoming warnings respect direction, passing a trap, and separated elevations', () => {
  const race = ready({ mode: 'items' }), p = race.player;
  const bubble = { id: 'bubble', type: 'bubble', ownerId: 'rival', distance: p.distance - 20, offset: 0, speed: 52, life: 3 };
  const jelly = { id: 'jelly', type: 'jelly', ownerId: 'rival', distance: p.distance + 8, offset: 0, speed: 0, life: 3 };
  race.itemObjects = [bubble]; assert.equal(itemThreatFor(race).direction, 'rear');
  bubble.distance = p.distance + 10; assert.equal(itemThreatFor(race), null, 'a bubble ahead is moving away');
  race.itemObjects = [jelly]; assert.equal(itemThreatFor(race).direction, 'front');
  jelly.distance = p.distance - 1; assert.equal(itemThreatFor(race), null);
  race.track = course({ sample: d => ({ x: 0, y: d > 105 ? 10 : 1, z: d, heading: 0 }) });
  jelly.distance = p.distance + 8; assert.equal(itemThreatFor(race), null);
});

test('quiet low-speed scrapes invalidate clean driving without a loud collision cue', () => {
  const race = ready(), [a, b] = race.racers;
  Object.assign(a, { distance: 100, speed: 10 });
  Object.assign(b, { distance: 102.7, speed: 9.7 });
  race.collisions();
  assert.equal(a.stats.clean, false); assert.equal(b.stats.clean, false);
  assert.equal(a.stats.collisions, 1); assert.deepEqual(race.consumeEvents(), []);
  const wall = ready(), p = wall.player;
  Object.assign(p, { distance: 100, offset: 10.2, speed: 0, lateralVelocity: .1 });
  wall.stepRacer(p, controls({ throttle: 0 }), 1 / 120);
  assert.equal(p.stats.clean, false); assert.equal(p.stats.wallHits, 1);
  assert.deepEqual(wall.consumeEvents(), []);
});

test('AI holds a free passing lane and does not steer into an alongside car', () => {
  const race = ready(), [parked, ai] = race.racers;
  Object.assign(parked, { distance: 115, speed: 0 });
  Object.assign(ai, { distance: 100, speed: 25, personality: 'defensive' });
  const neighbor = { ...ai, id: 'alongside', distance: 100, offset: -3.5 };
  race.racers.push(neighbor);
  const first = race.aiInput(ai, 1);
  assert.equal(ai.aiPassTargetId, parked.id); assert.ok(ai.aiPassLane > 0); assert.ok(first.steer > 0);
  ai.offset = 3;
  race.aiInput(ai, 1);
  assert.ok(ai.aiPassLane > 0, 'the selected lane remains stable until the pass is complete');
});

test('AI chooses replenishing or spending lines by its real energy and commits through the section', () => {
  const energy = { id: 'energy', start: 150, end: 230, lane: 3.9, nitroRate: 8, speedFactor: .92 };
  const sprint = { id: 'sprint', start: 150, end: 230, lane: -3.9, nitroRate: -8, speedFactor: 1.09 };
  const race = ready({}, course({ strategySections: [{ id: 'choice', start: 150, end: 230, choices: [energy, sprint] }] }));
  const ai = race.racers[1]; race.player.finished = true;
  Object.assign(ai, { distance: 110, nitro: 10, personality: 'drifter' });
  assert.ok(race.aiInput(ai, 1).steer > 0); assert.equal(ai.aiStrategyZoneId, 'energy');
  ai.distance = 170; ai.nitro = 90;
  race.aiInput(ai, 1); assert.equal(ai.aiStrategyZoneId, 'energy', 'do not switch across traffic mid-section');
  ai.distance = 240; race.aiInput(ai, 1);
  assert.equal(ai.aiStrategyZoneId, null);
  ai.distance = race.track.length + 110;
  assert.ok(race.aiInput(ai, 1).steer < 0); assert.equal(ai.aiStrategyZoneId, 'sprint');
});

test('coasting after finishing cannot erase earned clean-driving statistics', () => {
  const race = ready(), p = race.player;
  Object.assign(p, { finished: true, offset: 10.2, lateralVelocity: 3 });
  race.stepRacer(p, controls(), 1 / 120);
  assert.equal(p.stats.clean, true); assert.equal(p.stats.wallHits, 0);
});

test('a nonzero remainder cannot advertise a sprint-line boost it cannot fund, including prediction', () => {
  const sprint = { id: 'sprint', label: '耗能快线', nitroRate: -12, speedFactor: 1.1 };
  for (const prediction of [false, true]) {
    const race = ready({}, course({ strategyAt: () => sprint })), reference = ready();
    Object.assign(race.player, { nitro: .01, speed: 34 }); reference.player.speed = 34;
    race.stepRacer(race.player, controls(), 1 / 120, { prediction });
    reference.stepRacer(reference.player, controls(), 1 / 120, { prediction });
    assert.equal(race.player.strategyId, 'sprint');
    assert.equal(race.player.strategyActive, false); assert.equal(race.player.strategySpeedFactor, 1);
    assert.equal(race.player.nitro, .01); assert.equal(race.player.speed, reference.player.speed);
    race.player.nitro = 1;
    race.stepRacer(race.player, controls(), 1 / 120, { prediction });
    assert.equal(race.player.strategyActive, true); assert.equal(race.player.strategySpeedFactor, 1.1);
    assert.ok(race.player.speed > reference.player.speed);
    assert.ok(Math.abs(race.player.nitro - .9) < 1e-9);
  }
});

test('strategy presentation state survives snapshots and defaults safely for old or finished racers', () => {
  const energy = { id: 'energy', label: '补能线', nitroRate: 8, speedFactor: .92 };
  const race = ready({ mode: 'time-trial' }, course({ strategyAt: () => energy }));
  assert.equal(race.player.strategyActive, false); assert.equal(race.player.strategySpeedFactor, 1);
  race.stepRacer(race.player, controls(), 1 / 120);
  assert.equal(race.player.strategyActive, true); assert.equal(race.player.strategySpeedFactor, .92);
  const state = race.snapshot(), client = ready(); client.applySnapshot(state);
  assert.equal(client.player.strategyActive, true); assert.equal(client.player.strategySpeedFactor, .92);
  delete state.racers[0].strategyActive; delete state.racers[0].strategySpeedFactor;
  client.applySnapshot(state);
  assert.equal(client.player.strategyActive, false); assert.equal(client.player.strategySpeedFactor, 1);
  client.player.finished = true;
  client.stepRacer(client.player, controls(), 1 / 120);
  assert.equal(client.player.strategyActive, false); assert.equal(client.player.strategySpeedFactor, 1);
  race.finish();
  assert.equal(race.player.strategyId, null); assert.equal(race.player.strategyActive, false);
  assert.equal(race.player.strategySpeedFactor, 1);
});
