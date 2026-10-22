import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { GhostRecorder, GhostStore, ghostKey, validateGhost, ghostPoseAt, ghostDeltaAt } from '../src/ghost.js';
import { TimeTrialUI } from '../src/time-trial.js';
import { Race } from '../src/game/race.js';

const meta = { trackId: 'sunny-island', character: 'fox', laps: 3, trackLength: 100 };
const pose = distance => ({ distance, offset: Math.sin(distance / 30), yaw: 0.2, speed: 10 });
function run(time = 30, options = meta) {
  const recorder = new GhostRecorder(options), total = options.trackLength * options.laps;
  for (let t = 0; t < time; t += 0.025) recorder.record(t, { ...pose(total * t / time), speed: total / time });
  recorder.record(time, { ...pose(total), speed: total / time });
  const race = { mode: 'time-trial', phase: 'finished', multiplayer: false, player: { ...pose(total), finished: true, finishTime: time } };
  return { recorder, race, recording: recorder.finish(race) };
}
function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('ghost records at a fixed interval, finishes at the actual line, and interpolates across laps', () => {
  const { recording } = run();
  assert.ok(validateGhost(recording, meta));
  assert.equal(recording.samples.length, 301);
  assert.deepEqual(recording.samples.at(-1).slice(0, 2), [30, 300]);
  assert.ok(Math.abs(ghostPoseAt(recording, 10.05).distance - 100.5) < 1e-9);
  assert.ok(Math.abs(ghostPoseAt(recording, 20.05).distance - 200.5) < 1e-9);
  assert.equal(ghostPoseAt(recording, -1), null);
  assert.equal(ghostPoseAt(recording, 31), null);
  assert.equal(ghostDeltaAt(recording, 205, 19.5), -1);
  assert.equal(ghostDeltaAt(recording, 105, 11.5), 1);
  assert.equal(ghostDeltaAt(recording, -1, 0), null);
});

test('ghost interpolates yaw on the short arc, not through a full turn', () => {
  const recording = { time: 1, samples: [[0, 0, 0, 3.1, 1], [1, 1, 0, -3.1, 1]] };
  assert.ok(Math.abs(ghostPoseAt(recording, 0.5).yaw) > 3.13);
});

test('finishing next to a sample boundary rounds without duplicate timestamps', () => {
  const { recording } = run(30.0004);
  assert.ok(validateGhost(recording, meta));
  assert.equal(recording.samples.at(-1)[0], 30);
  assert.equal(recording.samples.at(-2)[0], 29.9);
});

test('only completed solo time trials save, and teleporting or partial runs are rejected', () => {
  const partial = new GhostRecorder(meta);
  partial.record(0, pose(0)); partial.record(0.1, pose(1));
  assert.equal(partial.finish({ mode: 'time-trial', phase: 'racing', player: { ...pose(300), finished: false, finishTime: 30 } }), null);
  assert.equal(partial.finish({ mode: 'time-trial', phase: 'finished', player: { ...pose(299), finished: true, finishTime: 30 } }), null);
  const teleport = new GhostRecorder(meta);
  teleport.record(0, pose(0)); assert.equal(teleport.record(0.1, pose(100)), false);
  assert.equal(teleport.invalid, true);
  const late = new GhostRecorder(meta); assert.equal(late.record(10, pose(100)), false);
  const backwardsTime = new GhostRecorder(meta); backwardsTime.record(0, pose(0)); backwardsTime.record(0.1, pose(1));
  assert.equal(backwardsTime.record(0.05, pose(0.5)), false);
  const networked = new GhostRecorder(meta); networked.record(0, pose(0));
  assert.equal(networked.finish({ mode: 'time-trial', phase: 'finished', multiplayer: true, player: { finished: true } }), null);
});

test('recording rejects long discontinuities and never captures paused wall time', () => {
  const recorder = new GhostRecorder(meta);
  recorder.record(0, pose(0)); recorder.record(0.1, pose(1));
  for (let i = 0; i < 50; i++) assert.equal(recorder.record(0.1, pose(1)), true);
  assert.equal(recorder.samples.length, 2);
  assert.equal(recorder.record(2, pose(20)), false);
});

test('storage keeps only faster records and isolates course, character, physics, laps and geometry', () => {
  const storage = memory(), store = new GhostStore({ storage }), fast = run(30).recording, slow = run(31).recording;
  assert.equal(store.save(slow).saved, true);
  assert.equal(store.save(fast).saved, true);
  assert.equal(store.save(slow).reason, 'slower');
  assert.equal(store.load(meta).time, 30);
  for (const change of [{ trackId: 'bay-loop' }, { character: 'rabbit' }, { physicsVersion: 'other-version' }, { laps: 1 }, { trackLength: 101 }]) {
    assert.notEqual(ghostKey(meta), ghostKey({ ...meta, ...change }));
    assert.equal(store.load({ ...meta, ...change }), null);
    assert.equal(validateGhost(fast, { ...meta, ...change }), false);
  }
});

test('corrupt, oversized, non-finite and implausible saved recordings cannot become ghosts', () => {
  const storage = memory(), store = new GhostStore({ storage }), original = run().recording;
  storage.setItem(ghostKey(meta), '{invalid json'); assert.equal(store.load(meta), null);
  storage.setItem(ghostKey(meta), 'x'.repeat(2_000_001)); assert.equal(store.load(meta), null);
  for (const mutate of [
    r => { r.samples[1][1] = 100; },
    r => { r.samples[1][0] = 0; },
    r => { r.samples[1][2] = Infinity; },
    r => { r.samples[1][4] = 101; },
    r => { r.samples.at(-1)[1] = 299; },
    r => { r.mode = 'race'; },
    r => { r.samples[0][1] = 200; },
  ]) {
    const copy = structuredClone(original); mutate(copy); assert.equal(validateGhost(copy), false);
    assert.equal(store.save(copy).reason, 'invalid');
  }
});

test('storage failures report the limitation while preserving this session recording', () => {
  const messages = [], recording = run().recording;
  const store = new GhostStore({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } }, onError: message => messages.push(message) });
  assert.equal(store.load(meta), null);
  const result = store.save(recording);
  assert.equal(result.reason, 'storage'); assert.equal(result.best, recording); assert.equal(messages.length, 1);
  assert.equal(store.load(meta), recording, 'a denied disk write still leaves a session ghost for restart');
  assert.equal(new GhostStore({ storage: null }).save(recording).reason, 'storage');
});

test('a real shared-physics solo race produces valid ghost and interpolated finish splits', () => {
  const track = { id: 'sunny-island', length: 100, width: 16, railOffset: 11, boostPads: [], coins: [], sample: distance => ({ x: 0, y: 5, z: distance, tx: 0, tz: 1, nx: 1, nz: 0, heading: 0, curvature: 0, slope: 0, width: 16 }) };
  const race = new Race(track, { mode: 'time-trial' }); race.start();
  const recorder = new GhostRecorder(meta);
  for (let frame = 0; frame < 6000 && race.phase !== 'finished'; frame++) {
    race.update(1 / 60, { throttle: 1 });
    if (race.phase === 'racing') recorder.record(race.elapsed, race.player);
  }
  assert.equal(race.phase, 'finished');
  assert.equal(race.racers.length, 1);
  const recording = recorder.finish(race);
  assert.ok(validateGhost(recording, meta));
  assert.equal(race.player.lapTimes.length, 3);
  assert.ok(Math.abs(race.player.lapTimes.reduce((a, b) => a + b, 0) - race.player.finishTime) < 1e-6);
  assert.ok(Math.abs(recording.time - race.player.finishTime) < 0.001);
});

test('time-trial UI exposes entry, delta, lap feedback and result splits, then resets for normal racing', () => {
  const window = new Window(), document = window.document;
  document.body.innerHTML = '<div id="app"><div class="start-actions"></div><div class="ready-line"></div><div class="race-hud"></div><div class="result-stat-row"></div><p class="result-summary"></p></div>';
  const root = document.querySelector('#app'); let started = 0;
  const ui = new TimeTrialUI(root, { onStart: () => started++ }), best = run().recording;
  ui.button.click(); assert.equal(started, 1);
  ui.setBusy(true); assert.equal(ui.button.disabled, true); ui.setBusy(false);
  ui.begin(meta, best);
  const race = { mode: 'time-trial', phase: 'racing', elapsed: 11.5, track: { name: '测试海岸' }, player: { distance: 105, lapTimes: [10.5], lastLapStartedAt: 10.5 } };
  ui.update(race);
  assert.match(ui.fields.delta.textContent, /落后 1.00/);
  assert.match(ui.fields.lap.textContent, /本圈 00:01.00/);
  assert.match(ui.fields['lap-feedback'].textContent, /第 1 圈/);
  race.elapsed = 19.5; race.player.distance = 205; ui.update(race); assert.match(ui.fields.delta.textContent, /领先 1.00/);
  race.phase = 'finished'; race.player.lapTimes = [10, 10, 10]; ui.finish({ race, saveResult: { reason: 'best' } });
  assert.equal(ui.result.querySelectorAll('li').length, 3); assert.match(ui.result.textContent, /新的个人最佳/);
  ui.reset(); assert.equal(ui.panel.hidden, true); assert.equal(ui.result.hidden, true); assert.equal(root.classList.contains('time-trial-active'), false);
  window.close();
});
