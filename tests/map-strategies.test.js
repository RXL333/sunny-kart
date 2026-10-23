import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, TRACK_CATALOG } from '../src/game/track.js';
import { Race } from '../src/game/race.js';

test('every track offers three deterministic signed strategy sections with a neutral escape lane', () => {
  for (const { id } of TRACK_CATALOG) {
    const track = createTrack(id), copy = createTrack(id);
    assert.equal(track.strategySections.length, 3);
    assert.equal(track.strategyZones.length, 6);
    assert.deepEqual(track.strategyZones, copy.strategyZones);
    const ids = new Set();
    for (const section of track.strategySections) {
      assert.ok(section.label && section.description);
      assert.equal(section.choices.length, 2);
      for (const zone of section.choices) {
        assert.equal(ids.has(zone.id), false);ids.add(zone.id);
        assert.ok(zone.start > 0 && zone.end < track.length && zone.end > zone.start);
        assert.ok(Math.abs(zone.lane) + zone.halfWidth < 7, 'all bands remain inside the road and away from rails');
        assert.ok(zone.halfWidth >= .9 && zone.speedFactor >= .88 && zone.speedFactor <= 1.10);
        assert.equal(zone.kind === 'energy', zone.nitroRate > 0);
        assert.equal(zone.kind === 'energy', zone.speedFactor < 1, 'energy must cost time and sprinting must cost nitro');
        const segment = zone.segments?.[0] ?? zone, d = (segment.start + segment.end) / 2;
        assert.equal(track.strategyAt(d, zone.lane)?.id, zone.id);
        assert.equal(track.strategyAt(d + track.length, zone.lane)?.id, zone.id, 'same choice remains available next lap');
        assert.equal(track.strategyAt(d - track.length, zone.lane)?.id, zone.id);
        assert.equal(track.strategyAt(d, 0), null, 'centre lane never forces a resource trade');
        assert.equal(track.strategyAt(d, zone.lane + Math.sign(zone.lane) * (zone.halfWidth + .01)), null);
      }
    }
    for (const [distance, offset] of [[NaN, 0], [Infinity, 0], [100, NaN], [100, Infinity]]) assert.equal(track.strategyAt(distance, offset), null);
  }
});

test('each course has its own driving choices instead of recoloured identical bands', () => {
  const island = createTrack('sunny-island'), candy = createTrack('candy-hills'), bay = createTrack('bay-loop'), canyon = createTrack('starlight-canyon');
  for (const zone of island.strategyZones.filter(zone => zone.kind === 'energy')) {
    const curvature = island.sample((zone.start + zone.end) / 2).curvature;
    assert.ok(zone.lane * curvature < 0, 'continuous drift recharge follows the longer outside line');
    assert.equal(zone.driftChargeFactor, 1.14);
  }
  for (const section of candy.strategySections) {
    const [energy, sprint] = section.choices;
    assert.equal(energy.segments.length, 3);assert.equal(sprint.segments, undefined);
    const gap = (energy.segments[0].end + energy.segments[1].start) / 2;
    assert.equal(candy.strategyAt(gap, energy.lane), null, 'painted gaps have no hidden recharge');
    assert.equal(candy.strategyAt(gap, sprint.lane)?.id, sprint.id, 'steady line continues through recharge gaps');
  }
  for (const section of bay.strategySections) {
    const [energy, sprint] = section.choices;
    assert.ok(energy.halfWidth > sprint.halfWidth * 2, 'bay trades a broad safe line for a narrow fast line');
    assert.ok(sprint.speedFactor >= 1.085);
  }
  const final = canyon.strategySections.at(-1).choices[1];
  assert.ok(canyon.strategySections.slice(0, 2).every(section => section.choices[0].nitroRate >= 9));
  assert.equal(final.nitroRate, -15);assert.equal(final.speedFactor, 1.10);
  assert.ok(final.start > canyon.length * .85, 'canyon rewards saving nitro for the final stretch');
});

test('every signed strategy trades actual driving pace against nitro and an empty sprint gives no free speed', () => {
  for (const { id } of TRACK_CATALOG) {
    const course = createTrack(id);
    // Flatten the road frame to isolate the bands from cornering, slopes and
    // unrelated pickups. The real course's lookup and signed zone data remain.
    const road = { ...course, boostPads: [], coins: [], sample: distance => ({ x: 0, y: 0, z: distance, tx: 0, tz: 1, nx: 1, nz: 0, heading: 0, slope: 0, curvature: 0 }) };
    const drive = (zone, nitro, neutral = false) => {
      const race = new Race(road, { mode: 'time-trial' }), racer = race.player;
      const segment = zone.segments?.[0] ?? zone;
      Object.assign(racer, { distance: (segment.start + segment.end) / 2, offset: neutral ? 0 : zone.lane, speed: 34, nitro, yaw: 0, lateralVelocity: 0 });
      for (let i = 0; i < 6; i++) race.stepRacer(racer, { throttle: 1, brake: 0, steer: 0, drift: false, nitro: false }, 1 / 60, { prediction: true });
      return racer;
    };
    for (const zone of course.strategyZones) {
      const neutral = drive(zone, 50, true), chosen = drive(zone, 50);
      if (zone.kind === 'energy') {
        assert.ok(chosen.nitro > neutral.nitro, `${zone.id} must actually replenish energy`);
        assert.ok(chosen.speed < neutral.speed, `${zone.id} must actually cost pace`);
      } else {
        assert.ok(chosen.nitro < neutral.nitro, `${zone.id} must consume energy`);
        assert.ok(chosen.speed > neutral.speed, `${zone.id} must reward the expenditure`);
        const empty = drive(zone, 0), emptyNeutral = drive(zone, 0, true);
        assert.equal(empty.nitro, 0);assert.equal(empty.speed, emptyNeutral.speed, 'no nitro means no free sprint benefit');
      }
    }
  }
});
